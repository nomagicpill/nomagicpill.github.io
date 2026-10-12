/*
 * Charts and calculators for knowledge/powergrid.html.
 *
 * Each widget mounts into a <div data-widget="name"> inside a topic when the
 * topic opens and is destroyed when it closes, so only what is on screen
 * runs. Colours come from CSS tokens (the page's --pg-* technology colours and
 * explainer.css's chart tokens) and are re-read on every draw, so charts
 * follow the theme toggle without special handling. Becomes PowerGrid.widgets.
 */
(function (PG) {
'use strict';
const { cssVar } = window.Explainer;
const sim = PG.sim;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const money = (p) => (p < -0.5 ? '−$' + Math.abs(p).toFixed(0) : p >= 1000 ? '$' + Math.round(p).toLocaleString() : '$' + p.toFixed(0));

/* ----------------------------------------------------------------------------
 * Registry, events, ticking
 * ------------------------------------------------------------------------- */

const REG = {};
let active = [];

function mount(type, el, ctx) {
  const make = REG[type];
  if (!make) return null;
  el.innerHTML = '';
  const w = make(el, ctx) || {};
  active.push(w);
  if (w.draw) w.draw(ctx);
  return {
    destroy() {
      active = active.filter((x) => x !== w);
      if (w.destroy) w.destroy();
      el.innerHTML = '';
    },
  };
}

function emit(type, data) {
  for (const w of active) if (w.on) w.on(type, data);
}

let tickAcc = 0;
function tick(dt, ctx) {
  tickAcc += dt;
  for (const w of active) if (w.tick) w.tick(dt, ctx);
  if (tickAcc > 0.2) {
    tickAcc = 0;
    for (const w of active) if (w.slow) w.slow(ctx);
  }
}

/* ----------------------------------------------------------------------------
 * Drawing helpers
 * ------------------------------------------------------------------------- */

const GROUP_VAR = {
  other: '--pg-other', nuclear: '--pg-nuclear', coal: '--pg-coal', hydro: '--pg-hydro', gascc: '--pg-gascc',
  wind: '--pg-wind', solar: '--pg-solar', storage: '--pg-storage', peaker: '--pg-peaker', dr: '--pg-other',
};

function groupColor(g) {
  if (g === 'shed') return cssVar('--xp-critical-mark');
  return cssVar(GROUP_VAR[g] || '--pg-other');
}

// For DOM swatches: a var() reference follows theme changes by itself.
const groupVar = (g) => `var(${GROUP_VAR[g] || '--pg-other'})`;

function ink() {
  return {
    text: cssVar('--text'), ink2: cssVar('--xp-ink-2'), ink3: cssVar('--xp-ink-3'),
    grid: cssVar('--xp-grid'), axis: cssVar('--xp-axis'), bg: cssVar('--xp-chart-bg'),
    link: cssVar('--link'), track: cssVar('--xp-track'), critical: cssVar('--xp-critical-mark'),
    warn: cssVar('--xp-warn-mark'), good: cssVar('--xp-good-mark'), panel: cssVar('--xp-panel-solid'),
  };
}

function canvas(el, h, cls) {
  const c = document.createElement('canvas');
  c.style.height = h + 'px';
  if (cls) c.className = cls;
  el.appendChild(c);
  return c;
}

// Returns null for a canvas that isn't laid out (hidden panel, collapsed
// readouts), so callers skip drawing instead of computing negative sizes.
function ctx2d(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth;
  const h = c.clientHeight;
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

function button(label, onClick, cls = 'xp-btn') {
  const b = el('button', { class: cls, type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

function chip(label, pressed, onToggle) {
  const b = el('button', { class: 'xp-chip', type: 'button', 'aria-pressed': String(pressed) }, label);
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    onToggle(on);
  });
  return b;
}

function legend(groups) {
  const d = el('div', { class: 'xp-legend' });
  for (const g of groups) {
    const s = el('span');
    const sw = el('i', { class: 'xp-swatch' });
    sw.style.background = groupVar(g);
    s.appendChild(sw);
    s.appendChild(document.createTextNode(sim.GROUP_LABEL[g] || g));
    d.appendChild(s);
  }
  return d;
}

function tipFor(host) {
  host.style.position = 'relative';
  const t = el('div', { class: 'pg-tip', hidden: '' });
  host.appendChild(t);
  return {
    show(x, y, html) {
      t.innerHTML = html;
      t.hidden = false;
      const hw = host.clientWidth;
      t.style.left = Math.min(Math.max(0, x + 12), hw - 190) + 'px';
      t.style.top = Math.max(0, y - 10) + 'px';
    },
    hide() { t.hidden = true; },
  };
}

function field(labelText, input, out) {
  const f = el('div', { class: 'xp-field' });
  const l = el('label');
  l.appendChild(document.createTextNode(labelText));
  if (out) l.appendChild(out);
  f.appendChild(l);
  f.appendChild(input);
  return f;
}

function range(min, max, step, value) {
  const r = el('input', { type: 'range', min, max, step, value });
  return r;
}

/* ----------------------------------------------------------------------------
 * HUD pieces (drawn by main.js every ~0.12 s)
 * ------------------------------------------------------------------------- */

function drawGauge(c, hz) {
  if (!c) return;
  const _c2 = ctx2d(c);
  if (!_c2) return;
  const { g, w, h } = _c2;
  const k = ink();
  const cx = w / 2, cy = h - 6, r = Math.min(w / 2 - 6, h - 12);
  if (r <= 4) return;
  const a0 = Math.PI * 1.08, a1 = Math.PI * 1.92;
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.strokeStyle = k.track;
  g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
  // 59.5 to 60.5 Hz across the arc; ticks at 59.7, 60, 60.3
  const ang = (f) => lerp(a0, a1, clamp((f - 59.5) / 1.0, 0, 1));
  g.lineWidth = 1.5;
  g.strokeStyle = k.ink3;
  for (const f of [59.7, 60, 60.3]) {
    const a = ang(f);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (r - 9), cy + Math.sin(a) * (r - 9));
    g.lineTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4));
    g.stroke();
  }
  if (hz !== null && hz !== undefined) {
    const a = ang(hz);
    g.strokeStyle = Math.abs(hz - 60) > 0.2 ? k.critical : k.text;
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)); g.stroke();
    g.fillStyle = g.strokeStyle;
    g.beginPath(); g.arc(cx, cy, 3.5, 0, Math.PI * 2); g.fill();
  }
}

function drawTrace(c, trace, { small = false, lo, hi, marks = true } = {}) {
  if (!c) return;
  const _c2 = ctx2d(c);
  if (!_c2) return;
  const { g, w, h } = _c2;
  const k = ink();
  const pad = small ? { l: 2, r: 2, t: 4, b: 4 } : { l: 44, r: 8, t: 10, b: 22 };
  const pts = trace.filter((p) => p.f !== null);
  const t1 = trace.length ? trace[trace.length - 1].t : 0;
  const span = small ? 60 : 60;
  const t0 = t1 - span;
  let fmin = 59.85, fmax = 60.15;
  for (const p of pts) if (p.t >= t0) { fmin = Math.min(fmin, p.f - 0.03); fmax = Math.max(fmax, p.f + 0.03); }
  if (lo !== undefined) fmin = Math.min(fmin, lo);
  if (hi !== undefined) fmax = Math.max(fmax, hi);
  const X = (t) => pad.l + (t - t0) / span * (w - pad.l - pad.r);
  const Y = (f) => pad.t + (fmax - f) / (fmax - fmin) * (h - pad.t - pad.b);
  g.lineWidth = 1;
  g.strokeStyle = k.axis;
  g.beginPath(); g.moveTo(pad.l, Y(60)); g.lineTo(w - pad.r, Y(60)); g.stroke();
  if (!small) {
    g.fillStyle = k.ink3;
    g.textAlign = 'right';
    const step = fmax - fmin > 1 ? 0.5 : fmax - fmin > 0.4 ? 0.1 : 0.05;
    for (let f = Math.ceil(fmin / step) * step; f <= fmax + 1e-9; f += step) {
      g.strokeStyle = k.grid;
      g.beginPath(); g.moveTo(pad.l, Y(f)); g.lineTo(w - pad.r, Y(f)); g.stroke();
      g.fillText(f.toFixed(2), pad.l - 6, Y(f));
    }
    g.textAlign = 'center';
    for (let s = 0; s <= 60; s += 15) g.fillText(s === 60 ? 'now' : '−' + (60 - s) + ' s', X(t0 + s), h - 9);
    if (marks && fmin < 59.32) {
      g.strokeStyle = k.critical;
      g.beginPath(); g.moveTo(pad.l, Y(59.3)); g.lineTo(w - pad.r, Y(59.3)); g.stroke();
      g.fillStyle = k.ink2;
      g.textAlign = 'left';
      g.fillText('59.3 Hz: automatic load shedding starts', pad.l + 4, Y(59.3) - 8);
    }
  }
  g.strokeStyle = k.link;
  g.lineWidth = small ? 1.5 : 2;
  g.lineJoin = 'round';
  g.beginPath();
  let started = false;
  for (const p of trace) {
    if (p.t < t0) continue;
    if (p.f === null) { started = false; continue; }
    if (!started) { g.moveTo(X(p.t), Y(p.f)); started = true; } else g.lineTo(X(p.t), Y(p.f));
  }
  g.stroke();
}

// The live generation mix as one stacked bar with a 2px surface gap between
// segments, plus a legend carrying the percentages.
const mixState = new WeakMap();
function drawMix(host, res) {
  if (!host) return;
  let st = mixState.get(host);
  if (!st) {
    host.innerHTML = '';
    const bar = el('div', { class: 'pg-mixbar' });
    const lg = el('div', { class: 'xp-legend pg-mixlegend' });
    host.appendChild(bar);
    host.appendChild(lg);
    st = { bar, lg, segs: {}, items: {} };
    for (const gname of sim.GROUPS) {
      const s = el('i');
      bar.appendChild(s);
      st.segs[gname] = s;
      const item = el('span');
      const sw = el('i', { class: 'xp-swatch' });
      sw.dataset.g = gname;
      item.appendChild(sw);
      const t = el('span');
      item.appendChild(t);
      lg.appendChild(item);
      st.items[gname] = { item, t, sw };
    }
    mixState.set(host, st);
  }
  const total = res ? sim.GROUPS.reduce((s, g) => s + Math.max(0, res.byGroup[g]), 0) : 0;
  for (const gname of sim.GROUPS) {
    const v = res ? Math.max(0, res.byGroup[gname]) : 0;
    const pct = total > 0 ? v / total : 0;
    const s = st.segs[gname];
    s.style.flexGrow = String(pct);
    s.style.display = pct > 0.004 ? '' : 'none';
    s.style.background = groupVar(gname);
    s.title = `${sim.GROUP_LABEL[gname]}: ${fmt(v)} GW (${Math.round(pct * 100)}%)`;
    const it = st.items[gname];
    it.item.style.display = pct > 0.004 ? '' : 'none';
    it.sw.style.background = groupVar(gname);
    it.t.textContent = `${sim.GROUP_LABEL[gname].replace(' (gas & oil)', '').replace('Gas, combined cycle', 'Gas CC')} ${Math.round(pct * 100)}%`;
  }
}

/* ----------------------------------------------------------------------------
 * Merit order (supply stack) with a draggable demand line
 * ------------------------------------------------------------------------- */

// Price axis: linear from -50 to 200 $/MWh on the lower 78%, log above that
// up to the cap. The break is drawn so the jump isn't hidden.
function priceScale(top, bottom) {
  const split = bottom - (bottom - top) * 0.78;
  return (p) => {
    if (p <= 200) return lerp(bottom, split, (clamp(p, -50, 200) + 50) / 250);
    const f = Math.log(p / 200) / Math.log(10000 / 200);
    return lerp(split, top, clamp(f, 0, 1));
  };
}

REG.stack = (host, ctx) => {
  const c = canvas(host, 250);
  const tip = tipFor(host);
  const cap = el('p', { class: 'xp-caption' });
  host.appendChild(legend(['nuclear', 'coal', 'gascc', 'peaker', 'hydro', 'wind', 'solar', 'storage', 'other']));
  host.appendChild(cap);
  let layout = null;
  let dragging = false;

  function draw() {
    const res = ctx.res;
    if (!res) return;
    const _c2 = ctx2d(c);
    if (!_c2) return;
    const { g, w, h } = _c2;
    const k = ink();
    const pad = { l: 46, r: 10, t: 12, b: 24 };
    const blocks = res.mustRun.map((b) => Object.assign({}, b, { out: b.cap, price: -40 })).concat(res.blocks);
    const totalCap = blocks.reduce((s, b) => s + b.cap, 0);
    const xmax = Math.max(130, Math.ceil(totalCap / 10) * 10);
    const X = (gw) => pad.l + gw / xmax * (w - pad.l - pad.r);
    const Y = priceScale(pad.t, h - pad.b);
    // grid
    g.strokeStyle = k.grid;
    g.lineWidth = 1;
    g.fillStyle = k.ink3;
    g.textAlign = 'right';
    for (const p of [-50, 0, 50, 100, 150, 200, 1000, 5000]) {
      const y = Y(p);
      g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
      g.fillText(money(p), pad.l - 5, y);
    }
    g.textAlign = 'center';
    for (let x = 0; x <= xmax; x += 20) g.fillText(x + ' GW', X(x), h - 10);
    // axis break marker
    const yb = Y(200);
    g.fillStyle = k.bg;
    g.fillRect(pad.l - 4, yb - 3, 8, 6);
    g.strokeStyle = k.ink3;
    g.beginPath(); g.moveTo(pad.l - 5, yb - 1); g.lineTo(pad.l + 3, yb - 5); g.moveTo(pad.l - 5, yb + 4); g.lineTo(pad.l + 3, yb); g.stroke();

    // blocks: dispatched part solid, the rest as a pale wash; 2px gap
    // between technologies.
    let x = 0, prevG = null;
    layout = [];
    const y0 = Y(0);
    for (const b of blocks) {
      const x1 = x + b.cap;
      const gap = prevG && prevG !== b.group ? 1 : 0;
      const px0 = X(x) + gap, px1 = Math.max(px0 + 0.6, X(x1));
      const py = Y(b.price);
      const col = groupColor(b.group);
      const outW = X(x + Math.min(b.out || 0, b.cap)) - X(x);
      g.globalAlpha = 0.22;
      g.fillStyle = col;
      g.fillRect(px0, Math.min(py, y0), px1 - px0, Math.max(1, Math.abs(y0 - py)));
      g.globalAlpha = 1;
      if (outW > 0.2) g.fillRect(px0, Math.min(py, y0), Math.max(0.6, outW - gap), Math.max(1.5, Math.abs(y0 - py)));
      layout.push({ x0: px0, x1: px1, b });
      x = x1;
      prevG = b.group;
    }
    // demand and price
    const xd = X(res.need);
    g.strokeStyle = k.text;
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(xd, pad.t); g.lineTo(xd, h - pad.b); g.stroke();
    const yp = Y(res.price);
    g.strokeStyle = k.link;
    g.beginPath(); g.moveTo(pad.l, yp); g.lineTo(w - pad.r, yp); g.stroke();
    g.fillStyle = k.text;
    g.textAlign = xd > w - 120 ? 'right' : 'left';
    g.fillText(`Demand ${fmt(res.need, 0)} GW`, xd + (xd > w - 120 ? -6 : 6), pad.t + 6);
    g.textAlign = 'left';
    g.fillStyle = k.link;
    g.fillText(`Price ${money(res.price)}/MWh`, pad.l + 6, yp - 9 < pad.t + 4 ? yp + 9 : yp - 9);
    cap.textContent = `Every offer, cheapest first. The vertical line is what customers need right now (plus losses${res.need > res.load + res.loss.total + 0.05 ? ' and batteries charging' : ''}); the offer it crosses, ${res.marginal ? res.marginal.name : ''}, sets the price everyone is paid. Drag across the chart to change demand.`;
  }

  function hover(e) {
    if (!layout) return;
    const r = c.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (dragging) {
      const res = ctx.res;
      const pad = 46;
      const totalCap = res.mustRun.reduce((s, b) => s + b.cap, 0) + res.blocks.reduce((s, b) => s + b.cap, 0);
      const xmax = Math.max(130, Math.ceil(totalCap / 10) * 10);
      const gw = (x - pad) / (r.width - pad - 10) * xmax;
      const base = res.inp.load / ctx.S.knobs.demand;
      ctx.ACT.setDemand((gw - res.loss.total) / Math.max(1, base));
      return;
    }
    const hit = layout.find((L) => x >= L.x0 && x <= L.x1);
    if (!hit) { tip.hide(); return; }
    const b = hit.b;
    tip.show(x, e.clientY - r.top, `<b>${b.name}</b><br>${b.mustRun ? 'Runs regardless of price' : 'Offer ' + money(b.price) + '/MWh'}<br>${fmt(b.cap, 2)} GW available, ${fmt(b.out || 0, 2)} GW running`);
  }
  c.addEventListener('pointerdown', (e) => { dragging = true; c.setPointerCapture(e.pointerId); hover(e); });
  c.addEventListener('pointermove', hover);
  c.addEventListener('pointerup', () => { dragging = false; });
  c.addEventListener('pointerleave', () => tip.hide());
  c.style.touchAction = 'none';
  c.style.cursor = 'ew-resize';
  return { draw: () => draw(), slow: () => draw(), on: () => draw() };
};

/* ----------------------------------------------------------------------------
 * The day: stacked dispatch over 24 hours, demand and net demand, then price
 * on its own chart (never two y-axes on one plot).
 * ------------------------------------------------------------------------- */

REG.duck = (host, ctx) => {
  const c = canvas(host, 220);
  const cp = canvas(host, 92);
  const tip = tipFor(host);
  host.appendChild(legend(['other', 'nuclear', 'coal', 'hydro', 'gascc', 'wind', 'solar', 'storage', 'peaker']));
  const lines = el('div', { class: 'xp-legend' });
  lines.innerHTML = '<span><i class="pg-line"></i>Demand</span><span><i class="pg-line pg-line-alt"></i>Net demand (demand − wind − solar)</span><span><i class="xp-swatch" style="background:var(--pg-storage);opacity:.5"></i>Below zero: batteries charging</span>';
  host.appendChild(lines);
  const controls = el('div', { class: 'xp-controls' });
  controls.appendChild(chip('Storage', ctx.S.knobs.storage !== false, (on) => { ctx.S.knobs.storage = on; ctx.ACT.replan(); }));
  host.appendChild(controls);
  let geom = null;

  function draw() {
    const plan = ctx.plan;
    if (!plan) return;
    const k = ink();
    const R = plan.results;
    const n = R.length;
    {
      const _c2 = ctx2d(c);
      if (!_c2) return;
      const { g, w, h } = _c2;
      const pad = { l: 40, r: 8, t: 8, b: 20 };
      // Batteries charging are drawn below zero: that power is in the stack
      // above, which is why the stack can rise past the demand line.
      const charge = plan.storage.map((x) => Math.max(0, -x));
      const maxCharge = Math.max(...charge);
      let ymax = 0;
      for (const r of R) ymax = Math.max(ymax, r.need + 2, r.load + r.loss.total);
      ymax = Math.ceil(ymax / 20) * 20;
      const ymin = maxCharge > 0.05 ? -Math.ceil(maxCharge / 10) * 10 : 0;
      const X = (i) => pad.l + i / (n - 1) * (w - pad.l - pad.r);
      const Y = (v) => pad.t + (ymax - v) / (ymax - ymin) * (h - pad.t - pad.b);
      geom = { X, pad, w, n };
      g.strokeStyle = k.grid; g.fillStyle = k.ink3; g.lineWidth = 1; g.textAlign = 'right';
      for (let v = ymin; v <= ymax; v += (ymin < 0 && v < 0 ? -ymin : 20)) { g.beginPath(); g.moveTo(pad.l, Y(v)); g.lineTo(w - pad.r, Y(v)); g.stroke(); g.fillText(v + ' GW', pad.l - 4, Y(v)); }
      if (ymin < 0) {
        g.fillStyle = groupColor('storage');
        g.globalAlpha = 0.5;
        g.beginPath();
        g.moveTo(X(0), Y(0));
        for (let i = 0; i < n; i++) g.lineTo(X(i), Y(-charge[i]));
        g.lineTo(X(n - 1), Y(0));
        g.closePath();
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = k.axis;
        g.beginPath(); g.moveTo(pad.l, Y(0)); g.lineTo(w - pad.r, Y(0)); g.stroke();
      }
      g.textAlign = 'center';
      for (let i = 0; i < n; i += 16) g.fillText(sim.fmtClock(plan.ts[i]).replace(':00', ''), X(i), h - 8);
      // stacked areas
      const base = new Float64Array(n);
      for (const gname of sim.GROUPS) {
        const top = new Float64Array(n);
        for (let i = 0; i < n; i++) top[i] = base[i] + Math.max(0, gname === 'storage' ? R[i].byGroup.storage : R[i].byGroup[gname]);
        g.fillStyle = groupColor(gname);
        g.beginPath();
        g.moveTo(X(0), Y(top[0]));
        for (let i = 1; i < n; i++) g.lineTo(X(i), Y(top[i]));
        for (let i = n - 1; i >= 0; i--) g.lineTo(X(i), Y(base[i]));
        g.closePath();
        g.fill();
        // 2px surface gap between layers
        g.strokeStyle = k.bg; g.lineWidth = 1;
        g.beginPath(); g.moveTo(X(0), Y(top[0])); for (let i = 1; i < n; i++) g.lineTo(X(i), Y(top[i])); g.stroke();
        base.set(top);
      }
      // demand and net demand
      g.lineWidth = 2;
      g.strokeStyle = k.text;
      g.beginPath();
      R.forEach((r, i) => (i ? g.lineTo(X(i), Y(r.load + r.loss.total)) : g.moveTo(X(i), Y(r.load + r.loss.total))));
      g.stroke();
      g.strokeStyle = k.ink3;
      g.beginPath();
      R.forEach((r, i) => {
        const nl = Math.max(0, r.load + r.loss.total - plan.inps[i].wind - plan.inps[i].solar);
        return i ? g.lineTo(X(i), Y(nl)) : g.moveTo(X(i), Y(nl));
      });
      g.stroke();
      // now
      const idx = sim.planIndex(plan, ctx.hour);
      g.strokeStyle = k.link; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(X(idx), pad.t); g.lineTo(X(idx), h - pad.b); g.stroke();
    }
    {
      const _c2 = ctx2d(cp);
      if (!_c2) return;
      const { g, w, h } = _c2;
      const pad = { l: 40, r: 8, t: 8, b: 16 };
      let pmax = 60, pmin = 0;
      for (const r of R) { pmax = Math.max(pmax, Math.min(300, r.price)); pmin = Math.min(pmin, r.price); }
      pmax = Math.ceil(pmax / 50) * 50;
      pmin = Math.floor(pmin / 25) * 25;
      const X = (i) => pad.l + i / (n - 1) * (w - pad.l - pad.r);
      const Y = (p) => pad.t + (pmax - clamp(p, pmin, pmax)) / (pmax - pmin) * (h - pad.t - pad.b);
      g.strokeStyle = k.grid; g.fillStyle = k.ink3; g.lineWidth = 1; g.textAlign = 'right';
      for (const p of [pmin, 0, pmax / 2, pmax]) { g.beginPath(); g.moveTo(pad.l, Y(p)); g.lineTo(w - pad.r, Y(p)); g.stroke(); g.fillText(money(p), pad.l - 4, Y(p)); }
      g.strokeStyle = k.link; g.lineWidth = 2;
      g.beginPath();
      R.forEach((r, i) => (i ? g.lineTo(X(i), Y(r.price)) : g.moveTo(X(i), Y(r.price))));
      g.stroke();
      const capped = R.some((r) => r.price > 300);
      g.fillStyle = k.ink2; g.textAlign = 'left';
      g.fillText('Price, $/MWh' + (capped ? ' (clipped at $300; peaks reach ' + money(Math.max(...R.map((r) => r.price))) + ')' : ''), pad.l + 4, pad.t + 4);
      const idx = sim.planIndex(plan, ctx.hour);
      g.strokeStyle = k.link; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(X(idx), pad.t); g.lineTo(X(idx), h - pad.b); g.stroke();
    }
  }

  function at(e) {
    if (!geom) return null;
    const r = c.getBoundingClientRect();
    const x = e.clientX - r.left;
    const i = Math.round((x - geom.pad.l) / (geom.w - geom.pad.l - geom.pad.r) * (geom.n - 1));
    return { i: clamp(i, 0, geom.n - 1), x, y: e.clientY - r.top };
  }
  c.addEventListener('pointermove', (e) => {
    const a = at(e);
    if (!a) return;
    const plan = ctx.plan, r = plan.results[a.i];
    const rows = sim.GROUPS.filter((gname) => r.byGroup[gname] > 0.05).reverse().map((gname) => `${sim.GROUP_LABEL[gname]}: ${fmt(r.byGroup[gname])} GW`).join('<br>');
    tip.show(a.x, a.y, `<b>${sim.fmtClock(plan.ts[a.i])}</b> · ${money(r.price)}/MWh<br>${rows}${plan.storage[a.i] < -0.05 ? '<br>Storage charging: ' + fmt(-plan.storage[a.i]) + ' GW' : ''}${r.curtail > 0.05 ? '<br>Curtailed: ' + fmt(r.curtail) + ' GW' : ''}`);
  });
  c.addEventListener('pointerleave', () => tip.hide());
  c.addEventListener('click', (e) => { const a = at(e); if (a) ctx.ACT.setHour(ctx.plan.ts[a.i]); });
  c.style.cursor = 'crosshair';
  return { draw: () => draw(), slow: () => draw(), on: () => draw() };
};

/* ----------------------------------------------------------------------------
 * Frequency lab: trip a unit, add or drop load, watch the response
 * ------------------------------------------------------------------------- */

REG.freq = (host, ctx) => {
  const top = el('div', { class: 'pg-freq-top' });
  const rotor = el('canvas', { class: 'pg-rotor' });
  rotor.style.height = '120px';
  const read = el('div', { class: 'pg-readouts' });
  top.appendChild(rotor);
  top.appendChild(read);
  host.appendChild(top);
  const c = canvas(host, 190);
  const controls = el('div', { class: 'xp-controls' });
  controls.appendChild(button('Trip a 1.24 GW nuclear unit', () => ctx.ACT.trip('nuclear')));
  controls.appendChild(button('Add 3 GW of load', () => ctx.ACT.loadStep(3)));
  controls.appendChild(button('Drop 1.5 GW of data centers', () => ctx.ACT.dataCenterDrop(1.5)));
  controls.appendChild(button('Reset', () => ctx.ACT.restore()));
  controls.appendChild(chip('Batteries respond in < 0.5 s', ctx.S.knobs.ffr, (on) => ctx.ACT.setFFR(on)));
  host.appendChild(controls);
  const rows = {};
  for (const [key, label] of [['f', 'Frequency'], ['rocof', 'Rate of change'], ['nadir', 'Lowest since event'], ['E', 'Inertia (spinning energy)'], ['gov', 'Governors + AGC'], ['ffr', 'Battery response']]) {
    const d = el('div');
    d.appendChild(el('span', {}, label));
    const b = el('b');
    d.appendChild(b);
    read.appendChild(d);
    rows[key] = b;
  }
  let angle = 0;

  function draw(dt = 0) {
    const dyn = ctx.dyn;
    drawTrace(c, dyn.trace, { lo: 59.7, hi: 60.3 });
    const res = ctx.res;
    const I = sim.inertiaOf(res);
    const hz = dyn.hz;
    rows.f.textContent = hz === null ? 'no grid' : hz.toFixed(3) + ' Hz';
    rows.rocof.textContent = (dyn.rocof >= 0 ? '+' : '') + dyn.rocof.toFixed(3) + ' Hz/s';
    rows.nadir.textContent = (60 + Math.min(0, dyn.nadir)).toFixed(3) + ' Hz';
    rows.E.textContent = Math.round(I.E).toLocaleString() + ' GW·s';
    rows.gov.textContent = (dyn.g + dyn.a + dyn.e >= 0 ? '+' : '') + fmt(dyn.g + dyn.a + dyn.e, 2) + ' GW';
    rows.ffr.textContent = fmt(dyn.ffr, 2) + ' GW';
    // Rotor: mechanical torque from the turbine pushes one way, the
    // electrical (load) torque pulls the other. When they differ, the rotor
    // speeds up or slows down, and so does every synchronous machine.
    const _c2 = ctx2d(rotor);
    if (!_c2) return;
    const { g, w, h } = _c2;
    const k = ink();
    const cx = h / 2 + 6, cy = h / 2, r = h / 2 - 14;
    angle += (hz || 0) / 60 * dt * 2.2;
    g.strokeStyle = k.axis; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.fillStyle = k.track;
    g.beginPath(); g.arc(cx, cy, r - 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = k.text; g.lineWidth = 3;
    for (let i = 0; i < 2; i++) {
      const a = angle + i * Math.PI;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6)); g.stroke();
    }
    const S = Math.max(10, res.gen);
    const tm = 1 + (dyn.g + dyn.a + dyn.e + dyn.ffr) / S;
    const te = 1 + (dyn.d - dyn.ufls + 1.5 * res.load / 60 * dyn.df) / S;
    const arrow = (val, color, sign, label, yoff) => {
      const len = clamp(val, 0.8, 1.2) * 60 - 22;
      const x0 = cx + r + 12;
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 3;
      const y = cy + yoff;
      const x1 = sign > 0 ? x0 + len : x0;
      const x2 = sign > 0 ? x0 : x0 + len;
      g.beginPath(); g.moveTo(x2, y); g.lineTo(x1, y); g.stroke();
      g.beginPath();
      g.moveTo(x1 + (sign > 0 ? 6 : -6), y); g.lineTo(x1, y - 5); g.lineTo(x1, y + 5); g.closePath(); g.fill();
      g.fillStyle = k.ink2; g.textAlign = 'left';
      g.fillText(label, x0, y - 12);
    };
    arrow(tm, k.link, 1, `Turbine torque ${fmt(tm, 3)} pu`, -16);
    arrow(te, k.critical, -1, `Load (counter) torque ${fmt(te, 3)} pu`, 30);
    g.fillStyle = k.text; g.textAlign = 'center';
    g.fillText(hz === null ? '–' : Math.round(3600 * hz / 60).toLocaleString() + ' rpm', cx, h - 6);
  }
  return { tick: (dt) => draw(dt), draw: () => draw(0) };
};

/* ----------------------------------------------------------------------------
 * Synchronizing a generator: match voltage, frequency and phase, then close
 * the breaker. A synchroscope pointer turns at the slip frequency.
 * ------------------------------------------------------------------------- */

REG.sync = (host, ctx) => {
  const wrap = el('div', { class: 'pg-sync' });
  const scope = el('canvas');
  scope.style.height = '140px';
  const dial = el('canvas');
  dial.style.height = '140px';
  wrap.appendChild(dial);
  wrap.appendChild(scope);
  host.appendChild(wrap);
  const read = el('div', { class: 'pg-readouts pg-readouts-row' });
  host.appendChild(read);
  const rows = {};
  for (const [key, label] of [['slip', 'Slip (generator − grid)'], ['ang', 'Phase difference'], ['dv', 'Voltage difference']]) {
    const d = el('div');
    d.appendChild(el('span', {}, label));
    const b = el('b');
    d.appendChild(b);
    read.appendChild(d);
    rows[key] = b;
  }
  const spd = range(-0.5, 0.5, 0.001, -0.4);
  const volt = range(-8, 8, 0.1, -3);
  const spdOut = el('output'), voltOut = el('output');
  const fields = el('div', { class: 'pg-two' });
  fields.appendChild(field('Governor: speed', spd, spdOut));
  fields.appendChild(field('Exciter: voltage', volt, voltOut));
  host.appendChild(fields);
  const controls = el('div', { class: 'xp-controls' });
  const closeBtn = button('Close the breaker', () => close(), 'xp-btn xp-primary');
  controls.appendChild(closeBtn);
  controls.appendChild(button('Auto-synchronize', () => { auto = true; }));
  controls.appendChild(button('Start over', () => reset()));
  host.appendChild(controls);
  const msg = el('p', { class: 'xp-note', 'aria-live': 'polite' });
  host.appendChild(msg);

  let t = 0, phase = 2.2, auto = false, online = false, shake = 0;
  function reset() {
    online = false; auto = false; shake = 0;
    spd.value = '-0.4'; volt.value = '-3'; phase = 2.2;
    msg.textContent = 'The peaker is spinning on its own, slightly slow and low on voltage. Bring it within limits, then close the breaker just before the pointer reaches 12 o’clock.';
    ctx.ACT.peakerSync(null);
    spd.disabled = volt.disabled = false;
  }
  function close() {
    if (online) return;
    const slip = Number(spd.value);
    const ang = ((phase % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    const deg = ang * 180 / Math.PI;
    const dv = Number(volt.value);
    const okA = Math.abs(deg) <= 10, okF = Math.abs(slip) <= 0.067, okV = dv >= 0 && dv <= 5;
    if (okA && okF && okV) {
      online = true;
      spd.disabled = volt.disabled = true;
      msg.textContent = `Synchronized at ${deg.toFixed(1)}°, ${slip >= 0 ? '+' : ''}${slip.toFixed(3)} Hz slip, ${dv >= 0 ? '+' : ''}${dv.toFixed(1)}% voltage. The grid's magnetic field now holds the rotor in step; opening the throttle adds megawatts instead of speed. The third peaker unit is running in the model.`;
      ctx.ACT.peakerSync({ running: true });
    } else {
      shake = 1;
      // A rough sense of the shock: the torque pulse grows with sin(angle)
      // and can exceed the torque of a short circuit at its terminals.
      const pulse = Math.abs(Math.sin(ang / 2)) * 2 * 6 + Math.abs(slip) * 20 + Math.abs(dv) * 0.15;
      const why = [];
      if (!okA) why.push(`${Math.abs(deg).toFixed(0)}° out of phase (limit ±10°)`);
      if (!okF) why.push(`slip ${Math.abs(slip).toFixed(3)} Hz (limit 0.067)`);
      if (!okV) why.push(`voltage ${dv >= 0 ? '+' : ''}${dv.toFixed(1)}% (want 0 to +5%)`);
      msg.textContent = `Bad sync: ${why.join(', ')}. The grid yanks the rotor into step with a torque pulse of roughly ${Math.max(1.5, pulse).toFixed(1)}× rated, plus a current surge. Protection trips the breaker, and the shaft, couplings and windings may need inspection. Try again.`;
    }
  }
  reset();

  function draw(dt) {
    t += dt;
    let slip = Number(spd.value);
    if (auto && !online) {
      // Like a real auto-synchronizer: run a little fast to catch up the
      // phase, slow to a small slip approaching 12 o'clock, then close.
      const ang = ((phase % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      const target = ang > -1.2 && ang < 0 ? 0.04 : 0.22;
      slip += (target - slip) * Math.min(1, dt * 3);
      spd.value = String(slip);
      volt.value = String(Number(volt.value) + (2 - Number(volt.value)) * Math.min(1, dt * 2));
      // Close slightly early: the breaker takes ~5 cycles to make contact.
      if (slip < 0.06 && Number(volt.value) >= 0.3 && ang > -0.12 && ang < -0.02) close();
    }
    if (online) slip = 0;
    phase += slip * Math.PI * 2 * dt;
    spdOut.textContent = (60 + Number(spd.value)).toFixed(3) + ' Hz';
    voltOut.textContent = (100 + Number(volt.value)).toFixed(1) + '%';
    const ang = online ? 0 : ((phase % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    rows.slip.textContent = online ? 'locked' : (slip >= 0 ? '+' : '') + slip.toFixed(3) + ' Hz';
    rows.ang.textContent = (ang * 180 / Math.PI).toFixed(0) + '°';
    rows.dv.textContent = (Number(volt.value) >= 0 ? '+' : '') + Number(volt.value).toFixed(1) + '%';
    const k = ink();
    shake = Math.max(0, shake - dt * 1.5);
    {
      const _c2 = ctx2d(dial);
      if (!_c2) return;
      const { g, w, h } = _c2;
      const jx = shake ? Math.sin(t * 90) * 4 * shake : 0;
      const cx = Math.min(w, h) / 2 + jx, cy = h / 2, r = Math.min(w, h) / 2 - 10;
      g.strokeStyle = k.axis; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.fillStyle = k.ink3; g.textAlign = 'center';
      g.fillText('SLOW', cx - r * 0.55, cy + r * 0.45);
      g.fillText('FAST', cx + r * 0.55, cy + r * 0.45);
      // in-phase window at 12 o'clock
      g.strokeStyle = k.good; g.lineWidth = 6;
      g.beginPath(); g.arc(cx, cy, r - 3, -Math.PI / 2 - 0.175, -Math.PI / 2 + 0.175); g.stroke();
      const a = -Math.PI / 2 + ang;
      g.strokeStyle = online ? k.good : k.text; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8)); g.stroke();
      g.fillStyle = k.text;
      g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
    }
    {
      const _c2 = ctx2d(scope);
      if (!_c2) return;
      const { g, w, h } = _c2;
      const mid = h / 2, amp = h * 0.36;
      g.strokeStyle = k.grid; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
      const cycles = 2.2;
      const wave = (off, a, color) => {
        g.strokeStyle = color; g.lineWidth = 2;
        g.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const th = (x / w) * cycles * Math.PI * 2 + off;
          const y = mid - Math.sin(th) * amp * a;
          x ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      };
      wave(0, 1, k.ink3);
      wave(ang, 1 + Number(volt.value) / 100 * 3, k.link);
      g.fillStyle = k.ink2; g.textAlign = 'left';
      g.fillText('grid', 6, 10);
      g.fillStyle = k.link;
      g.fillText('generator', 40, 10);
    }
  }
  return { tick: (dt) => draw(dt), draw: () => draw(0), destroy: () => ctx.ACT.peakerSync(null) };
};

/* ----------------------------------------------------------------------------
 * Transformer calculator
 * ------------------------------------------------------------------------- */

const XF = [
  { id: 'gsu', label: 'Generator step-up', p: 1200, unit: 'MW', v1: 24, v2: 500, ph: 3, note: 'A large plant’s generator makes power at around 24 kV; its step-up transformer sends it out at 500 kV.' },
  { id: 'tx', label: 'Transmission substation', p: 600, unit: 'MW', v1: 500, v2: 138, ph: 3, note: 'Bulk power steps down toward cities and big industrial customers.' },
  { id: 'dist', label: 'Distribution substation', p: 40, unit: 'MW', v1: 138, v2: 12.47, ph: 3, note: 'Feeders leave the substation at 12.47 kV, the most common U.S. distribution voltage (7.2 kV from each wire to ground).' },
  { id: 'pole', label: 'Pole-top transformer', p: 37.5, unit: 'kW', v1: 7.2, v2: 0.24, ph: 1, note: 'One phase at 7,200 V in; 240 V out across a center-tapped winding, so each half gives 120 V.' },
];

REG.xfmr = (host) => {
  const sel = el('select', { 'aria-label': 'Transformer' });
  XF.forEach((x, i) => sel.appendChild(el('option', { value: String(i) }, x.label)));
  const p = range(1, 100, 1, 50);
  const pOut = el('output');
  const top = el('div', { class: 'pg-two' });
  top.appendChild(field('Transformer', sel));
  top.appendChild(field('Power through it', p, pOut));
  host.appendChild(top);
  const c = canvas(host, 150);
  const table = el('table');
  host.appendChild(table);
  const note = el('p', { class: 'xp-caption' });
  host.appendChild(note);

  function draw() {
    const x = XF[Number(sel.value)];
    const P = x.p * Number(p.value) / 50;            // MW or kW
    pOut.textContent = (P >= 10 ? P.toFixed(0) : P.toFixed(1)) + ' ' + x.unit;
    const watts = P * (x.unit === 'MW' ? 1e6 : 1e3);
    const I1 = watts / ((x.ph === 3 ? Math.sqrt(3) : 1) * x.v1 * 1000);
    const I2 = watts / ((x.ph === 3 ? Math.sqrt(3) : 1) * x.v2 * 1000);
    const ratio = x.v2 / x.v1;
    const amps = (I) => (I >= 1000 ? Math.round(I).toLocaleString() : I.toFixed(I < 10 ? 1 : 0)) + ' A';
    const kv = (v) => (v < 1 ? Math.round(v * 1000) + ' V' : v + ' kV');
    table.innerHTML = '';
    const rows = [
      ['', 'Primary (in)', 'Secondary (out)'],
      ['Voltage', kv(x.v1), kv(x.v2) + (x.id === 'pole' ? ' (2 × 120 V)' : '')],
      ['Current' + (x.ph === 3 ? ' per phase' : ''), amps(I1), amps(I2)],
      ['Turns', '1', ratio >= 1 ? ratio.toFixed(1) : '1/' + (1 / ratio).toFixed(1)],
    ];
    rows.forEach((r, i) => {
      const tr = el('tr');
      r.forEach((cell, j) => tr.appendChild(el(i === 0 ? 'th' : 'td', j ? { class: 'xp-num' } : {}, cell)));
      table.appendChild(tr);
    });
    note.textContent = `${x.note} Power in ≈ power out (big units are better than 99% efficient), so when voltage goes up ${(Math.max(ratio, 1 / ratio)).toFixed(1)}×, current goes down by the same factor, and resistive losses (current squared) by ${Math.round(Math.max(ratio, 1 / ratio) ** 2).toLocaleString()}×.`;
    // drawing: core with two windings, turns proportional (capped)
    const _c2 = ctx2d(c);
    if (!_c2) return;
    const { g, w, h } = _c2;
    const k = ink();
    const cx = w / 2, cw = Math.min(260, w - 40), ch = 110;
    g.strokeStyle = k.ink3; g.lineWidth = 10;
    g.strokeRect(cx - cw / 2, (h - ch) / 2, cw, ch);
    const turns = (n, x0, color, label) => {
      g.strokeStyle = color; g.lineWidth = 2;
      const nn = clamp(Math.round(n), 1, 22);
      for (let i = 0; i < nn; i++) {
        const y = (h - ch) / 2 + 10 + i * ((ch - 20) / Math.max(1, nn - 1 || 1));
        g.beginPath(); g.ellipse(x0, y, 13, 3, 0, 0, Math.PI * 2); g.stroke();
      }
      g.fillStyle = k.ink2; g.textAlign = 'center';
      g.fillText(label, x0, h - 6);
    };
    const n1 = ratio >= 1 ? 3 : 3 / ratio, n2 = ratio >= 1 ? 3 * ratio : 3;
    const scale = 22 / Math.max(n1, n2);
    turns(n1 * scale, cx - cw / 2, k.link, kv(x.v1) + ', ' + amps(I1));
    turns(n2 * scale, cx + cw / 2, k.critical, kv(x.v2) + ', ' + amps(I2));
  }
  sel.addEventListener('change', draw);
  p.addEventListener('input', draw);
  return { draw, on: (t) => t === 'theme' && draw() };
};

/* ----------------------------------------------------------------------------
 * Transmission loss calculator
 * ------------------------------------------------------------------------- */

// Typical U.S. designs: per-phase bundle of 795 kcmil ACSR "Drake" conductors
// (about 0.117 ohm per mile each at 50 C, and roughly 900 A thermal rating).
const VLINES = [
  { kv: 69, bundle: 1 }, { kv: 138, bundle: 1 }, { kv: 230, bundle: 1 },
  { kv: 345, bundle: 2 }, { kv: 500, bundle: 3 }, { kv: 765, bundle: 4 },
];

REG.lineloss = (host) => {
  const p = range(100, 3000, 50, 1000);
  const len = range(10, 400, 10, 100);
  const pOut = el('output'), lOut = el('output');
  const vsel = el('select', { 'aria-label': 'Line voltage' });
  VLINES.forEach((v, i) => vsel.appendChild(el('option', { value: String(i) }, v.kv + ' kV')));
  vsel.value = '3';
  const top = el('div', { class: 'pg-three' });
  top.appendChild(field('Power sent', p, pOut));
  top.appendChild(field('Distance', len, lOut));
  top.appendChild(field('Line voltage', vsel));
  host.appendChild(top);
  const res = el('p', { class: 'pg-big', 'aria-live': 'polite' });
  host.appendChild(res);
  const c = canvas(host, 180);
  const cap = el('p', { class: 'xp-caption' });
  host.appendChild(cap);

  function calc(v, P, L) {
    const I = P * 1e6 / (Math.sqrt(3) * v.kv * 1000 * 0.98);
    const R = 0.117 / v.bundle * L;
    const loss = 3 * I * I * R / 1e6;
    return { I, loss, pct: loss / P * 100, over: I > 900 * v.bundle };
  }
  function draw() {
    const P = Number(p.value), L = Number(len.value);
    pOut.textContent = P.toLocaleString() + ' MW';
    lOut.textContent = L + ' mi';
    const v = VLINES[Number(vsel.value)];
    const r = calc(v, P, L);
    res.textContent = `${v.kv} kV: ${Math.round(r.I).toLocaleString()} A per phase, losing ${r.loss >= 10 ? Math.round(r.loss) : r.loss.toFixed(1)} MW (${r.pct.toFixed(1)}%) as heat.` + (r.over ? ' In reality this line could not carry that much: the current is past the conductors’ thermal limit.' : '');
    const _c2 = ctx2d(c);
    if (!_c2) return;
    const { g, w, h } = _c2;
    const k = ink();
    const pad = { l: 56, r: 50, t: 6, b: 6 };
    const rows = VLINES.map((vv) => Object.assign({ v: vv }, calc(vv, P, L)));
    const max = Math.max(...rows.map((x) => Math.min(60, x.pct)), 5);
    const bh = (h - pad.t - pad.b) / rows.length;
    rows.forEach((x, i) => {
      const y = pad.t + i * bh;
      const bw = Math.min(60, x.pct) / max * (w - pad.l - pad.r);
      g.fillStyle = x.v === v ? k.link : k.ink3;
      g.globalAlpha = x.over ? 0.35 : 1;
      g.fillRect(pad.l, y + bh * 0.2, Math.max(1, bw), Math.min(18, bh * 0.6));
      g.globalAlpha = 1;
      g.fillStyle = k.text; g.textAlign = 'right';
      g.fillText(x.v.kv + ' kV', pad.l - 6, y + bh / 2);
      g.textAlign = 'left';
      g.fillStyle = k.ink2;
      g.fillText(x.pct >= 60 ? '>60%' : x.pct.toFixed(1) + '%' + (x.over ? ' (over limit)' : ''), pad.l + bw + 6, y + bh / 2);
    });
    cap.textContent = 'Same power, same distance, same type of wire (bundled 795 kcmil aluminum conductors, about 0.12 Ω per mile each). Each step up in voltage cuts current and therefore heat; real lines also lose a little to corona at the highest voltages.';
  }
  [p, len].forEach((x) => x.addEventListener('input', draw));
  vsel.addEventListener('change', draw);
  return { draw, on: (t) => t === 'theme' && draw() };
};

/* ----------------------------------------------------------------------------
 * 120/240 V split phase
 * ------------------------------------------------------------------------- */

REG.splitphase = (host) => {
  const c = canvas(host, 190);
  const controls = el('div', { class: 'xp-controls' });
  let slow = true;
  controls.appendChild(chip('Slow motion', true, (on) => { slow = on; }));
  host.appendChild(controls);
  const cap = el('p', { class: 'xp-caption' }, 'Each leg swings between +170 V and −170 V sixty times a second; 120 V is its RMS value (170 ÷ √2), the steady DC voltage that would heat a toaster the same. The two legs are mirror images, so across both you get 240 V RMS for dryers, ranges, heat pumps and EV chargers.');
  host.appendChild(cap);
  let t = 0;
  function draw(dt = 0) {
    t += dt * (slow ? 0.25 : 1);
    const _c2 = ctx2d(c);
    if (!_c2) return;
    const { g, w, h } = _c2;
    const k = ink();
    const pad = { l: 44, r: 10, t: 10, b: 10 };
    const mid = h / 2, amp = (h - pad.t - pad.b) / 2 / 340 * 1;
    const Y = (v) => mid - v * (h - pad.t - pad.b) / 2 / 340;
    g.strokeStyle = k.grid; g.lineWidth = 1; g.fillStyle = k.ink3; g.textAlign = 'right';
    for (const v of [-340, -170, 0, 170, 340]) { g.beginPath(); g.moveTo(pad.l, Y(v)); g.lineTo(w - pad.r, Y(v)); g.stroke(); g.fillText((v > 0 ? '+' : '') + v + ' V', pad.l - 4, Y(v)); }
    const cyc = 2;
    const wave = (fn, color, width) => {
      g.strokeStyle = color; g.lineWidth = width;
      g.beginPath();
      for (let x = pad.l; x <= w - pad.r; x += 2) {
        const th = (x - pad.l) / (w - pad.l - pad.r) * cyc * Math.PI * 2 - t * 60 * Math.PI * 2 / 30;
        const y = Y(fn(th));
        x === pad.l ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    };
    const pk = 120 * Math.SQRT2;
    wave((th) => 2 * pk * Math.sin(th), k.ink3, 1.5);
    wave((th) => pk * Math.sin(th), k.link, 2);
    wave((th) => -pk * Math.sin(th), k.critical, 2);
    g.textAlign = 'left';
    g.fillStyle = k.link; g.fillText('Leg 1 to neutral: 120 V RMS', pad.l + 6, pad.t + 6);
    g.fillStyle = k.critical; g.fillText('Leg 2 to neutral: 120 V RMS', pad.l + 6, pad.t + 22);
    g.fillStyle = k.ink2; g.fillText('Leg 1 to leg 2: 240 V RMS', pad.l + 6, pad.t + 38);
  }
  return { tick: (dt) => draw(dt), draw: () => draw(0) };
};

/* ----------------------------------------------------------------------------
 * Two unsynchronized grids, and what an AC-DC-AC link does with them
 * ------------------------------------------------------------------------- */

REG.phasors = (host, ctx) => {
  const c = canvas(host, 150);
  const stages = canvas(host, 120);
  const read = el('p', { class: 'xp-note', 'aria-live': 'off' });
  host.appendChild(read);
  let rel = 0.6, t = 0;
  function draw(dt = 0) {
    t += dt;
    const nbr = 60 + 0.012 * Math.sin(performance.now() / 1000 * 0.21) + 0.008 * Math.sin(performance.now() / 1000 * 0.53 + 1);
    const ours = ctx.dyn.hz || 60;
    rel += (nbr - ours) * Math.PI * 2 * dt * 20;   // drift shown 20x faster
    const k = ink();
    {
      const _c2 = ctx2d(c);
      if (!_c2) return;
      const { g, w, h } = _c2;
      const r = h / 2 - 16;
      const dialAt = (cx, label, hz, ang, color) => {
        g.strokeStyle = k.axis; g.lineWidth = 2;
        g.beginPath(); g.arc(cx, h / 2, r, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = color; g.lineWidth = 3;
        g.beginPath(); g.moveTo(cx, h / 2); g.lineTo(cx + Math.cos(ang - Math.PI / 2) * (r - 4), h / 2 + Math.sin(ang - Math.PI / 2) * (r - 4)); g.stroke();
        g.fillStyle = k.ink2; g.textAlign = 'center';
        g.fillText(label, cx, 8);
        g.fillText(hz.toFixed(3) + ' Hz', cx, h - 6);
      };
      dialAt(w * 0.22, 'Our grid', ours, 0, k.link);
      dialAt(w * 0.78, 'Neighbor', nbr, rel, k.critical);
      const deg = (((rel * 180 / Math.PI) % 360) + 540) % 360 - 180;
      g.fillStyle = k.text; g.textAlign = 'center';
      g.fillText(`${Math.abs(deg).toFixed(0)}° apart and drifting`, w / 2, h / 2 - 8);
      g.fillStyle = k.ink3;
      g.fillText('(drift shown 20× faster)', w / 2, h / 2 + 10);
      read.textContent = `Close an AC tie right now and a ${Math.abs(deg).toFixed(0)}° difference would drive a surge sized by the angle, not by anyone’s schedule. Through the converters, the flow is whatever the operators set: the model sends 0.5 GW east to west regardless of the angle.`;
    }
    {
      const _c2 = ctx2d(stages);
      if (!_c2) return;
      const { g, w, h } = _c2;
      const n = 4, pw = w / n;
      const mid = h / 2 + 6, amp = h * 0.28;
      const titles = ['AC in (60 Hz)', 'Rectified', 'DC link', 'Inverted, filtered AC out'];
      for (let s = 0; s < n; s++) {
        const x0 = s * pw + 8, x1 = (s + 1) * pw - 8;
        g.fillStyle = k.ink2; g.textAlign = 'center';
        g.fillText(titles[s], (x0 + x1) / 2, 8);
        g.strokeStyle = s === 2 ? cssVar('--pg-gascc') : k.link;
        g.lineWidth = 2;
        g.beginPath();
        for (let x = x0; x <= x1; x += 1.5) {
          const th = (x - x0) / (x1 - x0) * 4 * Math.PI + t * 4;
          let y;
          if (s === 0) y = Math.sin(th);
          else if (s === 1) {
            // six-pulse: the highest of six phase-shifted sines
            let m = -2;
            for (let p = 0; p < 6; p++) m = Math.max(m, Math.sin(th + p * Math.PI / 3));
            y = m;
          } else if (s === 2) y = 0.96;
          else {
            const st = Math.round(Math.sin(th + rel * 0) * 3) / 3;
            y = 0.5 * st + 0.5 * Math.sin(th);
          }
          const yy = mid - y * amp;
          x === x0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
        }
        g.stroke();
        if (s < n - 1) {
          g.fillStyle = k.ink3;
          g.fillText('→', x1 + 8, mid);
        }
      }
    }
  }
  return { tick: (dt) => draw(dt), draw: () => draw(0) };
};

/* ----------------------------------------------------------------------------
 * Black start stepper
 * ------------------------------------------------------------------------- */

const BS_STEPS = [
  { title: 'Total blackout', focus: 'overview', text: 'Every unit has tripped and every line is dead. Plants need power to start: pumps, fans, coal mills and controls all run on electricity. Even nuclear units sit in safe shutdown, cooled by emergency diesel generators.' },
  { title: '1. Start a black-start unit', focus: 'hydro', text: 'A hydro unit opens its wicket gates using battery-powered controls; falling water spins the turbine, and the exciter builds voltage from the station batteries. Black-start units are specially designated and tested (in the U.S., at least every three years).' },
  { title: '2. Energize a cranking path', focus: 'line345', text: 'Operators close breakers one section at a time to send power from the dam toward a big thermal plant. A long, lightly loaded line pushes voltage up (the Ferranti effect), and energizing a large transformer draws an inrush current several times its rating, so shunt reactors go in first.' },
  { title: '3. Give the big plant station service', focus: 'coal', text: 'The cranking path powers the coal plant’s own auxiliaries, a few percent of its output: boiler feed pumps, draft fans, mills. Warming a large steam unit from cold takes hours.' },
  { title: '4. Pick up load in small blocks', focus: 'town', text: 'An island is now running at its own frequency. Operators close one feeder at a time, each a small fraction of what is online, because every block makes frequency dip. After an outage every refrigerator, furnace and air conditioner restarts at once (cold-load pickup), so each block draws more than normal.', loadSteps: true },
  { title: '5. Add generators and synchronize', focus: 'gascc', text: 'Quick-start gas units sync onto the island: match voltage, frequency and phase before closing each breaker. The island grows; more neighborhoods and downtown come back.' },
  { title: '6. Tie islands together', focus: 'hvdc', text: 'Separately restored islands are synchronized at a substation with a synchrocheck relay, or supported over DC links (voltage-source converters can even help black start). Wind, solar and batteries reconnect once there is a stable grid to follow.' },
  { title: '7. Nuclear comes back last', focus: 'nuclear', text: 'Nuclear plants need reliable off-site power before restarting, and a unit that tripped from full power may take a day or more to return. The system is back to normal operation.' },
];

REG.blackstart = (host, ctx) => {
  const head = el('p', { class: 'pg-big' });
  const body = el('p');
  const c = canvas(host, 130);
  host.prepend(head);
  host.insertBefore(body, c);
  const controls = el('div', { class: 'xp-controls' });
  const back = button('← Back', () => go(step - 1));
  const next = button('Next step →', () => go(step + 1), 'xp-btn xp-primary');
  controls.appendChild(back);
  controls.appendChild(next);
  controls.appendChild(button('Start over', () => go(0)));
  host.appendChild(controls);
  const cap = el('p', { class: 'xp-caption' }, 'Island frequency during restoration: each load block makes it dip; small islands have little inertia, so the dips are deep.');
  host.appendChild(cap);
  let step = 0;
  const island = new sim.Dynamics();
  let islandLoad = 0, pending = [];
  function go(n) {
    step = clamp(n, 0, BS_STEPS.length - 1);
    const s = BS_STEPS[step];
    head.textContent = s.title;
    body.textContent = s.text;
    back.disabled = step === 0;
    next.disabled = step === BS_STEPS.length - 1;
    // Reading the topic during another scenario shouldn't black out the
    // grid; the first step forward does.
    if (step > 0 || ctx.S.scn.id === 'blackstart') ctx.ACT.blackStartStep(step === BS_STEPS.length - 1 ? 7 : step);
    if (ctx.scene) { ctx.scene.focus(s.focus); ctx.scene.setSelected(s.focus === 'overview' ? null : s.focus); }
    island.reset();
    if (step === 0) island.collapsed = true;
    islandLoad = step >= 1 ? 0.05 : 0;
    pending = [];
    if (s.loadSteps) {
      // five feeder pickups, a few seconds apart
      for (let i = 0; i < 5; i++) pending.push({ at: island.t + 2 + i * 4, gw: 0.045 });
    }
  }
  function draw(dt) {
    if (step >= 1) {
      while (pending.length && pending[0].at <= island.t) {
        const p = pending.shift();
        islandLoad += p.gw;
        island.disturb(p.gw);
      }
      const units = step >= 5 ? 1.2 : step >= 3 ? 0.6 : 0.25;
      island.step(dt, { load: islandLoad, E: units * 3.5, gov: units * 0.9, up: units * 0.6, down: 0.2, ffrGW: 0, ffrOn: false });
    } else island.step(dt, { load: 0, E: 1, gov: 0, up: 0, down: 0, ffrGW: 0, ffrOn: false });
    ctx.S.islandHz = step >= 1 && step < BS_STEPS.length - 1 ? island.hz : null;
    drawTrace(c, island.trace, { lo: 59.4, hi: 60.2, marks: false });
  }
  go(0);
  return {
    tick: (dt) => draw(dt),
    draw: () => draw(0),
    on: (t, d) => { if (t === 'blackstart') go(d.step || 0); },
    destroy: () => { ctx.S.islandHz = null; },
  };
};

/* ----------------------------------------------------------------------------
 * Your bill
 * ------------------------------------------------------------------------- */

REG.bill = (host, ctx) => {
  const kwh = range(200, 2500, 10, 860);
  const whole = range(10, 200, 1, 45);
  const capPrice = range(0, 400, 5, 0);
  const kOut = el('output'), wOut = el('output'), cOut = el('output');
  const grid = el('div', { class: 'pg-three' });
  grid.appendChild(field('Use per month', kwh, kOut));
  grid.appendChild(field('Wholesale energy', whole, wOut));
  grid.appendChild(field('Capacity price', capPrice, cOut));
  host.appendChild(grid);
  const bar = el('div', { class: 'pg-billbar' });
  host.appendChild(bar);
  const out = el('p', { class: 'pg-big', 'aria-live': 'polite' });
  host.appendChild(out);
  const cap = el('p', { class: 'xp-caption' });
  host.appendChild(cap);
  const controls = el('div', { class: 'xp-controls' });
  controls.appendChild(button('Use the model’s price right now', () => { whole.value = String(clamp(Math.round(ctx.res.price), 10, 200)); draw(); }));
  controls.appendChild(button('PJM 2026/27 capacity price', () => { capPrice.value = '329'; draw(); }));
  host.appendChild(controls);
  function draw() {
    const use = Number(kwh.value), wp = Number(whole.value), cp = Number(capPrice.value);
    kOut.textContent = use.toLocaleString() + ' kWh';
    wOut.textContent = '$' + wp + '/MWh';
    cOut.textContent = '$' + cp + '/MW-day';
    // A stylized residential bill. Energy: wholesale plus ~10% for losses
    // and hedging. Capacity: an assumed 2.5 kW share of the system peak.
    const energy = use * wp / 1000 * 1.1;
    const capacity = cp * 365 / 12 * 2.5 / 1000;
    const transmission = use * 0.022;
    const distribution = use * 0.052 + 12;
    const parts = [['Energy (generation)', energy, '--pg-gascc'], ['Capacity', capacity, '--pg-peaker'], ['Transmission', transmission, '--pg-hydro'], ['Distribution + customer charge', distribution, '--pg-wind']];
    const total = parts.reduce((s, p) => s + p[1], 0);
    bar.innerHTML = '';
    for (const [name, v, tok] of parts) {
      if (v <= 0.01) continue;
      const s = el('i');
      s.style.flexGrow = String(v);
      s.style.background = `var(${tok})`;
      s.title = `${name}: $${v.toFixed(2)}`;
      bar.appendChild(s);
    }
    const lg = el('div', { class: 'xp-legend' });
    for (const [name, v, tok] of parts) {
      if (v <= 0.01) continue;
      const it = el('span');
      const sw = el('i', { class: 'xp-swatch' });
      sw.style.background = `var(${tok})`;
      it.appendChild(sw);
      it.appendChild(document.createTextNode(`${name} $${v.toFixed(2)}`));
      lg.appendChild(it);
    }
    bar.appendChild(lg);
    out.textContent = `$${total.toFixed(2)} a month, ${(total / use * 100).toFixed(1)}¢/kWh`;
    cap.textContent = 'Stylized, not any one utility: transmission and distribution rates are typical magnitudes, and the capacity line assumes the household is responsible for 2.5 kW of the system peak. The U.S. average residential price was about 17–18¢/kWh in late 2025.';
  }
  [kwh, whole, capPrice].forEach((x) => x.addEventListener('input', draw));
  return { draw, on: (t) => t === 'theme' && draw() };
};

/* ----------------------------------------------------------------------------
 * Static reference charts (SVG, so they inherit the theme for free)
 * ------------------------------------------------------------------------- */

const SETS = {
  shares: () => ({
    kind: 'bars', unit: '%', note: 'Share of 2025 U.S. electricity generation, including rooftop solar (EIA; 4,528 TWh total).',
    rows: sim.US_SHARES_2025.map((r) => ({ id: r.id, label: r.label, v: r.pct, text: r.pct.toFixed(1) + '%' })),
  }),
  lcoe: () => ({
    kind: 'ranges', note: 'Cost of new plants over their lifetime, unsubsidized, $/MWh (Lazard LCOE+ v19.0, July 2026). Ranges reflect sites, capital costs and capacity factors.',
    rows: sim.LCOE_2026.map((r) => ({ id: r.id, label: r.label, lo: r.lo, hi: r.hi })), max: 280,
  }),
  marginal: () => ({
    kind: 'ranges', note: 'Cost to keep running an existing, paid-off plant, $/MWh (same Lazard report). Wind and solar are near zero.',
    rows: sim.MARGINAL_EXISTING_2026.map((r) => ({ id: r.id, label: r.label, lo: r.lo, hi: r.hi })), max: 140,
  }),
  pjm: () => ({
    kind: 'bars', unit: '$/MW-day', note: 'PJM capacity auction, RTO clearing price by delivery year. The last three hit a price cap agreed in a settlement; uncapped, 2027/28 would have cleared near $530 and 2028/29 near $555.',
    rows: sim.PJM_BRA.map((r) => ({ id: r.year, label: r.year, v: r.price, text: '$' + r.price.toFixed(2) + (r.cap ? ' (cap)' : '') })),
  }),
  queue: () => ({
    kind: 'bars', unit: 'GW', note: 'Active U.S. interconnection queue at the end of 2024, GW (LBNL, Queued Up 2025). Most of it will never be built.',
    rows: [
      { id: 'solar', label: 'Solar', v: 956, text: '956 GW' },
      { id: 'storage', label: 'Storage', v: 890, text: '890 GW' },
      { id: 'wind', label: 'Wind', v: 271, text: '271 GW' },
      { id: 'gas', label: 'Gas', v: 136, text: '136 GW' },
    ],
  }),
};

REG.bars = (host) => {
  const set = SETS[host.dataset.set] ? SETS[host.dataset.set]() : null;
  if (!set) return null;
  const hi = (host.dataset.highlight || '').split(',');
  const rows = set.rows;
  const rowH = 24, lw = 132, w = 420, h = rows.length * rowH + 6;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'pg-svgchart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', set.note);
  const max = set.max || Math.max(...rows.map((r) => r.v || r.hi)) * 1.05;
  const X = (v) => lw + v / max * (w - lw - 96);
  rows.forEach((r, i) => {
    const y = 3 + i * rowH;
    const on = !hi[0] || hi.includes(r.id);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', String(lw - 8));
    t.setAttribute('y', String(y + rowH / 2 + 4));
    t.setAttribute('text-anchor', 'end');
    t.setAttribute('class', on ? 'pg-t' : 'pg-t pg-dim');
    t.textContent = r.label;
    svg.appendChild(t);
    const rect = document.createElementNS(NS, 'rect');
    const x0 = set.kind === 'ranges' ? X(r.lo) : X(0);
    const x1 = set.kind === 'ranges' ? X(r.hi) : X(r.v);
    rect.setAttribute('x', String(x0));
    rect.setAttribute('y', String(y + 5));
    rect.setAttribute('width', String(Math.max(2, x1 - x0)));
    rect.setAttribute('height', String(rowH - 10));
    rect.setAttribute('rx', '4');
    rect.setAttribute('class', on ? 'pg-bar' : 'pg-bar pg-bar-dim');
    svg.appendChild(rect);
    const v = document.createElementNS(NS, 'text');
    v.setAttribute('x', String(x1 + 6));
    v.setAttribute('y', String(y + rowH / 2 + 4));
    v.setAttribute('class', 'pg-t pg-v');
    v.textContent = set.kind === 'ranges' ? `$${r.lo}–${r.hi}` : r.text;
    svg.appendChild(v);
  });
  host.appendChild(svg);
  host.appendChild(el('p', { class: 'xp-caption' }, set.note));
  // Table twin for screen readers and anyone who wants the numbers.
  const det = el('details', { class: 'pg-table' });
  det.appendChild(el('summary', {}, 'Show as a table'));
  const tb = el('table');
  rows.forEach((r) => {
    const tr = el('tr');
    tr.appendChild(el('td', {}, r.label));
    tr.appendChild(el('td', { class: 'xp-num' }, set.kind === 'ranges' ? `$${r.lo}–$${r.hi}` : r.text));
    tb.appendChild(tr);
  });
  det.appendChild(tb);
  host.appendChild(det);
  return {};
};

/* ----------------------------------------------------------------------------
 * Live mix (bigger version of the HUD bar) for the overview topic
 * ------------------------------------------------------------------------- */

REG.mixnow = (host, ctx) => {
  const box = el('div');
  host.appendChild(box);
  const cap = el('p', { class: 'xp-caption' });
  host.appendChild(cap);
  function draw() {
    drawMix(box, ctx.S.blackout ? null : ctx.res);
    cap.textContent = `The model right now: ${fmt(ctx.res.load, 1)} GW of demand at ${sim.fmtClock(ctx.hour)}.`;
  }
  return { draw, slow: draw };
};

PG.widgets = { mount, emit, tick, groupColor, drawGauge, drawTrace, drawMix };
})(window.PowerGrid = window.PowerGrid || {});
