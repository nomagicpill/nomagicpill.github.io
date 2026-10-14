/*
 * knowledge/drafttransistors.html: the 2D stage. Two views share one SVG:
 *
 *  - process: the cross-section after any step of the flow (process.js),
 *    with what the step changed outlined, labels with leader lines, and a
 *    sketch of what is happening (ions, heat, plasma, a wet bath, a polish).
 *  - device: one biased transistor or MOS capacitor, with its depletion
 *    region, inversion or accumulation layer and moving carriers computed by
 *    physics.js at the current gate and drain voltages.
 *
 * Shapes live in nanometre "world" coordinates under one transform (z up);
 * labels, arrows and badges are drawn in screen pixels so text stays the
 * same size at any zoom. Colours are CSS variables (--tx-*), so the theme
 * toggle needs no redraw. Becomes Transistors.xsection.
 */
(function (TR) {
'use strict';
const NS = 'http://www.w3.org/2000/svg';
const F = TR.process;
const PH = TR.physics;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

const measure = (() => {
  const c = document.createElement('canvas').getContext('2d');
  return (text, px = 12, bold = false) => { c.font = (bold ? 'bold ' : '') + px + 'px Arial, sans-serif'; return c.measureText(text).width; };
})();

function pathD(pts) {
  return 'M' + pts.map((p) => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join('L') + 'Z';
}

function niceLength(nmPerPx, targetPx = 110) {
  const raw = nmPerPx * targetPx;
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  let best = steps[0];
  for (const s of steps) if (s <= raw) best = s;
  return best;
}

function createXSection(host, { onHover, onShapeClick } = {}) {
  const svg = el('svg', { class: 'tx-svg', 'aria-hidden': 'false', role: 'img' }, host);
  const defs = el('defs', {}, svg);
  // Hatching for depletion regions; arrowheads for ions and current.
  const hatch = el('pattern', { id: 'tx-hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('rect', { width: 7, height: 7, style: 'fill: var(--tx-dep-bg)' }, hatch);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 7, style: 'stroke: var(--tx-dep); stroke-width: 2' }, hatch);
  const brk = el('pattern', { id: 'tx-brk', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-45)' }, defs);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 10, style: 'stroke: var(--xp-axis); stroke-width: 1.5' }, brk);
  const mk = el('marker', { id: 'tx-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0,0 L10,5 L0,10 z', style: 'fill: context-stroke' }, mk);
  const heatGrad = el('linearGradient', { id: 'tx-heatgrad', x1: 0, y1: 1, x2: 0, y2: 0 }, defs);
  el('stop', { offset: '0', style: 'stop-color: var(--tx-heat); stop-opacity: 0.45' }, heatGrad);
  el('stop', { offset: '0.7', style: 'stop-color: var(--tx-heat); stop-opacity: 0.08' }, heatGrad);
  el('stop', { offset: '1', style: 'stop-color: var(--tx-heat); stop-opacity: 0' }, heatGrad);

  // Everything below the torn edge of the wafer is clipped away.
  const clip = el('clipPath', { id: 'tx-clip', clipPathUnits: 'userSpaceOnUse' }, defs);
  const clipRect = el('rect', { x: -1e5, y: -1e5, width: 2e5, height: 2e5 }, clip);
  const gWorld = el('g', { class: 'tx-world' }, svg);
  const gScreen = el('g', { class: 'tx-screen' }, svg);
  const gLabels = el('g', { class: 'tx-labels' }, svg);

  // ---- View transform: screen = (x * s + tx, -z * s + ty)
  const view = { s: 1, tx: 0, ty: 0 };
  let tween = null;
  let user = false;            // the reader has zoomed or panned
  let insets = { top: 70, right: 0, bottom: 120, left: 0 };
  let box = { w: 800, h: 600 };
  const toScreen = (x, z) => [x * view.s + view.tx, -z * view.s + view.ty];
  const toWorld = (sx, sy) => [(sx - view.tx) / view.s, -(sy - view.ty) / view.s];

  function applyView() {
    gWorld.setAttribute('transform', `matrix(${view.s},0,0,${-view.s},${view.tx},${view.ty})`);
    drawOverlay();
  }

  function fitFor(b) {
    const availW = Math.max(120, box.w - insets.left - insets.right);
    const availH = Math.max(120, box.h - insets.top - insets.bottom);
    const m = Math.min(48, availW * 0.06);
    const s = Math.min((availW - 2 * m) / (b.x1 - b.x0), (availH - 2 * m - 24) / (b.z1 - b.z0));
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    return { s, tx: insets.left + availW / 2 - cx * s, ty: insets.top + 12 + availH / 2 + cz * s };
  }

  function goTo(target, ms = 450) {
    if (ms <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      Object.assign(view, target); applyView(); return;
    }
    const from = Object.assign({}, view);
    const t0 = performance.now();
    tween = (now) => {
      const t = ease((now - t0) / ms);
      view.s = from.s * Math.pow(target.s / from.s, t);
      view.tx = lerp(from.tx, target.tx, t);
      view.ty = lerp(from.ty, target.ty, t);
      applyView();
      if (t >= 1) tween = null;
    };
  }

  // ---- Zoom and pan by the reader
  let drag = null;
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    const s = clamp(view.s * k, base.s * 0.5, base.s * 40);
    const kk = s / view.s;
    view.tx = sx - (sx - view.tx) * kk;
    view.ty = sy - (sy - view.ty) * kk;
    view.s = s;
    user = true;
    tween = null;
    applyView();
  }, { passive: false });
  const pointers = new Map();
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    else drag = null;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      // Pinch zoom.
      const pts = [...pointers.values()];
      const other = pts.find((p) => p !== pointers.get(e.pointerId)) || pts[0];
      const d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
      const d1 = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
      if (d0 > 4) {
        const r = svg.getBoundingClientRect();
        const cx = (e.clientX + other[0]) / 2 - r.left, cy = (e.clientY + other[1]) / 2 - r.top;
        const s = clamp(view.s * d1 / d0, base.s * 0.5, base.s * 40);
        const kk = s / view.s;
        view.tx = cx - (cx - view.tx) * kk;
        view.ty = cy - (cy - view.ty) * kk;
        view.s = s;
        user = true;
        applyView();
      }
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) {
      view.tx = drag.tx + dx;
      view.ty = drag.ty + dy;
      user = true;
      tween = null;
      applyView();
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) setTimeout(() => { drag = null; }, 0);
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('dblclick', () => { user = false; goTo(base); });

  /* ------------------------------------------------------------------------
   * Process view
   * --------------------------------------------------------------------- */

  let mode = 'process';
  let scaleKey = 'schematic';
  let labelMode = 'all';
  let stepIdx = 0;
  let current = null;          // { geo, hl }
  let base = { s: 1, tx: 0, ty: 0 };
  let zoomKey = null;
  let gShapes = null;

  function shapeNode(s, hl, parent) {
    const m = F.MATS[s.mat];
    const style = [`fill: var(${s.mat === 'void' ? '--tx-void' : m.v})`];
    if (s.brk) style[0] = 'fill: url(#tx-brk)';
    const p = el('path', {
      d: pathD(s.pts),
      class: 'tx-shape' + (hl ? ' tx-new' : '') + (s.dash ? ' tx-dash' : ''),
      style: style.join(';'),
      'fill-opacity': s.op != null ? s.op : null,
      'vector-effect': 'non-scaling-stroke',
    }, parent);
    p.addEventListener('pointerenter', (e) => hover(s, e));
    p.addEventListener('pointermove', (e) => hover(s, e));
    p.addEventListener('pointerleave', () => onHover && onHover(null));
    p.addEventListener('click', () => { if (!(drag && drag.moved) && onShapeClick) onShapeClick(s); });
    return p;
  }

  function hover(s, e) {
    if (!onHover || (drag && drag.moved)) return;
    const m = F.MATS[s.mat];
    let name = s.label && !/^Metal|^Via|^M2/.test(s.label) ? s.label : m.name;
    if (s.mat === 'void') name = 'Opening, etched and not yet filled';
    let info = s.info ? 'Real size: ' + s.info : '';
    if (scaleKey === 'true' && s.info) info = s.info;
    if (s.dash) info = (info ? info + '. ' : '') + 'As implanted: not yet annealed';
    onHover({ title: name, text: info, x: e.clientX, y: e.clientY });
  }

  function renderProcess(i, { animate = true } = {}) {
    stepIdx = i;
    const step = F.STEPS[i];
    const D = F.DIMS[scaleKey];
    const geo = F.geometry(F.stateAt(i), D, step);
    const prev = i > 0 && !F.STEPS[i - 1].station ? F.geometry(F.stateAt(i - 1), D, F.STEPS[i - 1]) : null;
    const hl = prev ? F.changed(prev, geo) : new Set();
    current = { geo, hl, step };

    const old = gShapes;
    gShapes = el('g', { class: 'tx-shapes', 'clip-path': 'url(#tx-clip)' }, gWorld);
    // Draw new/changed shapes with an outline; silicon at the bottom never highlighted.
    for (const s of geo.shapes) shapeNode(s, hl.has(s.id) && s.id !== 'si' || (s.id === 'si' && hl.has('si') && step.id === 'stietch'), gShapes);
    // Wafer continues below: a torn edge.
    const D0 = geo.bounds.z0;
    const W = geo.L.W;
    const tear = [];
    for (let k = 0; k <= 40; k++) tear.push([W * k / 40, D0 + (k % 2 ? 12 : -12) * (D.Dsi / 1000)]);
    el('path', { d: 'M' + tear.map((p) => p.join(',')).join('L'), class: 'tx-tear', 'vector-effect': 'non-scaling-stroke' }, gShapes);

    if (old) {
      if (animate) {
        const fresh = gShapes;
        fresh.style.opacity = '0';
        requestAnimationFrame(() => { fresh.style.transition = 'opacity 0.35s'; fresh.style.opacity = '1'; });
        old.style.transition = 'opacity 0.3s';
        old.style.opacity = '0';
        setTimeout(() => old.remove(), 320);
      } else old.remove();
    }

    clipRect.setAttribute('y', geo.bounds.z0 - 14 * (D.Dsi / 1000));
    clipRect.setAttribute('height', 1e5);
    const zk = (step.zoom || 'deep') + scaleKey;
    base = fitFor(geo.bounds);
    if (!user || zk !== zoomKey) { user = false; goTo(base, animate && zoomKey ? 450 : 0); }
    else applyView();
    zoomKey = zk;
  }

  function drawOverlay() {
    gScreen.textContent = '';
    gLabels.textContent = '';
    if (mode === 'process' && current) { drawAnnos(); drawLabels(); drawScale(); }
    if (mode === 'device' && dev) drawDeviceOverlay();
  }

  function pill(text, x, y, cls, parent = gScreen) {
    const w = measure(text, 12, true) + 16;
    const g = el('g', { class: 'tx-pill ' + (cls || ''), transform: `translate(${x},${y})` }, parent);
    el('rect', { x: 0, y: -11, width: w, height: 22, rx: 11 }, g);
    const t = el('text', { x: 8, y: 4 }, g);
    t.textContent = text;
    return w;
  }

  function drawAnnos() {
    const { geo } = current;
    const L = geo.L;
    const [lx, ty] = toScreen(0, geo.top);
    const [rx] = toScreen(L.W, 0);
    for (const a of geo.annos) {
      if (a.kind === 'ions') {
        const [, yTop] = toScreen(0, a.top);
        for (const r of a.arrows) {
          const [x, y1] = toScreen(r.x, r.z);
          el('line', { x1: x, y1: yTop, x2: x, y2: y1, class: 'tx-ion' + (r.blocked ? ' tx-blocked' : ''), 'marker-end': 'url(#tx-arrow)' }, gScreen);
        }
        pill(a.label, lx + 4, yTop - 16, 'tx-pill-ion');
      } else if (a.kind === 'heat') {
        const [, yb] = toScreen(0, geo.bounds.z0);
        el('rect', { x: lx, y: ty - 30, width: rx - lx, height: Math.max(10, yb - ty + 30), class: 'tx-heat', fill: 'url(#tx-heatgrad)' }, gScreen);
        pill(a.label, lx + 4, ty - 44, 'tx-pill-heat');
      } else if (a.kind === 'plasma') {
        const h = 46;
        el('rect', { x: lx, y: ty - h, width: rx - lx, height: h, class: 'tx-plasma' }, gScreen);
        for (let k = 0; k < 18; k++) {
          const x = lx + (rx - lx) * (k + 0.5) / 18;
          el('line', { x1: x, y1: ty - h + 6, x2: x, y2: ty - 6, class: 'tx-plasma-ion', 'marker-end': 'url(#tx-arrow)' }, gScreen);
        }
        pill(a.label, lx + 4, ty - h - 16, 'tx-pill-plasma');
      } else if (a.kind === 'wet') {
        const h = 34;
        const wave = [];
        for (let k = 0; k <= 60; k++) wave.push([lx + (rx - lx) * k / 60, ty - h + Math.sin(k / 2.2) * 3]);
        el('path', { d: 'M' + wave.map((p) => p.join(',')).join('L') + `L${rx},${ty}L${lx},${ty}Z`, class: 'tx-wet' }, gScreen);
        pill(a.label, lx + 4, ty - h - 16, 'tx-pill-wet');
      } else if (a.kind === 'cmp') {
        el('line', { x1: lx - 10, y1: ty, x2: rx + 10, y2: ty, class: 'tx-cmpline' }, gScreen);
        el('rect', { x: lx + (rx - lx) * 0.15, y: ty - 26, width: (rx - lx) * 0.5, height: 16, rx: 3, class: 'tx-pad' }, gScreen);
        pill('Polished flat', lx + 4, ty - 44, 'tx-pill-cmp');
      }
    }
  }

  function placeLabels(items, bounds) {
    // items: { x, y (anchor px), text, strong }. Greedy placement with a few candidates.
    const placed = [];
    const out = [];
    const overlaps = (r) => placed.some((q) => r.x < q.x + q.w + 4 && r.x + r.w + 4 > q.x && r.y < q.y + q.h + 3 && r.y + r.h + 3 > q.y);
    items.sort((a, b) => (b.strong - a.strong) || (a.y - b.y));
    for (const it of items) {
      const w = measure(it.text, 12, it.strong) + 12, h = 20;
      const cands = [[16, -30], [-16 - w, -30], [16, 14], [-16 - w, 14], [24, -54], [-24 - w, -54], [24, 38], [-24 - w, 38], [36, -78], [-36 - w, -78]];
      let best = null;
      for (const [dx, dy] of cands) {
        const r = { x: it.x + dx, y: it.y + dy, w, h };
        if (r.x < bounds.x0 + 2 || r.x + w > bounds.x1 - 2 || r.y < bounds.y0 + 2 || r.y + h > bounds.y1 - 2) continue;
        if (!overlaps(r)) { best = r; break; }
      }
      if (!best) continue;
      placed.push(best);
      out.push(Object.assign({ box: best }, it));
    }
    return out;
  }

  function drawLabels() {
    if (labelMode === 'off') return;
    const { geo, hl } = current;
    const withLab = geo.shapes.filter((s) => s.label && s.lab && s.lab[1] >= geo.bounds.z0);
    const showAll = labelMode === 'all';
    const items = [];
    for (const s of withLab) {
      const isNew = hl.has(s.id) || (s.id.startsWith('resist') && current.step.set && current.step.set.resist);
      if (!showAll && !isNew) continue;
      const [x, y] = toScreen(s.lab[0], s.lab[1]);
      items.push({ x, y, text: s.label, strong: isNew ? 1 : 0 });
    }
    const bounds = { x0: insets.left, x1: box.w - insets.right, y0: insets.top - 10, y1: box.h - insets.bottom + 10 };
    for (const it of placeLabels(items, bounds)) {
      const g = el('g', { class: 'tx-label' + (it.strong ? ' tx-label-new' : '') }, gLabels);
      const b = it.box;
      const ax = clamp(it.x, b.x, b.x + b.w), ay = b.y + b.h / 2;
      el('line', { x1: it.x, y1: it.y, x2: b.x < it.x ? b.x + b.w : b.x, y2: ay }, g);
      el('circle', { cx: it.x, cy: it.y, r: 2.5 }, g);
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 5 }, g);
      const t = el('text', { x: b.x + 6, y: b.y + 14 }, g);
      t.textContent = it.text;
      void ax;
    }
  }

  function drawScale() {
    const x0 = insets.left + 16, y0 = box.h - insets.bottom - 14;
    if (scaleKey === 'true') {
      const len = niceLength(1 / view.s);
      const px = len * view.s;
      el('line', { x1: x0, y1: y0, x2: x0 + px, y2: y0, class: 'tx-scalebar' }, gScreen);
      el('line', { x1: x0, y1: y0 - 5, x2: x0, y2: y0 + 5, class: 'tx-scalebar' }, gScreen);
      el('line', { x1: x0 + px, y1: y0 - 5, x2: x0 + px, y2: y0 + 5, class: 'tx-scalebar' }, gScreen);
      const t = el('text', { x: x0 + px + 8, y: y0 + 4, class: 'tx-scaletext' }, gScreen);
      t.textContent = len >= 1000 ? len / 1000 + ' µm' : len + ' nm';
    } else {
      const t = el('text', { x: x0, y: y0 + 4, class: 'tx-scaletext' }, gScreen);
      t.textContent = 'Schematic: thin films drawn thicker than life';
    }
  }

  /* ------------------------------------------------------------------------
   * Device view: one biased transistor (or MOS capacitor)
   * --------------------------------------------------------------------- */

  let dev = null;              // { opts, d (physics device), cap, ch, st }
  let gDev = null;
  const DG = { W: 1200, sdW: 330, Xj: 170, tox: 16, Hg: 150, body: 560, cW: 120, gl: 360, gr: 840 };
  let particles = [];

  function deviceGeometry(o) {
    const nT = o.type !== 'p';
    const shapes = [];
    const add = (id, mat, pts, extra) => shapes.push(Object.assign({ id, mat, pts }, extra || {}));
    const bodyMat = nT ? 'pw' : 'nw';
    add('body', 'si', [[0, -DG.body], [DG.W, -DG.body], [DG.W, 0], [0, 0]]);
    add('well', bodyMat, [[0, -DG.body], [DG.W, -DG.body], [DG.W, 0], [0, 0]], { op: 0.5 });
    if (o.variant !== 'moscap') {
      const dop = nT ? 'np' : 'pp';
      const r = DG.Xj * 0.7;
      const basinL = [[0, 0], [0, -DG.Xj]];
      for (let k = 0; k <= 12; k++) { const a = Math.PI / 2 * k / 12; basinL.push([DG.gl - r + r * Math.sin(a), -DG.Xj + r - r * Math.cos(a)]); }
      basinL.push([DG.gl, 0]);
      const basinR = basinL.map(([x, z]) => [DG.W - x, z]).reverse();
      add('src', dop, basinL, { op: 0.9 });
      add('drn', dop, basinR, { op: 0.9 });
      add('cS', 'w', [[90, 0], [90 + DG.cW, 0], [90 + DG.cW, 70], [90, 70]]);
      add('cD', 'w', [[DG.W - 90 - DG.cW, 0], [DG.W - 90, 0], [DG.W - 90, 70], [DG.W - 90 - DG.cW, 70]]);
    }
    const g0 = o.variant === 'moscap' ? 120 : DG.gl, g1 = o.variant === 'moscap' ? DG.W - 120 : DG.gr;
    add('ox', 'ox', [[g0, 0], [g1, 0], [g1, DG.tox], [g0, DG.tox]]);
    const gm = o.gateMat || (nT ? 'npoly' : 'ppoly');
    add('gate', gm, [[g0, DG.tox], [g1, DG.tox], [g1, DG.tox + DG.Hg], [g0, DG.tox + DG.Hg]]);
    return { shapes, g0, g1 };
  }

  function renderDevice(o) {
    const d = o.device;
    const nT = o.type !== 'p';
    const geo = deviceGeometry(o);
    const vg = o.vg, vd = o.variant === 'moscap' ? 0 : o.vd;
    const ch = o.variant === 'moscap' ? null : d.channel(nT ? vg : -vg, nT ? vd : -vd);
    const st = o.cap.solve(vg);
    const I = o.variant === 'moscap' ? 0 : Math.abs(d.ids(vg, vd));
    dev = { o, geo, ch, st, I, nT };

    if (gDev) gDev.remove();
    gDev = el('g', { class: 'tx-device' }, gWorld);
    for (const s of geo.shapes) shapeNode(s, false, gDev);

    // Depletion region (hatched).
    const Wref = Math.max(5, o.cap.Wmax / PH.NM);
    const depth = (wnm) => clamp(wnm / Wref, 0, 1.9) * DG.Xj * 0.75;
    const g0 = geo.g0, g1 = geo.g1;
    const sigmaInv = nT ? 1 : -1;
    const dep = [];
    if (o.variant === 'moscap') {
      const w = depth(st.W);
      if (w > 1) { dep.push([g0 - 40, 0], [g0 - 40 + 0, -w * 0.9]); dep.push([g1 + 40, -w * 0.9], [g1 + 40, 0]); }
    } else {
      // Under the channel: the surface depletion at the source end, deepening
      // toward the drain as the channel voltage rises along it.
      const w0 = ch.pts[0].wdep || 1;
      if (st.W > 0.5) {
        dep.push([DG.gl, 0]);
        for (const p of ch.pts) dep.push([lerp(DG.gl, DG.gr, p.y), -depth(st.W * p.wdep / w0)]);
        dep.push([DG.gr, 0]);
      }
    }
    if (dep.length > 2) el('path', { d: pathD(dep), class: 'tx-dep', 'vector-effect': 'non-scaling-stroke' }, gDev);
    if (o.variant !== 'moscap') {
      // Junction depletion: a band around each source/drain edge.
      const jw = (wnm) => clamp(wnm / Wref, 0.05, 2) * DG.Xj * 0.45;
      const band = (side, w) => {
        const r = DG.Xj * 0.7;
        const outer = [], inner = [];
        for (let k = 0; k <= 12; k++) {
          const a = Math.PI / 2 * k / 12;
          inner.push([DG.gl - r + r * Math.sin(a), -DG.Xj + r - r * Math.cos(a)]);
          outer.push([DG.gl - r + (r + w) * Math.sin(a), -DG.Xj + r - (r + w) * Math.cos(a)]);
        }
        const pts = [[0, -DG.Xj], [0, -DG.Xj - w]].concat(outer.slice(1), [[DG.gl + w, 0], [DG.gl, 0]], inner.slice().reverse());
        return side === 'L' ? pts : pts.map(([x, z]) => [DG.W - x, z]);
      };
      el('path', { d: pathD(band('L', jw(ch.Wj0))), class: 'tx-dep', 'vector-effect': 'non-scaling-stroke' }, gDev);
      el('path', { d: pathD(band('R', jw(ch.Wj))), class: 'tx-dep', 'vector-effect': 'non-scaling-stroke' }, gDev);
    }

    // Inversion or accumulation layer at the surface.
    const reg = st.regime;
    const qInv = Math.abs(st.Qinv) / PH.Q;              // carriers per cm^2
    if (sigmaInv * st.psiS > 0 && qInv > 1e9) {
      const tmax = clamp(4 + 3.2 * Math.log10(qInv / 1e9), 3, 26);
      const top = [], bot = [];
      if (o.variant === 'moscap') {
        top.push([g0, 0], [g1, 0]); bot.push([g1, -tmax], [g0, -tmax]);
      } else {
        for (const p of ch.pts) {
          const x = lerp(DG.gl, DG.gr, p.y);
          const t = Math.max(1.2, tmax * Math.pow(Math.max(p.q, 0.002), 0.5));
          top.push([x, 0]); bot.push([x, -t]);
        }
        bot.reverse();
      }
      el('path', { d: pathD(top.concat(bot)), class: nT ? 'tx-inv-e' : 'tx-inv-h', 'vector-effect': 'non-scaling-stroke' }, gDev);
    } else if (reg === 'accumulation') {
      const qa = Math.abs(st.Qs) / PH.Q;
      const t = clamp(3 + 3 * Math.log10(Math.max(qa, 1e9) / 1e9), 3, 22);
      el('path', { d: pathD([[g0, 0], [g1, 0], [g1, -t], [g0, -t]]), class: nT ? 'tx-inv-h' : 'tx-inv-e', 'vector-effect': 'non-scaling-stroke' }, gDev);
    }

    if (!dev.fitted) {
      base = fitFor({ x0: -40, x1: DG.W + 40, z0: -DG.body * 0.82, z1: DG.tox + DG.Hg + 150 });
      goTo(base, 0);
      dev.fitted = true;
    } else applyView();
  }

  function drawDeviceOverlay() {
    const { o, ch, st, I, nT } = dev;
    const geo = dev.geo;
    const label = (text, x, z, dx, dy, cls) => {
      const [sx, sy] = toScreen(x, z);
      const g = el('g', { class: 'tx-label ' + (cls || '') }, gScreen);
      const w = measure(text, 12) + 12;
      el('line', { x1: sx, y1: sy, x2: sx + dx + (dx < 0 ? w : 0), y2: sy + dy + 10 }, g);
      el('rect', { x: sx + dx, y: sy + dy, width: w, height: 20, rx: 5 }, g);
      const t = el('text', { x: sx + dx + 6, y: sy + dy + 14 }, g);
      t.textContent = text;
    };
    // Short names when the device is drawn small (a phone with the sheet open).
    const tight = DG.W * view.s < 520;
    const term = (name, v, x, z) => {
      if (tight) name = name.charAt(0);
      const [sx, sy] = toScreen(x, z);
      el('line', { x1: sx, y1: sy, x2: sx, y2: sy - 34, class: 'tx-wire' }, gScreen);
      el('circle', { cx: sx, cy: sy - 38, r: 4, class: 'tx-term' }, gScreen);
      const t = el('text', { x: sx, y: sy - 48, class: 'tx-termtext', 'text-anchor': 'middle' }, gScreen);
      t.textContent = name + ' = ' + v.toFixed(2) + ' V';
    };
    const vgDisp = o.vg, vdDisp = o.variant === 'moscap' ? 0 : o.vd;
    term('Gate', vgDisp, (geo.g0 + geo.g1) / 2, DG.tox + DG.Hg);
    if (o.variant !== 'moscap') {
      term('Source', 0, 90 + DG.cW / 2, 70);
      term('Drain', vdDisp, DG.W - 90 - DG.cW / 2, 70);
    }
    // Body contact at the bottom.
    const [bx, by] = toScreen(DG.W / 2, -DG.body * 0.82);
    const bt = el('text', { x: bx, y: by - 8, class: 'tx-termtext', 'text-anchor': 'middle' }, gScreen);
    bt.textContent = 'Body = 0 V (' + (nT ? 'p-type' : 'n-type') + ')';

    // Region captions.
    const reg = st.regime;
    const inv = (nT ? 1 : -1) * st.psiS > 0;
    const mid = (geo.g0 + geo.g1) / 2;
    if (o.variant !== 'moscap') {
      if (ch.sat && inv && reg === 'strong inversion') {
        const xp = lerp(DG.gl, DG.gr, ch.pinch);
        label('Pinch-off', xp, -6, 18, 26, 'tx-label-new');
      }
      label(nT ? 'n⁺ source' : 'p⁺ source', DG.gl * 0.45, -DG.Xj * 0.55, -40, 50);
      label(nT ? 'n⁺ drain' : 'p⁺ drain', DG.W - DG.gl * 0.45, -DG.Xj * 0.55, 0, 50);
    }
    if (st.W > 0.5) label('Depletion region · ' + st.W.toFixed(0) + ' nm', mid - 120, -clamp(st.W / Math.max(5, o.cap.Wmax / PH.NM), 0, 1.9) * DG.Xj * 0.75 * 0.6, -170, 40);
    if (inv && reg !== 'depletion' && reg !== 'flat band') {
      const n = Math.abs(st.Qinv) / PH.Q;
      label((reg === 'strong inversion' ? 'Inversion layer · ' : 'Weak inversion · ') + sci(n) + ' ' + (nT ? 'electrons' : 'holes') + '/cm²', mid + 60, -3, 40, -2, 'tx-label-new');
    }
    if (reg === 'accumulation') label('Accumulation layer (' + (nT ? 'holes' : 'electrons') + ')', mid + 60, -3, 40, -2, 'tx-label-new');
    // Regime badge and current.
    const [lx, ly] = toScreen(0, DG.tox + DG.Hg + 120);
    let badge = reg.charAt(0).toUpperCase() + reg.slice(1);
    if (o.variant !== 'moscap' && reg === 'strong inversion') badge = ch.sat ? 'On: saturation' : 'On: linear (triode)';
    if (o.variant !== 'moscap' && (reg === 'weak inversion' || reg === 'depletion')) badge = reg === 'weak inversion' ? 'Subthreshold (barely on)' : 'Off: depletion';
    if (o.variant !== 'moscap' && reg === 'accumulation') badge = 'Off: accumulation';
    pill(badge, lx, ly, 'tx-pill-state');
    if (o.variant !== 'moscap') {
      const s = (tight ? '' : 'Drain current ') + fmtI(I / Math.max(1e-9, o.device.p.W)) + '/µm';
      pill(s, lx + measure(badge, 12, true) + 26, ly, 'tx-pill-current');
    }

    // Carriers.
    const [x0s, ysurf] = toScreen(DG.gl, 0);
    const [x1s] = toScreen(DG.gr, 0);
    const gp = el('g', { class: nT ? 'tx-carriers-e' : 'tx-carriers-h' }, gScreen);
    for (const p of particles) {
      const xs = lerp(x0s, x1s, p.s);
      const deep = p.s > (ch ? ch.pinch : 1) ? (p.s - ch.pinch) / Math.max(0.02, 1 - ch.pinch) : 0;
      const ys = ysurf + 2 + p.d * 5 + deep * 22 * p.d2;
      el('circle', { cx: xs, cy: ys, r: 2.6 }, gp);
    }
  }

  function sci(n) {
    if (!(n > 0)) return '0';
    const e = Math.floor(Math.log10(n));
    const m = n / Math.pow(10, e);
    const sup = String(e).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c] || (c === '-' ? '⁻' : c)).join('');
    return m.toFixed(1) + '×10' + sup;
  }
  function fmtI(a) {
    if (a >= 1e-3) return (a * 1e3).toFixed(2) + ' mA';
    if (a >= 1e-6) return (a * 1e6).toFixed(a >= 1e-4 ? 0 : 1) + ' µA';
    if (a >= 1e-9) return (a * 1e9).toFixed(1) + ' nA';
    if (a >= 1e-12) return (a * 1e12).toFixed(1) + ' pA';
    return (a * 1e15).toFixed(1) + ' fA';
  }

  // Carriers drift source -> drain at a speed that follows the current
  // (log-compressed); how many there are follows the channel charge.
  function stepParticles(dt) {
    if (!dev || dev.o.variant === 'moscap' || !dev.ch) { particles = []; return; }
    const I = dev.I / Math.max(1e-9, dev.o.device.p.W);
    const on = I > 1e-9;
    const target = on ? Math.round(clamp(8 + 5 * Math.log10(I / 1e-9), 4, 48)) : 0;
    while (particles.length < target) particles.push({ s: Math.random(), d: Math.random(), d2: Math.random() });
    if (particles.length > target) particles.length = target;
    const speed = on ? clamp(0.05 + 0.09 * Math.log10(I / 1e-9), 0.03, 0.6) : 0;
    for (const p of particles) {
      p.s += speed * dt * (0.8 + 0.4 * p.d2);
      if (p.s > 1) { p.s -= 1; p.d = Math.random(); p.d2 = Math.random(); }
    }
  }

  /* ------------------------------------------------------------------------
   * Loop, sizing, API
   * --------------------------------------------------------------------- */

  let raf = 0, last = performance.now(), running = true;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (tween) tween(now);
    if (mode === 'device' && dev) { stepParticles(dt); if (!tween) drawOverlay(); }
    if (running) raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  function resize() {
    const r = host.getBoundingClientRect();
    box = { w: r.width, h: r.height };
    svg.setAttribute('width', r.width);
    svg.setAttribute('height', r.height);
    if (mode === 'process' && current) {
      base = fitFor(current.geo.bounds);
      if (!user) goTo(base, 0); else applyView();
    } else if (mode === 'device' && dev) {
      base = fitFor({ x0: -40, x1: DG.W + 40, z0: -DG.body * 0.82, z1: DG.tox + DG.Hg + 150 });
      goTo(base, 0);
    }
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    showStep(i, opts) {
      if (mode !== 'process') { mode = 'process'; if (gDev) { gDev.remove(); gDev = null; } dev = null; zoomKey = null; user = false; }
      renderProcess(i, opts);
    },
    showDevice(o) {
      if (mode !== 'device') {
        mode = 'device';
        if (gShapes) { gShapes.remove(); gShapes = null; }
        current = null;
        dev = null;
        user = false;
      }
      const fitted = dev && dev.fitted && dev.o.variant === o.variant;
      renderDevice(o);
      if (fitted) dev.fitted = true;
    },
    setScale(k) { scaleKey = k; zoomKey = null; user = false; if (mode === 'process') renderProcess(stepIdx, { animate: false }); },
    get scale() { return scaleKey; },
    setLabels(m) { labelMode = m; drawOverlay(); },
    get labels() { return labelMode; },
    setInsets(i) { insets = Object.assign({}, insets, i); resize(); },
    fit() { user = false; goTo(base); },
    resize,
    get mode() { return mode; },
    get step() { return stepIdx; },
    visible(on) { svg.style.display = on ? '' : 'none'; },
    destroy() { running = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); svg.remove(); },
  };
}

TR.xsection = { createXSection };
})(window.Transistors);
