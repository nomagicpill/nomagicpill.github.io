/*
 * knowledge/transistors.html: the device physics behind every chart and
 * the parameter playground. No DOM and no three.js, so it also loads in node:
 *
 *   const P = require('./knowledge/media/transistors/physics.js');
 *   P.device(P.PRESETS.hkmg45.params).metrics();
 *
 * Becomes Transistors.physics in the browser.
 *
 * Units: lengths are given in nm at the edges (params, plots) and converted to
 * cm inside, because the textbook constants are in cm. Doping is cm^-3, charge
 * is C/cm^2, capacitance F/cm^2, energies eV, potentials V, current A.
 *
 * What is exact and what is a teaching model:
 *  - The MOS capacitor (mosCap) solves 1D Poisson-Boltzmann exactly for a
 *    uniformly doped, semi-infinite body: surface potential, band diagram,
 *    charges and C-V. No quantum confinement, no incomplete ionisation.
 *  - The transistor (device) is a compact model in the EKV style: one
 *    expression from subthreshold to strong inversion, plus mobility
 *    degradation, velocity saturation, series resistance, and short-channel
 *    effects from the "natural length" of planar, FinFET and gate-all-around
 *    geometries. Good for trends and the right order of magnitude, not for
 *    signing off a design.
 */
(function (root) {
'use strict';

/* ----------------------------------------------------------------------------
 * Constants and silicon
 * ------------------------------------------------------------------------- */

const Q = 1.602176634e-19;        // C
const KB = 1.380649e-23;          // J/K
const HBAR = 1.054571817e-34;     // J s
const M0 = 9.1093837e-31;         // kg
const EPS0 = 8.8541878128e-14;    // F/cm
const EPS_SI = 11.7 * EPS0;
const EPS_OX = 3.9 * EPS0;
const CHI_SI = 4.05;              // eV, electron affinity of silicon
const NM = 1e-7;                  // cm per nm

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const thermalV = (T) => KB * T / Q;

// Band gap, Varshni form with Thurmond's (1975) silicon constants: 1.124 eV at 300 K.
function bandGap(T) { return 1.170 - 4.73e-4 * T * T / (T + 636); }

// Intrinsic carrier density, Misiakos & Tsamakis (1993): 9.7e9 cm^-3 at 300 K.
function ni(T) { return 5.29e19 * Math.pow(T / 300, 2.54) * Math.exp(-6726 / T); }

// min(a, b), smoothed over about 10 mV (the BSIM form).
function smoothMin(a, b, d = 0.01) {
  const x = b - a - d;
  return b - 0.5 * (x + Math.sqrt(x * x + 4 * d * b));
}

// ln(1 + e^x) without overflow.
function softplus(x) {
  if (x > 35) return x;
  if (x < -35) return Math.exp(x);
  return Math.log1p(Math.exp(x));
}

/* ----------------------------------------------------------------------------
 * Materials
 * ------------------------------------------------------------------------- */

// Gate dielectrics: relative permittivity k, band gap, and the conduction-band
// offset to silicon (eV), from Robertson's compilations (2000, 2004). The
// valence-band offset follows as eg - cbo - Eg(Si). mt is the tunnelling
// effective mass (in m0) used for the gate-leakage estimate.
const DIELECTRICS = {
  sio2: { name: 'SiO₂', k: 3.9, eg: 9.0, cbo: 3.1, mt: 0.40 },
  sion: { name: 'SiON', k: 5.0, eg: 7.6, cbo: 2.8, mt: 0.38 },
  si3n4: { name: 'Si₃N₄', k: 7.5, eg: 5.3, cbo: 2.4, mt: 0.50 },
  al2o3: { name: 'Al₂O₃', k: 9, eg: 8.8, cbo: 2.8, mt: 0.35 },
  hfo2: { name: 'HfO₂', k: 22, eg: 5.8, cbo: 1.5, mt: 0.17 },
  zro2: { name: 'ZrO₂', k: 25, eg: 5.8, cbo: 1.4, mt: 0.15 },
};

// Gate electrodes by work function (eV). Doped poly sits at a band edge;
// the metals are effective work functions on a high-k stack, which can differ
// from their vacuum values (Fermi-level pinning, dipoles at the interfaces).
const GATES = {
  npoly: { name: 'n⁺ poly-Si', wf: 4.05, poly: true },
  ppoly: { name: 'p⁺ poly-Si', wf: 5.17, poly: true },
  al: { name: 'Aluminium', wf: 4.10 },
  nwfm: { name: 'n-type metal (TiAl/TiAlC)', wf: 4.30 },
  w: { name: 'Tungsten', wf: 4.55 },
  tin: { name: 'TiN', wf: 4.65 },
  pwfm: { name: 'p-type metal (TiN-rich)', wf: 4.95 },
};

const PHI_MIDGAP = (T) => CHI_SI + bandGap(T) / 2;

/* ----------------------------------------------------------------------------
 * Bulk silicon: carriers, Fermi level, resistivity
 * ------------------------------------------------------------------------- */

// Caughey-Thomas low-field mobility versus total doping (Arora/Masetti-style
// constants at 300 K), with a T^-2.2 / T^-2.0 lattice term.
function bulkMobility(type, N, T = 300) {
  const t = T / 300;
  if (type === 'n') return 68.5 + (1414 * Math.pow(t, -2.2) - 68.5) / (1 + Math.pow(N / 9.2e16, 0.711));
  return 44.9 + (470.5 * Math.pow(t, -2.0) - 44.9) / (1 + Math.pow(N / 2.23e17, 0.719));
}

// Equilibrium carriers for a uniformly doped body (complete ionisation).
function carriers(type, N, T = 300) {
  const n_i = ni(T);
  const maj = N / 2 + Math.sqrt(N * N / 4 + n_i * n_i);
  const min = n_i * n_i / maj;
  return type === 'n' ? { n: maj, p: min } : { n: min, p: maj };
}

// Fermi level relative to midgap (eV, positive toward Ec) and resistivity.
function bulk(type, N, T = 300) {
  const c = carriers(type, N, T);
  const Ut = thermalV(T);
  const ef = Ut * Math.log(c.n / ni(T));   // EF - Ei
  const rho = 1 / (Q * (c.n * bulkMobility('n', N, T) + c.p * bulkMobility('p', N, T)));
  return { n: c.n, p: c.p, ef, eg: bandGap(T), rho, ni: ni(T) };
}

/* ----------------------------------------------------------------------------
 * The pn junction (abrupt, depletion approximation)
 * ------------------------------------------------------------------------- */

function pnJunction({ Na, Nd, V = 0, T = 300 }) {
  const Ut = thermalV(T);
  const n_i = ni(T);
  const Vbi = Ut * Math.log(Na * Nd / (n_i * n_i));
  const Vj = Math.max(0.02, Vbi - V);   // V > 0 is forward bias
  const W = Math.sqrt(2 * EPS_SI * Vj / Q * (Na + Nd) / (Na * Nd));
  const xn = W * Na / (Na + Nd);
  const xp = W * Nd / (Na + Nd);
  const Emax = Q * Nd * xn / EPS_SI;
  // Ideal diode current density with long-base diffusion (A/cm^2), for scale.
  const Dn = bulkMobility('n', Na, T) * Ut, Dp = bulkMobility('p', Nd, T) * Ut;
  const tau = 1e-6;
  const J0 = Q * n_i * n_i * (Math.sqrt(Dn / tau) / Na + Math.sqrt(Dp / tau) / Nd);
  const J = J0 * (Math.exp(clamp(V / Ut, -60, 60)) - 1);
  return { Vbi, W, xn, xp, Emax, J0, J, Vj };
}

/* ----------------------------------------------------------------------------
 * The MOS capacitor: exact 1D electrostatics
 * ------------------------------------------------------------------------- */

/*
 * mosCap({ body: 'p'|'n', N, T, gateWF, stack: [{mat, t}], Qf })
 *   stack: dielectric layers from the silicon outward, thickness in nm.
 *   Qf: fixed charge at the Si/dielectric interface, in q/cm^2.
 * Returns helpers and constants; solve(VG) gives the state at one bias.
 */
function mosCap(o) {
  const T = o.T || 300;
  const Ut = thermalV(T), beta = 1 / Ut;
  const n_i = ni(T), eg = bandGap(T);
  const pType = o.body !== 'n';
  const N = o.N;
  const c = carriers(pType ? 'p' : 'n', N, T);
  const p0 = c.p, n0 = c.n;
  const phiF = Ut * Math.log(p0 / n_i);          // Ei - EF in the bulk; > 0 for p-type
  const phiS = CHI_SI + eg / 2 + phiF;            // semiconductor work function
  const stack = (o.stack && o.stack.length) ? o.stack : [{ mat: 'sio2', t: o.eot || 2 }];
  const eot = stack.reduce((s, L) => s + L.t * 3.9 / DIELECTRICS[L.mat].k, 0);
  const tPhys = stack.reduce((s, L) => s + L.t, 0);
  const Cox = EPS_OX / (eot * NM);
  const Qf = (o.Qf || 0) * Q;
  const Vfb = o.gateWF - phiS - Qf / Cox;
  const A = Math.sqrt(2 * EPS_SI * KB * T);
  const sigma = pType ? 1 : -1;                   // mirror so "toward inversion" is +

  const fAll = (psi) => {
    const b = beta * psi;
    return p0 * (Math.exp(-b) + b - 1) + n0 * (Math.exp(b) - b - 1);
  };
  const fMaj = (psi) => {
    const b = beta * psi;
    return pType ? p0 * (Math.exp(-b) + b - 1) : n0 * (Math.exp(b) - b - 1);
  };
  const Qs = (psi) => -Math.sign(psi) * A * Math.sqrt(Math.max(0, fAll(psi)));
  const Qb = (psi) => -Math.sign(psi) * A * Math.sqrt(Math.max(0, fMaj(psi)));
  // Field in the silicon where the potential is psi (V/cm), pointing into the bulk for psi > 0.
  const field = (psi) => Math.sign(psi) * Math.sqrt(2 * KB * T / EPS_SI * Math.max(0, fAll(psi)));

  function psiOf(VG) {
    let lo = -3, hi = 3;
    for (let i = 0; i < 90; i++) {
      const m = (lo + hi) / 2;
      if (Vfb + m - Qs(m) / Cox - VG > 0) hi = m; else lo = m;
    }
    return (lo + hi) / 2;
  }

  // Classic threshold (surface at 2*phiF), and the depletion width there.
  const twoPhi = 2 * Math.abs(phiF);
  const Qdep = Math.sqrt(2 * Q * EPS_SI * N * twoPhi);
  const VT = Vfb + sigma * (twoPhi + Qdep / Cox);
  const Wmax = Math.sqrt(2 * EPS_SI * twoPhi / (Q * N));

  function regimeOf(psi) {
    const s = sigma * psi;
    if (s < -Ut) return 'accumulation';
    if (s <= Ut) return 'flat band';
    if (s < Math.abs(phiF)) return 'depletion';
    if (s < twoPhi) return 'weak inversion';
    return 'strong inversion';
  }

  // Potential versus depth, integrating x(psi) = integral dpsi / E(psi) from
  // the surface inward. Returns depth (nm) and psi samples to depthNm.
  function profile(psiS, depthNm) {
    const xs = [0], ps = [psiS];
    if (Math.abs(psiS) > 1e-6) {
      const S = [];
      for (let k = 0; k <= 200; k++) S.push(1 - 0.95 * k / 200);
      for (let k = 1; k <= 80; k++) S.push(0.05 * Math.pow(1e-4 / 0.05, k / 80));
      let x = 0;
      for (let k = 1; k < S.length; k++) {
        const a = psiS * S[k - 1], b = psiS * S[k];
        const e = Math.abs(field((a + b) / 2));
        if (e <= 0) break;
        x += Math.abs(a - b) / e / NM;
        if (x > depthNm) break;
        xs.push(x);
        ps.push(b);
      }
    }
    if (xs[xs.length - 1] < depthNm) { xs.push(depthNm); ps.push(0); }
    return { x: xs, psi: ps };
  }

  // Depletion edge: where the majority-carrier density has recovered to half.
  function depletionWidth(psiS) {
    if (sigma * psiS <= Ut * Math.LN2) return 0;
    const pr = profile(psiS, 1e5);
    const target = sigma * Ut * Math.LN2;
    for (let i = 1; i < pr.x.length; i++) {
      if (sigma * pr.psi[i] <= sigma * target) {
        const t = (pr.psi[i - 1] - target) / (pr.psi[i - 1] - pr.psi[i]);
        return pr.x[i - 1] + t * (pr.x[i] - pr.x[i - 1]);
      }
    }
    return pr.x[pr.x.length - 1];
  }

  function solve(VG) {
    const psiS = psiOf(VG);
    const qs = Qs(psiS), qb = Qb(psiS);
    const qinv = sigma * psiS > 0 ? qs - qb : 0;
    const Vox = -(qs + Qf) / Cox;
    return { VG, psiS, Qs: qs, Qb: qb, Qinv: qinv, Vox, regime: regimeOf(psiS), W: depletionWidth(psiS) };
  }

  // Low-frequency and high-frequency capacitance per area (F/cm^2).
  function capacitance(VG) {
    const psi = psiOf(VG);
    const h = 2e-4;
    const csLF = -(Qs(psi + h) - Qs(psi - h)) / (2 * h);
    const csHF = sigma * psi > 0 ? -(Qb(psi + h) - Qb(psi - h)) / (2 * h) : csLF;
    const ser = (cs) => (cs > 0 ? 1 / (1 / Cox + 1 / cs) : Cox);
    return { LF: ser(csLF), HF: ser(csHF), Cox };
  }

  /*
   * Band diagram at VG, energies in eV with the bulk Fermi level at 0:
   * silicon samples from the interface into the bulk, then the dielectric
   * layers (interface outward), then the gate Fermi level. Positions in nm,
   * with the Si/dielectric interface at x = 0 and the gate at negative x.
   */
  function bands(VG, depthNm = 120) {
    const st = solve(VG);
    const pr = profile(st.psiS, depthNm);
    const EcB = eg / 2 + phiF;
    const si = pr.x.map((x, i) => {
      const psi = pr.psi[i];
      return {
        x, Ec: EcB - psi, Ev: EcB - psi - eg, Ei: phiF - psi,
        n: n0 * Math.exp(clamp(beta * psi, -80, 80)), p: p0 * Math.exp(clamp(-beta * psi, -80, 80)),
      };
    });
    // Dielectrics: D = -(Qs + Qf) everywhere in the stack, field D/eps_i.
    const D = -(st.Qs + Qf);
    let evac = EcB - st.psiS + CHI_SI;   // vacuum level at the silicon surface
    let x = 0;
    const layers = stack.map((L) => {
      const m = DIELECTRICS[L.mat];
      const drop = D * L.t * NM / (m.k * EPS0);   // potential rise toward the gate (V)
      const chi = CHI_SI - m.cbo;
      const a = { mat: L.mat, name: m.name, x0: x, x1: x - L.t, EcIn: evac - chi, EcOut: evac - drop - chi };
      a.EvIn = a.EcIn - m.eg;
      a.EvOut = a.EcOut - m.eg;
      evac -= drop;
      x -= L.t;
      return a;
    });
    return {
      state: st, si, layers, tPhys,
      gate: { x: -tPhys, EF: -VG, wf: o.gateWF, evac: -VG + o.gateWF },
      EF: 0, eg, phiF, chi: CHI_SI, evacSi: EcB - st.psiS + CHI_SI, evacBulk: EcB + CHI_SI,
    };
  }

  return {
    T, Ut, ni: n_i, eg, pType, sigma, N, p0, n0, phiF, phiS, Cox, eot, tPhys, Vfb, VT, Wmax, Qdep, stack, gateWF: o.gateWF,
    Qs, Qb, psiOf, solve, capacitance, bands, profile, regimeOf, depletionWidth,
  };
}

/* ----------------------------------------------------------------------------
 * Gate leakage: direct tunnelling through the stack (rough)
 * ------------------------------------------------------------------------- */

// Each layer contributes exp(-2*kappa*t), kappa from its barrier height (the
// conduction-band offset, lowered by half the voltage across the layer) and
// tunnelling mass. The prefactor is set so 1.0 nm of SiO2 at 1 V passes about
// 100 A/cm^2, the usual reference point; the slope (about 10x per 2 angstroms
// of SiO2) comes out of the physics.
const JG_REF = (() => {
  const k = Math.sqrt(2 * 0.40 * M0 * Q * (3.1 - 0.5)) / HBAR;   // 1/m
  return 100 / Math.exp(-2 * k * 1.0e-9);
})();

function gateLeakage(stack, Vox) {
  const V = Math.abs(Vox);
  if (V < 1e-3) return 0;
  const eot = stack.reduce((s, L) => s + L.t * 3.9 / DIELECTRICS[L.mat].k, 0);
  let expo = 0;
  for (const L of stack) {
    const m = DIELECTRICS[L.mat];
    const Vi = V * (L.t * 3.9 / m.k) / eot;
    const barrier = Math.max(0.05, m.cbo - Vi / 2);
    expo += 2 * Math.sqrt(2 * m.mt * M0 * Q * barrier) / HBAR * L.t * 1e-9;
  }
  return JG_REF * V * V * Math.exp(-expo);   // A/cm^2
}

/* ----------------------------------------------------------------------------
 * The transistor: a compact model
 * ------------------------------------------------------------------------- */

// Universal effective mobility versus the vertical effective field (cm^2/Vs),
// fitted to Takagi et al. (1994) on (100) silicon: electrons about 380, 270
// and 160 at 0.5, 1 and 2 MV/cm. Phonon temperature scaling, Coulomb
// scattering from channel dopants, uniaxial strain, and the (110) sidewalls
// of a fin (slower electrons, faster holes) on top.
function channelMobility(type, Eeff, N, T, strain, arch) {
  const t = T / 300;
  let mu = type === 'n'
    ? 540 / (1 + Math.pow(Eeff / 1.0e6, 1.2))
    : 190 / (1 + Eeff / 4.5e5);
  mu *= Math.pow(t, -1.5);
  if (N > 1e16) {
    const muC = (type === 'n' ? 1100 : 450) * Math.pow(1e18 / N, 0.5);
    mu = 1 / (1 / mu + 1 / muC);
  }
  if (arch === 'finfet') mu *= type === 'n' ? 0.7 : 1.5;
  if (arch === 'gaa') mu *= 0.85;   // thin-body roughness scattering
  if (strain) mu *= type === 'n' ? 1.25 : 1.6;
  return mu;
}

const DEFAULTS = {
  type: 'n',           // 'n' or 'p' channel
  arch: 'planar',      // 'planar' | 'finfet' | 'gaa'
  L: 45,               // gate length, nm
  W: 1,                // effective width, um (currents are also reported per um)
  tsi: 8,              // fin width or nanosheet thickness, nm (multigate only)
  N: 1e18,             // channel/body doping, cm^-3 (planar); light for multigate
  il: 0,               // interfacial SiO2, nm (high-k stacks)
  diel: 'sion',        // main dielectric
  tdiel: 1.4,          // its thickness, nm
  gate: 'npoly',       // key in GATES, or use wf
  wf: null,            // explicit gate work function, eV
  T: 300,              // K
  vdd: 1.0,            // V
  rsd: 200,            // total source+drain series resistance, ohm*um
  strain: false,
  Nsd: 1e20,           // source/drain doping, cm^-3
};

function device(input) {
  const p = Object.assign({}, DEFAULTS, input || {});
  const nType = p.type === 'n';
  const T = p.T, Ut = thermalV(T), n_i = ni(T), eg = bandGap(T);
  const gate = GATES[p.gate] || {};
  const wf = p.wf != null ? p.wf : (gate.wf != null ? gate.wf : 4.6);
  const poly = !!gate.poly && p.wf == null;
  const stack = [];
  if (p.il > 0) stack.push({ mat: 'sio2', t: p.il });
  stack.push({ mat: p.diel, t: p.tdiel });
  const eot = stack.reduce((s, L) => s + L.t * 3.9 / DIELECTRICS[L.mat].k, 0);
  // Electrical thickness in inversion: add the quantum "dark space" (the
  // electrons ride about 1 nm below the interface, ~0.33 nm of oxide) and,
  // for poly gates, the depletion of the gate itself (~0.35 nm).
  const polyDep = poly ? 0.35 : 0;
  const cet = eot + 0.33 + polyDep;
  const Cinv = EPS_OX / (cet * NM);
  const Cdep = EPS_OX / ((eot + polyDep) * NM);
  const Lcm = p.L * NM;
  const multi = p.arch !== 'planar';
  const sgn = nType ? 1 : -1;
  const bodyType = nType ? 'p' : 'n';

  // ---- Electrostatics: long-channel threshold (magnitude, n-convention) ----
  const Nb = multi ? Math.min(p.N, 1e17) : p.N;
  const phiF = Ut * Math.log(Nb / n_i);                  // |Ei - EF| in the body
  const phiSbody = CHI_SI + eg / 2 + (nType ? phiF : -phiF);
  const Vfb = wf - phiSbody;                            // signed
  let VT0, Wd, Qb, n0, psiTh, lambda;
  if (!multi) {
    psiTh = 2 * phiF;
    Wd = Math.sqrt(2 * EPS_SI * psiTh / (Q * Nb));
    Qb = Q * Nb * Wd;
    VT0 = sgn * Vfb + psiTh + Qb / Cdep;                // magnitude for the "on" polarity
    n0 = 1 + (EPS_SI / Wd) / Cdep;
    lambda = Math.sqrt((11.7 / 3.9) * Wd / NM * eot);   // nm
  } else {
    // Thin, (nearly) undoped body that the gate fully depletes: threshold is
    // set by the work function relative to midgap, plus the band bending
    // needed to reach ~1e18 cm^-3 electrons in the film.
    psiTh = Ut * Math.log(1e18 / n_i);
    Wd = p.tsi / 2 * NM;
    Qb = Q * Nb * p.tsi * NM / (p.arch === 'gaa' ? 4 : 2);
    VT0 = sgn * (wf - PHI_MIDGAP(T)) + psiTh + Qb / Cdep;
    n0 = p.arch === 'gaa' ? 1.03 : 1.07;   // a little coupling to the substrate below
    const gates = p.arch === 'gaa' ? 4 : 2;
    lambda = Math.sqrt((11.7 / 3.9) * p.tsi * eot / gates);
  }

  // ---- Short-channel effects from the natural length ----
  // Charge sharing / DIBL (Liu et al., 1993): theta = e^(-L/2l) + 2e^(-L/l).
  const r = p.L / lambda;
  const theta = Math.exp(-r / 2) + 2 * Math.exp(-r);
  const Vbi = multi ? Ut * Math.log(p.Nsd / n_i) : Ut * Math.log(Nb * p.Nsd / (n_i * n_i));
  const dVTroll = 2 * Math.max(0, Vbi - psiTh) * theta;
  const dibl = theta;                                   // V/V
  const nEff = n0 / Math.max(0.12, 1 - 2 * Math.exp(-r / 2));

  // ---- Transport ----
  const type = nType ? 'n' : 'p';
  const vsat0 = 2.4e7 / (1 + 0.8 * Math.exp(T / 600)) * (nType ? 1 : 0.8) * (p.strain ? 1.1 : 1);
  // Modest velocity overshoot in very short channels.
  const vsat = vsat0 * (1 + 0.6 * 20 / (p.L + 20));
  const etaQ = nType ? 0.5 : 1 / 3;
  const VA = Math.max(1, 25 * p.L / 1000 + 0.8 * r);   // channel-length modulation, V
  const Wcm = p.W * 1e-4;

  function VTat(vds) { return VT0 - dVTroll - dibl * vds; }

  // Intrinsic drain current (A), n-convention magnitudes, vds >= 0.
  function intrinsic(vgs, vds) {
    const VT = VTat(vds);
    const n = nEff;
    const Vov = 2 * n * Ut * softplus((vgs - VT) / (2 * n * Ut));
    const Qi = Cinv * Vov;
    const Eeff = (Qb + etaQ * Qi) / EPS_SI;
    const mu = channelMobility(type, Eeff, Nb, T, p.strain, p.arch);
    const EcL = 2 * vsat / mu * Lcm;
    const vd0 = 2 * (Vov / n) / (1 + Math.sqrt(1 + 2 * Vov / (n * EcL)));
    // Two saturating drain voltages: vde (floored at a few kT/q so the
    // subthreshold (1 - e^(-Vds/Ut)) shape survives) drives the charge term;
    // vdv (the velocity-saturation point itself) drives the velocity term, so
    // the current never turns down past saturation.
    const vdsat = Math.sqrt(vd0 * vd0 + 16 * Ut * Ut);
    const vde = smoothMin(vds, vdsat);
    const vdv = smoothMin(vds, vd0);
    const Vp = (vgs - VT) / n;
    const iF = Math.pow(softplus(Vp / (2 * Ut)), 2);
    const iR = Math.pow(softplus((Vp - vde) / (2 * Ut)), 2);
    const I0 = mu * Cinv * (Wcm / Lcm) * 2 * n * Ut * Ut * Math.max(0, iF - iR) / (1 + vdv / EcL);
    return I0 * (1 + (vds - vde) / VA);
  }

  // With series resistance: solve I = f(vgs - I Rs, vds - 2 I Rs).
  const Rs = p.rsd / 2 / p.W;   // ohm per side
  function idsMag(vgs, vds) {
    if (vds < 0) return -idsMag(vgs - vds, -vds);
    const top = intrinsic(vgs, vds);
    if (Rs <= 0 || top <= 0) return top;
    let lo = 0, hi = top;
    for (let i = 0; i < 50; i++) {
      const m = (lo + hi) / 2;
      const f = intrinsic(vgs - m * Rs, Math.max(0, vds - 2 * m * Rs));
      if (m > f) hi = m; else lo = m;
    }
    return (lo + hi) / 2;
  }

  // Signed terminal convention: for PMOS pass negative vgs and vds and get a
  // negative drain current.
  function ids(vgs, vds) {
    return nType ? idsMag(vgs, vds) : -idsMag(-vgs, -vds);
  }

  function vtcc(vds) {
    const target = 1e-7 * p.W / (p.L / 1000);   // 100 nA x W/L
    let lo = -1.5, hi = 3;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (idsMag(m, vds) > target) hi = m; else lo = m;
    }
    return (lo + hi) / 2;
  }

  function oxideVoltage(vgs) {
    const Vov = 2 * nEff * Ut * softplus((vgs - VTat(0)) / (2 * nEff * Ut));
    return (Qb + Cinv * Vov) / (EPS_OX / (eot * NM));
  }

  // Figures of merit at the supply voltage. Currents per um of width.
  function metrics() {
    const vdd = p.vdd;
    const VTlin = vtcc(0.05), VTsat = vtcc(vdd);
    const Ion = idsMag(vdd, vdd) / p.W;
    const Ioff = idsMag(0, vdd) / p.W;
    let SS = Infinity;
    for (let v = VTsat - 0.35; v < VTsat - 0.05; v += 0.01) {
      const a = idsMag(v, vdd), b = idsMag(v + 0.01, vdd);
      if (a > 0 && b > a) SS = Math.min(SS, 0.01 / Math.log10(b / a));
    }
    const Jg = gateLeakage(stack, oxideVoltage(vdd));
    const Ig = Jg * (p.L * NM) * 1e-4;                  // A per um of width
    const Cg = Cinv * (p.L * NM) * 1e-4 + 0.35e-15;     // F per um, with ~0.35 fF/um fringe and overlap
    const tau = Ion > 0 ? Cg * vdd / Ion : Infinity;
    return {
      VTlin: sgn * VTlin, VTsat: sgn * VTsat, VT0: sgn * VT0, DIBL: (VTlin - VTsat) / (vdd - 0.05),
      SS: SS * 1000, Ion, Ioff, ratio: Ioff > 0 ? Ion / Ioff : Infinity, Jg, Ig, tau, Cg,
      eot, cet, lambda, Lratio: r, nEff, vsat, Rs,
    };
  }

  // Channel picture for the stage: along the channel (0..1), the local
  // channel voltage, inversion charge relative to the source end, and the
  // depletion depth (nm); plus the pinch-off point if saturated.
  function channel(vgs, vds) {
    const vg = Math.abs(vgs), vd = Math.max(0, Math.abs(vds));
    const VT = VTat(vd);
    const n = nEff;
    const Vov = 2 * n * Ut * softplus((vg - VT) / (2 * n * Ut));
    const Vovl = Math.max(0, vg - VT);
    const Eeff = (Qb + etaQ * Cinv * Vov) / EPS_SI;
    const mu = channelMobility(type, Eeff, Nb, T, p.strain, p.arch);
    const EcL = 2 * vsat / mu * Lcm;
    const vd0 = 2 * (Vov / n) / (1 + Math.sqrt(1 + 2 * Vov / (n * EcL)));
    const vde = Math.min(vd, vd0);
    const sat = vd > vd0 + 0.02 && Vovl > 0.02;
    const pinch = sat ? clamp(1 - 0.08 * Math.log1p((vd - vd0) / 0.1), 0.6, 0.98) : 1;
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const y = i / 40;
      let V;
      if (y <= pinch) {
        // Gradual channel: (Vov V - n V^2/2) grows linearly with position.
        const yy = y / pinch;
        const total = Vov * vde - n * vde * vde / 2;
        const target = yy * total;
        const disc = Math.max(0, Vov * Vov - 2 * n * target);
        V = (Vov - Math.sqrt(disc)) / n;
      } else {
        V = vde + (vd - vde) * (y - pinch) / (1 - pinch);
      }
      const qrel = Vov > 0 ? Math.max(0, (Vov - n * V) / Vov) : 0;
      const wdep = multi ? p.tsi / 2 : Math.sqrt(2 * EPS_SI * (psiTh + V) / (Q * Nb)) / NM;
      pts.push({ y, V, q: y > pinch ? qrel * 0.05 : qrel, wdep });
    }
    const Wj = Math.sqrt(2 * EPS_SI * (Vbi + vd) / (Q * Nb)) / NM;   // drain junction depletion, nm
    const Wj0 = Math.sqrt(2 * EPS_SI * Vbi / (Q * Nb)) / NM;
    return { pts, pinch, sat, Vov, VT, vdsat: vd0, Wj, Wj0, Wd: Wd / NM, qScale: Cinv * Vov / Q };
  }

  return {
    p, nType, eot, cet, Cinv, stack, VT0: sgn * VT0, VTmag: VT0, dVTroll, dibl, nEff, lambda, Vbi, phiF, Wd: Wd / NM,
    poly, wf, Vfb, ids, idsMag, vtcc, metrics, channel, VTat, oxideVoltage, bodyType,
  };
}

// The same device as a PMOS: an n-type body, and the gate mirrored about
// midgap (n+ poly becomes p+ poly; a work function 0.3 eV below midgap
// becomes one 0.3 eV above it), so the threshold keeps its magnitude.
function asType(params, type) {
  const q = Object.assign({}, DEFAULTS, params, { type });
  if (type !== 'p') return q;
  if (q.wf != null) q.wf = 2 * PHI_MIDGAP(300) - q.wf;
  else if (q.gate === 'npoly') q.gate = 'ppoly';
  else if (q.gate === 'nwfm') q.gate = 'pwfm';
  return q;
}

/* ----------------------------------------------------------------------------
 * Presets: one representative NMOS per era. Dimensions, oxides and supplies
 * are typical published values; the channel doping (planar) or work function
 * (multigate) was then tuned so off-state leakage lands near what each era
 * accepted (about 1e-14 A/um in 1985, 30-100 nA/um for high-performance
 * logic since 130 nm). Drive currents then come out within about 15% of
 * Intel's published 90, 45 and 22 nm numbers.
 * ------------------------------------------------------------------------- */

const PRESETS = {
  um1985: {
    label: '1985 · 1.5 µm',
    note: '5 V NMOS: 25 nm of oxide, n⁺ poly gate, long channel.',
    params: { arch: 'planar', L: 1200, N: 4.8e16, il: 0, diel: 'sio2', tdiel: 25, gate: 'npoly', vdd: 5, rsd: 1500, strain: false },
  },
  nm350: {
    label: '1995 · 350 nm',
    note: '3.3 V, 7 nm oxide, the start of "deep submicron."',
    params: { arch: 'planar', L: 300, N: 3.4e17, il: 0, diel: 'sio2', tdiel: 7, gate: 'npoly', vdd: 3.3, rsd: 700, strain: false },
  },
  nm130: {
    label: '2001 · 130 nm',
    note: 'The flow on this page: 1.6 nm oxynitride, poly gate, 60 nm gate length.',
    params: { arch: 'planar', L: 60, N: 1.8e18, il: 0, diel: 'sion', tdiel: 1.6, gate: 'npoly', vdd: 1.2, rsd: 300, strain: false },
  },
  nm90: {
    label: '2003 · 90 nm strained',
    note: 'Intel\'s 90 nm: 1.2 nm oxide, 50 nm gates, and the first strained silicon.',
    params: { arch: 'planar', L: 50, N: 2.45e18, il: 0, diel: 'sion', tdiel: 1.2, gate: 'npoly', vdd: 1.2, rsd: 260, strain: true },
  },
  hkmg45: {
    label: '2007 · 45 nm HKMG',
    note: 'Hafnium-based high-k with metal gates: thicker film, thinner electrical oxide, far less leakage.',
    params: { arch: 'planar', L: 35, N: 3.9e18, il: 0.6, diel: 'hfo2', tdiel: 2.0, gate: null, wf: 4.12, vdd: 1.0, rsd: 220, strain: true },
  },
  planar22: {
    label: '"22 nm" planar (what-if)',
    note: 'The planar transistor pushed one node too far. Compare its leakage with the FinFET.',
    params: { arch: 'planar', L: 26, N: 6.1e18, il: 0.5, diel: 'hfo2', tdiel: 1.8, gate: null, wf: 4.12, vdd: 0.8, rsd: 200, strain: true },
  },
  finfet22: {
    label: '2012 · 22 nm FinFET',
    note: 'Intel\'s tri-gate: an 8 nm wide fin, gate on three sides, nearly undoped.',
    params: { arch: 'finfet', L: 26, tsi: 8, N: 1e16, il: 0.5, diel: 'hfo2', tdiel: 1.8, gate: null, wf: 4.345, vdd: 0.8, rsd: 200, strain: true },
  },
  gaa2: {
    label: '2025 · 2 nm-class GAA',
    note: 'Stacked nanosheets about 5 nm thick, gate on all four sides.',
    params: { arch: 'gaa', L: 14, tsi: 5, N: 1e16, il: 0.5, diel: 'hfo2', tdiel: 1.5, gate: null, wf: 4.36, vdd: 0.7, rsd: 160, strain: true },
  },
};

/* ----------------------------------------------------------------------------
 * Process physics for the toolbox widgets
 * ------------------------------------------------------------------------- */

// Deal-Grove thermal oxidation (Deal & Grove 1965 constants, (111) silicon;
// (100) linear rate is 1.68x slower). Returns thickness in nm after t hours.
function dealGrove({ ambient = 'dry', T_C = 1000, hours = 1, orientation = 100, x0 = null }) {
  const kT = KB * (T_C + 273.15) / Q;
  const c = ambient === 'wet'
    ? { B0: 386, EB: 0.78, BA0: 1.63e8, EBA: 2.05 }
    : { B0: 772, EB: 1.23, BA0: 6.23e6, EBA: 2.0 };
  const B = c.B0 * Math.exp(-c.EB / kT);                 // um^2/h
  let BA = c.BA0 * Math.exp(-c.EBA / kT);                // um/h
  if (orientation === 100) BA /= 1.68;
  const A = B / BA;
  const xi = x0 != null ? x0 / 1000 : (ambient === 'dry' ? 0.025 : 0);   // dry: the 25 nm "initial regime"
  const tau = (xi * xi + A * xi) / B;
  const x = A / 2 * (Math.sqrt(1 + (hours + tau) / (A * A / (4 * B))) - 1);
  return { nm: x * 1000, B, BA, A, tau };
}

// Projected range and straggle (nm) by species and energy (keV): LSS-style
// tables (Gibbons et al.), interpolated in log-log. BF2 uses boron at 11/49
// of the energy.
const RANGE = {
  B: [[1, 5.5, 4], [5, 19, 11], [10, 33.3, 17.1], [20, 66.2, 28.3], [30, 98.7, 37.1], [50, 160.8, 50.9], [100, 297, 72], [200, 528.6, 95.9], [500, 1100, 130], [1000, 1800, 150]],
  P: [[5, 7.8, 3.9], [10, 13.9, 6.5], [30, 38.8, 16], [50, 61.5, 24.6], [100, 123.5, 45.9], [200, 252, 80], [500, 640, 150], [1000, 1200, 210]],
  As: [[2, 4.5, 1.7], [5, 6.5, 2.4], [10, 9.9, 3.6], [30, 23.1, 8.4], [50, 32.2, 11.8], [100, 58.2, 20.7], [200, 115, 39], [500, 290, 85]],
};

function implantRange(species, keV) {
  let sp = species, E = keV;
  if (species === 'BF2') { sp = 'B'; E = keV * 11 / 49; }
  const t = RANGE[sp];
  if (E <= t[0][0]) return { Rp: t[0][1] * E / t[0][0], dRp: t[0][2] * E / t[0][0] };
  for (let i = 1; i < t.length; i++) {
    if (E <= t[i][0]) {
      const f = Math.log(E / t[i - 1][0]) / Math.log(t[i][0] / t[i - 1][0]);
      const lg = (a, b) => Math.exp(Math.log(a) + f * (Math.log(b) - Math.log(a)));
      return { Rp: lg(t[i - 1][1], t[i][1]), dRp: lg(t[i - 1][2], t[i][2]) };
    }
  }
  const last = t[t.length - 1];
  return { Rp: last[1] * E / last[0], dRp: last[2] };
}

// Intrinsic diffusivity (cm^2/s): D0 exp(-Ea/kT).
const DIFFUSION = { B: [0.76, 3.46], BF2: [0.76, 3.46], P: [3.85, 3.66], As: [0.066, 3.44] };
function diffusivity(species, T_C) {
  const [D0, Ea] = DIFFUSION[species];
  return D0 * Math.exp(-Ea / (KB * (T_C + 273.15) / Q));
}

/*
 * Implanted and annealed profile: a Gaussian with the dose conserved,
 * broadened by sqrt(2 D t). Returns samples N(x) (cm^-3) to depthNm, the
 * junction depth against the background, and the sheet resistance of the
 * layer (ohm/sq) using concentration-dependent mobility and an activation
 * fraction that rises with anneal temperature.
 */
function implantProfile({ species = 'As', keV = 30, dose = 1e15, background = 1e17, anneal_C = 1050, anneal_s = 1, depthNm = null }) {
  const { Rp, dRp } = implantRange(species, keV);
  const Dt = anneal_C ? diffusivity(species, anneal_C) * anneal_s : 0;   // cm^2
  const sig = Math.sqrt(Math.pow(dRp * NM, 2) + 2 * Dt) / NM;            // nm
  if (depthNm == null) depthNm = Math.max(50, Rp + 5 * sig);
  const xs = [], Ns = [];
  const peak = dose / (Math.sqrt(2 * Math.PI) * sig * NM);
  // Reflect at the surface so dose that would sit above it is kept (a cheap
  // stand-in for surface pile-up and outdiffusion losses).
  const at = (x) => peak * (Math.exp(-0.5 * Math.pow((x - Rp) / sig, 2)) + Math.exp(-0.5 * Math.pow((x + Rp) / sig, 2)));
  let xj = null;
  for (let i = 0; i <= 300; i++) {
    const x = depthNm * i / 300;
    const N = at(x);
    xs.push(x); Ns.push(N);
    if (xj === null && i > 0 && x > Rp && N < background) xj = x;
  }
  // Activation: a solid-solubility-like cap that rises with temperature.
  const act = anneal_C ? clamp((anneal_C - 550) / 500, 0.05, 1) : 0.02;
  const nType = species === 'P' || species === 'As';
  const cap = nType ? (species === 'As' ? 3e20 : 5e20) : 2e20;
  let G = 0;   // sheet conductance
  const dx = depthNm / 300 * NM;
  for (let i = 0; i < xs.length; i++) {
    if (xj !== null && xs[i] > xj) break;
    const Na = Math.min(Ns[i] * act, cap * act + 1e10);
    const net = Na - background;
    if (net <= 0) continue;
    G += Q * net * bulkMobility(nType ? 'n' : 'p', Na + background) * dx;
  }
  return { x: xs, N: Ns, depthNm, Rp, dRp, sigma: sig, peak, xj, Rs: G > 0 ? 1 / G : Infinity, act, Dt };
}

// Four-point probe: sheet resistance from V/I for a thin layer on a large
// wafer (s << diameter), Rs = (pi / ln 2) V / I; for a thick, semi-infinite
// sample instead rho = 2 pi s V / I.
const FPP_K = Math.PI / Math.LN2;   // 4.532

// Lithography: Rayleigh resolution and depth of focus.
const LITHO = [
  { id: 'g', name: 'g-line (mercury lamp)', lambda: 436, na: 0.35, year: 1982 },
  { id: 'i', name: 'i-line (mercury lamp)', lambda: 365, na: 0.57, year: 1990 },
  { id: 'krf', name: 'KrF excimer laser', lambda: 248, na: 0.80, year: 1996 },
  { id: 'arf', name: 'ArF excimer (dry)', lambda: 193, na: 0.93, year: 2003 },
  { id: 'arfi', name: 'ArF immersion', lambda: 193, na: 1.35, year: 2007 },
  { id: 'euv', name: 'EUV', lambda: 13.5, na: 0.33, year: 2019 },
  { id: 'hna', name: 'High-NA EUV', lambda: 13.5, na: 0.55, year: 2026 },
];
function rayleigh(lambda, na, k1 = 0.3, k2 = 0.5) {
  return { R: k1 * lambda / na, DOF: k2 * lambda / (na * na) };
}

// Gross dies per wafer and yield models.
function diesPerWafer(diamMm, dieMm2, edgeMm = 3) {
  const d = diamMm - 2 * edgeMm;
  return Math.max(0, Math.floor(Math.PI * d * d / 4 / dieMm2 - Math.PI * d / Math.sqrt(2 * dieMm2)));
}
function yieldModels(D0perCm2, dieMm2, alpha = 2) {
  const AD = D0perCm2 * dieMm2 / 100;
  return {
    poisson: Math.exp(-AD),
    murphy: AD > 0 ? Math.pow((1 - Math.exp(-AD)) / AD, 2) : 1,
    negbin: Math.pow(1 + AD / alpha, -alpha),
  };
}

/* ----------------------------------------------------------------------------
 * Scaling history (approximate; see the Sources topic)
 * ------------------------------------------------------------------------- */

// Flagship chips: year, name, transistors, process.
const CHIPS = [
  [1971, 'Intel 4004', 2.3e3, '10 µm'],
  [1974, 'Intel 8080', 4.5e3, '6 µm'],
  [1978, 'Intel 8086', 2.9e4, '3 µm'],
  [1982, 'Intel 80286', 1.34e5, '1.5 µm'],
  [1985, 'Intel 80386', 2.75e5, '1.5 µm'],
  [1989, 'Intel 80486', 1.2e6, '1 µm'],
  [1993, 'Pentium', 3.1e6, '800 nm'],
  [1995, 'Pentium Pro', 5.5e6, '350 nm'],
  [1997, 'Pentium II', 7.5e6, '350 nm'],
  [1999, 'Pentium III', 9.5e6, '250 nm'],
  [2000, 'Pentium 4', 4.2e7, '180 nm'],
  [2004, 'Pentium 4 (Prescott)', 1.25e8, '90 nm'],
  [2006, 'Core 2 Duo', 2.91e8, '65 nm'],
  [2008, 'Core i7 (Nehalem)', 7.31e8, '45 nm'],
  [2012, 'Core i7 (Ivy Bridge)', 1.4e9, '22 nm'],
  [2016, 'Nvidia GP100', 1.53e10, '16 nm'],
  [2018, 'Apple A12', 6.9e9, '7 nm'],
  [2020, 'Apple M1', 1.6e10, '5 nm'],
  [2022, 'Nvidia H100', 8.0e10, '4N'],
  [2023, 'Apple M3 Max', 9.2e10, '3 nm'],
  [2024, 'Nvidia B200 (2 dies)', 2.08e11, '4NP'],
  [2026, 'Nvidia Rubin (2 dies)', 3.36e11, 'N3P'],
];

// Logic nodes: year of volume production, physical gate length, contacted
// gate pitch, tightest metal pitch (nm), supply (V), and what arrived.
const NODES = [
  { year: 1971, node: '10 µm', Lg: 10000, vdd: 15, what: 'PMOS, aluminium gate' },
  { year: 1978, node: '3 µm', Lg: 3000, vdd: 5, what: 'NMOS, poly-Si self-aligned gate' },
  { year: 1985, node: '1.5 µm', Lg: 1500, vdd: 5, what: 'CMOS takes over' },
  { year: 1989, node: '1 µm', Lg: 1000, vdd: 5, what: 'LOCOS isolation, LDD spacers' },
  { year: 1993, node: '800 nm', Lg: 800, vdd: 3.3, what: 'Supply drops below 5 V' },
  { year: 1995, node: '350 nm', Lg: 350, vdd: 3.3, what: 'Shallow trench isolation, CMP' },
  { year: 1997, node: '250 nm', Lg: 200, vdd: 2.5, what: 'KrF (248 nm) lithography' },
  { year: 1999, node: '180 nm', Lg: 130, vdd: 1.8, what: 'Copper interconnect (IBM, 1997)' },
  { year: 2001, node: '130 nm', Lg: 70, vdd: 1.3, what: 'Cu + low-k, nickel/cobalt silicide' },
  { year: 2003, node: '90 nm', Lg: 50, cpp: 260, mp: 220, vdd: 1.2, what: 'Strained silicon; ArF (193 nm)' },
  { year: 2005, node: '65 nm', Lg: 35, cpp: 220, mp: 210, vdd: 1.1, what: 'Second-generation strain' },
  { year: 2007, node: '45 nm', Lg: 35, cpp: 160, mp: 160, vdd: 1.0, what: 'High-k / metal gate' },
  { year: 2009, node: '32 nm', Lg: 30, cpp: 112.5, mp: 112.5, vdd: 1.0, what: 'Immersion lithography' },
  { year: 2011, node: '22 nm', Lg: 26, cpp: 90, mp: 80, vdd: 0.8, what: 'FinFET (tri-gate)' },
  { year: 2014, node: '14 nm', Lg: 20, cpp: 70, mp: 52, vdd: 0.75, what: 'Self-aligned double patterning' },
  { year: 2018, node: '7 nm', Lg: 18, cpp: 57, mp: 40, vdd: 0.75, what: 'Quadruple patterning; EUV at Samsung' },
  { year: 2020, node: '5 nm', Lg: 16, cpp: 51, mp: 28, vdd: 0.7, what: 'EUV on many layers' },
  { year: 2022, node: '3 nm', Lg: 16, cpp: 48, mp: 23, vdd: 0.7, what: 'First gate-all-around (Samsung)' },
  { year: 2025, node: '2 nm / 18A', Lg: 14, cpp: 45, mp: 21, vdd: 0.7, what: 'Nanosheets (TSMC); backside power (Intel)' },
  { year: 2026, node: 'A16 / 14A', Lg: 13, cpp: 45, mp: 20, vdd: 0.65, what: 'Backside power at TSMC; high-NA EUV readies' },
];

// Single-thread era markers for the Dennard chart: year, clock (MHz), power (W).
const CLOCKS = [
  [1971, 0.74, 1], [1978, 5, 1.5], [1982, 8, 3], [1985, 16, 2], [1989, 25, 5], [1993, 66, 15],
  [1995, 200, 35], [1997, 300, 40], [1999, 600, 30], [2000, 1500, 55], [2002, 3060, 80],
  [2004, 3800, 115], [2006, 2930, 75], [2008, 3200, 130], [2012, 3500, 77], [2016, 4200, 91],
  [2020, 5300, 125], [2023, 6000, 253], [2025, 5700, 250],
];

/* ----------------------------------------------------------------------------
 * Export
 * ------------------------------------------------------------------------- */

const api = {
  Q, KB, EPS0, EPS_SI, EPS_OX, CHI_SI, NM,
  thermalV, bandGap, ni, softplus, clamp,
  DIELECTRICS, GATES, PHI_MIDGAP,
  bulkMobility, carriers, bulk, pnJunction,
  mosCap, gateLeakage, channelMobility, device, asType, DEFAULTS, PRESETS,
  dealGrove, implantRange, diffusivity, implantProfile, FPP_K,
  LITHO, rayleigh, diesPerWafer, yieldModels,
  CHIPS, NODES, CLOCKS,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  root.Transistors = root.Transistors || {};
  root.Transistors.physics = api;
}
})(typeof window !== 'undefined' ? window : globalThis);
