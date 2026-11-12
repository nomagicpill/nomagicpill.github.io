/*
 * knowledge/cameraskills.html: the figures in the drawer. Each is mounted
 * into a <div class="xp-figure" data-widget="name"> when its topic opens and
 * destroyed when it closes. All arithmetic comes from optics.js; colours come
 * from the theme tokens, read at draw time so the D/L toggle just works.
 *
 * CameraSkills.widgets = { mount(name, el, ctx), emit(event) }.
 * ctx (from main.js) = { setFilm(id) }: the few things a figure can do to
 * the stage.
 */
(function (CS) {
'use strict';
const O = CS.optics;
const REG = {};
const live = new Set();
const cssVar = (n) => window.Explainer.cssVar(n);

function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach((k) => { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); });
  (kids || []).forEach((k) => e.appendChild(k));
  return e;
}
// A canvas drawn in logical units W x H that fills the figure's width.
function makeCanvas(host, W, H) {
  const c = el('canvas', { role: 'img' });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = W * dpr; c.height = H * dpr;
  c.style.aspectRatio = W + ' / ' + H;
  host.appendChild(c);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, g, W, H };
}
let uid = 0;
function slider(host, label, min, max, step, value, onInput) {
  const id = 'csw' + (++uid);
  const out = el('output', { for: id });
  const input = el('input', { type: 'range', id, min, max, step, value });
  const lab = el('label', { for: id }, [el('span', { text: label }), out]);
  host.appendChild(el('div', { class: 'xp-field' }, [lab, input]));
  input.addEventListener('input', () => onInput(+input.value));
  return { input, out, get value() { return +input.value; } };
}
function chips(host, options, value, onPick) {
  const row = el('div', { class: 'xp-controls' });
  const btns = options.map(([v, text]) => {
    const b = el('button', { type: 'button', class: 'xp-chip', 'aria-pressed': String(v === value), text });
    b.addEventListener('click', () => { btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); onPick(v); });
    row.appendChild(b);
    return b;
  });
  host.appendChild(row);
  return row;
}
const caption = (host, text) => host.appendChild(el('p', { class: 'xp-caption', text }));
const readout = (host) => host.appendChild(el('p', { class: 'cs-readout-text' }));
const font = (px, bold) => (bold ? 'bold ' : '') + px + 'px Arial, Helvetica, sans-serif';

/* ---------------------------------------------------------------- iris */
// The aperture as the hole it is: nine blades, f/1.4 to f/22.
REG.iris = function (host) {
  const cv = makeCanvas(host, 320, 170);
  const out = readout(host);
  let i = O.apertureIndex(5.6);
  function draw() {
    const { g, W, H } = cv, N = O.apertureAt(i);
    g.clearRect(0, 0, W, H);
    const cx = 86, cy = 85, R = 70;
    g.fillStyle = cssVar('--xp-ink-3'); g.beginPath(); g.arc(cx, cy, R + 6, 0, 7); g.fill();
    g.fillStyle = '#17181b'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
    // Opening radius is proportional to 1/N; f/1.4 fills the barrel.
    const r = R * 1.414 / N * 0.96;
    g.fillStyle = '#e9f1ff'; g.beginPath();
    for (let k = 0; k < 9; k++) { const a = k * 2 * Math.PI / 9 + i * 0.05; g[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
    for (let k = 0; k < 9; k++) {
      const a = k * 2 * Math.PI / 9 + i * 0.05;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a + 1.1) * R, cy + Math.sin(a + 1.1) * R); g.stroke();
    }
    // Light bar: how much gets through, relative to f/1.4.
    const x0 = 186, w = 118, rel = 2 / (N * N);
    g.fillStyle = cssVar('--text'); g.font = font(26, true); g.textBaseline = 'alphabetic';
    g.fillText('f/' + O.APERTURES[i], x0, 44);
    g.font = font(11); g.fillStyle = cssVar('--xp-ink-2');
    g.fillText('Light let through', x0, 72);
    g.fillStyle = cssVar('--xp-track'); g.fillRect(x0, 78, w, 10);
    g.fillStyle = cssVar('--link'); g.fillRect(x0, 78, Math.max(2, w * Math.sqrt(rel)), 10);
    g.fillStyle = cssVar('--xp-ink-2');
    g.fillText('Depth of field', x0, 112);
    g.fillStyle = cssVar('--xp-track'); g.fillRect(x0, 118, w, 10);
    g.fillStyle = cssVar('--link'); g.fillRect(x0, 118, w * (i / 24), 10);
    g.fillText('shallow', x0, 143); g.textAlign = 'right'; g.fillText('deep', x0 + w, 143); g.textAlign = 'left';
    const kit = i >= O.apertureIndex(3.5);
    const stops = (i - O.apertureIndex(3.5)) / 3;
    out.textContent = 'f/' + O.APERTURES[i] + ' passes ' + (rel >= 1 ? 'all' : '1/' + Math.round(1 / rel)) + ' of the light f/1.4 does. ' +
      (kit ? (stops === 0 ? 'This is your lens wide open at 13mm.' : 'That is ' + O.fmt.stops(-stops).replace('−', '') + ' stop' + (Math.abs(stops) === 1 ? '' : 's') + ' darker than your lens wide open at 13mm (f/3.5).')
        : 'Your kit lens cannot open this far: f/3.5 is its widest, at 13mm.');
  }
  const s = slider(host, 'Aperture', 0, 24, 1, i, (v) => { i = v; s.out.textContent = 'f/' + O.APERTURES[i]; draw(); });
  s.out.textContent = 'f/' + O.APERTURES[i];
  caption(host, 'Each full stop (f/2.8, f/4, f/5.6, f/8, f/11, f/16) halves the light. The numbers look odd because they are ratios: focal length divided by the width of the hole.');
  draw();
  return { redraw: draw };
};

/* --------------------------------------------------------------- stops */
// Trading stops: change one setting and another gives the light back.
REG.stops = function (host) {
  let ap = O.apertureIndex(5.6), sh = O.shutterIndex(1 / 250), iso = O.isoIndex(400), give = 'sh';
  const sum = (ap + 3) + (36 - sh) - (iso + 2);
  const out = readout(host);
  host.appendChild(el('p', { class: 'xp-caption', text: 'When you change one, which setting pays it back?' }));
  chips(host, [['sh', 'Shutter speed'], ['iso', 'ISO'], ['ap', 'Aperture']], give, (v) => { give = v; });
  const S = {};
  function rebalance(changed) {
    // Keep (ap+3) + (36-sh) - (iso+2) constant by moving the chosen payer.
    const payer = give === changed ? (changed === 'sh' ? 'iso' : 'sh') : give;
    const now = () => (ap + 3) + (36 - sh) - (iso + 2);
    let d = now() - sum;
    if (payer === 'sh') { const n = O.clamp(sh + d, 0, 42); d -= n - sh; sh = n; }
    else if (payer === 'iso') { const n = O.clamp(iso + d, 0, 19); d -= n - iso; iso = n; }
    else { const n = O.clamp(ap - d, 0, 24); d += n - ap; ap = n; }
    S.ap.input.value = ap; S.sh.input.value = sh; S.iso.input.value = iso;
    show(now() - sum);
  }
  function show(off) {
    S.ap.out.textContent = 'f/' + O.APERTURES[ap];
    S.sh.out.textContent = O.SHUTTER_LABELS[sh];
    S.iso.out.textContent = 'ISO ' + O.ISOS[iso];
    const notes = [];
    notes.push(ap <= O.apertureIndex(4) ? 'shallow focus' : ap >= O.apertureIndex(11) ? 'deep focus' : 'moderate depth');
    notes.push(sh >= O.shutterIndex(1 / 30) ? 'motion will blur' : sh <= O.shutterIndex(1 / 500) ? 'motion frozen' : 'walkers sharp, runners not');
    notes.push(iso >= O.isoIndex(3200) ? 'grainy' : iso <= O.isoIndex(400) ? 'clean' : 'a little grain');
    out.innerHTML = (off === 0 ? '<span class="xp-status" data-level="0">Same brightness</span>' : '<span class="xp-status" data-level="2">' + O.fmt.stops(-off / 3) + ' stops: out of range</span>') +
      ' &nbsp;f/' + O.APERTURES[ap] + ' · ' + O.SHUTTER_LABELS[sh] + ' · ISO ' + O.ISOS[iso] + '<br><span class="cs-dim">' + notes.join(' · ') + '</span>';
  }
  S.ap = slider(host, 'Aperture', 0, 24, 1, ap, (v) => { ap = v; rebalance('ap'); });
  S.sh = slider(host, 'Shutter speed', 0, 42, 1, sh, (v) => { sh = v; rebalance('sh'); });
  S.iso = slider(host, 'ISO', 0, 19, 1, iso, (v) => { iso = v; rebalance('iso'); });
  S.sh.input.style.direction = 'rtl';     // faster speeds to the right
  show(0);
  return {};
};

/* -------------------------------------------------------- exposurecalc */
// What shutter speed will this light give me, and can I hold it?
const LIGHT = [['Bright sun', 15], ['Hazy sun', 14], ['Overcast', 12.5], ['Open shade', 11.5], ['Sunset street', 10], ['Bright shop or museum', 8], ['Home by a window', 7], ['Home at night', 5], ['Lit street at night', 4.5], ['Candle-lit dinner', 3]];
REG.exposurecalc = function (host) {
  let li = 7, f = 23, iso = O.isoIndex(3200);
  const sel = el('select', { 'aria-label': 'Light' });
  LIGHT.forEach(([n, ev], k) => sel.appendChild(el('option', { value: k, text: n + ' (EV ' + ev + ')' })));
  sel.value = li;
  host.appendChild(el('div', { class: 'xp-controls' }, [sel]));
  const out = el('div', { class: 'cs-calc' });
  function draw() {
    const lens = O.LENSES.kit, apI = O.maxApertureIndex(lens, f), N = O.apertureAt(apI), I = O.isoAt(iso);
    const t = N * N / Math.pow(2, LIGHT[li][1] + O.log2(I / 100));
    const tl = O.SHUTTER_LABELS[O.shutterIndex(t)];
    const hold = O.handholdLimit(f, 0), holdOIS = O.handholdLimit(f, lens.ois);
    const row = (label, ok, note) => '<tr><td>' + label + '</td><td><span class="xp-status" data-level="' + (ok ? 0 : 4) + '">' + (ok ? 'Yes' : 'No') + '</span></td><td class="cs-dim">' + note + '</td></tr>';
    const need = (sp) => O.freezeTime(f, sp, 3, O.SENSOR.coc * 2);
    out.innerHTML = '<p class="cs-big">' + tl + ' <span class="cs-dim">at f/' + O.APERTURES[apI] + ', ISO ' + O.ISOS[iso] + '</span></p><table><tbody>' +
      row('Hand-held, stabiliser on', t <= holdOIS, 'limit about ' + O.fmt.seconds(holdOIS)) +
      row('Hand-held, stabiliser off', t <= hold, 'limit about ' + O.fmt.seconds(hold)) +
      row('Someone posing', t <= 1 / 60, 'wants 1/60 or faster') +
      row('People chatting', t <= need(0.5), 'wants ' + O.fmt.seconds(need(0.5))) +
      row('A child running', t <= need(3), 'wants ' + O.fmt.seconds(need(3))) +
      '</tbody></table>';
  }
  sel.addEventListener('change', () => { li = +sel.value; draw(); });
  const sf = slider(host, 'Zoom', 13, 33, 1, f, (v) => { f = v; sf.out.textContent = v + 'mm, f/' + O.APERTURES[O.maxApertureIndex(O.LENSES.kit, v)] + ' wide open'; draw(); });
  sf.out.textContent = f + 'mm, f/' + O.APERTURES[O.maxApertureIndex(O.LENSES.kit, f)] + ' wide open';
  const si = slider(host, 'ISO', 0, 19, 1, iso, (v) => { iso = v; si.out.textContent = O.ISOS[v]; draw(); });
  si.out.textContent = O.ISOS[iso];
  host.appendChild(out);
  caption(host, 'With the lens wide open. The stabiliser steadies your hands, not your subject: a moving person needs the same fast speed either way. Moving-subject rows assume they are 3 m away.');
  draw();
  return {};
};

/* ------------------------------------------------------------- dofcalc */
REG.dofcalc = function (host) {
  let f = 23, ap = O.apertureIndex(5), s = 2.5, bg = 10, prime = false;
  const cv = makeCanvas(host, 340, 120);
  const out = readout(host);
  const lx = (d) => 30 + 290 * Math.log(d / 0.2) / Math.log(500);     // 0.2 m .. 100 m, log scale
  function draw() {
    const lens = prime ? O.LENSES.prime : O.LENSES.kit;
    f = O.clamp(f, lens.fmin, lens.fmax);
    ap = O.clamp(ap, O.maxApertureIndex(lens, f), O.apertureIndex(lens.min));
    const N = O.apertureAt(ap), d = O.dof(f, N, s);
    const { g, W, H } = cv;
    g.clearRect(0, 0, W, H);
    const y = 62;
    g.fillStyle = cssVar('--xp-track'); g.fillRect(30, y - 3, 290, 6);
    const x0 = lx(Math.max(0.2, d.near)), x1 = lx(Math.min(100, d.far));
    g.fillStyle = cssVar('--link'); g.globalAlpha = 0.3; g.fillRect(x0, y - 22, Math.max(2, x1 - x0), 44); g.globalAlpha = 1;
    g.fillStyle = cssVar('--link'); g.fillRect(x0, y - 22, 2, 44); if (isFinite(d.far) && d.far < 100) g.fillRect(x1 - 2, y - 22, 2, 44);
    g.font = font(10); g.fillStyle = cssVar('--xp-ink-3'); g.textAlign = 'center';
    [0.5, 1, 2, 5, 10, 20, 50].forEach((m) => { g.fillRect(lx(m), y + 3, 1, 5); g.fillText(m < 1 ? '½m' : m + 'm', lx(m), y + 40); });
    g.fillText('∞', 322, y + 40);
    // Camera, subject, background.
    g.fillStyle = cssVar('--text');
    g.fillRect(6, y - 9, 16, 13); g.fillRect(22, y - 5, 6, 6);
    g.beginPath(); g.arc(lx(s), y - 7, 5, 0, 7); g.fill(); g.fillRect(lx(s) - 4, y - 2, 8, 13);
    g.fillStyle = cssVar('--xp-ink-2');
    const bx = lx(Math.min(100, s + bg));
    g.beginPath(); g.moveTo(bx, y - 22); g.lineTo(bx - 9, y + 2); g.lineTo(bx + 9, y + 2); g.fill(); g.fillRect(bx - 1.5, y + 2, 3, 8);
    g.font = font(11, true); g.fillStyle = cssVar('--text');
    g.fillText('sharp', (x0 + x1) / 2, y - 28);
    g.textAlign = 'left';
    const disc = O.blurDisc(f, N, s, s + bg), pct = disc / O.SENSOR.w * 100;
    const word = pct < 0.15 ? 'sharp: it reads as part of the scene' : pct < 0.5 ? 'slightly soft' : pct < 1.2 ? 'clearly blurred' : 'melted away';
    out.innerHTML = 'Sharp from <b>' + O.fmt.dist(d.near) + '</b> to <b>' + O.fmt.dist(d.far) + '</b>' + (isFinite(d.total) ? ' (' + O.fmt.dist(d.total) + ' deep)' : '') +
      '.<br>Background ' + O.fmt.dist(bg) + ' behind: <b>' + word + '</b> <span class="cs-dim">(each point spreads over ' + pct.toFixed(2) + '% of the frame width)</span>.' +
      '<br><span class="cs-dim">Hyperfocal distance ' + O.fmt.dist(d.H) + ': focus there and everything from ' + O.fmt.dist(d.H / 2) + ' to infinity is sharp.</span>';
    S.f.input.min = lens.fmin; S.f.input.max = lens.fmax; S.f.input.value = f; S.f.input.disabled = lens.fmin === lens.fmax;
    S.ap.input.min = O.maxApertureIndex(lens, f); S.ap.input.max = O.apertureIndex(lens.min); S.ap.input.value = ap;
    S.f.out.textContent = f + 'mm'; S.ap.out.textContent = 'f/' + O.APERTURES[ap]; S.s.out.textContent = O.fmt.dist(s); S.bg.out.textContent = O.fmt.dist(bg);
  }
  const S = {};
  S.f = slider(host, 'Focal length', 13, 33, 1, f, (v) => { f = v; draw(); });
  S.ap = slider(host, 'Aperture', 0, 24, 1, ap, (v) => { ap = v; draw(); });
  S.s = slider(host, 'Subject distance', 0, 100, 1, 55, (v) => { s = 0.25 * Math.pow(80, v / 100); draw(); });
  S.bg = slider(host, 'Background behind subject', 0, 100, 1, 50, (v) => { bg = 0.5 * Math.pow(100, v / 100); draw(); });
  s = 0.25 * Math.pow(80, 0.55); bg = 0.5 * Math.pow(100, 0.5);
  chips(host, [[false, 'Your 13-33mm'], [true, 'What if: 33mm f/1.4']], false, (v) => { prime = v; if (v) ap = 0; draw(); });
  draw();
  return { redraw: draw };
};

/* ----------------------------------------------------------------- fov */
REG.fov = function (host) {
  let f = 13;
  const cv = makeCanvas(host, 320, 190);
  const out = readout(host);
  function draw() {
    const { g, W, H } = cv;
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H - 14, R = 165;
    [13, 18, 23, 33].forEach((ff) => {
      const half = O.fov(ff).h / 2 * Math.PI / 180, on = Math.abs(ff - f) < 2.5;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, -Math.PI / 2 - half, -Math.PI / 2 + half); g.closePath();
      g.fillStyle = cssVar('--link'); g.globalAlpha = on ? 0.28 : 0.07; g.fill(); g.globalAlpha = 1;
      g.strokeStyle = on ? cssVar('--link') : cssVar('--xp-axis'); g.lineWidth = on ? 2 : 1; g.stroke();
      g.fillStyle = on ? cssVar('--text') : cssVar('--xp-ink-3'); g.font = font(11, on); g.textAlign = 'center';
      g.fillText(ff + 'mm', cx + Math.sin(half) * (R + 0) * 0.99 - 14, cy - Math.cos(half) * R - 4 + (ff === 13 ? 12 : 0));
    });
    const half = O.fov(f).h / 2 * Math.PI / 180;
    g.strokeStyle = cssVar('--text'); g.lineWidth = 2; g.beginPath();
    g.moveTo(cx - Math.sin(half) * R, cy - Math.cos(half) * R); g.lineTo(cx, cy); g.lineTo(cx + Math.sin(half) * R, cy - Math.cos(half) * R); g.stroke();
    g.fillStyle = cssVar('--text'); g.fillRect(cx - 9, cy - 4, 18, 12); g.fillRect(cx - 4, cy - 9, 8, 6);
    const v = O.fov(f);
    out.innerHTML = '<b>' + f + 'mm</b> sees ' + Math.round(v.h) + '° across, the view of a <b>' + Math.round(O.equivalent(f)) + 'mm</b> lens on a full-frame camera. ' +
      'At 3 m the frame is ' + O.frameWidthAt(f, 3).toFixed(1) + ' m wide: ' + (f < 16 ? 'a whole room, or a street corner.' : f < 21 ? 'a small group, head to toe.' : f < 28 ? 'two people, roughly what your eyes attend to.' : 'one person from the knees up.');
  }
  const s = slider(host, 'Zoom', 13, 33, 1, f, (v) => { f = v; s.out.textContent = v + 'mm'; draw(); });
  s.out.textContent = f + 'mm';
  draw();
  return { redraw: draw };
};

/* -------------------------------------------------------------- freeze */
REG.freeze = function (host) {
  let f = 23, dist = 4;
  const table = el('table');
  function draw() {
    let h = '<thead><tr><th>Subject</th><th class="xp-num">Crisp</th><th class="xp-num">Good enough</th></tr></thead><tbody>';
    O.SUBJECTS.forEach((sb) => {
      const a = O.freezeTime(f, sb.speed, dist, O.SENSOR.coc), b = O.freezeTime(f, sb.speed, dist, O.SENSOR.coc * 3);
      h += '<tr><td>' + sb.name + '</td><td class="xp-num">' + O.fmt.seconds(Math.min(a, 1 / 30)) + '</td><td class="xp-num">' + O.fmt.seconds(Math.min(b, 1 / 15)) + '</td></tr>';
    });
    table.innerHTML = h + '</tbody>';
  }
  const sf = slider(host, 'Zoom', 13, 33, 1, f, (v) => { f = v; sf.out.textContent = v + 'mm'; draw(); });
  const sd = slider(host, 'How far away', 1, 15, 0.5, dist, (v) => { dist = v; sd.out.textContent = v + ' m'; draw(); });
  sf.out.textContent = f + 'mm'; sd.out.textContent = dist + ' m';
  host.appendChild(table);
  caption(host, 'Slowest shutter speed that holds a subject crossing the frame. “Crisp” survives zooming in; “good enough” looks sharp on a phone. Closer and more zoomed-in both make the same movement cover more of the picture, so both need faster speeds. Someone coming straight toward you needs about a third of this.');
  draw();
  return {};
};

/* ----------------------------------------------------------- histogram */
// A made-up street scene's brightness, pushed through the camera's tone curve.
REG.histogram = function (host) {
  let ev = 0;
  const cv = makeCanvas(host, 320, 130);
  const out = readout(host);
  // Scene: deep shadow, shade, sunlit ground, bright wall, sky. (log2 of linear value, weight, spread)
  const PARTS = [[-5.2, 0.12, 0.6], [-3.6, 0.26, 0.7], [-2.2, 0.3, 0.6], [-1.1, 0.2, 0.45], [-0.55, 0.12, 0.3]];
  const tone = (H) => { const y = Math.min(1, Math.min(H, 1.45) * (1 + Math.min(H, 1.45) / 1.96) / (1 + Math.min(H, 1.45))); return y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055; };
  function draw() {
    const { g, W, H } = cv, bins = new Float32Array(64);
    let lo = 0, hi = 0;
    for (let k = 0; k < 4000; k++) {
      const u = k / 4000 * 9 - 7.5;            // log2 luminance from -7.5 to 1.5
      let w = 0;
      PARTS.forEach(([m, a, sd]) => { w += a * Math.exp(-0.5 * Math.pow((u - m) / sd, 2)) / sd; });
      const v = tone(Math.pow(2, u + ev));
      if (v >= 0.995) hi += w; else if (v <= 0.02) lo += w;
      bins[Math.min(63, Math.floor(v * 64))] += w;
    }
    let total = 0, max = 0;
    for (let b = 0; b < 64; b++) { total += bins[b]; if (b > 0 && b < 63) max = Math.max(max, bins[b]); }
    g.clearRect(0, 0, W, H);
    const x0 = 10, w = 300, y0 = 100;
    g.fillStyle = cssVar('--xp-track'); g.fillRect(x0, y0, w, 1);
    for (let b = 0; b < 64; b++) {
      const h = Math.min(90, bins[b] / max * 80), edge = b === 0 || b === 63;
      g.fillStyle = edge && bins[b] / total > 0.02 ? cssVar('--xp-critical-mark') : cssVar('--link');
      g.fillRect(x0 + b * w / 64, y0 - h, w / 64 - 0.6, h);
    }
    const grad = g.createLinearGradient(x0, 0, x0 + w, 0); grad.addColorStop(0, '#000'); grad.addColorStop(1, '#fff');
    g.fillStyle = grad; g.fillRect(x0, y0 + 5, w, 7);
    g.fillStyle = cssVar('--xp-ink-3'); g.font = font(10); g.textAlign = 'left';
    g.fillText('shadows', x0, y0 + 25); g.textAlign = 'center'; g.fillText('midtones', x0 + w / 2, y0 + 25); g.textAlign = 'right'; g.fillText('highlights', x0 + w, y0 + 25);
    const hiP = hi / total * 100, loP = lo / total * 100;
    out.innerHTML = hiP > 3 ? '<span class="xp-status" data-level="4">Piled against the right wall</span> ' + hiP.toFixed(0) + '% of the picture is pure white with nothing in it. Dial exposure compensation down.'
      : loP > 12 ? '<span class="xp-status" data-level="2">Piled against the left wall</span> ' + loP.toFixed(0) + '% is solid black. Fine for a moody night; otherwise dial compensation up.'
        : '<span class="xp-status" data-level="0">Fits</span> Detail from the darkest shadow to the brightest wall.';
  }
  const s = slider(host, 'Exposure compensation', -9, 9, 1, 0, (v) => { ev = v / 3; s.out.textContent = O.fmt.stops(ev); draw(); });
  s.out.textContent = '±0';
  draw();
  return { redraw: draw };
};

/* ------------------------------------------------------------ filmsims */
// One small picture, developed fourteen ways. Click one to load it.
REG.filmsims = function (host, ctx) {
  const Wd = 72, Hd = 48;
  // Paint a linear-light test scene once: sky, sunlit wall, foliage, skin, a red awning, deep shade.
  const base = new Float32Array(Wd * Hd * 3);
  for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) {
    let c;
    const u = x / Wd, v = y / Hd;
    if (v < 0.42) c = [0.2 + 0.25 * v, 0.38 + 0.3 * v, 0.72];                          // sky
    else c = [0.5, 0.44, 0.34];                                                        // sunlit ground
    if (u < 0.36 && v > 0.18) c = u < 0.3 && v > 0.55 ? [0.03, 0.035, 0.045] : [0.62, 0.52, 0.38];   // wall with a dark doorway
    if (u < 0.36 && v > 0.3 && v < 0.4) c = [0.55, 0.06, 0.05];                         // awning
    if (Math.hypot(u - 0.85, v - 0.42) < 0.2) c = [0.07, 0.2, 0.05];                    // tree
    if (u > 0.8 && u < 0.9 && v > 0.55) c = [0.1, 0.07, 0.04];
    if (Math.hypot((u - 0.57) * 1.5, v - 0.5) < 0.085) c = [0.52, 0.3, 0.2];            // face
    else if (u > 0.5 && u < 0.64 && v > 0.6) c = [0.75, 0.74, 0.7];                     // white shirt
    if (v > 0.9) c = [c[0] * 0.25, c[1] * 0.25, c[2] * 0.28];                            // foreground shade
    base.set(c, (y * Wd + x) * 3);
  }
  const enc = (y) => 255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
  const ss = (a, b, x) => { const t = O.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function develop(fs, g) {
    const img = g.createImageData(Wd, Hd), d = img.data;
    for (let i = 0; i < Wd * Hd; i++) {
      const y = [0, 0, 0];
      for (let k = 0; k < 3; k++) { const H = Math.min(1.45, base[i * 3 + k]); y[k] = Math.min(1, H * (1 + H / 1.96) / (1 + H)); }
      const L = 0.2126 * y[0] + 0.7152 * y[1] + 0.0722 * y[2];
      for (let k = 0; k < 3; k++) {
        let v = L + (y[k] - L) * fs.sat;
        v = Math.pow(Math.max(v, 0) / 0.18, fs.con) * 0.18;
        v += fs.lift + fs.sh[k] * (1 - ss(0, 0.3, L)) + fs.hi[k] * ss(0.25, 1, L);
        d[i * 4 + k] = enc(O.clamp(v, 0, 1));
      }
      d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  const grid = el('div', { class: 'cs-sims' });
  const note = readout(host);
  const btns = O.FILMSIMS.map((fs) => {
    const c = el('canvas', { width: Wd, height: Hd });
    develop(fs, c.getContext('2d'));
    const b = el('button', { type: 'button', class: 'cs-sim', 'aria-pressed': 'false' }, [c, el('span', { text: fs.name + (fs.dial ? ' ●' : '') })]);
    b.addEventListener('click', () => {
      btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      note.innerHTML = '<b>' + fs.name + '.</b> ' + fs.note + (fs.dial ? ' <span class="cs-dim">On the dial as ' + fs.dial + '.</span>' : ' <span class="cs-dim">Not on the dial: reach it through C or save it to FS1-FS3.</span>');
      if (ctx && ctx.setFilm) ctx.setFilm(fs.id);
    });
    grid.appendChild(b);
    return b;
  });
  host.insertBefore(grid, note);
  note.textContent = 'Click a look to load it into the viewfinder. ● marks the six printed on the dial.';
  caption(host, 'These swatches and the viewfinder approximate each simulation’s character (contrast, saturation, colour of shadows and highlights). The camera’s own rendering is subtler and better.');
  return {};
};

/* ------------------------------------------------------------- plumbing */
function mount(name, host, ctx) {
  const make = REG[name];
  if (!make) return null;
  host.textContent = '';
  const h = make(host, ctx) || {};
  h.host = host;
  h.destroy = () => { live.delete(h); host.textContent = ''; };
  live.add(h);
  return h;
}
function emit(what) { if (what === 'theme') live.forEach((h) => { if (h.redraw) h.redraw(); }); }

CS.widgets = { mount, emit };
})(window.CameraSkills = window.CameraSkills || {});
