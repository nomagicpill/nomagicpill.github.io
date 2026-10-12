/*
 * Figures and calculators for knowledge/draftblockchain.html.
 *
 * Each widget mounts into a <div data-widget="name"> inside a topic when the
 * topic opens and is destroyed when it closes, so only what is on screen
 * runs. All the cryptography is real (crypto.js); the live widgets read the
 * running network (model.js) through ctx.model. Colours come from CSS tokens
 * and are re-read on every draw, so figures follow the theme toggle.
 * Becomes Blockchain.widgets.
 */
(function (BC) {
'use strict';
const { cssVar } = window.Explainer;
const C = BC.crypto;
const WORDS = BC.words;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const COIN = 100000000;
const fmtCoins = (sats) => { const c = sats / COIN; return c >= 100 ? c.toFixed(0) : c >= 10 ? c.toFixed(1) : c >= 1 ? c.toFixed(2) : c.toFixed(3); };

/* ----------------------------------------------------------------------------
 * Registry, events, ticking
 * ------------------------------------------------------------------------- */

const REG = {};
let active = [];
const shared = { phrase: null };

function mount(type, el, ctx) {
  const make = REG[type];
  if (!make) return null;
  el.innerHTML = '';
  let w;
  try { w = make(el, ctx) || {}; } catch (e) { console.error(e); return null; }
  active.push(w);
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

let slowAcc = 0;
function tick(dt, ctx) {
  slowAcc += dt;
  for (const w of active) if (w.tick) w.tick(dt, ctx);
  if (slowAcc > 0.5) {
    slowAcc = 0;
    for (const w of active) if (w.slow) w.slow(ctx);
  }
}

/* ----------------------------------------------------------------------------
 * Helpers
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

function button(label, onClick, cls = 'xp-btn') {
  const b = el('button', { class: cls, type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

function chips(options, value, onPick) {
  const wrap = el('div', { class: 'xp-controls', role: 'group' });
  const bs = options.map(([v, label]) => {
    const b = el('button', { class: 'xp-chip', type: 'button', 'aria-pressed': String(v === value) }, label);
    b.addEventListener('click', () => {
      bs.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onPick(v);
    });
    wrap.appendChild(b);
    return b;
  });
  return wrap;
}

function range(min, max, step, value) {
  const r = el('input', { type: 'range', min, max, step });
  r.value = String(value);
  return r;
}

function field(label, input, out) {
  const f = el('div', { class: 'xp-field' });
  const l = el('label');
  l.append(document.createTextNode(label + ' '));
  if (out) l.appendChild(out);
  f.append(l, input);
  return f;
}

function ink() {
  return {
    text: cssVar('--text'), ink2: cssVar('--xp-ink-2'), ink3: cssVar('--xp-ink-3'), grid: cssVar('--xp-grid'),
    axis: cssVar('--xp-axis'), bg: cssVar('--xp-chart-bg'), link: cssVar('--link'), track: cssVar('--xp-track'),
    good: cssVar('--xp-good-mark'), warn: cssVar('--xp-warn-mark'), bad: cssVar('--xp-critical-mark'),
    a: cssVar('--bc-a'), b: cssVar('--bc-b'), c: cssVar('--bc-c'), d: cssVar('--bc-d'), e: cssVar('--bc-e'),
  };
}

function canvas(parent, h, cls) {
  const c = el('canvas', { class: cls || 'bc-canvas' });
  c.style.height = h + 'px';
  parent.appendChild(c);
  return c;
}

function ctx2d(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (w < 8 || h < 8) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = '11px Arial, sans-serif';
  g.textBaseline = 'middle';
  return { g, w, h };
}

// 1234567 -> "1.23 M"
function si(x) {
  const u = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
  let i = 0;
  while (Math.abs(x) >= 1000 && i < u.length - 1) { x /= 1000; i++; }
  return (x >= 100 || i === 0 ? Math.round(x) : x.toFixed(x >= 10 ? 1 : 2)) + (u[i] ? ' ' + u[i] : ' ');
}

// 3.4e38 -> "3.4 × 10³⁸"
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function sci(x, d = 1) {
  if (!isFinite(x)) return '∞';
  if (x !== 0 && (Math.abs(x) >= 1e6 || Math.abs(x) < 1e-3)) {
    const e = Math.floor(Math.log10(Math.abs(x)));
    const m = x / Math.pow(10, e);
    return m.toFixed(d) + ' × 10' + String(e).split('').map((ch) => SUP[ch]).join('');
  }
  return x.toLocaleString(undefined, { maximumFractionDigits: d });
}

const sup = (n) => String(n).split('').map((ch) => SUP[ch]).join('');

function mono(text, cls = 'bc-mono') { return el('code', { class: cls }, text); }

function hexWithZeros(hash, cls = 'bc-mono') {
  const c = el('code', { class: cls });
  const z = hash.match(/^0*/)[0];
  const b = el('b', { class: 'bc-zeros' }, z);
  c.append(b, document.createTextNode(hash.slice(z.length)));
  return c;
}

function statusLine(ok, text, detail) {
  const p = el('div', { class: 'bc-check' });
  const s = el('span', { class: 'xp-status', 'data-level': ok ? '0' : '4' }, ok ? 'Pass' : 'Fail');
  p.append(s, document.createTextNode(' ' + text));
  if (detail) p.appendChild(el('small', {}, detail));
  return p;
}

function kv(rows) {
  const t = el('table', { class: 'bc-kv' });
  for (const [k, v] of rows) {
    const tr = el('tr');
    tr.appendChild(el('th', {}, k));
    const td = el('td');
    if (v instanceof Node) td.appendChild(v); else td.textContent = v;
    tr.appendChild(td);
    t.appendChild(tr);
  }
  return t;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

// A hover tooltip for a canvas chart: fn(x, y, w, h) returns the text for the
// mark under the pointer (CSS pixels), or null. Touch shows it on tap.
function hover(c, fn) {
  const tip = el('div', { class: 'bc-tip' });
  tip.hidden = true;
  c.insertAdjacentElement('afterend', tip);
  const show = (e) => {
    const r = c.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const t = fn(x, y, r.width, r.height);
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t;
    tip.hidden = false;
    tip.style.left = clamp(c.offsetLeft + x + 12, 0, c.offsetLeft + r.width - 170) + 'px';
    tip.style.top = (c.offsetTop + y + 14) + 'px';
  };
  c.addEventListener('pointermove', show);
  c.addEventListener('pointerdown', show);
  c.addEventListener('pointerleave', () => { tip.hidden = true; });
}

/* ----------------------------------------------------------------------------
 * HUD: the gaps between recent blocks, or proof-of-stake slots
 * ------------------------------------------------------------------------- */

function drawIntervals(c, intervals, blockTime, slots) {
  const r = ctx2d(c);
  if (!r) return;
  const { g, w, h } = r;
  const k = ink();
  if (slots) {
    const n = slots.length, gap = 2, bw = (w - gap * (n - 1)) / n;
    slots.forEach((s, i) => {
      g.fillStyle = s ? k.link : 'transparent';
      g.strokeStyle = s ? k.link : k.axis;
      g.fillRect(i * (bw + gap), 4, bw, h - 8);
      if (!s) g.strokeRect(i * (bw + gap) + 0.5, 4.5, bw - 1, h - 9);
    });
    return;
  }
  const list = (intervals || []).slice(-28);
  const max = blockTime * 3.5;
  const n = 28, gap = 2, bw = (w - gap * (n - 1)) / n;
  list.forEach((v, i) => {
    const bh = Math.max(2, (Math.min(v, max) / max) * (h - 2));
    g.fillStyle = k.link;
    g.fillRect((n - list.length + i) * (bw + gap), h - bh, bw, bh);
  });
  const y = h - (blockTime / max) * (h - 2);
  g.strokeStyle = k.ink3;
  g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke();
  g.setLineDash([]);
}

/* ============================================================================
 * Hashing
 * ========================================================================= */

REG.hash = (host) => {
  const input = el('textarea', { class: 'bc-input', rows: '2', 'aria-label': 'Text to hash' });
  input.value = 'Ana pays Ben 5 coins';
  const out = el('div', { class: 'bc-hashout' });
  const grid = canvas(host, 76);
  const note = el('p', { class: 'xp-caption' });
  const ctl = el('div', { class: 'xp-controls' });
  ctl.append(
    button('Change one character', () => {
      const s = input.value || 'a';
      const i = Math.floor(Math.random() * s.length);
      const ch = s.charCodeAt(i);
      input.value = s.slice(0, i) + String.fromCharCode(ch === 122 ? 97 : ch + 1) + s.slice(i + 1);
      update();
    }, 'xp-chip'),
    button('Start over', () => { input.value = 'Ana pays Ben 5 coins'; prev = null; update(); }, 'xp-chip'),
  );
  host.prepend(input, ctl, out);
  host.appendChild(note);
  let prev = null, cur = null;

  function update() {
    const h = C.sha256(C.utf8(input.value));
    if (cur && C.hex(cur) !== C.hex(h)) prev = cur;
    cur = h;
    out.innerHTML = '';
    out.append(el('span', { class: 'bc-label' }, 'SHA-256'), mono(C.hex(h), 'bc-mono bc-break'));
    draw();
  }

  function draw() {
    const r = ctx2d(grid);
    if (!r || !cur) return;
    const { g, w, h } = r;
    const k = ink();
    const cols = 64, rows = 4, cw = w / cols, chh = h / rows;
    let changed = 0;
    for (let i = 0; i < 256; i++) {
      const bit = (cur[i >> 3] >> (7 - (i & 7))) & 1;
      const pbit = prev ? (prev[i >> 3] >> (7 - (i & 7))) & 1 : bit;
      const diff = bit !== pbit;
      if (diff) changed++;
      const x = (i % cols) * cw, y = Math.floor(i / cols) * chh;
      g.fillStyle = diff ? k.warn : bit ? k.text : k.track;
      g.fillRect(x + 0.5, y + 0.5, cw - 1, chh - 1);
    }
    note.textContent = prev
      ? `The 256 output bits, one square each. ${changed} of them (${Math.round(changed / 2.56)}%) flipped compared with the previous text, highlighted. Any change, however small, scrambles about half.`
      : 'The 256 output bits, one square each (dark = 1). Change the text and the bits that flip are highlighted.';
  }

  input.addEventListener('input', update);
  update();
  return { on(t) { if (t === 'theme') draw(); } };
};

/* ============================================================================
 * Keys
 * ========================================================================= */

REG.keys = (host) => {
  const ctl = el('div', { class: 'xp-controls' });
  const out = el('div');
  const keyIn = el('textarea', { class: 'bc-input bc-mono bc-keyin', rows: '2', spellcheck: 'false', 'aria-label': 'Private key in hex (edit it to try your own number)', placeholder: '64 hex digits' });
  ctl.append(
    button('Make a new key', () => { show(C.randomPrivateKey()); }, 'xp-btn xp-primary'),
    button('Try the private key 1', () => { show(1n); }, 'xp-chip'),
  );
  host.append(ctl, out);
  keyIn.addEventListener('change', () => {
    const h = keyIn.value.trim().replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{1,64}$/.test(h)) return;
    const d = BigInt('0x' + h);
    if (d > 0n && d < C.N) show(d);
  });

  function show(d) {
    const t0 = performance.now();
    const k = C.keyInfo(d);
    const ms = performance.now() - t0;
    keyIn.value = d.toString(16).padStart(64, '0');
    out.innerHTML = '';
    const step = (title, body, arrow) => {
      const s = el('div', { class: 'bc-step' });
      s.appendChild(el('div', { class: 'bc-step-title' }, title));
      for (const b of body) s.appendChild(b);
      out.appendChild(s);
      if (arrow) out.appendChild(el('div', { class: 'bc-arrow' }, '↓ ' + arrow));
    };
    const digits = d.toString().length;
    step('Private key: a random whole number, ' + digits + ' digits long', [keyIn, el('small', {}, 'In decimal: ' + (digits > 20 ? d.toString().slice(0, 12) + '… (' + digits + ' digits)' : d.toString()))],
      'multiply the curve’s starting point G by it (easy)');
    step('Public key: a point (x, y) on the curve', [
      kv([['x', mono(k.pub.x.toString(16).padStart(64, '0'), 'bc-mono bc-break')], ['y', mono(k.pub.y.toString(16).padStart(64, '0'), 'bc-mono bc-break')],
        ['Compressed', mono(C.hex(k.pubC), 'bc-mono bc-break')]]),
    ], 'hash it (one-way again)');
    step('Addresses: what you give people', [
      kv([['Bitcoin', mono(k.btc, 'bc-mono bc-break')], ['Bitcoin (legacy)', mono(k.btcLegacy, 'bc-mono bc-break')], ['Ethereum', mono(k.eth, 'bc-mono bc-break')]]),
      el('small', {}, `Computed in ${ms.toFixed(1)} ms. Going the other way, from address or public key back to the private key, has no known shortcut: the best methods need about 2¹²⁸ steps.`),
    ]);
    if (d === 1n) out.appendChild(el('p', { class: 'xp-note' }, 'Private key 1 is the smallest possible, and its addresses are real. People have sent coins to them over the years, and automated sweepers take the coins within seconds, because anyone can compute this key.'));
  }
  show(C.randomPrivateKey());
  return {};
};

/* ============================================================================
 * Elliptic curve over the real numbers
 * ========================================================================= */

REG.curve = (host) => {
  const c = canvas(host, 300, 'bc-canvas bc-drag');
  const read = el('div', { class: 'bc-readout' });
  let mode = 'add';
  const ctl = chips([['add', 'P + Q'], ['double', 'P + P']], 'add', (v) => { mode = v; draw(); });
  host.prepend(ctl);
  host.appendChild(read);
  host.appendChild(el('p', { class: 'xp-caption' }, 'y² = x³ + 7, the shape of Bitcoin’s curve, drawn over ordinary numbers. Drag P and Q along it. The line through them meets the curve at exactly one more point; flip that point across the x-axis and you have P + Q.'));
  const X0 = -Math.cbrt(7);
  const pts = { P: { x: -1.2, s: 1 }, Q: { x: 1.4, s: -1 } };
  const yOf = (p) => p.s * Math.sqrt(Math.max(0, p.x ** 3 + 7));
  let drag = null;
  const view = { x0: -3, x1: 6, y0: -13, y1: 13 };

  function add(P, Q) {
    let m;
    if (Math.abs(P.x - Q.x) < 1e-9) {
      if (Math.abs(P.y + Q.y) < 1e-9) return null;
      m = (3 * P.x * P.x) / (2 * P.y);
    } else m = (Q.y - P.y) / (Q.x - P.x);
    const x = m * m - P.x - Q.x;
    const y = m * (P.x - x) - P.y;
    return { x, y, m };
  }

  function draw() {
    const r = ctx2d(c);
    if (!r) return;
    const { g, w, h } = r;
    const k = ink();
    const sx = (x) => ((x - view.x0) / (view.x1 - view.x0)) * w;
    const sy = (y) => h - ((y - view.y0) / (view.y1 - view.y0)) * h;
    g.strokeStyle = k.grid;
    g.beginPath(); g.moveTo(0, sy(0)); g.lineTo(w, sy(0)); g.moveTo(sx(0), 0); g.lineTo(sx(0), h); g.stroke();
    g.strokeStyle = k.text;
    g.lineWidth = 2;
    for (const s of [1, -1]) {
      g.beginPath();
      for (let i = 0; i <= 400; i++) {
        const x = X0 + (view.x1 - X0) * Math.pow(i / 400, 1.6);
        const y = s * Math.sqrt(Math.max(0, x ** 3 + 7));
        if (i === 0) g.moveTo(sx(x), sy(y)); else g.lineTo(sx(x), sy(y));
      }
      g.stroke();
    }
    g.lineWidth = 1;
    const P = { x: pts.P.x, y: yOf(pts.P) };
    const Q = mode === 'double' ? P : { x: pts.Q.x, y: yOf(pts.Q) };
    const R = add(P, Q);
    if (R) {
      g.strokeStyle = k.ink3;
      g.beginPath();
      g.moveTo(sx(view.x0), sy(P.y + R.m * (view.x0 - P.x)));
      g.lineTo(sx(view.x1), sy(P.y + R.m * (view.x1 - P.x)));
      g.stroke();
      g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(sx(R.x), sy(-R.y)); g.lineTo(sx(R.x), sy(R.y)); g.stroke();
      g.setLineDash([]);
      dot(g, sx(R.x), sy(-R.y), k.ink3, '', false);
      dot(g, sx(R.x), sy(R.y), k.warn, mode === 'double' ? '2P' : 'P + Q', true);
    }
    dot(g, sx(P.x), sy(P.y), k.link, 'P', true);
    if (mode !== 'double') dot(g, sx(Q.x), sy(Q.y), k.link, 'Q', true);
    read.textContent = R
      ? `P = (${P.x.toFixed(2)}, ${P.y.toFixed(2)})${mode === 'double' ? '' : `, Q = (${Q.x.toFixed(2)}, ${Q.y.toFixed(2)})`}  →  ${mode === 'double' ? '2P' : 'P + Q'} = (${R.x.toFixed(2)}, ${R.y.toFixed(2)})`
      : 'The line is vertical: P + Q is the "point at infinity", the curve’s zero.';
  }

  function dot(g, x, y, col, label, big) {
    g.fillStyle = col;
    g.beginPath(); g.arc(x, y, big ? 6 : 4, 0, Math.PI * 2); g.fill();
    if (label) { g.fillStyle = cssVar('--text'); g.font = 'bold 12px Arial, sans-serif'; g.fillText(label, x + 9, y - 10); g.font = '11px Arial, sans-serif'; }
  }

  function toCurve(e) {
    const rc = c.getBoundingClientRect();
    const x = view.x0 + ((e.clientX - rc.left) / rc.width) * (view.x1 - view.x0);
    const y = view.y1 - ((e.clientY - rc.top) / rc.height) * (view.y1 - view.y0);
    return { x: clamp(x, X0 + 1e-4, view.x1 - 0.2), s: y >= 0 ? 1 : -1 };
  }
  c.addEventListener('pointerdown', (e) => {
    const p = toCurve(e);
    const rc = c.getBoundingClientRect();
    const near = (k) => {
      const px = ((pts[k].x - view.x0) / (view.x1 - view.x0)) * rc.width;
      const py = rc.height - ((yOf(pts[k]) - view.y0) / (view.y1 - view.y0)) * rc.height;
      return Math.hypot(px - (e.clientX - rc.left), py - (e.clientY - rc.top));
    };
    drag = mode === 'double' || near('P') <= near('Q') ? 'P' : 'Q';
    Object.assign(pts[drag], p);
    c.setPointerCapture(e.pointerId);
    draw();
  });
  c.addEventListener('pointermove', (e) => { if (drag) { Object.assign(pts[drag], toCurve(e)); draw(); } });
  c.addEventListener('pointerup', () => { drag = null; });
  draw();
  return { on(t) { if (t === 'theme') draw(); } };
};

/* ============================================================================
 * The same curve over a finite field, and the discrete log problem
 * ========================================================================= */

const FP = 163;
const fmod = (a) => ((a % FP) + FP) % FP;
const finv = (a) => { let r = 1, b = fmod(a), e = FP - 2; while (e) { if (e & 1) r = (r * b) % FP; b = (b * b) % FP; e >>= 1; } return r; };
function fadd(P, Q) {
  if (!P) return Q;
  if (!Q) return P;
  if (P.x === Q.x && fmod(P.y + Q.y) === 0) return null;
  const m = P.x === Q.x && P.y === Q.y ? fmod(3 * P.x * P.x * finv(2 * P.y)) : fmod((Q.y - P.y) * finv(Q.x - P.x));
  const x = fmod(m * m - P.x - Q.x);
  return { x, y: fmod(m * (P.x - x) - P.y) };
}
const FPOINTS = [];
for (let x = 0; x < FP; x++) for (let y = 0; y < FP; y++) if (fmod(y * y - x * x * x - 7) === 0) FPOINTS.push({ x, y });
const FN = FPOINTS.length + 1;     // group order, counting the point at infinity
const FG = FPOINTS.find((p) => p.x >= 5);
const FMULT = [null, FG];
for (let i = 2; i < FN; i++) FMULT.push(fadd(FMULT[i - 1], FG));

REG.field = (host) => {
  const c = canvas(host, 300, 'bc-canvas');
  const kOut = el('output');
  const kIn = range(1, FN - 1, 1, 7);
  const read = el('div', { class: 'bc-readout' });
  host.prepend(field('k', kIn, kOut));
  host.append(read);
  const game = el('div', { class: 'bc-game' });
  host.append(game);
  let secret = null, tries = 0, searching = false, found = false;

  function draw() {
    const r = ctx2d(c);
    if (!r) return;
    const { g, w, h } = r;
    const k = ink();
    const pad = 8, s = Math.min(w - pad * 2, h - pad * 2) / FP;
    const ox = (w - s * FP) / 2;
    const px = (p) => ox + (p.x + 0.5) * s, py = (p) => h - pad - (p.y + 0.5) * s;
    g.strokeStyle = k.grid;
    g.strokeRect(ox, pad, s * FP, s * FP);
    g.fillStyle = k.ink3;
    for (const p of FPOINTS) { g.beginPath(); g.arc(px(p), py(p), 1.8, 0, Math.PI * 2); g.fill(); }
    const kk = Number(kIn.value);
    g.strokeStyle = k.link;
    g.globalAlpha = 0.35;
    g.beginPath();
    for (let i = 1; i <= kk; i++) {
      const p = FMULT[i];
      if (!p) continue;
      if (i === 1) g.moveTo(px(p), py(p)); else g.lineTo(px(p), py(p));
    }
    g.stroke();
    g.globalAlpha = 1;
    const mark = (p, col, label) => {
      if (!p) return;
      g.fillStyle = col;
      g.beginPath(); g.arc(px(p), py(p), 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = k.text;
      g.font = 'bold 11px Arial, sans-serif';
      g.fillText(label, px(p) + 7, py(p) - 8);
      g.font = '11px Arial, sans-serif';
    };
    mark(FG, k.link, 'G');
    mark(FMULT[kk], k.warn, kk + 'G');
    if (secret !== null) {
      mark(FMULT[secret], k.bad, 'Q');
      if (searching || found) mark(FMULT[tries], k.good, tries + 'G');
    }
    kOut.textContent = String(kk);
    const p = FMULT[kk];
    read.textContent = `${kk} × G = ${p ? `(${p.x}, ${p.y})` : 'the point at infinity'}. The faint line joins G, 2G, 3G, … ${kk}G in order: each step lands somewhere unpredictable.`;
  }

  function renderGame() {
    game.innerHTML = '';
    const ctl = el('div', { class: 'xp-controls' });
    if (secret === null) {
      ctl.append(button('Hide a secret k', () => { secret = 2 + Math.floor(Math.random() * (FN - 3)); tries = 0; found = false; renderGame(); draw(); }, 'xp-btn xp-primary'));
      game.append(ctl, el('p', { class: 'xp-caption' }, 'Hide a secret number k and the figure shows only Q = k × G. Then try to find k.'));
      return;
    }
    const msg = el('p', { class: 'xp-caption' });
    if (found) msg.textContent = `Found it: k = ${secret}, after ${tries} tries. This curve has only ${FN} points, so brute force is quick. Bitcoin’s has about 1.16 × 10⁷⁷, and the best known attacks need about 2¹²⁸ ≈ 3.4 × 10³⁸ steps. At a billion billion steps a second, that is about 10¹³ years, roughly 800 times the age of the universe.`;
    else msg.textContent = searching ? `Trying ${tries} × G…` : `Q = (${FMULT[secret].x}, ${FMULT[secret].y}). Which k makes k × G land there? There is no pattern to follow: the only general method is to try them.`;
    if (!found && !searching) ctl.append(button('Search by brute force', search, 'xp-btn xp-primary'));
    ctl.append(button('Hide a new secret', () => { secret = 2 + Math.floor(Math.random() * (FN - 3)); tries = 0; found = false; searching = false; renderGame(); draw(); }, 'xp-chip'));
    game.append(ctl, msg);
  }

  async function search() {
    searching = true;
    while (searching && tries < secret) {
      tries++;
      draw();
      renderGame();
      await new Promise((r) => setTimeout(r, Math.max(8, 60 - tries)));
    }
    if (!searching) return;
    searching = false;
    found = true;
    renderGame();
    draw();
  }

  kIn.addEventListener('input', draw);
  renderGame();
  draw();
  return { on(t) { if (t === 'theme') draw(); }, destroy() { searching = false; } };
};

/* ============================================================================
 * Signatures
 * ========================================================================= */

REG.sign = (host) => {
  const ana = C.keyInfo(C.randomPrivateKey());
  const mal = C.keyInfo(C.randomPrivateKey());
  const msg = el('input', { class: 'bc-input', type: 'text', 'aria-label': 'Message to sign' });
  msg.value = 'Pay Ben 5 coins from my address. Signed, Ana';
  const sigBox = el('div');
  const ver = el('div');
  const vMsg = el('input', { class: 'bc-input', type: 'text', 'aria-label': 'Message to verify' });
  let sig = null, signedHash = null, verifyWith = 'ana';
  host.append(
    el('div', { class: 'bc-label' }, 'Ana’s message'), msg,
    el('div', { class: 'xp-controls' }, ''),
    sigBox,
    el('div', { class: 'bc-label', style: 'margin-top:12px' }, 'What a node receives, and checks'), vMsg,
    chips([['ana', 'Check against Ana’s public key'], ['mal', 'against Mallory’s']], 'ana', (v) => { verifyWith = v; check(); }),
    ver,
  );
  host.children[2].append(button('Sign with Ana’s private key', doSign, 'xp-btn xp-primary'));

  function doSign() {
    const t0 = performance.now();
    signedHash = C.sha256(C.utf8(msg.value));
    sig = C.sign(signedHash, ana.d);
    const ms = performance.now() - t0;
    vMsg.value = msg.value;
    sigBox.innerHTML = '';
    sigBox.append(kv([
      ['Message hash', mono(C.hex(signedHash), 'bc-mono bc-break')],
      ['Signature r', mono(sig.r.toString(16).padStart(64, '0'), 'bc-mono bc-break')],
      ['Signature s', mono(sig.s.toString(16).padStart(64, '0'), 'bc-mono bc-break')],
    ]), el('small', {}, `Signed in ${ms.toFixed(1)} ms. The signature is two numbers that depend on the private key and on every bit of the message.`));
    check();
  }

  function check() {
    ver.innerHTML = '';
    if (!sig) { ver.append(el('p', { class: 'xp-caption' }, 'Sign the message first.')); return; }
    const t0 = performance.now();
    const ok = C.verify(C.sha256(C.utf8(vMsg.value)), sig, (verifyWith === 'ana' ? ana : mal).pub);
    const ms = performance.now() - t0;
    const why = ok ? 'The signature fits this message and this public key. Only Ana’s private key could have made it.'
      : vMsg.value !== msg.value ? 'The message was changed after signing, so the signature no longer fits it.'
        : 'This signature was not made with Mallory’s key, so it fails against his public key.';
    ver.append(statusLine(ok, ok ? 'Valid signature' : 'Invalid signature', `${why} (checked in ${ms.toFixed(1)} ms, without ever seeing the private key)`));
  }

  vMsg.addEventListener('input', check);
  doSign();
  return {};
};

REG.reuse = (host) => {
  const out = el('div');
  host.append(el('div', { class: 'xp-controls' }, ''), out);
  host.firstChild.append(button('Sign two messages with the same k', run, 'xp-btn xp-primary'));
  function run() {
    const key = C.keyInfo(C.randomPrivateKey());
    const k = C.randomPrivateKey();
    const m1 = 'Pay Ben 1 coin', m2 = 'Pay Chen 2 coins';
    const h1 = C.sha256(C.utf8(m1)), h2 = C.sha256(C.utf8(m2));
    const a = C.sign(h1, key.d, { k, lowS: false }), b = C.sign(h2, key.d, { k, lowS: false });
    const z1 = C.bits2int(h1), z2 = C.bits2int(h2);
    const rec = C.recoverFromReusedK(z1, a.s, z2, b.s, a.r);
    const h = (x) => x.toString(16).padStart(64, '0').slice(0, 16) + '…';
    out.innerHTML = '';
    out.append(
      kv([['Message 1', m1], ['  r₁', mono(h(a.r))], ['  s₁', mono(h(a.s))], ['Message 2', m2], ['  r₂', mono(h(b.r))], ['  s₂', mono(h(b.s))]]),
      el('p', { class: 'xp-caption' }, 'Both signatures share the same r: a public sign that k was reused. Anyone watching can now solve two equations for two unknowns:'),
      el('div', { class: 'bc-formula' }, 'k = (z₁ − z₂) ÷ (s₁ − s₂)    then    private key = (s₁·k − z₁) ÷ r'),
      kv([['Recovered k', mono(h(rec.k))], ['Recovered private key', mono(h(rec.d))], ['Actual private key', mono(h(key.d))]]),
      statusLine(rec.d === key.d, rec.d === key.d ? 'The private key is exposed.' : 'Recovery failed (should not happen).', 'All arithmetic is modulo the curve’s order n; z is each message’s hash.'),
    );
  }
  run();
  return {};
};

/* ============================================================================
 * Live: a wallet's coins and a payment (transactions topic)
 * ========================================================================= */

REG.utxo = (host, ctx) => {
  const M = ctx.model;
  if (!M) return {};
  const coinsBox = el('div');
  const form = el('div', { class: 'bc-form' });
  const preview = el('div');
  const toSel = el('select', { 'aria-label': 'Pay to' });
  for (const n of M.nodes) if (n.id !== 'ana') toSel.appendChild(el('option', { value: n.id }, n.name));
  toSel.value = 'shop';
  const amt = el('input', { class: 'bc-input bc-num', type: 'number', min: '0.001', step: '0.001', value: '0.5', 'aria-label': 'Amount in coins' });
  let urgency = 'normal';
  form.append(field('Pay to', toSel), field('Coins', amt), el('div', { class: 'xp-field' }, ''));
  form.lastChild.append(el('span', { class: 'xp-field-label' }, 'Fee'), chips([['low', 'Low'], ['normal', 'Normal'], ['high', 'High']], 'normal', (v) => { urgency = v; render(); }));
  host.append(el('div', { class: 'bc-label' }, 'Ana’s coins, as the network sees them'), coinsBox, el('div', { class: 'bc-label', style: 'margin-top:12px' }, 'A payment'), form, preview);
  let draft = null;

  function render() {
    const coins = M.coinsOf('ana');
    coinsBox.innerHTML = '';
    const t = el('table', { class: 'bc-table' });
    t.appendChild(el('tr', {}, '')).append(el('th', {}, 'Coin (unspent output)'), el('th', { class: 'xp-num' }, 'Value'));
    for (const c of coins.slice(0, 8)) {
      const tr = el('tr');
      tr.append(el('td', {}, ''), el('td', { class: 'xp-num' }, fmtCoins(c.value)));
      tr.firstChild.appendChild(mono(c.txid.slice(0, 10) + '…:' + c.vout));
      t.appendChild(tr);
    }
    if (coins.length > 8) t.appendChild(el('tr', {}, '')).appendChild(el('td', { colspan: '2' }, '… and ' + (coins.length - 8) + ' more'));
    const total = coins.reduce((a, c) => a + c.value, 0);
    const tr = el('tr', { class: 'bc-total' });
    tr.append(el('td', {}, coins.length + (coins.length === 1 ? ' coin' : ' coins') + ', total'), el('td', { class: 'xp-num' }, fmtCoins(total)));
    t.appendChild(tr);
    coinsBox.appendChild(t);

    const amount = Math.round(Number(amt.value) * COIN);
    preview.innerHTML = '';
    if (!(amount > 0)) return;
    draft = M.buildPayment('ana', toSel.value, amount, { urgency });
    if (!draft) { preview.appendChild(el('p', { class: 'xp-note' }, 'Ana doesn’t have enough unspent coins for that (coins already promised to a waiting payment don’t count).')); return; }
    const pt = el('table', { class: 'bc-table' });
    pt.appendChild(el('tr')).append(el('th', {}, 'Inputs: coins it spends'), el('th', { class: 'xp-num' }, ''));
    for (const i of draft.ins) {
      const c = coins.find((x) => x.txid === i.txid && x.vout === i.vout);
      const r = el('tr'); r.append(el('td'), el('td', { class: 'xp-num' }, c ? fmtCoins(c.value) : '?'));
      r.firstChild.appendChild(mono(i.txid.slice(0, 10) + '…:' + i.vout));
      pt.appendChild(r);
    }
    pt.appendChild(el('tr')).append(el('th', {}, 'Outputs: new coins it makes'), el('th'));
    draft.outs.forEach((o, i) => {
      const who = M.ownerOf.get(o.to);
      pt.appendChild(el('tr')).append(el('td', {}, (i === 0 ? 'to ' : 'change back to ') + (who ? M.node(who).name : '?')), el('td', { class: 'xp-num' }, fmtCoins(o.value)));
    });
    pt.appendChild(el('tr', { class: 'bc-total' })).append(el('td', {}, `Fee: ${draft.vsize} vB × ${Math.round(draft.feeRate)} sat/vB, to the miner`), el('td', { class: 'xp-num' }, draft.fee.toLocaleString() + ' sats'));
    preview.append(pt, el('p', { class: 'xp-caption' }, `Each input carries Ana’s public key and a signature over the whole transaction. Its ID: ${draft.id.slice(0, 16)}…`));
    const ctl = el('div', { class: 'xp-controls' });
    ctl.append(button('Sign and send it', () => {
      const tx = M.buildPayment('ana', toSel.value, amount, { urgency });
      if (!tx) return;
      tx.label = 'Ana’s payment';
      M.broadcast('ana', tx);
      ctx.track(tx.id);
      M.track(tx.id);
      if (ctx.scene) ctx.scene.focus('node:ana');
      render();
    }, 'xp-btn xp-primary'));
    preview.appendChild(ctl);
  }

  toSel.addEventListener('change', render);
  amt.addEventListener('change', render);
  render();
  let n = 0;
  return { slow() { if (++n % 4 === 0) render(); } };
};

/* ============================================================================
 * Live: block inspector (blocks topic)
 * ========================================================================= */

REG.inspector = (host, ctx) => {
  const M = ctx.model;
  if (!M) return {};
  let hash = ctx.selectedBlock && M.block(ctx.selectedBlock) ? ctx.selectedBlock : M.canonical.hash;
  const nav = el('div', { class: 'xp-controls' });
  const body = el('div');
  const report = el('div', { class: 'bc-report' });
  host.append(nav, body, report);
  let follow = !ctx.selectedBlock;

  function go(h, keepFollow) {
    hash = h;
    if (!keepFollow) follow = false;
    ctx.selectedBlock = h;
    render();
  }

  function render() {
    const b = M.block(hash) || M.canonical;
    nav.innerHTML = '';
    const parent = M.parentOf(b);
    const kids = (M.S.children.get(b.hash) || []).map(M.block).filter((k) => k && k.canon);
    const older = button('◀ Older', () => parent && go(parent.hash), 'xp-chip');
    older.disabled = !parent;
    const newer = button('Newer ▶', () => kids.length && go(kids[0].hash), 'xp-chip');
    newer.disabled = !kids.length;
    const newest = button('Newest', () => { follow = true; go(M.canonical.hash, true); }, 'xp-chip');
    newest.setAttribute('aria-pressed', String(follow));
    nav.append(older, newer, newest);
    body.innerHTML = '';
    const h = b.header;
    const rows = [
      ['Height', b.height.toLocaleString() + (b.canon ? '' : b.private ? ' (secret branch)' : b.forged ? ' (forged copy)' : ' (not on the main chain)')],
      ['Hash', hexWithZeros(b.hash, 'bc-mono bc-break')],
      ['Previous block', mono(h.prev, 'bc-mono bc-break')],
      ['Merkle root', mono(h.merkle, 'bc-mono bc-break')],
      ['Time', new Date(h.time * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'],
    ];
    if (b.kind === 'pow') rows.push(['Target', '0x' + h.bits.toString(16) + ' (hash must start with ' + M.knobs.zeroBits + ' zero bits)'], ['Nonce', h.nonce.toLocaleString()], ['Mined by', b.miner ? M.node(b.miner).name : 'nobody (genesis)']);
    else rows.push(['Slot', String(b.slot)], ['Proposed by', M.node(b.miner).name], ['Finality', b.finalized ? 'finalized' : b.justified ? 'justified' : 'not yet final']);
    body.appendChild(kv(rows));
    const t = el('table', { class: 'bc-table' });
    t.appendChild(el('tr')).append(el('th', {}, b.txs.length + ' transactions'), el('th', { class: 'xp-num' }, 'Fee rate'));
    for (const tx of b.txs.slice(0, 14)) {
      const tr = el('tr');
      tr.append(el('td', {}, M.describeTx(tx)), el('td', { class: 'xp-num' }, tx.coinbase !== undefined ? '' : Math.round(tx.feeRate) + ' sat/vB'));
      t.appendChild(tr);
    }
    if (b.txs.length > 14) t.appendChild(el('tr')).appendChild(el('td', { colspan: '2' }, '… and ' + (b.txs.length - 14) + ' more'));
    body.appendChild(t);
    const ctl = el('div', { class: 'xp-controls' });
    ctl.append(
      button('Verify it yourself', () => showReport(b, false), 'xp-btn xp-primary'),
      button('Tamper with it', () => showReport(b, true), 'xp-btn'),
    );
    body.appendChild(ctl);
  }

  function showReport(b, tamper) {
    report.innerHTML = '';
    let target = b, intro;
    if (tamper) {
      const pay = b.txs.find((t) => t.coinbase === undefined) || b.txs[0];
      target = M.forgeEdit(b, pay.id, null, { register: false, times: 10 });
      intro = pay.coinbase === undefined
        ? `Made the first payment (${M.describeTx(pay)}) ten times bigger, changed nothing else, and checked again:`
        : 'This block has no payments, so the miner’s reward was made ten times bigger instead, then checked again:';
    } else intro = 'Every number recomputed and every signature checked again, as a node does for each block it receives:';
    report.appendChild(el('p', { class: 'xp-caption' }, intro));
    const t0 = performance.now();
    const checks = M.verifyReport(target);
    for (const c of checks) report.appendChild(statusLine(c.ok, c.label, c.detail));
    report.appendChild(el('p', { class: 'xp-caption' }, `Done in ${(performance.now() - t0).toFixed(0)} ms.`));
  }

  render();
  return {
    on(type, data) {
      if (type === 'selectBlock') { hash = data; follow = false; report.innerHTML = ''; render(); }
      if (type === 'events' && follow && data.some((e) => e.type === 'found' || e.type === 'canonReorg')) {
        if (M.canonical.hash !== hash) { hash = M.canonical.hash; ctx.selectedBlock = hash; report.innerHTML = ''; render(); }
      }
    },
  };
};

/* ============================================================================
 * Bitcoin's genesis block
 * ========================================================================= */

REG.genesis = (host) => {
  const H = { version: 1, prev: '0'.repeat(64), merkle: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', time: 1231006505, bits: 0x1d00ffff, nonce: 2083236893 };
  const out = el('div');
  host.appendChild(out);
  let nonce = H.nonce;
  function render() {
    const hd = Object.assign({}, H, { nonce });
    const bytes = C.serializeHeader(hd);
    const hash = C.headerHash(hd);
    const ok = C.meetsTarget(hash, hd.bits);
    out.innerHTML = '';
    out.append(kv([
      ['Version', '1'],
      ['Previous block', mono('0000…0000 (there wasn’t one)')],
      ['Merkle root', mono(H.merkle, 'bc-mono bc-break')],
      ['Time', '1231006505 = 2009-01-03 18:15:05 UTC'],
      ['Target (bits)', '0x1d00ffff: hash must start with 32 zero bits'],
      ['Nonce', nonce.toLocaleString()],
    ]));
    const raw = el('div', { class: 'bc-label' }, 'The 80 bytes that get hashed');
    out.append(raw, mono(C.hex(bytes), 'bc-mono bc-break bc-small'));
    out.append(el('div', { class: 'bc-label' }, 'SHA-256, twice (shown byte-reversed, as Bitcoin does)'), hexWithZeros(hash, 'bc-mono bc-break'));
    out.append(statusLine(ok, ok ? `Meets the target, with ${C.leadingZeroBits(hash)} leading zero bits` : 'Does not meet the target',
      nonce === H.nonce ? 'This is the real hash of Bitcoin’s first block, computed just now in your browser.' : `Nonce changed by ${(nonce - H.nonce).toLocaleString()}: the hash is unrecognizable and the block is no longer valid.`));
    const ctl = el('div', { class: 'xp-controls' });
    ctl.append(
      button('Nonce − 1', () => { nonce--; render(); }, 'xp-chip'),
      button('Nonce + 1', () => { nonce++; render(); }, 'xp-chip'),
      button('The real nonce', () => { nonce = H.nonce; render(); }, 'xp-chip'),
    );
    out.appendChild(ctl);
  }
  render();
  return {};
};

/* ============================================================================
 * Merkle trees
 * ========================================================================= */

REG.merkle = (host) => {
  const base = ['Ana → Ben 0.5', 'Chen → Shop 0.02', 'Dara → Eli 1.2', 'Ben → Ana 0.3', 'Eli → Exchange 2', 'Shop → Chen 0.1', 'Mallory → Shop 0.05', 'Exchange → Dara 4'];
  const txs = base.slice();
  let prove = null;
  const svgHost = el('div', { class: 'bc-svgwrap' });
  const read = el('p', { class: 'xp-caption' });
  const ctl = el('div', { class: 'xp-controls' });
  let mode = 'tamper';
  ctl.append(chips([['tamper', 'Click to tamper'], ['prove', 'Click to prove']], 'tamper', (v) => { mode = v; prove = null; draw(); }),
    button('Reset', () => { for (let i = 0; i < 8; i++) txs[i] = base[i]; prove = null; draw(); }, 'xp-chip'));
  const list = el('ol', { class: 'bc-txlist' });
  host.append(ctl, svgHost, list, read);
  const origRoot = C.merkleRoot(base.map((t) => C.hex(C.sha256d(C.utf8(t)))));

  function draw() {
    const ids = txs.map((t) => C.hex(C.sha256d(C.utf8(t))));
    const levels = C.merkleLevels(ids);
    const W = 560, Hh = 258, rowY = [206, 146, 86, 26];
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
    svg.setAttribute('class', 'bc-svg');
    const xOf = (lvl, i) => (W / levels[lvl].length) * (i + 0.5);
    const path = new Set(), siblings = new Set();
    if (prove !== null) {
      let idx = prove;
      for (let l = 0; l < levels.length; l++) {
        path.add(l + ':' + idx);
        if (l < levels.length - 1) siblings.add(l + ':' + ((idx ^ 1) < levels[l].length ? (idx ^ 1) : idx));
        idx >>= 1;
      }
    }
    const orig = C.merkleLevels(base.map((t) => C.hex(C.sha256d(C.utf8(t)))));
    const changed = (l, i) => orig[l][i] !== levels[l][i];
    for (let l = 0; l < levels.length - 1; l++) {
      for (let i = 0; i < levels[l].length; i++) {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', xOf(l, i)); line.setAttribute('y1', rowY[l] - 14);
        line.setAttribute('x2', xOf(l + 1, i >> 1)); line.setAttribute('y2', rowY[l + 1] + 14);
        line.setAttribute('class', changed(l, i) ? 'bc-edge bc-bad' : 'bc-edge');
        svg.appendChild(line);
      }
    }
    levels.forEach((lvl, l) => lvl.forEach((h, i) => {
      const g = document.createElementNS(NS, 'g');
      const x = xOf(l, i), y = rowY[l];
      const w = l === 0 ? 62 : 80;
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x - w / 2); r.setAttribute('y', y - 13); r.setAttribute('width', w); r.setAttribute('height', 26); r.setAttribute('rx', 5);
      let cls = 'bc-node';
      if (changed(l, i)) cls += ' bc-bad';
      if (path.has(l + ':' + i)) cls += ' bc-path';
      if (siblings.has(l + ':' + i)) cls += ' bc-sib';
      r.setAttribute('class', cls);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y + 4); t.setAttribute('text-anchor', 'middle'); t.setAttribute('class', 'bc-svgtext');
      t.textContent = (l === levels.length - 1 ? 'root ' : '') + h.slice(0, 6);
      g.append(r, t);
      if (l === 0) {
        const lab = document.createElementNS(NS, 'text');
        lab.setAttribute('x', x); lab.setAttribute('y', y + 32); lab.setAttribute('text-anchor', 'middle'); lab.setAttribute('class', 'bc-svgtext');
        lab.textContent = 'Tx ' + (i + 1);
        g.appendChild(lab);
        g.style.cursor = 'pointer';
        g.addEventListener('click', () => {
          if (mode === 'tamper') { txs[i] = txs[i] === base[i] ? txs[i].replace(/[\d.]+$/, (m) => String(Number(m) * 10)) : base[i]; prove = null; }
          else prove = prove === i ? null : i;
          draw();
        });
      }
      svg.appendChild(g);
    }));
    svgHost.innerHTML = '';
    svgHost.appendChild(svg);
    list.innerHTML = '';
    txs.forEach((t, i) => {
      const li = el('li', { class: t !== base[i] ? 'bc-badtext' : prove === i ? 'bc-goodtext' : '' }, t + (t !== base[i] ? ' (changed)' : ''));
      list.appendChild(li);
    });
    const root = levels[levels.length - 1][0];
    if (prove !== null) read.textContent = `To prove "${txs[prove]}" is in the block, a phone needs only the 3 highlighted neighbouring hashes: it hashes its way up and checks it arrives at the root in the block header. With 8 transactions that is 3 hashes; with 4,000 it would be 12.`;
    else if (root !== origRoot) read.textContent = 'One changed transaction changed every hash on its path to the root. The root sits in the block header, so the block’s own hash changes too. Click the changed transaction again to undo.';
    else read.textContent = 'Each transaction is hashed; pairs of hashes are hashed together, level by level, down to a single root that goes in the block header. Click a transaction to change it, or switch to proving.';
  }
  draw();
  return {};
};

/* ============================================================================
 * A five-block chain you can edit and re-mine
 * ========================================================================= */

REG.tamperchain = (host) => {
  const ZEROS = 3;     // hex zeros required: 12 bits, about 4,096 tries
  const blocks = ['Genesis: hello', 'Ana pays Ben 5', 'Ben pays Chen 2', 'Chen pays Dara 1', 'Dara pays Eli 0.5'].map((d) => ({ data: d, nonce: 0 }));
  const wrap = el('div', { class: 'bc-chain' });
  const note = el('p', { class: 'xp-caption' });
  host.append(wrap, note);
  let busy = false;
  const hashOf = (i, prev) => C.hex(C.sha256(C.utf8(i + '|' + prev + '|' + blocks[i].data + '|' + blocks[i].nonce)));
  const ok = (h) => h.startsWith('0'.repeat(ZEROS));

  function chain() {
    const out = [];
    let prev = '0'.repeat(64);
    for (let i = 0; i < blocks.length; i++) {
      const h = hashOf(i, prev);
      out.push({ prev, hash: h, valid: ok(h) && (i === 0 || out[i - 1].valid) });
      prev = h;
    }
    return out;
  }

  async function mine(i, render = true) {
    let prev = i ? chain()[i - 1].hash : '0'.repeat(64);
    const b = blocks[i];
    b.nonce = 0;
    for (;;) {
      for (let k = 0; k < 2000; k++, b.nonce++) if (ok(hashOf(i, prev))) { if (render) draw(); return; }
      if (render) { draw(); await nextFrame(); }
    }
  }

  function draw() {
    const cs = chain();
    wrap.innerHTML = '';
    cs.forEach((c, i) => {
      const card = el('div', { class: 'bc-card' + (c.valid ? '' : ' bc-invalid') });
      card.appendChild(el('div', { class: 'bc-card-head' }, 'Block ' + i));
      const ta = el('input', { class: 'bc-input', type: 'text', 'aria-label': 'Block ' + i + ' data' });
      ta.value = blocks[i].data;
      ta.addEventListener('input', () => { blocks[i].data = ta.value; refresh(); });
      card.append(el('small', {}, 'Data'), ta,
        el('small', {}, 'Previous hash'), mono(c.prev.slice(0, 16) + '…', 'bc-mono bc-small' + (i && !cs[i - 1].valid ? ' bc-badtext' : '')),
        el('small', {}, 'Nonce ' + blocks[i].nonce.toLocaleString()),
        el('small', {}, 'Hash'), mono(c.hash.slice(0, 16) + '…', 'bc-mono bc-small' + (ok(c.hash) ? ' bc-goodtext' : ' bc-badtext')));
      const m = button(c.valid ? 'Mined' : 'Mine', async () => { if (busy) return; busy = true; await mine(i); busy = false; draw(); }, c.valid ? 'xp-chip' : 'xp-btn xp-primary');
      m.disabled = c.valid;
      card.appendChild(m);
      wrap.appendChild(card);
    });
    const firstBad = cs.findIndex((c) => !c.valid);
    note.textContent = firstBad < 0
      ? 'Five blocks, each hash starting with 000 and each including the hash before it. Edit any block’s data.'
      : `Block ${firstBad} no longer has a valid hash, and every block after it now points to a hash that isn’t there. Re-mine them in order to repair the chain: that is the work an attacker must redo, while everyone else keeps adding blocks.`;
  }

  // Refresh text in place while typing, so the input keeps focus.
  function refresh() {
    const cs = chain();
    [...wrap.children].forEach((card, i) => {
      const c = cs[i];
      card.classList.toggle('bc-invalid', !c.valid);
      const codes = card.querySelectorAll('code');
      codes[0].textContent = c.prev.slice(0, 16) + '…';
      codes[0].className = 'bc-mono bc-small' + (i && !cs[i - 1].valid ? ' bc-badtext' : '');
      codes[1].textContent = c.hash.slice(0, 16) + '…';
      codes[1].className = 'bc-mono bc-small' + (ok(c.hash) ? ' bc-goodtext' : ' bc-badtext');
      const b = card.querySelector('button');
      b.disabled = c.valid;
      b.textContent = c.valid ? 'Mined' : 'Mine';
      b.className = c.valid ? 'xp-chip' : 'xp-btn xp-primary';
    });
    const firstBad = cs.findIndex((c) => !c.valid);
    note.textContent = firstBad < 0 ? 'All five blocks are valid again.' : `Block ${firstBad} no longer has a valid hash, and every block after it now points to a hash that isn’t there. Re-mine them in order to repair the chain: that is the work an attacker must redo, while everyone else keeps adding blocks.`;
  }

  (async () => { for (let i = 0; i < blocks.length; i++) await mine(i, false); draw(); })();
  return {};
};

/* ============================================================================
 * Mining for real
 * ========================================================================= */

REG.mine = (host) => {
  const zIn = range(8, 30, 1, 18);
  const zOut = el('output');
  const stats = el('div', { class: 'xp-stats' });
  const best = el('div');
  const result = el('div');
  const ctl = el('div', { class: 'xp-controls' });
  const go = button('Start mining', () => (running ? stop() : start()), 'xp-btn xp-primary');
  ctl.append(go);
  host.append(field('Difficulty', zIn, zOut), ctl, stats, best, result);
  let running = false, miner = null, nonce = 0, t0 = 0, busy = 0, bestZ = -1, bestHash = '', z = 18, rate = 0;

  function label() {
    z = Number(zIn.value);
    zOut.textContent = `${z} zero bits: 1 hash in ${si(Math.pow(2, z)).trim()} wins`;
  }

  function start() {
    label();
    const header = { version: 0x20000000, prev: C.hex(C.randomBytes(32)), merkle: C.hex(C.randomBytes(32)), time: Math.floor(Date.now() / 1000), bits: C.bitsForZeros(z), nonce: 0 };
    miner = C.headerMiner(header);
    nonce = 0; bestZ = -1; bestHash = ''; t0 = performance.now(); busy = 0; running = true;
    go.textContent = 'Stop';
    result.innerHTML = '';
    loop();
  }

  function stop() { running = false; go.textContent = 'Start mining'; }

  async function loop() {
    while (running) {
      const f0 = performance.now();
      let found = -1;
      while (performance.now() - f0 < 14) {
        found = miner.search(nonce, 4000, (n, st) => {
          const top = ((st[7] & 255) << 24 | (st[7] & 0xff00) << 8 | (st[7] >>> 8) & 0xff00 | st[7] >>> 24) >>> 0;
          const lz = top === 0 ? 32 : Math.clz32(top);
          if (lz > bestZ) { bestZ = lz; bestHash = n; }
        });
        if (found >= 0) break;
        nonce += 4000;
      }
      busy += performance.now() - f0;
      const el2 = (performance.now() - t0) / 1000;
      // Speed while actually hashing (the page shares each frame with drawing).
      rate = miner.hashes / Math.max(0.001, busy / 1000);
      render(el2);
      if (found >= 0) {
        running = false;
        go.textContent = 'Mine again';
        const h = miner.hashOf(found);
        result.innerHTML = '';
        result.append(statusLine(true, `Found a block after ${miner.hashes.toLocaleString()} tries (about ${si(Math.pow(2, z)).trim()} expected): nonce ${found.toLocaleString()}`, ''), hexWithZeros(h, 'bc-mono bc-break'));
        return;
      }
      await nextFrame();
    }
  }

  function render(secs) {
    stats.innerHTML = '';
    const s = (v, l) => { const d = el('div', { class: 'xp-stat' }); d.append(el('b', {}, v), el('span', {}, l)); stats.appendChild(d); };
    s(miner.hashes.toLocaleString(), 'hashes tried');
    s(si(rate) + 'H/s', 'your browser’s speed');
    s(secs.toFixed(1) + ' s', 'elapsed');
    s(si(Math.pow(2, z)).trim(), 'tries expected');
    best.innerHTML = '';
    if (bestHash !== '') best.append(el('div', { class: 'bc-label' }, `Best so far: ${bestZ} leading zero bits`), hexWithZeros(miner.hashOf(bestHash), 'bc-mono bc-break'));
    const btc = 6e23;     // hashes per Bitcoin block at about 1 ZH/s
    const years = btc / Math.max(1, rate) / 3.156e7;
    best.appendChild(el('p', { class: 'xp-caption' }, `At this speed, finding one real Bitcoin block (about 6 × 10²³ hashes at 2026 difficulty) would take your browser about ${sci(years)} years. The whole network finds one every ten minutes, at roughly 10²¹ hashes a second.`));
  }

  zIn.addEventListener('input', () => { label(); if (running) stop(); });
  label();
  return { destroy() { running = false; } };
};

/* ============================================================================
 * Difficulty adjustment
 * ========================================================================= */

REG.difficulty = (host) => {
  const c = canvas(host, 150);
  host.appendChild(el('div', { class: 'xp-caption' }, 'Average minutes per block in each two-week period (dashed: the 10-minute target).'));
  const c2 = canvas(host, 130);
  const leg = el('div', { class: 'xp-legend' });
  leg.innerHTML = '<span><i class="bc-line"></i>Hash rate</span><span><i class="bc-line bc-dash"></i>Difficulty</span><span>both relative to period 1</span>';
  const note = el('p', { class: 'xp-caption' });
  let event = 'drop';
  const ctl = chips([['drop', 'Half the miners leave'], ['double', 'Hash rate doubles'], ['steady', 'Nothing happens']], 'drop', (v) => { event = v; sim(); });
  host.prepend(ctl);
  host.append(leg, note);
  let data = null;
  const L = 44, B = 20, T = 8;
  function sim() {
    let D = 1, H = 1;
    const out = [];
    for (let p = 0; p < 9; p++) {
      if (p === 3) H *= event === 'drop' ? 0.5 : event === 'double' ? 2 : 1;
      // 2016 blocks; each takes an exponential time with mean 10 * D / H minutes.
      let total = 0;
      for (let i = 0; i < 2016; i++) total += -Math.log(1 - Math.random()) * 10 * D / H;
      out.push({ mins: total / 2016, H, D, days: total / 1440 });
      D = D * clamp((2016 * 10) / total, 0.25, 4);
    }
    data = out;
    draw();
    const p3 = out[3];
    note.textContent = event === 'steady'
      ? 'With hash rate steady, blocks average ten minutes and difficulty barely moves.'
      : `In period 4 the hash rate ${event === 'drop' ? 'halves' : 'doubles'}. Blocks ${event === 'drop' ? 'slow' : 'speed up'} to about ${p3.mins.toFixed(1)} minutes each, so that period takes ${p3.days.toFixed(0)} days instead of 14. At its end difficulty moves by the same factor and blocks are back near ten minutes. In mid-2021, when China banned mining, Bitcoin's hash rate fell by about half and the network made its largest downward adjustment, about 28%.`;
  }
  const colX = (i, w) => L + i * ((w - L - 8) / 9);
  function draw() {
    if (!data) return;
    const k = ink();
    let r = ctx2d(c);
    if (!r) return;
    let { g, w, h } = r;
    const bw = (w - L - 8) / 9, maxM = 25;
    const y = (v) => T + (h - T - B) * (1 - v / maxM);
    g.strokeStyle = k.grid; g.fillStyle = k.ink3; g.textAlign = 'right';
    for (const v of [0, 10, 20]) { g.beginPath(); g.moveTo(L, y(v) + 0.5); g.lineTo(w, y(v) + 0.5); g.stroke(); g.fillText(v + ' min', L - 4, y(v)); }
    g.textAlign = 'center';
    data.forEach((d, i) => {
      g.fillStyle = k.link;
      const top = y(Math.min(d.mins, maxM));
      g.fillRect(colX(i, w) + bw * 0.2, top, bw * 0.6, y(0) - top);
      g.fillStyle = k.ink3;
      g.fillText(String(i + 1), colX(i, w) + bw / 2, h - 8);
    });
    g.strokeStyle = k.text; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(L, y(10) + 0.5); g.lineTo(w, y(10) + 0.5); g.stroke(); g.setLineDash([]);
    r = ctx2d(c2);
    if (!r) return;
    ({ g, w, h } = r);
    const maxR = Math.max(2.2, ...data.map((d) => Math.max(d.H, d.D))) * 1.05;
    const y2 = (v) => T + (h - T - B) * (1 - v / maxR);
    g.strokeStyle = k.grid; g.fillStyle = k.ink3; g.textAlign = 'right';
    for (const v of [0, 1, 2]) { g.beginPath(); g.moveTo(L, y2(v) + 0.5); g.lineTo(w, y2(v) + 0.5); g.stroke(); g.fillText(v + '×', L - 4, y2(v)); }
    const line = (key, dash) => {
      g.strokeStyle = k.text; g.lineWidth = 2; g.setLineDash(dash);
      g.beginPath();
      data.forEach((d, i) => {
        const yy = y2(d[key]);
        if (i === 0) g.moveTo(colX(i, w), yy); else g.lineTo(colX(i, w), yy);
        g.lineTo(colX(i + 1, w), yy);
      });
      g.stroke(); g.setLineDash([]); g.lineWidth = 1;
    };
    line('H', []);
    line('D', [5, 4]);
    g.textAlign = 'center'; g.fillStyle = k.ink3;
    data.forEach((d, i) => g.fillText(String(i + 1), colX(i, w) + bw / 2, h - 8));
    g.textAlign = 'left';
  }
  const tipAt = (x, w) => {
    const i = Math.floor((x - L) / ((w - L - 8) / 9));
    if (!data || i < 0 || i >= 9) return null;
    const d = data[i];
    return `Period ${i + 1}: ${d.mins.toFixed(1)} min per block, ${d.days.toFixed(1)} days. Hash rate ${d.H.toFixed(2)}×, difficulty ${d.D.toFixed(2)}×.`;
  };
  hover(c, (x, y, w) => tipAt(x, w));
  hover(c2, (x, y, w) => tipAt(x, w));
  sim();
  return { on(t) { if (t === 'theme') draw(); } };
};

/* ============================================================================
 * The attacker's odds (Bitcoin white paper, section 11)
 * ========================================================================= */

function catchUp(q, z) {
  const p = 1 - q;
  if (q >= p) return 1;
  const lambda = z * (q / p);
  let sum = 1;
  let poisson = Math.exp(-lambda);
  for (let k = 0; k <= z; k++) {
    if (k > 0) poisson *= lambda / k;
    sum -= poisson * (1 - Math.pow(q / p, z - k));
  }
  return clamp(sum, 0, 1);
}

REG.race = (host) => {
  const qIn = range(0.02, 0.5, 0.01, 0.3);
  const qOut = el('output');
  const c = canvas(host, 190);
  const read = el('p', { class: 'xp-caption' });
  const tbl = el('div');
  host.prepend(field('Attacker’s share of hash rate', qIn, qOut));
  host.append(read, tbl);
  function draw() {
    const q = Number(qIn.value);
    qOut.textContent = Math.round(q * 100) + '%';
    const r = ctx2d(c);
    if (!r) return;
    const { g, w, h } = r;
    const k = ink();
    const L = 40, B = 20, T = 6, n = 13;
    const bw = (w - L - 6) / n;
    const lo = -6;
    const y = (p) => T + (h - T - B) * (1 - (Math.max(lo, Math.log10(Math.max(p, 1e-9))) - lo) / -lo);
    g.fillStyle = k.ink3; g.strokeStyle = k.grid; g.textAlign = 'right';
    for (let e = 0; e >= lo; e -= 2) { g.beginPath(); g.moveTo(L, y(Math.pow(10, e)) + 0.5); g.lineTo(w, y(Math.pow(10, e)) + 0.5); g.stroke(); g.fillText(e === 0 ? '100%' : e === -2 ? '1%' : e === -4 ? '0.01%' : '0.0001%', L - 3, y(Math.pow(10, e))); }
    g.textAlign = 'center';
    for (let z = 0; z < n; z++) {
      const p = catchUp(q, z);
      g.fillStyle = k.link;
      const top = y(p);
      g.fillRect(L + z * bw + bw * 0.18, top, bw * 0.64, y(1e-9) - top + (h - B - y(1e-9)));
      g.fillStyle = k.ink3;
      g.fillText(String(z), L + z * bw + bw / 2, h - 8);
    }
    g.textAlign = 'left';
    const p6 = catchUp(q, 6);
    read.textContent = `Bars: the chance an attacker with ${Math.round(q * 100)}% of the hash rate ever rewrites a payment after it has 0–12 confirmations (log scale). After 6 confirmations: ${p6 >= 0.9999 ? 'certain' : (p6 * 100).toPrecision(2) + '%'}. Past 50%, the attacker wins eventually no matter how long you wait.`;
    tbl.innerHTML = '';
    const t = el('table', { class: 'bc-table' });
    t.appendChild(el('tr')).append(el('th', {}, 'Attacker’s share'), el('th', { class: 'xp-num' }, 'Confirmations for under 0.1% risk'));
    for (const qq of [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45]) {
      let z = 0;
      while (catchUp(qq, z) >= 0.001 && z < 1000) z++;
      t.appendChild(el('tr')).append(el('td', {}, Math.round(qq * 100) + '%'), el('td', { class: 'xp-num' }, String(z)));
    }
    tbl.append(t, el('p', { class: 'xp-caption' }, 'The same table appears in the Bitcoin white paper (2008), computed with the same formula.'));
  }
  qIn.addEventListener('input', draw);
  hover(c, (x, y, w) => {
    const z = Math.floor((x - 40) / ((w - 46) / 13));
    if (z < 0 || z > 12) return null;
    const p = catchUp(Number(qIn.value), z);
    return `After ${z} confirmation${z === 1 ? '' : 's'}: ${p >= 0.99995 ? 'certain' : p < 1e-6 ? 'under 0.0001%' : (p * 100).toPrecision(2) + '%'} chance the attacker catches up`;
  });
  draw();
  return { on(t) { if (t === 'theme') draw(); } };
};

/* ============================================================================
 * Proof of stake: the proposer lottery
 * ========================================================================= */

REG.lottery = (host, ctx) => {
  const cast = BC.model.CAST;
  const c = canvas(host, 270);
  const note = el('p', { class: 'xp-caption' });
  const counts = new Map(cast.map((v) => [v.id, 0]));
  let slots = 0;
  const ctl = el('div', { class: 'xp-controls' });
  ctl.append(button('Run 100 slots', () => run(100), 'xp-btn xp-primary'), button('Run 10,000', () => run(10000), 'xp-chip'), button('Reset', () => { counts.forEach((_, k) => counts.set(k, 0)); slots = 0; draw(); }, 'xp-chip'));
  host.prepend(ctl);
  const leg = el('div', { class: 'xp-legend' });
  leg.innerHTML = '<span><i class="xp-swatch" style="background:var(--xp-track);outline:1px solid var(--xp-axis)"></i>Share of stake</span><span><i class="xp-swatch" style="background:var(--link)"></i>Share of slots proposed</span>';
  host.append(leg, note);
  const total = cast.reduce((a, v) => a + v.stake, 0);
  hover(c, (x, y, w, h) => {
    const i = Math.floor((y - 2) / ((h - 4) / cast.length));
    if (i < 0 || i >= cast.length) return null;
    const v = cast[i];
    return `${v.name}: ${Math.round((v.stake / total) * 1000) / 10}% of stake` + (slots ? `, proposed ${counts.get(v.id).toLocaleString()} of ${slots.toLocaleString()} slots (${((counts.get(v.id) / slots) * 100).toFixed(1)}%)` : '');
  });
  function run(n) {
    for (let i = 0; i < n; i++) {
      let r = Math.random() * total;
      for (const v of cast) { r -= v.stake; if (r <= 0) { counts.set(v.id, counts.get(v.id) + 1); break; } }
    }
    slots += n;
    draw();
  }
  function draw() {
    const r = ctx2d(c);
    if (!r) return;
    const { g, w, h } = r;
    const k = ink();
    const L = 74, rowH = (h - 4) / cast.length;
    const max = Math.max(...cast.map((v) => v.stake / total), ...cast.map((v) => (slots ? counts.get(v.id) / slots : 0))) * 1.1;
    cast.forEach((v, i) => {
      const y = 2 + i * rowH;
      g.fillStyle = k.text; g.textAlign = 'right';
      g.fillText(v.name, L - 6, y + rowH / 2);
      g.fillStyle = k.track;
      g.fillRect(L, y + 2, ((v.stake / total) / max) * (w - L - 40), rowH * 0.42);
      if (slots) {
        g.fillStyle = k.link;
        g.fillRect(L, y + 2 + rowH * 0.45, ((counts.get(v.id) / slots) / max) * (w - L - 40), rowH * 0.42);
      }
      g.fillStyle = k.ink3; g.textAlign = 'left';
      g.fillText(Math.round((v.stake / total) * 100) + '%', L + ((v.stake / total) / max) * (w - L - 40) + 4, y + 2 + rowH * 0.21);
    });
    note.textContent = slots
      ? `${slots.toLocaleString()} slots. Grey: each validator’s share of the stake. Blue: its share of the slots it was picked to propose. Over many slots the two match: one coin, one lottery ticket. Rewards are proportional too, so staking keeps shares steady rather than making the big bigger, but anyone who doesn’t stake slowly loses ground.`
      : 'Grey: each validator’s share of the stake in the model. Run the lottery to see who gets picked to propose blocks.';
  }
  draw();
  return { on(t) { if (t === 'theme') draw(); } };
};

/* ============================================================================
 * Bitcoin's supply
 * ========================================================================= */

REG.supply = (host) => {
  const c = canvas(host, 220);
  const note = el('p', { class: 'xp-caption' });
  host.appendChild(note);
  // Halving dates: actual through 2024, then every 210,000 blocks at ~10 minutes.
  const halvings = [2009.01, 2012.91, 2016.52, 2020.36, 2024.30];
  while (halvings.length < 34) halvings.push(halvings[halvings.length - 1] + 3.99);
  const pts = [];
  let supply = 0;
  for (let era = 0; era < 33; era++) {
    const sub = Math.floor((50 * 1e8) / Math.pow(2, era)) / 1e8;
    const t0 = halvings[era], t1 = halvings[era + 1];
    for (let s = 0; s <= 8; s++) pts.push([t0 + (t1 - t0) * s / 8, supply + 210000 * sub * s / 8]);
    supply += 210000 * sub;
  }
  function draw() {
    const r = ctx2d(c);
    if (!r) return;
    const { g, w, h } = r;
    const k = ink();
    const L = 34, B = 20, T = 8, x0 = 2009, x1 = 2060;
    const X = (t) => L + (w - L - 8) * (t - x0) / (x1 - x0);
    const Y = (v) => T + (h - T - B) * (1 - v / 21e6);
    g.strokeStyle = k.grid; g.fillStyle = k.ink3; g.textAlign = 'right';
    for (const v of [0, 7e6, 14e6, 21e6]) { g.beginPath(); g.moveTo(L, Y(v) + 0.5); g.lineTo(w, Y(v) + 0.5); g.stroke(); g.fillText(v / 1e6 + 'M', L - 4, Y(v)); }
    g.textAlign = 'center';
    for (const t of [2010, 2020, 2030, 2040, 2050]) g.fillText(String(t), X(t), h - 8);
    g.strokeStyle = k.link; g.lineWidth = 2;
    g.beginPath();
    pts.forEach(([t, v], i) => { if (t > x1) return; if (i === 0) g.moveTo(X(t), Y(v)); else g.lineTo(X(t), Y(v)); });
    g.stroke(); g.lineWidth = 1;
    const now = 2026.78, sNow = 20.09e6;
    g.fillStyle = k.warn;
    g.beginPath(); g.arc(X(now), Y(sNow), 4.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = k.text; g.textAlign = 'left';
    g.fillText('now: about 20.1M (96%)', X(now) + 8, Y(sNow) + 12);
    g.textAlign = 'left';
  }
  hover(c, (x, y, w) => {
    const t = 2009 + ((x - 34) / (w - 42)) * (2060 - 2009);
    if (t < 2009 || t > 2060) return null;
    let v = 0;
    for (const [pt, pv] of pts) { if (pt > t) break; v = pv; }
    const era = halvings.findIndex((hv, i) => t >= hv && t < halvings[i + 1]);
    return `${Math.floor(t)}: about ${(v / 1e6).toFixed(2)} million coins; reward ${(50 / Math.pow(2, Math.max(0, era))).toPrecision(4).replace(/\.?0+$/, '')} per block`;
  });
  note.textContent = 'Bitcoins in existence, 2009 to 2060. The block reward started at 50 and halves every 210,000 blocks (about four years): 50, 25, 12.5, 6.25, and 3.125 since April 2024. By 2060 more than 99.9% will exist; the last fraction of a coin is due around 2140, and because rewards are rounded down to whole satoshis the total will stop just short of 21 million.';
  draw();
  return { on(t) { if (t === 'theme') draw(); } };
};

/* ============================================================================
 * Live: the fee market (fees topic)
 * ========================================================================= */

const FEE_RAMP_VARS = ['--bc-fee1', '--bc-fee2', '--bc-fee3', '--bc-fee4', '--bc-fee5'];
function feeVar(rate) { return FEE_RAMP_VARS[rate < 4 ? 0 : rate < 10 ? 1 : rate < 30 ? 2 : rate < 60 ? 3 : 4]; }

REG.feemarket = (host, ctx) => {
  const M = ctx.model;
  if (!M) return {};
  const c = canvas(host, 210);
  const leg = el('div', { class: 'xp-legend' });
  [['1–3', 1], ['4–9', 5], ['10–29', 16], ['30–59', 40], ['60+', 64]].forEach(([l, r]) => {
    const s = el('span'); s.append(el('i', { class: 'xp-swatch', style: `background:var(${feeVar(r)})` }), document.createTextNode(l + ' sat/vB')); leg.appendChild(s);
  });
  const rIn = range(1, 100, 1, 3);
  const rOut = el('output');
  const est = el('p', { class: 'xp-caption' });
  const ctl = el('div', { class: 'xp-controls' });
  ctl.append(button('Send Ana’s coffee payment at this fee', () => {
    const tx = M.pay('ana', 'shop', Math.round(0.012 * COIN), { feeRate: Number(rIn.value), track: true, label: 'Ana’s coffee' });
    if (tx) { ctx.track(tx.id); if (ctx.scene) ctx.scene.focus('mempool'); }
  }, 'xp-btn xp-primary'));
  host.append(leg, field('Your fee rate', rIn, rOut), est, ctl);

  let blocks = [];
  hover(c, (x, y, w) => {
    const i = Math.floor(x / ((w + 10) / 6));
    const b = blocks[i];
    if (!b) return i >= 0 && i < 6 ? (i === 0 ? 'Next block: nothing waiting' : 'Empty: the queue is shorter than this') : null;
    const vb = b.reduce((a, t) => a + t.vsize, 0);
    return `${i === 0 ? 'Next block' : 'Block +' + i}: ${b.length} payment${b.length === 1 ? '' : 's'}, ${vb.toLocaleString()} vB, fee rates ${Math.round(b[b.length - 1].feeRate)}–${Math.round(b[0].feeRate)} sat/vB`;
  });
  function draw() {
    const r = ctx2d(c);
    if (!r) return;
    const { g, w, h } = r;
    const k = ink();
    const list = [...M.S.mempool.values()].sort((a, b) => b.feeRate - a.feeRate);
    const cap = M.knobs.maxBlockVsize;
    blocks = [];
    let cur = [], v = 0;
    for (const tx of list) {
      if (v + tx.vsize > cap && cur.length) { blocks.push(cur); cur = []; v = 0; if (blocks.length >= 6) break; }
      cur.push(tx); v += tx.vsize;
    }
    if (cur.length && blocks.length < 6) blocks.push(cur);
    const n = 6, gap = 10, bw = (w - gap * (n - 1)) / n, B = 34;
    for (let i = 0; i < n; i++) {
      const x = i * (bw + gap);
      g.strokeStyle = k.axis;
      g.strokeRect(x + 0.5, 4.5, bw - 1, h - B - 4);
      const txs = blocks[i] || [];
      let y = h - B;
      for (const tx of txs) {
        const hh = (tx.vsize / cap) * (h - B - 6);
        g.fillStyle = cssVar(feeVar(tx.feeRate));
        g.fillRect(x + 2, y - hh, bw - 4, Math.max(1, hh - 1));
        y -= hh;
      }
      g.fillStyle = k.ink3; g.textAlign = 'center';
      g.fillText(i === 0 ? 'Next block' : '+' + i, x + bw / 2, h - B + 12);
      if (txs.length) g.fillText(Math.round(txs[txs.length - 1].feeRate) + '–' + Math.round(txs[0].feeRate) + ' sat/vB', x + bw / 2, h - B + 25);
    }
    g.textAlign = 'left';
    const rate = Number(rIn.value);
    rOut.textContent = rate + ' sat/vB';
    let ahead = 0;
    for (const tx of list) if (tx.feeRate >= rate) ahead += tx.vsize;
    const nb = Math.floor(ahead / cap) + 1;
    est.textContent = `The mempool, sorted the way miners sort it: highest fee rate first, cut into block-sized pieces. ${list.length} payments are waiting. At ${rate} sat/vB a typical payment (141 vB) costs ${rate * 141} satoshis and lands in about block ${nb}${nb > 1 ? ', if nothing better-paying arrives first' : ''}.`;
  }
  rIn.addEventListener('input', draw);
  draw();
  return { slow: draw, on(t) { if (t === 'theme') draw(); } };
};

/* ============================================================================
 * Gas
 * ========================================================================= */

REG.gas = (host) => {
  const ACTIONS = [
    ['send', 'Send ETH', 21000], ['token', 'Send a token', 50000], ['swap', 'Swap tokens', 150000], ['mint', 'Mint an NFT', 120000], ['deploy', 'Deploy a contract', 1500000],
  ];
  let act = ACTIONS[0];
  const baseIn = range(-1.5, 2.5, 0.01, Math.log10(0.4));
  const baseOut = el('output');
  const tipIn = range(0, 3, 0.01, 0.1);
  const tipOut = el('output');
  const price = el('input', { class: 'bc-input bc-num', type: 'number', min: '1', step: '1', value: '3000', 'aria-label': 'ETH price in dollars' });
  const out = el('div', { class: 'bc-gasout' });
  const presets = el('div', { class: 'xp-controls' });
  presets.append(
    button('A quiet day in 2026', () => { baseIn.value = String(Math.log10(0.3)); tipIn.value = '0.05'; draw(); }, 'xp-chip'),
    button('NFT mania, 2021', () => { baseIn.value = String(Math.log10(150)); tipIn.value = '2'; draw(); }, 'xp-chip'),
  );
  host.append(
    chips(ACTIONS.map((a) => [a[0], a[1]]), 'send', (v) => { act = ACTIONS.find((a) => a[0] === v); draw(); }),
    field('Base fee', baseIn, baseOut), field('Priority tip', tipIn, tipOut),
    field('ETH price, $ (your assumption)', price), presets, out,
  );
  function draw() {
    const base = Math.pow(10, Number(baseIn.value));
    const tip = Number(tipIn.value);
    baseOut.textContent = (base < 1 ? base.toFixed(2) : base < 10 ? base.toFixed(1) : base.toFixed(0)) + ' gwei';
    tipOut.textContent = tip.toFixed(2) + ' gwei';
    const gas = act[2];
    const eth = (gas * (base + tip)) / 1e9;
    const usd = eth * Number(price.value || 0);
    out.innerHTML = '';
    out.append(kv([
      ['Gas used', gas.toLocaleString() + (act[0] === 'send' ? ' (fixed for a plain transfer)' : ' (typical; varies by contract)')],
      ['Price per unit of gas', (base + tip).toPrecision(3) + ' gwei (1 gwei = 0.000000001 ETH)'],
      ['Fee', eth.toPrecision(3) + ' ETH ≈ $' + (usd < 0.01 ? usd.toFixed(4) : usd < 100 ? usd.toFixed(2) : Math.round(usd).toLocaleString())],
      ['Burned (base fee)', ((gas * base) / 1e9).toPrecision(3) + ' ETH: destroyed, paid to no one'],
      ['To the validator (tip)', ((gas * tip) / 1e9).toPrecision(3) + ' ETH'],
    ]));
  }
  [baseIn, tipIn, price].forEach((x) => x.addEventListener('input', draw));
  draw();
  return {};
};

/* ============================================================================
 * The base fee (EIP-1559)
 * ========================================================================= */

REG.basefee = (host) => {
  const c = canvas(host, 150);
  const c2 = canvas(host, 110);
  const dIn = range(0.5, 2.5, 0.05, 1.2);
  const dOut = el('output');
  const note = el('p', { class: 'xp-caption' });
  const ctl = el('div', { class: 'xp-controls' });
  let spike = 0, burned = 0;
  ctl.append(button('A popular NFT drop', () => { spike = 22; }, 'xp-btn xp-primary'));
  host.prepend(field('Everyday demand (how many want in, as a share of the target)', dIn, dOut), ctl);
  host.appendChild(note);
  const blocks = [];
  let base = 0.4;
  const W0 = 0.4;   // gwei: willingness to pay falls off on this scale
  let acc = 0;
  function step() {
    const demand = Number(dIn.value) * (spike > 0 ? 3.5 : 1) * (0.85 + Math.random() * 0.3);
    if (spike > 0) spike--;
    // People drop out as the base fee climbs past what they'll pay.
    const want = demand * Math.exp(-base / W0) * 2.2;
    const used = clamp(want * 0.5, 0, 1);       // as a fraction of the gas limit; the target is half
    blocks.push({ used, base });
    burned += used * 60e6 * base / 1e9;
    if (blocks.length > 60) blocks.shift();
    base = Math.max(0.01, base * (1 + (used - 0.5) / 0.5 / 8));
  }
  for (let i = 0; i < 60; i++) step();
  const tipAt = (x, w) => {
    const i = Math.floor(x / (w / 60));
    const b = blocks[i];
    return b ? `${i === 59 ? 'Latest block' : (59 - i) + ' blocks ago'}: ${Math.round(b.used * 100)}% full, base fee ${b.base.toFixed(2)} gwei` : null;
  };
  hover(c, (x, y, w) => tipAt(x, w));
  hover(c2, (x, y, w) => tipAt(x, w));
  function draw() {
    const k = ink();
    let r = ctx2d(c);
    if (!r) return;
    let { g, w, h } = r;
    const n = 60, bw = w / n;
    blocks.forEach((b, i) => {
      g.fillStyle = k.link;
      g.fillRect(i * bw + 0.5, h - b.used * (h - 4), bw - 1, b.used * (h - 4));
    });
    g.strokeStyle = k.text; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(0, h - 0.5 * (h - 4)); g.lineTo(w, h - 0.5 * (h - 4)); g.stroke(); g.setLineDash([]);
    const tag = (text, x, y) => {
      const tw = g.measureText(text).width;
      g.fillStyle = k.bg; g.fillRect(x - 3, y - 8, tw + 6, 15);
      g.fillStyle = k.ink2; g.fillText(text, x, y);
    };
    tag('target: half full', 4, h - 0.5 * (h - 4) - 10);
    tag('full', 4, 10);
    r = ctx2d(c2);
    if (!r) return;
    ({ g, w, h } = r);
    const max = Math.max(1, ...blocks.map((b) => b.base)) * 1.1;
    g.strokeStyle = k.text; g.lineWidth = 2;
    g.beginPath();
    blocks.forEach((b, i) => { const x = i * bw + bw / 2, y = h - 4 - (b.base / max) * (h - 18); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke(); g.lineWidth = 1;
    const label = 'base fee, ' + base.toFixed(2) + ' gwei now (axis top: ' + max.toFixed(1) + ' gwei)';
    g.fillStyle = k.bg; g.fillRect(1, 1, g.measureText(label).width + 6, 15);
    g.fillStyle = k.ink2; g.fillText(label, 4, 9);
    dOut.textContent = Math.round(Number(dIn.value) * 100) + '%';
    note.textContent = `Top: how full each block is (one bar per block, newest at the right). Bottom: the base fee. When a block is more than half full the next block’s base fee rises, by up to 12.5%; when it’s less, the fee falls. Twenty full blocks in a row multiply it about tenfold, which prices out enough people to bring blocks back to half full. In this simulation about ${burned.toFixed(1)} ETH has been burned.`;
  }
  requestAnimationFrame(draw);
  return {
    tick(dt) { acc += dt; if (acc > 0.5) { acc = 0; step(); draw(); } },
    on(t) { if (t === 'theme') draw(); },
  };
};

/* ============================================================================
 * Recovery phrases (BIP-39)
 * ========================================================================= */

let datalist = null;
function wordList() {
  if (datalist) return datalist;
  datalist = el('datalist', { id: 'bc-bip39' });
  for (const w of WORDS) datalist.appendChild(el('option', { value: w }));
  document.body.appendChild(datalist);
  return datalist;
}

REG.mnemonic = (host) => {
  wordList();
  const ctl = el('div', { class: 'xp-controls' });
  const grid = el('div', { class: 'bc-words' });
  const bits = el('div', { class: 'bc-bits' });
  const bitsNote = el('p', { class: 'xp-caption' });
  const status = el('div');
  const seedBox = el('div');
  ctl.append(button('New 12-word phrase', () => fresh(16), 'xp-btn xp-primary'), button('New 24-word phrase', () => fresh(32), 'xp-chip'),
    button('Change one word', () => { const i = Math.floor(Math.random() * words.length); words[i] = WORDS[Math.floor(Math.random() * 2048)]; render(); }, 'xp-chip'));
  host.append(ctl, grid, status, bits, bitsNote, seedBox, el('p', { class: 'xp-note' }, 'Never type a real recovery phrase into a website, this one included. Phrases made here are for learning: treat them as public.'));
  let words = [];

  function fresh(bytes) {
    words = C.entropyToMnemonic(C.randomBytes(bytes), WORDS);
    shared.phrase = words.slice();
    render();
  }

  function render() {
    grid.innerHTML = '';
    words.forEach((w, i) => {
      const cell = el('label', { class: 'bc-word' });
      const inp = el('input', { type: 'text', list: 'bc-bip39', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Word ' + (i + 1) });
      inp.value = w;
      inp.addEventListener('change', () => { words[i] = inp.value.trim().toLowerCase(); check(); });
      cell.append(el('span', {}, String(i + 1)), inp);
      grid.appendChild(cell);
    });
    check();
  }

  function check() {
    const r = C.checkMnemonic(words, WORDS);
    status.innerHTML = '';
    bits.innerHTML = '';
    bitsNote.textContent = '';
    seedBox.innerHTML = '';
    if (r.unknown && r.unknown.length) { status.appendChild(statusLine(false, 'Not on the list: ' + r.unknown.join(', '), 'Only the 2,048 BIP-39 words are allowed. The first four letters of each are unique, so wallets can autocomplete them.')); return; }
    status.appendChild(statusLine(r.ok, r.ok ? 'Checksum matches' : 'Checksum does not match',
      r.ok ? 'The last ' + r.checksumWant.length + ' bits agree with the SHA-256 of the rest. A wallet would accept this phrase.' : `The last ${r.checksumWant.length} bits should be ${r.checksumWant} but are ${r.checksumGot}. A typo or a swapped word is caught here, before any money moves (a random change slips through 1 time in ${Math.pow(2, r.checksumWant.length)}).`));
    // The bits behind each word.
    words.forEach((w, i) => {
      const b = r.bits.slice(i * 11, i * 11 + 11);
      const d = el('div', { class: 'bc-bitword' });
      const entEnd = r.bits.length - r.checksumWant.length;
      const span = el('code', { class: 'bc-mono bc-small' });
      for (let j = 0; j < 11; j++) {
        const pos = i * 11 + j;
        const s = el('span', { class: pos >= entEnd ? 'bc-cs' : '' }, b[j]);
        span.appendChild(s);
      }
      d.append(el('small', {}, w + ' = #' + WORDS.indexOf(w)), span);
      bits.appendChild(d);
    });
    const ent = (words.length * 11 * 32) / 33;
    bitsNote.textContent = `Each word stands for 11 bits (2¹¹ = 2,048 words). ${words.length} words carry ${ent} random bits plus a ${words.length / 3}-bit checksum, highlighted. There are 2${sup(ent)} possible phrases: even if everyone on Earth checked a billion a second, finding one particular 12-word phrase would take about 10¹² years${ent > 128 ? ', and a 24-word one immeasurably longer' : ''}.`;
    if (r.ok) {
      shared.phrase = words.slice();
      const t0 = performance.now();
      const seed = C.mnemonicToSeed(words);
      seedBox.append(el('div', { class: 'bc-label' }, `Seed: the phrase stretched by 2,048 rounds of HMAC-SHA512 (${(performance.now() - t0).toFixed(0)} ms)`), mono(C.hex(seed), 'bc-mono bc-break bc-small'));
    }
  }
  fresh(16);
  return {};
};

REG.hd = (host) => {
  const FAMOUS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
  let words = shared.phrase || C.entropyToMnemonic(C.randomBytes(16), WORDS);
  const ctl = el('div', { class: 'xp-controls' });
  const which = el('div', { class: 'bc-mono bc-small bc-phrase' });
  const pass = el('input', { class: 'bc-input', type: 'text', placeholder: 'optional passphrase (the "25th word")', 'aria-label': 'Passphrase', spellcheck: 'false' });
  const out = el('div');
  ctl.append(
    button('A new phrase', () => { words = C.entropyToMnemonic(C.randomBytes(16), WORDS); render(); }, 'xp-chip'),
    button('The phrase from the last topic', () => { if (shared.phrase) { words = shared.phrase.slice(); render(); } }, 'xp-chip'),
    button('"abandon … about"', () => { words = FAMOUS; render(); }, 'xp-chip'),
  );
  host.append(ctl, which, pass, out);
  let timer = 0;
  pass.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 250); });

  function render() {
    which.textContent = words.join(' ');
    out.innerHTML = '';
    const t0 = performance.now();
    const seed = C.mnemonicToSeed(words, pass.value);
    const tree = el('div', { class: 'bc-tree' });
    const row = (depth, path, label, value) => {
      const d = el('div', { class: 'bc-treerow', style: `padding-left:${depth * 14}px` });
      d.append(mono(path, 'bc-mono bc-small bc-path'), el('span', {}, label));
      if (value) d.appendChild(mono(value, 'bc-mono bc-small bc-break'));
      tree.appendChild(d);
    };
    row(0, 'seed', 'from the phrase' + (pass.value ? ' and passphrase' : ''), C.hex(seed).slice(0, 32) + '…');
    row(1, 'm', 'master key', null);
    row(2, "m/84'/0'/0'/0", 'Bitcoin (native SegWit): receiving addresses', null);
    for (let i = 0; i < 4; i++) row(3, '…/' + i, '', C.keyInfo(C.derivePath(seed, `m/84'/0'/0'/0/${i}`).k).btc);
    row(2, "m/44'/60'/0'/0", 'Ethereum accounts', null);
    for (let i = 0; i < 3; i++) row(3, '…/' + i, '', C.keyInfo(C.derivePath(seed, `m/44'/60'/0'/0/${i}`).k).eth);
    out.append(tree, el('p', { class: 'xp-caption' }, `Derived in ${(performance.now() - t0).toFixed(0)} ms. Every address is a branch of one tree grown from the seed, so the phrase alone restores all of them, in any compatible wallet.` +
      (words.join(' ') === FAMOUS.join(' ') && !pass.value ? ' These are the well-known first addresses for "abandon … about", the standard test phrase: bots watch them, and anything sent there is gone in seconds.' : '') +
      (pass.value ? ' With a passphrase the whole tree is different; without it, the phrase opens a different (perhaps decoy) wallet.' : '')));
  }
  render();
  return { destroy() { clearTimeout(timer); } };
};

/* ============================================================================
 * Chain analysis
 * ========================================================================= */

function svgEl(tag, attrs, text) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  return e;
}

REG.graph = (host) => {
  // Addresses (circles) and transactions (squares). One person, Dara, owns
  // a1, a2, a3, a5; b1 is a merchant; x is an exchange.
  const N = {
    x: { x: 36, y: 60, label: 'Exchange', kind: 'addr', owner: 'ex' },
    t0: { x: 105, y: 60, kind: 'tx', label: 'withdrawal' },
    a1: { x: 180, y: 40, label: '0.60', kind: 'addr', owner: 'dara' },
    a2: { x: 180, y: 140, label: '0.50', kind: 'addr', owner: 'dara' },
    t1: { x: 255, y: 90, kind: 'tx', label: 'payment' },
    b1: { x: 340, y: 45, label: '1.00', kind: 'addr', owner: 'shop' },
    a3: { x: 340, y: 140, label: '0.0997', kind: 'addr', owner: 'dara' },
    t2: { x: 395, y: 185, kind: 'tx', label: 'later' },
    a5: { x: 445, y: 230, label: '0.0995', kind: 'addr', owner: 'dara' },
    a4: { x: 180, y: 225, label: '0.30', kind: 'addr', owner: 'other' },
  };
  const E = [['x', 't0'], ['t0', 'a1'], ['a1', 't1'], ['a2', 't1'], ['t1', 'b1'], ['t1', 'a3'], ['a3', 't2'], ['t2', 'a5']];
  const on = { common: false, change: false, kyc: false };
  const svgHost = el('div', { class: 'bc-svgwrap' });
  const note = el('p', { class: 'xp-caption' });
  const ctl = el('div', { class: 'xp-controls' });
  const tg = (key, label) => {
    const b = el('button', { class: 'xp-chip', type: 'button', 'aria-pressed': 'false' }, label);
    b.addEventListener('click', () => { on[key] = !on[key]; b.setAttribute('aria-pressed', String(on[key])); draw(); });
    return b;
  };
  ctl.append(tg('common', '1. Inputs spent together'), tg('change', '2. Spot the change'), tg('kyc', '3. Ask the exchange'));
  host.append(ctl, svgHost, note);
  function draw() {
    const svg = svgEl('svg', { viewBox: '0 0 480 300', class: 'bc-svg' });
    for (const [a, b] of E) svg.appendChild(svgEl('line', { x1: N[a].x, y1: N[a].y, x2: N[b].x, y2: N[b].y, class: 'bc-edge' }));
    const cluster = new Set();
    if (on.common) { cluster.add('a1'); cluster.add('a2'); }
    if (on.change && on.common) { cluster.add('a3'); cluster.add('a5'); }
    else if (on.change) { cluster.add('a3'); cluster.add('a5'); }
    for (const [id, n] of Object.entries(N)) {
      const g = svgEl('g', {});
      if (n.kind === 'tx') g.appendChild(svgEl('rect', { x: n.x - 9, y: n.y - 9, width: 18, height: 18, rx: 3, class: 'bc-txnode' }));
      else g.appendChild(svgEl('circle', { cx: n.x, cy: n.y, r: 16, class: 'bc-addr' + (cluster.has(id) ? ' bc-cluster' : '') + (id === 'x' ? ' bc-known' : '') }));
      g.appendChild(svgEl('text', { x: n.x, y: n.y + (n.kind === 'tx' ? 24 : 30), 'text-anchor': 'middle', class: 'bc-svgsmall' }, n.label));
      svg.appendChild(g);
    }
    if (on.kyc && cluster.size) {
      svg.appendChild(svgEl('text', { x: 240, y: 290, 'text-anchor': 'middle', class: 'bc-strong' }, 'Highlighted: Dara, according to the exchange\u2019s records'));
    }
    svgHost.innerHTML = '';
    svgHost.appendChild(svg);
    const msgs = [];
    if (!on.common && !on.change && !on.kyc) msgs.push('Circles are addresses (with their balances), squares transactions. Nothing here carries a name. Switch on the analyst’s rules one at a time.');
    if (on.common) msgs.push('Rule 1: a transaction that spends from two addresses was almost certainly signed by one owner, who held both keys. So 0.60 and 0.50 belong together.');
    if (on.change) msgs.push('Rule 2: a payment of exactly 1.00 and an odd 0.0997 back? The round number is the payment; the odd one is change returning to the payer, and so is where it goes next.');
    if (on.kyc) msgs.push(on.common || on.change ? 'Rule 3: the 0.60 came straight from an exchange that verified its customer’s identity. One subpoena or data leak names the whole cluster.' : 'Rule 3: the exchange knows who it paid. On its own that names one address; combined with the other rules it names them all.');
    note.textContent = msgs.join(' ');
  }
  draw();
  return {};
};

REG.coinjoin = (host) => {
  const people = [['Ana', 0.13], ['Ben', 0.16], ['Chen', 0.25], ['Dara', 0.11], ['Eli', 0.17]];
  const DEN = 0.1;
  let analyst = false, mistake = false;
  const ctl = el('div', { class: 'xp-controls' });
  const tg = (label, fn) => {
    const b = el('button', { class: 'xp-chip', type: 'button', 'aria-pressed': 'false' }, label);
    b.addEventListener('click', () => { fn(); b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); draw(); });
    return b;
  };
  ctl.append(tg('Analyst’s view', () => { analyst = !analyst; }), tg('Ben merges his mixed coin with his change', () => { mistake = !mistake; }));
  const svgHost = el('div', { class: 'bc-svgwrap' });
  const note = el('p', { class: 'xp-caption' });
  host.append(ctl, svgHost, note);
  function draw() {
    const svg = svgEl('svg', { viewBox: '0 0 560 300', class: 'bc-svg' });
    const tx = { x: 245, y: 150 };
    svg.appendChild(svgEl('rect', { x: tx.x - 40, y: 30, width: 80, height: 240, rx: 8, class: 'bc-txnode' }));
    svg.appendChild(svgEl('text', { x: tx.x, y: 22, 'text-anchor': 'middle', class: 'bc-svgsmall' }, 'one transaction'));
    const outs = [];
    people.forEach(([name, amt], i) => {
      const y = 50 + i * 50;
      svg.appendChild(svgEl('line', { x1: 110, y1: y, x2: tx.x - 40, y2: y, class: 'bc-edge' }));
      svg.appendChild(svgEl('circle', { cx: 92, cy: y, r: 15, class: 'bc-addr' }));
      svg.appendChild(svgEl('text', { x: 66, y: y + 4, 'text-anchor': 'end', class: 'bc-svgsmall' }, name + ' ' + amt.toFixed(2)));
      outs.push({ y: 40 + i * 24, amt: DEN, owner: name, mixed: true });
    });
    people.forEach(([name, amt]) => { const ch = +(amt - DEN - 0.001).toFixed(3); if (ch > 0.0005) outs.push({ amt: ch, owner: name, mixed: false }); });
    outs.forEach((o, i) => {
      o.y = 40 + i * (220 / (outs.length - 1));
      svg.appendChild(svgEl('line', { x1: tx.x + 40, y1: o.y, x2: 372, y2: o.y, class: 'bc-edge' }));
      svg.appendChild(svgEl('circle', { cx: 386, cy: o.y, r: o.mixed ? 11 : 8, class: 'bc-addr' + (o.mixed ? ' bc-mixed' : '') }));
      svg.appendChild(svgEl('text', { x: 404, y: o.y + 4, class: 'bc-svgsmall' }, o.amt.toFixed(o.mixed ? 2 : 3) + (o.mixed ? '' : ' change') + (analyst && !o.mixed ? ' → ' + o.owner : '')));
    });
    if (analyst) {
      const ys = people.map((_, i) => 50 + i * 50);
      outs.filter((o) => !o.mixed).forEach((o) => {
        const i = people.findIndex((p) => p[0] === o.owner);
        svg.appendChild(svgEl('path', { d: `M 110 ${ys[i]} C 200 ${ys[i]}, 300 ${o.y}, 376 ${o.y}`, class: 'bc-link bc-bad' }));
      });
      if (mistake) {
        const ben = outs.find((o) => o.mixed && o.owner === 'Ben');
        const benCh = outs.find((o) => !o.mixed && o.owner === 'Ben');
        if (ben && benCh) svg.appendChild(svgEl('path', { d: `M 375 ${ben.y} C 318 ${ben.y}, 318 ${benCh.y}, 377 ${benCh.y}`, class: 'bc-link bc-bad' }));
      }
    }
    svgHost.innerHTML = '';
    svgHost.appendChild(svg);
    note.textContent = !analyst
      ? `Five people pool their coins into a single transaction that pays out five identical ${DEN} outputs, plus each person’s change. Each signs only their own input, so nobody can steal, and no one in the middle holds the coins.`
      : mistake
        ? 'Ben later spends his mixed 0.10 together with his own change in one transaction. Rule 1 (inputs spent together share an owner) ties the "anonymous" coin straight back to Ben’s change, and his change was already linked to him. His mix is undone; the other four now hide among four.'
        : 'An analyst can match the odd-sized change outputs to their owners by arithmetic (red). But the five 0.10 outputs are interchangeable: each could belong to any of the five people. That set of five is the anonymity set; real CoinJoins aim for dozens or hundreds.';
  }
  draw();
  return {};
};

REG.zkpool = (host) => {
  const NAMES = ['Ana', 'Ben', 'Chen', 'Dara', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun'];
  const events = [];
  let careless = false;
  const ctl = el('div', { class: 'xp-controls' });
  ctl.append(
    button('Someone deposits 1 coin', () => { const n = NAMES[events.filter((e) => e.kind === 'dep').length % NAMES.length]; events.push({ kind: 'dep', who: n, note: C.hex(C.sha256(C.randomBytes(32))) }); draw(); }, 'xp-btn xp-primary'),
    button('Someone withdraws', () => withdraw(), 'xp-btn'),
  );
  const care = el('button', { class: 'xp-chip', type: 'button', 'aria-pressed': 'false' }, 'Withdraw right after depositing');
  care.addEventListener('click', () => { careless = !careless; care.setAttribute('aria-pressed', String(careless)); });
  ctl.append(care, button('Reset', () => { events.length = 0; seed(); draw(); }, 'xp-chip'));
  const list = el('div', { class: 'bc-zk' });
  const note = el('p', { class: 'xp-caption' });
  host.append(ctl, list, note);
  function seed() {
    for (let i = 0; i < 4; i++) events.push({ kind: 'dep', who: NAMES[i], note: C.hex(C.sha256(C.randomBytes(32))) });
  }
  function withdraw() {
    const deps = events.filter((e) => e.kind === 'dep' && !e.spent);
    if (!deps.length) return;
    let d;
    if (careless) {
      d = { kind: 'dep', who: NAMES[events.filter((e) => e.kind === 'dep').length % NAMES.length], note: C.hex(C.sha256(C.randomBytes(32))) };
      events.push(d);
    } else d = deps[Math.floor(Math.random() * deps.length)];
    d.spent = true;
    const set = events.filter((e) => e.kind === 'dep').length;
    events.push({ kind: 'wd', to: 'fresh address ' + C.hex(C.randomBytes(3)), nullifier: C.hex(C.sha256(C.utf8(d.note))), set, careless, from: d.who });
    draw();
  }
  function draw() {
    list.innerHTML = '';
    const deps = events.filter((e) => e.kind === 'dep').length;
    for (const e of events.slice(-12)) {
      const row = el('div', { class: 'bc-zkrow' + (e.kind === 'wd' ? ' bc-zkwd' : '') });
      if (e.kind === 'dep') row.append(el('b', {}, e.who + ' deposits 1'), el('small', {}, 'commitment ' + e.note.slice(0, 12) + '… added to the pool’s Merkle tree'));
      else row.append(el('b', {}, '1 withdrawn to a ' + e.to), el('small', {}, `proof checks out; nullifier ${e.nullifier.slice(0, 12)}… recorded so this note can’t be spent twice. ${e.careless ? 'The proof hides which deposit it was, but see below.' : 'Could be any of the ' + e.set + ' deposits so far.'}`));
      list.appendChild(row);
    }
    const last = [...events].reverse().find((e) => e.kind === 'wd');
    note.textContent = !last
      ? `The pool holds ${deps} coins. Each depositor keeps a secret note; only its hash, the commitment, goes on chain.`
      : last.careless
        ? `This withdrawal came seconds after ${last.from}’s deposit, with no other activity in between. The proof hides which note it used, but timing doesn’t: an analyst simply matches the deposit before it. Mistakes like this, plus reused addresses, unusual amounts and paying gas from a linked account, are how most mixer users are identified.`
        : `A zero-knowledge proof shows the withdrawer knows the secret behind one of the ${last.set} commitments, without saying which. Nothing on chain links it to its deposit: the anonymity set is all ${last.set} deposits so far.`;
  }
  seed();
  draw();
  return {};
};

/* ============================================================================
 * Mining pools today (trust topic)
 * ========================================================================= */

REG.pools = (host) => {
  const DATA = [['Foundry USA', 27.6], ['F2Pool', 17.8], ['AntPool', 17.3], ['ViaBTC', 9.5], ['All others', 27.8]];
  const c = canvas(host, 150);
  hover(c, (x, y, w, h) => {
    const i = Math.floor(y / (h / DATA.length));
    return DATA[i] ? `${DATA[i][0]}: ${DATA[i][1]}% of blocks` : null;
  });
  const cap = el('p', { class: 'xp-caption' }, 'Share of Bitcoin blocks found by each pool, 7-day average in mid-July 2026 (mempool.space, as reported by GN Crypto). Shares move week to week. Two pools found nearly half the blocks; three, more than 60%.');
  host.appendChild(cap);
  function draw() {
    const r = ctx2d(c);
    if (!r) return;
    const { g, w, h } = r;
    const k = ink();
    const L = 90, rowH = h / DATA.length;
    let cum = 0;
    DATA.forEach(([name, pct], i) => {
      const y = i * rowH;
      g.fillStyle = k.text; g.textAlign = 'right';
      g.fillText(name, L - 6, y + rowH / 2);
      g.fillStyle = i === DATA.length - 1 ? k.axis : k.link;
      g.fillRect(L, y + 4, (pct / 40) * (w - L - 90), rowH - 8);
      g.fillStyle = k.ink2; g.textAlign = 'left';
      cum += pct;
      g.fillText(pct.toFixed(1) + '%' + (i < 3 ? `  (top ${i + 1}: ${cum.toFixed(0)}%)` : ''), L + (pct / 40) * (w - L - 90) + 6, y + rowH / 2);
    });
    // 50% marker on the cumulative labels is in the text; one axis only.
  }
  draw();
  return { on(t) { if (t === 'theme') draw(); } };
};

BC.widgets = { mount, emit, tick, drawIntervals, si, sci };
})(window.Blockchain = window.Blockchain || {});
