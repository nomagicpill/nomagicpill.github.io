/*
 * knowledge/draftblockchain.html: wires the model (model.js, with crypto.js),
 * the 3D view (scene.js), the figures and calculators (widgets.js) and the
 * explainer shell (js/explainer.js) together, and runs the clock.
 *
 * Everything is a classic script, so the page works opened straight from disk.
 * three.js and the scene load only once WebGL is known to work; until then,
 * and if anything fails, the page stays a readable article.
 */
(function (BC) {
'use strict';
const { init: initExplainer, cssVar, onThemeChange, isDark } = window.Explainer;
const W = BC.widgets;
const C = BC.crypto;

const $ = (sel, root = document) => root.querySelector(sel);
const COIN = 100000000;
const fmtCoins = (sats) => { const c = sats / COIN; return c >= 100 ? c.toFixed(0) : c >= 10 ? c.toFixed(1) : c.toFixed(c >= 1 ? 2 : 3); };
const short = (h, n = 8) => h.slice(0, n) + '…';

// What clicking each kind of thing opens.
function topicFor(id) {
  if (id === 'mempool') return 'fees';
  if (id === 'chain') return 'immutability';
  if (id.startsWith('block:')) return 'blocks';
  if (id.startsWith('node:')) {
    const n = model.node(id.slice(5));
    if (n.id === 'mallory') return 'attack51';
    if (n.kind === 'pool' || n.kind === 'miner') return model.S.mode === 'pos' ? 'pos' : 'mining';
    if (n.kind === 'exchange') return 'wallets';
    if (n.kind === 'shop') return 'transactions';
    return 'network';
  }
  return null;
}

const SPEEDS = [0, 0.5, 1, 2.5];

const S = {
  playing: true,
  speedIdx: 2,
  labels: true,
  messages: true,
  views: true,
  feeLevel: 'normal',
  tracked: null,
  selectedBlock: null,
  lastReorg: -99,
  storyPaused: false,
};

let model = null, scene = null, EXP = null;

/* ----------------------------------------------------------------------------
 * HUD
 * ------------------------------------------------------------------------- */

const STATUS = [
  [0, 'In agreement'],
  [1, 'Nodes disagree'],
  [2, 'Reorganizing'],
  [3, 'Under attack'],
  [4, 'Network split'],
  [2, 'Not finalizing'],
];

function hudStatus() {
  const M = model, St = M.S;
  if (St.partition) return STATUS[4];
  if (St.attack) return STATUS[3];
  if (St.t - S.lastReorg < 3) return STATUS[2];
  if (St.mode === 'pos' && St.pos && M.epochOf(St.pos.slot) - St.pos.finalizedEpoch > 3) return STATUS[5];
  if (!M.consensus()) return STATUS[1];
  return STATUS[0];
}

function zeroSplit(hash) {
  const m = hash.match(/^0*/)[0];
  return [m, hash.slice(m.length)];
}

function updateHUD() {
  const M = model, St = M.S;
  const tip = M.canonical;
  if (!tip) return;
  const [lv, word] = hudStatus();
  const st = $('#hud-status');
  st.dataset.level = String(lv);
  st.textContent = word;
  $('#hud-height').textContent = 'Block ' + tip.height.toLocaleString();
  const [z, rest] = zeroSplit(tip.hash);
  $('#hud-hash').innerHTML = '';
  const zb = document.createElement('b');
  zb.textContent = z;
  $('#hud-hash').append(zb, document.createTextNode(rest.slice(0, 12) + '…'));
  const ago = Math.max(0, St.t - tip.born);
  const by = tip.miner ? M.node(tip.miner).name : '—';
  $('#hud-ago').textContent = (tip.kind === 'pos' ? 'proposed by ' : 'mined by ') + by + ', ' + (ago < 60 ? ago.toFixed(0) + ' s' : Math.floor(ago / 60) + ' min') + ' ago';
  let slots = null;
  if (St.mode === 'pos') {
    const have = new Set(M.canonicalChain(40).map((x) => x.slot));
    slots = Array.from({ length: 28 }, (_, i) => have.has(St.pos.slot - 27 + i));
  }
  W.drawIntervals($('#hud-bars'), St.mode === 'pow' ? St.intervals : null, M.knobs.blockTime, slots);
  $('#hud-bars-cap').textContent = St.mode === 'pow' ? 'time between recent blocks (dashed: the target)' : 'recent slots: filled = block, hollow = missed';

  const pow = St.mode === 'pow';
  $('#hud-cons').textContent = pow ? 'Proof of work' : 'Proof of stake';
  $('#hud-target-l').textContent = pow ? 'Target' : 'Slot';
  if (pow) {
    $('#hud-target').textContent = 'hash below ' + '0'.repeat(M.knobs.zeroBits >> 2) + 'ffff…';
    const rate = Math.pow(2, M.knobs.zeroBits) / M.knobs.blockTime;
    $('#hud-rate-l').textContent = 'Hash rate';
    $('#hud-rate').textContent = W.si(rate) + 'H/s in the model';
    $('#hud-rate-sub').textContent = 'your browser has done ' + W.si(St.realHashes) + ' real hashes';
  } else {
    const P = St.pos;
    const prop = P.proposers.get(P.slot);
    $('#hud-target').textContent = P.slot.toLocaleString() + ' · epoch ' + M.epochOf(P.slot) + ' · ' + (prop ? M.node(prop).name : '—');
    $('#hud-rate-l').textContent = 'Finalized';
    const fb = M.block(P.finalized);
    $('#hud-rate').textContent = fb ? 'block ' + fb.height.toLocaleString() + ' (' + (tip.height - fb.height) + ' behind the tip)' : '—';
    $('#hud-rate-sub').textContent = Math.round(100 * M.nodes.filter((n) => n.online && !n.slashed).reduce((a, n) => a + n.activeStake, 0) / M.totalStake()) + '% of stake online';
  }
  const mp = St.mempool.size;
  const vb = [...St.mempool.values()].reduce((a, t) => a + t.vsize, 0);
  $('#hud-mempool').textContent = mp + (mp === 1 ? ' payment' : ' payments') + ' waiting, ' + (vb / M.knobs.maxBlockVsize).toFixed(1) + ' blocks’ worth';
  $('#hud-fee').textContent = 'next block needs about ' + M.estimateFeeRate(1) + ' sat/vB';
  const tips = new Map();
  for (const n of M.nodes) if (n.online) tips.set(n.tip, (tips.get(n.tip) || 0) + 1);
  const online = M.nodes.filter((n) => n.online).length;
  $('#hud-agree').textContent = tips.size === 1 ? `all ${online} nodes on block ${tip.height}` : `${tips.size} versions of the newest block`;

  // Your payment
  const box = $('#hud-pay');
  if (S.tracked) {
    const s = M.txStatus(S.tracked);
    box.hidden = false;
    const tx = s.tx;
    const head = (tx.label ? tx.label + ': ' : 'Your payment: ') + M.node(tx.from).name + ' → ' + M.node(tx.toId).name + ', ' + fmtCoins(tx.amount) + ' coins at ' + Math.round(tx.feeRate) + ' sat/vB';
    $('#hud-pay-head').textContent = head;
    const el = $('#hud-pay-state');
    if (s.state === 'confirmed') { el.dataset.level = s.conf >= 6 ? '0' : '1'; el.textContent = s.conf + (s.conf === 1 ? ' confirmation' : ' confirmations') + ' (block ' + s.block.height + ')'; }
    else if (s.state === 'mempool') { el.dataset.level = '1'; el.textContent = 'waiting in the mempool, seen by ' + s.seenBy + ' of ' + M.nodes.length + ' nodes'; }
    else if (s.state === 'conflicted') { el.dataset.level = '4'; el.textContent = 'double-spent: no longer valid'; }
    else { el.dataset.level = '1'; el.textContent = 'sending…'; }
  } else box.hidden = true;

  $('#hud-compact').textContent = 'Block ' + tip.height.toLocaleString() + ' · ' + mp + ' waiting' + (S.tracked ? ' · your payment: ' + $('#hud-pay-state').textContent : '');
}

/* ----------------------------------------------------------------------------
 * Labels and tooltips
 * ------------------------------------------------------------------------- */

function nodeLine(n) {
  const M = model;
  if (!n.online) return 'offline';
  if (M.S.mode === 'pos') return (n.slashed ? 'slashed · ' : '') + Math.round(n.activeStake) + ' staked';
  if (n.hash) return Math.round(n.hash * 100) + '% of hash rate';
  if (M.S.attack && M.S.attack.node === n.id) return 'mining in secret';
  return fmtCoins(M.balance(n.id)) + ' coins';
}

function labelText() {
  const M = model;
  const out = {}, head = {};
  for (const n of M.nodes) out['node:' + n.id] = nodeLine(n);
  const tip = M.canonical;
  if (tip) {
    head.tip = 'Block ' + tip.height;
    out.tip = short(tip.hash, 12);
  }
  out.mempool = M.S.mempool.size + ' waiting';
  return { out, head };
}

function onHover(id, x, y) {
  const tip = $('#tip');
  if (!id) { tip.hidden = true; return; }
  const M = model;
  let title = '', sub = '';
  if (id.startsWith('node:')) {
    const n = M.node(id.slice(5));
    title = n.name;
    sub = { pool: 'mining pool', miner: 'home miner', exchange: 'exchange', shop: 'shop', person: 'runs a full node and a wallet' }[n.kind] + ' · ' + nodeLine(n);
  } else if (id.startsWith('block:')) {
    const b = M.block(id.slice(6));
    if (!b) { tip.hidden = true; return; }
    title = (b.forged ? 'Forged block ' : 'Block ') + b.height;
    sub = (b.private ? 'secret · ' : !b.canon ? 'not on the main chain · ' : '') + (b.txs.length - 1) + ' payments · ' + short(b.hash, 10);
  } else if (id === 'mempool') {
    title = 'Mempool';
    sub = M.S.mempool.size + ' payments waiting for a block';
  } else if (id === 'chain') {
    title = 'The chain';
    sub = 'older blocks sink below the floor';
  }
  tip.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = title;
  tip.appendChild(b);
  if (sub) tip.appendChild(document.createTextNode(' · ' + sub));
  const s = document.createElement('div');
  s.textContent = 'Click to read about it';
  s.style.opacity = '0.75';
  tip.appendChild(s);
  tip.hidden = false;
  tip.style.left = Math.min(x + 14, window.innerWidth - 270) + 'px';
  tip.style.top = (y + 16) + 'px';
}

/* ----------------------------------------------------------------------------
 * Story card
 * ------------------------------------------------------------------------- */

function showStory({ text, pause = false, head }) {
  const card = $('#story');
  card.hidden = false;
  const sc = BC.model.SCENARIOS.find((s) => s.id === model.S.scenario);
  $('#story-head-l').textContent = head || (sc ? sc.name : '');
  $('#story-head-r').textContent = model.S.mode === 'pos' ? 'proof of stake' : 'proof of work';
  $('#story-text').textContent = text;
  $('#story-continue').hidden = !pause;
  S.storyPaused = pause;
  const more = $('#story-more');
  const tid = 'sc-' + model.S.scenario;
  more.hidden = !EXP || !EXP.byId.has(tid);
  more.dataset.open = tid;
  positionStory();
}

function hideStory() { $('#story').hidden = true; }

function positionStory() {
  const d = $('#dock').getBoundingClientRect();
  $('#story').style.bottom = Math.round(window.innerHeight - d.top + 8) + 'px';
}

function wireStory() {
  $('#story-close').addEventListener('click', hideStory);
  $('#story-continue').addEventListener('click', () => {
    $('#story-continue').hidden = true;
    S.storyPaused = false;
    model.resume();
  });
}

/* ----------------------------------------------------------------------------
 * Dock
 * ------------------------------------------------------------------------- */

function runScenario(id) {
  model.runScenario(id);
  $('#k-scenario').value = id;
  $('#k-mode').value = model.S.mode;
  hideStory();
  const sc = BC.model.SCENARIOS.find((s) => s.id === id);
  if (id === 'normal') showStory({ text: sc.blurb, head: sc.name });
  S.playing = true;
  updatePlayButtons();
}

function sendPayment() {
  const amount = Math.round((0.004 + Math.random() * 0.012) * COIN / 1000) * 1000;
  const urgency = S.feeLevel;
  const rate = urgency === 'low' ? 1 : null;
  const tx = model.pay('ana', 'shop', amount, { urgency, feeRate: rate, track: true, label: 'Ana buys a coffee' });
  if (!tx) return;
  S.tracked = tx.id;
  if (scene) { scene.focus('node:ana'); }
  W.emit('pay', tx);
}

function updatePlayButtons() {
  document.querySelectorAll('[data-speed]').forEach((b) => {
    b.setAttribute('aria-pressed', String(S.playing && Number(b.dataset.speed) === S.speedIdx));
  });
  $('#pause').setAttribute('aria-pressed', String(!S.playing));
}

function setMode(mode) {
  model.setMode(mode);
  $('#k-mode').value = mode;
  if (model.S.scenario !== 'normal') {
    const sc = BC.model.SCENARIOS.find((s) => s.id === model.S.scenario);
    if (sc && sc.mode && sc.mode !== mode) { model.stopScenario(); model.S.scenario = 'normal'; $('#k-scenario').value = 'normal'; hideStory(); }
  }
}

function wireDock() {
  const sel = $('#k-scenario');
  for (const s of BC.model.SCENARIOS) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.name + (s.mode === 'pos' ? ' (stake)' : '');
    sel.appendChild(o);
  }
  sel.value = 'normal';
  sel.addEventListener('change', () => runScenario(sel.value));
  $('#k-mode').addEventListener('change', (e) => setMode(e.target.value));
  $('#pause').addEventListener('click', () => { S.playing = false; updatePlayButtons(); });
  document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    S.speedIdx = Number(b.dataset.speed);
    S.playing = true;
    updatePlayButtons();
  }));
  $('#pay').addEventListener('click', sendPayment);
  document.querySelectorAll('[data-fee]').forEach((b) => b.addEventListener('click', () => {
    S.feeLevel = b.dataset.fee;
    document.querySelectorAll('[data-fee]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  const toggle = (id, after) => {
    const b = $(id);
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      after(on);
    });
  };
  toggle('#tg-labels', (on) => { S.labels = on; });
  toggle('#tg-msgs', (on) => { S.messages = on; });
  toggle('#tg-views', (on) => { S.views = on; });
  toggle('#tg-rotate', (on) => scene && scene.autoRotate(on));
  $('#more').addEventListener('click', () => {
    const p = $('#more-panel');
    p.hidden = !p.hidden;
    $('#more').setAttribute('aria-expanded', String(!p.hidden));
    positionStory();
  });
  const knob = (id, key, fmt, parse = Number) => {
    const el = $('#k-' + id), out = $('#k-' + id + '-out');
    el.value = String(model.knobs[key]);
    out.textContent = fmt(model.knobs[key]);
    el.addEventListener('input', () => { model.setKnob(key, parse(el.value)); out.textContent = fmt(model.knobs[key]); });
  };
  knob('blocktime', 'blockTime', (v) => v + ' s');
  knob('latency', 'latency', (v) => v.toFixed(2) + ' s');
  knob('zeros', 'zeroBits', (v) => v + ' bits (1 in ' + W.si(Math.pow(2, v)) + ')');
  knob('rate', 'txRate', (v) => v.toFixed(2) + ' /s');
  knob('attack', 'attackShare', (v) => Math.round(v * 100) + '%');
  knob('confs', 'confirmations', (v) => String(v));
  $('#reset-view').addEventListener('click', () => { scene.focus('overview'); scene.setSelected(null); });

  const dock = $('#dock');
  const setDock = (open) => {
    dock.classList.toggle('collapsed', !open);
    $('#dock-toggle').setAttribute('aria-expanded', String(open));
    positionStory();
  };
  setDock(window.innerHeight >= 640 && window.innerWidth > 600);
  $('#dock-toggle').addEventListener('click', () => setDock(dock.classList.contains('collapsed')));
  // Narrow screens start with the readouts folded to one line.
  $('#hud-toggle').addEventListener('click', () => {
    const hud = $('#hud');
    const open = window.innerWidth <= 900 ? hud.classList.toggle('expanded-mobile') : !hud.classList.toggle('collapsed');
    $('#hud-toggle').setAttribute('aria-expanded', String(open));
  });
  if (window.innerWidth <= 900) $('#hud-toggle').setAttribute('aria-expanded', 'false');

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('input, select, textarea, button')) return;
    if (e.key === ' ') { e.preventDefault(); S.playing = !S.playing; updatePlayButtons(); }
  });
}

/* ----------------------------------------------------------------------------
 * Topics <-> scene
 * ------------------------------------------------------------------------- */

let mounted = [];
function onOpen(id, section) {
  unmountWidgets();
  const f = section.dataset.focus;
  if (f && scene) {
    scene.focus(f);
    scene.setSelected(f === 'overview' || f === 'network' ? null : f.startsWith('node:') || f === 'mempool' ? f : null);
  }
  if (id === 'blocks' && S.selectedBlock && scene) scene.setSelected('block:' + S.selectedBlock);
  section.querySelectorAll('[data-widget]').forEach((el) => {
    const h = W.mount(el.dataset.widget, el, ctx);
    if (h) mounted.push(h);
  });
  updateOffset();
}

function onClose() {
  unmountWidgets();
  if (scene) scene.setSelected(null);
  updateOffset();
}

function unmountWidgets() {
  for (const h of mounted) if (h.destroy) h.destroy();
  mounted = [];
}

function updateOffset() {
  if (!scene) return;
  const open = document.documentElement.classList.contains('xp-drawer-open');
  if (!open) { scene.setOffset(0, 0); return; }
  if (window.innerWidth > 900) scene.setOffset($('#xp-drawer').getBoundingClientRect().width / 2, 0);
  else scene.setOffset(0, Math.min(window.innerHeight * 0.78, 720) / 2);
}

/* ----------------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------------- */

const ctx = {
  get model() { return model; },
  get scene() { return scene; },
  get selectedBlock() { return S.selectedBlock; },
  set selectedBlock(h) { S.selectedBlock = h; if (scene) scene.setSelected(h ? 'block:' + h : null); },
  track(id) { S.tracked = id; },
  runScenario,
  setMode,
  sendPayment,
  get EXP() { return EXP; },
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

function booted() { document.documentElement.classList.remove('xp-booting'); }

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

async function boot() {
  if (!webglOK() || typeof BigInt === 'undefined') { booted(); return; }
  try {
    for (const src of ['../js/vendor/three/three.global.js', '../js/vendor/three/OrbitControls.global.js', 'media/blockchain/scene.js']) await loadScript(src);
  } catch (err) {
    console.error(err);
    booted();
    return;
  }
  try {
    model = BC.model.createModel();
    // Mine the genesis block and a short history first, a few milliseconds a
    // frame, as a new node would download the chain.
    // (A timer, not an animation frame, so a background tab still boots.)
    while (!model.warm(30)) await new Promise((r) => setTimeout(r, 0));
    scene = BC.scene.createScene($('#stage'), {
      model,
      labelLayer: $('#labels'),
      onPick(id) {
        if (id.startsWith('block:')) S.selectedBlock = id.slice(6);
        const topic = topicFor(id);
        if (topic && EXP && EXP.byId.has(topic)) {
          if (EXP.current === topic && id.startsWith('block:')) W.emit('selectBlock', id.slice(6));
          else EXP.open(topic);
        }
        scene.setSelected(id === 'chain' ? null : id);
        if (id.startsWith('node:')) scene.focus(id);
      },
      onHover,
    });
  } catch (err) {
    console.error(err);
    booted();
    return;
  }
  EXP = initExplainer({ onOpen, onClose });
  booted();
  // For poking at from the browser console.
  BC.app = { model, scene, ctx };
  const feeRamp = () => [1, 2, 3, 4, 5].map((i) => cssVar('--bc-fee' + i));
  scene.setTheme(isDark(), cssVar('--link'), feeRamp());
  onThemeChange(() => { scene.setTheme(isDark(), cssVar('--link'), feeRamp()); W.emit('theme'); });
  window.addEventListener('resize', () => { updateOffset(); positionStory(); });
  wireDock();
  wireStory();
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-run]');
    if (!b) return;
    const what = b.dataset.run;
    if (what === 'pay') sendPayment();
    else if (what.startsWith('mode:')) setMode(what.slice(5));
    else runScenario(what);
    if (window.innerWidth <= 900) EXP.close();
  });
  updatePlayButtons();

  let last = performance.now();
  let hudT = 1, labelT = 1;
  let view = { labels: true, messages: true, views: true, labelText: {}, labelHead: {} };
  const seenErrors = new Set();
  function loop(now) {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      const dt = S.playing && !S.storyPaused ? real * SPEEDS[S.speedIdx] : 0;
      if (dt > 0) {
        // Large steps would let messages skip past the scene; split them.
        const n = Math.ceil(dt / 0.05);
        for (let i = 0; i < n; i++) model.step(dt / n, 8 / n);
      }
      const events = model.drainEvents();
      for (const e of events) {
        if (e.type === 'story') showStory({ text: e.text, pause: e.pause });
        if (e.type === 'story' && e.focus && scene) scene.focus(e.focus === 'mallory' || e.focus === 'shop' ? 'node:' + e.focus : e.focus);
        if (e.type === 'canonReorg') S.lastReorg = model.S.t;
        if (e.type === 'scriptEnd') $('#story-continue').hidden = true;
      }
      scene.onEvents(events);
      W.emit('events', events);
      labelT += real;
      if (labelT > 0.25) {
        const lt = labelText();
        view = { labels: S.labels, messages: S.messages, views: S.views, labelText: lt.out, labelHead: lt.head, tracked: S.tracked };
        labelT = 0;
      }
      scene.frame(real, view);
      hudT += real;
      if (hudT > 0.2) { updateHUD(); hudT = 0; }
      W.tick(real, ctx);
    } catch (err) {
      const key = String(err && err.message);
      if (!seenErrors.has(key)) { seenErrors.add(key); console.error(err); }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  document.documentElement.classList.add('xp-running');
}

boot();

})(window.Blockchain = window.Blockchain || {});
