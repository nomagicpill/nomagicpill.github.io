/*
 * Charts and calculators for knowledge/drafttransistors.html.
 *
 * Each widget mounts into a <div data-widget="name"> inside a topic when the
 * topic opens and is destroyed when it closes, so only what is on screen
 * runs. Colours come from CSS tokens (--tx-c1..c6 for series, the --xp-*
 * chart tokens for axes) and are re-read on every draw, so charts follow the
 * theme toggle. The numbers come from physics.js; nothing here invents data.
 * Becomes Transistors.widgets.
 */
(function (TR) {
'use strict';
const { cssVar } = window.Explainer;
const PH = TR.physics;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');

/* ----------------------------------------------------------------------------
 * Registry, events, ticking
 * ------------------------------------------------------------------------- */

const REG = {};
let active = [];

function mount(type, host, ctx) {
  const make = REG[type];
  if (!make) return null;
  host.innerHTML = '';
  const w = make(host, ctx) || {};
  active.push(w);
  let ro = null;
  if (w.draw) {
    w.draw();
    if (window.ResizeObserver) {
      let lastW = host.clientWidth;
      ro = new ResizeObserver(() => { if (Math.abs(host.clientWidth - lastW) > 2) { lastW = host.clientWidth; w.draw(); } });
      ro.observe(host);
    }
  }
  return {
    destroy() {
      active = active.filter((x) => x !== w);
      if (ro) ro.disconnect();
      if (w.destroy) w.destroy();
      host.innerHTML = '';
    },
  };
}

function emit(type, data) {
  for (const w of active) {
    if (w.on) w.on(type, data);
    if (type === 'theme' && w.draw) w.draw();
  }
}

function tick(dt, ctx) { for (const w of active) if (w.tick) w.tick(dt, ctx); }

/* ----------------------------------------------------------------------------
 * DOM helpers
 * ------------------------------------------------------------------------- */

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'style') e.style.cssText = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  if (text !== undefined) e.textContent = text;
  return e;
}

// A labelled range input. log: the slider moves in log10 space.
function slider(parent, { label, min, max, step = 0.01, value, log = false, fmt: f = (v) => fmt(v), onInput }) {
  const wrap = el('div', { class: 'xp-field' });
  const id = 'w' + Math.random().toString(36).slice(2, 8);
  const lab = el('label', { for: id });
  const span = el('span');
  span.innerHTML = richHTML(label);
  lab.appendChild(span);
  lab.appendChild(document.createTextNode(' '));
  const out = el('output', { for: id });
  lab.appendChild(out);
  const inp = el('input', { type: 'range', id, min: log ? Math.log10(min) : min, max: log ? Math.log10(max) : max, step: log ? 0.001 : step });
  const get = () => (log ? Math.pow(10, +inp.value) : +inp.value);
  const set = (v) => { inp.value = log ? Math.log10(v) : v; out.textContent = f(get()); };
  set(value);
  inp.addEventListener('input', () => { out.textContent = f(get()); onInput(get()); });
  wrap.appendChild(lab);
  wrap.appendChild(inp);
  parent.appendChild(wrap);
  return { el: wrap, get, set, input: inp };
}

function select(parent, { label, options, value, onChange }) {
  const wrap = el('div', { class: 'xp-field' });
  const id = 'w' + Math.random().toString(36).slice(2, 8);
  const lb = el('label', { for: id });
  lb.innerHTML = richHTML(label);
  wrap.appendChild(lb);
  const s = el('select', { id });
  for (const [v, t] of options) {
    const o = el('option', { value: v }, t);
    if (v === value) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  wrap.appendChild(s);
  parent.appendChild(wrap);
  return { el: wrap, get: () => s.value, set: (v) => { s.value = v; }, select: s };
}

function chips(parent, items, value, onPick, label) {
  const row = el('div', { class: 'xp-controls', role: 'group' });
  if (label) row.setAttribute('aria-label', label);
  const btns = items.map(([v, t]) => {
    const b = el('button', { class: 'xp-chip', type: 'button', 'aria-pressed': String(v === value) });
    b.innerHTML = richHTML(t);
    b.addEventListener('click', () => { btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); onPick(v); });
    row.appendChild(b);
    return b;
  });
  parent.appendChild(row);
  return { el: row, set(v) { btns.forEach((b, i) => b.setAttribute('aria-pressed', String(items[i][0] === v))); } };
}

function grid(parent, cls = 'tx-grid2') { const g = el('div', { class: cls }); parent.appendChild(g); return g; }

// Read-outs: a small definition grid, updated by key.
function readouts(parent, keys) {
  const d = el('dl', { class: 'tx-readouts' });
  const map = {};
  for (const [k, label] of keys) {
    const row = el('div');
    const dt = el('dt');
    dt.innerHTML = richHTML(label);
    row.appendChild(dt);
    const dd = el('dd', {}, '–');
    row.appendChild(dd);
    d.appendChild(row);
    map[k] = dd;
  }
  parent.appendChild(d);
  return (vals) => { for (const k in vals) if (map[k]) map[k].textContent = vals[k]; };
}

function canvas(parent, h, cls) {
  const c = el('canvas', cls ? { class: cls } : {});
  c.style.height = h + 'px';
  parent.appendChild(c);
  return c;
}

function caption(parent, text) { const p = el('p', { class: 'xp-caption' }); p.innerHTML = richHTML(text); parent.appendChild(p); }

/* ----------------------------------------------------------------------------
 * Subscripts: "V_GS" is written with a real subscript, in HTML and on canvas.
 * ------------------------------------------------------------------------- */

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function richHTML(t) { return esc(t).replace(/_([A-Za-z0-9,]+)/g, '<sub>$1</sub>'); }

function runs(t) {
  const out = [];
  const re = /_([A-Za-z0-9,]+)/g;
  let last = 0, m;
  while ((m = re.exec(t))) {
    if (m.index > last) out.push([t.slice(last, m.index), false]);
    out.push([m[1], true]);
    last = re.lastIndex;
  }
  if (last < t.length) out.push([t.slice(last), false]);
  return out;
}

// fillText with subscripts, honouring the current textAlign.
function fillRich(g, t, x, y) {
  t = String(t);
  if (t.indexOf('_') < 0) { g.fillText(t, x, y); return; }
  const font = g.font;
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  const px = m ? parseFloat(m[1]) : 11;
  const subFont = font.replace(/\d+(?:\.\d+)?px/, Math.round(px * 0.78) + 'px');
  const parts = runs(t);
  let w = 0;
  for (const [s, sub] of parts) { g.font = sub ? subFont : font; w += g.measureText(s).width; }
  const align = g.textAlign;
  let cx = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
  g.textAlign = 'left';
  for (const [s, sub] of parts) {
    g.font = sub ? subFont : font;
    g.fillText(s, cx, sub ? y + px * 0.3 : y);
    cx += g.measureText(s).width;
  }
  g.font = font;
  g.textAlign = align;
}

/* ----------------------------------------------------------------------------
 * Number formatting
 * ------------------------------------------------------------------------- */

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function sup(n) { return String(n).split('').map((c) => (c === '-' ? '⁻' : SUP[+c] || c)).join(''); }
function sci(x, d = 1) {
  if (!Number.isFinite(x)) return '–';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e <= 3) return x.toFixed(Math.max(0, d - e));
  const m = x / Math.pow(10, e);
  return m.toFixed(d) + '×10' + sup(e);
}
function amps(a) {
  a = Math.abs(a);
  if (!Number.isFinite(a)) return '–';
  if (a >= 1e-3) return (a * 1e3).toFixed(2) + ' mA';
  if (a >= 1e-6) return (a * 1e6).toFixed(a >= 1e-4 ? 0 : 1) + ' µA';
  if (a >= 1e-9) return (a * 1e9).toFixed(1) + ' nA';
  if (a >= 1e-12) return (a * 1e12).toFixed(1) + ' pA';
  return (a * 1e15).toFixed(1) + ' fA';
}
const dopeFmt = (v) => sci(v, 1) + ' cm⁻³';

/* ----------------------------------------------------------------------------
 * Canvas and charts
 * ------------------------------------------------------------------------- */

function ink() {
  return {
    text: cssVar('--text'), ink2: cssVar('--xp-ink-2'), ink3: cssVar('--xp-ink-3'),
    grid: cssVar('--xp-grid'), axis: cssVar('--xp-axis'), bg: cssVar('--xp-chart-bg'),
    link: cssVar('--link'), track: cssVar('--xp-track'),
    c: [1, 2, 3, 4, 5, 6].map((i) => cssVar('--tx-c' + i)),
    elec: cssVar('--tx-elec'), hole: cssVar('--tx-hole'), ox: cssVar('--tx-ox'), si: cssVar('--tx-si'),
    good: cssVar('--xp-good-mark'), bad: cssVar('--xp-critical-mark'), warn: cssVar('--xp-warn-mark'),
    dep: cssVar('--tx-dep'),
  };
}

function ctx2d(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (w < 8 || h < 8) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = '11px Arial, sans-serif';
  g.textBaseline = 'middle';
  return { g, w, h };
}

function niceTicks(lo, hi, n = 5) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= n + 0.5) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9 * step; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function axis(a, p0, p1) {
  const lg = !!a.log;
  const f = lg ? Math.log10 : (v) => v;
  const lo = f(a.min), hi = f(a.max);
  const map = (v) => p0 + (f(lg ? Math.max(v, 1e-300) : v) - lo) / (hi - lo) * (p1 - p0);
  const inv = (p) => { const t = lo + (p - p0) / (p1 - p0) * (hi - lo); return lg ? Math.pow(10, t) : t; };
  let ticks;
  if (a.ticks) ticks = a.ticks;
  else if (lg) {
    ticks = [];
    const every = Math.max(1, Math.ceil((hi - lo) / (a.maxTicks || 7)));
    for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) if ((e - Math.ceil(lo)) % every === 0) ticks.push(Math.pow(10, e));
  } else ticks = niceTicks(a.min, a.max, a.n || 5);
  return { map, inv, ticks, lg, p0, p1, a };
}

const tickFmt = (v, lg) => {
  if (lg) { const e = Math.round(Math.log10(v)); return e >= -2 && e <= 3 ? String(+v.toPrecision(3)) : '10' + sup(e); }
  if (Math.abs(v) >= 1e4) return (v / 1000).toFixed(0) + 'k';
  return String(+v.toPrecision(4));
};

/*
 * plot(canvas, { x, y, series, marks, vlines, hlines, legend })
 *   x/y: { min, max, log, label, fmt, ticks }
 *   series: [{ pts, color, width, dash, label, fill }]
 * Returns the mapping helpers so callers can draw extra marks.
 */
function plot(c, spec) {
  const r = ctx2d(c);
  if (!r) return null;
  const { g, w, h } = r;
  const k = ink();
  const m = Object.assign({ l: 52, r: 12, t: 10, b: 34 }, spec.margin || {});
  const X = axis(spec.x, m.l, w - m.r);
  const Y = axis(spec.y, h - m.b, m.t);
  g.fillStyle = k.bg;
  g.fillRect(m.l, m.t, w - m.l - m.r, h - m.t - m.b);
  g.lineWidth = 1;
  g.strokeStyle = k.grid;
  g.fillStyle = k.ink3;
  g.textAlign = 'right';
  for (const t of Y.ticks) {
    const y = Math.round(Y.map(t)) + 0.5;
    if (y < m.t - 1 || y > h - m.b + 1) continue;
    g.beginPath(); g.moveTo(m.l, y); g.lineTo(w - m.r, y); g.stroke();
    fillRich(g, spec.y.fmt ? spec.y.fmt(t) : tickFmt(t, Y.lg), m.l - 5, y);
  }
  g.textAlign = 'center';
  g.textBaseline = 'top';
  // Drop every other x tick until the labels fit.
  let xt = X.ticks.slice();
  const lw = (t) => g.measureText(spec.x.fmt ? spec.x.fmt(t) : tickFmt(t, X.lg)).width + 8;
  while (xt.length > 2 && xt.some((t, i) => i > 0 && Math.abs(X.map(t) - X.map(xt[i - 1])) < (lw(t) + lw(xt[i - 1])) / 2)) xt = xt.filter((_, i) => i % 2 === 0);
  for (const t of xt) {
    const x = Math.round(X.map(t)) + 0.5;
    if (x < m.l - 1 || x > w - m.r + 1) continue;
    g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, h - m.b); g.stroke();
    fillRich(g, spec.x.fmt ? spec.x.fmt(t) : tickFmt(t, X.lg), x, h - m.b + 4);
  }
  g.strokeStyle = k.axis;
  g.beginPath(); g.moveTo(m.l + 0.5, m.t); g.lineTo(m.l + 0.5, h - m.b + 0.5); g.lineTo(w - m.r, h - m.b + 0.5); g.stroke();
  g.fillStyle = k.ink2;
  if (spec.x.label) { g.textBaseline = 'bottom'; fillRich(g, spec.x.label, (m.l + w - m.r) / 2, h - 1); }
  if (spec.y.label) {
    g.save(); g.translate(11, (m.t + h - m.b) / 2); g.rotate(-Math.PI / 2);
    g.textBaseline = 'middle'; fillRich(g, spec.y.label, 0, 0); g.restore();
  }
  g.textBaseline = 'middle';
  // Clip to the plot area for data.
  g.save();
  g.beginPath(); g.rect(m.l, m.t, w - m.l - m.r, h - m.t - m.b); g.clip();
  for (const h0 of spec.hlines || []) {
    const y = Y.map(h0.y);
    g.strokeStyle = h0.color || k.ink3; g.setLineDash(h0.dash || [4, 4]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(m.l, y); g.lineTo(w - m.r, y); g.stroke(); g.setLineDash([]);
    if (h0.label) { g.fillStyle = h0.color || k.ink3; g.textAlign = 'left'; fillRich(g, h0.label, m.l + 4, y - 7); }
  }
  for (const v of spec.vlines || []) {
    const x = X.map(v.x);
    g.strokeStyle = v.color || k.ink3; g.setLineDash(v.dash || [4, 4]); g.lineWidth = v.width || 1;
    g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, h - m.b); g.stroke(); g.setLineDash([]);
    if (v.label) {
      g.fillStyle = v.color || k.ink3;
      const tw = g.measureText(v.label.replace(/_/g, '')).width;
      const flip = x + 4 + tw > w - m.r;
      g.textAlign = flip ? 'right' : 'left';
      fillRich(g, v.label, flip ? x - 4 : x + 4, m.t + 9 + (v.dy || 0));
    }
  }
  for (const s of spec.series || []) {
    if (!s.pts || s.pts.length < 2) continue;
    g.beginPath();
    let started = false;
    for (const [x, y] of s.pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || (Y.lg && y <= 0)) { started = false; continue; }
      const px = X.map(x), py = Y.map(y);
      if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
    }
    if (s.fill) {
      g.lineTo(X.map(s.pts[s.pts.length - 1][0]), Y.map(spec.y.log ? spec.y.min : Math.max(spec.y.min, 0)));
      g.lineTo(X.map(s.pts[0][0]), Y.map(spec.y.log ? spec.y.min : Math.max(spec.y.min, 0)));
      g.closePath();
      g.globalAlpha = 0.18; g.fillStyle = s.color; g.fill(); g.globalAlpha = 1;
    } else {
      g.strokeStyle = s.color || k.link;
      g.lineWidth = s.width || 2;
      g.setLineDash(s.dash || []);
      g.stroke();
      g.setLineDash([]);
    }
  }
  for (const mk of spec.marks || []) {
    const x = X.map(mk.x), y = Y.map(mk.y);
    g.fillStyle = mk.color || k.text;
    g.beginPath(); g.arc(x, y, mk.r || 4, 0, Math.PI * 2); g.fill();
    if (mk.ring) { g.strokeStyle = k.bg; g.lineWidth = 1.5; g.stroke(); }
    if (mk.label) {
      g.font = (mk.bold ? 'bold ' : '') + '11px Arial, sans-serif';
      g.textAlign = mk.align || 'left';
      g.fillStyle = mk.labelColor || k.text;
      fillRich(g, mk.label, x + (mk.align === 'right' ? -7 : 7), y + (mk.dy || -9));
      g.font = '11px Arial, sans-serif';
    }
  }
  g.restore();
  // Series labels at their right ends (direct labelling instead of a legend),
  // nudged apart vertically so they never overlap.
  if (spec.endLabels) {
    const items = [];
    g.font = 'bold 11px Arial, sans-serif';
    for (const s of spec.series) {
      if (!s.label || !s.pts || !s.pts.length) continue;
      let p = null;
      for (let i = s.pts.length - 1; i >= 0; i--) {
        const [x, y] = s.pts[i];
        if (Number.isFinite(y) && (!Y.lg || y > 0) && x <= spec.x.max && y >= spec.y.min && y <= spec.y.max) { p = s.pts[i]; break; }
      }
      if (!p) continue;
      const tw = g.measureText(s.label.replace(/_/g, '')).width;
      items.push({ s, tw, x: Math.min(X.map(p[0]) + 4, w - tw - 2), y: Y.map(p[1]) - 8 + (s.labelDy || 0) });
    }
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 13) items[i].y = items[i - 1].y + 13;
    const over = items.length ? items[items.length - 1].y - (h - m.b - 4) : 0;
    if (over > 0) for (const it of items) it.y -= over;
    g.textAlign = 'left';
    for (const it of items) { g.fillStyle = it.s.color; fillRich(g, it.s.label, it.x, it.y); }
    g.font = '11px Arial, sans-serif';
  }
  return { g, w, h, m, X, Y, k };
}

function legend(parent, items) {
  const d = el('div', { class: 'xp-legend' });
  for (const [colorVar, text, dash] of items) {
    const s = el('span');
    const sw = el('i', { class: 'tx-lsw' + (dash ? ' tx-lsw-dash' : '') });
    sw.style.setProperty('--sw', `var(${colorVar})`);
    s.appendChild(sw);
    s.appendChild(document.createTextNode(text));
    d.appendChild(s);
  }
  parent.appendChild(d);
  return d;
}

/* ----------------------------------------------------------------------------
 * Band diagrams
 * ------------------------------------------------------------------------- */

// Draw a MOS band diagram (from mosCap().bands) into a canvas region.
// opts: { vacuum: bool, eRange: [lo, hi], depth: nm, labels: bool }
function drawMOSBands(c, B, opts = {}) {
  const r = ctx2d(c);
  if (!r) return;
  const { g, w, h } = r;
  const k = ink();
  const m = { l: 34, r: 40, t: 14, b: 22 };
  const pw = w - m.l - m.r, phh = h - m.t - m.b;
  // Horizontal layout: gate 16%, dielectric 18% (drawn, whatever its thickness), silicon the rest.
  const xg0 = m.l, xg1 = m.l + pw * 0.16, xo1 = m.l + pw * 0.34, xs1 = m.l + pw;
  const depth = opts.depth || B.si[B.si.length - 1].x;
  const tPhys = B.tPhys;
  const xOx = (x) => xo1 - (-x) / tPhys * (xo1 - xg1);      // x <= 0 in nm
  const xSi = (x) => xo1 + Math.min(x, depth) / depth * (xs1 - xo1);
  let lo, hi;
  if (opts.eRange) [lo, hi] = opts.eRange;
  else {
    const all = [];
    for (const p of B.si) all.push(p.Ec, p.Ev);
    all.push(B.gate.EF);
    lo = Math.min(...all) - 0.8; hi = Math.max(...all) + 0.8;
  }
  if (opts.vacuum) hi = Math.max(hi, B.evacBulk + 0.4, B.gate.evac + 0.4);
  const Y = (E) => m.t + (hi - E) / (hi - lo) * phh;

  // Regions.
  g.fillStyle = k.track; g.globalAlpha = 0.35; g.fillRect(xg0, m.t, xg1 - xg0, phh); g.globalAlpha = 1;
  // Dielectric bands: filled forbidden gap.
  for (const L of B.layers) {
    const xa = xOx(L.x0), xb = xOx(L.x1);
    g.fillStyle = k.ox; g.globalAlpha = 0.35;
    g.beginPath();
    g.moveTo(xa, Y(L.EcIn)); g.lineTo(xb, Y(L.EcOut)); g.lineTo(xb, Y(L.EvOut)); g.lineTo(xa, Y(L.EvIn)); g.closePath(); g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = k.text; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(xa, Y(L.EcIn)); g.lineTo(xb, Y(L.EcOut)); g.stroke();
    g.beginPath(); g.moveTo(xa, Y(L.EvIn)); g.lineTo(xb, Y(L.EvOut)); g.stroke();
    g.strokeStyle = k.axis; g.lineWidth = 1;
    g.beginPath(); g.moveTo(xb, m.t); g.lineTo(xb, m.t + phh); g.stroke();
    // Band edges beyond the chart: say how far.
    const d = PH.DIELECTRICS[L.mat];
    g.fillStyle = k.ink2; g.textAlign = 'center';
    if (Math.abs(xa - xb) > 44 && Math.min(L.EcIn, L.EcOut) > hi) fillRich(g, '↑ E_c +' + d.cbo.toFixed(1) + ' eV', (xa + xb) / 2, m.t + 8);
    if (Math.abs(xa - xb) > 44 && Math.max(L.EvIn, L.EvOut) < lo) fillRich(g, '↓ E_v −' + (d.eg - d.cbo - B.eg).toFixed(1) + ' eV', (xa + xb) / 2, m.t + phh - 8);
  }
  g.strokeStyle = k.axis;
  g.beginPath(); g.moveTo(xo1, m.t); g.lineTo(xo1, m.t + phh); g.stroke();

  // Silicon: carriers first (under the lines), then Ec, Ev, Ei.
  const nTot = B.si.map((p) => p.n), pTot = B.si.map((p) => p.p);
  for (let i = 0; i < B.si.length - 1; i++) {
    const p = B.si[i], q = B.si[i + 1];
    if (p.x > depth) break;
    const xa = xSi(p.x), xb = xSi(q.x);
    const dens = (v) => clamp((Math.log10(Math.max(v, 1)) - 15) / 5, 0, 1);
    const de = dens(nTot[i]), dh = dens(pTot[i]);
    if (de > 0.02) { g.fillStyle = k.elec; g.globalAlpha = 0.6 * de; g.fillRect(xa, Y(p.Ec) - 9 * de, Math.max(1, xb - xa), 9 * de); }
    if (dh > 0.02) { g.fillStyle = k.hole; g.globalAlpha = 0.6 * dh; g.fillRect(xa, Y(p.Ev), Math.max(1, xb - xa), 9 * dh); }
  }
  g.globalAlpha = 1;
  const line = (key, color, width, dash) => {
    g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []);
    g.beginPath();
    B.si.forEach((p, i) => { const x = xSi(p.x), y = Y(p[key]); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
    g.stroke(); g.setLineDash([]);
  };
  line('Ec', k.text, 2);
  line('Ev', k.text, 2);
  line('Ei', k.ink3, 1, [3, 3]);
  // Fermi levels: silicon (0) and gate (-VG).
  g.strokeStyle = k.link; g.lineWidth = 1.5; g.setLineDash([6, 3]);
  g.beginPath(); g.moveTo(xo1, Y(0)); g.lineTo(xs1, Y(0)); g.stroke();
  g.setLineDash([]);
  g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(xg0, Y(B.gate.EF)); g.lineTo(xg1, Y(B.gate.EF)); g.stroke();
  if (opts.vacuum) {
    g.strokeStyle = k.ink3; g.lineWidth = 1; g.setLineDash([2, 3]);
    g.beginPath();
    g.moveTo(xg0, Y(B.gate.evac)); g.lineTo(xg1, Y(B.gate.evac));
    let ev = B.gate.evac;
    for (let i = B.layers.length - 1; i >= 0; i--) {
      const L = B.layers[i];
      const chi = PH.CHI_SI - PH.DIELECTRICS[L.mat].cbo;
      g.lineTo(xOx(L.x1), Y(L.EcOut + chi)); g.lineTo(xOx(L.x0), Y(L.EcIn + chi)); ev = L.EcIn + chi;
    }
    B.si.forEach((p) => { if (p.x <= depth) g.lineTo(xSi(p.x), Y(p.Ec + PH.CHI_SI)); });
    g.stroke(); g.setLineDash([]);
    g.fillStyle = k.ink3; g.textAlign = 'left';
    fillRich(g, 'vacuum level', xs1 - 76, Y(B.evacBulk) - 8);
    void ev;
  }
  // Labels.
  const end = B.si[B.si.length - 1];
  g.textAlign = 'left'; g.font = 'bold 11px Arial, sans-serif';
  // Right-hand labels, pushed apart so close levels stay readable.
  const tags = [['E_c', Y(end.Ec), k.text], ['E_i', Y(end.Ei), k.ink3], ['E_F', Y(0), k.link], ['E_v', Y(end.Ev), k.text]].sort((p, q) => p[1] - q[1]);
  for (let i = 1; i < tags.length; i++) if (tags[i][1] - tags[i - 1][1] < 12) tags[i][1] = tags[i - 1][1] + 12;
  for (const [t, y, col] of tags) { g.fillStyle = col; fillRich(g, t, xs1 + 4, y); }
  g.textAlign = 'center'; g.font = '11px Arial, sans-serif';
  g.fillStyle = k.link; fillRich(g, 'E_F (gate)', (xg0 + xg1) / 2, Y(B.gate.EF) - 9);
  g.fillStyle = k.ink2;
  fillRich(g, 'Gate', (xg0 + xg1) / 2, m.t + phh + 11);
  fillRich(g, B.layers.map((L) => L.name).join(' + '), (xg1 + xo1) / 2, m.t + phh + 11);
  fillRich(g, 'Silicon →', (xo1 + xs1) / 2, m.t + phh + 11);
  // Energy scale.
  g.save(); g.translate(10, m.t + phh / 2); g.rotate(-Math.PI / 2); g.fillStyle = k.ink3; fillRich(g, 'Energy (eV)', 0, 0); g.restore();
  // 1 eV scale bar.
  g.strokeStyle = k.ink3; g.lineWidth = 1;
  const y0 = m.t + phh - 4;
  g.beginPath(); g.moveTo(m.l - 12, y0); g.lineTo(m.l - 12, Y(lo + 1) - (Y(lo) - y0)); g.stroke();
  g.fillStyle = k.ink3; g.textAlign = 'left'; g.fillText('1 eV', m.l - 9, y0 - (Y(lo) - Y(lo + 1)) / 2);
  return { Y, xSi, xo1, xg1 };
}

/* ============================================================================
 * PHYSICS WIDGETS
 * ========================================================================= */

// ---- Semiconductors: bands, doping and the Fermi level -----------------------
REG.bandsi = (host) => {
  const st = { type: 'p', N: 1e16, T: 300 };
  const c = canvas(host, 210);
  const row = grid(host);
  chips(host, [['n', 'n-type (phosphorus)'], ['i', 'Intrinsic'], ['p', 'p-type (boron)']], st.type, (v) => { st.type = v; draw(); }, 'Doping type');
  slider(row, { label: 'Doping', min: 1e13, max: 1e20, log: true, value: st.N, fmt: dopeFmt, onInput: (v) => { st.N = v; draw(); } });
  slider(row, { label: 'Temperature', min: 200, max: 600, step: 1, value: st.T, fmt: (v) => v.toFixed(0) + ' K (' + (v - 273).toFixed(0) + ' °C)', onInput: (v) => { st.T = v; draw(); } });
  const out = readouts(host, [['ni', 'Intrinsic density nᵢ'], ['n', 'Electrons n'], ['p', 'Holes p'], ['ef', 'E_F − E_i'], ['eg', 'Band gap'], ['rho', 'Resistivity']]);
  function draw() {
    const T = st.T;
    const N = st.type === 'i' ? 1 : st.N;
    const b = PH.bulk(st.type === 'i' ? 'p' : st.type, st.type === 'i' ? 1e-30 + 1 : N, T);
    const eg = PH.bandGap(T);
    const r = ctx2d(c); if (!r) return;
    const { g, w, h } = r; const k = ink();
    const Y = (E) => h / 2 - E / 1.9 * (h - 30);
    const x0 = 60, x1 = w - 60;
    // Carrier clouds sized by log density.
    const dens = (v) => clamp((Math.log10(v) - 4) / 16, 0, 1);
    const de = dens(b.n), dh = dens(b.p);
    g.fillStyle = k.elec; g.globalAlpha = 0.18 + 0.6 * de; g.fillRect(x0, Y(eg / 2) - 26 * de - 2, x1 - x0, 26 * de + 2);
    g.fillStyle = k.hole; g.globalAlpha = 0.18 + 0.6 * dh; g.fillRect(x0, Y(-eg / 2), x1 - x0, 26 * dh + 2);
    g.globalAlpha = 1;
    g.strokeStyle = k.text; g.lineWidth = 2;
    for (const E of [eg / 2, -eg / 2]) { g.beginPath(); g.moveTo(x0, Y(E)); g.lineTo(x1, Y(E)); g.stroke(); }
    g.strokeStyle = k.ink3; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(x0, Y(0)); g.lineTo(x1, Y(0)); g.stroke();
    g.strokeStyle = k.link; g.lineWidth = 2; g.setLineDash([7, 4]);
    g.beginPath(); g.moveTo(x0, Y(b.ef)); g.lineTo(x1, Y(b.ef)); g.stroke(); g.setLineDash([]);
    g.font = 'bold 11px Arial, sans-serif'; g.textAlign = 'left';
    g.fillStyle = k.text; fillRich(g, 'E_c  conduction band', x1 + 4 - 52, Y(eg / 2) - 10);
    fillRich(g, 'E_v  valence band', x1 + 4 - 52, Y(-eg / 2) + 12);
    g.fillStyle = k.ink3; fillRich(g, 'E_i', x1 + 6, Y(0));
    g.fillStyle = k.link; fillRich(g, 'E_F', x1 + 6, Y(b.ef) + (Math.abs(b.ef) < 0.05 ? 10 : 0));
    g.font = '11px Arial, sans-serif'; g.fillStyle = k.ink2; g.textAlign = 'center';
    fillRich(g, 'band gap ' + eg.toFixed(3) + ' eV', x0 + 70, Y(0) - 8);
    fillRich(g, 'free electrons', (x0 + x1) / 2, Y(eg / 2) - 34 * de - 8);
    fillRich(g, 'holes', (x0 + x1) / 2, Y(-eg / 2) + 34 * dh + 10);
    out({ ni: sci(b.ni) + ' cm⁻³', n: sci(b.n) + ' cm⁻³', p: sci(b.p) + ' cm⁻³', ef: (b.ef >= 0 ? '+' : '') + b.ef.toFixed(3) + ' eV', eg: eg.toFixed(3) + ' eV', rho: b.rho >= 1000 ? sci(b.rho, 1) + ' Ω·cm' : b.rho.toPrecision(3) + ' Ω·cm' });
  }
  return { draw };
};

// ---- The pn junction --------------------------------------------------------
REG.pn = (host) => {
  const st = { Na: 1e17, Nd: 1e18, V: 0 };
  const c = canvas(host, 230);
  const row = grid(host);
  slider(row, { label: 'p side (boron)', min: 1e14, max: 1e20, log: true, value: st.Na, fmt: dopeFmt, onInput: (v) => { st.Na = v; draw(); } });
  slider(row, { label: 'n side (phosphorus)', min: 1e14, max: 1e20, log: true, value: st.Nd, fmt: dopeFmt, onInput: (v) => { st.Nd = v; draw(); } });
  slider(host, { label: 'Applied voltage (p relative to n)', min: -3, max: 0.7, step: 0.01, value: 0, fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + ' V ' + (v > 0.02 ? '(forward)' : v < -0.02 ? '(reverse)' : '(none)'), onInput: (v) => { st.V = v; draw(); } });
  const out = readouts(host, [['vbi', 'Built-in potential'], ['w', 'Depletion width'], ['xn', 'into n side / p side'], ['e', 'Peak field'], ['j', 'Current density']]);
  function draw() {
    const T = 300, Ut = PH.thermalV(T);
    const J = PH.pnJunction({ Na: st.Na, Nd: st.Nd, V: st.V, T });
    const eg = PH.bandGap(T);
    const r = ctx2d(c); if (!r) return;
    const { g, w, h } = r; const k = ink();
    const span = Math.max(J.W * 2.6, 60e-7);
    const X = (x) => 20 + (x + span / 2) / span * (w - 60);  // x in cm, junction at 0
    // Potential: p side at -(Vj) relative to n side (electron energy higher on the p side).
    const phi = (x) => {
      if (x <= -J.xp) return 0;
      if (x >= J.xn) return J.Vj;
      if (x < 0) return PH.Q * st.Na / (2 * PH.EPS_SI) * Math.pow(x + J.xp, 2);
      return J.Vj - PH.Q * st.Nd / (2 * PH.EPS_SI) * Math.pow(J.xn - x, 2);
    };
    const efp = Ut * Math.log(st.Na / PH.ni(T));     // Ei - EF on p side
    const EcP = eg / 2 + efp;                       // Ec on the far p side, relative to EF_p
    const lo = EcP - J.Vj - eg - 0.5, hi = EcP + 0.6;
    const Y = (E) => 14 + (hi - E) / (hi - lo) * (h - 36);
    // Depletion shading.
    g.fillStyle = k.dep; g.globalAlpha = 0.12; g.fillRect(X(-J.xp), 8, X(J.xn) - X(-J.xp), h - 26); g.globalAlpha = 1;
    g.fillStyle = k.ink3; g.textAlign = 'center';
    fillRich(g, 'depletion region', (X(-J.xp) + X(J.xn)) / 2, h - 8);
    fillRich(g, 'p side', X(-span / 2) + 30, h - 8);
    fillRich(g, 'n side', X(span / 2) - 30, h - 8);
    const curve = (off, color, width, dash) => {
      g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []);
      g.beginPath();
      for (let i = 0; i <= 200; i++) { const x = -span / 2 + span * i / 200; const E = off - phi(x); if (i === 0) g.moveTo(X(x), Y(E)); else g.lineTo(X(x), Y(E)); }
      g.stroke(); g.setLineDash([]);
    };
    curve(EcP, k.text, 2);
    curve(EcP - eg, k.text, 2);
    curve(EcP - eg / 2, k.ink3, 1, [3, 3]);
    // Quasi-Fermi levels: EF on the p side at 0, on the n side at -V.
    g.strokeStyle = k.link; g.lineWidth = 1.6; g.setLineDash([6, 3]);
    g.beginPath(); g.moveTo(X(-span / 2), Y(0)); g.lineTo(X(0), Y(0)); g.stroke();
    g.beginPath(); g.moveTo(X(0), Y(-st.V)); g.lineTo(X(span / 2), Y(-st.V)); g.stroke(); g.setLineDash([]);
    g.textAlign = 'left'; g.font = 'bold 11px Arial, sans-serif';
    g.fillStyle = k.text; fillRich(g, 'E_c', X(span / 2) + 4, Y(EcP - J.Vj)); fillRich(g, 'E_v', X(span / 2) + 4, Y(EcP - J.Vj - eg));
    g.fillStyle = k.link; fillRich(g, 'E_F', X(span / 2) + 4, Y(-st.V));
    g.font = '11px Arial, sans-serif';
    // Barrier bracket.
    g.strokeStyle = k.ink2; g.lineWidth = 1;
    const bx = X(-J.xp) - 14;
    g.beginPath(); g.moveTo(bx, Y(EcP)); g.lineTo(bx, Y(EcP - J.Vj)); g.stroke();
    g.fillStyle = k.ink2; g.textAlign = 'right'; fillRich(g, 'barrier ' + J.Vj.toFixed(2) + ' eV', bx - 3, (Y(EcP) + Y(EcP - J.Vj)) / 2);
    out({ vbi: J.Vbi.toFixed(3) + ' V', w: (J.W / PH.NM).toFixed(1) + ' nm', xn: (J.xn / PH.NM).toFixed(1) + ' / ' + (J.xp / PH.NM).toFixed(1) + ' nm', e: sci(J.Emax / 1e6 * 1e6, 2) + ' V/cm', j: (J.J >= 0 ? '' : '−') + sci(Math.abs(J.J), 1) + ' A/cm²' });
  }
  return { draw };
};

// ---- MOS band alignment: separate materials, in contact, flat band -----------
REG.mosalign = (host, ctx) => {
  const st = { view: 'contact', gate: 'npoly', N: 1e17 };
  const c = canvas(host, 260);
  chips(host, [['apart', 'Apart'], ['contact', 'Joined (V_G = 0)'], ['fb', 'At flat band']], st.view, (v) => { st.view = v; draw(); });
  const row = grid(host);
  select(row, { label: 'Gate', value: st.gate, options: Object.keys(PH.GATES).map((g) => [g, PH.GATES[g].name + ' (' + PH.GATES[g].wf.toFixed(2) + ' eV)']), onChange: (v) => { st.gate = v; draw(); } });
  slider(row, { label: 'Body doping (p-type)', min: 1e15, max: 1e19, log: true, value: st.N, fmt: dopeFmt, onInput: (v) => { st.N = v; draw(); } });
  const out = readouts(host, [['phim', 'Gate work function Φ_M'], ['phis', 'Silicon work function Φ_S'], ['vfb', 'Flat-band voltage Φ_M − Φ_S'], ['psi', 'Band bending at V_G = 0']]);
  function draw() {
    const wf = PH.GATES[st.gate].wf;
    const cap = PH.mosCap({ body: 'p', N: st.N, gateWF: wf, stack: [{ mat: 'sio2', t: 5 }] });
    out({ phim: wf.toFixed(2) + ' eV', phis: cap.phiS.toFixed(2) + ' eV', vfb: cap.Vfb.toFixed(2) + ' V', psi: cap.solve(0).psiS.toFixed(2) + ' V (' + cap.solve(0).regime + ')' });
    if (st.view !== 'apart') {
      const B = cap.bands(st.view === 'fb' ? cap.Vfb : 0, 140);
      drawMOSBands(c, B, { vacuum: true, eRange: [-1.6, 5.4], depth: 140 });
      return;
    }
    const r = ctx2d(c); if (!r) return;
    const { g, w, h } = r; const k = ink();
    const top = 4.8, bot = -6.2;   // energies measured from vacuum: 0 at top
    const Y = (E) => 16 + (top - E) / (top - bot) * (h - 40);
    const vac = 4.5;               // draw vacuum at this energy
    const cols = [[30, w * 0.27, 'Gate'], [w * 0.36, w * 0.56, 'SiO₂'], [w * 0.65, w - 40, 'p-type silicon']];
    g.strokeStyle = k.ink3; g.setLineDash([2, 3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(20, Y(vac)); g.lineTo(w - 20, Y(vac)); g.stroke(); g.setLineDash([]);
    g.fillStyle = k.ink3; g.textAlign = 'left'; fillRich(g, 'vacuum level', 22, Y(vac) - 9);
    const lab = (t, x, y, color, align = 'left') => { g.fillStyle = color || k.text; g.textAlign = align; fillRich(g, t, x, y); };
    const bracket = (x, e1, e2, t) => {
      g.strokeStyle = k.ink2; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, Y(e1)); g.lineTo(x, Y(e2)); g.stroke();
      for (const e of [e1, e2]) { g.beginPath(); g.moveTo(x - 3, Y(e)); g.lineTo(x + 3, Y(e)); g.stroke(); }
      lab(t, x + 5, (Y(e1) + Y(e2)) / 2, k.ink2);
    };
    // Gate metal: Fermi level at vac - wf, filled below.
    const [a0, a1] = cols[0];
    g.fillStyle = k.track; g.fillRect(a0, Y(vac - wf), a1 - a0, Y(bot) - Y(vac - wf));
    g.strokeStyle = k.link; g.lineWidth = 2.5; g.beginPath(); g.moveTo(a0, Y(vac - wf)); g.lineTo(a1, Y(vac - wf)); g.stroke();
    lab('E_F', a0 + 4, Y(vac - wf) - 9, k.link);
    bracket(a1 - 30, vac, vac - wf, 'Φ_M ' + wf.toFixed(2));
    // Oxide.
    const ox = PH.DIELECTRICS.sio2;
    const chiOx = PH.CHI_SI - ox.cbo;
    const [b0, b1] = cols[1];
    g.fillStyle = k.ox; g.globalAlpha = 0.35; g.fillRect(b0, Y(vac - chiOx), b1 - b0, Y(vac - chiOx - ox.eg) - Y(vac - chiOx)); g.globalAlpha = 1;
    g.strokeStyle = k.text; g.lineWidth = 2;
    for (const E of [vac - chiOx, vac - chiOx - ox.eg]) { g.beginPath(); g.moveTo(b0, Y(E)); g.lineTo(b1, Y(E)); g.stroke(); }
    lab('gap ' + ox.eg.toFixed(1) + ' eV', (b0 + b1) / 2, (Y(vac - chiOx) + Y(vac - chiOx - ox.eg)) / 2, k.ink2, 'center');
    // Silicon.
    const [s0, s1] = cols[2];
    const eg = cap.eg;
    const Ec = vac - PH.CHI_SI, Ev = Ec - eg, EF = vac - cap.phiS;
    g.strokeStyle = k.text; g.lineWidth = 2;
    for (const E of [Ec, Ev]) { g.beginPath(); g.moveTo(s0, Y(E)); g.lineTo(s1, Y(E)); g.stroke(); }
    g.strokeStyle = k.link; g.setLineDash([6, 3]); g.beginPath(); g.moveTo(s0, Y(EF)); g.lineTo(s1, Y(EF)); g.stroke(); g.setLineDash([]);
    lab('E_c', s1 + 3, Y(Ec)); lab('E_v', s1 + 3, Y(Ev)); lab('E_F', s1 + 3, Y(EF), k.link);
    bracket(s0 + 18, vac, Ec, 'χ 4.05');
    bracket(s1 - 60, vac, EF, 'Φ_S ' + cap.phiS.toFixed(2));
    g.font = 'bold 11px Arial, sans-serif';
    for (const [x0, x1, t] of cols) lab(t, (x0 + x1) / 2, h - 10, k.ink2, 'center');
    g.font = '11px Arial, sans-serif';
  }
  return { draw };
};

// ---- MOS capacitor under bias: the centrepiece -------------------------------
REG.mosbias = (host, ctx) => {
  const c = canvas(host, 270);
  const pres = el('div', { class: 'xp-controls' });
  host.appendChild(pres);
  const sl = slider(host, { label: 'Gate voltage V_G', min: -2, max: 2, step: 0.01, value: ctx.S.device.vg, fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + ' V', onInput: (v) => ctx.setBias(v, null, { fromWidget: true }) });
  const out = readouts(host, [['reg', 'Regime'], ['psi', 'Surface potential ψ_s'], ['w', 'Depletion width'], ['qinv', 'Inversion charge'], ['vox', 'Voltage across oxide'], ['vt', 'Threshold V_T']]);
  caption(host, 'Electrons are shaded blue where they gather, holes red. The stage shows the same gate voltage, so the band bending here and the depletion region there move together.');
  const cap = () => ctx.cap;
  const presets = [['Accumulation', () => cap().Vfb - 1.0 * (ctx.S.device.type === 'n' ? 1 : -1)], ['Flat band', () => cap().Vfb], ['Depletion', () => (cap().Vfb + cap().VT) / 2], ['Inversion', () => cap().VT + 0.8 * (ctx.S.device.type === 'n' ? 1 : -1)]];
  for (const [t, f] of presets) {
    const b = el('button', { class: 'xp-chip', type: 'button' }, t);
    b.addEventListener('click', () => ctx.setBias(clamp(f(), -2, 2), null));
    pres.appendChild(b);
  }
  function draw() {
    const C = cap();
    const vg = ctx.S.device.vg;
    sl.set(vg);
    const B = C.bands(vg, Math.max(40, C.Wmax / PH.NM * 1.8));
    drawMOSBands(c, B, { depth: Math.max(40, C.Wmax / PH.NM * 1.8) });
    const s = B.state;
    out({
      reg: s.regime, psi: s.psiS.toFixed(3) + ' V', w: s.W.toFixed(1) + ' nm',
      qinv: sci(Math.abs(s.Qinv) / PH.Q, 1) + ' /cm²', vox: s.Vox.toFixed(2) + ' V', vt: C.VT.toFixed(2) + ' V',
    });
  }
  return { draw, on(type) { if (type === 'bias' || type === 'device') draw(); } };
};

// ---- Threshold voltage, piece by piece ---------------------------------------
REG.vt = (host, ctx) => {
  const st = { N: 3e17, tox: 5, gate: 'npoly', vsb: 0 };
  const c = canvas(host, 150);
  const c2 = canvas(host, 170);
  const row = grid(host);
  slider(row, { label: 'Body doping', min: 1e15, max: 1e19, log: true, value: st.N, fmt: dopeFmt, onInput: (v) => { st.N = v; draw(); } });
  slider(row, { label: 'Oxide thickness', min: 1, max: 50, step: 0.1, value: st.tox, fmt: (v) => v.toFixed(1) + ' nm', onInput: (v) => { st.tox = v; draw(); } });
  select(row, { label: 'Gate', value: st.gate, options: [['npoly', 'n⁺ poly'], ['al', 'Aluminium'], ['tin', 'TiN (midgap-ish)'], ['ppoly', 'p⁺ poly']], onChange: (v) => { st.gate = v; draw(); } });
  slider(row, { label: 'Body bias V_SB', min: 0, max: 2, step: 0.01, value: 0, fmt: (v) => v.toFixed(2) + ' V', onInput: (v) => { st.vsb = v; draw(); } });
  caption(host, 'An NMOS on a p-type body. Top: the threshold as a sum of three terms. Bottom: how it moves with doping, for this oxide.');
  function vtOf(N, tox, vsb) {
    const cap = PH.mosCap({ body: 'p', N, gateWF: PH.GATES[st.gate].wf, stack: [{ mat: 'sio2', t: tox }] });
    const twoPhi = 2 * cap.phiF;
    const qd = Math.sqrt(2 * PH.Q * PH.EPS_SI * N * (twoPhi + vsb)) / cap.Cox;
    return { vfb: cap.Vfb, twoPhi, qd, vt: cap.Vfb + twoPhi + qd };
  }
  function draw() {
    const v = vtOf(st.N, st.tox, st.vsb);
    // Waterfall bar.
    const r = ctx2d(c); if (!r) return;
    const { g, w, h } = r; const k = ink();
    const lo = Math.min(0, v.vfb, v.vt) - 0.3, hi = Math.max(0, v.vfb + v.twoPhi, v.vt) + 0.3;
    const X = (x) => 20 + (x - lo) / (hi - lo) * (w - 40);
    const bars = [['Flat band V_FB', 0, v.vfb, k.c[3]], ['+ 2φ_F (surface to inversion)', v.vfb, v.vfb + v.twoPhi, k.c[0]], ['+ depletion charge / C_ox', v.vfb + v.twoPhi, v.vt, k.c[1]]];
    bars.forEach(([t, a, b, col], i) => {
      const y = 12 + i * 32;
      g.fillStyle = col; g.fillRect(Math.min(X(a), X(b)), y, Math.max(2, Math.abs(X(b) - X(a))), 18);
      g.fillStyle = k.text; g.textAlign = b >= a ? 'left' : 'right';
      fillRich(g, t + '  ' + (b - a >= 0 ? '+' : '') + (b - a).toFixed(2) + ' V', b >= a ? X(b) + 5 : X(b) - 5, y + 9);
    });
    g.strokeStyle = k.axis; g.beginPath(); g.moveTo(X(0), 4); g.lineTo(X(0), h - 18); g.stroke();
    g.fillStyle = k.ink3; g.textAlign = 'center'; fillRich(g, '0 V', X(0), h - 9);
    g.strokeStyle = k.link; g.lineWidth = 2; g.beginPath(); g.moveTo(X(v.vt), 4); g.lineTo(X(v.vt), h - 18); g.stroke();
    g.fillStyle = k.link; g.font = 'bold 11px Arial, sans-serif'; fillRich(g, 'V_T = ' + v.vt.toFixed(2) + ' V', X(v.vt), h - 9); g.font = '11px Arial, sans-serif';
    // V_T versus doping.
    const pts = [], pts0 = [];
    for (let e = 14.5; e <= 19.01; e += 0.05) { const N = Math.pow(10, e); pts.push([N, vtOf(N, st.tox, st.vsb).vt]); pts0.push([N, vtOf(N, st.tox, 0).vt]); }
    const ys = pts.map((p) => p[1]);
    plot(c2, {
      x: { min: 3e14, max: 1e19, log: true, label: 'Body doping (cm⁻³)' },
      y: { min: Math.min(-1.5, ...ys), max: Math.max(1.5, ...ys), label: 'V_T (V)' },
      series: [{ pts: pts0, color: k.ink3, width: 1.5, dash: st.vsb > 0 ? [4, 3] : [] }, { pts, color: k.link, width: 2.2 }],
      hlines: [{ y: 0, color: k.axis, dash: [] }],
      marks: [{ x: st.N, y: v.vt, color: k.link, ring: true }],
    });
  }
  return { draw };
};

// ---- I-V curves of the current device ---------------------------------------
REG.iv = (host, ctx) => {
  const c = canvas(host, 230);
  const c2 = canvas(host, 170);
  const row = grid(host);
  const sg = slider(row, { label: 'V_GS', min: 0, max: 1, step: 0.01, value: 0, fmt: (v) => v.toFixed(2) + ' V', onInput: (v) => ctx.setBias(v * sgn(), null, { fromWidget: true }) });
  const sd = slider(row, { label: 'V_DS', min: 0, max: 1, step: 0.01, value: 0, fmt: (v) => v.toFixed(2) + ' V', onInput: (v) => ctx.setBias(null, v * sgn(), { fromWidget: true }) });
  const out = readouts(host, [['id', 'Drain current'], ['reg', 'Region'], ['vdsat', 'V_D,sat'], ['vt', 'V_T (linear / saturated)']]);
  const sgn = () => (ctx.S.device.type === 'n' ? 1 : -1);
  function draw() {
    const d = ctx.dev;
    const vdd = d.p.vdd;
    const s = sgn();
    sg.input.max = sd.input.max = (vdd * 1.2).toFixed(2);
    const vg = Math.abs(ctx.S.device.vg), vd = Math.abs(ctx.S.device.vd);
    sg.set(vg); sd.set(vd);
    const k = ink();
    const steps = 5;
    const series = [];
    let imax = 0;
    const vgs = [];
    for (let i = 1; i <= steps; i++) vgs.push(vdd * i / steps);
    for (const [i, g] of vgs.entries()) {
      const pts = [];
      for (let j = 0; j <= 60; j++) { const v = vdd * 1.2 * j / 60; const I = Math.abs(d.ids(s * g, s * v)) / d.p.W; pts.push([v, I * 1e6]); imax = Math.max(imax, I * 1e6); }
      series.push({ pts, color: k.c[0], width: 1.4 + i * 0.25, label: 'V_GS = ' + g.toFixed(2), labelDy: 0 });
    }
    const cur = [];
    for (let j = 0; j <= 60; j++) { const v = vdd * 1.2 * j / 60; cur.push([v, Math.abs(d.ids(s * vg, s * v)) / d.p.W * 1e6]); }
    series.push({ pts: cur, color: k.link, width: 2.6 });
    const Inow = Math.abs(d.ids(s * vg, s * vd)) / d.p.W;
    plot(c, {
      x: { min: 0, max: vdd * 1.2, label: '|V_DS| (V)' }, y: { min: 0, max: Math.max(imax, Inow * 1e6) * 1.08 || 1, label: '|I_D| (µA/µm)' },
      series, endLabels: true, marks: [{ x: vd, y: Inow * 1e6, color: k.link, r: 5, ring: true }], margin: { r: 84 },
    });
    // Transfer curve (linear and log).
    const lin = [], sat = [];
    for (let j = 0; j <= 80; j++) { const g = -0.2 * vdd + 1.4 * vdd * j / 80; lin.push([g, Math.abs(d.ids(s * g, s * 0.05)) / d.p.W]); sat.push([g, Math.abs(d.ids(s * g, s * vdd)) / d.p.W]); }
    plot(c2, {
      x: { min: -0.2 * vdd, max: 1.2 * vdd, label: '|V_GS| (V)' }, y: { min: 1e-12, max: 1e-2, log: true, label: '|I_D| (A/µm)', maxTicks: 6 },
      series: [{ pts: lin, color: k.c[2], width: 2, label: 'V_DS = 0.05 V' }, { pts: sat, color: k.c[0], width: 2, label: 'V_DS = V_DD' }],
      endLabels: true, margin: { r: 94 },
      marks: [{ x: vg, y: Math.max(1e-12, Inow), color: k.link, r: 5, ring: true }],
    });
    const ch = d.channel(vg, vd);
    const m = d.metrics();
    out({
      id: amps(Inow) + '/µm',
      reg: vg < Math.abs(m.VTsat) ? 'Subthreshold' : ch.sat ? 'Saturation' : 'Linear (triode)',
      vdsat: vg > Math.abs(m.VTsat) ? ch.vdsat.toFixed(2) + ' V (long-channel theory: ' + (ch.Vov / d.nEff).toFixed(2) + ' V)' : '–',
      vt: Math.abs(m.VTlin).toFixed(2) + ' / ' + Math.abs(m.VTsat).toFixed(2) + ' V',
    });
  }
  return { draw, on(t) { if (t === 'bias' || t === 'device') draw(); } };
};

// ---- Subthreshold: 60 mV per decade ----------------------------------------
REG.subvt = (host, ctx) => {
  const st = { T: 300 };
  const c = canvas(host, 240);
  slider(host, { label: 'Temperature', min: 200, max: 420, step: 1, value: 300, fmt: (v) => v.toFixed(0) + ' K (' + (v - 273).toFixed(0) + ' °C)', onInput: (v) => { st.T = v; draw(); } });
  const out = readouts(host, [['ss', 'Subthreshold swing'], ['lim', 'Ideal limit at this T'], ['ioff', 'I_off (V_GS = 0)'], ['ion', 'I_on (V_GS = V_DD)'], ['ratio', 'I_on / I_off']]);
  function draw() {
    const base = PH.asType(ctx.S.device.params, 'n');
    const d = PH.device(Object.assign({}, base, { T: st.T }));
    const vdd = d.p.vdd;
    const k = ink();
    const pts = [];
    for (let j = 0; j <= 100; j++) { const g = -0.3 + (vdd + 0.3) * j / 100; pts.push([g, d.ids(g, vdd) / d.p.W]); }
    const m = d.metrics();
    const lim = PH.thermalV(st.T) * Math.LN10 * 1000;
    // A reference line at the ideal slope through the curve at V_T - 0.15.
    const v0 = m.VTsat - 0.15, i0 = d.ids(v0, vdd) / d.p.W;
    const ref = [[v0 - 0.4, i0 / Math.pow(10, 0.4 / (lim / 1000))], [v0 + 0.3, i0 * Math.pow(10, 0.3 / (lim / 1000))]];
    plot(c, {
      x: { min: -0.3, max: vdd, label: 'V_GS (V)' }, y: { min: 1e-13, max: 1e-2, log: true, label: 'I_D (A/µm)', maxTicks: 6 },
      series: [{ pts: ref, color: k.ink3, width: 1.2, dash: [5, 4], label: 'ideal ' + lim.toFixed(0) + ' mV/dec' }, { pts, color: k.link, width: 2.4 }],
      endLabels: true, margin: { r: 20 },
      marks: [{ x: 0, y: m.Ioff, color: k.c[1], label: 'I_off', ring: true }, { x: vdd, y: m.Ion, color: k.c[2], label: 'I_on', align: 'right', ring: true }],
    });
    out({ ss: m.SS.toFixed(1) + ' mV/decade', lim: lim.toFixed(1) + ' mV/decade', ioff: amps(m.Ioff) + '/µm', ion: amps(m.Ion) + '/µm', ratio: sci(m.ratio, 1) });
  }
  return { draw, on(t) { if (t === 'device') draw(); } };
};

// ---- Short-channel effects: roll-off and DIBL by architecture ----------------
REG.sce = (host, ctx) => {
  const c = canvas(host, 220);
  const c2 = canvas(host, 180);
  const st = { L: 30 };
  slider(host, { label: 'Gate length', min: 8, max: 300, log: true, value: st.L, fmt: (v) => v.toFixed(0) + ' nm', onInput: (v) => { st.L = v; draw(); } });
  const out = readouts(host, [['pl', 'Planar: V_T, DIBL, swing'], ['ff', 'FinFET'], ['ga', 'Gate-all-around']]);
  const archs = [
    ['planar', 'Planar (45 nm-style)', PH.PRESETS.hkmg45.params, 0],
    ['finfet', 'FinFET (8 nm fin)', PH.PRESETS.finfet22.params, 2],
    ['gaa', 'GAA (5 nm sheets)', PH.PRESETS.gaa2.params, 1],
  ];
  function draw() {
    const k = ink();
    const series = [];
    const res = {};
    for (const [key, name, p, ci] of archs) {
      const pts = [];
      const vdd = 0.8;
      for (let e = Math.log10(8); e <= Math.log10(400) + 1e-9; e += 0.02) {
        const L = Math.pow(10, e);
        const d = PH.device(Object.assign({}, p, { L, vdd }));
        pts.push([L, d.vtcc(vdd)]);
      }
      series.push({ pts, color: k.c[ci], width: 2.2, label: name });
      const d = PH.device(Object.assign({}, p, { L: st.L, vdd }));
      const m = d.metrics();
      res[key] = (m.VTsat >= 0 ? '' : '−') + Math.abs(m.VTsat).toFixed(2) + ' V, ' + (m.DIBL * 1000).toFixed(0) + ' mV/V, ' + (Number.isFinite(m.SS) ? m.SS.toFixed(0) : '–') + ' mV/dec';
    }
    plot(c, {
      x: { min: 8, max: 400, log: true, label: 'Gate length (nm)', ticks: [10, 20, 50, 100, 200, 400] },
      y: { min: -0.6, max: 0.5, label: 'V_T at V_DS = 0.8 V' },
      series, endLabels: false, vlines: [{ x: st.L, color: k.link, label: st.L.toFixed(0) + ' nm', dash: [] }],
      hlines: [{ y: 0, color: k.axis, dash: [] }],
    });
    // DIBL picture for the planar device at this length.
    const p = Object.assign({}, archs[0][2], { L: st.L, vdd: 0.8 });
    const d = PH.device(p);
    const lo = [], hi = [];
    for (let j = 0; j <= 80; j++) { const g = -0.5 + 1.3 * j / 80; lo.push([g, d.ids(g, 0.05) / d.p.W]); hi.push([g, d.ids(g, 0.8) / d.p.W]); }
    plot(c2, {
      x: { min: -0.5, max: 0.8, label: 'V_GS (V), planar device' }, y: { min: 1e-12, max: 1e-2, log: true, label: 'I_D (A/µm)', maxTicks: 6 },
      series: [{ pts: lo, color: k.c[2], width: 2, label: 'V_DS = 0.05 V' }, { pts: hi, color: k.c[0], width: 2, label: 'V_DS = 0.8 V' }],
      endLabels: true, margin: { r: 90 },
    });
    out({ pl: res.planar, ff: res.finfet, ga: res.gaa });
  }
  legend(host, [['--tx-c1', 'Planar, 45 nm-style'], ['--tx-c3', 'FinFET'], ['--tx-c2', 'Gate-all-around']]);
  return { draw };
};

// ---- Gate leakage: why high-k --------------------------------------------------
REG.gateleak = (host) => {
  const st = { eot: 1.2, V: 1.0 };
  const c = canvas(host, 240);
  slider(host, { label: 'Equivalent oxide thickness (EOT)', min: 0.6, max: 3, step: 0.01, value: st.eot, fmt: (v) => v.toFixed(2) + ' nm', onInput: (v) => { st.eot = v; draw(); } });
  const out = readouts(host, [['sio2', 'SiO₂ (physical = EOT)'], ['hk', 'HfO₂ on 0.5 nm SiO₂'], ['ratio', 'High-k leaks less by']]);
  const hkStack = (eot) => { const il = Math.min(0.5, eot); return [{ mat: 'sio2', t: il }, { mat: 'hfo2', t: Math.max(0, (eot - il)) * 22 / 3.9 }]; };
  function draw() {
    const k = ink();
    const a = [], b = [];
    for (let t = 0.6; t <= 3.0001; t += 0.02) {
      a.push([t, PH.gateLeakage([{ mat: 'sio2', t }], st.V)]);
      if (t >= 0.55) b.push([t, PH.gateLeakage(hkStack(t), st.V)]);
    }
    const ja = PH.gateLeakage([{ mat: 'sio2', t: st.eot }], st.V), jb = PH.gateLeakage(hkStack(st.eot), st.V);
    plot(c, {
      x: { min: 0.6, max: 3, label: 'EOT (nm)' }, y: { min: 1e-6, max: 1e4, log: true, label: 'Gate leakage at 1 V (A/cm²)', maxTicks: 6 },
      series: [{ pts: a, color: k.c[1], width: 2.4, label: 'SiO₂' }, { pts: b, color: k.c[0], width: 2.4, label: 'HfO₂ + SiO₂', labelDy: 18 }],
      hlines: [{ y: 1, color: k.ink3, label: '~1 A/cm²: a rough limit for logic' }],
      vlines: [{ x: st.eot, color: k.link, dash: [] }],
      marks: [{ x: st.eot, y: ja, color: k.c[1], ring: true }, { x: st.eot, y: jb, color: k.c[0], ring: true }], endLabels: true, margin: { r: 70 },
    });
    const hs = hkStack(st.eot);
    out({ sio2: st.eot.toFixed(2) + ' nm thick, ' + sci(ja, 1) + ' A/cm²', hk: (hs[0].t + hs[1].t).toFixed(2) + ' nm thick, ' + sci(jb, 1) + ' A/cm²', ratio: sci(ja / jb, 1) + '×' });
  }
  return { draw };
};

// ---- CMOS inverter ---------------------------------------------------------------
REG.inverter = (host, ctx) => {
  const st = { vin: 0.5, ratio: 2 };
  const c = canvas(host, 230);
  const row = grid(host);
  const sIn = slider(row, { label: 'Input voltage', min: 0, max: 1, step: 0.005, value: 0.5, fmt: (v) => v.toFixed(2) + ' V', onInput: (v) => { st.vin = v; draw(); } });
  slider(row, { label: 'PMOS width / NMOS width', min: 0.5, max: 4, step: 0.05, value: st.ratio, fmt: (v) => v.toFixed(2) + '×', onInput: (v) => { st.ratio = v; draw(); } });
  const out = readouts(host, [['vout', 'Output'], ['i', 'Current from supply'], ['vm', 'Switching point'], ['p', 'Static power, input high or low']]);
  function solve(n, p, vdd, vin) {
    // Find vout where NMOS pull-down equals PMOS pull-up.
    let lo = 0, hi = vdd;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      const In = n.ids(vin, m), Ip = -p.ids(vin - vdd, m - vdd);
      if (In > Ip) hi = m; else lo = m;
    }
    const v = (lo + hi) / 2;
    return { vout: v, I: n.ids(vin, v) };
  }
  function draw() {
    const prm = ctx.S.device.params;
    const n = PH.device(PH.asType(prm, 'n'));
    const p = PH.device(Object.assign(PH.asType(prm, 'p'), { W: st.ratio }));
    const vdd = n.p.vdd;
    sIn.input.max = vdd; if (st.vin > vdd) st.vin = vdd; sIn.set(st.vin);
    const k = ink();
    const vtc = [], cur = [];
    let vm = 0, imax = 0;
    for (let j = 0; j <= 120; j++) {
      const vin = vdd * j / 120;
      const s = solve(n, p, vdd, vin);
      vtc.push([vin, s.vout]); cur.push([vin, s.I]); imax = Math.max(imax, s.I);
      if (j > 0 && vtc[j - 1][1] >= vtc[j - 1][0] && s.vout < vin) vm = vin;
    }
    const now = solve(n, p, vdd, st.vin);
    const r = plot(c, {
      x: { min: 0, max: vdd, label: 'Input (V)' }, y: { min: 0, max: vdd, label: 'Output (V)' },
      series: [{ pts: cur.map(([x, y]) => [x, y / imax * vdd * 0.55]), color: k.c[1], width: 1.5, fill: true }, { pts: vtc, color: k.link, width: 2.6 }],
      marks: [{ x: st.vin, y: now.vout, color: k.link, r: 5, ring: true }],
      vlines: [{ x: vm, color: k.ink3, label: 'switching point' }],
    });
    if (r) { r.g.fillStyle = k.c[1]; r.g.textAlign = 'right'; fillRich(r.g, 'supply current', r.X.map(vm) - 8, r.Y.map(vdd * 0.62)); }
    const leak = (n.ids(0, vdd) + Math.abs(p.ids(0, -vdd))) / 2;
    out({ vout: now.vout.toFixed(3) + ' V', i: amps(now.I), vm: vm.toFixed(2) + ' V', p: sci(leak * vdd * 1e9, 1) + ' nW (just leakage)' });
  }
  return { draw, on(t) { if (t === 'device') draw(); } };
};

/* ============================================================================
 * MEASUREMENT WIDGETS
 * ========================================================================= */

// ---- C-V ---------------------------------------------------------------------
REG.cv = (host, ctx) => {
  const st = { tox: 5, N: 5e16, qf: 0, gate: 'npoly' };
  const c = canvas(host, 240);
  const row = grid(host);
  slider(row, { label: 'Oxide thickness', min: 1.5, max: 30, step: 0.1, value: st.tox, fmt: (v) => v.toFixed(1) + ' nm', onInput: (v) => { st.tox = v; draw(); } });
  slider(row, { label: 'Body doping (p-type)', min: 1e15, max: 1e18, log: true, value: st.N, fmt: dopeFmt, onInput: (v) => { st.N = v; draw(); } });
  slider(row, { label: 'Fixed oxide charge', min: -5e11, max: 5e11, step: 1e10, value: 0, fmt: (v) => sci(v, 1) + ' q/cm²', onInput: (v) => { st.qf = v; draw(); } });
  select(row, { label: 'Gate', value: st.gate, options: [['npoly', 'n⁺ poly'], ['al', 'Aluminium'], ['ppoly', 'p⁺ poly']], onChange: (v) => { st.gate = v; draw(); } });
  const out = readouts(host, [['cox', 'C_max = C_ox → oxide'], ['cmin', 'C_min (high frequency) → doping'], ['vfb', 'Flat-band voltage'], ['dvfb', 'Shift from oxide charge']]);
  function draw() {
    const cap = PH.mosCap({ body: 'p', N: st.N, gateWF: PH.GATES[st.gate].wf, stack: [{ mat: 'sio2', t: st.tox }], Qf: st.qf });
    const k = ink();
    const lf = [], hf = [];
    let cmin = Infinity;
    for (let j = 0; j <= 160; j++) {
      const v = -4 + 8 * j / 160;
      const C = cap.capacitance(v);
      lf.push([v, C.LF / cap.Cox]); hf.push([v, C.HF / cap.Cox]);
      cmin = Math.min(cmin, C.HF);
    }
    plot(c, {
      x: { min: -4, max: 4, label: 'Gate voltage (V)' }, y: { min: 0, max: 1.05, label: 'C / C_ox' },
      series: [{ pts: lf, color: k.c[2], width: 2, label: 'low frequency', labelDy: -4 }, { pts: hf, color: k.link, width: 2.4, label: 'high frequency (1 MHz)', labelDy: 22 }],
      vlines: [{ x: cap.Vfb, color: k.ink3, label: 'V_FB' }, { x: cap.VT, color: k.ink3, label: 'V_T', dy: 14 }],
      endLabels: true, margin: { r: 20 },
    });
    // Extraction: thickness from Cmax, doping from Cmin (iterate W = sqrt(4 eps phiF / qN)).
    const tEx = PH.EPS_OX / cap.Cox / PH.NM;
    const Cd = 1 / (1 / cmin - 1 / cap.Cox);
    const Wm = PH.EPS_SI / Cd;
    let Nex = 1e16;
    for (let i = 0; i < 30; i++) Nex = 4 * PH.EPS_SI * PH.thermalV(300) * Math.log(Nex / PH.ni(300)) / (PH.Q * Wm * Wm);
    out({ cox: sci(cap.Cox * 1e6, 3) + ' µF/cm² → ' + tEx.toFixed(2) + ' nm', cmin: (cmin / cap.Cox).toFixed(3) + ' C_ox → ' + sci(Nex, 2) + ' cm⁻³', vfb: cap.Vfb.toFixed(2) + ' V', dvfb: (-st.qf * PH.Q / cap.Cox).toFixed(3) + ' V' });
  }
  return { draw };
};

// ---- Four-point probe with a 49-site wafer map --------------------------------
REG.fourpoint = (host) => {
  const st = { sp: 'As', keV: 25, dose: 3e15, T: 1050, radial: 2, edge: 3, seed: 1, pick: null };
  const top = grid(host, 'tx-grid2 tx-grid-tight');
  const cProbe = canvas(top, 170);
  const cMap = canvas(top, 170);
  const row = grid(host);
  select(row, { label: 'Implant', value: st.sp, options: [['As', 'Arsenic (n⁺)'], ['P', 'Phosphorus (n⁺)'], ['B', 'Boron (p⁺)'], ['BF2', 'BF₂ (p⁺)']], onChange: (v) => { st.sp = v; draw(); } });
  slider(row, { label: 'Dose', min: 1e13, max: 1e16, log: true, value: st.dose, fmt: (v) => sci(v, 1) + ' cm⁻²', onInput: (v) => { st.dose = v; draw(); } });
  slider(row, { label: 'Energy', min: 2, max: 100, step: 1, value: st.keV, fmt: (v) => v.toFixed(0) + ' keV', onInput: (v) => { st.keV = v; draw(); } });
  slider(row, { label: 'Anneal (1 s spike)', min: 800, max: 1150, step: 5, value: st.T, fmt: (v) => v.toFixed(0) + ' °C', onInput: (v) => { st.T = v; draw(); } });
  slider(row, { label: 'Dose non-uniformity (centre to edge)', min: 0, max: 8, step: 0.1, value: st.radial, fmt: (v) => v.toFixed(1) + '%', onInput: (v) => { st.radial = v; draw(); } });
  slider(row, { label: 'Lamp non-uniformity (edge cooler)', min: 0, max: 15, step: 0.5, value: st.edge, fmt: (v) => v.toFixed(1) + ' °C', onInput: (v) => { st.edge = v; draw(); } });
  const out = readouts(host, [['vi', 'Measured at the selected site'], ['rs', 'R_s = 4.532 · V / I'], ['mean', '49-site mean'], ['sig', 'Uniformity (1σ)'], ['xj', 'Junction depth']]);
  caption(host, 'Click a site on the map to probe it. The outer probes push 1 mA through the layer; the inner pair measures the voltage drop, with no current through their own contacts, so contact resistance drops out.');
  // 49 sites: centre, then rings of 8, 16, 24 (a common pattern).
  const sites = [[0, 0]];
  for (const [n, rr] of [[8, 0.33], [16, 0.66], [24, 0.94]]) for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n + (n === 16 ? Math.PI / 16 : 0); sites.push([rr * Math.cos(a), rr * Math.sin(a)]); }
  let rng = (s) => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  function rsAt(x, y, noise) {
    const r2 = x * x + y * y;
    const dose = st.dose * (1 + st.radial / 100 * (r2 - 0.5) + noise * 0.004);
    const T = st.T - st.edge * Math.pow(r2, 2);
    return PH.implantProfile({ species: st.sp, keV: st.keV, dose, background: st.sp === 'B' || st.sp === 'BF2' ? 1e17 : 3e17, anneal_C: T, anneal_s: 1 });
  }
  cMap.addEventListener('click', (e) => {
    const rect = cMap.getBoundingClientRect();
    const R = Math.min(rect.width, rect.height) / 2 - 12;
    const cx = rect.width / 2, cy = rect.height / 2;
    const x = (e.clientX - rect.left - cx) / R, y = -(e.clientY - rect.top - cy) / R;
    let best = 0, bd = Infinity;
    sites.forEach(([sx, sy], i) => { const d = (sx - x) ** 2 + (sy - y) ** 2; if (d < bd) { bd = d; best = i; } });
    st.pick = best; draw();
  });
  function draw() {
    const k = ink();
    const R0 = rng(7 + st.seed);
    const vals = sites.map(([x, y]) => rsAt(x, y, (R0() - 0.5) * 2).Rs);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1));
    const pick = st.pick == null ? 0 : st.pick;
    const prof = rsAt(sites[pick][0], sites[pick][1], 0);
    const I = 1e-3, V = vals[pick] * I / PH.FPP_K;
    // Map.
    let r = ctx2d(cMap);
    if (r) {
      const { g, w, h } = r;
      const R = Math.min(w, h) / 2 - 12, cx = w / 2, cy = h / 2;
      g.fillStyle = k.track; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = k.bg; g.beginPath(); g.arc(cx, cy + R, 4, 0, Math.PI * 2); g.fill();   // notch
      const lo = Math.min(...vals), hi = Math.max(...vals);
      sites.forEach(([x, y], i) => {
        const t = hi > lo ? (vals[i] - lo) / (hi - lo) : 0.5;
        g.fillStyle = t > 0.5 ? k.c[1] : k.c[0];
        g.globalAlpha = 0.25 + 0.75 * Math.abs(t - 0.5) * 2;
        g.beginPath(); g.arc(cx + x * R, cy - y * R, i === pick ? 7 : 5.5, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        if (i === pick) { g.strokeStyle = k.text; g.lineWidth = 2; g.stroke(); }
      });
      g.fillStyle = k.ink2; g.textAlign = 'left'; fillRich(g, 'low', 4, h - 8); g.textAlign = 'right'; fillRich(g, 'high R_s', w - 4, h - 8);
    }
    // Probe sketch: four needles, current in and out, voltage in the middle.
    r = ctx2d(cProbe);
    if (r) {
      const { g, w, h } = r;
      const y0 = h * 0.62;
      g.fillStyle = k.si; g.fillRect(10, y0, w - 20, h - y0 - 10);
      g.fillStyle = st.sp === 'B' || st.sp === 'BF2' ? cssVar('--tx-pp') : cssVar('--tx-np');
      g.globalAlpha = 0.85; g.fillRect(10, y0, w - 20, 12); g.globalAlpha = 1;
      const xs = [0.2, 0.4, 0.6, 0.8].map((f) => 10 + f * (w - 20));
      g.strokeStyle = k.text; g.lineWidth = 2;
      xs.forEach((x) => { g.beginPath(); g.moveTo(x, 18); g.lineTo(x, y0 - 2); g.stroke(); g.beginPath(); g.moveTo(x - 3, y0 - 8); g.lineTo(x, y0); g.lineTo(x + 3, y0 - 8); g.stroke(); });
      g.strokeStyle = k.c[1]; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(xs[0], 18); g.lineTo(xs[0], 8); g.lineTo(xs[3], 8); g.lineTo(xs[3], 18); g.stroke();
      g.fillStyle = k.c[1]; g.textAlign = 'center'; fillRich(g, 'I = 1 mA', (xs[0] + xs[3]) / 2, 16);
      g.strokeStyle = k.c[0];
      g.beginPath(); g.moveTo(xs[1], 34); g.lineTo(xs[2], 34); g.stroke();
      g.fillStyle = k.c[0]; fillRich(g, 'V = ' + (V * 1000).toFixed(2) + ' mV', (xs[1] + xs[2]) / 2, 42);
      g.fillStyle = k.ink3; fillRich(g, 's ≈ 1 mm', (xs[0] + xs[1]) / 2, y0 - 14);
      g.fillStyle = k.ink2; fillRich(g, 'implanted layer', w / 2, y0 + 22);
    }
    out({
      vi: 'I = 1.000 mA, V = ' + (V * 1000).toFixed(3) + ' mV',
      rs: vals[pick].toFixed(1) + ' Ω/□',
      mean: mean.toFixed(1) + ' Ω/□',
      sig: (sd / mean * 100).toFixed(2) + '%',
      xj: prof.xj ? prof.xj.toFixed(0) + ' nm' : '–',
    });
  }
  return { draw };
};

// ---- Parametric extraction from an I_D-V_G sweep ------------------------------
REG.extract = (host, ctx) => {
  const c = canvas(host, 230);
  const out = readouts(host, [['vtx', 'V_T by linear extrapolation'], ['vtc', 'V_T by constant current (100 nA × W/L)'], ['gm', 'Peak transconductance g_m'], ['ss', 'Subthreshold swing'], ['dibl', 'DIBL']]);
  caption(host, 'At V_DS = 50 mV. The straight dashed line is the tangent at peak g_m; where it meets zero current is the extrapolated threshold, minus V_DS/2.');
  function draw() {
    const d = PH.device(PH.asType(ctx.S.device.params, 'n'));
    const vdd = d.p.vdd, vds = 0.05;
    const k = ink();
    const pts = [], gm = [];
    let best = { gm: 0, v: 0, I: 0 };
    const dv = vdd / 200;
    for (let j = 0; j <= 240; j++) {
      const v = -0.2 * vdd + vdd * 1.4 * j / 240;
      const I = d.ids(v, vds) / d.p.W * 1e6;
      const g1 = (d.ids(v + dv, vds) - d.ids(v - dv, vds)) / (2 * dv) / d.p.W * 1e6;
      pts.push([v, I]); gm.push([v, g1]);
      if (g1 > best.gm) best = { gm: g1, v, I };
    }
    const vtx = best.v - best.I / best.gm;
    const imax = Math.max(...pts.map((p) => p[1]));
    const gmax = best.gm;
    const m = d.metrics();
    plot(c, {
      x: { min: -0.2 * vdd, max: 1.2 * vdd, label: 'V_GS (V)' }, y: { min: 0, max: imax * 1.1, label: 'I_D (µA/µm), V_DS = 50 mV' },
      series: [
        { pts: gm.map(([x, y]) => [x, y / gmax * imax * 0.9]), color: k.c[1], width: 1.5, dash: [3, 3], label: 'g_m (scaled)', labelDy: -4 },
        { pts: [[vtx, 0], [1.2 * vdd, best.I + best.gm * (1.2 * vdd - best.v)]], color: k.ink3, width: 1.2, dash: [6, 4] },
        { pts, color: k.link, width: 2.4, label: 'I_D', labelDy: 16 },
      ],
      marks: [{ x: vtx, y: 0, color: k.text, r: 4, label: 'V_T,ext', dy: -12 }, { x: m.VTlin, y: d.ids(m.VTlin, vds) / d.p.W * 1e6, color: k.c[2], r: 4, label: 'V_T,cc', dy: -14 }],
      endLabels: true, margin: { r: 76 },
    });
    out({ vtx: (vtx - vds / 2).toFixed(3) + ' V', vtc: m.VTlin.toFixed(3) + ' V', gm: gmax.toFixed(0) + ' µS/µm at V_DS = 50 mV', ss: m.SS.toFixed(1) + ' mV/dec', dibl: (m.DIBL * 1000).toFixed(0) + ' mV/V' });
  }
  return { draw, on(t) { if (t === 'device') draw(); } };
};

// ---- Transfer length method --------------------------------------------------------
REG.tlm = (host) => {
  const st = { rsh: 80, rhoc: 2e-8, W: 10 };
  const c = canvas(host, 210);
  const row = grid(host);
  slider(row, { label: 'Sheet resistance', min: 5, max: 500, log: true, value: st.rsh, fmt: (v) => v.toFixed(0) + ' Ω/□', onInput: (v) => { st.rsh = v; draw(); } });
  slider(row, { label: 'Contact resistivity ρ_c', min: 1e-9, max: 1e-6, log: true, value: st.rhoc, fmt: (v) => sci(v, 1) + ' Ω·cm²', onInput: (v) => { st.rhoc = v; draw(); } });
  const out = readouts(host, [['slope', 'Slope → R_sh / W'], ['int', 'Intercept → 2 R_c'], ['lt', 'Transfer length L_T']]);
  caption(host, 'Pads 10 µm wide and 20 µm long at growing spacings. Resistance rises linearly with spacing; the part that does not is the two contacts.');
  function draw() {
    const k = ink();
    const Wcm = st.W * 1e-4;
    const LT = Math.sqrt(st.rhoc / st.rsh);         // cm
    const Lpad = 20e-4;
    const Rc = st.rsh * LT / Wcm / Math.tanh(Lpad / LT);
    const pts = [], marks = [];
    for (let d = 0; d <= 50; d += 1) pts.push([d, st.rsh * d * 1e-4 / Wcm + 2 * Rc]);
    for (const d of [2, 5, 10, 20, 35, 50]) marks.push({ x: d, y: st.rsh * d * 1e-4 / Wcm + 2 * Rc, color: k.link, r: 4 });
    const ext = [[-2 * Rc * Wcm / st.rsh / 1e-4, 0], [0, 2 * Rc]];
    plot(c, {
      x: { min: -5, max: 52, label: 'Pad spacing (µm)' }, y: { min: 0, max: (st.rsh * 50e-4 / Wcm + 2 * Rc) * 1.1, label: 'Measured R (Ω)' },
      series: [{ pts: ext.concat(pts.slice(0, 1)), color: k.ink3, width: 1.2, dash: [5, 4] }, { pts, color: k.link, width: 2 }],
      marks: marks.concat([{ x: 0, y: 2 * Rc, color: k.c[1], r: 5, label: '2R_c', dy: -12 }]),
      vlines: [{ x: 0, color: k.axis, dash: [] }],
    });
    out({ slope: (st.rsh / st.W).toFixed(2) + ' Ω per µm', int: (2 * Rc).toFixed(2) + ' Ω', lt: (LT * 1e4).toFixed(2) + ' µm' });
  }
  return { draw };
};

/* ============================================================================
 * PROCESS WIDGETS
 * ========================================================================= */

// ---- Dopant segregation along a Czochralski ingot ------------------------------
REG.segregation = (host) => {
  const c = canvas(host, 210);
  caption(host, 'Scheil\'s equation, C = k·C₀·(1 − f)^(k − 1): a dopant that prefers the melt (k < 1) piles up in it, so the crystal grows more heavily doped toward the tail. Boron, with k ≈ 0.8, stays the most even, one reason p-type wafers are the default.');
  function draw() {
    const k = ink();
    const S = [['Boron', 0.8, k.c[0]], ['Phosphorus', 0.35, k.c[1]], ['Arsenic', 0.3, k.c[2]], ['Oxygen (from the crucible)', 1.25, k.c[3]]];
    const series = S.map(([name, kk, col]) => {
      const pts = [];
      for (let f = 0; f <= 0.951; f += 0.01) pts.push([f * 100, Math.pow(1 - f, kk - 1) / Math.pow(1 - 0, kk - 1)]);
      return { pts, color: col, width: 2.2, label: name + ' (k = ' + kk + ')' };
    });
    plot(c, {
      x: { min: 0, max: 100, label: 'Fraction of the melt crystallised (%), seed end → tail' }, y: { min: 0.3, max: 8, log: true, label: 'Doping / doping at seed', ticks: [0.5, 1, 2, 5] },
      series, endLabels: false, hlines: [{ y: 1, color: k.axis }],
    });
  }
  legend(host, [['--tx-c1', 'Boron, k = 0.8'], ['--tx-c2', 'Phosphorus, 0.35'], ['--tx-c3', 'Arsenic, 0.3'], ['--tx-c4', 'Oxygen, ≈1.25 (evaporates instead)']]);
  return { draw };
};

// ---- Czochralski growth: drive the 3D scene through its phases -----------------
REG.czphases = (host, ctx) => {
  const phases = [
    ['melt', 'Melt', 'Polysilicon chunks and a little boron melt at 1,414 °C in a quartz crucible inside a graphite susceptor, under flowing argon.'],
    ['dip', 'Dip the seed', 'A small single-crystal seed, cut along ⟨100⟩, is lowered until it just touches the melt and is held to reach thermal balance.'],
    ['neck', 'Neck', 'The seed is pulled fast to grow a neck only ~3 mm across. Dislocations from the thermal shock grow out at the surface and vanish (Dash necking, 1959).'],
    ['crown', 'Crown', 'The pull slows and the crystal widens out to the full diameter in a cone.'],
    ['body', 'Body', 'At ~0.5–1 mm per minute the body grows for a day or more. A camera watches the bright meniscus ring and adjusts pull rate and heater power to hold 300 mm.'],
    ['tail', 'Tail', 'The diameter is tapered back down so the crystal can leave the melt without the thermal shock sending dislocations back up the body.'],
  ];
  const row = el('div', { class: 'xp-controls' });
  host.appendChild(row);
  const txt = el('p', { class: 'xp-note' });
  const btns = phases.map(([id, t, d], i) => {
    const b = el('button', { class: 'xp-chip', type: 'button', 'aria-pressed': 'false' }, (i + 1) + '. ' + t);
    b.addEventListener('click', () => pick(i));
    row.appendChild(b);
    return b;
  });
  host.appendChild(txt);
  if (!ctx.scene) caption(host, '(The 3D puller needs WebGL; the steps still read in order.)');
  let idx = 0;
  function pick(i) {
    idx = i;
    btns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
    txt.textContent = phases[i][2];
    if (ctx.scene && ctx.scene.setCz) ctx.scene.setCz(phases[i][0]);
  }
  pick(4);
  return {};
};

// ---- Ion implantation: profile, junction, sheet resistance ---------------------
REG.implant = (host) => {
  const st = { sp: 'As', keV: 25, dose: 3e15, bg: 3e17, T: 1050, t: 1, annealed: true };
  const c = canvas(host, 240);
  const row = grid(host);
  select(row, { label: 'Species', value: st.sp, options: [['As', 'Arsenic, mass 75 (n)'], ['P', 'Phosphorus, mass 31 (n)'], ['B', 'Boron, mass 11 (p)'], ['BF2', 'BF₂, mass 49 (p)']], onChange: (v) => { st.sp = v; draw(); } });
  slider(row, { label: 'Energy', min: 1, max: 400, log: true, value: st.keV, fmt: (v) => v.toFixed(v < 10 ? 1 : 0) + ' keV', onInput: (v) => { st.keV = v; draw(); } });
  slider(row, { label: 'Dose', min: 1e11, max: 1e16, log: true, value: st.dose, fmt: (v) => sci(v, 1) + ' ions/cm²', onInput: (v) => { st.dose = v; draw(); } });
  slider(row, { label: 'Background doping', min: 1e15, max: 1e18, log: true, value: st.bg, fmt: dopeFmt, onInput: (v) => { st.bg = v; draw(); } });
  slider(row, { label: 'Anneal temperature', min: 900, max: 1150, step: 5, value: st.T, fmt: (v) => v.toFixed(0) + ' °C', onInput: (v) => { st.T = v; draw(); } });
  slider(row, { label: 'Anneal time', min: 1, max: 3600, log: true, value: st.t, fmt: (v) => (v < 60 ? v.toFixed(0) + ' s' : (v / 60).toFixed(0) + ' min'), onInput: (v) => { st.t = v; draw(); } });
  const out = readouts(host, [['rp', 'Projected range R_p'], ['drp', 'Straggle ΔR_p'], ['peak', 'Peak concentration'], ['xj', 'Junction depth'], ['rs', 'Sheet resistance']]);
  function draw() {
    const k = ink();
    const a = PH.implantProfile({ species: st.sp, keV: st.keV, dose: st.dose, background: st.bg, anneal_C: 0, anneal_s: 0 });
    const b = PH.implantProfile({ species: st.sp, keV: st.keV, dose: st.dose, background: st.bg, anneal_C: st.T, anneal_s: st.t, depthNm: a.depthNm * 1.6 });
    const depth = Math.max(a.depthNm, b.xj ? b.xj * 1.4 : 0, 30);
    const A = a.x.map((x, i) => [x, a.N[i]]), Bp = b.x.map((x, i) => [x, b.N[i]]);
    plot(c, {
      x: { min: 0, max: depth, label: 'Depth (nm)' }, y: { min: 1e15, max: 1e22, log: true, label: 'Concentration (cm⁻³)', maxTicks: 7 },
      series: [{ pts: A, color: k.ink3, width: 1.6, dash: [5, 4], label: 'as implanted' }, { pts: Bp, color: k.link, width: 2.4, label: 'after anneal', labelDy: 16 }],
      hlines: [{ y: st.bg, color: k.c[1], label: 'background doping' }],
      vlines: b.xj ? [{ x: b.xj, color: k.c[1], label: 'junction' }] : [],
      endLabels: true, margin: { r: 70 },
    });
    out({ rp: a.Rp.toFixed(1) + ' nm', drp: a.dRp.toFixed(1) + ' nm', peak: sci(a.peak, 1) + ' cm⁻³', xj: b.xj ? b.xj.toFixed(0) + ' nm' : 'none (below background)', rs: Number.isFinite(b.Rs) ? b.Rs.toFixed(b.Rs < 100 ? 1 : 0) + ' Ω/□' : '–' });
  }
  return { draw };
};

// ---- Deal-Grove oxidation ----------------------------------------------------------
REG.dealgrove = (host) => {
  const st = { T: 1000, amb: 'dry' };
  const c = canvas(host, 230);
  chips(host, [['dry', 'Dry O₂'], ['wet', 'Steam (wet)']], 'dry', (v) => { st.amb = v; draw(); });
  slider(host, { label: 'Temperature', min: 800, max: 1200, step: 5, value: st.T, fmt: (v) => v.toFixed(0) + ' °C', onInput: (v) => { st.T = v; draw(); } });
  const out = readouts(host, [['one', 'After 1 hour'], ['four', 'After 4 hours'], ['ba', 'Linear rate B/A'], ['b', 'Parabolic rate B']]);
  caption(host, 'Deal and Grove (1965): early on the reaction at the interface limits growth (linear); later, oxygen must diffuse through the oxide already grown (parabolic). Every grown oxide consumes silicon: about 0.44 nm of it per nm of oxide.');
  function draw() {
    const k = ink();
    const pts = [], other = [];
    for (let t = 0; t <= 5.0001; t += 0.05) {
      pts.push([t, PH.dealGrove({ ambient: st.amb, T_C: st.T, hours: t }).nm]);
      other.push([t, PH.dealGrove({ ambient: st.amb === 'dry' ? 'wet' : 'dry', T_C: st.T, hours: t }).nm]);
    }
    const ymax = Math.max(...pts.map((p) => p[1]), ...other.map((p) => p[1])) * 1.08;
    plot(c, {
      x: { min: 0, max: 5, label: 'Time (hours)' }, y: { min: 0, max: ymax, label: 'Oxide thickness (nm)' },
      series: [{ pts: other, color: k.ink3, width: 1.4, dash: [5, 4], label: st.amb === 'dry' ? 'steam' : 'dry O₂' }, { pts, color: k.link, width: 2.4, label: st.amb === 'dry' ? 'dry O₂' : 'steam' }],
      endLabels: true, margin: { r: 60 },
    });
    const r = PH.dealGrove({ ambient: st.amb, T_C: st.T, hours: 1 });
    out({ one: r.nm.toFixed(0) + ' nm', four: PH.dealGrove({ ambient: st.amb, T_C: st.T, hours: 4 }).nm.toFixed(0) + ' nm', ba: (r.BA * 1000).toFixed(1) + ' nm/h', b: sci(r.B * 1e6, 2) + ' nm²/h' });
  }
  return { draw };
};

// ---- Lithography: resolution by generation -------------------------------------
REG.litho = (host) => {
  const st = { k1: 0.3 };
  const c = canvas(host, 250);
  slider(host, { label: 'Process factor k₁ (0.25 is the single-exposure floor)', min: 0.25, max: 0.8, step: 0.01, value: st.k1, fmt: (v) => v.toFixed(2), onInput: (v) => { st.k1 = v; draw(); } });
  const out = readouts(host, [['arfi', 'ArF immersion half-pitch'], ['euv', 'EUV (NA 0.33)'], ['hna', 'High-NA EUV (NA 0.55)']]);
  caption(host, 'Smallest printable half-pitch in one exposure, R = k₁·λ / NA. Below the immersion limit, chipmakers printed in two or four passes (multiple patterning) until EUV arrived.');
  function draw() {
    const r = ctx2d(c); if (!r) return;
    const { g, w, h } = r; const k = ink();
    const L = PH.LITHO;
    const vals = L.map((l) => PH.rayleigh(l.lambda, l.na, st.k1).R);
    const max = Math.max(...vals) * 1.05;
    const m = { l: 150, r: 60, t: 6, b: 10 };
    const bh = (h - m.t - m.b) / L.length;
    L.forEach((l, i) => {
      const y = m.t + i * bh;
      const bw = (w - m.l - m.r) * vals[i] / max;
      g.fillStyle = l.id === 'euv' || l.id === 'hna' ? k.c[2] : k.c[0];
      g.fillRect(m.l, y + 4, bw, bh - 8);
      g.fillStyle = k.text; g.textAlign = 'right';
      fillRich(g, l.name, m.l - 6, y + bh / 2 - 6);
      g.fillStyle = k.ink3; fillRich(g, l.lambda + ' nm, NA ' + l.na + ', ~' + l.year, m.l - 6, y + bh / 2 + 7);
      g.textAlign = 'left'; g.fillStyle = k.text;
      fillRich(g, vals[i].toFixed(vals[i] < 20 ? 1 : 0) + ' nm', m.l + bw + 5, y + bh / 2);
    });
    const R = (id) => { const l = L.find((x) => x.id === id); const q = PH.rayleigh(l.lambda, l.na, st.k1); return q.R.toFixed(1) + ' nm (depth of focus ~' + q.DOF.toFixed(0) + ' nm)'; };
    out({ arfi: R('arfi'), euv: R('euv'), hna: R('hna') });
  }
  return { draw };
};

// ---- Wafer sort: dies, defects, yield --------------------------------------------
REG.yield = (host) => {
  const st = { area: 100, D0: 0.1, seed: 3 };
  const c = canvas(host, 260);
  const row = grid(host);
  slider(row, { label: 'Die size', min: 10, max: 800, log: true, value: st.area, fmt: (v) => v.toFixed(0) + ' mm²', onInput: (v) => { st.area = v; draw(); } });
  slider(row, { label: 'Killer defect density D₀', min: 0.01, max: 2, log: true, value: st.D0, fmt: (v) => v.toFixed(2) + ' /cm²', onInput: (v) => { st.D0 = v; draw(); } });
  const b = el('button', { class: 'xp-chip', type: 'button' }, 'Next wafer');
  b.addEventListener('click', () => { st.seed++; draw(); });
  host.appendChild(b);
  const out = readouts(host, [['dpw', 'Whole dies per 300 mm wafer'], ['good', 'Good on this wafer'], ['models', 'Model yield: Poisson / Murphy']]);
  function draw() {
    const r = ctx2d(c); if (!r) return;
    const { g, w, h } = r; const k = ink();
    const R = Math.min(w, h) / 2 - 10, cx = w / 2, cy = h / 2;
    const side = Math.sqrt(st.area);       // mm
    const s = R / 147;                     // px per mm (3 mm edge exclusion)
    g.fillStyle = k.track; g.beginPath(); g.arc(cx, cy, 150 * s, 0, Math.PI * 2); g.fill();
    let seed = st.seed * 9973;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    // Scatter defects (Poisson, slightly clustered toward the edge).
    const nDef = Math.round(st.D0 * Math.PI * 15 * 15 * (0.9 + 0.2 * rnd()));
    const defects = [];
    for (let i = 0; i < nDef; i++) { const rr = 147 * Math.pow(rnd(), 0.4); const a = rnd() * 2 * Math.PI; defects.push([rr * Math.cos(a), rr * Math.sin(a)]); }
    let tot = 0, good = 0;
    const n = Math.ceil(150 / side) + 1;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const x0 = i * side - side / 2, y0 = j * side - side / 2;
      const corners = [[x0, y0], [x0 + side, y0], [x0, y0 + side], [x0 + side, y0 + side]];
      if (corners.some(([x, y]) => x * x + y * y > 147 * 147)) continue;
      tot++;
      const hit = defects.some(([x, y]) => x >= x0 && x < x0 + side && y >= y0 && y < y0 + side);
      if (!hit) good++;
      g.fillStyle = hit ? k.bad : k.good;
      g.globalAlpha = hit ? 0.75 : 0.55;
      g.fillRect(cx + x0 * s + 0.5, cy + y0 * s + 0.5, side * s - 1, side * s - 1);
    }
    g.globalAlpha = 1;
    g.fillStyle = k.text;
    for (const [x, y] of defects) { g.beginPath(); g.arc(cx + x * s, cy + y * s, 1.6, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = k.ink2; g.textAlign = 'left';
    fillRich(g, '● defect   ■ good   ■ fails', 6, h - 8);
    const ym = PH.yieldModels(st.D0, st.area);
    out({ dpw: String(tot) + ' (formula: ' + PH.diesPerWafer(300, st.area) + ')', good: good + ' (' + (tot ? (good / tot * 100).toFixed(0) : 0) + '%)', models: (ym.poisson * 100).toFixed(0) + '% / ' + (ym.murphy * 100).toFixed(0) + '%' });
  }
  return { draw };
};

// ---- WAT: a parameter across the wafer ------------------------------------------
REG.watmap = (host, ctx) => {
  const st = { param: 'vt', seed: 5, lgSig: 3 };
  const top = grid(host, 'tx-grid2 tx-grid-tight');
  const cMap = canvas(top, 190);
  const cHist = canvas(top, 190);
  chips(host, [['vt', 'Threshold V_T,sat'], ['ion', 'Drive I_on'], ['ioff', 'Leakage I_off']], 'vt', (v) => { st.param = v; draw(); });
  slider(host, { label: 'Gate-length variation (1σ)', min: 0, max: 8, step: 0.1, value: st.lgSig, fmt: (v) => v.toFixed(1) + ' %', onInput: (v) => { st.lgSig = v; draw(); } });
  const out = readouts(host, [['mean', 'Mean'], ['sig', 'Spread (1σ)'], ['yield', 'Sites inside the spec window']]);
  caption(host, 'Seventeen scribe-line sites, each a transistor whose gate came out a little long or short: a radial bowl from etch, plus random variation. A few percent of gate length moves the leakage by tens of percent.');
  const sites = [[0, 0]];
  for (const [n, rr] of [[8, 0.5], [8, 0.9]]) for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n + (rr > 0.6 ? Math.PI / 8 : 0); sites.push([rr * Math.cos(a), rr * Math.sin(a)]); }
  function draw() {
    const base = PH.asType(ctx.S.device.params, 'n');
    let seed = st.seed * 7919;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const gauss = () => { const u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const vals = sites.map(([x, y]) => {
      const dL = st.lgSig / 100 * (0.7 * gauss() + 0.8 * (x * x + y * y - 0.4));
      const d = PH.device(Object.assign({}, base, { L: base.L * (1 + dL) }));
      const m = d.metrics();
      return st.param === 'vt' ? m.VTsat : st.param === 'ion' ? m.Ion * 1e6 : m.Ioff * 1e9;
    });
    const nominal = (() => { const m = PH.device(base).metrics(); return st.param === 'vt' ? m.VTsat : st.param === 'ion' ? m.Ion * 1e6 : m.Ioff * 1e9; })();
    const unit = st.param === 'vt' ? ' V' : st.param === 'ion' ? ' µA/µm' : ' nA/µm';
    const win = st.param === 'vt' ? [nominal - 0.03, nominal + 0.03] : [nominal * 0.9, nominal * (st.param === 'ioff' ? 2 : 1.1)];
    const k = ink();
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1));
    let r = ctx2d(cMap);
    if (r) {
      const { g, w, h } = r;
      const R = Math.min(w, h) / 2 - 10, cx = w / 2, cy = h / 2;
      g.fillStyle = k.track; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      const lo = Math.min(...vals), hi = Math.max(...vals);
      sites.forEach(([x, y], i) => {
        const inside = vals[i] >= win[0] && vals[i] <= win[1];
        g.fillStyle = inside ? k.good : k.bad;
        g.fillRect(cx + x * R - 14, cy - y * R - 9, 28, 18);
        g.fillStyle = k.bg; g.textAlign = 'center'; g.font = 'bold 10px Arial, sans-serif';
        fillRich(g, st.param === 'vt' ? vals[i].toFixed(3) : vals[i].toPrecision(3), cx + x * R, cy - y * R);
      });
      g.font = '11px Arial, sans-serif';
      void lo; void hi;
    }
    // Histogram.
    const lo = Math.min(...vals, win[0]), hi = Math.max(...vals, win[1]);
    const bins = 10, counts = new Array(bins).fill(0);
    for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - lo) / (hi - lo + 1e-12) * bins))]++;
    const pts = [];
    counts.forEach((n, i) => { const x0 = lo + (hi - lo) * i / bins, x1 = lo + (hi - lo) * (i + 1) / bins; pts.push([x0, 0], [x0, n], [x1, n], [x1, 0]); });
    plot(cHist, {
      x: { min: lo - (hi - lo) * 0.05, max: hi + (hi - lo) * 0.05, label: (st.param === 'vt' ? 'V_T,sat' : st.param === 'ion' ? 'I_on' : 'I_off') + ' (' + unit.trim() + ')', n: 3 },
      y: { min: 0, max: Math.max(...counts) + 1, label: 'Sites', n: 3 },
      series: [{ pts, color: k.link, fill: true }, { pts, color: k.link, width: 1.5 }],
      vlines: [{ x: win[0], color: k.bad, label: 'spec' }, { x: win[1], color: k.bad }],
      margin: { l: 34 },
    });
    const ok = vals.filter((v) => v >= win[0] && v <= win[1]).length;
    out({ mean: (st.param === 'vt' ? mean.toFixed(3) : mean.toPrecision(3)) + unit, sig: (st.param === 'vt' ? (sd * 1000).toFixed(1) + ' mV' : (sd / mean * 100).toFixed(1) + ' %'), yield: ok + ' of ' + vals.length });
  }
  return { draw, on(t) { if (t === 'device') draw(); } };
};

/* ============================================================================
 * SCALING WIDGETS
 * ========================================================================= */

REG.moore = (host) => {
  const c = canvas(host, 260);
  const tip = el('p', { class: 'xp-caption' }, 'Hover a point for the chip.');
  host.appendChild(tip);
  let lastPlot = null;
  function draw() {
    const k = ink();
    const pts = PH.CHIPS.map(([y, , n]) => [y, n]);
    const line = [];
    for (let y = 1971; y <= 2026; y += 1) line.push([y, 2300 * Math.pow(2, (y - 1971) / 2)]);
    lastPlot = plot(c, {
      x: { min: 1968, max: 2028, label: 'Year', ticks: [1970, 1980, 1990, 2000, 2010, 2020] }, y: { min: 1e3, max: 1e12, log: true, label: 'Transistors per chip', maxTicks: 10 },
      series: [{ pts: line, color: k.ink3, width: 1.2, dash: [5, 4], label: 'doubling every 2 years', labelDy: 30 }],
      marks: pts.map(([x, y]) => ({ x, y, color: k.link, r: 3.5 })),
      endLabels: true, margin: { r: 14 },
    });
  }
  c.addEventListener('mousemove', (e) => {
    if (!lastPlot) return;
    const r = c.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 400;
    for (const ch of PH.CHIPS) {
      const px = lastPlot.X.map(ch[0]), py = lastPlot.Y.map(ch[2]);
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bd) { bd = d; best = ch; }
    }
    tip.textContent = best ? best[0] + ' · ' + best[1] + ' · ' + sci(best[2], 2) + ' transistors · ' + best[3] : 'Hover a point for the chip.';
  });
  return { draw };
};

REG.dennard = (host) => {
  const st = { k: 2 };
  const t = el('table', { class: 'tx-table' });
  host.appendChild(t);
  slider(host, { label: 'Shrink every dimension by', min: 1, max: 10, step: 0.1, value: st.k, fmt: (v) => v.toFixed(1) + '×', onInput: (v) => { st.k = v; draw(); } });
  const c = canvas(host, 220);
  caption(host, 'Below: flagship desktop processors. Clock speed climbed with Dennard scaling and stopped around 2005, when supply voltage could not keep falling and power density hit the limit of air cooling.');
  function draw() {
    const k = st.k;
    const rows = [
      ['Length, width, oxide', '1/κ', 1 / k, '1/κ', 1 / k],
      ['Supply voltage', '1/κ', 1 / k, 'stuck', 1],
      ['Doping', 'κ', k, 'κ', k],
      ['Transistors per area', 'κ²', k * k, 'κ²', k * k],
      ['Gate delay', '1/κ', 1 / k, '≈1/κ', 1 / k],
      ['Power per transistor (at κ× the clock)', '1/κ²', 1 / (k * k), '≈1', 1],
      ['Power per area', '1', 1, 'κ²', k * k],
    ];
    t.innerHTML = '';
    const hdr = el('tr');
    for (const s of ['When every length shrinks by κ', 'Dennard (1974)', 'Since ~2005']) hdr.appendChild(el('th', {}, s));
    t.appendChild(hdr);
    const x = (v) => '×' + (v < 0.1 ? v.toFixed(3) : v.toFixed(2));
    for (const [q, a, av, b, bv] of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', {}, q));
      tr.appendChild(el('td', { class: 'xp-num' }, a + '  ' + x(av)));
      const td = el('td', { class: 'xp-num' }, b + '  ' + x(bv));
      if (q === 'Power per area' && bv > 1.01) { td.className += ' tx-bad'; td.textContent = '▲ ' + td.textContent; }
      tr.appendChild(td);
      t.appendChild(tr);
    }
    const kk = ink();
    const clk = PH.CLOCKS.map(([y, f]) => [y, f]);
    const pw = PH.CLOCKS.map(([y, , p]) => [y, p * 30]);
    plot(c, {
      x: { min: 1970, max: 2026, label: 'Year', ticks: [1970, 1980, 1990, 2000, 2010, 2020] }, y: { min: 0.5, max: 1e4, log: true, label: 'Clock (MHz)', maxTicks: 6 },
      series: [{ pts: pw, color: kk.c[1], width: 1.6, dash: [4, 3], label: 'power ×30 (W)', labelDy: 18 }, { pts: clk, color: kk.link, width: 2.4, label: 'clock (MHz)' }],
      vlines: [{ x: 2005, color: kk.ink3, label: 'Dennard ends' }],
      endLabels: true, margin: { r: 86 },
    });
  }
  return { draw };
};

REG.nodes = (host) => {
  const c = canvas(host, 260);
  const t = el('details', { class: 'tx-details' });
  t.appendChild(el('summary', {}, 'Show the table'));
  const tb = el('table', { class: 'tx-table' });
  t.appendChild(tb);
  host.appendChild(t);
  const head = el('tr');
  for (const s of ['Year', 'Node', 'Gate length', 'Gate pitch', 'Metal pitch', 'V_DD', 'New']) head.appendChild(el('th', {}, s));
  tb.appendChild(head);
  for (const n of PH.NODES) {
    const tr = el('tr');
    for (const v of [n.year, n.node, n.Lg >= 1000 ? n.Lg / 1000 + ' µm' : n.Lg + ' nm', n.cpp ? n.cpp + ' nm' : '', n.mp ? n.mp + ' nm' : '', n.vdd + ' V', n.what]) tr.appendChild(el('td', {}, String(v)));
    tb.appendChild(tr);
  }
  function draw() {
    const k = ink();
    const name = PH.NODES.map((n) => [n.year, parseFloat(n.node) * (/µm/.test(n.node) ? 1000 : 1)]).filter(([, v]) => Number.isFinite(v));
    plot(c, {
      x: { min: 1970, max: 2027, label: 'Year of volume production', ticks: [1970, 1980, 1990, 2000, 2010, 2020] }, y: { min: 1, max: 2e4, log: true, label: 'nm', maxTicks: 6 },
      series: [
        { pts: name, color: k.ink3, width: 1.6, dash: [5, 4], label: 'node name', labelDy: 22 },
        { pts: PH.NODES.map((n) => [n.year, n.Lg]), color: k.link, width: 2.4, label: 'gate length' },
        { pts: PH.NODES.filter((n) => n.cpp).map((n) => [n.year, n.cpp]), color: k.c[1], width: 2, label: 'gate pitch', labelDy: -6 },
        { pts: PH.NODES.filter((n) => n.mp).map((n) => [n.year, n.mp]), color: k.c[2], width: 2, label: 'metal pitch', labelDy: 12 },
      ],
      endLabels: true, margin: { r: 80 },
    });
  }
  return { draw };
};

// Wire delay: RC of 1 mm of minimum wire versus half-pitch.
REG.rc = (host) => {
  const c = canvas(host, 240);
  caption(host, 'RC delay of 100 µm of minimum-width wire (twice as tall as wide, about 0.2 fF/µm in SiO₂, less in low-k). Copper\'s resistivity rises in narrow lines as electrons scatter off surfaces and grain boundaries, and its barrier eats a growing share of the trench; ruthenium, with a short electron path and almost no barrier, overtakes it below about 20 nm.');
  function rho(metal, w) {
    // Bulk resistivity (µΩ·cm), electron mean free path (nm), barrier (nm).
    const M = { al: [2.7, 15, 5], cu: [1.7, 39, 3], ru: [7.1, 6.6, 0.3], co: [6.2, 11.8, 1] }[metal];
    const [r0, mfp, bar] = M;
    const core = Math.max(0.5, w - 2 * bar), hcore = Math.max(0.5, 2 * w - bar);
    const size = 1 + 0.75 * mfp * (1 / core + 1 / hcore) * 0.45 + 0.37 * mfp / core;   // rough FS + MS
    return { r: r0 * size * (w * 2 * w) / (core * hcore), bar };
  }
  function draw() {
    const k = ink();
    const L = 0.01;   // cm: 100 um
    const mk = (metal, kdiel) => {
      const pts = [];
      for (let e = Math.log10(8); e <= Math.log10(500) + 1e-9; e += 0.02) {
        const w = Math.pow(10, e);
        const R = rho(metal, w).r * 1e-6 * L / (w * 1e-7 * 2 * w * 1e-7);    // ohm
        const C = L * 2e-12 * kdiel / 3.9;                                  // F: ~0.2 fF/um in SiO2
        pts.push([w, R * C * 1e12]);
      }
      return pts;
    };
    plot(c, {
      x: { min: 8, max: 500, log: true, label: 'Half-pitch (nm)', ticks: [10, 20, 50, 100, 200, 500] }, y: { min: 0.01, max: 3e3, log: true, label: 'RC of 100 µm (ps)', maxTicks: 6 },
      series: [
        { pts: mk('al', 3.9), color: k.ink3, width: 1.8, label: 'Al in SiO₂' },
        { pts: mk('cu', 2.7), color: k.c[1], width: 2.4, label: 'Cu in low-k', labelDy: 16 },
        { pts: mk('ru', 2.7), color: k.c[2], width: 2, dash: [5, 3], label: 'Ru in low-k', labelDy: -4 },
      ],
      endLabels: false,
    });
  }
  legend(host, [['--xp-ink-3', 'Aluminium in SiO₂ (pre-1997)'], ['--tx-c2', 'Copper in low-k'], ['--tx-c3', 'Ruthenium in low-k', true]]);
  return { draw };
};

/* ============================================================================
 * THE LAB
 * ========================================================================= */

REG.lab = (host, ctx) => {
  const st = { pinned: null };
  const head = el('div', { class: 'tx-lab-head' });
  host.appendChild(head);
  const pre = select(head, { label: 'Start from', value: ctx.S.device.preset in PH.PRESETS ? ctx.S.device.preset : 'nm130', options: Object.keys(PH.PRESETS).map((k) => [k, PH.PRESETS[k].label]), onChange: (v) => { ctx.setDevice({}, { preset: v }); sync(); } });
  const note = el('p', { class: 'xp-note' });
  host.appendChild(note);
  const typeChips = chips(host, [['n', 'NMOS'], ['p', 'PMOS']], ctx.S.device.type, (v) => ctx.setDevice({ type: v }), 'Device type');
  const archChips = chips(host, [['planar', 'Planar'], ['finfet', 'FinFET'], ['gaa', 'Gate-all-around']], ctx.S.device.params.arch, (v) => {
    const ch = { arch: v };
    if (v !== 'planar' && ctx.S.device.params.N > 1e17) { ch.N = 1e16; ch.wf = 4.35; ch.gate = null; ch.tsi = v === 'gaa' ? 5 : 8; }
    if (v === 'planar' && ctx.S.device.params.N < 1e17) { ch.N = 2e18; }
    ctx.setDevice({ params: ch }); sync();
  }, 'Architecture');
  const g1 = grid(host);
  const P = () => ctx.S.device.params;
  const set = (o) => { ctx.setDevice({ params: o }); };
  const sL = slider(g1, { label: 'Gate length', min: 8, max: 2000, log: true, value: P().L, fmt: (v) => (v >= 1000 ? (v / 1000).toFixed(2) + ' µm' : v.toFixed(0) + ' nm'), onInput: (v) => set({ L: v }) });
  const sT = slider(g1, { label: 'Dielectric thickness', min: 0.6, max: 30, log: true, value: P().tdiel, fmt: (v) => v.toFixed(2) + ' nm', onInput: (v) => set({ tdiel: v }) });
  const sD = select(g1, { label: 'Dielectric', value: P().diel, options: [['sio2', 'SiO₂ (k 3.9)'], ['sion', 'SiON (k ~5)'], ['al2o3', 'Al₂O₃ (k ~9)'], ['hfo2', 'HfO₂ on SiO₂ (k ~22)'], ['zro2', 'ZrO₂ on SiO₂ (k ~25)']], onChange: (v) => set({ diel: v, il: v === 'hfo2' || v === 'zro2' || v === 'al2o3' ? 0.5 : 0 }) });
  const sN = slider(g1, { label: 'Channel doping', min: 1e15, max: 2e19, log: true, value: P().N, fmt: dopeFmt, onInput: (v) => set({ N: v }) });
  const sW = slider(g1, { label: 'Gate work function', min: 3.9, max: 5.3, step: 0.01, value: ctx.dev.wf, fmt: (v) => v.toFixed(2) + ' eV' + (Math.abs(v - 4.05) < 0.02 ? ' (n⁺ poly)' : Math.abs(v - 5.17) < 0.02 ? ' (p⁺ poly)' : ''), onInput: (v) => set({ wf: v, gate: null }) });
  const sS = slider(g1, { label: 'Fin / sheet thickness', min: 3, max: 20, step: 0.5, value: P().tsi, fmt: (v) => v.toFixed(1) + ' nm', onInput: (v) => set({ tsi: v }) });
  const sV = slider(g1, { label: 'Supply V_DD', min: 0.4, max: 5, step: 0.05, value: P().vdd, fmt: (v) => v.toFixed(2) + ' V', onInput: (v) => set({ vdd: v }) });
  const sK = slider(g1, { label: 'Temperature', min: 220, max: 420, step: 1, value: P().T, fmt: (v) => v.toFixed(0) + ' K (' + (v - 273).toFixed(0) + ' °C)', onInput: (v) => set({ T: v }) });
  const sR = slider(g1, { label: 'Source + drain resistance', min: 0, max: 2000, step: 10, value: P().rsd, fmt: (v) => v.toFixed(0) + ' Ω·µm', onInput: (v) => set({ rsd: v }) });
  const strainChip = chips(host, [['0', 'No strain'], ['1', 'Strained channel']], P().strain ? '1' : '0', (v) => set({ strain: v === '1' }), 'Strain');
  const c1 = canvas(host, 210);
  const c2 = canvas(host, 210);
  const btns = el('div', { class: 'xp-controls' });
  const pin = el('button', { class: 'xp-chip', type: 'button' }, 'Pin for comparison');
  pin.addEventListener('click', () => { st.pinned = { p: Object.assign({}, PH.asType(P(), ctx.S.device.type)), label: (PH.PRESETS[ctx.S.device.preset] || {}).label || 'pinned' }; draw(); });
  const unpin = el('button', { class: 'xp-chip', type: 'button' }, 'Clear pin');
  unpin.addEventListener('click', () => { st.pinned = null; draw(); });
  btns.appendChild(pin); btns.appendChild(unpin);
  host.appendChild(btns);
  const tbl = el('table', { class: 'tx-table tx-metrics' });
  host.appendChild(tbl);
  caption(host, 'Currents are per micrometre of gate width. The stage shows this device at the bias set by the sliders at the bottom. "Pinned" draws a second device dashed for comparison.');

  function sync() {
    const p = P();
    pre.set(ctx.S.device.preset in PH.PRESETS ? ctx.S.device.preset : pre.get());
    typeChips.set(ctx.S.device.type);
    archChips.set(p.arch);
    sL.set(p.L); sT.set(p.tdiel); sD.set(p.diel); sN.set(p.N); sS.set(p.tsi); sV.set(p.vdd); sK.set(p.T); sR.set(p.rsd);
    sW.set(ctx.dev.wf * 1 + 0);
    strainChip.set(p.strain ? '1' : '0');
    const multi = p.arch !== 'planar';
    sS.el.hidden = !multi;
    sN.el.hidden = multi;
    const ps = PH.PRESETS[ctx.S.device.preset];
    note.textContent = ps ? ps.note : 'A custom device. Pick a starting point above to reset.';
  }

  function curves(d) {
    const vdd = d.p.vdd, s = d.nType ? 1 : -1;
    const fam = [];
    for (let i = 1; i <= 4; i++) {
      const g = vdd * i / 4, pts = [];
      for (let j = 0; j <= 50; j++) { const v = vdd * j / 50; pts.push([v, Math.abs(d.ids(s * g, s * v)) / d.p.W * 1e6]); }
      fam.push(pts);
    }
    const tl = [], ts = [];
    for (let j = 0; j <= 80; j++) { const g = -0.3 * vdd + 1.3 * vdd * j / 80; tl.push([g, Math.abs(d.ids(s * g, s * 0.05)) / d.p.W]); ts.push([g, Math.abs(d.ids(s * g, s * vdd)) / d.p.W]); }
    return { fam, tl, ts };
  }

  function draw() {
    sync();
    const d = ctx.dev;
    const k = ink();
    const cv = curves(d);
    const pinned = st.pinned ? PH.device(st.pinned.p) : null;
    const pc = pinned ? curves(pinned) : null;
    const vmax = Math.max(d.p.vdd, pinned ? pinned.p.vdd : 0);
    const imax = Math.max(...cv.fam[3].map((p) => p[1]), pc ? Math.max(...pc.fam[3].map((p) => p[1])) : 0) * 1.08 || 1;
    const series = [];
    if (pc) pc.fam.forEach((pts) => series.push({ pts, color: k.ink3, width: 1.3, dash: [5, 4] }));
    cv.fam.forEach((pts, i) => series.push({ pts, color: k.link, width: 1.4 + i * 0.4, label: i === 3 ? 'V_GS = V_DD' : null }));
    plot(c1, { x: { min: 0, max: vmax, label: '|V_DS| (V)' }, y: { min: 0, max: imax, label: '|I_D| (µA/µm)' }, series, endLabels: false });
    const s2 = [];
    if (pc) { s2.push({ pts: pc.ts, color: k.ink3, width: 1.4, dash: [5, 4] }); }
    s2.push({ pts: cv.tl, color: k.c[2], width: 2, label: '|V_DS| = 0.05 V' }, { pts: cv.ts, color: k.link, width: 2.4, label: '|V_DS| = V_DD', labelDy: 14 });
    plot(c2, { x: { min: -0.3 * vmax, max: vmax, label: '|V_GS| (V)' }, y: { min: 1e-13, max: 1e-2, log: true, label: '|I_D| (A/µm)', maxTicks: 6 }, series: s2, endLabels: true, margin: { r: 92 } });
    const m = d.metrics();
    const mp = pinned ? pinned.metrics() : null;
    const rows = [
      ['Threshold, linear / saturated', (x) => fmt(Math.abs(x.VTlin), 3) + ' / ' + fmt(Math.abs(x.VTsat), 3) + ' V'],
      ['Subthreshold swing', (x) => (Number.isFinite(x.SS) ? x.SS.toFixed(0) : '–') + ' mV/dec'],
      ['DIBL', (x) => (x.DIBL * 1000).toFixed(0) + ' mV/V'],
      ['On current I_on', (x) => amps(x.Ion) + '/µm'],
      ['Off current I_off', (x) => amps(x.Ioff) + '/µm'],
      ['I_on / I_off', (x) => sci(x.ratio, 1)],
      ['Gate leakage (on)', (x) => amps(x.Ig) + '/µm'],
      ['Intrinsic delay CV/I', (x) => (x.tau * 1e12).toFixed(2) + ' ps'],
      ['EOT / electrical thickness', (x) => x.eot.toFixed(2) + ' / ' + x.cet.toFixed(2) + ' nm'],
      ['Natural length, L/λ', (x) => x.lambda.toFixed(1) + ' nm, ' + x.Lratio.toFixed(1)],
    ];
    tbl.innerHTML = '';
    const hr = el('tr');
    hr.appendChild(el('th', {}, ''));
    hr.appendChild(el('th', {}, 'This device'));
    if (mp) hr.appendChild(el('th', {}, 'Pinned: ' + st.pinned.label));
    tbl.appendChild(hr);
    for (const [name, f] of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', {}, name));
      tr.appendChild(el('td', { class: 'xp-num' }, f(m)));
      if (mp) tr.appendChild(el('td', { class: 'xp-num tx-dim' }, f(mp)));
      tbl.appendChild(tr);
    }
    // Warnings in words, not colour alone.
    const warn = [];
    if (m.Lratio < 4) warn.push('The gate is too short for this body: L is under 4 natural lengths, so the drain is controlling the channel (look at DIBL and the swing).');
    if (m.Ioff > 1e-6) warn.push('Off current above 1 µA/µm: this transistor never really turns off.');
    if (m.Ig > m.Ioff && m.Ig > 1e-9) warn.push('Gate leakage now exceeds the off current: the oxide is too thin for SiO₂.');
    let wEl = host.querySelector('.tx-warn');
    if (!wEl) { wEl = el('p', { class: 'xp-note tx-warn' }); host.insertBefore(wEl, c1); }
    wEl.hidden = !warn.length;
    wEl.textContent = warn.length ? '▲ ' + warn.join(' ') : '';
  }
  return { draw, on(t) { if (t === 'device') draw(); } };
};

TR.widgets = { mount, emit, tick, REG, plot, drawMOSBands, ink };
})(window.Transistors);
