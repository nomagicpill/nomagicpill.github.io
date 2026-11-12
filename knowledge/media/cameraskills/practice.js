/*
 * knowledge/cameraskills.html: the parts of the course that are about real
 * pictures and about being tested.
 *
 *   gallery   the photographs in the #gallery topic: filter and sort them,
 *             show the relevant ones at the foot of each lesson, and open any
 *             of them large in a lightbox.
 *   photo     "add your photo" on a practice card: read its settings with
 *             exif.js, measure its histogram, and give a first look. The file
 *             is read in the browser and never sent anywhere.
 *   missions  goals to hit in the simulator. Each is a starting preset plus a
 *             list of checks run against the picture when it is taken.
 *
 * The photographs live in the page as <figure class="cs-ph"> inside #gallery,
 * one per picture, with data-kind, data-year, data-by (for sorting) and
 * data-lessons (topic ids). Missions live in the page as
 * <article class="cs-mission" id="m-…">; their checks are in MISSIONS below.
 *
 * CameraSkills.practice = { init(api), photoDrop(shot, tools, onFilled),
 *                           judge(shot), onTopic(section) }.
 * main.js calls init once the stage exists; photoDrop works without it.
 */
(function (CS) {
'use strict';
const O = CS.optics, X = CS.exif;
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const load = (key) => { try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch (e) { return new Set(); } };
const save = (key, set) => { try { localStorage.setItem(key, JSON.stringify(Array.from(set))); } catch (e) {} };

let api = null;       // { stage, EXP, applyShot, setStage, look, SHOTS, closePhoto }

/* ============================================================================
 * Gallery and lightbox
 * ========================================================================= */
const KINDS = [['all', 'All'], ['street', 'Street'], ['travel', 'Travel and places'], ['people', 'People'], ['movement', 'Movement'], ['light', 'Light and night']];
let lb = { list: [], i: 0 };

function titleOf(id) {
  const s = api && api.EXP.byId.get(id);
  return s ? (s.dataset.title || id) : id;
}

function openLightbox(list, i) {
  lb = { list, i };
  const box = $('#lightbox');
  box.hidden = false;
  showLightbox();
  $('#lb-close').focus();
}
function showLightbox() {
  const fig = lb.list[lb.i];
  if (!fig) return;
  const src = $('img', fig), img = $('#lb-img'), cap = $('#lb-cap');
  img.src = src.getAttribute('src'); img.alt = src.alt;
  cap.textContent = '';
  const fc = $('figcaption', fig).cloneNode(true);
  while (fc.firstChild) cap.appendChild(fc.firstChild);
  const ids = (fig.dataset.lessons || '').split(/\s+/).filter((id) => api && api.EXP.byId.has(id));
  if (ids.length) {
    const p = el('p', 'cs-ph-lessons', 'Lessons: ');
    ids.forEach((id, k) => {
      const a = el('a', '', titleOf(id)); a.href = '#' + id; a.dataset.closeLightbox = '1';
      if (k) p.appendChild(document.createTextNode(' · '));
      p.appendChild(a);
    });
    cap.appendChild(p);
  }
  $('#lb-count').textContent = (lb.i + 1) + ' of ' + lb.list.length;
  $('#lb-prev').disabled = lb.list.length < 2; $('#lb-next').disabled = lb.list.length < 2;
}
function stepLightbox(d) { lb.i = (lb.i + d + lb.list.length) % lb.list.length; showLightbox(); }
function closeLightbox() { $('#lightbox').hidden = true; $('#lb-img').removeAttribute('src'); }

function setupGallery() {
  const host = $('#cs-gallery');
  const figs = $$('figure.cs-ph', host);
  if (!figs.length) return;
  figs.forEach((f, k) => { f.dataset.order = k; });

  // Filter chips and a sort menu.
  const bar = $('#cs-gallery-controls');
  let kind = 'all', sort = 'course';
  const count = el('span', 'cs-dim');
  const chips = KINDS.map(([id, name]) => {
    const b = el('button', 'xp-chip', name); b.type = 'button';
    b.setAttribute('aria-pressed', String(id === kind));
    b.addEventListener('click', () => { kind = id; chips.forEach((c) => c.setAttribute('aria-pressed', String(c === b))); apply(); });
    bar.appendChild(b);
    return b;
  });
  const sel = el('select'); sel.setAttribute('aria-label', 'Sort the gallery');
  [['course', 'Sorted by lesson'], ['old', 'Oldest first'], ['new', 'Newest first'], ['by', 'By photographer']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; sel.appendChild(o); });
  sel.addEventListener('change', () => { sort = sel.value; apply(); });
  bar.appendChild(sel); bar.appendChild(count);

  let visible = figs.slice();
  function apply() {
    const cmp = {
      course: (a, b) => a.dataset.order - b.dataset.order,
      old: (a, b) => a.dataset.year - b.dataset.year,
      new: (a, b) => b.dataset.year - a.dataset.year,
      by: (a, b) => a.dataset.by.localeCompare(b.dataset.by) || a.dataset.year - b.dataset.year,
    }[sort];
    visible = figs.filter((f) => kind === 'all' || f.dataset.kind === kind).sort(cmp);
    figs.forEach((f) => { f.hidden = visible.indexOf(f) < 0; });
    visible.forEach((f) => host.appendChild(f));
    count.textContent = visible.length + ' photograph' + (visible.length === 1 ? '' : 's');
  }
  apply();

  // Each card opens large.
  figs.forEach((f) => {
    const img = $('img', f);
    img.tabIndex = 0; img.setAttribute('role', 'button');
    const go = () => openLightbox(visible, Math.max(0, visible.indexOf(f)));
    img.addEventListener('click', go);
    img.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    const tag = el('span', 'cs-ph-kind', (KINDS.find((k) => k[0] === f.dataset.kind) || [0, ''])[1]);
    $('figcaption', f).insertBefore(tag, $('figcaption', f).firstChild);
  });

  // The relevant photographs at the foot of each lesson.
  const byLesson = new Map();
  figs.forEach((f) => (f.dataset.lessons || '').split(/\s+/).filter(Boolean).forEach((id) => {
    if (!byLesson.has(id)) byLesson.set(id, []);
    byLesson.get(id).push(f);
  }));
  byLesson.forEach((list, id) => {
    const sec = api.EXP.byId.get(id);
    if (!sec) return;
    const wrap = el('div', 'cs-examples');
    wrap.appendChild(el('h3', '', 'In real photographs'));
    const strip = el('div', 'cs-strip');
    list.forEach((f, k) => {
      const src = $('img', f), b = el('button', 'cs-thumb'); b.type = 'button';
      const im = el('img'); im.src = src.getAttribute('src'); im.alt = src.alt; im.loading = 'lazy';
      im.width = src.getAttribute('width'); im.height = src.getAttribute('height');
      b.appendChild(im);
      const cap = el('span');
      cap.appendChild(el('b', '', $('.cs-ph-title', f).textContent));
      cap.appendChild(el('small', '', $('.cs-ph-by', f).textContent));
      b.appendChild(cap);
      b.addEventListener('click', () => openLightbox(list, k));
      strip.appendChild(b);
    });
    wrap.appendChild(strip);
    const more = el('p', 'cs-dim'); more.style.fontSize = '0.84em';
    more.appendChild(document.createTextNode('Click a picture for what to notice in it. '));
    const a = el('a', '', 'All ' + figs.length + ' in the gallery'); a.href = '#gallery';
    more.appendChild(a);
    wrap.appendChild(more);
    sec.insertBefore(wrap, $('.xp-next', sec));
  });

  // Lightbox controls.
  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lb-prev').addEventListener('click', () => stepLightbox(-1));
  $('#lb-next').addEventListener('click', () => stepLightbox(1));
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox' || e.target.closest('[data-close-lightbox]')) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if ($('#lightbox').hidden) return;
    if (e.key === 'Escape') { closeLightbox(); e.stopPropagation(); }
    else if (e.key === 'ArrowLeft') stepLightbox(-1);
    else if (e.key === 'ArrowRight') stepLightbox(1);
  }, true);
}

/* ============================================================================
 * Your photo: settings from the file, and a first look
 * ========================================================================= */

// "speed>=1/250 focal<=23": what the brief asked for, to compare with the file.
function parseExpect(text) {
  return (text || '').split(/\s+/).filter(Boolean).map((tok) => {
    const m = /^(speed|focal|aperture|iso|comp)(>=|<=)(.+)$/.exec(tok);
    if (!m) return null;
    const v = m[3].indexOf('/') > 0 ? m[3].split('/')[0] / m[3].split('/')[1] : parseFloat(m[3]);
    return { what: m[1], op: m[2], v, raw: m[3] };
  }).filter(Boolean);
}

function firstLook(ex, px, expect) {
  const out = [];
  const add = (level, text) => out.push([level, text]);
  if (!ex || !ex.exposure) {
    add(1, 'No shooting settings in this file. Apps and websites often strip them; use the original JPEG from the camera or the card.');
  } else {
    const t = ex.exposure, f = ex.focal || 0, eq = ex.focal35 || f * O.SENSOR.crop, sh = X.shutterText(t);
    const kit = /13-33/.test(ex.lens || '');
    // What the brief asked for.
    expect.forEach((e) => {
      const fail = (msg) => add(2, msg);
      if (e.what === 'speed') {
        if (e.op === '>=' && t > e.v * 1.12) fail('The brief asks for 1/' + Math.round(1 / e.v) + ' or faster; this was ' + sh + '.');
        if (e.op === '<=' && t < e.v / 1.12) fail('The brief asks for 1/' + Math.round(1 / e.v) + ' or slower; this was ' + sh + '.');
      } else if (e.what === 'focal' && f) {
        if (e.op === '<=' && f > e.v + 0.6) fail('The brief asks for ' + e.raw + 'mm or wider; this was ' + Math.round(f) + 'mm.');
        if (e.op === '>=' && f < e.v - 0.6) fail('The brief asks for ' + e.raw + 'mm or longer; this was ' + Math.round(f) + 'mm.');
      } else if (e.what === 'aperture' && ex.fnumber) {
        if (e.op === '>=' && ex.fnumber < e.v - 0.05) fail('The brief asks for f/' + e.raw + ' or smaller; this was f/' + ex.fnumber + '.');
        if (e.op === '<=' && ex.fnumber > e.v + 0.05) fail('The brief asks for f/' + e.raw + ' or wider; this was f/' + ex.fnumber + '.');
      } else if (e.what === 'comp' && ex.bias !== undefined) {
        if (e.op === '<=' && ex.bias > e.v + 0.05) fail('The brief asks for negative exposure compensation; this was ' + O.fmt.stops(ex.bias) + '.');
      }
    });
    // Sharpness.
    if (eq && t > 1 / eq) {
      const stops = O.log2(t * eq);
      if (stops > 3.2) add(4, sh + ' at ' + Math.round(f) + 'mm is ' + stops.toFixed(1) + ' stops slower than the hand-holding rule (1/' + Math.round(eq) + '). Even the stabiliser is unlikely to have held it: look for a general smear.');
      else add(1, sh + ' is slower than the hand-holding rule for ' + Math.round(f) + 'mm (1/' + Math.round(eq) + ')' + (kit ? ', inside what the lens\'s stabiliser covers. Zoom in to check it is crisp.' : '. Zoom in to check for shake.'));
    }
    if (t >= 1 / 50) add(2, 'At ' + sh + ' anything that moved is blurred. Fine for still subjects; people need 1/125 or faster.');
    else if (t <= 1 / 400) add(0, sh + ' freezes walking and most play.');
    // ISO.
    if (ex.iso >= 6400) add(2, 'ISO ' + ex.iso + ': expect visible grain. Worth it only if the shutter speed needed it.');
    else if (ex.iso && ex.iso <= 400 && t >= 1 / 50) add(2, 'ISO ' + ex.iso + ' with a slow shutter: there was ISO to spare. Auto ISO with a minimum speed of 1/125 would have traded a little grain for a sharp picture.');
    // Aperture.
    if (ex.fnumber >= 16) add(1, 'f/' + ex.fnumber + ' softens the whole picture slightly (diffraction). f/8 to f/11 is usually enough depth.');
    else if (kit && f && ex.fnumber <= O.maxAperture(O.LENSES.kit, f) + 0.2) add(0, 'f/' + ex.fnumber + ' is wide open at ' + Math.round(f) + 'mm: the most light and the least depth this lens gives.');
    if (ex.bias) add(0, 'Exposure compensation was ' + O.fmt.stops(ex.bias) + '.');
    if (ex.flash) add(0, 'The flash fired.');
    // The camera's own verdict, when it left one.
    const w = ex.warnings || {};
    if (w.blur) add(2, 'The camera itself flagged a blur warning on this frame.');
    if (w.focus) add(4, 'The camera flagged that it could not confirm focus.');
    if (w.exposure) add(1, 'The camera flagged the exposure as outside what it metered. Check the histogram.');
  }
  if (px) {
    if (px.hi > 0.03) add(px.hi > 0.1 ? 4 : 2, Math.round(px.hi * 100) + '% of the picture is pure white with no detail. If that is sky or a lamp, fine; if it is a face or a shirt, use less exposure.');
    if (px.lo > 0.3) add(1, Math.round(px.lo * 100) + '% is solid black. Right for night and silhouettes; otherwise lift the exposure.');
    if (px.hi <= 0.03 && px.lo <= 0.3) add(0, 'Tones fit: nothing much is clipped at either end.');
  }
  return out;
}

// Histogram of the picture itself, from a small copy drawn on a canvas.
function measure(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const w = 240, h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let hi = 0, lo = 0;
      try {
        const d = g.getImageData(0, 0, w, h).data, n = w * h;
        for (let i = 0; i < n; i++) {
          const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
          if (Math.min(r, gg, b) >= 252) hi++;
          if (Math.max(r, gg, b) <= 5) lo++;
        }
        resolve({ hi: hi / n, lo: lo / n, canvas: c });
      } catch (e) { resolve({ hi: 0, lo: 0, canvas: c }); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// Adds "add your photo" to one practice card. `onFilled` runs after the
// settings fields have been filled in, so the prompt can be rebuilt.
function photoDrop(shot, tools, onFilled) {
  const wrap = el('div', 'cs-drop');
  const label = el('label', 'xp-chip');
  const input = el('input'); input.type = 'file'; input.accept = 'image/jpeg,image/*'; input.hidden = true;
  label.appendChild(input);
  label.appendChild(document.createTextNode('Add your photo to read its settings'));
  wrap.appendChild(label);
  wrap.appendChild(el('span', 'cs-dim', ' It is read here in your browser and never uploaded.'));
  const look = el('div', 'cs-firstlook'); look.hidden = true;
  const expect = parseExpect(shot.dataset.expect);

  async function take(file) {
    if (!file) return;
    look.hidden = false; look.textContent = 'Reading…';
    let ex = null;
    try { ex = X.parse(await file.slice(0, 262144).arrayBuffer()); } catch (e) {}
    const px = /^image\//.test(file.type || 'image/jpeg') ? await measure(file) : null;
    const set = (k, v) => { const i = $('input[data-field="' + k + '"]', shot); if (i && v) i.value = v; };
    if (ex && ex.exposure) {
      set('focal', ex.focal ? Math.round(ex.focal) + 'mm' : '');
      set('aperture', ex.fnumber ? 'f/' + ex.fnumber : '');
      set('shutter', X.shutterText(ex.exposure).replace('"', ' s'));
      set('iso', ex.iso ? String(ex.iso) : '');
      set('film', ex.filmSim || '');
      const notes = $('input[data-field="notes"]', shot);
      if (notes && !notes.value.trim()) {
        const bits = [];
        if (ex.mode) bits.push(ex.mode + ' mode');
        if (ex.bias !== undefined) bits.push('exposure compensation ' + O.fmt.stops(ex.bias));
        if (ex.model) bits.push(ex.model);
        notes.value = bits.join(', ');
      }
      const det = $('details', tools); if (det) det.open = true;
    }
    look.textContent = '';
    if (px && px.canvas) { px.canvas.className = 'cs-firstlook-img'; look.appendChild(px.canvas); }
    const box = el('div');
    box.appendChild(el('b', '', 'First look'));
    if (ex && ex.exposure) box.appendChild(el('p', 'cs-exif', [ex.focal ? Math.round(ex.focal) + 'mm' : '', ex.fnumber ? 'f/' + ex.fnumber : '', X.shutterText(ex.exposure), ex.iso ? 'ISO ' + ex.iso : '', ex.filmSim || ''].filter(Boolean).join(' · ')));
    const ul = el('ul');
    firstLook(ex, px, expect).forEach(([level, text]) => {
      const li = el('li'); const s = el('span', 'xp-status', level >= 4 ? 'Fix' : level >= 2 ? 'Check' : level === 1 ? 'Note' : 'Good');
      s.dataset.level = level; li.appendChild(s); li.appendChild(document.createTextNode(' ' + text)); ul.appendChild(li);
    });
    box.appendChild(ul);
    box.appendChild(el('p', 'cs-dim', 'This is arithmetic on the settings and the histogram. It cannot see your composition, your focus point or the moment: that is what the critique is for.'));
    look.appendChild(box);
    if (onFilled) onFilled();
  }
  input.addEventListener('change', () => take(input.files[0]));
  shot.addEventListener('dragover', (e) => { e.preventDefault(); shot.classList.add('is-drop'); });
  shot.addEventListener('dragleave', () => shot.classList.remove('is-drop'));
  shot.addEventListener('drop', (e) => { e.preventDefault(); shot.classList.remove('is-drop'); take(e.dataTransfer.files[0]); });
  tools.insertBefore(look, tools.firstChild);
  tools.insertBefore(wrap, tools.firstChild);
}

/* ============================================================================
 * Missions
 * ========================================================================= */
const MSTORE = 'cameraskills.missions';
let missionsDone = load(MSTORE), active = null;

const seen = (sn, id) => (sn.census || []).find((c) => c.id === id);
const expOK = (sn) => sn.hist.hi < 0.08 && sn.hist.mean > 0.2 && sn.hist.mean < 0.72;
const proj = (p) => api.stage.world.project(p);
const FR = [39.4, 1.5, -62];

// Each mission: where it starts (a preset, deliberately wrong) and what a
// passing picture must satisfy. A check gets the snapshot taken with the shot.
function missions() {
  const look = api.look, S = api.SHOTS;
  return {
    'm-freeze': {
      shot: { place: 'street', pose: look(5.2, 1.5, -21, -1.3, 1.2, -21.2, 18), light: 'overcast', user: { mode: 'A', ap: 11, iso: 160 } },
      checks: [
        ['The cyclist is in the frame', (sn) => !!seen(sn, 'cyclist')],
        ['He is sharp: under 16 pixels of blur', (sn) => { const c = seen(sn, 'cyclist'); return !!c && c.blurSensorPx < 16; }],
        ['ISO 1600 or lower', (sn) => sn.resolved.ISO < 1700],
        ['The exposure is right', expOK],
      ],
    },
    'm-window': {
      shot: Object.assign({}, S['sci-metering'], { overlays: { zebra: false } }),
      checks: [
        ['Someone at the table is your subject', (sn) => !!sn.subject && (sn.subject.id === 'mum' || sn.subject.id === 'grandad')],
        ['Their face is properly bright', (sn) => sn.hist.subjectLum !== null && sn.hist.subjectLum >= 0.225],
        ['1/60 or faster, so nobody blurs', (sn) => sn.resolved.t <= 1 / 55],
        ['ISO 6400 or lower', (sn) => sn.resolved.ISO < 6500],
      ],
    },
    'm-night': {
      shot: { place: 'street', pose: look(1.2, 1.6, 6, 0.4, 2.2, -14, 16), light: 'night', user: { mode: 'A', ap: 3.5, iso: 'auto', minShutter: 1 / 60 } },
      checks: [
        ['It still looks like night: dark overall', (sn) => sn.hist.mean < 0.235],
        ['The lamps keep their shape: under 1% pure white', (sn) => sn.hist.hi < 0.01],
        ['No camera shake', (sn) => sn.shakeSensorPx < 16],
        ['ISO 6400 or lower', (sn) => sn.resolved.ISO < 6500],
      ],
    },
    'm-steady': {
      shot: { place: 'plaza', pose: look(0, 1.6, -47, 0, 22, -86, 33), light: 'dusk', ois: false, user: { mode: 'A', ap: 6.3, iso: 160 }, tab: 'lens' },
      checks: [
        ['Still zoomed in: 30mm or longer', (sn) => sn.pose.f >= 29.5],
        ['No camera shake', (sn) => sn.shakeSensorPx < 16],
        ['ISO 1600 or lower', (sn) => sn.resolved.ISO < 1700],
        ['The exposure is right', expOK],
      ],
    },
    'm-soft': {
      shot: { place: 'park', pose: look(35.9, 1.5, -65.3, FR[0], FR[1], FR[2], 13), light: 'overcast', lens: 'kit', user: { mode: 'A', ap: 8 }, tab: 'lens' },
      checks: [
        ['You are using your own lens, not the f/1.4 prime', (sn) => sn.lens.id === 'kit'],
        ['Your friend is the subject and in focus', (sn) => !!sn.subject && sn.subject.id === 'friend' && sn.stats.defocus < 1.5],
        ['Her head is well inside the frame', (sn) => !!sn.subject && Math.abs(sn.subject.x) < 0.8 && sn.subject.y < 0.85 && sn.subject.y > -0.5],
        ['The background is clearly soft', (sn) => O.blurAtInfinity(sn.pose.f, sn.resolved.N, sn.focusDist) / O.SENSOR.w >= 0.0035],
      ],
    },
    'm-deep': {
      shot: S['sci-dof'],
      checks: [
        ['The flowers are sharp: the sharp zone starts within 2.2 m', (sn) => sn.dof.near <= 2.2],
        ['Your friend is sharp too', (sn) => { const c = seen(sn, 'friend'); return !!c && sn.dof.near <= c.d && sn.dof.far >= c.d; }],
        ['No camera shake', (sn) => sn.shakeSensorPx < 16],
        ['The exposure is right', expOK],
      ],
    },
    'm-thirds': {
      shot: { place: 'plaza', pose: look(0, 1.6, -47, 0, 1.6, -86, 15, { roll: 2.5 }), light: 'sunny', user: { ap: 8 }, tab: 'compose', overlays: { thirds: true, level: true } },
      checks: [
        ['The camera is level, within half a degree', (sn) => Math.abs(sn.pose.roll) <= 0.6],
        ['The tower stands on a vertical third', () => { const p = proj([0, 14, -86]); return p.front && Math.abs(Math.abs(p.x) - 1 / 3) <= 0.13; }],
        ['The whole tower is in the frame', () => { const t = proj([0, 34.5, -86]), b = proj([0, 1, -86]); return t.front && t.y < 0.98 && b.y > -0.98 && Math.abs(t.x) < 0.95; }],
        ['The horizon is off-centre', (sn) => Math.abs(Math.tan(sn.pose.pitch * Math.PI / 180) / Math.tan((sn.portrait ? O.fov(sn.pose.f).h : O.fov(sn.pose.f).v) * Math.PI / 360)) >= 0.2],
      ],
    },
    'm-frame': {
      shot: S['frame-weak'],
      checks: [
        ['You are back in the street', (sn) => sn.pose.z > -40.5],
        ['Both sides of the arch are in the frame', () => { const l = proj([-3.4, 3, -42.5]), r = proj([3.4, 3, -42.5]); return l.front && r.front && Math.abs(l.x) < 0.97 && Math.abs(r.x) < 0.97; }],
        ['The tower shows through the arch', () => { const l = proj([-3.4, 3, -42.5]), r = proj([3.4, 3, -42.5]), t = proj([0, 18, -86]), a = proj([0, 7.8, -42.5]); return t.x > Math.min(l.x, r.x) && t.x < Math.max(l.x, r.x) && t.y < a.y && t.y > -1; }],
        ['The camera is level', (sn) => Math.abs(sn.pose.roll) <= 1],
      ],
    },
    'm-eye': {
      shot: { place: 'room', pose: look(201.9, 1.75, 2.35, 200, 0.5, 0.9, 15), light: 'window', user: { mode: 'S', sh: 1 / 500 }, tab: 'compose' },
      checks: [
        ['The child is in the frame, clear of the edges', (sn) => { const c = seen(sn, 'kid'); return !!c && Math.abs(c.x) < 0.85; }],
        ['The camera is at their height: 0.5 to 1.0 m', (sn) => sn.pose.y >= 0.45 && sn.pose.y <= 1.05],
        ['The camera looks across, not down', (sn) => Math.abs(sn.pose.pitch) <= 12],
        ['They are sharp', (sn) => { const c = seen(sn, 'kid'); return !!c && c.blurSensorPx < 20; }],
      ],
    },
    'm-moment': {
      shot: Object.assign({}, S['moment-early'], { paused: false }),
      checks: [
        ['The man in the red jacket is on the crossing', (sn) => { const c = seen(sn, 'walkerB'); return !!c && Math.abs(c.wx) < 2.6; }],
        ['Caught in full stride, legs apart', (sn) => { const c = seen(sn, 'walkerB'); return !!c && c.spread >= 0.7; }],
        ['He is clear of the frame edge', (sn) => { const c = seen(sn, 'walkerB'); return !!c && Math.abs(c.x) < 0.8; }],
        ['He is sharp', (sn) => { const c = seen(sn, 'walkerB'); return !!c && c.blurSensorPx < 16; }],
      ],
    },
    'm-room': {
      shot: Object.assign({}, S['space-weak'], { paused: false }),
      checks: [
        ['The cyclist is in the frame', (sn) => !!seen(sn, 'cyclist')],
        ['There is more space ahead of him than behind', (sn) => { const c = seen(sn, 'cyclist'); return !!c && (c.dx < 0 ? c.x > 0.12 : c.x < -0.12); }],
        ['He is not jammed against the edge', (sn) => { const c = seen(sn, 'cyclist'); return !!c && Math.abs(c.x) < 0.82; }],
        ['He is frozen', (sn) => { const c = seen(sn, 'cyclist'); return !!c && c.blurSensorPx < 16; }],
      ],
    },
    'm-portrait': {
      shot: S['port-weak'],
      checks: [
        ['Zoomed to 28mm or longer', (sn) => sn.pose.f >= 27.5],
        ['Standing back: at least 1.4 m from her', (sn) => !!sn.subject && sn.subject.id === 'friend' && sn.subject.d >= 1.4],
        ['The camera is at her eye level', (sn) => Math.abs(sn.pose.y - 1.58) <= 0.25],
        ['The camera is turned vertical', (sn) => !!sn.portrait],
        ['Her eyes are in the upper part of the frame, not at the edge', (sn) => !!sn.subject && sn.subject.y >= 0.12 && sn.subject.y <= 0.8 && Math.abs(sn.subject.x) < 0.6],
        ['Nothing grows out of her head', (sn) => { const p = proj([41.6, 1.9, -62.3]); return !sn.subject || !p.front || Math.abs(p.x) > 1 || Math.abs(p.x - sn.subject.x) > 0.16; }],
      ],
    },
  };
}
let MISSIONS = null;

function refreshMissions() {
  const all = $$('.cs-mission');
  all.forEach((m) => {
    m.classList.toggle('is-done', missionsDone.has(m.id));
    const st = $('.cs-mission-state', m);
    if (st) st.textContent = missionsDone.has(m.id) ? '✓ Done' : '';
  });
  $$('[data-mission-progress]').forEach((e) => { e.textContent = all.filter((m) => missionsDone.has(m.id)).length + ' of ' + all.length + ' missions complete'; });
  $$('[data-mission-bar]').forEach((e) => { e.style.width = (all.length ? all.filter((m) => missionsDone.has(m.id)).length / all.length * 100 : 0) + '%'; });
}

function start(id) {
  const m = MISSIONS[id], card = document.getElementById(id);
  if (!m || !card) return;
  api.closePhoto();
  api.setStage('world');
  api.applyShot(m.shot, { base: true });
  active = id;
  $('#mission-name').textContent = $('h3', card).textContent.replace(/^\d+\.\s*/, '');
  $('#mission-bar').hidden = false;
  // On a phone the lesson sheet covers the controls: get it out of the way.
  if (window.innerWidth <= 900) api.EXP.close();
}
function leave() {
  active = null;
  const bar = $('#mission-bar'); if (bar) bar.hidden = true;
}

// Called by main.js when a picture is taken. Returns null when no mission is on.
function judge(sn) {
  if (!active || !MISSIONS) return null;
  const m = MISSIONS[active], card = document.getElementById(active);
  const results = m.checks.map(([label, fn]) => { let ok = false; try { ok = !!fn(sn); } catch (e) {} return { label, ok }; });
  const pass = results.every((r) => r.ok);
  if (pass) { missionsDone.add(active); save(MSTORE, missionsDone); refreshMissions(); }
  return { id: active, title: $('h3', card).textContent.replace(/^\d+\.\s*/, ''), pass, results };
}

function setupMissions() {
  MISSIONS = missions();
  $$('.cs-mission').forEach((card) => {
    if (!MISSIONS[card.id]) return;
    const row = el('div', 'xp-controls');
    const go = el('button', 'xp-btn xp-primary', 'Start this mission'); go.type = 'button';
    go.addEventListener('click', () => start(card.id));
    row.appendChild(go); row.appendChild(el('span', 'cs-mission-state'));
    card.appendChild(row);
  });
  const quit = $('#mission-quit'); if (quit) quit.addEventListener('click', leave);
  refreshMissions();
}

/* ============================================================================ */
function init(a) {
  api = a;
  setupGallery();
  setupMissions();
  CS.practice.MISSIONS = MISSIONS;
}
// A lesson that sets the stage ends whatever mission was running.
function onTopic(section) { if (section.dataset.stage) leave(); }

CS.practice = { init, photoDrop, judge, onTopic, start, leave, firstLook, parseExpect };
})(window.CameraSkills = window.CameraSkills || {});
