/*
 * knowledge/cameraskills.html: wires the model (optics.js), the stage
 * (scene.js, with body.js and world.js, loaded only if WebGL works), the
 * figures (widgets.js) and the explainer shell (js/explainer.js) together.
 *
 * A topic picks what the stage shows with attributes on its <section>:
 *   data-stage="body"   the camera; data-part selects a control, data-view a side
 *   data-stage="world"  the viewfinder; data-shot names a preset in SHOTS
 *   (neither)           the stage stays as it was
 * Inside a topic, any element with data-shot applies that preset (usually a
 * partial one: just a pose, or just a setting), data-part points at a control,
 * and <ol class="cs-walk"> becomes a step-by-step walkthrough.
 *
 * Practice shots are <article class="cs-shot">; this file adds the settings
 * form, the copy-the-prompt button and the done box to each.
 */
(function (CS) {
'use strict';
const { init: initExplainer, cssVar, onThemeChange } = window.Explainer;
const O = CS.optics, W = CS.widgets;
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
const clamp = O.clamp;
const deg = (r) => r * 180 / Math.PI;
const root = document.documentElement;

let stage = null, EXP = null;

/* ----------------------------------------------------------------------------
 * Presets: where the photographer stands, the light, and the settings
 * ------------------------------------------------------------------------- */

// Stand at (px,py,pz) and point the camera at (tx,ty,tz), zoomed to f mm.
function look(px, py, pz, tx, ty, tz, f, extra) {
  const dx = tx - px, dy = ty - py, dz = tz - pz;
  return Object.assign({ x: px, y: py, z: pz, yaw: deg(Math.atan2(dx, -dz)), pitch: deg(Math.atan2(dy, Math.hypot(dx, dz))), roll: 0, f }, extra || {});
}

const BASE = {
  light: 'sunny', lens: 'kit', film: 'provia', wb: 'auto', portrait: false, paused: false, ois: true,
  user: { mode: 'A', ap: 5.6, sh: 1 / 250, iso: 'auto', comp: 0, minShutter: 1 / 125, maxISO: 6400 },
  focus: { mode: 'face', point: [0, 0] }, tab: 'exposure',
  overlays: { thirds: false, level: false, plan: true, hist: true, zebra: false },
};

const FRIEND = [39.4, 1.5, -62];      // aim point: your friend's collarbone
const SHOTS = {
  /* the four places */
  street: { place: 'street', pose: look(1.2, 1.6, 13, 0.4, 1.9, -12, 18), light: 'sunny' },
  plaza: { place: 'plaza', pose: look(0, 1.6, -46.5, 0, 8, -80, 13), light: 'sunny' },
  park: { place: 'park', pose: look(37.6, 1.5, -63.6, FRIEND[0], FRIEND[1], FRIEND[2], 33), light: 'overcast' },
  room: { place: 'room', pose: look(200.3, 1.45, 2.55, 200.2, 1.0, -1, 15), light: 'window' },

  /* photo science */
  'sci-exposure': { place: 'street', pose: look(1.2, 1.6, 13, 0.4, 1.9, -12, 18), light: 'sunny', user: { mode: 'M', ap: 8, sh: 1 / 500, iso: 160 } },
  'sci-aperture': { place: 'park', pose: look(37.65, 1.5, -63.6, FRIEND[0], FRIEND[1], FRIEND[2], 33), light: 'overcast', user: { ap: 6.3 } },
  'ap-wide': { lens: 'kit', user: { ap: 6.3 } }, 'ap-small': { lens: 'kit', user: { ap: 22 } }, 'ap-prime': { lens: 'prime', user: { ap: 1.4 } },
  'sci-shutter': { place: 'street', pose: look(5.2, 1.5, -22, -3, 1.3, -22.4, 13), light: 'overcast', user: { mode: 'S', sh: 1 / 500 }, focus: { mode: 'point' } },
  'sh-fast': { user: { mode: 'S', sh: 1 / 1000 } }, 'sh-mid': { user: { mode: 'S', sh: 1 / 60 } }, 'sh-slow': { user: { mode: 'S', sh: 1 / 15 } },
  'sh-shake': { place: 'plaza', pose: look(0, 1.6, -47, 0, 22, -86, 33), light: 'dusk', ois: false, user: { mode: 'S', sh: 1 / 8 } },
  'sh-ois': { ois: true }, 'sh-noois': { ois: false },
  'sci-iso': { place: 'room', pose: look(200.3, 1.4, 2.5, 200.2, 0.95, -0.8, 14), light: 'evening', user: { mode: 'A', ap: 3.5, iso: 3200 } },
  'iso-low': { user: { iso: 160 } }, 'iso-mid': { user: { iso: 3200 } }, 'iso-high': { user: { iso: 12800 } }, 'iso-auto': { user: { iso: 'auto' } },
  'sci-triangle': { place: 'street', pose: look(1.2, 1.6, 13, 0.4, 1.9, -12, 18), light: 'overcast' },
  'sci-metering': { place: 'room', pose: look(200.5, 1.3, 1.4, 200.2, 1.15, -3, 23), light: 'window', overlays: { zebra: true } },
  'comp-zero': { user: { comp: 0 } }, 'comp-plus': { user: { comp: 1.67 } }, 'comp-minus': { user: { comp: -1 } },
  'meter-night': { place: 'street', pose: look(1.2, 1.6, 6, 0.4, 2.2, -14, 16), light: 'night', user: { mode: 'A', ap: 3.5, comp: 0 }, overlays: { zebra: true } },
  'sci-focal': { place: 'plaza', pose: look(0, 1.6, -45.6, 0, 6, -80, 13), light: 'sunny', user: { ap: 8 }, tab: 'lens' },
  'f-13': { pose: { f: 13 } }, 'f-18': { pose: { f: 18 } }, 'f-23': { pose: { f: 23 } }, 'f-33': { pose: { f: 33 } },
  'persp-wide': { place: 'park', pose: look(38.83, 1.5, -62.57, FRIEND[0], FRIEND[1], FRIEND[2], 13), light: 'overcast' },
  'persp-tele': { place: 'park', pose: look(37.96, 1.5, -63.44, FRIEND[0], FRIEND[1], FRIEND[2], 33), light: 'overcast' },
  'sci-dof': { place: 'park', pose: look(39.9, 0.75, -71.4, FRIEND[0], 1.2, FRIEND[2], 28), light: 'overcast', user: { ap: 5.6 }, tab: 'lens' },
  'dof-near': { focus: { mode: 'manual', dist: 2.2 } }, 'dof-far': { focus: { mode: 'face' } }, 'dof-deep': { user: { ap: 16 } }, 'dof-open': { user: { ap: 5.6 } },
  'zone': { place: 'street', pose: look(3.6, 1.5, 6, 4.2, 1.4, -10, 13), light: 'sunny', user: { ap: 8 }, focus: { mode: 'manual', dist: 2.5 }, tab: 'lens' },
  'sci-focus': { place: 'street', pose: look(2.6, 1.6, 3, 4.2, 1.4, -8, 23), light: 'sunny', tab: 'lens' },
  'af-face': { focus: { mode: 'face' } }, 'af-point': { focus: { mode: 'point', point: [0, 0] } },
  'sci-light': { place: 'park', pose: look(37.6, 1.55, -63.6, FRIEND[0], FRIEND[1], FRIEND[2], 30), light: 'sunny', tab: 'scene' },
  'l-sunny': { light: 'sunny' }, 'l-overcast': { light: 'overcast' }, 'l-golden': { light: 'golden' }, 'l-dusk': { light: 'dusk' },
  'wb-auto': { wb: 'auto' }, 'wb-daylight': { wb: 'daylight' }, 'wb-shade': { wb: 'shade' }, 'wb-tungsten': { wb: 'tungsten' },
  'wb-room': { place: 'room', pose: look(200.3, 1.45, 2.55, 200.2, 1.0, -1, 15), light: 'evening', user: { ap: 3.5 }, tab: 'scene' },
  'sci-color': { place: 'plaza', pose: look(-5.5, 1.6, -47.5, 1, 6.5, -78, 16), light: 'golden', user: { ap: 8 }, tab: 'scene' },
  'sci-drive': { place: 'room', pose: look(200.3, 1.1, 2.6, 200.1, 0.8, 0.9, 16), light: 'window', user: { mode: 'S', sh: 1 / 500 } },
  'sci-modes': { place: 'street', pose: look(1.2, 1.6, 13, 0.4, 1.9, -12, 18), light: 'sunny' },
  'm-P': { user: { mode: 'P' } }, 'm-A': { user: { mode: 'A' } }, 'm-S': { user: { mode: 'S' } }, 'm-M': { user: { mode: 'M' } },

  /* framing: a weak version and a better one of the same picture */
  'subj-weak': { place: 'street', pose: look(-4.4, 1.6, -1.5, 5.75, 1.3, -8.2, 13), light: 'sunny', user: { ap: 8 }, tab: 'compose' },
  'subj-strong': { place: 'street', pose: look(3.55, 1.45, -7.35, 5.75, 1.36, -8.2, 23), light: 'sunny', user: { ap: 8 }, tab: 'compose' },
  'thirds-weak': { place: 'plaza', pose: look(0, 1.6, -47, 0, 1.6, -86, 15), light: 'sunny', user: { ap: 8 }, tab: 'compose', overlays: { thirds: true } },
  'thirds-strong': { place: 'plaza', pose: look(-6.5, 1.5, -48.5, 2.6, 8.3, -68.5, 15), light: 'sunny', user: { ap: 8 }, tab: 'compose', overlays: { thirds: true } },
  'lines-weak': { place: 'street', pose: look(4.4, 1.6, 12, 6, 3.4, 0, 18), light: 'golden', user: { ap: 8 }, tab: 'compose' },
  'lines-strong': { place: 'street', pose: look(0, 0.7, 15, 0, 3.4, -43, 23), light: 'golden', user: { ap: 8 }, tab: 'compose' },
  'layers-weak': { place: 'plaza', pose: look(0, 1.6, -64.5, 0, 9, -86, 15), light: 'sunny', user: { ap: 8 }, tab: 'compose' },
  'layers-strong': { place: 'plaza', pose: look(4.9, 1.0, -54.6, 0.3, 6.5, -80, 15), light: 'sunny', user: { ap: 11 }, tab: 'compose' },
  'frame-weak': { place: 'plaza', pose: look(0, 1.6, -45.5, 0, 9.5, -86, 20), light: 'sunny', user: { ap: 8 }, tab: 'compose' },
  'frame-strong': { place: 'street', pose: look(0, 1.6, -26, 0, 6.5, -86, 20), light: 'sunny', user: { ap: 11 }, tab: 'compose' },
  'angle-weak': { place: 'room', pose: look(201.9, 1.75, 2.35, 200.0, 0.5, 0.9, 15), light: 'window', user: { mode: 'S', sh: 1 / 500 }, tab: 'compose', time: 0.37, paused: true },
  'angle-strong': { place: 'room', pose: look(201.9, 0.7, 2.35, 200.0, 0.72, 0.9, 18), light: 'window', user: { mode: 'S', sh: 1 / 500 }, tab: 'compose', time: 0.37, paused: true },
  'bg-weak': { place: 'park', pose: look(36.95, 1.55, -61.42, FRIEND[0], 1.4, FRIEND[2], 23), light: 'overcast', user: { ap: 5 }, tab: 'compose' },
  'bg-strong': { place: 'park', pose: look(37.5, 1.5, -63.9, FRIEND[0], 1.4, FRIEND[2], 33), light: 'overcast', user: { ap: 6.3 }, tab: 'compose' },
  'light-front': { place: 'park', pose: look(39.15, 1.52, -59.1, FRIEND[0], FRIEND[1], FRIEND[2], 30), light: 'golden', tab: 'compose' },
  'light-side': { place: 'park', pose: look(36.6, 1.52, -63.4, FRIEND[0], FRIEND[1], FRIEND[2], 30), light: 'golden', tab: 'compose' },
  'light-back': { place: 'park', pose: look(39.65, 1.52, -64.9, FRIEND[0], FRIEND[1], FRIEND[2], 30), light: 'golden', tab: 'compose' },
  'moment-early': { place: 'street', pose: look(0.6, 1.5, -3.5, 0.2, 1.2, -12, 30), light: 'sunny', user: { ap: 8 }, tab: 'compose', time: 14.63, paused: true },
  'moment-right': { place: 'street', pose: look(0.6, 1.5, -3.5, 0.2, 1.2, -12, 30), light: 'sunny', user: { ap: 8 }, tab: 'compose', time: 2.304, paused: true },
  'moment-live': { paused: false },
  'level-weak': { place: 'plaza', pose: look(3, 1.6, -60, 0.5, 17, -86, 13, { roll: 3.5 }), light: 'sunny', user: { ap: 8 }, tab: 'compose', overlays: { level: true, thirds: true } },
  'level-strong': { place: 'plaza', pose: look(0, 1.6, -45.2, 0, 1.6, -86, 13), light: 'sunny', user: { ap: 8 }, tab: 'compose', portrait: true, overlays: { level: true, thirds: true } },
  'port-weak': { place: 'park', pose: look(38.9, 1.8, -62.5, FRIEND[0], FRIEND[1], FRIEND[2], 13), light: 'overcast', tab: 'compose' },
  'port-strong': { place: 'park', pose: look(38.06, 1.46, -63.34, FRIEND[0], FRIEND[1], FRIEND[2], 33), light: 'overcast', user: { ap: 6.3 }, tab: 'compose', portrait: true },
  'space-weak': { place: 'street', pose: look(5.2, 1.5, -21, -1.3, 1.2, -25, 18), light: 'overcast', user: { mode: 'S', sh: 1 / 1000 }, focus: { mode: 'face' }, tab: 'compose', time: 0.909, paused: true },
  'space-strong': { place: 'street', pose: look(5.2, 1.5, -21, -1.3, 1.2, -21.2, 18), light: 'overcast', user: { mode: 'S', sh: 1 / 1000 }, focus: { mode: 'face' }, tab: 'compose', time: 0.909, paused: true },

  /* situations */
  'sit-street': { place: 'street', pose: look(3.9, 1.5, 4, 4.3, 1.4, -10, 18), light: 'sunny', film: 'classicchrome', user: { mode: 'A', ap: 8, iso: 'auto', minShutter: 1 / 250 } },
  'sit-travel': { place: 'plaza', pose: look(-6.5, 1.5, -48.5, 2.6, 8.3, -68.5, 15), light: 'golden', film: 'velvia', user: { mode: 'A', ap: 8, iso: 'auto' } },
  'sit-portrait': { place: 'park', pose: look(37.55, 1.46, -63.3, FRIEND[0], FRIEND[1], FRIEND[2], 33), light: 'overcast', film: 'astia', portrait: true, user: { mode: 'A', ap: 6.3, iso: 'auto' } },
  'sit-action': { place: 'room', pose: look(200.1, 0.8, 2.7, 200.0, 0.75, 0.9, 16), light: 'window', film: 'realaace', user: { mode: 'S', sh: 1 / 500, iso: 'auto', maxISO: 12800 } },
  'sit-night': { place: 'street', pose: look(1.2, 1.6, 6, 0.4, 2.2, -14, 13), light: 'night', film: 'classicneg', user: { mode: 'A', ap: 3.5, iso: 'auto', minShutter: 1 / 60, maxISO: 12800, comp: -0.67 } },
};
const PLACES = [['street', 'Street'], ['plaza', 'Square'], ['park', 'Park'], ['room', 'Living room']];

/* ----------------------------------------------------------------------------
 * State of the virtual camera's controls
 * ------------------------------------------------------------------------- */
const S = JSON.parse(JSON.stringify(BASE));
S.place = 'street';
let tapLock = false;

function userForStage() {
  const u = S.user;
  return {
    mode: u.mode, ap: O.apertureIndex(u.ap), sh: O.shutterIndex(u.sh),
    iso: u.iso === 'auto' ? 0 : O.isoIndex(u.iso), isoAuto: u.iso === 'auto',
    comp: u.comp, minShutter: u.minShutter, maxISO: u.maxISO,
  };
}

function applyShot(key, opts) {
  const shot = typeof key === 'string' ? SHOTS[key] : key;
  if (!shot || !stage) return;
  const o = opts || {};
  if (o.base) {
    const b = JSON.parse(JSON.stringify(BASE));
    Object.assign(S, b);
    stage.world.vf.time = 3;
  }
  ['light', 'lens', 'film', 'wb', 'portrait', 'paused', 'ois', 'tab', 'place'].forEach((k) => { if (shot[k] !== undefined) S[k] = shot[k]; });
  if (shot.user) Object.assign(S.user, shot.user);
  if (shot.focus) Object.assign(S.focus, shot.focus);
  if (shot.overlays) Object.assign(S.overlays, shot.overlays);
  if (shot.time !== undefined) stage.world.vf.time = shot.time;
  const w = stage.world;
  w.setLens(S.lens);
  if (shot.light || o.base) w.setLight(S.light);
  w.setFilm(S.film);
  w.vf.wb = S.wb; w.vf.ois = S.ois; w.vf.paused = S.paused; w.vf.zebra = S.overlays.zebra;
  if (w.vf.portrait !== S.portrait) w.setPortrait(S.portrait);
  w.setFocus({ mode: S.focus.mode, dist: S.focus.dist || w.vf.focus.dist, point: S.focus.point || [0, 0] });
  // A lens with one focal length pins the zoom.
  if (shot.pose) w.setPose(shot.pose, { fly: !!o.fly });
  S.user.ap = O.APERTURES[clamp(O.apertureIndex(S.user.ap), O.maxApertureIndex(w.vf.lens, (shot.pose && shot.pose.f) || w.vf.f), O.apertureIndex(w.vf.lens.min))];
  w.setUser(userForStage());
  syncDock();
}

/* ----------------------------------------------------------------------------
 * Layout: tell the stage which part of the window is free
 * ------------------------------------------------------------------------- */
const dock = $('#dock'), drawer = $('#xp-drawer'), vfEl = $('#vf');
function layoutStage() {
  if (!stage) return;
  const Wd = window.innerWidth, Hd = window.innerHeight, wide = Wd > 900, open = root.classList.contains('xp-drawer-open');
  const tb = $('.xp-topbar').getBoundingClientRect();
  const top = Math.max(wide ? 60 : 50, tb.bottom + 6);
  let right = Wd - 8, bottom = Hd - 8;
  const d = dock.getBoundingClientRect();
  if (d.height) bottom = d.top - 8;
  if (open && wide) right = Wd - Math.min(470, 0.44 * Wd) - 8;
  if (open && !wide) bottom = Math.min(bottom, Hd - Math.min(0.62 * Hd, 720) - 6);
  stage.setRect({ x: 8, y: top, w: Math.max(140, right - 8), h: Math.max(110, bottom - top) });
}

/* ----------------------------------------------------------------------------
 * The two stage modes
 * ------------------------------------------------------------------------- */
let stageMode = '';
function setStage(mode) {
  if (!stage || stageMode === mode) return;
  stageMode = mode;
  root.dataset.csStage = mode;
  stage.setMode(mode);
  $('#dock-body').hidden = mode !== 'body';
  $('#dock-world').hidden = mode !== 'world';
  vfEl.hidden = mode !== 'world';
  $('#tip').hidden = true;
  layoutStage();
}

/* ----------------------------------------------------------------------------
 * Viewfinder overlays
 * ------------------------------------------------------------------------- */
const hud = {
  af: $('#vf-af'), info: $('#vf-info'), warn: $('#vf-warn'), mode: $('#vf-mode'), sh: $('#vf-sh'), ap: $('#vf-ap'),
  iso: $('#vf-iso'), mark: $('#vf-scale i'), comp: $('#vf-comp'), hist: $('#vf-hist'), plan: $('#vf-plan'), level: $('#vf-level i'),
};
let frameRect = { x: 0, y: 0, w: 300, h: 200 }, frameCount = 0, lastShot = null;

function onLayout(fr) {
  frameRect = fr;
  vfEl.style.left = fr.x + 'px'; vfEl.style.top = fr.y + 'px'; vfEl.style.width = fr.w + 'px'; vfEl.style.height = fr.h + 'px';
  vfEl.classList.toggle('cs-small', fr.w < 520);
}

const stopsWord = (v) => O.fmt.stops(v).slice(1) + (Math.round(Math.abs(v) * 3) <= 3 ? ' stop' : ' stops');
function warnings(sn) {
  const r = sn.resolved, out = [];
  if (r.error < -0.3) out.push([4, 'Too dark by ' + stopsWord(r.error) + ': the camera has run out of ' + (r.mode === 'S' ? 'aperture and ISO' : 'shutter speed and ISO')]);
  if (r.error > 0.3) out.push([4, 'Too bright by ' + stopsWord(r.error) + ': ' + (r.mode === 'M' ? 'pick a faster speed, smaller aperture or lower ISO' : 'the settings cannot go low enough')]);
  if (sn.shakeSensorPx > 16) out.push([sn.shakeSensorPx > 40 ? 4 : 2, 'Camera shake: ' + r.labelT + ' is too slow to hand-hold at ' + Math.round(sn.pose.f) + 'mm' + (sn.ois ? ', even stabilised' : ' with the stabiliser off')]);
  if (sn.subject && sn.subject.blurSensorPx > 16) out.push([sn.subject.blurSensorPx > 40 ? 4 : 2, sn.subject.name + ' will blur at ' + r.labelT]);
  if (sn.subject && sn.stats.defocus > 2.2 && sn.af && !sn.af.face) out.push([2, sn.subject.name + ' is outside the sharp zone']);
  if (sn.hist.hi > 0.05) out.push([2, 'Highlights clipping: ' + Math.round(sn.hist.hi * 100) + '% pure white']);
  if (r.ISO >= 6300) out.push([1, 'ISO ' + r.labelISO + ': grain']);
  return out.slice(0, 3);
}

function onFrame(sn) {
  lastShot = sn;
  frameCount++;
  // Focus box: every frame, it has to keep up with a walking subject.
  const a = sn.af;
  if (a.manual) hud.af.hidden = true;
  else {
    hud.af.hidden = false;
    const sz = a.face ? clamp(a.size * frameRect.h * 2.2, 26, 150) : 34;
    hud.af.style.width = hud.af.style.height = sz + 'px';
    hud.af.style.transform = 'translate(' + ((a.x * 0.5 + 0.5) * frameRect.w - sz / 2) + 'px,' + ((-a.y * 0.5 + 0.5) * frameRect.h - sz / 2) + 'px)';
    hud.af.dataset.face = String(!!a.face); hud.af.dataset.locked = String(!!a.locked);
  }
  if (S.overlays.level) hud.level.style.transform = 'rotate(' + sn.pose.roll.toFixed(2) + 'deg)';
  if (frameCount % 4 === 0) {
    const r = sn.resolved, u = S.user;
    hud.mode.textContent = r.mode;
    hud.sh.textContent = r.labelT; hud.ap.textContent = 'F' + r.labelN; hud.iso.textContent = 'ISO ' + r.labelISO;
    hud.sh.dataset.own = String(r.mode === 'S' || r.mode === 'M');
    hud.ap.dataset.own = String(r.mode === 'A' || r.mode === 'M');
    hud.iso.dataset.own = String(u.iso !== 'auto');
    const bad = Math.abs(r.error) > 0.3;
    hud.sh.dataset.bad = hud.ap.dataset.bad = String(bad && r.mode !== 'M');
    const mark = r.mode === 'M' && u.iso !== 'auto' ? r.error : u.comp;
    hud.mark.style.left = (50 + clamp(mark, -3, 3) / 3 * 50) + '%';
    hud.comp.textContent = O.fmt.stops(mark);
    const f = sn.pose.f, d = sn.dof;
    hud.info.textContent = Math.round(f) + 'mm (' + Math.round(O.equivalent(f)) + ' equiv.) · focus ' + O.fmt.dist(sn.focusDist) + ' · sharp ' + O.fmt.dist(d.near) + ' to ' + O.fmt.dist(d.far);
    const ws = warnings(sn);
    const html = ws.map((w) => '<li><span class="xp-status" data-level="' + w[0] + '">' + w[1] + '</span></li>').join('');
    if (hud.warn.dataset.html !== html) { hud.warn.innerHTML = html; hud.warn.dataset.html = html; }
    syncAuto(r);
  }
  if (S.overlays.plan && frameCount % 3 === 0) drawPlan();
}

function onHistogram(h) {
  if (!S.overlays.hist) return;
  const c = hud.hist, g = c.getContext('2d'), Wc = c.width, Hc = c.height;
  g.clearRect(0, 0, Wc, Hc);
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, Wc, Hc);
  let max = 1;
  for (let i = 1; i < 47; i++) max = Math.max(max, h.bins[i]);
  for (let i = 0; i < 48; i++) {
    const v = Math.min(1, h.bins[i] / max), edge = (i === 47 && h.hi > 0.02) || (i === 0 && h.lo > 0.1);
    g.fillStyle = edge ? '#ff6b5e' : 'rgba(255,255,255,0.86)';
    g.fillRect(i * Wc / 48, Hc - v * (Hc - 4), Wc / 48 - 1, v * (Hc - 4));
  }
}

// The scene from above: field of view, the plane of focus, the sharp zone.
function drawPlan() {
  const c = hud.plan, g = c.getContext('2d'), Wc = c.width, Hc = c.height, p = stage.world.plan();
  g.clearRect(0, 0, Wc, Hc);
  g.fillStyle = 'rgba(0,0,0,0.52)'; g.fillRect(0, 0, Wc, Hc);
  const range = clamp(Math.max(p.focusDist * 1.9, isFinite(p.dof.far) ? p.dof.far * 1.15 : p.focusDist * 3, 5), 4, 80);
  const k = (Hc - 46) / range, cx = Wc / 2, cy = Hc - 26, half = p.hfov / 2 * Math.PI / 180;
  const wedge = (r0, r1) => { g.beginPath(); g.arc(cx, cy, r1, -Math.PI / 2 - half, -Math.PI / 2 + half); g.arc(cx, cy, r0, -Math.PI / 2 + half, -Math.PI / 2 - half, true); g.closePath(); };
  wedge(0, range * k * 1.2); g.fillStyle = 'rgba(255,255,255,0.10)'; g.fill();
  wedge(p.dof.near * k, Math.min(range * 1.2, p.dof.far) * k); g.fillStyle = 'rgba(110,168,254,0.45)'; g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, p.focusDist * k, -Math.PI / 2 - half, -Math.PI / 2 + half); g.stroke();
  // Subjects, turned into the camera's frame of reference.
  const yw = p.yaw * Math.PI / 180, sn = Math.sin(yw), cs = Math.cos(yw);
  p.subjects.forEach((s) => {
    const dx = s.x - p.pos.x, dz = s.z - p.pos.z, fwd = dx * sn - dz * cs, side = dx * cs + dz * sn;
    if (fwd < -1 || fwd > range * 1.25 || Math.abs(side) * k > Wc / 2) return;
    g.fillStyle = s.main ? '#ffd166' : '#ffffff';
    g.beginPath(); g.arc(cx + side * k, cy - fwd * k, s.main ? 5 : 3.5, 0, 7); g.fill();
  });
  g.fillStyle = '#ffffff'; g.fillRect(cx - 8, cy - 2, 16, 11); g.fillRect(cx - 3, cy - 7, 6, 6);
  g.font = '20px Arial, Helvetica, sans-serif'; g.textAlign = 'left';
  g.fillText('focus ' + O.fmt.dist(p.focusDist), 8, 24);
  g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText(Math.round(range) + ' m', Wc - 8, 24);
}

/* ----------------------------------------------------------------------------
 * The dock
 * ------------------------------------------------------------------------- */
const K = {};       // range inputs by name
function field(name) { return { input: $('#k-' + name), out: $('#k-' + name + '-out') }; }
function setTab(tab) {
  S.tab = tab;
  $$('[data-tab]', dock).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('[data-panel]', dock).forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  requestAnimationFrame(layoutStage);
}
const press = (el, on) => el.setAttribute('aria-pressed', String(!!on));
const distToSlider = (d) => 100 * Math.log(d / 0.2) / Math.log(500);
const sliderToDist = (v) => 0.2 * Math.pow(500, v / 100);

// Push S to the controls (after a preset, or any change).
function syncDock() {
  if (!stage) return;
  const w = stage.world, u = S.user, lens = w.vf.lens, pose = w.getPose();
  setTab(S.tab);
  $$('[data-mode]', dock).forEach((b) => press(b, b.dataset.mode === u.mode));
  K.ap.input.min = O.maxApertureIndex(lens, pose.f); K.ap.input.max = O.apertureIndex(lens.min);
  K.comp.input.value = Math.round(u.comp * 3); K.comp.out.textContent = O.fmt.stops(u.comp);
  press($('#tg-isoauto'), u.iso === 'auto');
  K.fl.input.min = lens.fmin; K.fl.input.max = lens.fmax; K.fl.input.disabled = lens.fmin === lens.fmax;
  K.fl.input.value = Math.round(pose.f); K.fl.out.textContent = Math.round(pose.f) + 'mm (' + Math.round(O.equivalent(pose.f)) + ' equiv.)';
  $$('[data-focus]', dock).forEach((b) => press(b, b.dataset.focus === S.focus.mode));
  K.fd.input.disabled = S.focus.mode !== 'manual';
  $('#sel-lens').value = S.lens; press($('#tg-ois'), S.ois);
  $('#sel-place').value = S.place;
  const lsel = $('#sel-light'), where = S.place === 'room' ? 'in' : 'out';
  lsel.textContent = '';
  w.LIGHTS.filter((l) => l.where === where).forEach((l) => { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; lsel.appendChild(o); });
  lsel.value = S.light;
  $('#sel-film').value = S.film; $('#sel-wb').value = S.wb;
  press($('#btn-pause'), S.paused); $('#btn-pause').textContent = S.paused ? 'Resume' : 'Pause';
  K.height.input.value = pose.y.toFixed(2); K.height.out.textContent = pose.y.toFixed(1) + ' m';
  K.roll.input.value = pose.roll; K.roll.out.textContent = pose.roll.toFixed(1) + '°';
  press($('#tg-portrait'), S.portrait);
  ['thirds', 'level', 'plan', 'hist', 'zebra'].forEach((k) => press($('#tg-' + k), S.overlays[k]));
  $('#vf-grid').hidden = !S.overlays.thirds; $('#vf-level').hidden = !S.overlays.level;
  hud.plan.hidden = !S.overlays.plan; hud.hist.hidden = !S.overlays.hist;
  syncAuto(w.resolved);
}

// Sliders the camera is driving show what it chose and can't be dragged.
function syncAuto(r) {
  const u = S.user, apAuto = u.mode === 'P' || u.mode === 'S', shAuto = u.mode === 'P' || u.mode === 'A', isoAuto = u.iso === 'auto';
  K.ap.input.disabled = apAuto; K.sh.input.disabled = shAuto; K.iso.input.disabled = isoAuto;
  if (document.activeElement !== K.ap.input) K.ap.input.value = apAuto ? r.ap : O.apertureIndex(u.ap);
  if (document.activeElement !== K.sh.input) K.sh.input.value = shAuto ? r.sh : O.shutterIndex(u.sh);
  if (document.activeElement !== K.iso.input) K.iso.input.value = isoAuto ? r.iso : O.isoIndex(u.iso);
  K.ap.out.textContent = 'f/' + r.labelN + (apAuto ? ' auto' : '');
  K.sh.out.textContent = r.labelT + (shAuto ? ' auto' : '');
  K.iso.out.textContent = r.labelISO + (isoAuto ? ' auto' : '');
  K.fd.out.textContent = O.fmt.dist(stage.world.vf.focusDist);
  if (S.focus.mode !== 'manual' && document.activeElement !== K.fd.input) K.fd.input.value = distToSlider(clamp(stage.world.vf.focusDist, 0.2, 100));
}

function pushUser() { stage.world.setUser(userForStage()); syncDock(); }

function wireDock() {
  ['ap', 'sh', 'iso', 'comp', 'fl', 'fd', 'height', 'roll'].forEach((n) => { K[n] = field(n); });
  const w = stage.world;
  // Body mode.
  $$('[data-view]', dock).forEach((b) => b.addEventListener('click', () => { stage.body.select(null); stage.body.view(b.dataset.view); }));
  $('#tg-labels').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; press(e.currentTarget, on); stage.body.setLabels(on); });
  // Tabs.
  $$('[data-tab]', dock).forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  // Exposure.
  $$('[data-mode]', dock).forEach((b) => b.addEventListener('click', () => {
    const r = w.resolved;       // carry over what the camera had chosen
    S.user.ap = O.APERTURES[r.ap]; S.user.sh = O.shutterAt(r.sh);
    S.user.mode = b.dataset.mode; pushUser();
  }));
  K.ap.input.addEventListener('input', () => { S.user.ap = O.APERTURES[+K.ap.input.value]; pushUser(); });
  K.sh.input.addEventListener('input', () => { S.user.sh = O.shutterAt(+K.sh.input.value); pushUser(); });
  K.iso.input.addEventListener('input', () => { S.user.iso = O.ISOS[+K.iso.input.value]; pushUser(); });
  $('#tg-isoauto').addEventListener('click', () => { S.user.iso = S.user.iso === 'auto' ? O.ISOS[w.resolved.iso] : 'auto'; pushUser(); });
  K.comp.input.addEventListener('input', () => { S.user.comp = +K.comp.input.value / 3; pushUser(); });
  // Lens and focus.
  K.fl.input.addEventListener('input', () => w.setPose({ f: +K.fl.input.value }));
  $$('[data-focus]', dock).forEach((b) => b.addEventListener('click', () => {
    S.focus.mode = b.dataset.focus;
    if (S.focus.mode === 'manual') S.focus.dist = w.vf.focusDist;
    if (S.focus.mode === 'face') S.focus.point = [0, 0];
    w.setFocus({ mode: S.focus.mode, dist: S.focus.dist, point: S.focus.point || [0, 0] }); syncDock();
  }));
  K.fd.input.addEventListener('input', () => { S.focus.dist = sliderToDist(+K.fd.input.value); w.setFocus({ dist: S.focus.dist }); });
  $('#sel-lens').addEventListener('change', (e) => { S.lens = e.target.value; w.setLens(S.lens); if (S.lens === 'prime') S.user.ap = 1.4; pushUser(); });
  $('#tg-ois').addEventListener('click', () => { S.ois = !S.ois; w.vf.ois = S.ois; syncDock(); });
  // Scene and light.
  $('#sel-place').addEventListener('change', (e) => applyShot({ place: e.target.value, pose: SHOTS[e.target.value].pose, light: SHOTS[e.target.value].light }));
  $('#sel-light').addEventListener('change', (e) => { S.light = e.target.value; w.setLight(S.light); });
  $('#sel-film').addEventListener('change', (e) => { S.film = e.target.value; w.setFilm(S.film); });
  $('#sel-wb').addEventListener('change', (e) => { S.wb = e.target.value; w.vf.wb = S.wb; });
  $('#btn-pause').addEventListener('click', () => { S.paused = !S.paused; w.vf.paused = S.paused; syncDock(); });
  $('#btn-shoot').addEventListener('click', takePicture);
  // Compose.
  $$('[data-move]', dock).forEach((b) => {
    const [ax, v] = b.dataset.move.split(':');
    const on = (e) => { e.preventDefault(); w.held[ax] = +v; };
    const off = () => { w.held[ax] = 0; };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
    b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); w.held[ax] = +v; } });
    b.addEventListener('keyup', off); b.addEventListener('blur', off);
  });
  K.height.input.addEventListener('input', () => w.setPose({ y: +K.height.input.value }));
  K.roll.input.addEventListener('input', () => w.setPose({ roll: +K.roll.input.value }));
  $('#tg-portrait').addEventListener('click', () => { S.portrait = !S.portrait; w.setPortrait(S.portrait); syncDock(); });
  ['thirds', 'level', 'plan', 'hist', 'zebra'].forEach((k) => $('#tg-' + k).addEventListener('click', () => { S.overlays[k] = !S.overlays[k]; w.vf.zebra = S.overlays.zebra; syncDock(); }));
  // Options built from the model.
  const fsel = $('#sel-film');
  O.FILMSIMS.forEach((f) => { const o = document.createElement('option'); o.value = f.id; o.textContent = f.name; fsel.appendChild(o); });
  const psel = $('#sel-place');
  PLACES.forEach(([id, name]) => { const o = document.createElement('option'); o.value = id; o.textContent = name; psel.appendChild(o); });
  if (window.ResizeObserver) new ResizeObserver(() => layoutStage()).observe(dock);
}

function onPose(p) {
  if (stageMode !== 'world') return;
  K.fl.input.value = Math.round(p.f); K.fl.out.textContent = Math.round(p.f) + 'mm (' + Math.round(O.equivalent(p.f)) + ' equiv.)';
  K.height.input.value = p.y.toFixed(2); K.height.out.textContent = p.y.toFixed(1) + ' m';
  K.roll.input.value = p.roll; K.roll.out.textContent = p.roll.toFixed(1) + '°';
  K.ap.input.min = O.maxApertureIndex(stage.world.vf.lens, p.f);
}

/* ----------------------------------------------------------------------------
 * Taking a picture: freeze the frame and review it the way a coach would
 * ------------------------------------------------------------------------- */
function review(sn) {
  const r = sn.resolved, out = [], f = Math.round(sn.pose.f);
  const add = (level, title, text, topic) => out.push({ level, title, text, topic });
  // Exposure.
  if (sn.hist.hi > 0.08) add(4, 'Blown highlights', Math.round(sn.hist.hi * 100) + '% of the frame is pure white with no detail left. Turn exposure compensation down a stop and shoot again.', 'sci-metering');
  else if (sn.hist.mean < 0.14 && sn.light.id !== 'night') add(3, 'Too dark', 'Most of the picture sits in the bottom of the histogram. ' + (r.error < -0.3 ? 'The camera ran out of range: open the aperture, slow the shutter or raise the ISO limit.' : 'Turn exposure compensation up.'), 'sci-metering');
  else if (sn.hist.mean > 0.78) add(3, 'Washed out', 'The whole picture is bright and flat. Turn exposure compensation down.', 'sci-metering');
  else add(0, 'Exposure', 'Tones are spread across the histogram' + (sn.hist.hi > 0.02 ? ', with a few small highlights clipped (lamps and sky do that).' : ' with nothing clipped.'), 'sci-exposure');
  // Sharpness: the subject's movement, then yours.
  const sub = sn.subject;
  if (sub && sub.blurSensorPx > 16) {
    const need = O.fmt.seconds(r.t * 8 / sub.blurSensorPx);
    add(sub.blurSensorPx > 40 ? 4 : 2, 'Subject motion', sub.name + ' moved ' + Math.round(sub.blurSensorPx) + ' pixels during the ' + r.labelT + ' exposure' + (sub.blurSensorPx > 40 ? ', a visible smear' : ', soft when you zoom in') + '. About ' + need + ' would freeze them.', 'sci-shutter');
  } else if (sub) add(0, 'Subject motion', r.labelT + ' froze ' + sub.name.toLowerCase() + '.', 'sci-shutter');
  if (sn.shakeSensorPx > 16) add(sn.shakeSensorPx > 40 ? 4 : 2, 'Camera shake', 'Your hands moved the image about ' + Math.round(sn.shakeSensorPx) + ' pixels in ' + r.labelT + '. At ' + f + 'mm keep to ' + O.fmt.seconds(O.handholdLimit(f, sn.ois ? sn.lens.ois : 0)) + ' or faster' + (sn.ois ? '' : ', or switch the stabiliser on') + ', or brace against something.', 'sci-shutter');
  // Focus.
  if (sub) {
    if (sn.stats.defocus > 2.2) add(4, 'Focus', sub.name + ' is ' + O.fmt.dist(sub.d) + ' away but focus is at ' + O.fmt.dist(sn.focusDist) + ' (sharp zone ' + O.fmt.dist(sn.dof.near) + ' to ' + O.fmt.dist(sn.dof.far) + '). Put the focus point on them or switch face detection on.', 'sci-focus');
    else add(0, 'Focus', sub.name + ' is inside the sharp zone, which runs from ' + O.fmt.dist(sn.dof.near) + ' to ' + O.fmt.dist(sn.dof.far) + '.', 'sci-dof');
  }
  if (r.ISO >= 6300) add(2, 'Noise', 'ISO ' + r.labelISO + ' is grainy. That is the right trade if it bought a sharp picture; otherwise open the aperture or slow the shutter.', 'sci-iso');
  else if (r.ISO >= 1500) add(1, 'Noise', 'ISO ' + r.labelISO + ': a little grain, nothing to worry about.', 'sci-iso');
  // Composition.
  if (Math.abs(sn.pose.roll) > 1.2) add(2, 'Horizon', 'The camera is tilted ' + Math.abs(sn.pose.roll).toFixed(1) + '°. Switch on the level and straighten up, or tilt much more and mean it.', 'fr-level');
  if (sub) {
    if (Math.abs(sub.x) > 0.86 || sub.y > 0.9) add(2, 'Edges', sub.name + ' is jammed against the edge of the frame. Give them room, or step in and crop on purpose.', 'fr-subject');
    else if (Math.abs(sub.x) < 0.1 && sub.kind !== 'bike') add(1, 'Placement', sub.name + ' is dead centre. That suits symmetry and head-on portraits; otherwise try putting them on a third.', 'fr-thirds');
    else add(0, 'Placement', sub.name + ' sits off-centre, with space on the other side of the frame.', 'fr-thirds');
    const share = clamp(0.25 / sub.d * (sn.pose.f / 23.5) * 2, 0, 1);
    if (share < 0.07 && sub.d > 8) add(1, 'Subject size', sub.name + ' is small in the frame (' + O.fmt.dist(sub.d) + ' away at ' + f + 'mm). If they are the point of the picture, get closer.', 'fr-subject');
  }
  if (Math.abs(sn.pose.pitch) > 14 && sn.pose.f < 20 && sn.light.where === 'out') add(1, 'Verticals', 'Tilting a wide lens ' + (sn.pose.pitch > 0 ? 'up' : 'down') + ' ' + Math.round(Math.abs(sn.pose.pitch)) + '° makes buildings lean inward. Step back and level the camera to keep them straight.', 'fr-level');
  return out;
}

function takePicture() {
  if (!stage || stageMode !== 'world') return;
  const flash = $('#vf-flash');
  flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
  const { url, shot } = stage.world.capture(900);
  const r = shot.resolved, panel = $('#photo');
  $('#photo-img').src = url;
  $('#photo-img').dataset.portrait = String(shot.portrait);
  $('#photo-exif').textContent = Math.round(shot.pose.f) + 'mm · f/' + r.labelN + ' · ' + r.labelT + ' s · ISO ' + r.labelISO + ' · ' + O.fmt.stops(S.user.comp) + ' EV · ' + r.mode + ' mode · ' + shot.film.name + ' · ' + shot.light.name;
  const items = review(shot), worst = items.reduce((m, i) => Math.max(m, i.level), 0);
  $('#photo-verdict').textContent = worst >= 4 ? 'A miss, and a useful one. Fix the first red item and shoot again.' : worst >= 2 ? 'Usable, with something to tighten up.' : 'A keeper, technically. Now ask whether it is interesting.';
  // A mission in progress is judged first; the usual review follows.
  const mis = CS.practice.judge(shot), mEl = $('#photo-mission');
  mEl.hidden = !mis;
  if (mis) {
    $('#photo-verdict').textContent = mis.pass ? 'Mission complete: ' + mis.title + '.' : 'Not yet. Fix what is marked below and shoot again.';
    mEl.innerHTML = '<b>Mission: ' + mis.title + '</b><ul>' + mis.results.map((r) => '<li><span class="xp-status" data-level="' + (r.ok ? 0 : 4) + '">' + (r.ok ? 'Yes' : 'No') + '</span> ' + r.label + '</li>').join('') + '</ul>';
  }
  $('#photo-list').innerHTML = items.map((i) => '<li><span class="xp-status" data-level="' + i.level + '">' + i.title + '</span> ' + i.text + ' <a href="#' + i.topic + '" data-close-photo>Why</a></li>').join('');
  panel.hidden = false;
  $('#photo-close').focus();
}
function closePhoto() { $('#photo').hidden = true; }

/* ----------------------------------------------------------------------------
 * Practice shots: settings form, prompt, progress
 * ------------------------------------------------------------------------- */
const STORE = 'cameraskills.done';
function loadDone() { try { return new Set(JSON.parse(localStorage.getItem(STORE) || '[]')); } catch (e) { return new Set(); } }
function saveDone(set) { try { localStorage.setItem(STORE, JSON.stringify(Array.from(set))); } catch (e) {} }
let done = loadDone();

const FIELDS = [['focal', 'Focal length', 'e.g. 23mm'], ['aperture', 'Aperture', 'e.g. f/8'], ['shutter', 'Shutter speed', 'e.g. 1/250'], ['iso', 'ISO', 'e.g. 800'], ['film', 'Film simulation', 'e.g. Classic Chrome'], ['notes', 'Anything else', 'mode, compensation, what you were going for']];

function buildPrompt(shot) {
  const title = shot.dataset.title || ($('h3', shot) || {}).textContent || 'Free practice';
  const goal = ($('.cs-goal', shot) || {}).textContent || '';
  const checks = $$('.cs-check li', shot).map((li, i) => (i + 1) + '. ' + li.textContent.trim());
  const vals = {};
  $$('input[data-field]', shot).forEach((i) => { if (i.value.trim()) vals[i.dataset.field] = i.value.trim(); });
  const bits = [];
  if (vals.focal) bits.push(vals.focal);
  if (vals.aperture) bits.push(vals.aperture);
  if (vals.shutter) bits.push(vals.shutter + ' s');
  if (vals.iso) bits.push('ISO ' + vals.iso.replace(/^iso\s*/i, ''));
  if (vals.film) bits.push(vals.film + ' film simulation');
  const settings = bits.length
    ? 'My settings for this shot: ' + bits.join(', ') + '.' + (vals.notes ? ' Notes: ' + vals.notes + '.' : '')
    : 'I have not listed my settings.' + (vals.notes ? ' Notes: ' + vals.notes + '.' : '') + ' If you can read the file\'s EXIF data, use it; otherwise estimate the settings from the picture and say that you are estimating.';
  return [
    'You are my photography coach. Critique the attached photo honestly and specifically.',
    '',
    'About me: I am a beginner learning on a Fujifilm X-T30 III with the XC 13-33mm F3.5-6.3 OIS kit lens (20-50mm in full-frame terms; widest aperture f/3.5 at 13mm, f/6.3 at 33mm; stabilised lens, no in-body stabilisation). I shoot JPEG with film simulations and do little or no editing, so advice about getting it right in the camera is the most useful. I mostly photograph streets, travel, and family and friends.',
    '',
    'The exercise: "' + title.trim() + '". ' + goal.trim(),
    '',
    settings,
    '',
    'Judge the photo against these points:',
  ].concat(checks.length ? checks : ['1. Does the picture have a clear subject, and does everything in the frame support it?']).concat([
    '',
    'Then give me, in this order:',
    '- Verdict: one sentence on whether the shot achieves the goal of the exercise.',
    '- What works: up to three specific things, saying where in the frame.',
    '- What to fix: the two or three changes that would improve it most, biggest first. For each, tell me exactly what to do next time: where to stand, what to wait for, and which dial or setting to change on this camera and to what value.',
    '- Technical check: where the focus landed and whether it is sharp, exposure (blown highlights, blocked shadows), motion blur or camera shake, noise, white balance and colour. Name the setting that caused any problem you see.',
    '- Composition check: subject placement, edges and corners, background, horizon and verticals, direction and quality of the light.',
    '- A score out of 10 for this exercise, and the single thing to practise on my next attempt.',
    '',
    'Be direct. Do not soften real problems and do not invent problems that are not there. If you cannot tell something from the image, say so.',
  ]).join('\n');
}

function copyText(text, btn) {
  const ok = () => { const t = btn.textContent; btn.textContent = 'Copied. Paste it into Claude with your photo'; setTimeout(() => { btn.textContent = t; }, 2600); };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let good = false;
    try { good = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return good;
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, () => { if (fallback()) ok(); });
  else if (fallback()) ok();
}

function setupShots() {
  $$('.cs-shot').forEach((shot, n) => {
    const id = shot.id || 'shot-' + n;
    const tools = document.createElement('div');
    tools.className = 'cs-shot-tools';
    const det = document.createElement('details');
    det.innerHTML = '<summary>Add my settings to the prompt (optional)</summary>';
    const grid = document.createElement('div'); grid.className = 'cs-fields';
    FIELDS.forEach(([k, label, ph]) => {
      const l = document.createElement('label');
      l.textContent = label;
      const i = document.createElement('input'); i.type = 'text'; i.dataset.field = k; i.placeholder = ph; i.autocomplete = 'off';
      l.appendChild(i); grid.appendChild(l);
    });
    det.appendChild(grid);
    const row = document.createElement('div'); row.className = 'xp-controls';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'xp-btn xp-primary'; copy.textContent = 'Copy the critique prompt';
    copy.addEventListener('click', () => copyText(buildPrompt(shot), copy));
    const show = document.createElement('button'); show.type = 'button'; show.className = 'xp-chip'; show.textContent = 'Show prompt';
    const pre = document.createElement('textarea'); pre.className = 'cs-prompt'; pre.readOnly = true; pre.hidden = true; pre.rows = 12;
    pre.setAttribute('aria-label', 'Critique prompt');
    show.addEventListener('click', () => { pre.hidden = !pre.hidden; pre.value = buildPrompt(shot); show.textContent = pre.hidden ? 'Show prompt' : 'Hide prompt'; });
    det.addEventListener('input', () => { if (!pre.hidden) pre.value = buildPrompt(shot); });
    row.appendChild(copy); row.appendChild(show);
    if (shot.dataset.try) {
      const t = document.createElement('button'); t.type = 'button'; t.className = 'xp-chip'; t.textContent = 'Rehearse it in the simulator';
      t.addEventListener('click', () => { if (!stage) return; CS.practice.leave(); setStage('world'); applyShot(shot.dataset.try, { base: true }); });
      row.appendChild(t);
    }
    const lab = document.createElement('label'); lab.className = 'cs-done';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = done.has(id);
    cb.addEventListener('change', () => { if (cb.checked) done.add(id); else done.delete(id); saveDone(done); shot.classList.toggle('is-done', cb.checked); progress(); });
    lab.appendChild(cb); lab.appendChild(document.createTextNode(' I shot this one'));
    shot.classList.toggle('is-done', cb.checked);
    tools.appendChild(det); tools.appendChild(row); tools.appendChild(pre); tools.appendChild(lab);
    if (CS.practice) CS.practice.photoDrop(shot, tools, () => { if (!pre.hidden) pre.value = buildPrompt(shot); });
    shot.appendChild(tools);
  });
  progress();
}
function progress() {
  const all = $$('.cs-shot[id]').filter((s) => !s.dataset.free), n = all.filter((s) => done.has(s.id)).length;
  $$('[data-progress]').forEach((el) => { el.textContent = n + ' of ' + all.length + ' practice shots done'; });
  $$('[data-progress-bar]').forEach((el) => { el.style.width = (all.length ? n / all.length * 100 : 0) + '%'; });
}

/* ----------------------------------------------------------------------------
 * Walkthroughs: an ordered list whose steps drive the stage
 * ------------------------------------------------------------------------- */
function setupWalks() {
  $$('ol.cs-walk').forEach((ol) => {
    const steps = $$('li', ol);
    let at = -1;
    const nav = document.createElement('div'); nav.className = 'xp-controls cs-walk-nav';
    const prev = document.createElement('button'), next = document.createElement('button'), count = document.createElement('span');
    prev.type = next.type = 'button'; prev.className = 'xp-chip'; next.className = 'xp-btn xp-primary';
    prev.textContent = '← Back'; count.className = 'cs-dim';
    function go(i) {
      at = clamp(i, 0, steps.length - 1);
      steps.forEach((li, k) => li.classList.toggle('is-on', k === at));
      const li = steps[at];
      if (li.dataset.part && stage) { setStage('body'); stage.body.select(li.dataset.part); }
      if (li.dataset.shot && stage) { setStage('world'); applyShot(li.dataset.shot, { fly: true }); }
      prev.disabled = at === 0;
      next.textContent = at === steps.length - 1 ? 'Start again' : 'Next step →';
      count.textContent = 'Step ' + (at + 1) + ' of ' + steps.length;
      li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    steps.forEach((li, k) => { li.tabIndex = 0; li.addEventListener('click', () => go(k)); li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(k); } }); });
    prev.addEventListener('click', () => go(at - 1));
    next.addEventListener('click', () => go(at === steps.length - 1 ? 0 : at + 1));
    next.textContent = 'Start the walkthrough →'; prev.disabled = true;
    nav.appendChild(prev); nav.appendChild(next); nav.appendChild(count);
    ol.parentNode.insertBefore(nav, ol.nextSibling);
    ol._reset = () => { at = -1; steps.forEach((li) => li.classList.remove('is-on')); next.textContent = 'Start the walkthrough →'; prev.disabled = true; count.textContent = ''; };
  });
}

/* ----------------------------------------------------------------------------
 * Topics drive the stage
 * ------------------------------------------------------------------------- */
let mounted = [], pendingPart = null;
const ctx = { setFilm(id) { if (stage && stageMode === 'world') { S.film = id; stage.world.setFilm(id); syncDock(); } } };

function onOpen(id, section, prevId) {
  closePhoto();
  if (CS.practice) CS.practice.onTopic(section);
  unmount();
  $$('[data-widget]', section).forEach((el) => { const h = W.mount(el.dataset.widget, el, ctx); if (h) mounted.push(h); });
  $$('ol.cs-walk', section).forEach((ol) => ol._reset && ol._reset());
  $$('.cs-sections [data-open]').forEach((b) => press(b, b.dataset.group === section.dataset.group));
  if (!stage) return;
  const st = section.dataset.stage;
  if (st === 'body') {
    const was = stageMode;
    setStage('body');
    const part = pendingPart || section.dataset.part || null;
    pendingPart = null;
    if (part) stage.body.select(part);
    else { stage.body.select(null); stage.body.view(section.dataset.view || 'hero'); }
    if (was !== 'body' && part) stage.body.select(part);
  } else if (st === 'world') {
    const was = stageMode;
    setStage('world');
    applyShot(section.dataset.shot || 'street', { base: true, fly: was === 'world' });
  }
  requestAnimationFrame(layoutStage);
}
function unmount() { mounted.forEach((h) => h.destroy && h.destroy()); mounted = []; }
function onClose() { unmount(); requestAnimationFrame(layoutStage); }

function onPart(id) {
  const p = stage.body.parts.get(id);
  if (!p) return;
  if (EXP.byId.has(p.topic)) { pendingPart = id; EXP.open(p.topic); }
  else stage.body.select(id);
}

/* ----------------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------------- */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
function booted() { root.classList.remove('xp-booting'); }
function webglOK() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}

async function boot() {
  // Everything on the stage is 3D. Without WebGL the page stays an article,
  // which still has every lesson, the figures' captions and the practice prompts.
  setupShots();
  if (!webglOK()) { booted(); return; }
  try {
    for (const src of ['../js/vendor/three/three.global.js', '../js/vendor/three/OrbitControls.global.js', 'media/cameraskills/body.js', 'media/cameraskills/world.js', 'media/cameraskills/scene.js']) await loadScript(src);
    const tip = $('#tip');
    stage = CS.createStage(window.THREE, $('#scene-host'), $('#labels3d'), {
      onPart, onLayout, onFrame, onHistogram, onPose,
      onHover(name, x, y) {
        if (!name) { tip.hidden = true; return; }
        tip.textContent = name; tip.hidden = false;
        tip.style.left = Math.min(window.innerWidth - 200, x + 14) + 'px'; tip.style.top = (y + 16) + 'px';
      },
      onTap(x, y) {
        // Touch AF: a tap moves the focus point and switches to point focus.
        S.focus.mode = 'point'; S.focus.point = [x, y];
        stage.world.setFocus({ mode: 'point', point: [x, y] });
        syncDock();
      },
    });
  } catch (err) {
    console.error(err);
    stage = null;
    booted();
    return;
  }
  CS.app = { stage, S, SHOTS, applyShot, look };

  // Switching to app mode moves the drawer off-screen; don't animate that.
  drawer.style.transition = 'none';
  EXP = initExplainer({ onOpen, onClose });
  requestAnimationFrame(() => requestAnimationFrame(() => { drawer.style.transition = ''; }));
  wireDock();
  setupWalks();
  CS.practice.init({ stage, EXP, applyShot, setStage, look, SHOTS, closePhoto });
  booted();
  stage.body.setAccent(cssVar('--link'));
  onThemeChange(() => { stage.body.setAccent(cssVar('--link')); W.emit('theme'); });
  window.addEventListener('resize', layoutStage);
  new MutationObserver(() => { requestAnimationFrame(layoutStage); setTimeout(layoutStage, 320); })
    .observe(root, { attributes: true, attributeFilter: ['class'] });

  // Links and buttons inside topics that move the stage without changing topic.
  document.addEventListener('click', (e) => {
    const shot = e.target.closest('[data-shot]');
    if (shot && !shot.matches('section, li')) {
      e.preventDefault();
      setStage('world'); applyShot(shot.dataset.shot, { fly: true });
      const group = shot.closest('.xp-controls');
      if (group) $$('[data-shot]', group).forEach((b) => press(b, b === shot));
      return;
    }
    const part = e.target.closest('[data-part]');
    if (part && !part.matches('section, li') && part.closest('.xp-topic')) { e.preventDefault(); setStage('body'); stage.body.select(part.dataset.part); return; }
    if (e.target.closest('[data-close-photo], #photo-close')) closePhoto();
  });
  $$('.xp-topic a[data-part]').forEach((a) => { a.tabIndex = 0; a.setAttribute('role', 'button'); a.addEventListener('keydown', (e) => { if (e.key === 'Enter') a.click(); }); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#photo').hidden) { closePhoto(); e.stopPropagation(); } }, true);

  setStage('body');
  layoutStage();
  // With no topic in the URL, open the welcome so a first visit starts with
  // how the course works. Stamping its hash keeps the back button coming here.
  if (!EXP.byId.has(decodeURIComponent(location.hash.slice(1)))) {
    try { history.replaceState(null, '', '#welcome'); } catch (e) {}
    EXP.open('welcome', { push: false });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})(window.CameraSkills = window.CameraSkills || {});
