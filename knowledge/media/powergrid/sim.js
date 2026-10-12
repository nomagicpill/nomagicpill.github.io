/*
 * The model behind knowledge/powergrid.html.
 *
 * One island grid about an eighth the size of the Lower 48 -- roughly ERCOT's
 * size -- stocked with the national average fleet mix, so that a typical day's
 * generation shares track the real U.S. shares while a single plant trip still
 * moves the frequency the way it does on a real island grid.
 *
 * No DOM and no three.js, so it also loads in node (require it), which is how
 * the numbers below were calibrated. In the page it becomes PowerGrid.sim.
 *
 * Units throughout: GW, GWh, $/MWh, $/MMBtu, hours on the sim clock, seconds
 * for the frequency dynamics, Hz.
 */
(function (root, factory) {
  const api = factory();
  // Node (for checking the model) or the page.
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.PowerGrid = root.PowerGrid || {}).sim = api;
})(this, function () {
'use strict';

const F0 = 60;

/* ----------------------------------------------------------------------------
 * Reference data (sourced; shown in the explainer text and charts)
 * ------------------------------------------------------------------------- */

// Share of 2025 U.S. generation, including small-scale solar (EIA Electric
// Power Monthly, via the full-year 2025 totals: 4,528 TWh).
const US_SHARES_2025 = [
  { id: 'gas', label: 'Natural gas', pct: 40.2, twh: 1807 },
  { id: 'nuclear', label: 'Nuclear', pct: 17.3, twh: 785 },
  { id: 'coal', label: 'Coal', pct: 16.3, twh: 737 },
  { id: 'wind', label: 'Wind', pct: 10.3, twh: 464 },
  { id: 'solar', label: 'Solar (incl. rooftop)', pct: 8.6, twh: 389 },
  { id: 'hydro', label: 'Hydro', pct: 5.5, twh: 247 },
  { id: 'biomass', label: 'Biomass', pct: 1.0, twh: 46 },
  { id: 'oil', label: 'Petroleum', pct: 0.4, twh: 19 },
  { id: 'geothermal', label: 'Geothermal', pct: 0.3, twh: 16 },
];

// Lazard LCOE+ v19.0 (July 2026), unsubsidized, $/MWh.
const LCOE_2026 = [
  { id: 'wind', label: 'Wind, onshore', lo: 37, hi: 99 },
  { id: 'solar', label: 'Solar, utility', lo: 40, hi: 98 },
  { id: 'gascc', label: 'Gas combined cycle', lo: 51, hi: 129 },
  { id: 'solarstorage', label: 'Solar + storage', lo: 61, hi: 156 },
  { id: 'geothermal', label: 'Geothermal', lo: 67, hi: 111 },
  { id: 'coal', label: 'Coal', lo: 72, hi: 177 },
  { id: 'offshore', label: 'Wind, offshore', lo: 105, hi: 167 },
  { id: 'peaker', label: 'Gas peaking', lo: 144, hi: 276 },
  { id: 'nuclear', label: 'Nuclear (new)', lo: 175, hi: 255 },
];

// Same report: marginal cost of running existing, fully depreciated plants.
const MARGINAL_EXISTING_2026 = [
  { id: 'nuclear', label: 'Nuclear', lo: 26, hi: 36 },
  { id: 'gascc', label: 'Gas combined cycle', lo: 32, hi: 51 },
  { id: 'coal', label: 'Coal', lo: 34, hi: 69 },
  { id: 'peaker', label: 'Gas peaking', lo: 52, hi: 122 },
];

// PJM Base Residual Auction, RTO clearing price, $/MW-day (PJM reports).
const PJM_BRA = [
  { year: '2024/25', price: 28.92 },
  { year: '2025/26', price: 269.92 },
  { year: '2026/27', price: 329.17, cap: true },
  { year: '2027/28', price: 333.44, cap: true },
  { year: '2028/29', price: 325.0, cap: true },
];

/* ----------------------------------------------------------------------------
 * Chart groups. Eight hues plus "Other"; the order is the stacking order
 * (bottom to top) and was chosen with the dataviz validator so that every
 * adjacent pair stays distinguishable under red-green colour blindness in
 * both themes. Colours themselves live in the page's CSS tokens.
 * ------------------------------------------------------------------------- */

const GROUPS = ['other', 'nuclear', 'coal', 'hydro', 'gascc', 'wind', 'solar', 'storage', 'peaker'];

const GROUP_LABEL = {
  other: 'Geothermal & biomass',
  nuclear: 'Nuclear',
  coal: 'Coal',
  hydro: 'Hydro',
  gascc: 'Gas, combined cycle',
  wind: 'Wind',
  solar: 'Solar',
  storage: 'Storage',
  peaker: 'Peakers (gas & oil)',
  dr: 'Demand response',
};

// Inertia constant H (seconds of rated output stored as spinning kinetic
// energy) by group. Inverter-based resources contribute none.
const H_GROUP = { other: 3.0, nuclear: 5.0, coal: 4.0, hydro: 3.0, gascc: 4.5, wind: 0, solar: 0, storage: 0, peaker: 3.0 };

// kg CO2 per MMBtu of fuel (EPA emission factors).
const EF = { gas: 53.06, coal: 95.0, oil: 73.96 };

/* ----------------------------------------------------------------------------
 * The fleet: about 1/8 of U.S. utility-scale capacity at the end of 2025.
 * ------------------------------------------------------------------------- */

const CAP = {
  wind: 19.0,
  solar: 25.0,          // utility-scale plus rooftop
  hydro: 9.6,
  storageP: 7.8,        // batteries 5.2 GW + pumped hydro 2.6 GW
  storageE: 46.8,       // GWh: 4-hour batteries + 10-hour pumped hydro
  storageRTE: 0.82,     // round-trip efficiency, blended
};

const REF_LOAD = 62;      // GW: the model's annual average demand
const FUEL = { gas: 3.52, coal: 2.4, oil: 16 };  // 2025 Henry Hub average gas

function buildFleet() {
  const u = [];
  const add = (o) => { o.id = u.length; u.push(o); };
  for (let i = 0; i < 10; i++) {
    add({ tech: 'nuclear', group: 'nuclear', name: `Nuclear unit ${i + 1}`, cap: 1.24, mustRun: 1, offer: -15 });
  }
  for (let i = 0; i < 20; i++) {
    add({ tech: 'coal', group: 'coal', name: `Coal unit ${i + 1}`, cap: 1.025, hr: 10.0 + 2.4 * i / 19, fuel: 'coal', vom: 7.0, mustRun: 0.25 });
  }
  for (let i = 0; i < 35; i++) {
    add({ tech: 'gascc', group: 'gascc', name: `Combined cycle ${i + 1}`, cap: 1.0, hr: 6.3 + 2.1 * i / 34, fuel: 'gas', vom: 2.0 + 3.0 * i / 34 });
  }
  // Peakers run a few hundred hours a year, so their offers carry start-up
  // costs spread over short runs (the `start` adder, $/MWh).
  for (let i = 0; i < 26; i++) {
    add({ tech: 'gasct', group: 'peaker', name: `Gas peaker ${i + 1}`, cap: 1.0, hr: 9.6 + 3.4 * i / 25, fuel: 'gas', vom: 5.0, start: 12 + 28 * i / 25, quick: true });
  }
  for (let i = 0; i < 4; i++) {
    add({ tech: 'oil', group: 'peaker', name: `Oil peaker ${i + 1}`, cap: 0.875, hr: 11.0 + 2.5 * i / 3, fuel: 'oil', vom: 6.0, start: 20, quick: true });
  }
  add({ tech: 'bio', group: 'other', name: 'Biomass', cap: 1.5, mustRun: 0.6, offer: 38 });
  add({ tech: 'geo', group: 'other', name: 'Geothermal', cap: 0.32, mustRun: 1, offer: 0 });
  return u;
}

const FLEET = buildFleet();

// A fixed shuffled order per technology, so "15% of the coal fleet is out"
// always takes the same units and grows smoothly as the fraction rises.
const OUT_ORDER = {};
(function () {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const u of FLEET) (OUT_ORDER[u.tech] = OUT_ORDER[u.tech] || []).push(u.id);
  for (const k in OUT_ORDER) {
    const a = OUT_ORDER[k];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  }
})();

// Baseline unavailability (planned maintenance plus forced outages).
const BASE_OUT = { nuclear: 0.06, coal: 0.1, gascc: 0.07, gasct: 0.06, oil: 0.1, bio: 0.1, geo: 0.05 };

/* ----------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------- */

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

// Smoothly step from v0 to v1 between hours h0 and h1.
function ramp(h, h0, h1, v0, v1) {
  if (h <= h0) return v0;
  if (h >= h1) return v1;
  return lerp(v0, v1, smooth((h - h0) / (h1 - h0)));
}

function interp24(arr, h) {
  const x = ((h % 24) + 24) % 24;
  const i = Math.floor(x);
  return lerp(arr[i], arr[(i + 1) % 24], x - i);
}

function tod(h) { return ((h % 24) + 24) % 24; }

function fmtClock(h) {
  const x = tod(h);
  let hh = Math.floor(x);
  let mm = Math.round((x - hh) * 60);
  if (mm === 60) { hh = (hh + 1) % 24; mm = 0; }
  const ap = hh < 12 ? 'a.m.' : 'p.m.';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}

/* ----------------------------------------------------------------------------
 * Weather and demand shapes
 * ------------------------------------------------------------------------- */

// Hourly demand as a fraction of the day's peak.
const SHAPE = {
  summer: [.70, .66, .63, .61, .60, .61, .64, .68, .72, .77, .82, .87, .91, .94, .97, .99, 1.00, 1.00, .98, .95, .91, .86, .80, .75],
  winter: [.78, .75, .73, .72, .73, .78, .88, .97, 1.00, .96, .91, .87, .84, .82, .81, .82, .86, .94, .99, .98, .95, .91, .86, .82],
  spring: [.74, .71, .69, .68, .69, .73, .80, .87, .91, .93, .94, .95, .95, .95, .95, .95, .96, .98, 1.00, .99, .96, .91, .85, .79],
  // A heat wave holds the evening up: houses stay hot after sunset.
  heat:   [.75, .71, .68, .66, .65, .66, .69, .72, .76, .80, .84, .88, .91, .94, .96, .98, .99, 1.00, 1.00, .99, .96, .91, .85, .80],
};

// Sunrise and sunset (local clock time) and clear-sky peak output of the
// solar fleet, a blend of tracking utility plants and fixed rooftops.
const SUN = {
  summer: { rise: 6.5, set: 20.5, peak: 0.8 },
  winter: { rise: 7.3, set: 17.9, peak: 0.66 },
  spring: { rise: 7.0, set: 20.0, peak: 0.82 },
};

function sunUp(season, h) {
  const s = SUN[season] || SUN.summer;
  const x = tod(h);
  if (x <= s.rise || x >= s.set) return 0;
  return Math.sin(Math.PI * (x - s.rise) / (s.set - s.rise));
}

function solarClearSky(season, h) {
  const s = SUN[season] || SUN.summer;
  const e = sunUp(season, h);
  return e <= 0 ? 0 : s.peak * Math.pow(e, 0.85);
}

/* ----------------------------------------------------------------------------
 * Scenarios. Each is a weather-and-events recipe over a sim-clock window.
 * Hours run past 24 for events that cross midnight; profiles take that hour.
 * `beats` are the captions the page shows as the clock passes them.
 * ------------------------------------------------------------------------- */

const windCos = (base, amp) => (h) => clamp(base + amp * Math.cos(2 * Math.PI * (tod(h) - 2) / 24), 0, 1);

const SCENARIOS = [
  {
    id: 'summer', name: 'Typical summer day', season: 'summer', peak: 92, start: 12, loop: true,
    cloud: 0.08, gas: FUEL.gas, hydroCF: 0.34, derate: 0.04, wind: windCos(0.32, 0.10),
    blurb: 'An ordinary hot weekday. Demand peaks in the late afternoon; gas fills whatever wind, solar, nuclear and hydro do not.',
  },
  {
    id: 'winter', name: 'Typical winter day', season: 'winter', peak: 80, start: 6, loop: true,
    cloud: 0.3, gas: 4.2, hydroCF: 0.36, wind: windCos(0.4, 0.06),
    blurb: 'Two peaks: one when people wake up and turn on the heat, one in the evening. The sun sets before the evening peak arrives.',
  },
  {
    id: 'spring', name: 'Spring: negative prices', season: 'spring', peak: 46, start: 0, loop: true,
    // Snowmelt keeps rivers high, so hydro can't hold much water back.
    cloud: 0, gas: 2.9, hydroCF: 0.55, hydroMin: 0.5, wind: windCos(0.5, 0.14),
    // A windy, sunny region (think SPP or CAISO): twice the model's wind,
    // 60% more solar.
    windScale: 2.0, solarScale: 1.6,
    maintenance: { nuclear: 0.1, coal: 0.2, gascc: 0.25 },
    blurb: 'Mild weather, low demand, strong wind at night and full sun at midday. Plants that cannot turn down keep running, and prices go below zero.',
    beats: [
      { at: 2, text: '2 a.m.: wind is strong and demand is near its daily low. Wind farms paid per megawatt-hour by the production tax credit keep generating even at negative prices, so the price falls to zero and, in the windiest hours, below it. The surplus is curtailed.', focus: 'wind' },
      { at: 12.5, text: 'Midday: solar floods in. Batteries charge on cheap (even negative) power, and the rest of the surplus is curtailed. Watch the price and the curtailment readout.', focus: 'solar' },
      { at: 19.5, text: 'Sunset: solar fades just as people come home. Batteries discharge what they stored at noon, flattening the evening ramp.', focus: 'battery' },
    ],
  },
  {
    id: 'heatwave', name: 'Heat wave (California, Aug 2020)', season: 'summer', peak: 103, shape: 'heat', start: 12, loop: true,
    cloud: 0, gas: 4.5, hydroCF: 0.28, wind: windCos(0.14, 0.05), derate: 0.05, storageScale: 0.15,
    toggle: { key: 'storageScale', label: 'Add today’s batteries', on: 1.25, off: 0.15 },
    blurb: 'A West-wide heat dome. Demand stays high after sunset, when solar is gone and neighbors have no power to spare.',
    beats: [
      { at: 15, text: 'Afternoon: record heat across the West. Solar is carrying the system, but every air conditioner is running and neighboring grids are hot too, so imports dry up.', focus: 'town' },
      { at: 18.25, text: 'Solar is fading but demand is not. This is the "net peak": demand minus wind and solar. In August 2020 California ran out of reserves here.', focus: 'solar' },
      { at: 18.75, text: 'Reserves exhausted: the operator declares a Stage 3 emergency and orders rotating outages. About 800,000 California customers lost power on August 14 and 15, 2020, the first rotating outages there since 2001.', focus: 'control', pause: true },
      { at: 20.5, text: 'Try it again with today’s batteries (the toggle above the story card). By the September 2022 heat wave California had added gigawatts of storage; it set a record peak without rotating outages.', focus: 'battery' },
    ],
  },
  {
    id: 'uri', name: 'Winter Storm Uri (Texas, Feb 2021)', season: 'winter', peak: 90, start: 18, end: 42, loop: false,
    dayLabel: (h) => (h < 24 ? 'Feb 14' : 'Feb 15'),
    cloud: 0.7, hydroCF: 0.3, priceCap: 9000, storageScale: 0.1,
    gas: (h) => ramp(h, 18, 30, 6, 150),
    wind: (h) => ramp(h, 18, 27, 0.3, 0.1),
    outages: (h) => ({
      gascc: ramp(h, 21, 26, 0.08, 0.55),
      gasct: ramp(h, 21, 26, 0.06, 0.5),
      coal: ramp(h, 21, 26, 0.03, 0.25),
      wind: ramp(h, 18, 27, 0.2, 0.55),
      solar: 0.5,
      nuclear: h >= 29.62 ? 0.11 : 0,
    }),
    weather: { snow: 1 },
    blurb: 'Arctic air froze wells, pipelines, instruments and turbines all at once, exactly when demand for heat hit a record.',
    beats: [
      { at: 18.1, text: 'Feb 14, 2021, evening. Arctic air covers Texas. ERCOT expects record winter demand, and the cold is already freezing wind turbines, gas wellheads and plant instruments.', focus: 'overview' },
      { at: 21, text: 'Gas production collapses as wellheads and gathering lines freeze. Gas plants lose fuel pressure or trip as their own equipment ices. Spot gas prices spike past $100/MMBtu.', focus: 'gascc' },
      { at: 25.3, text: '1:20 a.m., Feb 15: reserves are gone. ERCOT declares an emergency (EEA 3) and orders rotating outages. The grey houses are load being shed on purpose.', focus: 'town' },
      { at: 25.85, text: '1:51 a.m.: more generators trip and frequency plunges toward 59.3 Hz. Generator protection would disconnect plants if frequency stayed below 59.4 Hz for nine minutes, which would black out the whole state.', focus: 'overview', pause: true, freqEvent: 'uri' },
      { at: 29.62, text: '5:37 a.m.: a frozen pressure-sensing line trips South Texas Project Unit 1, a 1.3 GW nuclear reactor.', focus: 'nuclear' },
      { at: 31, text: 'Morning: up to 20,000 MW of demand is being shed. More than 4.5 million homes and businesses lose power, many for days, in sub-freezing cold. Prices sit at the $9,000/MWh cap.', focus: 'town', pause: true },
      { at: 34, text: 'Aftermath: FERC and NERC found 61,800 MW of generation was unavailable at the worst point, with freezing equipment the leading cause. Texas counted 246 deaths. ERCOT later cut its price cap to $5,000/MWh.', focus: 'overview' },
    ],
  },
  {
    id: 'eclipse', name: 'Solar eclipse (Apr 8, 2024)', season: 'spring', peak: 62, start: 10, loop: true,
    cloud: 0, gas: 1.8, hydroCF: 0.45, wind: windCos(0.3, 0.1),
    eclipse: { start: 12.33, max: 13.67, end: 15.0, depth: 0.88 },
    blurb: 'The moon blocked the sun across Texas in the early afternoon, taking a big chunk of solar output away for about an hour, on a schedule known centuries in advance.',
    beats: [
      { at: 12.4, text: '12:20 p.m.: the moon starts to cover the sun. Solar output starts sliding. Unlike a cloudy day, this ramp was forecast to the minute.', focus: 'solar' },
      { at: 13.67, text: '1:40 p.m.: totality over Dallas. ERCOT lost about 8.9 GW of solar output; gas plants added about 6.2 GW in the following hour while batteries and coal covered the rest.', focus: 'gascc', pause: true },
      { at: 14.6, text: 'The sun returns and solar ramps back up, faster than any thermal plant could. The gas that ramped up now ramps back down.', focus: 'solar' },
    ],
  },
  {
    id: 'hurricane', name: 'Hurricane (Beryl, Houston, Jul 2024)', season: 'summer', peak: 84, start: 0, end: 24, loop: false,
    cloud: (h) => ramp(h, 1, 4, 0.5, 0.9), gas: 2.4, hydroCF: 0.34,
    wind: (h) => (h < 3 ? 0.85 : h < 9 ? 0 : 0.45),
    damage: (h) => ramp(h, 3.5, 5.5, 0, 0.2),
    weather: { rain: (h) => ramp(h, 1, 3, 0.3, 1) * (h < 12 ? 1 : ramp(h, 12, 16, 1, 0.1)) },
    blurb: 'Generation was fine; delivery was not. Wind and falling trees broke the wires between the grid and the customers.',
    beats: [
      { at: 2.5, text: 'Hurricane Beryl approaches the Texas coast. Wind farms are spinning hard, right up until the wind passes their safety cut-out (about 25 m/s), when they feather their blades and stop.', focus: 'wind' },
      { at: 5, text: 'Landfall. Wind and falling trees snap distribution poles and lines. In Houston about 2.26 million CenterPoint customers lost power, out of roughly 2.8 million.', focus: 'town', pause: true },
      { at: 9, text: 'Notice the power plants are fine and prices are low: there is plenty of supply and nowhere to send it. Most customer outages start on the distribution system, not at the plants.', focus: 'distsub' },
      { at: 14, text: 'Restoration is pole-by-pole work. For Beryl it took more than a week for many customers, in July heat.', focus: 'town' },
    ],
  },
  {
    id: 'blackout2003', name: 'Northeast blackout (Aug 14, 2003)', season: 'summer', peak: 88, start: 12, end: 16.5, loop: false,
    cloud: 0.15, gas: 5.0, hydroCF: 0.34, wind: windCos(0.2, 0.05), cascade: true,
    blurb: 'A hot afternoon, a broken alarm system and three transmission lines sagging into overgrown trees. Seven minutes of cascading failures took out 61,800 MW of load.',
    beats: [
      { at: 12.25, text: '12:15 p.m.: MISO’s state estimator (the software that works out what the grid is doing) fails on bad input data. The regional overseer is partly blind for the afternoon.', focus: 'control' },
      { at: 13.52, text: '1:31 p.m.: Eastlake 5, a 597 MW coal unit near Cleveland, trips. Cleveland now needs more power from far away, over the 345 kV lines.', focus: 'coal' },
      { at: 14.23, text: '2:14 p.m.: FirstEnergy’s control-room alarm system fails, silently. Operators keep watching screens that no longer warn them of anything.', focus: 'control' },
      { at: 15.08, text: '3:05 p.m.: Harding-Chamberlin, a 345 kV line, sags into a tree and trips. Its flow shifts onto the remaining lines.', focus: 'line345', line: 0 },
      { at: 15.53, text: '3:32 p.m.: Hanna-Juniper sags into a tree and trips. The remaining lines are now overloaded and heating up, so they sag further.', focus: 'line345', line: 1 },
      { at: 15.68, text: '3:41 p.m.: Star-South Canton contacts a tree and trips. The 138 kV system underneath begins to collapse.', focus: 'line345', line: 2 },
      { at: 16.1, text: '4:05:57 p.m.: Sammis-Star trips on overload. That starts the uncontrollable cascade: in about seven minutes more than 508 generating units at 265 plants trip off.', focus: 'overview', pause: true, freqEvent: 'cascade' },
      { at: 16.3, text: '4:13 p.m.: 50 million people in eight states and Ontario are dark. Some areas waited four days for power. Next: how a dead grid is restarted.', focus: 'overview', next: { id: 'blackstart', label: 'Restart the grid \u2192' } },
    ],
  },
  {
    id: 'trip', name: 'Losing a big power plant', season: 'summer', peak: 84, start: 16.5, loop: true,
    cloud: 0.08, gas: FUEL.gas, hydroCF: 0.34, wind: windCos(0.3, 0.1),
    blurb: 'A nuclear unit trips without warning. Watch inertia, governors, then automatic generation control catch the frequency.',
    beats: [
      { at: 16.55, text: 'A 1.18 GW nuclear unit is about to trip. Open the Frequency topic to watch the response second by second: inertia first, then governors, then AGC.', focus: 'nuclear', pause: true, freqEvent: 'trip' },
    ],
  },
  {
    id: 'dcdrop', name: 'Data centers drop off (2024 & 2026)', season: 'summer', peak: 84, start: 19, loop: true,
    cloud: 0.05, gas: FUEL.gas, hydroCF: 0.34, wind: windCos(0.3, 0.1),
    blurb: 'A routine fault makes a cluster of data centers jump to backup power at once. The grid suddenly has gigawatts too much generation.',
    beats: [
      { at: 19.05, text: 'A lightning arrester fails on a 230 kV line. The fault clears normally in a fraction of a second, but about 1.5 GW of data centers sense the voltage dip and switch to their backup generators at once (Virginia, July 2024).', focus: 'datacenter', pause: true, freqEvent: 'dcdrop' },
    ],
  },
  {
    id: 'dc2030', name: 'Data-center boom (2030)', season: 'summer', peak: 86, start: 12, loop: true,
    cloud: 0.08, gas: 4.3, hydroCF: 0.34, wind: windCos(0.32, 0.1),
    extraLoad: 10, solarScale: 1.6, windScale: 1.1, storageScale: 2.2, coalScale: 0.7,
    blurb: 'Ten gigawatts of always-on data-center load arrive, along with more solar and batteries and fewer coal plants.',
    beats: [
      { at: 12.2, text: 'Data centers run flat out around the clock, so they raise the overnight floor as much as the peak. Compare reserves and evening prices with the typical summer day.', focus: 'datacenter' },
      { at: 19.5, text: 'The tightest hour is now after sunset: solar is gone, the data centers are not. That is where new capacity (and capacity-market prices) matters most.', focus: 'battery' },
    ],
  },
  {
    id: 'blackstart', name: 'Black start: restarting a dark grid', season: 'summer', peak: 70, start: 16.3, loop: false, special: 'blackstart',
    cloud: 0.1, gas: FUEL.gas, hydroCF: 0.34, wind: windCos(0.25, 0.08),
    blurb: 'The grid is dead. A few special plants can start without outside power; everything else is rebuilt from them, one island at a time.',
  },
];

const SCENARIO = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

const val = (v, h, dflt) => (typeof v === 'function' ? v(h) : v === undefined ? dflt : v);

/* ----------------------------------------------------------------------------
 * Inputs at an instant: demand, wind, solar, outages, fuel prices.
 * `knobs` are the user's controls; `live` holds trips and other events.
 * ------------------------------------------------------------------------- */

const DEFAULT_KNOBS = { demand: 1, gas: null, wind: 1, cloud: null, storage: true, ffr: true };

function inputsAt(scn, h, knobs = DEFAULT_KNOBS, live = {}) {
  const shape = SHAPE[scn.shape || scn.season] || SHAPE.summer;
  let load = scn.peak * interp24(shape, h) * knobs.demand;
  load += val(scn.extraLoad, h, 0) + (live.extraLoad || 0);

  // Customers cut off by storm damage are load the grid can't serve.
  const damage = val(scn.damage, h, 0);

  const cloud = knobs.cloud === null || knobs.cloud === undefined ? val(scn.cloud, h, 0) : knobs.cloud;
  let solarCF = solarClearSky(scn.season, h) * (1 - 0.78 * cloud);
  if (scn.eclipse) solarCF *= 1 - eclipseFraction(scn.eclipse, h);

  const out = Object.assign({}, val(scn.outages, h, {}));
  const windCF = clamp(val(scn.wind, h, 0.3), 0, 1);
  const wind = CAP.wind * (scn.windScale || 1) * windCF * knobs.wind * (1 - (out.wind || 0));
  const solar = CAP.solar * (scn.solarScale || 1) * solarCF * (1 - (out.solar || 0));

  const gas = knobs.gas === null || knobs.gas === undefined ? val(scn.gas, h, FUEL.gas) : knobs.gas;

  return {
    h, load: load * (1 - damage), damage, rawLoad: load,
    wind, windCF: windCF * knobs.wind, solar, solarCF, cloud,
    gas, coal: FUEL.coal, oil: FUEL.oil,
    out, derate: scn.derate || 0, maintenance: scn.maintenance || {},
    coalScale: scn.coalScale || 1,
    priceCap: scn.priceCap || 5000,
  };
}

function eclipseFraction(e, h) {
  if (h <= e.start || h >= e.end) return 0;
  const x = h < e.max ? (h - e.start) / (e.max - e.start) : (e.end - h) / (e.end - e.max);
  return e.depth * Math.pow(clamp(x, 0, 1), 1.6);
}

// How much of each thermal unit is available, after baseline outages,
// scenario outages, maintenance season, heat derates and user trips.
function unitAvailability(inp, live = {}) {
  const avail = new Float64Array(FLEET.length);
  const byTech = {};
  for (const u of FLEET) (byTech[u.tech] = byTech[u.tech] || []).push(u);
  for (const tech in byTech) {
    const frac = clamp((BASE_OUT[tech] || 0) + (inp.maintenance[tech] || 0) + (inp.out[tech] || 0), 0, 1);
    const ord = OUT_ORDER[tech];
    let outGW = frac * byTech[tech].reduce((s, u) => s + u.cap, 0);
    for (const id of ord) {
      const u = FLEET[id];
      const take = Math.min(u.cap, outGW);
      outGW -= take;
      let a = u.cap - take;
      if (tech === 'coal' && inp.coalScale < 1) a *= inp.coalScale;
      if (tech !== 'nuclear') a *= 1 - inp.derate;
      avail[id] = a;
    }
  }
  if (live.tripped) for (const id of live.tripped) avail[id] = 0;
  return avail;
}

/* ----------------------------------------------------------------------------
 * Losses: transmission and distribution copper losses grow with the square
 * of the current; transformer core losses are roughly constant. Tuned to the
 * EIA's ~5% average at average load.
 * ------------------------------------------------------------------------- */

function losses(load) {
  const r = load / REF_LOAD;
  const trans = 0.020 * load * r;
  const dist = 0.008 * REF_LOAD + 0.022 * load * r;
  return { trans, dist, total: trans + dist, pct: (trans + dist) / (load + trans + dist), marginal: 0.084 * r };
}

/* ----------------------------------------------------------------------------
 * Market clearing: a uniform-price auction over the supply stack.
 * ------------------------------------------------------------------------- */

const DR_BLOCKS = [
  { price: 300, cap: 0.8, name: 'Demand response (large industry)' },
  { price: 1000, cap: 1.0, name: 'Demand response (commercial)' },
  { price: 3000, cap: 1.2, name: 'Demand response (emergency)' },
];

function offerOf(u, inp) {
  if (u.offer !== undefined) return u.offer;
  return u.hr * inp[u.fuel] + u.vom + (u.start || 0);
}

/*
 * sched: { hydro, storage } for this instant, from the day plan (storage > 0
 *        discharges, < 0 charges).
 * Returns dispatch by group, the stack of offers, price, marginal unit,
 * reserves, curtailment, shed load, CO2 and the grid's alert level.
 */
function clear(inp, sched, avail, opts = {}) {
  const storageCharge = Math.max(0, -sched.storage);
  const storageDis = Math.max(0, sched.storage);
  const shedFixed = opts.shedFixed || 0;              // load already off (UFLS, storm damage handled in inp)
  const custLoad = Math.max(0, inp.load - shedFixed);
  const loss = losses(custLoad);
  const need = custLoad + loss.total + storageCharge;

  const blocks = [];
  const mustRun = [];
  let mustRunGW = 0;
  for (const u of FLEET) {
    const a = avail[u.id];
    if (a <= 0) continue;
    const offer = offerOf(u, inp);
    const mr = (u.mustRun || 0) * a;
    if (mr > 0) {
      mustRun.push({ unit: u, group: u.group, name: u.name, cap: mr, price: offer, mustRun: true });
      mustRunGW += mr;
    }
    if (a - mr > 1e-9) blocks.push({ unit: u, group: u.group, name: u.name, cap: a - mr, price: offer });
  }
  if (sched.hydro > 0) { mustRun.push({ group: 'hydro', name: 'Hydro (scheduled)', cap: sched.hydro, price: 0, mustRun: true }); mustRunGW += sched.hydro; }
  if (storageDis > 0) { mustRun.push({ group: 'storage', name: 'Storage discharging', cap: storageDis, price: 0, mustRun: true }); mustRunGW += storageDis; }

  // Wind earning the production tax credit (paid per MWh generated) will pay
  // up to roughly the credit to keep running; the rest of wind and all of
  // solar bid near zero.
  if (inp.wind > 0) {
    blocks.push({ group: 'wind', name: 'Wind (tax credit)', cap: inp.wind * 0.7, price: -25, renewable: true });
    blocks.push({ group: 'wind', name: 'Wind (no credit)', cap: inp.wind * 0.3, price: 0, renewable: true });
  }
  if (inp.solar > 0) blocks.push({ group: 'solar', name: 'Solar', cap: inp.solar, price: -5, renewable: true });
  if (opts.dr !== false) for (const b of DR_BLOCKS) blocks.push({ group: 'dr', name: b.name, cap: b.cap, price: b.price, dr: true });
  blocks.sort((a, b) => a.price - b.price);

  let residual = need - mustRunGW;
  let price, marginal = null, shed = 0, overgen = 0;
  for (const b of blocks) b.out = 0;
  if (residual <= 0) {
    overgen = -residual;
    price = -100;
    marginal = { name: 'Must-run units (over-generation)', group: 'nuclear', price: -100 };
  } else {
    let left = residual;
    for (const b of blocks) {
      if (left <= 1e-9) break;
      const take = Math.min(b.cap, left);
      b.out = take;
      left -= take;
      marginal = b;
    }
    if (left > 1e-9) {
      shed = left;
      price = inp.priceCap;
      marginal = { name: 'Not enough supply: load shed', group: 'shed', price: inp.priceCap };
    } else {
      price = marginal.price;
    }
  }

  // Reserves: what could be delivered within about 30 minutes -- headroom on
  // units already running, plus quick-start peakers sitting idle. A cold
  // combined-cycle or coal unit takes hours to start, so it doesn't count.
  let reserves = 0;
  for (const b of blocks) {
    if (b.dr || b.renewable) continue;
    const u = b.unit;
    if (!u || u.tech === 'nuclear') continue;
    const running = b.out > 0 || (u.mustRun && avail[u.id] > 0);
    if (running || u.quick) reserves += b.cap - b.out;
  }
  const hydroAvail = CAP.hydro * (1 - (inp.out.hydro || 0));
  reserves += Math.max(0, hydroAvail - sched.hydro) * 0.8;
  const storP = opts.storageP === undefined ? CAP.storageP : opts.storageP;
  reserves += Math.max(0, storP - storageDis) * (opts.storageSOC === undefined ? 1 : clamp(opts.storageSOC * 4, 0, 1));
  if (shed > 0) reserves = 0;

  const resPct = reserves / Math.max(1, custLoad);
  // Scarcity adder (like ERCOT's operating reserve demand curve): as reserves
  // thin out, the price climbs toward the cap even before anyone is shed.
  let adder = 0;
  if (shed <= 0 && resPct < 0.10) adder = inp.priceCap * Math.pow((0.10 - resPct) / 0.07, 3);
  if (shed <= 0) price = Math.min(inp.priceCap, Math.max(price, -100) + (price >= 0 ? adder : 0));

  // Dispatch by group
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  byGroup.dr = 0;
  for (const m of mustRun) byGroup[m.group] += m.cap;
  for (const b of blocks) byGroup[b.group] += b.out;
  if (overgen > 0) {
    // Must-run exceeds demand: the surplus is spilled or backed down.
    const scale = need / mustRunGW;
    for (const g of GROUPS) byGroup[g] *= scale;
  }
  const curtail = (inp.wind + inp.solar) - (byGroup.wind + byGroup.solar);

  let co2 = 0; // tonnes per hour
  for (const b of blocks.concat(mustRun)) {
    const u = b.unit;
    const out = b.mustRun ? b.cap : b.out;
    if (!u || !u.fuel || out <= 0) continue;
    co2 += out * 1000 * u.hr * EF[u.fuel] / 1000; // GW -> MW, MMBtu/MWh, kg/MMBtu -> t
  }
  const genTotal = GROUPS.reduce((s, g) => s + byGroup[g], 0) + byGroup.dr;

  let level = 0; // 0 normal, 1 tight, 2 EEA1, 3 EEA2, 4 EEA3/shedding
  if (shed > 0.01) level = 4;
  else if (resPct < 0.03) level = 4;
  else if (resPct < 0.05) level = 3;
  else if (resPct < 0.07) level = 2;
  else if (resPct < 0.10) level = 1;

  return {
    load: custLoad, need, loss, byGroup, blocks, mustRun, price, marginal, reserves, resPct,
    curtail: Math.max(0, curtail), shed, overgen, co2, co2Rate: genTotal > 0 ? co2 / (genTotal * 1000) * 1000 : 0,
    level, gen: genTotal, adder,
  };
}

/* ----------------------------------------------------------------------------
 * A day plan: 96 quarter-hours of demand, renewables, and the hydro and
 * storage schedules that operators would set the day before.
 * ------------------------------------------------------------------------- */

const STEPS = 96;

function planDay(scn, knobs = DEFAULT_KNOBS, live = {}) {
  const t0 = scn.loop ? 0 : Math.floor(scn.start);
  const ts = [], inps = [], avails = [], firm = [];
  for (let k = 0; k < STEPS; k++) {
    const h = t0 + k / 4;
    const inp = inputsAt(scn, h, knobs, live);
    const avail = unitAvailability(inp, live);
    let mr = 0;
    for (const u of FLEET) mr += (u.mustRun || 0) * avail[u.id];
    ts.push(h); inps.push(inp); avails.push(avail);
    firm.push(inp.load + losses(inp.load).total - inp.wind - inp.solar - mr);
  }

  // Hydro: spend the day's water where net demand is highest.
  // Hydro can't go to zero (river flows, fish) or quite to nameplate (head,
  // maintenance).
  const hydroAvail = (k) => 0.85 * CAP.hydro * (1 - (inps[k].out.hydro || 0));
  const hMin = (scn.hydroMin || 0.22) * CAP.hydro;
  const budget = (scn.hydroCF || 0.34) * CAP.hydro * 24;
  const hydroAt = (th) => firm.map((nl, k) => clamp(nl - th, hMin, hydroAvail(k)));
  const hydro = hydroAt(bisect((th) => hydroAt(th).reduce((s, x) => s + x / 4, 0) - budget, -200, 200, true));

  // Storage buys low and sells high: repeatedly pair the priciest
  // quarter-hour (discharge) with the cheapest (charge) while the spread still
  // beats the round-trip loss plus a little wear, re-clearing both as it goes
  // so its own trading flattens the prices it sees.
  const sScale = (scn.storageScale || 1) * (knobs.storage === false ? 0 : 1) * (live.storageScale === undefined ? 1 : live.storageScale);
  const P = CAP.storageP * sScale, E = CAP.storageE * sScale, rte = CAP.storageRTE;
  const storage = new Array(STEPS).fill(0);
  const res = inps.map((inp, k) => clear(inp, { hydro: hydro[k], storage: 0 }, avails[k], { storageP: P }));
  if (P > 0.01) {
    const chunk = P / 4;
    const noCharge = new Array(STEPS).fill(false);
    let budget = 0.8 * E;
    for (let iter = 0; iter < 300 && budget > 1e-6; iter++) {
      let kd = -1, kc = -1;
      for (let k = 0; k < STEPS; k++) {
        if (storage[k] >= 0 && storage[k] + chunk <= P + 1e-9 && (kd < 0 || res[k].price > res[kd].price)) kd = k;
        if (!noCharge[k] && storage[k] <= 0 && -storage[k] + chunk / rte <= P + 1e-9 && (kc < 0 || res[k].price < res[kc].price)) kc = k;
      }
      if (kd < 0 || kc < 0 || kd === kc) break;
      if (res[kd].price - res[kc].price / rte < 4) break;
      const e = Math.min(chunk, budget * 4);
      const trial = clear(inps[kc], { hydro: hydro[kc], storage: storage[kc] - e / rte }, avails[kc], { storageP: P });
      // Never charge with power that isn't there: that would shed customers.
      if (trial.shed > 0 || trial.level >= 3) { noCharge[kc] = true; continue; }
      storage[kd] += e;
      storage[kc] -= e / rte;
      budget -= e / 4;
      res[kd] = clear(inps[kd], { hydro: hydro[kd], storage: storage[kd] }, avails[kd], { storageP: P });
      res[kc] = trial;
    }
  }
  // State of charge through the day, shifted so it never goes below empty.
  const soc = [];
  let s = 0, smin = 0;
  for (let k = 0; k < STEPS; k++) {
    soc.push(s);
    s += (storage[k] < 0 ? -storage[k] * rte : -storage[k]) / 4;
    smin = Math.min(smin, s);
  }
  const socFrac = soc.map((x) => (E > 0 ? clamp((x - smin) / E, 0, 1) : 0));

  const results = [];
  for (let k = 0; k < STEPS; k++) {
    results.push(clear(inps[k], { hydro: hydro[k], storage: storage[k] }, avails[k], { storageP: P, storageSOC: socFrac[k] }));
  }
  return { t0, ts, inps, hydro, storage, soc: socFrac, results, storageP: P, storageE: E };
}

// Find x where f(x) = 0 for a monotonic f. `decreasing` says which way f goes.
function bisect(f, lo, hi, decreasing) {
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = f(mid);
    if ((v > 0) === decreasing) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function planIndex(plan, h) {
  const x = (h - plan.t0) * 4;
  return clamp(x, 0, STEPS - 1.0001);
}

function planSample(plan, arr, h) {
  const x = planIndex(plan, h);
  const i = Math.floor(x);
  return lerp(arr[i], arr[Math.min(STEPS - 1, i + 1)], x - i);
}

/* ----------------------------------------------------------------------------
 * Frequency dynamics: the aggregate swing equation with load damping,
 * governor droop, battery fast-frequency response, AGC, economic
 * re-dispatch, and under-frequency load shedding.
 * ------------------------------------------------------------------------- */

// Under-frequency load shedding stages (ERCOT's: 5% at 59.3 Hz, 10% more at
// 58.9 Hz, 10% more at 58.5 Hz).
const UFLS = [{ hz: 59.3, frac: 0.05 }, { hz: 58.9, frac: 0.10 }, { hz: 58.5, frac: 0.10 }];

function inertiaOf(res) {
  // Online synchronous machines run part-loaded; ~0.85 converts output to rating.
  let E = 0, S = 0, gov = 0;
  for (const g of GROUPS) {
    const mva = res.byGroup[g] / 0.85;
    E += H_GROUP[g] * mva;
    if (H_GROUP[g] > 0) S += mva;
    if (g === 'coal' || g === 'gascc' || g === 'peaker' || g === 'hydro') gov += mva;
  }
  return { E, S, gov: 0.3 * gov };
}

class Dynamics {
  constructor() { this.reset(); }

  reset() {
    this.df = 0;       // frequency deviation, Hz
    this.g = 0;        // governor response, GW
    this.a = 0;        // AGC response, GW
    this.e = 0;        // economic re-dispatch, GW
    this.ffr = 0;      // battery fast frequency response, GW
    this.d = 0;        // disturbance: + lost generation or added load, GW
    this.ufls = 0;     // load shed by UFLS relays, GW
    this.stage = 0;
    this.collapsed = false;
    this.t = 0;
    this.trace = [];
    this.nadir = 0;
    this.peak = 0;
    this.rocof = 0;
    this.lowTime = 0;  // seconds spent below 59.4 Hz
    this.script = null;
    this.scriptSpeed = 1;
    this.scriptLow = 0;
    this.last = null;
  }

  disturb(gw) {
    this.d += gw;
    this.nadir = this.df;
    this.peak = this.df;
    this.eventAt = this.t;
  }

  // p: { load, E, gov, up, down, ffrGW, ffrOn }
  step(dt, p) {
    const n = Math.max(1, Math.ceil(dt / 0.01));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.t += h;
      if (this.collapsed) continue;
      if (this.script) {
        this.df = this.script(this.t) - F0;
        // Replays run compressed; count time below 59.4 Hz in event time.
        if (F0 + this.df < 59.4) this.scriptLow += h * this.scriptSpeed;
        continue;
      }
      const M = Math.max(0.5, 2 * p.E / F0);
      const Dl = 1.5 * p.load / F0;
      const Kg = p.gov / (0.05 * F0);
      const db = 0.036;
      const dfe = Math.abs(this.df) > db ? this.df - Math.sign(this.df) * db : 0;

      const gT = clamp(-Kg * dfe, -p.down, Math.max(0, p.up));
      this.g += (gT - this.g) * Math.min(1, h / 5.0);

      // Batteries on fast frequency response trigger at 59.85 Hz, go to full
      // output within a quarter second, hold, then hand back to AGC slowly.
      if (p.ffrOn && this.df < -0.15 && this.ffrHold <= 0) this.ffrHold = 10;
      this.ffrHold = (this.ffrHold || 0) - h;
      const ffrT = p.ffrOn && this.ffrHold > 0 ? p.ffrGW : 0;
      this.ffr += (ffrT - this.ffr) * Math.min(1, h / (ffrT > this.ffr ? 0.25 : 8));

      // AGC works on area control error with a frequency bias of 1% of load
      // per 0.1 Hz (NERC's floor), integrated over a few seconds.
      const bias = 0.1 * p.load;
      this.a += (-bias * this.df / 12) * h;
      this.a = clamp(this.a, -p.down, Math.max(0, p.up - Math.max(0, this.g)));
      const handoff = this.a * h / 30;
      this.e += handoff;
      this.a -= handoff;

      const dP = this.g + this.a + this.e + this.ffr - (this.d - this.ufls) - Dl * this.df;
      const dfdt = dP / M;
      this.df += dfdt * h;
      this.rocof = dfdt;

      const f = F0 + this.df;
      for (let s = this.stage; s < UFLS.length; s++) {
        if (f < UFLS[s].hz) { this.ufls += UFLS[s].frac * p.load; this.stage = s + 1; }
      }
      this.lowTime = f < 59.4 ? this.lowTime + h : 0;
      if (f < 57.5 || f > 62.5 || this.lowTime > 540) this.collapsed = true;
      this.nadir = Math.min(this.nadir, this.df);
      this.peak = Math.max(this.peak, this.df);
    }
    // Once AGC and re-dispatch have taken over the whole disturbance, fold it
    // into the new normal so the next event starts clean.
    const left = this.d - this.ufls - this.e;
    if (!this.script && Math.abs(left) < 0.004 && Math.abs(this.a) < 0.004 && Math.abs(this.g) < 0.004 && Math.abs(this.ffr) < 0.004 && Math.abs(this.df) < 0.002) {
      this.d = 0; this.e = 0; this.a = 0; this.g = 0; this.ffr = 0; this.ufls = 0;
      if (this.stage > 0) this.stage = 0;
    }
    this.trace.push({ t: this.t, f: this.collapsed ? null : F0 + this.df });
    while (this.trace.length && this.trace[0].t < this.t - 90) this.trace.shift();
  }

  get hz() { return this.collapsed ? null : F0 + this.df; }
}

/* ----------------------------------------------------------------------------
 * Scripted frequency traces for replays, from published event records.
 * ------------------------------------------------------------------------- */

function frequencyScript(kind, t0, speed = 1) {
  const pts = {
    // ERCOT, Feb 15 2021: dipped to 59.302 Hz and stayed below 59.4 Hz for
    // about four and a half minutes until manual load shed recovered it.
    uri: [[0, 60.0], [3, 59.82], [8, 59.58], [14, 59.45], [22, 59.38], [30, 59.302], [40, 59.33], [60, 59.36], [85, 59.38], [120, 59.39], [150, 59.39], [180, 59.42], [200, 59.6], [215, 59.75], [230, 59.92], [245, 60.1], [265, 60.03], [290, 60.0]],
    // Cascade: swings as islands separate, then collapse.
    cascade: [[0, 60.0], [2, 59.9], [4, 60.25], [6, 59.6], [8, 60.4], [10, 59.2], [12, 59.6], [14, 58.7], [16, 58.1], [17, 57.4]],
  }[kind];
  return (t) => {
    const x = (t - t0) * speed;
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [xa, ya] = pts[i - 1], [xb, yb] = pts[i];
        return lerp(ya, yb, smooth((x - xa) / (xb - xa)));
      }
    }
    return pts[pts.length - 1][1];
  };
}

return {
  F0, US_SHARES_2025, LCOE_2026, MARGINAL_EXISTING_2026, PJM_BRA, GROUPS,
  GROUP_LABEL, CAP, REF_LOAD, FUEL, buildFleet, FLEET,
  clamp, ramp, tod, fmtClock, SUN, sunUp,
  SCENARIOS, SCENARIO, DEFAULT_KNOBS, inputsAt, eclipseFraction, unitAvailability,
  losses, offerOf, clear, STEPS, planDay, planIndex,
  planSample, UFLS, inertiaOf, Dynamics, frequencyScript,
};
});
