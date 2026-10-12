/*
 * knowledge/powergrid.html: wires the model (sim.js), the 3D diorama
 * (scene.js), the charts and calculators (widgets.js) and the explainer shell
 * (js/explainer.js) together, and runs the clock.
 *
 * Everything is a classic script, so the page works opened straight from disk.
 * three.js and the scene load only once WebGL is known to work; until then,
 * and if anything fails, the page stays a readable article.
 */
(function (PG) {
'use strict';
const { init: initExplainer, cssVar, onThemeChange } = window.Explainer;
const sim = PG.sim;
const W = PG.widgets;

const $ = (sel, root = document) => root.querySelector(sel);
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const fmtPrice = (p) => (p <= -0.5 ? '−$' + Math.abs(p).toFixed(0) : p >= 1000 ? '$' + Math.round(p).toLocaleString() : '$' + p.toFixed(0));

// Facility -> the topic it opens.
const TOPIC_OF = {
  nuclear: 'nuclear', coal: 'coal', gascc: 'gas', peaker: 'peakers', hydro: 'hydro', geo: 'geothermal',
  wind: 'wind', solar: 'solar', battery: 'storage', hub: 'substations', control: 'operators',
  distsub: 'distribution', town: 'outlet', city: 'distribution', factory: 'market', datacenter: 'datacenters',
  hvdc: 'hvdc', neighbor: 'interconnections', pole: 'distribution', gsu: 'stepup', line345: 'transmission',
};

const STATUS = ['Normal', 'Tight: conservation appeal', 'Emergency (EEA 1)', 'Emergency (EEA 2)', 'Rotating outages (EEA 3)', 'Blackout'];

const SPEEDS = [0, 1 / 10, 1 / 3, 1];   // sim hours per real second

// Thermal capacity by chart group, from the fleet itself.
const GROUP_CAP = {};
for (const u of sim.FLEET) GROUP_CAP[u.group] = (GROUP_CAP[u.group] || 0) + u.cap;
const GEO_CAP = sim.FLEET.find((u) => u.tech === 'geo').cap;

/* ----------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */

const S = {
  scn: sim.SCENARIO.summer,
  knobs: Object.assign({}, sim.DEFAULT_KNOBS),
  hour: 12,
  speedIdx: 2,
  playing: true,
  plan: null,
  live: { tripped: [], extraLoad: 0, storageScale: undefined },
  res: null,
  dyn: new sim.Dynamics(),
  manualShed: 0,
  beatIdx: 0,
  blackout: false,
  energized: null,         // Set during black start / blackout; null = normal
  townRestored: 1,
  lineState: {},
  dcBackupUntil: 0,
  peakerSync: null,        // set by the synchronization widget
  islandHz: null,          // set by the black-start widget
  voltageMode: false,
  voltAuto: false,         // voltage colouring switched on by a topic, not the user
  labels: true,
  flows: true,
  view: null,
};

/* ----------------------------------------------------------------------------
 * Model plumbing
 * ------------------------------------------------------------------------- */

function replan() {
  S.plan = sim.planDay(S.scn, S.knobs, S.live);
  S.res = liveResult();
  W.emit('plan', S.plan);
}

let replanTimer = 0;
function replanSoon() {
  clearTimeout(replanTimer);
  replanTimer = setTimeout(replan, 90);
}

function liveResult() {
  const h = S.hour;
  const inp = sim.inputsAt(S.scn, h, S.knobs, S.live);
  const avail = sim.unitAvailability(inp, S.live);
  const plan = S.plan;
  const hydro = sim.planSample(plan, plan.hydro, h);
  const storage = sim.planSample(plan, plan.storage, h);
  const soc = sim.planSample(plan, plan.soc, h);
  const res = sim.clear(inp, { hydro, storage }, avail, { storageP: plan.storageP, storageSOC: soc, shedFixed: S.dyn.ufls + S.manualShed });
  res.inp = inp;
  res.soc = soc;
  res.storageNow = storage;
  res.avail = avail;
  return res;
}

function scenarioHourRange() {
  const s = S.scn;
  if (s.loop) return [0, 24];
  return [s.start, s.end || s.start + 24];
}

function setScenario(id, { keepTime = false, fromWidget = false } = {}) {
  const scn = sim.SCENARIO[id];
  if (!scn) return;
  S.scn = scn;
  S.live = { tripped: [], extraLoad: 0, storageScale: undefined };
  S.dyn.reset();
  S.manualShed = 0;
  S.blackout = false;
  S.energized = null;
  S.townRestored = 1;
  S.lineState = {};
  S.dcBackupUntil = 0;
  S.beatIdx = 0;
  if (!keepTime) S.hour = scn.start;
  S.knobs.gas = null;
  S.knobs.cloud = null;
  syncKnobInputs();
  hideStory();
  replan();
  $('#k-scenario').value = id;
  if (scn.special === 'blackstart') {
    startBlackout();
    S.playing = false;
    if (!fromWidget) W.emit('blackstart', { step: 0 });
    // The topic's widget can be what switched us here; don't reopen it.
    if (EXP && EXP.current !== 'blackstart') EXP.open('blackstart');
  } else {
    S.playing = true;
  }
  S.speedIdx = scn.loop ? 2 : 1;
  updatePlayButtons();
  if (scn.beats && scn.beats.length) skipPastBeats();
  if (scn.toggle) showStory({ text: scn.blurb, head: scn.name, toggle: scn.toggle });
  else if (!scn.loop || scn.beats) showStory({ text: scn.blurb, head: scn.name });
}

function skipPastBeats() {
  const beats = S.scn.beats || [];
  S.beatIdx = 0;
  while (S.beatIdx < beats.length && beats[S.beatIdx].at < S.hour - 1e-6) S.beatIdx++;
}

/* ----------------------------------------------------------------------------
 * Events: trips, load steps, scripted replays, blackout and black start
 * ------------------------------------------------------------------------- */

const ACT = {
  trip(tech = 'nuclear') {
    const res = S.res;
    const unit = sim.FLEET.find((u) => u.tech === tech && res.avail[u.id] > 0.1 && !S.live.tripped.includes(u.id));
    if (!unit) return null;
    const mw = res.avail[unit.id];
    S.live.tripped.push(unit.id);
    S.dyn.disturb(mw);
    replan();
    return { name: unit.name, gw: mw };
  },
  loadStep(gw) {
    S.live.extraLoad += gw;
    S.dyn.disturb(gw);
    replan();
  },
  dataCenterDrop(gw = 1.5) {
    S.live.extraLoad -= gw;
    S.dyn.disturb(-gw);
    S.dcBackupUntil = performance.now() + 25000;
    replan();
  },
  restore() {
    S.live = { tripped: [], extraLoad: 0, storageScale: S.live.storageScale };
    S.dyn.reset();
    S.manualShed = 0;
    replan();
  },
  setFFR(on) { S.knobs.ffr = on; },
  setDemand(mult) { S.knobs.demand = sim.clamp(mult, 0.4, 1.7); syncKnobInputs(); replanSoon(); },
  setHour(h) {
    const [a, b] = scenarioHourRange();
    S.hour = sim.clamp(h, a, b - 0.01);
    skipPastBeats();
    syncKnobInputs();
  },
  replan() { replanSoon(); },
  peakerSync(st) { S.peakerSync = st; },
  setVoltageMode(on) {
    S.voltageMode = on;
    $('#tg-volt').setAttribute('aria-pressed', String(on));
    $('#volt-legend').hidden = !on;
    positionStory();
  },
  blackStartStep(n) { applyBlackStart(n); },
};

function startBlackout() {
  S.blackout = true;
  S.energized = new Set();
  S.townRestored = 0;
  S.dyn.collapsed = true;
}

// Black start: each step energizes more of the system. The widget in the
// Black start topic drives this and draws the island's frequency.
const BS_ENERGIZED = [
  [],
  ['hydroUnit'],
  ['hydro'],
  ['hydro', 'coal'],
  ['hydro', 'coal', 'subA'],
  ['hydro', 'coal', 'subA', 'gas', 'peak', 'subB', 'geo'],
  ['hydro', 'coal', 'subA', 'gas', 'peak', 'subB', 'geo', 'tie', 'dc', 'fact', 'dcen', 'wind', 'solar', 'batt'],
  null,
];

function applyBlackStart(n) {
  if (S.scn.id !== 'blackstart') setScenario('blackstart', { fromWidget: true });
  const set = BS_ENERGIZED[n];
  if (set === null) {
    S.blackout = false;
    S.energized = null;
    S.townRestored = 1;
    S.dyn.reset();
    S.playing = true;
    updatePlayButtons();
    return;
  }
  S.energized = new Set(set);
  S.townRestored = n >= 4 ? (n === 4 ? 0.5 : 1) : 0;
  S.blackout = true;
}

/* ----------------------------------------------------------------------------
 * The view handed to the scene each frame
 * ------------------------------------------------------------------------- */

function sunState(h, season) {
  const { rise, set } = sim.SUN[season] || sim.SUN.summer;
  const x = sim.tod(h);
  let up, az;
  if (x > rise && x < set) {
    const f = (x - rise) / (set - rise);
    up = Math.sin(Math.PI * f);
    az = Math.PI * f;
  } else {
    const len = 24 - (set - rise);
    const f = ((x - set + 24) % 24) / len;
    up = -Math.sin(Math.PI * f);
    az = Math.PI + Math.PI * f;
  }
  return { sunUp: up, sunElev: Math.max(0, up), sunAz: az };
}

function buildView() {
  const res = S.res;
  const scn = S.scn;
  const h = S.hour;
  const g = res.byGroup;
  const cap = Object.assign({}, GROUP_CAP, { hydro: sim.CAP.hydro, wind: sim.CAP.wind * (scn.windScale || 1), solar: sim.CAP.solar * (scn.solarScale || 1), storage: Math.max(0.5, S.plan.storageP) });
  const off = S.blackout;
  const out = {};
  for (const k of sim.GROUPS) out[k] = off ? 0 : g[k];
  out.storage = off ? 0 : res.storageNow;

  const plume = {};
  for (const k of ['nuclear', 'coal', 'gascc', 'hydro', 'other']) plume[k] = off ? 0 : Math.min(1, out[k] / cap[k]);
  plume.factory = off ? 0 : 0.6;
  plume.neighborGen = 0.7;
  plume.dcBackup = performance.now() < S.dcBackupUntil ? 1 : 0;
  let peakerUnits = Math.ceil(Math.min(3, (out.peaker / cap.peaker) * 6));
  if (S.peakerSync) peakerUnits = Math.max(peakerUnits, S.peakerSync.running ? 3 : 2);

  if (off && S.energized) {
    // During restoration, plants come back as the steps reach them.
    if (S.energized.has('hydro') || S.energized.has('hydroUnit')) plume.hydro = 0.4;
    if (S.energized.has('coal')) plume.coal = 0.35;
    if (S.energized.has('gas')) plume.gascc = 0.5;
  }
  if (off && S.energized && S.energized.has('peak')) peakerUnits = 2;
  else if (off) peakerUnits = 0;

  const load = res.load;
  const lf = (x, c) => (off ? 0 : x / c);
  const tie = off ? 0 : 0.5;
  const lineFlow = {
    nuclear: lf(out.nuclear, cap.nuclear), coal: lf(out.coal, cap.coal), gascc: lf(out.gascc, cap.gascc),
    peaker: lf(out.peaker, cap.peaker), hydro: lf(out.hydro, cap.hydro), other: lf(out.other, cap.other),
    wind: lf(out.wind, cap.wind), solar: lf(out.solar, cap.solar), storage: lf(out.storage, cap.storage),
    town: lf(load * 0.3, 30), city: lf(load * 0.32, 30), factory: lf(load * 0.18, 18), datacenter: performance.now() < S.dcBackupUntil ? 0 : lf(load * 0.2 + (scn.extraLoad || 0), 22),
    tie, neighbor: 0.6, neighborGen: 0.7, townFeeder: lf(load * 0.3, 30) * 0.9, service: off ? 0 : 0.5,
  };
  if (off && S.energized) {
    for (const id of S.energized) {
      const key = { hydro: 'hydro', coal: 'coal', gas: 'gascc', peak: 'peaker', geo: 'other', subA: 'town', subB: 'city', fact: 'factory', dcen: 'datacenter', tie: 'tie', wind: 'wind', solar: 'solar', batt: 'storage' }[id];
      if (key) lineFlow[key] = 0.3;
    }
    if (S.energized.has('subA')) { lineFlow.townFeeder = 0.3 * S.townRestored; lineFlow.service = 0.3; }
  }

  const sun = sunState(h, scn.season);
  const rainV = scn.weather && scn.weather.rain !== undefined ? (typeof scn.weather.rain === 'function' ? scn.weather.rain(h) : scn.weather.rain) : 0;
  const shedFrac = off ? 0 : Math.min(1, (res.shed + S.dyn.ufls + S.manualShed) / Math.max(1, res.inp.rawLoad) + res.inp.damage);

  const labelText = {
    nuclear: fmt(out.nuclear) + ' GW', coal: fmt(out.coal) + ' GW', gascc: fmt(out.gascc) + ' GW', peaker: fmt(out.peaker) + ' GW',
    hydro: fmt(out.hydro) + ' GW', geo: fmt(off ? 0 : GEO_CAP, 2) + ' GW',
    wind: fmt(out.wind) + ' GW', solar: fmt(out.solar) + ' GW',
    battery: out.storage > 0.05 ? fmt(out.storage) + ' GW out' : out.storage < -0.05 ? fmt(-out.storage) + ' GW in' : 'idle',
    hub: '500 → 138 kV', control: S.dyn.hz ? S.dyn.hz.toFixed(2) + ' Hz' : 'no grid', distsub: '138 → 12.47 kV',
    town: off ? 'dark' : shedFrac > 0.01 ? 'rotating outages' : '120/240 V', city: fmt(load * 0.32) + ' GW',
    factory: fmt(load * 0.18) + ' GW', datacenter: performance.now() < S.dcBackupUntil ? 'on backup' : fmt(load * 0.2 + (scn.extraLoad || 0)) + ' GW',
    hvdc: '0.5 GW →', neighbor: neighborHz().toFixed(2) + ' Hz',
  };

  return {
    hour: h, season: scn.season, ...sun,
    cloud: res.inp.cloud, rain: rainV, snow: scn.weather ? scn.weather.snow || 0 : 0, heat: scn.id === 'heatwave',
    eclipse: scn.eclipse ? sim.eclipseFraction(scn.eclipse, h) : 0,
    windCF: res.inp.windCF, windCutout: scn.id === 'hurricane' && h >= 3 && h < 9,
    out, plume, peakerUnits, lineFlow,
    shed: shedFrac, blackout: off, energized: S.energized, townRestored: S.townRestored,
    lineState: S.lineState, voltageMode: S.voltageMode, labels: S.labels, flows: S.flows, labelText,
  };
}

// The neighboring interconnection wanders on its own: it is not synchronized
// with ours, which is the point of the DC tie.
function neighborHz() {
  const t = performance.now() / 1000;
  return 60 + 0.012 * Math.sin(t * 0.21) + 0.008 * Math.sin(t * 0.53 + 1);
}

/* ----------------------------------------------------------------------------
 * HUD
 * ------------------------------------------------------------------------- */

let hudT = 0;
function updateHUD() {
  const res = S.res, dyn = S.dyn;
  // While restoring, show the island the black-start widget is running.
  const restoring = S.blackout && S.energized && S.energized.size > 0 && S.islandHz;
  const hz = restoring ? S.islandHz : S.blackout ? null : dyn.hz;
  $('#hud-hz').textContent = hz === null ? 'No grid' : hz.toFixed(3) + ' Hz';
  $('#hud-rpm').textContent = hz === null ? '–' : Math.round(3600 * hz / 60).toLocaleString() + ' rpm';
  W.drawGauge($('#hud-gauge'), hz);
  W.drawTrace($('#hud-trace'), dyn.trace, { small: true });
  const level = restoring ? 3 : S.blackout ? 5 : Math.max(res.level, dyn.stage > 0 ? 4 : 0);
  const st = $('#hud-status');
  st.dataset.level = String(level);
  st.textContent = restoring ? 'Restoring: one island' : STATUS[level];
  $('#hud-price').textContent = S.blackout ? '–' : fmtPrice(res.price);
  $('#hud-marginal').textContent = S.blackout ? 'no market' : 'set by ' + (res.marginal ? res.marginal.name : '–');
  $('#hud-load').textContent = S.blackout ? '0' : fmt(res.load);
  $('#hud-res').textContent = S.blackout ? '–' : fmt(res.reserves) + ' GW (' + Math.round(res.resPct * 100) + '%)';
  $('#hud-loss').textContent = S.blackout ? '–' : fmt(res.loss.total) + ' GW (' + (res.loss.pct * 100).toFixed(1) + '%)';
  $('#hud-co2').textContent = S.blackout ? '–' : Math.round(res.co2Rate) + ' kg/MWh';
  const extra = [];
  if (dyn.script && dyn.scriptKind === 'uri' && dyn.scriptLow > 0) {
    const s = Math.round(dyn.scriptLow);
    extra.push(`Below 59.4 Hz for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} (plants trip at 9:00)`);
  }
  if (!S.blackout && res.curtail > 0.05) extra.push('Curtailed ' + fmt(res.curtail) + ' GW');
  if (!S.blackout && res.shed + S.dyn.ufls + S.manualShed > 0.05) extra.push('Shedding ' + fmt(res.shed + S.dyn.ufls + S.manualShed) + ' GW');
  $('#hud-extra').textContent = extra.join(' · ');
  W.drawMix($('#hud-mix'), S.blackout ? null : res);
  $('#hud-compact').textContent = (hz === null ? 'No grid' : hz.toFixed(2) + ' Hz') + ' · ' + (S.blackout ? '–' : fmtPrice(res.price)) + ' · ' + (S.blackout ? 0 : fmt(res.load, 0)) + ' GW';
  $('#k-clock').textContent = (S.scn.dayLabel ? S.scn.dayLabel(S.hour) + ', ' : '') + sim.fmtClock(S.hour);
  const dm = $('#k-demand-out');
  dm.textContent = fmt(res.inp.load, 0) + ' GW';
  $('#k-demand-pct').textContent = (S.knobs.demand >= 1 ? '+' : '−') + Math.abs(Math.round((S.knobs.demand - 1) * 100)) + '%';
}

/* ----------------------------------------------------------------------------
 * Dock controls
 * ------------------------------------------------------------------------- */

function syncKnobInputs() {
  const [a, b] = scenarioHourRange();
  const t = $('#k-time');
  t.min = String(a);
  t.max = String(b - 0.25);
  t.value = String(S.hour);
  $('#k-demand').value = String(S.knobs.demand);
  const gas = S.knobs.gas === null ? (typeof S.scn.gas === 'function' ? S.scn.gas(S.hour) : S.scn.gas || sim.FUEL.gas) : S.knobs.gas;
  $('#k-gas').value = String(Math.min(20, gas));
  $('#k-gas-out').textContent = '$' + gas.toFixed(2);
  $('#k-wind').value = String(S.knobs.wind);
  $('#k-wind-out').textContent = Math.round(S.knobs.wind * 100) + '%';
  const cl = S.knobs.cloud === null ? null : S.knobs.cloud;
  $('#k-cloud').value = String(cl === null ? (typeof S.scn.cloud === 'function' ? S.scn.cloud(S.hour) : S.scn.cloud || 0) : cl);
  $('#k-cloud-out').textContent = cl === null ? 'scenario' : Math.round(cl * 100) + '%';
  $('#tg-ffr').setAttribute('aria-pressed', String(S.knobs.ffr));
}

function updatePlayButtons() {
  document.querySelectorAll('[data-speed]').forEach((b) => {
    b.setAttribute('aria-pressed', String(S.playing && Number(b.dataset.speed) === S.speedIdx));
  });
  $('#pause').setAttribute('aria-pressed', String(!S.playing));
}

function wireDock() {
  const sel = $('#k-scenario');
  for (const s of sim.SCENARIOS) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  }
  sel.value = S.scn.id;
  sel.addEventListener('change', () => setScenario(sel.value));
  $('#k-demand').addEventListener('input', (e) => { S.knobs.demand = Number(e.target.value); replanSoon(); });
  $('#k-time').addEventListener('input', (e) => { ACT.setHour(Number(e.target.value)); });
  $('#k-gas').addEventListener('input', (e) => { S.knobs.gas = Number(e.target.value); syncKnobInputs(); replanSoon(); });
  $('#k-wind').addEventListener('input', (e) => { S.knobs.wind = Number(e.target.value); syncKnobInputs(); replanSoon(); });
  $('#k-cloud').addEventListener('input', (e) => { S.knobs.cloud = Number(e.target.value); syncKnobInputs(); replanSoon(); });
  $('#pause').addEventListener('click', () => { S.playing = false; updatePlayButtons(); });
  document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    S.speedIdx = Number(b.dataset.speed);
    S.playing = true;
    if (!S.scn.loop && S.hour >= (S.scn.end || 99) - 0.02) ACT.setHour(S.scn.start);
    updatePlayButtons();
  }));
  const toggle = (id, key, after) => {
    const b = $(id);
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      after(on);
    });
  };
  toggle('#tg-labels', 'labels', (on) => { S.labels = on; });
  toggle('#tg-flows', 'flows', (on) => { S.flows = on; });
  toggle('#tg-volt', 'volt', (on) => { S.voltAuto = false; ACT.setVoltageMode(on); });
  toggle('#tg-ffr', 'ffr', (on) => { S.knobs.ffr = on; });
  toggle('#tg-rotate', 'rotate', (on) => scene && scene.autoRotate(on));
  $('#more').addEventListener('click', () => {
    const p = $('#more-panel');
    p.hidden = !p.hidden;
    $('#more').setAttribute('aria-expanded', String(!p.hidden));
    positionStory();
  });
  $('#reset-view').addEventListener('click', () => { scene.focus('overview'); scene.setSelected(null); });
  $('#reset-knobs').addEventListener('click', () => {
    S.knobs = Object.assign({}, sim.DEFAULT_KNOBS, { ffr: S.knobs.ffr });
    ACT.restore();
    syncKnobInputs();
  });
  // The dock starts collapsed where vertical space is short.
  const dock = $('#dock');
  const setDock = (open) => {
    dock.classList.toggle('collapsed', !open);
    $('#dock-toggle').setAttribute('aria-expanded', String(open));
    positionStory();
  };
  setDock(window.innerHeight >= 640);
  $('#dock-toggle').addEventListener('click', () => setDock(dock.classList.contains('collapsed')));
  $('#hud-toggle').addEventListener('click', () => {
    const hud = $('#hud');
    const collapsed = hud.classList.toggle('collapsed');
    $('#hud-toggle').setAttribute('aria-expanded', String(!collapsed));
  });

  // Keyboard: space plays/pauses, arrows nudge time, +/- nudge demand.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('input, select, textarea, button')) return;
    if (e.key === ' ') { e.preventDefault(); S.playing = !S.playing; updatePlayButtons(); }
    else if (e.key === 'ArrowRight' && e.shiftKey) ACT.setHour(S.hour + 0.5);
    else if (e.key === 'ArrowLeft' && e.shiftKey) ACT.setHour(S.hour - 0.5);
    else if (e.key === '+' || e.key === '=') ACT.setDemand(S.knobs.demand + 0.05);
    else if (e.key === '-') ACT.setDemand(S.knobs.demand - 0.05);
  });
}

/* ----------------------------------------------------------------------------
 * Story card (scenario captions)
 * ------------------------------------------------------------------------- */

function showStory({ text, head, pause = false, toggle = null, next = null }) {
  const card = $('#story');
  card.hidden = false;
  $('#story-head-l').textContent = head || S.scn.name;
  $('#story-head-r').textContent = (S.scn.dayLabel ? S.scn.dayLabel(S.hour) + ', ' : '') + sim.fmtClock(S.hour);
  $('#story-text').textContent = text;
  $('#story-continue').hidden = !pause;
  const act = $('#story-action');
  act.hidden = !next;
  if (next) { act.textContent = next.label; act.dataset.run = next.id; }
  const tg = $('#story-toggle');
  const t = toggle || S.scn.toggle;
  if (t) {
    tg.hidden = false;
    tg.textContent = t.label;
    const on = S.live.storageScale !== undefined && S.live.storageScale > 1;
    tg.setAttribute('aria-pressed', String(on));
  } else tg.hidden = true;
  $('#story-more').hidden = !EXP || !EXP.byId.has('sc-' + S.scn.id);
  positionStory();
  $('#story-more').dataset.open = 'sc-' + S.scn.id;
}

function hideStory() { $('#story').hidden = true; }

// Keep the story card just above the dock, however tall the dock is.
function positionStory() {
  const d = $('#dock').getBoundingClientRect();
  $('#story').style.bottom = Math.round(window.innerHeight - d.top + 8) + 'px';
}

function wireStory() {
  $('#story-close').addEventListener('click', hideStory);
  $('#story-continue').addEventListener('click', () => {
    $('#story-continue').hidden = true;
    S.playing = true;
    updatePlayButtons();
  });
  $('#story-toggle').addEventListener('click', () => {
    const t = S.scn.toggle;
    if (!t) return;
    const on = $('#story-toggle').getAttribute('aria-pressed') !== 'true';
    // The heat wave ships with 2020's storage; the toggle brings today's.
    S.live.storageScale = on ? t.on / t.off : undefined;
    $('#story-toggle').setAttribute('aria-pressed', String(on));
    S.dyn.reset();
    replan();
    if (S.hour > 18.3) ACT.setHour(17.5);
    S.playing = true;
    updatePlayButtons();
  });
}

function checkBeats(prevHour) {
  const beats = S.scn.beats || [];
  while (S.beatIdx < beats.length && beats[S.beatIdx].at <= S.hour + 1e-9) {
    const b = beats[S.beatIdx++];
    if (b.at < prevHour - 0.5) continue;
    showStory({ text: b.text, pause: !!b.pause, next: b.next || null });
    if (b.focus && scene) { scene.focus(b.focus); scene.setSelected(b.focus === 'overview' ? null : b.focus); }
    if (b.pause) { S.playing = false; updatePlayButtons(); }
    if (b.line !== undefined) tripStoryLine(b.line);
    if (b.freqEvent) freqEvent(b.freqEvent);
  }
}

// The 2003 replay trips three 345 kV lines into trees; the rest overload.
const CASCADE_LINES = ['wind', 'solar', 'gas'];
function tripStoryLine(i) {
  S.lineState[CASCADE_LINES[i]] = 'tripped';
  for (const id of ['nuc', 'coal', 'hydro', 'peak']) if (i >= 1) S.lineState[id] = 'overload';
}

function freqEvent(kind) {
  if (kind === 'trip') {
    setTimeout(() => {
      const r = ACT.trip('nuclear');
      if (r) showStory({ text: `${r.name} (${r.gw.toFixed(2)} GW) just tripped. Frequency falls at a rate set by inertia; governors arrest it within seconds; AGC restores 60 Hz over the next minute. Open "Frequency, inertia and torque" to see the trace.`, pause: false });
      S.playing = true;
      S.speedIdx = 0;
      updatePlayButtons();
    }, 1200);
  } else if (kind === 'dcdrop') {
    setTimeout(() => {
      ACT.dataCenterDrop(1.5);
      showStory({ text: 'About 1.5 GW of load vanished in an instant, so generation now exceeds demand and frequency rises. Governors and AGC back generators down. In July 2026 a similar event in Northern Virginia dropped about 3.8 GW in two waves; utilities are now writing ride-through rules for large loads.', pause: false });
    }, 1200);
  } else if (kind === 'uri') {
    S.dyn.script = sim.frequencyScript('uri', S.dyn.t, 4);
    S.dyn.scriptSpeed = 4;
    S.dyn.scriptLow = 0;
    S.dyn.scriptKind = 'uri';
    S.dyn.scriptEnd = S.dyn.t + 300 / 4;
  } else if (kind === 'cascade') {
    S.dyn.script = sim.frequencyScript('cascade', S.dyn.t, 1);
    S.dyn.scriptSpeed = 1;
    S.dyn.scriptKind = 'cascade';
    S.dyn.scriptEnd = S.dyn.t + 18;
    S.dyn.onScriptEnd = () => {
      startBlackout();
      for (const L of ['nuc', 'coal', 'hydro', 'peak', 'wind', 'solar', 'gas']) S.lineState[L] = 'tripped';
    };
  }
}

/* ----------------------------------------------------------------------------
 * Topics <-> scene
 * ------------------------------------------------------------------------- */

let mounted = [];
function onOpen(id, section) {
  unmountWidgets();
  const focusId = section.dataset.focus;
  if (focusId && scene) {
    scene.focus(focusId);
    scene.setSelected(focusId === 'overview' ? null : focusId);
  }
  // Topics about the voltage ladder colour the wires by voltage while open.
  if (section.dataset.voltage === 'on') { if (!S.voltageMode) S.voltAuto = true; ACT.setVoltageMode(true); }
  else if (S.voltAuto) { S.voltAuto = false; ACT.setVoltageMode(false); }
  section.querySelectorAll('[data-widget]').forEach((el) => {
    const h = W.mount(el.dataset.widget, el, ctx);
    if (h) mounted.push(h);
  });
  updateOffset();
}

function onClose() {
  if (S.voltAuto) { S.voltAuto = false; ACT.setVoltageMode(false); }
  unmountWidgets();
  if (scene) scene.setSelected(null);
  updateOffset();
}

function unmountWidgets() {
  for (const h of mounted) if (h.destroy) h.destroy();
  mounted = [];
}

// Keep whatever the camera is looking at visible beside the drawer.
function updateOffset() {
  if (!scene) return;
  const open = document.documentElement.classList.contains('xp-drawer-open');
  if (!open) { scene.setOffset(0, 0); return; }
  if (window.innerWidth > 900) {
    const w = document.getElementById('xp-drawer').getBoundingClientRect().width;
    scene.setOffset(w / 2, 0);
  } else {
    const h = Math.min(window.innerHeight * 0.78, 720);
    scene.setOffset(0, h / 2);
  }
}

/* ----------------------------------------------------------------------------
 * Tooltip
 * ------------------------------------------------------------------------- */

function onHover(id, x, y) {
  const tip = $('#tip');
  if (!id) { tip.hidden = true; return; }
  const f = scene.facilities[id];
  const sub = S.view && S.view.labelText ? S.view.labelText[id] : '';
  tip.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = f.name;
  tip.appendChild(b);
  if (sub) tip.appendChild(document.createTextNode(' · ' + sub));
  const s = document.createElement('div');
  s.textContent = 'Click to read about it';
  s.style.opacity = '0.75';
  tip.appendChild(s);
  tip.hidden = false;
  tip.style.left = Math.min(x + 14, window.innerWidth - 270) + 'px';
  tip.style.top = (y + 16) + 'px';
}

/* ----------------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------------- */

const ctx = {
  S, ACT, sim,
  get res() { return S.res; },
  get plan() { return S.plan; },
  get dyn() { return S.dyn; },
  get hour() { return S.hour; },
};

let scene = null;
let EXP = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

// The head script hides the article while the model loads; reveal whichever
// version won.
function booted() { document.documentElement.classList.remove('xp-booting'); }

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

async function boot() {
  if (!webglOK()) { booted(); return; }   // the page stays an article
  try {
    for (const src of ['../js/vendor/three/three.global.js', '../js/vendor/three/OrbitControls.global.js',
      '../js/vendor/three/BufferGeometryUtils.global.js', 'media/powergrid/scene.js']) await loadScript(src);
  } catch (err) {
    console.error(err);
    booted();
    return;
  }
  const { createScene } = PG.scene;
  replan();
  // Build the scene before switching the page into app mode, so any failure
  // here leaves the readable article in place.
  try {
    scene = createScene($('#stage'), {
      labelLayer: $('#labels'),
      onPick(id) {
        const topic = TOPIC_OF[id];
        if (topic && EXP.byId.has(topic)) EXP.open(topic);
        scene.focus(id);
        scene.setSelected(id);
      },
      onHover,
    });
  } catch (err) {
    console.error(err);
    booted();
    return;
  }
  EXP = initExplainer({ onOpen, onClose });
  booted();
  scene.setAccent(cssVar('--link'));
  onThemeChange(() => { scene.setAccent(cssVar('--link')); W.emit('theme'); });
  window.addEventListener('resize', () => { updateOffset(); positionStory(); });

  wireDock();
  wireStory();
  // "Run this scenario" buttons inside topics. On a phone the drawer covers
  // the model, so get out of the way.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-run]');
    if (!b) return;
    setScenario(b.dataset.run);
    if (window.innerWidth <= 900) EXP.close();
  });
  syncKnobInputs();
  updatePlayButtons();
  ctx.EXP = EXP;
  ctx.scene = scene;

  let last = performance.now();
  let liveT = 0;
  const seenErrors = new Set();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const prev = S.hour;
    if (S.playing && SPEEDS[S.speedIdx] > 0) {
      S.hour += SPEEDS[S.speedIdx] * dt;
      const [a, b] = scenarioHourRange();
      if (S.scn.loop) {
        if (S.hour >= 24) { S.hour -= 24; S.beatIdx = 0; }
      } else if (S.hour >= b - 0.01) {
        S.hour = b - 0.01;
        S.playing = false;
        updatePlayButtons();
      }
      checkBeats(prev);
      $('#k-time').value = String(S.hour);
    }
    liveT += dt;
    if (liveT > 0.066) { S.res = liveResult(); liveT = 0; }

    const I = sim.inertiaOf(S.res);
    S.dyn.step(dt, {
      load: S.res.load, E: I.E, gov: I.gov,
      up: Math.max(0, S.res.reserves * 0.6),
      down: 0.4 * (S.res.byGroup.gascc + S.res.byGroup.coal + S.res.byGroup.peaker),
      ffrGW: Math.min(0.8, 0.12 * S.plan.storageP), ffrOn: S.knobs.ffr,
    });
    if (S.dyn.script && S.dyn.t >= S.dyn.scriptEnd) {
      S.dyn.script = null;
      if (S.dyn.onScriptEnd) { S.dyn.onScriptEnd(); S.dyn.onScriptEnd = null; }
      else S.dyn.df = 0;
    }

    // One failing widget must not stop the clock: log each distinct error
    // once and keep going.
    try {
      S.view = buildView();
      scene.frame(dt, S.view);
      hudT += dt;
      if (hudT > 0.12) { updateHUD(); hudT = 0; }
      W.tick(dt, ctx);
    } catch (err) {
      const key = String(err && err.message);
      if (!seenErrors.has(key)) { seenErrors.add(key); console.error(err); }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  document.documentElement.classList.add('xp-running');
}

boot();

})(window.PowerGrid = window.PowerGrid || {});
