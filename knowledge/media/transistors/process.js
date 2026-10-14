/*
 * knowledge/drafttransistors.html: the process flow. Every step, what it is
 * done with, what is checked afterwards, and the cross-section it leaves
 * behind. No DOM, so it also loads in node:
 *
 *   const F = require('./knowledge/media/transistors/process.js');
 *   F.geometry(F.stateAt(F.indexOf('spetch')), F.DIMS.schematic).shapes.length;
 *
 * Becomes Transistors.process in the browser.
 *
 * The cross-section is one slice through an inverter: an NMOS on the left in a
 * p-well, a PMOS on the right in an n-well, shallow trench isolation (STI)
 * around both, and the wiring above. Each step only flips flags in a small
 * state object (stateAt); geometry() turns a state into polygons, so the same
 * code draws both the readable "schematic" proportions and true scale, by
 * swapping the table of dimensions (DIMS).
 *
 * Coordinates are nanometres: x across the page, z up, z = 0 the original
 * silicon surface.
 */
(function (root) {
'use strict';

/* ----------------------------------------------------------------------------
 * Dimensions
 * ------------------------------------------------------------------------- */

// True: a 90 nm-class process (Lg 50 nm, 1.6 nm oxynitride, Cu/low-k).
// Schematic: the same structure with thin films thickened and the gate
// widened, so a 1.6 nm oxide is visible next to a 300 nm trench.
const DIMS = {
  schematic: {
    sE: 200, aW: 650, sM: 260,
    Lg: 150, Hp: 200, tgox: 9, tpad: 14, tnit: 70, Dsti: 330, taper: 26, tliner: 12, hstep: 26,
    Dwell: 860, Xext: 40, Xj: 120, haloR: [44, 30],
    toff: 10, Wsp: 72, tspdep: 72, tsil: 26, tni: 16, tcesl: 36, Hpmd: 520,
    Wc: 92, Wcb: 70, tbar: 10, tes: 26, Hm1: 170, Hcap: 24, Hv1: 140, Hm2: 190, Hv2: 140, Hm3: 210,
    wM1: 150, wM2: 150, wV: 84, tres: 240, Dsi: 1060, Hbrk: 140, Htop: 380, tpass: 60, tal: 90,
  },
  true: {
    sE: 200, aW: 520, sM: 260,
    Lg: 50, Hp: 100, tgox: 1.6, tpad: 10, tnit: 100, Dsti: 300, taper: 30, tliner: 10, hstep: 20,
    Dwell: 1000, Xext: 20, Xj: 80, haloR: [24, 18],
    toff: 8, Wsp: 45, tspdep: 45, tsil: 18, tni: 10, tcesl: 50, Hpmd: 400,
    Wc: 110, Wcb: 90, tbar: 8, tes: 30, Hm1: 150, Hcap: 30, Hv1: 150, Hm2: 200, Hv2: 160, Hm3: 200,
    wM1: 120, wM2: 120, wV: 100, tres: 250, Dsi: 1200, Hbrk: 160, Htop: 900, tpass: 400, tal: 800,
  },
};

// What each film really is, for tooltips in schematic mode.
const TRUE_NOTE = {
  gox: '1.6 nm of SiON: about eight atoms thick',
  pad: '10 nm', nit: '100 nm', liner: '10 nm', sti: '~300 nm deep', poly: '100 nm tall, 50 nm long',
  spacer: '~45 nm wide', sil: '~18 nm NiSi', cesl: '~50 nm', pmd: '~400 nm', contact: '~100 nm across',
  m1: '~150 nm thick, 120 nm wide', m2: '~200 nm', ext: '~20 nm deep', sd: '~80 nm deep', well: '~1 µm deep',
  resist: '~250 nm', es: '~30 nm', cap: '~30 nm', barrier: '5–10 nm', ni: '~10 nm', lowk: 'k ≈ 3.0',
};

/* ----------------------------------------------------------------------------
 * Materials (colours are page tokens: --tx-*)
 * ------------------------------------------------------------------------- */

const MATS = {
  si: { name: 'Silicon (p-type substrate)', v: '--tx-si' },
  pw: { name: 'p-well', v: '--tx-pw' },
  nw: { name: 'n-well', v: '--tx-nw' },
  np: { name: 'n⁺ silicon', v: '--tx-np' },
  pp: { name: 'p⁺ silicon', v: '--tx-pp' },
  ox: { name: 'Silicon dioxide (thermal)', v: '--tx-ox' },
  cvdox: { name: 'Silicon dioxide (deposited)', v: '--tx-ox2' },
  nit: { name: 'Silicon nitride', v: '--tx-nit' },
  poly: { name: 'Polysilicon', v: '--tx-poly' },
  npoly: { name: 'n⁺ polysilicon', v: '--tx-npoly' },
  ppoly: { name: 'p⁺ polysilicon', v: '--tx-ppoly' },
  resist: { name: 'Photoresist', v: '--tx-resist' },
  ni: { name: 'Nickel', v: '--tx-ni' },
  sil: { name: 'Nickel silicide', v: '--tx-sil' },
  tin: { name: 'Ti / TiN liner', v: '--tx-tin' },
  w: { name: 'Tungsten', v: '--tx-w' },
  pmd: { name: 'Pre-metal dielectric (PSG)', v: '--tx-pmd' },
  lowk: { name: 'Low-k dielectric (SiCOH)', v: '--tx-lowk' },
  sicn: { name: 'SiCN etch stop / cap', v: '--tx-sicn' },
  ta: { name: 'TaN / Ta barrier', v: '--tx-ta' },
  cu: { name: 'Copper', v: '--tx-cu' },
  al: { name: 'Aluminium', v: '--tx-al' },
  pass: { name: 'Passivation (SiN over SiO₂)', v: '--tx-pass' },
  void: { name: 'Open (etched)', v: '--tx-void' },
};

/* ----------------------------------------------------------------------------
 * The steps
 * ------------------------------------------------------------------------- */

const PHASES = [
  { id: 'wafer', name: 'Wafer' },
  { id: 'feol', name: 'Front end' },
  { id: 'mol', name: 'Contacts' },
  { id: 'beol', name: 'Back end' },
  { id: 'test', name: 'Test & package' },
];

/*
 * Each step: id, phase, title, tool, cond (conditions), check (the inline
 * measurement afterwards), text (one or two sentences for the step card),
 * topic (the drawer topic that explains it), and either set (flags for the
 * cross-section) or station (a 3D scene). anno draws what is happening:
 * ions, heat, plasma, wet, cmp. zoom picks how deep the view reaches.
 */
const STEPS = [
  // ---------------------------------------------------------------- wafer
  { id: 'sand', phase: 'wafer', station: 'feed', topic: 'polysilicon', title: 'Sand to polysilicon',
    tool: 'Arc furnace; Siemens reactor',
    cond: 'Quartz and carbon at ~2,000 °C give 98–99% silicon. That becomes trichlorosilane gas, is distilled, and is deposited back onto 1,100 °C silicon rods.',
    check: 'Purity: 9 to 11 nines (impurities in parts per trillion)',
    text: 'Ordinary quartz is reduced to metallurgical silicon, turned into a gas so it can be distilled, and grown back into rods of the purest material made in quantity.' },
  { id: 'cz', phase: 'wafer', station: 'cz', topic: 'czochralski', title: 'Grow the crystal',
    tool: 'Czochralski crystal puller',
    cond: 'Polysilicon melted at 1,414 °C in a quartz crucible under argon, boron added for p-type; seed rotated and pulled at about 1 mm per minute.',
    check: 'Diameter (a camera watches the meniscus), pull rate, oxygen content',
    text: 'A pencil-thin seed crystal touches the melt and is drawn slowly upward. Silicon freezes onto it atom by atom, copying its lattice, into one crystal two metres long.' },
  { id: 'shape', phase: 'wafer', station: 'ingot', topic: 'slicing', title: 'Grind and notch',
    tool: 'Band saw; cylindrical grinder; X-ray diffractometer',
    cond: 'Crop the cone-shaped ends, grind the body to exactly 300 mm, and cut a notch that marks a crystal direction.',
    check: 'Resistivity along the ingot; crystal orientation by X-ray',
    text: 'The ingot is trimmed to a perfect cylinder. A small notch, found by X-ray, records which way the crystal planes run, so every later tool can line up to them.' },
  { id: 'slice', phase: 'wafer', station: 'saw', topic: 'slicing', title: 'Slice into wafers',
    tool: 'Multi-wire saw',
    cond: 'A single wire wound into hundreds of parallel strands, carrying abrasive slurry or diamond grit; the ingot is pressed slowly through the web.',
    check: 'Thickness, bow and warp (capacitance gauges)',
    text: 'The whole ingot is cut at once into hundreds of slices a little under a millimetre thick. The saw cut itself (the kerf) turns about a sixth of the ingot into sludge.' },
  { id: 'polish', phase: 'wafer', station: 'wafer', topic: 'polishing', title: 'Shape, thin and polish',
    tool: 'Edge grinder; double-side grinder; etch; double-side polisher; final CMP',
    cond: 'Round the edge, grind both faces flat, etch away saw damage, polish to a mirror; some wafers get an epitaxial layer.',
    check: 'Flatness (tens of nm across a die-sized site), particles by laser scattering, surface metals',
    text: 'Grinding, etching and polishing leave a 775 µm wafer whose surface varies by only tens of nanometres across a chip-sized patch.' },
  // ---------------------------------------------------------------- front end
  { id: 'start', phase: 'feol', topic: 'cleaning', title: 'Starting wafer and RCA clean', zoom: 'deep',
    tool: 'Wet bench',
    cond: 'SC-1 (ammonia + peroxide, ~70 °C) lifts particles and organics, SC-2 (hydrochloric acid + peroxide) removes metals, dilute HF strips the native oxide.',
    check: 'Particle count (laser scattering); resistivity ~10 Ω·cm, about 10¹⁵ boron atoms per cm³',
    text: 'A bare, lightly boron-doped (p-type) wafer. Before almost every furnace step it is cleaned with the sequence RCA published in 1970.',
    set: {}, anno: { kind: 'wet', label: 'SC-1 → SC-2 → HF' } },
  { id: 'padnit', phase: 'feol', topic: 'isolation', title: 'Pad oxide and nitride', zoom: 'deep',
    tool: 'Oxidation furnace; LPCVD furnace',
    cond: '~10 nm thermal SiO₂ at ~900 °C, then ~100 nm Si₃N₄ from dichlorosilane and ammonia at ~760 °C.',
    check: 'Film thickness (ellipsometer)',
    text: 'The thin oxide cushions the stress of the nitride above it. The nitride will be the hard stop for polishing later.',
    set: { pad: 1, nit: 1 }, hl: ['pad', 'nit'], anno: { kind: 'heat', label: '900 °C O₂, then 760 °C SiH₂Cl₂ + NH₃' } },
  { id: 'stilitho', phase: 'feol', topic: 'isolation', title: 'Lithography: active areas', zoom: 'deep',
    tool: 'Coat/develop track; 248 nm (KrF) scanner',
    cond: 'Anti-reflective coat and resist spun on, exposed through the "active" mask, baked and developed.',
    check: 'CD-SEM (line widths); overlay to the alignment marks',
    text: 'Resist now covers the places where transistors will live (the active areas). Everywhere else will become isolation.',
    set: { resist: 'active' }, hl: ['resist'] },
  { id: 'stietch', phase: 'feol', topic: 'isolation', title: 'Trench etch', zoom: 'deep',
    tool: 'Plasma etcher; asher',
    cond: 'Nitride and oxide in fluorocarbon plasma, then silicon in Cl₂/HBr/O₂ to ~300 nm with sloped walls; resist burned off in an oxygen plasma.',
    check: 'Trench depth and width (optical scatterometry)',
    text: 'The plasma carves trenches wherever the resist was open. The nitride, not the resist, now protects the active areas.',
    set: { resist: null, pad: 2, nit: 2, trench: 1 }, hl: ['si'], anno: { kind: 'plasma', label: 'Cl₂ / HBr / O₂ plasma' } },
  { id: 'liner', phase: 'feol', topic: 'isolation', title: 'Liner oxidation', zoom: 'deep',
    tool: 'Furnace or rapid thermal oxidation',
    cond: '~10 nm of thermal oxide at ~1,000 °C on the trench walls.',
    check: 'Thickness on a monitor wafer',
    text: 'A thin grown oxide heals the etch damage and rounds the sharp top corners, which would otherwise concentrate the electric field.',
    set: { liner: 1 }, hl: ['liner'], anno: { kind: 'heat', label: '~1,000 °C, O₂' } },
  { id: 'stifill', phase: 'feol', topic: 'isolation', title: 'Trench fill', zoom: 'deep',
    tool: 'High-density-plasma CVD',
    cond: 'SiH₄ + O₂ in a dense plasma that deposits and sputters at once, so the trenches fill from the bottom without voids.',
    check: 'Thickness; voids checked by cross-sectioning monitors',
    text: 'Oxide fills the trenches and buries everything under an overburden.',
    set: { sti: 1 }, hl: ['sti'] },
  { id: 'sticmp', phase: 'feol', topic: 'isolation', title: 'Oxide CMP', zoom: 'deep',
    tool: 'Chemical-mechanical polisher',
    cond: 'A rotating pad and ceria slurry polish the oxide until they reach the nitride, which polishes far more slowly.',
    check: 'Remaining nitride thickness map; dishing in wide trenches',
    text: 'Polishing stops on the nitride and leaves oxide only in the trenches, perfectly flat.',
    set: { sti: 2 }, hl: ['sti'], anno: { kind: 'cmp' } },
  { id: 'nitstrip', phase: 'feol', topic: 'isolation', title: 'Nitride strip', zoom: 'deep',
    tool: 'Wet bench: hot phosphoric acid',
    cond: 'H₃PO₄ at ~160 °C dissolves nitride roughly 40 times faster than oxide.',
    check: 'Step height (atomic force microscope)',
    text: 'With the nitride gone the isolation is finished: islands of silicon fenced by oxide, which stands a little proud of the surface.',
    set: { nit: 3, sti: 3, pad: 3 }, hl: ['sti'], anno: { kind: 'wet', label: 'H₃PO₄, 160 °C' } },
  { id: 'pwell', phase: 'feol', topic: 'wells', title: 'p-well implant', zoom: 'deep',
    tool: 'Lithography; high-energy and medium-current implanters',
    cond: 'Resist over the PMOS side. Boron at several energies: deep well (~200 keV), a channel stop, and a shallow threshold adjust.',
    check: 'Dose: thermal-wave or four-point probe on a monitor wafer',
    text: 'Boron ions are fired into the NMOS side. They come to rest at a depth set by their energy; the resist stops them everywhere else.',
    set: { resist: 'nside', pw: 1 }, hl: ['pw', 'resist'], anno: { kind: 'ions', side: 'n', label: 'B⁺  200 / 60 / 15 keV' } },
  { id: 'nwell', phase: 'feol', topic: 'wells', title: 'n-well implant', zoom: 'deep',
    tool: 'Lithography; high-energy and medium-current implanters',
    cond: 'Resist over the NMOS side. Phosphorus (~400 keV) for the well and punch-through stop, arsenic or phosphorus near the surface for the threshold.',
    check: 'Dose on a monitor wafer',
    text: 'The same for the PMOS side with phosphorus, which makes the silicon n-type.',
    set: { resist: 'pside', nw: 1 }, hl: ['nw', 'resist'], anno: { kind: 'ions', side: 'p', label: 'P⁺  400 / 120 keV, As⁺' } },
  { id: 'wellanneal', phase: 'feol', topic: 'wells', title: 'Strip resist, anneal wells', zoom: 'deep',
    tool: 'Asher and wet strip; furnace or rapid thermal anneal',
    cond: 'Heat moves the implanted atoms onto lattice sites (activation) and repairs the crystal the ions broke.',
    check: 'Sheet resistance on monitors (four-point probe)',
    text: 'After annealing, the wells are electrically active: p-type under the NMOS, n-type under the PMOS.',
    set: { resist: null, pw: 2, nw: 2 }, hl: ['pw', 'nw'], anno: { kind: 'heat', label: '~1,000 °C, N₂' } },
  { id: 'gox', phase: 'feol', topic: 'gatestack', title: 'Gate oxide', zoom: 'feol',
    tool: 'HF wet clean; rapid thermal oxidation; plasma nitridation',
    cond: 'Strip the sacrificial oxide, grow ~1.6 nm of SiO₂, then add nitrogen (SiON) to block boron and raise the dielectric constant.',
    check: 'Thickness by ellipsometry or XPS; C–V on monitor wafers',
    text: 'The most important film in the transistor, and the thinnest: about eight atoms. The gate controls the channel through it.',
    set: { pad: 4, gox: 1 }, hl: ['gox'], anno: { kind: 'heat', label: 'RTO ~1,000 °C, then N₂ plasma' } },
  { id: 'polydep', phase: 'feol', topic: 'gatestack', title: 'Polysilicon deposition', zoom: 'feol',
    tool: 'LPCVD furnace',
    cond: 'Silane at ~620 °C: ~100 nm of polycrystalline silicon over everything.',
    check: 'Thickness',
    text: 'A blanket of polysilicon that will become the gate electrodes.',
    set: { poly: 1 }, hl: ['poly'] },
  { id: 'gatelitho', phase: 'feol', topic: 'gatestack', title: 'Lithography: gates', zoom: 'feol',
    tool: '193 nm (ArF) scanner',
    cond: 'The most critical mask. Lines are often printed wider and narrowed by a resist or hard-mask trim etch.',
    check: 'CD-SEM: gate length and its uniformity across the wafer',
    text: 'Resist lines mark the gates. Their width becomes the gate length, the number every node used to be named after.',
    set: { resist: 'gate' }, hl: ['resist'] },
  { id: 'gateetch', phase: 'feol', topic: 'gatestack', title: 'Gate etch', zoom: 'feol',
    tool: 'Inductively coupled plasma etcher',
    cond: 'HBr/Cl₂/O₂: a fast main etch, then a gentle one that stops on the 1.6 nm oxide (selectivity better than 100:1).',
    check: 'After-etch gate length (CD-SEM); profile by cross-section',
    text: 'The polysilicon is etched away except under the resist. Two gates stand on their oxide.',
    set: { resist: null, poly: 2 }, hl: ['gate'], anno: { kind: 'plasma', label: 'HBr / Cl₂ / O₂ plasma' } },
  { id: 'reox', phase: 'feol', topic: 'gatestack', title: 'Re-oxidation and offset spacer', zoom: 'feol',
    tool: 'Rapid thermal oxidation; thin deposition and etch-back',
    cond: 'A few nanometres of oxide or nitride on the gate sidewalls.',
    check: 'Thickness',
    text: 'A thin sidewall film sets how far the next implant lands from the gate edge.',
    set: { offs: 1 }, hl: ['offs'] },
  { id: 'nldd', phase: 'feol', topic: 'extensions', title: 'NMOS extensions and halos', zoom: 'feol',
    tool: 'Lithography; low-energy implanter',
    cond: 'Resist over the PMOS. Arsenic at 1–3 keV for a shallow extension; boron halo at a 30° tilt, four rotations, tucked under the gate edges.',
    check: 'Dose; later at electrical test, threshold versus gate length',
    text: 'The gate itself is the mask: the implant lands on both sides of it and nowhere under it. This is the self-aligned gate.',
    set: { resist: 'nside', extN: 1 }, hl: ['extN', 'resist'], anno: { kind: 'ions', side: 'n', label: 'As⁺ 2 keV; B⁺ halo, tilted' } },
  { id: 'pldd', phase: 'feol', topic: 'extensions', title: 'PMOS extensions and halos', zoom: 'feol',
    tool: 'Lithography; low-energy implanter',
    cond: 'Resist over the NMOS. BF₂ or boron below 1 keV; arsenic or phosphorus halo at a tilt.',
    check: 'Dose',
    text: 'The mirror image for the PMOS: boron extensions with n-type halos.',
    set: { resist: 'pside', extP: 1 }, hl: ['extP', 'resist'], anno: { kind: 'ions', side: 'p', label: 'BF₂⁺ 1 keV; As⁺ halo, tilted' } },
  { id: 'spdep', phase: 'feol', topic: 'spacers', title: 'Spacer deposition', zoom: 'feol',
    tool: 'LPCVD or ALD furnace',
    cond: '~50 nm of silicon nitride that coats tops and sidewalls alike (conformal).',
    check: 'Thickness and conformality',
    text: 'A uniform film follows every surface, including the vertical sides of the gates.',
    set: { resist: null, spdep: 1 }, hl: ['spdep'] },
  { id: 'spetch', phase: 'feol', topic: 'spacers', title: 'Spacer etch', zoom: 'feol',
    tool: 'Plasma etcher (reactive ion etch)',
    cond: 'A strongly directional etch removes the film\'s thickness straight down.',
    check: 'Spacer width (CD-SEM)',
    text: 'Etching straight down clears the flat surfaces but leaves the film on the sidewalls, where it is tallest. These spacers need no mask at all.',
    set: { spdep: 0, spacer: 1, gox: 2 }, hl: ['spacer'], anno: { kind: 'plasma', label: 'CF₄ / CHF₃ plasma, anisotropic' } },
  { id: 'nsd', phase: 'feol', topic: 'sourcedrain', title: 'NMOS source/drain implant', zoom: 'feol',
    tool: 'Lithography; high-current implanter',
    cond: 'Resist over the PMOS. Arsenic at ~15–30 keV, 2–5 × 10¹⁵ ions/cm², which also dopes the NMOS gates n⁺.',
    check: 'Dose from Faraday cups in the implanter',
    text: 'A heavy, deeper implant outside the spacers makes low-resistance source and drain. The spacers keep it back from the channel.',
    set: { resist: 'nside', sdN: 1, gdN: 'npoly' }, hl: ['sdN', 'resist'], anno: { kind: 'ions', side: 'n', label: 'As⁺ 25 keV, 3 × 10¹⁵ cm⁻²' } },
  { id: 'psd', phase: 'feol', topic: 'sourcedrain', title: 'PMOS source/drain implant', zoom: 'feol',
    tool: 'Lithography; high-current implanter',
    cond: 'Resist over the NMOS. Boron at ~3–5 keV or BF₂, 2–4 × 10¹⁵ ions/cm², which also dopes the PMOS gates p⁺.',
    check: 'Dose',
    text: 'The same for the PMOS with boron.',
    set: { resist: 'pside', sdP: 1, gdP: 'ppoly' }, hl: ['sdP', 'resist'], anno: { kind: 'ions', side: 'p', label: 'B⁺ 4 keV, 3 × 10¹⁵ cm⁻²' } },
  { id: 'spike', phase: 'feol', topic: 'sourcedrain', title: 'Activation anneal', zoom: 'feol',
    tool: 'Rapid thermal processor (lamp spike)',
    cond: 'Up to ~1,050 °C and straight back down: about a second above 1,000 °C.',
    check: 'Sheet resistance map, the classic 49-site four-point probe',
    text: 'A heat spike activates the source, drain and extensions while letting them diffuse only a few nanometres.',
    set: { resist: null, sdN: 2, sdP: 2, extN: 2, extP: 2 }, hl: ['sdN', 'sdP', 'extN', 'extP'], anno: { kind: 'heat', label: 'Spike: 1,050 °C, ~1 s' } },
  { id: 'ni', phase: 'feol', topic: 'silicide', title: 'Pre-clean and nickel deposition', zoom: 'feol',
    tool: 'HF pre-clean; PVD (sputter) chamber',
    cond: 'Native oxide removed; ~10 nm of nickel (with a little platinum) sputtered over everything, capped with TiN.',
    check: 'Metal thickness on a monitor (sheet resistance)',
    text: 'A thin metal film covers the whole wafer: silicon, oxide and nitride alike.',
    set: { gox: 3, ni: 1 }, hl: ['ni'] },
  { id: 'salicide', phase: 'feol', topic: 'silicide', title: 'Silicide formation', zoom: 'feol',
    tool: 'Rapid thermal anneal; wet strip; second anneal',
    cond: '~300 °C: nickel reacts only where it touches silicon. Unreacted metal on oxide and nitride is dissolved; ~450 °C converts it to low-resistance NiSi.',
    check: 'Sheet resistance (~5–10 Ω/□, against ~100 for bare n⁺)',
    text: 'Metal–silicon compound forms on the source, drain and gate tops only: self-aligned silicide, or salicide. It cuts their resistance about tenfold.',
    set: { ni: 0, sil: 1 }, hl: ['sil'], anno: { kind: 'heat', label: '300 °C → strip → 450 °C' } },
  // ---------------------------------------------------------------- contacts (middle of line)
  { id: 'cesl', phase: 'mol', topic: 'contacts', title: 'Contact etch stop layer', zoom: 'mol',
    tool: 'PECVD',
    cond: '~50 nm of silicon nitride, deposited under tension over NMOS and compression over PMOS (a dual stress liner).',
    check: 'Film stress, from wafer bow',
    text: 'A nitride liner that the contact etch will stop on, and which also squeezes or stretches the channels to make them faster.',
    set: { cesl: 1 }, hl: ['cesl'] },
  { id: 'pmd', phase: 'mol', topic: 'contacts', title: 'Pre-metal dielectric and CMP', zoom: 'mol',
    tool: 'HDP or sub-atmospheric CVD; CMP',
    cond: 'Phosphorus-doped oxide fills between the gates and is polished flat.',
    check: 'Thickness map; planarity',
    text: 'The transistors are buried in glass and the top is polished flat for the wiring.',
    set: { pmd: 2 }, hl: ['pmd'], anno: { kind: 'cmp' } },
  { id: 'colitho', phase: 'mol', topic: 'contacts', title: 'Contact lithography and etch', zoom: 'mol',
    tool: '193 nm scanner; oxide etcher',
    cond: 'Holes ~100 nm across and ~5 times as deep; the etch stops on the nitride liner, which is then punched through.',
    check: 'Hole size (CD-SEM); e-beam inspection for holes that did not open',
    text: 'Contact holes are etched down to the silicide on each source and drain.',
    set: { co: 1 }, hl: ['co'], anno: { kind: 'plasma', label: 'C₄F₈ / O₂ / Ar plasma' } },
  { id: 'coliner', phase: 'mol', topic: 'contacts', title: 'Contact liner', zoom: 'mol',
    tool: 'PVD titanium; CVD titanium nitride',
    cond: 'Ti scavenges oxide at the bottom; TiN is the glue and the barrier against fluorine from the next step.',
    check: 'Thickness',
    text: 'A thin liner coats the inside of each hole.',
    set: { co: 2 }, hl: ['co'] },
  { id: 'wfill', phase: 'mol', topic: 'contacts', title: 'Tungsten fill', zoom: 'mol',
    tool: 'CVD tungsten',
    cond: 'WF₆ reduced by silane, then by hydrogen, at ~400 °C.',
    check: 'Sheet resistance; voids by cross-section',
    text: 'Tungsten grows in from the walls until each hole is full.',
    set: { co: 3 }, hl: ['co'] },
  { id: 'wcmp', phase: 'mol', topic: 'contacts', title: 'Tungsten CMP', zoom: 'mol',
    tool: 'CMP',
    cond: 'Polishes off the tungsten and TiN on top, leaving plugs.',
    check: 'Defect inspection; later, contact resistance at electrical test',
    text: 'Each transistor terminal now has a tungsten plug leading up to the surface.',
    set: { co: 4 }, hl: ['co'], anno: { kind: 'cmp' } },
  // ---------------------------------------------------------------- back end
  { id: 'm1ild', phase: 'beol', topic: 'damascene', title: 'Metal-1 dielectric', zoom: 'beol',
    tool: 'PECVD',
    cond: 'A SiCN etch stop, then carbon-doped oxide (SiCOH) with k ≈ 3.0 instead of glass\'s 3.9.',
    check: 'Thickness; k on monitors',
    text: 'Copper cannot be etched cleanly, so the wires are made the other way round: insulator first, then trenches, then metal.',
    set: { m1: 1 }, hl: ['m1'] },
  { id: 'm1litho', phase: 'beol', topic: 'damascene', title: 'Lithography: metal 1', zoom: 'beol',
    tool: '193 nm scanner',
    cond: 'Openings where the first wires go.',
    check: 'CD; overlay to the contacts',
    text: 'Resist opens over the wires: ground, the shared output, and power.',
    set: { resist: 'm1' }, hl: ['resist'] },
  { id: 'm1etch', phase: 'beol', topic: 'damascene', title: 'Metal-1 trench etch', zoom: 'beol',
    tool: 'Dielectric etcher',
    cond: 'Fluorocarbon plasma; stops on the SiCN, which is then opened onto the tungsten.',
    check: 'Trench depth and width',
    text: 'Trenches in the dielectric land on the tops of the plugs.',
    set: { resist: null, m1: 2 }, hl: ['m1'], anno: { kind: 'plasma', label: 'CF₄ / C₄F₈ plasma' } },
  { id: 'm1barrier', phase: 'beol', topic: 'damascene', title: 'Barrier and seed', zoom: 'beol',
    tool: 'Ionized PVD',
    cond: '5–10 nm of TaN/Ta, then a thin copper seed layer.',
    check: 'Thickness; coverage of the trench walls',
    text: 'Copper atoms would wander into the dielectric and the silicon and ruin them. A tantalum barrier keeps them in.',
    set: { m1: 3 }, hl: ['m1'] },
  { id: 'm1plate', phase: 'beol', topic: 'damascene', title: 'Copper electroplating', zoom: 'beol',
    tool: 'Electrochemical plating cell; anneal',
    cond: 'Copper sulfate bath with additives that make the trenches fill from the bottom up; annealed to grow large grains.',
    check: 'Thickness; voids',
    text: 'Copper is plated into the trenches and over everything.',
    set: { m1: 4 }, hl: ['m1'], anno: { kind: 'wet', label: 'CuSO₄ + additives' } },
  { id: 'm1cmp', phase: 'beol', topic: 'damascene', title: 'Copper CMP and cap', zoom: 'beol',
    tool: 'Multi-platen CMP; PECVD',
    cond: 'Polish the copper, then the barrier, then buff; seal with a SiCN cap.',
    check: 'Dishing and erosion; defect inspection; line resistance at electrical test',
    text: 'Polishing leaves copper only in the trenches: inlaid wires, or damascene, after the old metal-inlay craft from Damascus.',
    set: { m1: 5 }, hl: ['m1'], anno: { kind: 'cmp' } },
  { id: 'v1ild', phase: 'beol', topic: 'dualdamascene', title: 'Via and metal-2 dielectric', zoom: 'beol',
    tool: 'PECVD',
    cond: 'Low-k film thick enough for a via and a wire.',
    check: 'Thickness',
    text: 'The next level of insulator.',
    set: { l2: 1 }, hl: ['l2'] },
  { id: 'ddetch', phase: 'beol', topic: 'dualdamascene', title: 'Dual damascene etch', zoom: 'beol',
    tool: 'Two lithography and etch passes',
    cond: 'Via first: holes down to the cap; then trenches over them; then the cap is opened onto metal 1.',
    check: 'Via and trench sizes and depths',
    text: 'Holes (vias) and trenches are cut so that one fill makes both the vertical and the horizontal connection.',
    set: { l2: 2 }, hl: ['l2'], anno: { kind: 'plasma', label: 'Fluorocarbon plasma' } },
  { id: 'm2metal', phase: 'beol', topic: 'dualdamascene', title: 'Barrier, seed, plate, polish', zoom: 'beol',
    tool: 'PVD; plating; CMP; PECVD',
    cond: 'The metal-1 sequence again, filling via and trench in one go.',
    check: 'Via-chain resistance at electrical test',
    text: 'Metal 2 runs into the page here, so its wires show up as squares.',
    set: { l2: 3 }, hl: ['l2'] },
  { id: 'upper', phase: 'beol', topic: 'stack', title: 'More levels', zoom: 'beol',
    tool: 'The same modules, repeated',
    cond: 'A logic chip of this era had 6–9 copper levels; the upper ones are wider and thicker, for power, clocks and long wires.',
    check: 'Electrical test of each level',
    text: 'Each level alternates direction. Thin local wiring sits at the bottom, thick global wiring at the top.',
    set: { l3: 1, upper: 1 }, hl: ['l3', 'upper'] },
  { id: 'bond', phase: 'beol', topic: 'stack', title: 'Pad and passivation', zoom: 'beol',
    tool: 'PVD aluminium; PECVD; lithography; etch',
    cond: 'Aluminium bond pads on the top copper; oxide and nitride seal the chip; openings etched over the pads.',
    check: 'Visual inspection',
    text: 'A hard glass-and-nitride coat seals the chip against moisture and sodium. Only the pads are left open.',
    set: { bond: 1 }, hl: ['bond'] },
  // ---------------------------------------------------------------- test and package
  { id: 'wat', phase: 'test', station: 'probe', topic: 'wat', title: 'Parametric test (WAT)',
    tool: 'Prober; parametric analyzer',
    cond: 'Probes land on test structures in the scribe lines between chips: single transistors, resistors, contact and via chains, capacitors.',
    check: 'Threshold, drive and leakage currents, sheet and contact resistance against spec limits',
    text: 'Before anyone tests a chip, the process itself is tested: dozens of measurements per wafer that show whether every step above landed on target.' },
  { id: 'sort', phase: 'test', station: 'sort', topic: 'sort', title: 'Wafer sort',
    tool: 'Prober with a probe card; automatic test equipment',
    cond: 'Every die: continuity, leakage, scan and functional patterns, memory self-test, often speed.',
    check: 'A bin map of the wafer; yield',
    text: 'A probe card with hundreds or thousands of needles tests each chip in turn and records a pass or a failure bin.' },
  { id: 'grind', phase: 'test', station: 'grind', topic: 'dicing', title: 'Backgrind',
    tool: 'Grinder with stress relief',
    cond: 'Front taped; the back ground from 775 µm to ~100–300 µm.',
    check: 'Thickness; total thickness variation',
    text: 'Most of the wafer\'s thickness was only there to survive handling. It is ground away from the back.' },
  { id: 'dice', phase: 'test', station: 'dice', topic: 'dicing', title: 'Dicing',
    tool: 'Dicing saw, laser, or stealth dicing',
    cond: 'The wafer sits on tape in a frame; a diamond blade ~30 µm thick cuts along the scribe lines.',
    check: 'Chipping at the die edges',
    text: 'The wafer is cut apart into individual dies.' },
  { id: 'attach', phase: 'test', station: 'bond', topic: 'packaging', title: 'Die attach and wire bond',
    tool: 'Die bonder; wire bonder',
    cond: 'Die glued or soldered down; 15–25 µm gold or copper wires ball-bonded to each pad (or, for big chips, flip-chip bumps).',
    check: 'Wire pull and ball shear tests',
    text: 'Each pad is stitched to the package with a wire thinner than a hair, at up to twenty wires a second.' },
  { id: 'mold', phase: 'test', station: 'mold', topic: 'packaging', title: 'Mold, mark, singulate',
    tool: 'Transfer mold press; laser marker; saw',
    cond: 'Epoxy compound at ~175 °C flows around die and wires.',
    check: 'X-ray and acoustic microscopy for voids and delamination',
    text: 'The die and wires are sealed in black epoxy, marked, and cut into individual packages.' },
  { id: 'final', phase: 'test', station: 'final', topic: 'finaltest', title: 'Final test and burn-in',
    tool: 'Handler; automatic test equipment; burn-in ovens',
    cond: 'Hot and cold functional and speed tests; burn-in at high temperature and voltage to shake out early failures.',
    check: 'Bins: speed grades and rejects',
    text: 'Every package is tested again, sorted by speed, and shipped.' },
];

const BYID = new Map(STEPS.map((s, i) => [s.id, i]));
const indexOf = (id) => (BYID.has(id) ? BYID.get(id) : -1);

/* ----------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */

const STATE0 = {
  pad: 0, nit: 0, trench: 0, liner: 0, sti: 0, resist: null, pw: 0, nw: 0, gox: 0, poly: 0,
  gdN: 'poly', gdP: 'poly', offs: 0, extN: 0, extP: 0, spdep: 0, spacer: 0, sdN: 0, sdP: 0,
  ni: 0, sil: 0, cesl: 0, pmd: 0, co: 0, m1: 0, l2: 0, l3: 0, upper: 0, bond: 0,
};

const STATES = [];
(function build() {
  let s = Object.assign({}, STATE0);
  for (const st of STEPS) {
    if (st.set) s = Object.assign({}, s, st.set);
    STATES.push(s);
  }
})();

function stateAt(i) { return STATES[Math.max(0, Math.min(STATES.length - 1, i))]; }

/* ----------------------------------------------------------------------------
 * Geometry helpers
 * ------------------------------------------------------------------------- */

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) out.push(p);
  }
  return out;
}

// Offset a left-to-right polyline by t to its left (upward for a flat
// surface). Concave corners get a mitre, convex corners an arc, which is what
// a conformal film does.
function offsetPolyline(pts, t) {
  pts = dedupe(pts);
  const n = pts.length;
  if (n < 2) return pts.slice();
  const norm = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
    const L = Math.hypot(dx, dz);
    norm.push([-dz / L, dx / L, dx / L, dz / L]);   // normal x, normal z, dir x, dir z
  }
  const out = [[pts[0][0] + t * norm[0][0], pts[0][1] + t * norm[0][1]]];
  for (let i = 1; i < n - 1; i++) {
    const a = norm[i - 1], b = norm[i];
    const cross = a[2] * b[3] - a[3] * b[2];
    const v = pts[i];
    if (cross > 1e-9) {
      const dot = a[0] * b[0] + a[1] * b[1];
      const k = t / Math.max(0.2, 1 + dot);
      out.push([v[0] + k * (a[0] + b[0]), v[1] + k * (a[1] + b[1])]);
    } else if (cross < -1e-9) {
      let a1 = Math.atan2(a[1], a[0]);
      let a2 = Math.atan2(b[1], b[0]);
      while (a2 > a1) a2 -= 2 * Math.PI;
      const steps = Math.max(1, Math.ceil((a1 - a2) / (Math.PI / 14)));
      for (let k = 0; k <= steps; k++) {
        const ang = a1 + (a2 - a1) * k / steps;
        out.push([v[0] + t * Math.cos(ang), v[1] + t * Math.sin(ang)]);
      }
    } else {
      out.push([v[0] + t * a[0], v[1] + t * a[1]]);
    }
  }
  const e = norm[n - 2];
  out.push([pts[n - 1][0] + t * e[0], pts[n - 1][1] + t * e[1]]);
  return out;
}

function film(surface, t) {
  return dedupe(surface.concat(offsetPolyline(surface, t).reverse()));
}

// The part of a polyline with x in [a, b] (x never decreases along it).
function clip(pts, a, b) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const lo = Math.min(p[0], q[0]), hi = Math.max(p[0], q[0]);
    if (hi < a || lo > b) continue;
    if (Math.abs(q[0] - p[0]) < 1e-9) { out.push(p, q); continue; }
    const t0 = Math.max(0, (a - p[0]) / (q[0] - p[0]));
    const t1 = Math.min(1, (b - p[0]) / (q[0] - p[0]));
    out.push([p[0] + t0 * (q[0] - p[0]), p[1] + t0 * (q[1] - p[1])]);
    out.push([p[0] + t1 * (q[0] - p[0]), p[1] + t1 * (q[1] - p[1])]);
  }
  return dedupe(out);
}

// A region hanging down from the surface with rounded bottom corners
// (diffused junctions): x0..x1, from zTop down to depth.
function basin(x0, x1, zTop, depth, rL, rR) {
  const pts = [[x0, zTop]];
  const zb = zTop - depth;
  const N = 10;
  if (rL > 0) {
    const r = Math.min(rL, depth);
    for (let k = 0; k <= N; k++) {
      const a = Math.PI / 2 * k / N;
      pts.push([x0 + rL - rL * Math.cos(a), zb + r - r * Math.sin(a)]);
    }
  } else pts.push([x0, zb]);
  if (rR > 0) {
    const r = Math.min(rR, depth);
    for (let k = 0; k <= N; k++) {
      const a = Math.PI / 2 * k / N;
      pts.push([x1 - rR + rR * Math.sin(a), zb + r - r * Math.cos(a)]);
    }
  } else pts.push([x1, zb]);
  pts.push([x1, zTop]);
  return dedupe(pts);
}

function ellipse(cx, cz, rx, rz, n = 28) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = 2 * Math.PI * k / n;
    pts.push([cx + rx * Math.cos(a), cz + rz * Math.sin(a)]);
  }
  return pts;
}

/* ----------------------------------------------------------------------------
 * Layout derived from the dimensions
 * ------------------------------------------------------------------------- */

function layout(D) {
  const W = 2 * D.sE + 2 * D.aW + D.sM;
  const actN = [D.sE, D.sE + D.aW];
  const actP = [actN[1] + D.sM, actN[1] + D.sM + D.aW];
  const mid = (actN[1] + actP[0]) / 2;
  const gN = (actN[0] + actN[1]) / 2, gP = (actP[0] + actP[1]) / 2;
  const gate = (c) => [c - D.Lg / 2, c + D.Lg / 2];
  const foot = (c) => [c - D.Lg / 2 - D.toff - D.Wsp, c + D.Lg / 2 + D.toff + D.Wsp];
  const fN = foot(gN), fP = foot(gP);
  const contacts = {
    nS: (actN[0] + fN[0]) / 2, nD: (fN[1] + actN[1]) / 2,
    pD: (actP[0] + fP[0]) / 2, pS: (fP[1] + actP[1]) / 2,
  };
  const trenches = [
    { a: 0, b: actN[0], wallL: false, wallR: true },
    { a: actN[1], b: actP[0], wallL: true, wallR: true },
    { a: actP[1], b: W, wallL: true, wallR: false },
  ];
  return { W, actN, actP, mid, gN, gP, gateN: gate(gN), gateP: gate(gP), fN, fP, contacts, trenches };
}

/* ----------------------------------------------------------------------------
 * geometry(state, D) -> { shapes, annos, bounds, L }
 *   shape: { id, mat, pts, op (opacity), dash, label, info, lab: [x, z] }
 * ------------------------------------------------------------------------- */

function geometry(S, D, step) {
  const L = layout(D);
  const shapes = [];
  const add = (id, mat, pts, extra) => { shapes.push(Object.assign({ id, mat, pts }, extra || {})); };
  const { W, actN, actP, mid } = L;
  const zN = D.tpad + D.tnit;
  const zGox = S.gox ? D.tgox : 0;
  const gateTop = D.tgox + D.Hp;
  const silTop = 0.45 * D.tsil;

  // ---- The trench profile through the silicon (and nitride, if present).
  function trenchSurface(withHard) {
    const pts = [];
    const zTopAct = withHard ? zN : 0;
    L.trenches.forEach((t, i) => {
      if (!t.wallL) pts.push([t.a, -D.Dsti]);
      else { pts.push([t.a, zTopAct], [t.a, 0], [t.a + D.taper, -D.Dsti]); }
      if (!t.wallR) pts.push([t.b, -D.Dsti]);
      else { pts.push([t.b - D.taper, -D.Dsti], [t.b, 0], [t.b, zTopAct]); }
    });
    return dedupe(pts);
  }

  // ---- The top surface of the front end after isolation (for films/resist).
  function feolSurface() {
    const pts = [];
    const zSti = S.sti === 3 ? D.hstep : 0;
    const zAct = S.pad === 3 ? D.tpad : (S.gox === 1 ? D.tgox : 0);
    const zSD = S.sil ? silTop : zAct;
    const topG = gateTop + (S.sil ? 0.6 * D.tsil : 0);
    const H = gateTop - 0.05 * D.Hp;
    const gatesUp = S.poly === 2;
    // The spacer's outer face, a quarter ellipse from foot (a = pi/2) to top (a = 0).
    const spZ = (a) => D.tgox + (H - D.tgox) * Math.cos(a);
    const site = (act, g, f) => {
      pts.push([act[0], zSti], [act[0], zSD]);
      if (gatesUp) {
        const gl = g[0] - (S.offs ? D.toff : 0), gr = g[1] + (S.offs ? D.toff : 0);
        if (S.spacer) {
          pts.push([f[0], zSD]);
          for (let k = 0; k <= 14; k++) {
            const a = Math.PI / 2 * (1 - k / 14);
            pts.push([gl - D.Wsp * Math.sin(a), spZ(a)]);
          }
          pts.push([gl, topG], [gr, topG]);
          for (let k = 0; k <= 14; k++) {
            const a = Math.PI / 2 * k / 14;
            pts.push([gr + D.Wsp * Math.sin(a), spZ(a)]);
          }
          pts.push([f[1], zSD]);
        } else {
          pts.push([gl, zAct], [gl, topG], [gr, topG], [gr, zAct]);
        }
      }
      pts.push([act[1], zSD], [act[1], zSti]);
    };
    pts.push([0, zSti]);
    site(actN, L.gateN, L.fN);
    site(actP, L.gateP, L.fP);
    pts.push([W, zSti]);
    return dedupe(pts);
  }

  // ---------------------------------------------------------------- silicon
  if (S.trench) {
    const surf = trenchSurface(false);
    add('si', 'si', [[0, -D.Dsi]].concat(surf, [[W, -D.Dsi]]), { label: 'Silicon', lab: [D.sE * 0.4, -D.Dsi * 0.75] });
  } else {
    add('si', 'si', rect(0, -D.Dsi, W, 0), { label: 'Silicon', lab: [W * 0.08, -D.Dsi * 0.75] });
  }

  // ---------------------------------------------------------------- wells
  const wellShape = (x0, x1, state) => (state === 2
    ? basin(x0, x1, 0, D.Dwell, 0, 0)
    : basin(x0, x1, -D.Dwell * 0.35, D.Dwell * 0.45, D.Dwell * 0.2, D.Dwell * 0.2));
  if (S.pw) add('pw', 'pw', wellShape(0, mid, S.pw), { op: S.pw === 2 ? 0.55 : 0.45, dash: S.pw === 1, label: 'p-well', lab: [L.gN - D.aW * 0.32, -D.Dwell * 0.62], info: TRUE_NOTE.well });
  if (S.nw) add('nw', 'nw', wellShape(mid, W, S.nw), { op: S.nw === 2 ? 0.55 : 0.45, dash: S.nw === 1, label: 'n-well', lab: [L.gP + D.aW * 0.32, -D.Dwell * 0.62], info: TRUE_NOTE.well });

  // ---------------------------------------------------------------- junctions
  const sides = [
    { key: 'N', act: actN, g: L.gateN, f: L.fN, ext: S.extN, sd: S.sdN, dop: 'np', halo: 'pp' },
    { key: 'P', act: actP, g: L.gateP, f: L.fP, ext: S.extP, sd: S.sdP, dop: 'pp', halo: 'np' },
  ];
  for (const s of sides) {
    const off = S.offs ? D.toff : 0;
    if (s.ext) {
      const ann = s.ext === 2;
      const lat = ann ? D.Xext * 0.35 : 0;
      const dep = ann ? D.Xext : D.Xext * 0.75;
      // Halo pockets, just under the extension tips.
      const hz = -dep - D.haloR[1] * 0.55;
      add('halo' + s.key + 'L', s.halo, ellipse(s.g[0] - off + lat * 0.5, hz, D.haloR[0], D.haloR[1]), { op: 0.32, dash: !ann, label: s.key === 'N' ? 'Halo (p-type pocket)' : 'Halo (n-type pocket)', lab: [s.g[0] - off, hz - D.haloR[1]] });
      add('halo' + s.key + 'R', s.halo, ellipse(s.g[1] + off - lat * 0.5, hz, D.haloR[0], D.haloR[1]), { op: 0.32, dash: !ann });
      add('ext' + s.key + 'L', s.dop, basin(s.act[0], s.g[0] - off + lat, 0, dep, 0, dep * 0.8), { op: 0.62, dash: !ann, label: 'Extension', lab: [s.g[0] - off - D.Wsp * 0.4, -dep * 0.6], info: TRUE_NOTE.ext });
      add('ext' + s.key + 'R', s.dop, basin(s.g[1] + off - lat, s.act[1], 0, dep, dep * 0.8, 0), { op: 0.62, dash: !ann });
    }
    if (s.sd) {
      const ann = s.sd === 2;
      const lat = ann ? D.Xj * 0.18 : 0;
      const dep = ann ? D.Xj : D.Xj * 0.72;
      const label = s.key === 'N' ? 'n⁺ source / drain' : 'p⁺ source / drain';
      add('sd' + s.key + 'L', s.dop, basin(s.act[0], s.f[0] + lat, 0, dep, 0, dep * 0.7), { op: 0.85, dash: !ann, label, lab: [(s.act[0] + s.f[0]) / 2, -dep * 0.55], info: TRUE_NOTE.sd });
      add('sd' + s.key + 'R', s.dop, basin(s.f[1] - lat, s.act[1], 0, dep, dep * 0.7, 0), { op: 0.85, dash: !ann });
    }
  }

  // ---------------------------------------------------------------- isolation
  if (S.liner && S.sti <= 1) {
    for (const t of L.trenches) {
      const prof = [];
      if (t.wallL) prof.push([t.a, 0], [t.a + D.taper, -D.Dsti]); else prof.push([t.a, -D.Dsti]);
      if (t.wallR) prof.push([t.b - D.taper, -D.Dsti], [t.b, 0]); else prof.push([t.b, -D.Dsti]);
      add('liner' + t.a, 'ox', film(prof, D.tliner), { label: t.wallL && t.wallR ? 'Liner oxide' : null, lab: [t.b - D.taper * 0.5, -D.Dsti * 0.55], info: TRUE_NOTE.liner });
    }
  }
  if (S.sti === 1) {
    const bottom = trenchSurface(true);
    const zTop = zN + D.Dsti * 0.38;
    const top = [];
    for (let i = 0; i <= 60; i++) {
      const x = W * i / 60;
      let dip = 0;
      for (const t of L.trenches) {
        const c = (t.a + t.b) / 2, w = (t.b - t.a) / 2;
        dip = Math.max(dip, Math.exp(-Math.pow((x - c) / (w * 0.9), 4)) * D.Dsti * 0.16);
      }
      top.push([x, zTop - dip]);
    }
    add('sti', 'cvdox', bottom.concat(top.reverse()), { label: 'HDP oxide', lab: [mid, zTop - D.Dsti * 0.25], info: TRUE_NOTE.sti });
  } else if (S.sti >= 2) {
    const zt = S.sti === 2 ? zN : D.hstep;
    L.trenches.forEach((t, i) => {
      const pts = [];
      pts.push([t.a, zt]);
      if (t.wallL) pts.push([t.a, 0], [t.a + D.taper, -D.Dsti]); else pts.push([t.a, -D.Dsti]);
      if (t.wallR) pts.push([t.b - D.taper, -D.Dsti], [t.b, 0]); else pts.push([t.b, -D.Dsti]);
      pts.push([t.b, zt]);
      add('sti' + i, 'cvdox', pts, i === 1 ? { label: 'Shallow trench isolation', lab: [mid, -D.Dsti * 0.5], info: TRUE_NOTE.sti } : {});
    });
  }

  // ---------------------------------------------------------------- pad / nitride
  if (S.pad === 1) add('pad', 'ox', rect(0, 0, W, D.tpad), { label: 'Pad oxide', lab: [W * 0.93, D.tpad / 2], info: TRUE_NOTE.pad });
  if (S.pad === 2 || S.pad === 3) {
    add('padN', 'ox', rect(actN[0], 0, actN[1], D.tpad), { label: S.pad === 3 ? 'Sacrificial oxide' : 'Pad oxide', lab: [actN[0] + D.aW * 0.15, D.tpad / 2], info: TRUE_NOTE.pad });
    add('padP', 'ox', rect(actP[0], 0, actP[1], D.tpad));
  }
  if (S.nit === 1) add('nit', 'nit', rect(0, D.tpad, W, zN), { label: 'Silicon nitride', lab: [W * 0.75, D.tpad + D.tnit / 2], info: TRUE_NOTE.nit });
  if (S.nit === 2) {
    add('nitN', 'nit', rect(actN[0], D.tpad, actN[1], zN), { label: 'Silicon nitride', lab: [actN[0] + D.aW * 0.7, D.tpad + D.tnit / 2], info: TRUE_NOTE.nit });
    add('nitP', 'nit', rect(actP[0], D.tpad, actP[1], zN));
  }

  // ---------------------------------------------------------------- gate stack
  if (S.gox === 1) {
    add('goxN', 'ox', rect(actN[0], 0, actN[1], D.tgox), { label: 'Gate oxide', lab: [actN[0] + D.aW * 0.12, D.tgox / 2], info: TRUE_NOTE.gox });
    add('goxP', 'ox', rect(actP[0], 0, actP[1], D.tgox));
  } else if (S.gox >= 2) {
    // Under the gates (and the spacers, which sit on it).
    const w = S.spacer ? D.toff + D.Wsp : D.toff;
    add('goxN', 'ox', rect(L.gateN[0] - w, 0, L.gateN[1] + w, D.tgox), { label: 'Gate oxide', lab: [L.gN, D.tgox / 2], info: TRUE_NOTE.gox });
    add('goxP', 'ox', rect(L.gateP[0] - w, 0, L.gateP[1] + w, D.tgox));
  }
  if (S.poly === 1) {
    const surf = feolSurface();
    add('poly', 'poly', film(surf, D.Hp), { label: 'Polysilicon', lab: [mid + D.sM, D.tgox + D.Hp * 0.55], info: TRUE_NOTE.poly });
  }
  const gateLab = (k) => (k === 'npoly' ? 'n⁺ poly gate' : k === 'ppoly' ? 'p⁺ poly gate' : 'Poly gate');
  if (S.poly === 2) {
    add('gateN', S.gdN, rect(L.gateN[0], D.tgox, L.gateN[1], gateTop), { label: gateLab(S.gdN), lab: [L.gN, gateTop * 0.55], info: TRUE_NOTE.poly });
    add('gateP', S.gdP, rect(L.gateP[0], D.tgox, L.gateP[1], gateTop), { label: gateLab(S.gdP), lab: [L.gP, gateTop * 0.55], info: TRUE_NOTE.poly });
  }
  if (S.offs) {
    for (const [k, g] of [['N', L.gateN], ['P', L.gateP]]) {
      add('offs' + k + 'L', 'ox', rect(g[0] - D.toff, D.tgox, g[0], gateTop), k === 'N' ? { label: 'Offset spacer', lab: [g[0] - D.toff / 2, gateTop * 0.8] } : {});
      add('offs' + k + 'R', 'ox', rect(g[1], D.tgox, g[1] + D.toff, gateTop));
    }
  }
  if (S.spdep) {
    add('spdep', 'nit', film(feolSurface(), D.tspdep), { label: 'Conformal nitride', lab: [mid, D.hstep + D.tspdep / 2], info: TRUE_NOTE.spacer });
  }
  if (S.spacer) {
    const H = gateTop - 0.05 * D.Hp;
    const sp = (xe, dir) => {
      const pts = [[xe, D.tgox]];
      for (let k = 0; k <= 14; k++) {
        const a = Math.PI / 2 * k / 14;
        pts.push([xe + dir * D.Wsp * Math.sin(a), D.tgox + (H - D.tgox) * Math.cos(a)]);
      }
      return dir < 0 ? pts : pts.reverse();
    };
    for (const [k, g] of [['N', L.gateN], ['P', L.gateP]]) {
      add('sp' + k + 'L', 'nit', sp(g[0] - D.toff, -1), k === 'N' ? { label: 'Nitride spacer', lab: [g[0] - D.toff - D.Wsp * 0.45, gateTop * 0.3], info: TRUE_NOTE.spacer } : {});
      add('sp' + k + 'R', 'nit', sp(g[1] + D.toff, 1));
    }
  }

  // ---------------------------------------------------------------- silicide
  if (S.ni === 1) add('ni', 'ni', film(feolSurface(), D.tni), { label: 'Nickel film', lab: [mid, D.hstep + D.tni], info: TRUE_NOTE.ni });
  if (S.sil) {
    const z0 = -0.55 * D.tsil, z1 = silTop;
    const pairs = [[actN[0], L.fN[0]], [L.fN[1], actN[1]], [actP[0], L.fP[0]], [L.fP[1], actP[1]]];
    pairs.forEach((p, i) => add('silsd' + i, 'sil', rect(p[0], z0, p[1], z1), i === 0 ? { label: 'NiSi', lab: [(p[0] + p[1]) / 2, z1], info: TRUE_NOTE.sil } : {}));
    add('silgN', 'sil', rect(L.gateN[0], gateTop - 0.4 * D.tsil, L.gateN[1], gateTop + 0.6 * D.tsil));
    add('silgP', 'sil', rect(L.gateP[0], gateTop - 0.4 * D.tsil, L.gateP[1], gateTop + 0.6 * D.tsil));
  }

  // ---------------------------------------------------------------- contacts level
  let zTopNow = 0;
  if (S.cesl) {
    add('cesl', 'nit', film(feolSurface(), D.tcesl), { label: 'Contact etch stop (stress liner)', lab: [mid, D.hstep + D.tcesl * 0.6], info: TRUE_NOTE.cesl, op: 0.9 });
  }
  if (S.pmd) {
    const base = offsetPolyline(feolSurface(), D.tcesl);
    add('pmd', 'pmd', base.concat([[W, D.Hpmd], [0, D.Hpmd]]), { label: 'Pre-metal dielectric', lab: [mid, D.Hpmd * 0.82], info: TRUE_NOTE.pmd });
    zTopNow = D.Hpmd;
  }
  const cx = [L.contacts.nS, L.contacts.nD, L.contacts.pD, L.contacts.pS];
  const hole = (c, top, bot, wt, wb) => [[c - wt / 2, top], [c - wb / 2, bot], [c + wb / 2, bot], [c + wt / 2, top]];
  if (S.co) {
    cx.forEach((c, i) => {
      const H = hole(c, D.Hpmd, silTop, D.Wc, D.Wcb);
      const first = i === 0;
      if (S.co === 1) add('coh' + i, 'void', H, first ? { label: 'Contact hole', lab: [c, D.Hpmd * 0.6], info: TRUE_NOTE.contact } : {});
      else {
        add('cot' + i, 'tin', H, first ? { label: 'Ti/TiN liner', lab: [c - D.Wc / 2, D.Hpmd * 0.4], info: TRUE_NOTE.barrier } : {});
        const inner = hole(c, D.Hpmd + 1, silTop + D.tbar, D.Wc - 2 * D.tbar, D.Wcb - 2 * D.tbar);
        if (S.co === 2) add('coi' + i, 'void', inner);
        else add('cow' + i, 'w', inner, first ? { label: 'Tungsten plug', lab: [c, D.Hpmd * 0.6], info: TRUE_NOTE.contact } : {});
      }
    });
    if (S.co === 2 || S.co === 3) {
      add('cotop', 'tin', rect(0, D.Hpmd, W, D.Hpmd + D.tbar));
      zTopNow = D.Hpmd + D.tbar;
      if (S.co === 3) {
        const ov = D.Wc * 0.7;
        add('cowtop', 'w', rect(0, D.Hpmd + D.tbar, W, D.Hpmd + D.tbar + ov), { label: 'Tungsten overburden', lab: [mid, D.Hpmd + D.tbar + ov / 2] });
        zTopNow += ov;
      }
    }
  }

  // ---------------------------------------------------------------- metal 1
  const m1Lines = [
    [L.contacts.nS - D.wM1 / 2, L.contacts.nS + D.wM1 / 2, 'GND'],
    [L.contacts.nD - D.wM1 / 2, L.contacts.pD + D.wM1 / 2, 'OUT'],
    [L.contacts.pS - D.wM1 / 2, L.contacts.pS + D.wM1 / 2, 'VDD'],
  ];
  const z1a = D.Hpmd, z1b = D.Hpmd + D.tes, z1c = z1b + D.Hm1;
  const zCap1 = z1c + D.Hcap;
  if (S.m1) {
    add('es1', 'sicn', rect(0, z1a, W, z1b), { label: 'SiCN etch stop', lab: [W * 0.06, (z1a + z1b) / 2], info: TRUE_NOTE.es });
    add('ild1', 'lowk', rect(0, z1b, W, z1c), { label: 'Low-k dielectric', lab: [W * 0.06, (z1b + z1c) / 2], info: TRUE_NOTE.lowk });
    zTopNow = z1c;
    m1Lines.forEach(([a, b, name], i) => {
      const first = i === 1;
      if (S.m1 === 2) add('m1t' + i, 'void', rect(a, z1a, b, z1c + 1), first ? { label: 'Trench', lab: [(a + b) / 2, z1c - D.Hm1 * 0.3] } : {});
      if (S.m1 >= 3) {
        add('m1b' + i, 'ta', rect(a, z1a, b, z1c + (S.m1 === 5 ? 0 : 1)), first ? { label: 'TaN/Ta barrier', lab: [a, (z1a + z1c) / 2], info: TRUE_NOTE.barrier } : {});
        const inner = rect(a + D.tbar, z1a + D.tbar, b - D.tbar, z1c + 1);
        if (S.m1 === 3) add('m1v' + i, 'void', inner);
        else add('m1c' + i, 'cu', S.m1 === 5 ? rect(a + D.tbar, z1a + D.tbar, b - D.tbar, z1c) : inner,
          first ? { label: S.m1 === 5 ? 'Metal 1 (OUT)' : 'Copper', lab: [(a + b) / 2, (z1a + z1c) / 2], info: TRUE_NOTE.m1 } : (S.m1 === 5 ? { label: 'Metal 1 (' + name + ')', lab: [(a + b) / 2, (z1a + z1c) / 2] } : {}));
      }
    });
    if (S.m1 === 3 || S.m1 === 4) {
      add('m1btop', 'ta', rect(0, z1c, W, z1c + D.tbar));
      zTopNow = z1c + D.tbar;
      if (S.m1 === 4) {
        const ov = D.Hm1 * 0.75;
        add('m1cutop', 'cu', rect(0, z1c + D.tbar, W, z1c + D.tbar + ov), { label: 'Plated copper', lab: [mid, z1c + D.tbar + ov * 0.55] });
        zTopNow += ov;
      }
    }
    if (S.m1 === 5) {
      add('cap1', 'sicn', rect(0, z1c, W, zCap1), { label: 'SiCN cap', lab: [W * 0.06, (z1c + zCap1) / 2], info: TRUE_NOTE.cap });
      zTopNow = zCap1;
    }
  }

  // ---------------------------------------------------------------- via 1 / metal 2
  const z2a = zCap1, z2v = z2a + D.Hv1, z2c = z2v + D.Hm2, zCap2 = z2c + D.Hcap;
  const m2x = [L.contacts.nS, (L.contacts.nS + mid) / 2, mid, (mid + L.contacts.pS) / 2, L.contacts.pS];
  const viaAt = [true, false, true, false, true];
  if (S.l2) {
    add('ild2', 'lowk', rect(0, z2a, W, z2c));
    zTopNow = z2c;
    m2x.forEach((c, i) => {
      const a = c - D.wM2 / 2, b = c + D.wM2 / 2;
      const va = c - D.wV / 2, vb = c + D.wV / 2;
      const shape = viaAt[i]
        ? [[a, z2c + 1], [a, z2v], [va, z2v], [va, z2a - D.Hcap], [vb, z2a - D.Hcap], [vb, z2v], [b, z2v], [b, z2c + 1]]
        : rect(a, z2v, b, z2c + 1);
      if (S.l2 === 2) add('dd' + i, 'void', shape, i === 2 ? { label: 'Via + trench', lab: [c, z2v] } : {});
      if (S.l2 === 3) {
        add('m2b' + i, 'ta', shape.map(([x, z]) => [x, Math.min(z, z2c)]));
        const inner = viaAt[i]
          ? [[a + D.tbar, z2c], [a + D.tbar, z2v + D.tbar], [va + D.tbar, z2v + D.tbar], [va + D.tbar, z2a - D.Hcap + D.tbar], [vb - D.tbar, z2a - D.Hcap + D.tbar], [vb - D.tbar, z2v + D.tbar], [b - D.tbar, z2v + D.tbar], [b - D.tbar, z2c]]
          : rect(a + D.tbar, z2v + D.tbar, b - D.tbar, z2c);
        add('m2c' + i, 'cu', inner, i === 2 ? { label: 'Via 1 + metal 2', lab: [c, z2v + D.Hm2 * 0.5], info: TRUE_NOTE.m2 } : (i === 1 ? { label: 'M2 (runs into the page)', lab: [c, z2c] } : {}));
      }
    });
    if (S.l2 === 3) { add('cap2', 'sicn', rect(0, z2c, W, zCap2)); zTopNow = zCap2; }
  }

  // ---------------------------------------------------------------- via 2 / metal 3 and up
  const z3a = zCap2, z3v = z3a + D.Hv2, z3c = z3v + D.Hm3, zCap3 = z3c + D.Hcap;
  let zUpper = zCap3;
  if (S.l3) {
    add('ild3', 'lowk', rect(0, z3a, W, z3c));
    const segs = [[W * 0.03, mid - W * 0.12, L.contacts.nS], [mid + W * 0.12, W * 0.97, L.contacts.pS]];
    segs.forEach(([a, b, v], i) => {
      const va = v - D.wV / 2, vb = v + D.wV / 2;
      const outer = [[a, z3c], [a, z3v], [va, z3v], [va, z3a - D.Hcap], [vb, z3a - D.Hcap], [vb, z3v], [b, z3v], [b, z3c]];
      add('m3b' + i, 'ta', outer);
      const t = D.tbar;
      add('m3c' + i, 'cu', [[a + t, z3c], [a + t, z3v + t], [va + t, z3v + t], [va + t, z3a - D.Hcap + t], [vb - t, z3a - D.Hcap + t], [vb - t, z3v + t], [b - t, z3v + t], [b - t, z3c]],
        i === 0 ? { label: 'Metal 3 (runs across the page)', lab: [(a + b) / 2, (z3v + z3c) / 2] } : {});
    });
    add('cap3', 'sicn', rect(0, z3c, W, zCap3));
    zTopNow = zCap3;
  }
  if (S.upper) {
    // A break, then a thick top level.
    const zb0 = zCap3, zb1 = zb0 + D.Hbrk;
    add('brk', 'lowk', rect(0, zb0, W, zb1), { op: 0.35, dash: true, label: 'Metals 4–8 (not shown)', lab: [mid, (zb0 + zb1) / 2], brk: true });
    const zt0 = zb1, ztv = zt0 + D.Htop * 0.35, ztc = zt0 + D.Htop;
    add('ildT', 'cvdox', rect(0, zt0, W, ztc));
    const a = W * 0.18, b = W * 0.82, va = mid - D.wV * 1.5, vb = mid + D.wV * 1.5;
    add('mTb', 'ta', [[a, ztc], [a, ztv], [va, ztv], [va, zt0], [vb, zt0], [vb, ztv], [b, ztv], [b, ztc]]);
    const t = D.tbar;
    add('mTc', 'cu', [[a + t, ztc], [a + t, ztv + t], [va + t, ztv + t], [va + t, zt0 + t], [vb - t, zt0 + t], [vb - t, ztv + t], [b - t, ztv + t], [b - t, ztc]], { label: 'Top metal (thick copper)', lab: [W * 0.3, (ztv + ztc) / 2] });
    add('capT', 'sicn', rect(0, ztc, W, ztc + D.Hcap));
    zUpper = ztc + D.Hcap;
    zTopNow = zUpper;
  }
  if (S.bond) {
    const z0 = zUpper, z1 = z0 + D.tal;
    const pa = W * 0.3, pb = W * 0.7, oa = W * 0.37, ob = W * 0.63;
    add('al', 'al', [[pa, z0], [pb, z0], [pb, z1], [pa, z1]], { label: 'Aluminium bond pad', lab: [mid, (z0 + z1) / 2] });
    // Passivation: oxide then nitride over everything, opened over the pad.
    const surf = [[0, z0], [pa, z0], [pa, z1], [pb, z1], [pb, z0], [W, z0]];
    const pass = film(surf, D.tpass);
    add('pass', 'pass', pass, { label: 'Passivation', lab: [W * 0.12, z0 + D.tpass * 0.6] });
    add('passopen', 'void', rect(oa, z1, ob, z1 + D.tpass + 2), { label: 'Pad opening', lab: [mid, z1 + D.tpass * 0.6] });
    zTopNow = z1 + D.tpass;
  }

  // ---------------------------------------------------------------- resist
  if (S.resist) {
    const r = S.resist;
    let covers, base;
    if (r === 'active') { covers = [actN, actP]; base = () => zN; }
    else if (r === 'gate') { covers = [L.gateN, L.gateP]; base = () => D.tgox + D.Hp; }
    else if (r === 'm1') {
      covers = [];
      let x = 0;
      for (const [a, b] of m1Lines) { covers.push([x, a]); x = b; }
      covers.push([x, W]);
      base = () => z1c;
    } else if (r === 'nside' || r === 'pside') {
      covers = r === 'nside' ? [[mid, W]] : [[0, mid]];
      base = null;
    }
    const surf = S.poly === 1 ? offsetPolyline(feolSurface(), D.Hp) : (S.sti >= 3 ? feolSurface() : null);
    covers.forEach((c, i) => {
      let pts;
      if (base) {
        const z = base();
        pts = rect(c[0], z, c[1], z + D.tres);
      } else {
        const bot = clip(surf, c[0], c[1]);
        const zmax = Math.max(...bot.map((p) => p[1]));
        const top = Math.max(zmax + D.tres * 0.55, D.tres);
        pts = [[c[0], top]].concat(bot, [[c[1], top]]);
      }
      add('resist' + i, 'resist', pts, i === 0 ? { label: 'Photoresist', lab: [(c[0] + c[1]) / 2, Math.max(...pts.map((p) => p[1])) - D.tres * 0.35], info: TRUE_NOTE.resist } : {});
    });
  }

  // ---------------------------------------------------------------- annotations
  const top = Math.max(...shapes.map((s) => Math.max(...s.pts.map((p) => p[1]))));
  const annos = [];
  const a = step && step.anno;
  if (a) {
    if (a.kind === 'ions') {
      const open = a.side === 'n' ? [0, mid] : [mid, W];
      const surfAt = (x) => {
        // Where an ion stops: in the resist if covered, else just under the surface.
        const inOpen = x >= open[0] && x <= open[1];
        const res = shapes.filter((s) => s.mat === 'resist');
        let zr = null;
        for (const s of res) {
          const xs = s.pts.map((p) => p[0]);
          if (x > Math.min(...xs) && x < Math.max(...xs)) zr = Math.max(...s.pts.map((p) => p[1]));
        }
        if (!inOpen && zr != null) return { z: zr - D.tres * 0.3, blocked: true };
        const gate = (S.poly === 2) && [L.gateN, L.gateP].some((g) => x >= g[0] - (S.spacer ? D.Wsp + D.toff : 0) && x <= g[1] + (S.spacer ? D.Wsp + D.toff : 0));
        if (gate) return { z: D.tgox + D.Hp * 0.75, blocked: true };
        const sti = L.trenches.some((t) => x < t.b && x > t.a);
        return { z: (sti ? D.hstep : 0) - (step.id.endsWith('well') ? D.Dwell * 0.45 : D.Xj * 0.4), blocked: false };
      };
      const xs = [];
      const n = 26;
      for (let i = 0; i < n; i++) xs.push(W * (i + 0.5) / n);
      annos.push({ kind: 'ions', label: a.label, top: top + D.tres * 0.9, arrows: xs.map((x) => Object.assign({ x }, surfAt(x))) });
    } else {
      annos.push(Object.assign({ top }, a));
    }
  }

  // ---------------------------------------------------------------- bounds
  const zoom = (step && step.zoom) || 'deep';
  let zMin;
  if (zoom === 'deep') zMin = -D.Dwell * 1.08;
  else if (zoom === 'feol') zMin = -(D.Dsti + D.Xj * 0.4);
  else if (zoom === 'mol') zMin = -(D.Xj * 2.2);
  else zMin = -(D.Xj * 1.4);
  const annoTop = annos.length ? Math.max(top, ...annos.map((x) => (x.kind === 'ions' ? x.top : x.top))) : top;
  const bounds = { x0: 0, x1: W, z0: zMin, z1: Math.max(annoTop, zMin + 200) };

  return { shapes, annos, bounds, L, D, top };
}

// Which shapes are new or changed since the previous step: compared by id
// and outline, so the renderer can outline what this step did.
function changed(prev, next) {
  const m = new Map(prev.shapes.map((s) => [s.id, JSON.stringify(s.pts)]));
  const out = new Set();
  for (const s of next.shapes) {
    const p = m.get(s.id);
    if (p === undefined || p !== JSON.stringify(s.pts) ) out.add(s.id);
  }
  return out;
}

/* ----------------------------------------------------------------------------
 * Export
 * ------------------------------------------------------------------------- */

const api = { DIMS, MATS, PHASES, STEPS, STATES, TRUE_NOTE, indexOf, stateAt, geometry, changed, layout, offsetPolyline, film, clip };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  root.Transistors = root.Transistors || {};
  root.Transistors.process = api;
}
})(typeof window !== 'undefined' ? window : globalThis);
