/*
 * knowledge/cameraskills.html: the model. Exposure arithmetic, the lens, depth
 * of field, blur estimates and the camera's auto-exposure logic for a
 * Fujifilm X-T30 III with the XC 13-33mm F3.5-6.3 OIS. No DOM, no three.js;
 * exports to node (module.exports) so it can be checked from the command line.
 *
 * Units: focal lengths and sensor sizes in millimetres, distances in metres
 * unless a name says otherwise, shutter times in seconds, EV at ISO 100.
 */
(function (root) {
'use strict';

/* ---- The sensor (X-Trans CMOS 4, APS-C) ---- */
const SENSOR = {
  w: 23.5, h: 15.6,           // mm
  px: 6240, py: 4160,         // 26.1 MP
  crop: 43.27 / Math.hypot(23.5, 15.6),   // ~1.53x against 35mm film
  coc: 0.02,                  // mm: the usual APS-C circle of confusion
  baseISO: 160,
};
SENSOR.pitch = SENSOR.w / SENSOR.px;      // mm per pixel, ~3.8 micrometres

/* ---- Stops, in thirds, the way the camera steps them ---- */
const APERTURES = [1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22];
const SHUTTER_LABELS = ['1/4000', '1/3200', '1/2500', '1/2000', '1/1600', '1/1250', '1/1000', '1/800', '1/640', '1/500',
  '1/400', '1/320', '1/250', '1/200', '1/160', '1/125', '1/100', '1/80', '1/60', '1/50', '1/40', '1/30', '1/25', '1/20',
  '1/15', '1/13', '1/10', '1/8', '1/6', '1/5', '1/4', '0.3"', '0.4"', '0.5"', '0.6"', '0.8"', '1"', '1.3"', '1.6"', '2"',
  '2.5"', '3.2"', '4"'];
const ISOS = [160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800];

// Exact values behind the nominal labels (1/125 is really 1/128, f/5.6 is 5.66).
const apertureAt = (i) => Math.pow(2, (3 + i) / 6);
const shutterAt = (i) => Math.pow(2, -12 + i / 3);
const isoAt = (i) => 100 * Math.pow(2, (i + 2) / 3);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const log2 = (x) => Math.log(x) / Math.LN2;

const apertureIndex = (N) => clamp(Math.round(6 * log2(N) - 3), 0, APERTURES.length - 1);
const shutterIndex = (t) => clamp(Math.round(3 * (log2(t) + 12)), 0, SHUTTER_LABELS.length - 1);
const isoIndex = (iso) => clamp(Math.round(3 * log2(iso / 100) - 2), 0, ISOS.length - 1);

/* ---- Lenses ---- */
const LENSES = {
  kit: {
    id: 'kit', name: 'XC 13-33mm F3.5-6.3 OIS', fmin: 13, fmax: 33, wide: 3.5, tele: 6.3, min: 22,
    close: 0.2, ois: 3.5,       // Fujifilm quotes 4.0 stops; a little less in real hands
  },
  // A what-if lens, to show what a wide aperture buys. Not part of the kit.
  prime: { id: 'prime', name: '33mm F1.4 prime (what if)', fmin: 33, fmax: 33, wide: 1.4, tele: 1.4, min: 16, close: 0.3, ois: 0 },
};

// Widest aperture at a focal length. Fujifilm publishes only the two ends;
// in between this interpolates smoothly, which is how such zooms behave.
function maxAperture(lens, f) {
  if (lens.fmax === lens.fmin) return lens.wide;
  const k = clamp(Math.log(f / lens.fmin) / Math.log(lens.fmax / lens.fmin), 0, 1);
  return lens.wide * Math.pow(lens.tele / lens.wide, k);
}
// The same, as an index into APERTURES (the widest setting the dial will offer).
function maxApertureIndex(lens, f) { return apertureIndex(maxAperture(lens, f)); }

/* ---- Field of view ---- */
const deg = (r) => r * 180 / Math.PI;
function fov(f) {
  return {
    h: deg(2 * Math.atan(SENSOR.w / (2 * f))),
    v: deg(2 * Math.atan(SENSOR.h / (2 * f))),
    d: deg(2 * Math.atan(Math.hypot(SENSOR.w, SENSOR.h) / (2 * f))),
  };
}
const equivalent = (f) => f * SENSOR.crop;
// Width of the scene that fits across the frame at a distance (metres).
const frameWidthAt = (f, dist) => dist * SENSOR.w / f;

/* ---- Exposure ---- */
// The EV (at ISO 100) of the scene brightness these settings expose correctly.
function settingsEV(N, t, iso) { return log2(N * N / t) - log2(iso / 100); }

/* ---- Depth of field ---- */
function hyperfocal(f, N, coc) { return (f * f / (N * (coc || SENSOR.coc)) + f) / 1000; }   // metres
function dof(f, N, s, coc) {
  const H = hyperfocal(f, N, coc) * 1000, S = s * 1000;
  const near = S * (H - f) / (H + S - 2 * f);
  const far = S < H ? S * (H - f) / (H - S) : Infinity;
  return { near: near / 1000, far: far / 1000, total: (far - near) / 1000, H: H / 1000 };
}
// Blur-disc diameter on the sensor (mm) of a point at distance d, focused at s.
function blurDisc(f, N, s, d) {
  const S = s * 1000, D = d * 1000;
  return f * f * Math.abs(D - S) / (N * D * (S - f));
}
// The largest that disc gets, for something infinitely far behind the subject.
function blurAtInfinity(f, N, s) { return f * f / (N * (s * 1000 - f)); }
// Diffraction: diameter of the Airy disc (mm) for green light.
const airy = (N) => 2.44 * 0.00055 * N;

/* ---- Sharpness: hands and subjects ---- */
// Angular tremor of a hand-held camera, rad/s. Chosen so that 1/(equivalent
// focal length) seconds smears about one circle of confusion: the old rule.
const TREMOR = 0.025;
// Blur on the sensor (mm) from hand shake over an exposure.
function shakeBlur(f, t, oisStops) { return TREMOR * t * f / Math.pow(2, oisStops || 0); }
// Slowest hand-holdable speed (s) for a blur of one circle of confusion.
function handholdLimit(f, oisStops) { return SENSOR.coc * Math.pow(2, oisStops || 0) / (TREMOR * f); }
// Blur on the sensor (mm) from a subject crossing the frame at `speed` m/s.
function motionBlur(f, t, speed, dist) { return speed * t * f / dist; }
// Shutter time (s) that holds a crossing subject to `mm` of blur.
function freezeTime(f, speed, dist, mm) { return (mm || SENSOR.coc) * dist / (speed * f); }

/* ---- Noise (a simple shot + read noise model, tuned for the screen) ---- */
// Standard deviation of a linear pixel value `H` (0.18 = middle grey).
function noiseSigma(H, iso) {
  const g = iso / SENSOR.baseISO;
  return Math.sqrt(5e-5 * Math.max(H, 0) * g + 1.2e-7 * g * g);
}

/* ---- Auto exposure: what the camera does in P, A and S (and M with auto ISO) ----
 *
 * `meterEV` is the scene brightness the meter read, as an EV at ISO 100.
 * `user` = { mode, ap, sh, iso (indices), isoAuto, comp (stops),
 *            minShutter (s), maxISO }.
 * Returns the settings actually used plus `error`: stops over (+) or under (-)
 * the exposure the meter asked for once compensation is counted. In the auto
 * modes that is zero unless the camera ran out of range, which is exactly
 * when the real camera turns its numbers red.
 *
 * Everything is index arithmetic in thirds of a stop:
 *   3 * EV100 = (ap + 3) + (36 - sh) - (iso + 2)
 */
function resolveExposure(user, meterEV, lens, f) {
  const wideI = maxApertureIndex(lens, f), minI = apertureIndex(lens.min);
  const tMaxI = SHUTTER_LABELS.length - 1;
  const isoMaxI = isoIndex(user.maxISO || 6400);
  const want = Math.round((meterEV - (user.comp || 0)) * 3);
  let ap = clamp(user.ap, wideI, minI), sh = clamp(user.sh, 0, tMaxI);
  let iso = user.isoAuto ? 0 : clamp(user.iso, 0, ISOS.length - 1);
  const minShI = shutterIndex(user.minShutter || 1 / 125);

  const evThirds = (a, s, i) => (a + 3) + (36 - s) - (i + 2);
  const solveShutter = (a, i) => clamp(36 + (a + 3) - (i + 2) - want, 0, tMaxI);
  const solveAperture = (s, i) => clamp(want - (36 - s) + (i + 2) - 3, wideI, minI);
  const solveISO = (a, s) => clamp((a + 3) + (36 - s) - want - 2, 0, isoMaxI);

  const mode = user.mode;
  if (mode === 'A') {
    if (user.isoAuto) {
      sh = solveShutter(ap, 0);
      if (sh > minShI) {                // too slow: hold the minimum speed, raise ISO
        sh = minShI;
        iso = solveISO(ap, sh);
        if (evThirds(ap, sh, iso) > want) sh = solveShutter(ap, iso);   // ISO ran out
      }
    } else sh = solveShutter(ap, iso);
  } else if (mode === 'S') {
    if (user.isoAuto) {
      ap = solveAperture(sh, 0);
      if (evThirds(ap, sh, 0) > want) { ap = wideI; iso = solveISO(ap, sh); }
    } else ap = solveAperture(sh, iso);
  } else if (mode === 'P') {
    const i0 = user.isoAuto ? 0 : iso;
    ap = wideI;
    sh = solveShutter(ap, i0);
    if (sh > minShI && user.isoAuto) {
      sh = minShI;
      iso = solveISO(ap, sh);
      if (evThirds(ap, sh, iso) > want) sh = solveShutter(ap, iso);
    } else if (sh < minShI) {
      // Bright: split the spare light between a smaller aperture and a faster speed.
      const spare = minShI - sh;
      ap = clamp(wideI + Math.floor(spare / 2), wideI, Math.min(minI, apertureIndex(11)));
      sh = solveShutter(ap, i0);
    }
  } else if (user.isoAuto) {            // M with auto ISO
    iso = solveISO(ap, sh);
  }

  const used = evThirds(ap, sh, iso);
  return {
    mode, ap, sh, iso,
    N: apertureAt(ap), t: shutterAt(sh), ISO: isoAt(iso),
    labelN: APERTURES[ap], labelT: SHUTTER_LABELS[sh], labelISO: ISOS[iso],
    ev: used / 3,
    error: (want - used) / 3,            // + over, - under the metered target
    brightness: meterEV - used / 3,      // stops the picture sits above the meter's grey
    wideI, minI,
  };
}

/* ---- Film simulations (approximate looks for the on-screen preview) ----
 * sat: saturation, con: contrast, bw: monochrome, lift: faded blacks,
 * sh/hi: colour pushed into shadows / highlights. `dial` marks the six
 * printed on the film simulation dial. */
const FILMSIMS = [
  { id: 'provia', name: 'PROVIA / Standard', dial: 'STD', sat: 1.0, con: 1.0, lift: 0, sh: [0, 0, 0], hi: [0, 0, 0], note: 'The neutral default. Honest colour, medium contrast.' },
  { id: 'velvia', name: 'Velvia / Vivid', dial: 'V', sat: 1.45, con: 1.18, lift: 0, sh: [0, 0, 0.01], hi: [0, 0, 0], note: 'Saturated and punchy. Landscapes and blue skies; rough on skin.' },
  { id: 'astia', name: 'ASTIA / Soft', dial: 'S', sat: 1.12, con: 0.92, lift: 0.005, sh: [0, 0, 0], hi: [0.01, 0, 0], note: 'Soft contrast with lively colour. Kind to skin outdoors.' },
  { id: 'classicchrome', name: 'CLASSIC CHROME', dial: 'CC', sat: 0.72, con: 1.12, lift: 0, sh: [-0.008, 0.004, 0.012], hi: [0.008, 0.004, -0.004], note: 'Muted colour, firm shadows. The documentary and street look.' },
  { id: 'realaace', name: 'REALA ACE', dial: 'RA', sat: 0.96, con: 1.03, lift: 0, sh: [0, 0, 0], hi: [0, 0, 0], note: 'True-to-life colour with slightly crisper tones than Provia.' },
  { id: 'acros', name: 'ACROS', dial: 'A', sat: 0, con: 1.16, bw: 1, lift: 0, sh: [0, 0, 0], hi: [0, 0, 0], note: 'Rich black and white with fine grain. Light and shape over colour.' },
  { id: 'pronegstd', name: 'PRO Neg. Std', sat: 0.85, con: 0.88, lift: 0.006, sh: [0, 0, 0], hi: [0, 0, 0], note: 'Flat and gentle. Portraits in controlled light.' },
  { id: 'proneghi', name: 'PRO Neg. Hi', sat: 0.9, con: 1.06, lift: 0, sh: [0, 0, 0], hi: [0, 0, 0], note: 'Portrait colour with a little more bite.' },
  { id: 'classicneg', name: 'CLASSIC Neg.', sat: 0.86, con: 1.24, lift: 0.004, sh: [-0.012, 0.01, 0.006], hi: [0.014, 0, -0.008], note: 'Hard contrast, greenish shadows, warm highlights. Snapshot nostalgia.' },
  { id: 'nostalgicneg', name: 'NOSTALGIC Neg.', sat: 1.0, con: 0.94, lift: 0.012, sh: [0.008, 0.002, -0.004], hi: [0.02, 0.008, -0.012], note: 'Amber highlights and soft, open shadows. 1970s colour prints.' },
  { id: 'eterna', name: 'ETERNA / Cinema', sat: 0.66, con: 0.8, lift: 0.014, sh: [0, 0.002, 0.004], hi: [0, 0, 0], note: 'Low contrast, low saturation. Made for video; calm for stills.' },
  { id: 'bleach', name: 'ETERNA BLEACH BYPASS', sat: 0.45, con: 1.38, lift: 0, sh: [0, 0, 0.004], hi: [0, 0, 0], note: 'Drained colour, hard contrast. Gritty.' },
  { id: 'mono', name: 'MONOCHROME', sat: 0, con: 1.0, bw: 1, lift: 0, sh: [0, 0, 0], hi: [0, 0, 0], note: 'Plain black and white.' },
  { id: 'sepia', name: 'SEPIA', sat: 0, con: 0.95, bw: 1, lift: 0.01, sh: [0.03, 0.012, -0.02], hi: [0.05, 0.02, -0.04], note: 'Brown-toned black and white.' },
];

/* ---- What it takes to freeze things: speeds (m/s) across the frame ---- */
const SUBJECTS = [
  { id: 'still', name: 'Someone posing', speed: 0.1 },
  { id: 'talk', name: 'People talking, gesturing', speed: 0.5 },
  { id: 'walk', name: 'Walking', speed: 1.4 },
  { id: 'kid', name: 'A child running', speed: 3 },
  { id: 'bike', name: 'A city cyclist', speed: 5.5 },
  { id: 'dog', name: 'A dog at full tilt', speed: 9 },
];

const THIRDS = ['', '⅓', '⅔'];
const fmt = {
  shutter: (i) => SHUTTER_LABELS[i],
  aperture: (i) => 'f/' + APERTURES[i],
  iso: (i) => String(ISOS[i]),
  seconds(t) { return SHUTTER_LABELS[shutterIndex(t)]; },
  dist(m) {
    if (!isFinite(m)) return '∞';
    if (m < 1) return Math.round(m * 100) + ' cm';
    return (m < 10 ? m.toFixed(1) : Math.round(m)) + ' m';
  },
  // Stops in thirds: +1⅓, −⅔, ±0.
  stops(s) {
    const n = Math.round(Math.abs(s) * 3), whole = Math.floor(n / 3), frac = THIRDS[n % 3];
    if (n === 0) return '±0';
    return (s > 0 ? '+' : '−') + (whole || !frac ? whole : '') + frac;
  },
};

const api = {
  SENSOR, APERTURES, SHUTTER_LABELS, ISOS, LENSES, FILMSIMS, SUBJECTS, TREMOR,
  apertureAt, shutterAt, isoAt, apertureIndex, shutterIndex, isoIndex,
  maxAperture, maxApertureIndex, fov, equivalent, frameWidthAt, settingsEV,
  hyperfocal, dof, blurDisc, blurAtInfinity, airy, shakeBlur, handholdLimit, motionBlur, freezeTime,
  noiseSigma, resolveExposure, fmt, clamp, log2,
};

root.CameraSkills = root.CameraSkills || {};
root.CameraSkills.optics = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
