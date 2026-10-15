/*
 * knowledge/transistors.html: wires the process flow (process.js), the
 * device physics (physics.js), the 2D stage (xsection.js), the 3D scenes
 * (scene.js, loaded only if WebGL works), the charts (widgets.js) and the
 * explainer shell (js/explainer.js) together.
 *
 * The stage has three modes, picked by whichever topic is open:
 *   process  the cross-section after one step of the flow   (data-step)
 *   device   one biased transistor or MOS capacitor          (data-device)
 *   scene    a 3D scene: crystal growth, sawing, test,
 *            packaging, or a transistor architecture        (a step with a
 *                                                            station, or data-arch)
 * Unlike the power grid, the 2D stage needs no WebGL, so the app runs
 * without it; only the 3D scenes fall back to a note.
 */
(function (TR) {
'use strict';
const { init: initExplainer, cssVar, onThemeChange } = window.Explainer;
const F = TR.process;
const PH = TR.physics;
const W = TR.widgets;

const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* ----------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */

const S = {
  mode: 'process',
  step: 0,
  playing: false,
  scale: 'schematic',
  labels: 'all',
  arch: 'planar',
  station: null,
  device: {
    type: 'n', variant: 'mosfet', vg: 1.2, vd: 0.6, preset: 'nm130',
    params: Object.assign({}, PH.PRESETS.nm130.params),
  },
};

let devCache = null;
function deviceObjects() {
  const d = S.device;
  const key = JSON.stringify([d.type, d.params]);
  if (devCache && devCache.key === key) return devCache;
  const dev = PH.device(PH.asType(d.params, d.type));
  const planar = dev.p.arch === 'planar';
  const cap = PH.mosCap({
    body: d.type === 'n' ? 'p' : 'n', N: planar ? dev.p.N : Math.max(dev.p.N, 1e16),
    gateWF: dev.wf, stack: dev.stack, T: dev.p.T,
  });
  devCache = { key, dev, cap };
  return devCache;
}

// Voltage ranges for the device sliders, signed for the device type.
function ranges() {
  const { dev } = deviceObjects();
  const vdd = dev.p.vdd;
  const g = Math.max(2, 1.5 * vdd);
  const sgn = S.device.type === 'n' ? 1 : -1;
  return { vg: [-g, g], vd: sgn > 0 ? [0, 1.2 * vdd] : [-1.2 * vdd, 0], vdd, sgn };
}

/* ----------------------------------------------------------------------------
 * The stage
 * ------------------------------------------------------------------------- */

let xs = null;
let scene = null;
let EXP = null;
let topicDriving = false;     // a topic is setting the stage; don't bounce back

function setMode(mode) {
  S.mode = mode;
  document.documentElement.dataset.txMode = mode;
  const use3D = mode === 'scene';
  $('#xs-host').hidden = use3D;
  $('#scene-host').hidden = !use3D || !scene;
  $('#scene-fallback').hidden = !use3D || !!scene;
  if (scene) { if (use3D) scene.resume(); else scene.pause(); }
  renderDock();
  renderCard();
}

function goStep(i, { fromTopic = false, animate = true } = {}) {
  i = clamp(i, 0, F.STEPS.length - 1);
  S.step = i;
  const st = F.STEPS[i];
  if (st.station) {
    S.station = st.station;
    setMode('scene');
    if (scene) scene.show(st.station);
    else $('#scene-fallback-text').textContent = st.title + ': this step is a 3D scene, which needs WebGL. The step card has the details.';
  } else {
    S.station = null;
    if (S.mode !== 'process') setMode('process');
    xs.showStep(i, { animate });
  }
  renderCard();
  renderDockProcess();
  W.emit('step', i);
  // Follow along in the drawer if a process topic is open. A topic that only
  // borrows a step for its picture (the overview, the toolbox) stays put.
  if (!fromTopic && EXP && EXP.current && st.topic && st.topic !== EXP.current && STEP_TOPICS.has(EXP.current)) {
    topicDriving = true;
    EXP.open(st.topic);
    topicDriving = false;
  }
}
const STEP_TOPICS = new Set(F.STEPS.map((s) => s.topic));

function showDevice() {
  S.station = null;
  if (S.mode !== 'device') setMode('device');
  const { dev, cap } = deviceObjects();
  xs.showDevice({
    variant: S.device.variant, type: S.device.type, vg: S.device.vg, vd: S.device.vd,
    device: dev, cap, gateMat: dev.poly ? (S.device.type === 'n' ? 'npoly' : 'ppoly') : 'tin',
  });
  renderDockDevice();
}

function showArch(arch) {
  S.arch = arch;
  S.station = 'arch-' + arch;
  setMode('scene');
  renderCard();
  if (scene) scene.show('arch-' + arch);
  else $('#scene-fallback-text').textContent = 'This topic shows a 3D model of the transistor, which needs WebGL.';
  renderDockArch();
}

// Keep the drawing clear of the title, the step card, the dock and the drawer.
function layoutStage() {
  if (!xs) return;
  const wide = window.innerWidth > 900;
  const titleR = $('.xp-title').getBoundingClientRect();
  $('#card').style.top = (titleR.bottom + 8) + 'px';
  if (wide) $('#card').style.maxHeight = Math.max(160, $('#dock').getBoundingClientRect().top - titleR.bottom - 24) + 'px';
  else $('#card').style.maxHeight = '';
  const open = document.documentElement.classList.contains('xp-drawer-open');
  const dock = $('#dock').getBoundingClientRect();
  const card = $('#card');
  const title = $('.xp-title').getBoundingClientRect();
  let left = 0, top = title.bottom + 8;
  if (wide && !card.hidden && S.mode !== 'scene') {
    const r = card.getBoundingClientRect();
    if (r.width > 0) left = r.right + 4;
    top = 14;
  } else if (!card.hidden && S.mode !== 'scene') {
    top = card.getBoundingClientRect().bottom + 6;
  }
  const right = wide && open ? $('#xp-drawer').getBoundingClientRect().width : 0;
  const bottom = window.innerHeight - dock.top + (wide ? 8 : 4);
  const sheet = !wide && open ? Math.min(window.innerHeight * 0.78, 720) : 0;
  xs.setInsets({ left, top, right, bottom: Math.max(bottom, sheet) });
  if (scene) {
    if (wide) scene.setOffset(open ? right / 2 : 0, 0);
    else scene.setOffset(0, open ? sheet / 2 : 0);
  }
}

/* ----------------------------------------------------------------------------
 * Step card
 * ------------------------------------------------------------------------- */

function renderCard() {
  const card = $('#card');
  const isArch = S.station && S.station.startsWith('arch');
  if (!(S.mode === 'process' || (S.mode === 'scene' && S.station && !isArch))) {
    card.hidden = true;
    layoutStage();
    return;
  }
  card.hidden = false;
  const st = F.STEPS[S.step];
  const phase = F.PHASES.find((p) => p.id === st.phase);
  $('#card-phase').textContent = phase.name;
  $('#card-count').textContent = 'Step ' + (S.step + 1) + ' of ' + F.STEPS.length;
  $('#card-title').textContent = st.title;
  $('#card-text').textContent = st.text;
  $('#card-tool').textContent = st.tool;
  $('#card-cond').textContent = st.cond;
  $('#card-check').textContent = st.check;
  const more = $('#card-more');
  const topic = EXP && EXP.byId.get(st.topic);
  more.hidden = !topic;
  if (topic) {
    more.dataset.open = st.topic;
    more.textContent = 'Read: ' + (topic.dataset.title || st.topic) + ' →';
  }
  layoutStage();
}

/* ----------------------------------------------------------------------------
 * Dock
 * ------------------------------------------------------------------------- */

function renderDock() {
  const isArch = !!(S.station && S.station.startsWith('arch'));
  $('#dock-process').hidden = !(S.mode === 'process' || (S.mode === 'scene' && S.station && !isArch));
  $('#dock-device').hidden = S.mode !== 'device';
  $('#dock-arch').hidden = !(S.mode === 'scene' && isArch);
  $('#dock-view').hidden = S.mode !== 'process';
}

function buildTimeline() {
  const tl = $('#timeline');
  tl.textContent = '';
  for (const ph of F.PHASES) {
    const steps = F.STEPS.map((s, i) => [s, i]).filter(([s]) => s.phase === ph.id);
    const seg = document.createElement('div');
    seg.className = 'tx-seg';
    seg.style.flexGrow = String(steps.length);
    const lab = document.createElement('span');
    lab.className = 'tx-seg-name';
    lab.textContent = ph.name;
    const ticks = document.createElement('div');
    ticks.className = 'tx-ticks';
    for (const [s, i] of steps) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tx-tick';
      b.dataset.idx = i;
      b.setAttribute('aria-label', 'Step ' + (i + 1) + ': ' + s.title);
      b.title = (i + 1) + '. ' + s.title;
      b.addEventListener('click', () => { stopPlay(); goStep(i); });
      ticks.appendChild(b);
    }
    seg.appendChild(ticks);
    seg.appendChild(lab);
    tl.appendChild(seg);
  }
}

function renderDockProcess() {
  document.querySelectorAll('.tx-tick').forEach((b) => {
    const i = +b.dataset.idx;
    b.classList.toggle('done', i < S.step);
    b.setAttribute('aria-current', String(i === S.step));
  });
  $('#step-out').textContent = (S.step + 1) + ' / ' + F.STEPS.length;
  $('#prev').disabled = S.step === 0;
  $('#next').disabled = S.step === F.STEPS.length - 1;
  $('#play').textContent = S.playing ? '❚❚' : '▶';
  $('#play').setAttribute('aria-label', S.playing ? 'Pause' : 'Play through the steps');
}

function renderDockDevice() {
  const r = ranges();
  const vg = $('#k-vg'), vd = $('#k-vd');
  vg.min = r.vg[0]; vg.max = r.vg[1]; vg.step = 0.01; vg.value = S.device.vg;
  vd.min = r.vd[0]; vd.max = r.vd[1]; vd.step = 0.01; vd.value = S.device.vd;
  $('#k-vg-out').textContent = S.device.vg.toFixed(2) + ' V';
  $('#k-vd-out').textContent = S.device.vd.toFixed(2) + ' V';
  $('#f-vd').hidden = S.device.variant === 'moscap';
  document.querySelectorAll('[data-dtype]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dtype === S.device.type)));
  document.querySelectorAll('[data-dvariant]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dvariant === S.device.variant)));
  const { dev, cap } = deviceObjects();
  const st = cap.solve(S.device.vg);
  // The capacitor's threshold is the classic long-channel one; the
  // transistor's includes roll-off and DIBL at the present drain voltage.
  const vt = S.device.variant === 'moscap' ? cap.VT : (S.device.type === 'n' ? 1 : -1) * dev.VTat(Math.abs(S.device.vd));
  $('#dev-vt').textContent = vt.toFixed(2) + ' V';
  $('#dev-vfb').textContent = cap.Vfb.toFixed(2) + ' V';
  $('#dev-psi').textContent = st.psiS.toFixed(2) + ' V';
  const pre = PH.PRESETS[S.device.preset];
  $('#dev-name').textContent = (S.device.type === 'n' ? 'NMOS' : 'PMOS') + ' · ' + (pre ? pre.label : 'custom');
}

function renderDockArch() {
  document.querySelectorAll('[data-archbtn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.archbtn === S.arch)));
  if (scene) $('#tg-cut').setAttribute('aria-pressed', String(scene.cutaway));
}

let playTimer = 0;
function startPlay() {
  S.playing = true;
  renderDockProcess();
  clearInterval(playTimer);
  playTimer = setInterval(() => {
    if (S.step >= F.STEPS.length - 1) { stopPlay(); return; }
    goStep(S.step + 1);
  }, 2800);
}
function stopPlay() {
  if (!S.playing) return;
  S.playing = false;
  clearInterval(playTimer);
  renderDockProcess();
}

function setBias(vg, vd, { fromWidget = false } = {}) {
  const r = ranges();
  if (vg != null) S.device.vg = clamp(vg, r.vg[0], r.vg[1]);
  if (vd != null) S.device.vd = clamp(vd, r.vd[0], r.vd[1]);
  if (S.mode === 'device') showDevice();
  W.emit('bias', { vg: S.device.vg, vd: S.device.vd, fromWidget });
}

function setDevice(changes, { preset = null } = {}) {
  if (changes.type && changes.type !== S.device.type) {
    // Flip the bias with the device so the same "on" state carries over.
    S.device.vg = -S.device.vg;
    S.device.vd = -S.device.vd;
    S.device.type = changes.type;
  }
  if (changes.variant) S.device.variant = changes.variant;
  if (changes.params) S.device.params = Object.assign({}, S.device.params, changes.params);
  if (preset) { S.device.preset = preset; S.device.params = Object.assign({}, PH.PRESETS[preset].params); }
  else if (changes.params) S.device.preset = 'custom';
  devCache = null;
  setBias(S.device.vg, S.device.vd);
  if (S.mode === 'device') showDevice();
  W.emit('device', S.device);
}

function wireDock() {
  $('#prev').addEventListener('click', () => { stopPlay(); goStep(S.step - 1); });
  $('#next').addEventListener('click', () => { stopPlay(); goStep(S.step + 1); });
  $('#play').addEventListener('click', () => (S.playing ? stopPlay() : startPlay()));
  $('#tg-labels').addEventListener('click', (e) => {
    const order = ['all', 'new', 'off'];
    S.labels = order[(order.indexOf(S.labels) + 1) % order.length];
    xs.setLabels(S.labels === 'new' ? 'auto' : S.labels);
    e.currentTarget.textContent = 'Labels: ' + S.labels;
  });
  $('#tg-scale').addEventListener('click', (e) => {
    S.scale = S.scale === 'schematic' ? 'true' : 'schematic';
    xs.setScale(S.scale);
    e.currentTarget.setAttribute('aria-pressed', String(S.scale === 'true'));
  });
  $('#tg-fit').addEventListener('click', () => xs.fit());
  $('#k-vg').addEventListener('input', (e) => setBias(+e.target.value, null));
  $('#k-vd').addEventListener('input', (e) => setBias(null, +e.target.value));
  document.querySelectorAll('[data-dtype]').forEach((b) => b.addEventListener('click', () => setDevice({ type: b.dataset.dtype })));
  document.querySelectorAll('[data-dvariant]').forEach((b) => b.addEventListener('click', () => setDevice({ variant: b.dataset.dvariant })));
  document.querySelectorAll('[data-archbtn]').forEach((b) => b.addEventListener('click', () => showArch(b.dataset.archbtn)));
  $('#tg-cut').addEventListener('click', () => { if (scene) { scene.setCutaway(!scene.cutaway); renderDockArch(); } });
  // On phones the card starts folded to its title (CSS), and the button unfolds it.
  $('#card-toggle').addEventListener('click', () => {
    const c = $('#card');
    const narrow = window.innerWidth <= 900;
    const cls = narrow ? 'expanded-mobile' : 'collapsed';
    const on = !c.classList.contains(cls);
    c.classList.toggle(cls, on);
    $('#card-toggle').setAttribute('aria-expanded', String(narrow ? on : !on));
    layoutStage();
  });

  // Step links in the prose have no href (there is nowhere to go without the
  // app), so the browser skips them when tabbing. Make them buttons.
  document.querySelectorAll('#xp-library a[data-step]:not([href])').forEach((a) => {
    a.tabIndex = 0;
    a.setAttribute('role', 'button');
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('a[role="button"]')) { e.preventDefault(); e.target.click(); return; }
    if (e.key === 'ArrowRight' && (S.mode === 'process' || S.station)) { stopPlay(); goStep(S.step + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' && (S.mode === 'process' || S.station)) { stopPlay(); goStep(S.step - 1); e.preventDefault(); }
  });

  // Links inside topics: jump to a step, set a bias or preset, pick an architecture.
  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-step]:not(section)');
    if (s) { e.preventDefault(); stopPlay(); goStep(F.indexOf(s.dataset.step), { fromTopic: true }); if (window.innerWidth <= 900) EXP.close(); return; }
    const b = e.target.closest('[data-bias]');
    if (b) {
      e.preventDefault();
      const v = parseBias(b.dataset.bias);
      if (b.dataset.variant) S.device.variant = b.dataset.variant;
      if (S.mode !== 'device') showDevice();
      setBias(v.vg, v.vd);
      return;
    }
    const a = e.target.closest('[data-arch]:not(section)');
    if (a) { e.preventDefault(); showArch(a.dataset.arch); }
  });
}

function parseBias(str) {
  const o = {};
  for (const part of str.split(',')) {
    const [k, v] = part.split(':');
    if (v === 'vt') o[k] = deviceObjects().dev.VT0 + 0.0;
    else if (v === 'vdd') o[k] = (S.device.type === 'n' ? 1 : -1) * deviceObjects().dev.p.vdd;
    else if (v === 'vfb') o[k] = deviceObjects().cap.Vfb;
    else o[k] = parseFloat(v);
  }
  return o;
}

/* ----------------------------------------------------------------------------
 * Topics <-> stage
 * ------------------------------------------------------------------------- */

let mounted = [];
function onOpen(id, section) {
  unmountWidgets();
  if (!topicDriving) {
    const d = section.dataset;
    if (d.step) { stopPlay(); goStep(F.indexOf(d.step), { fromTopic: true }); }
    else if (d.device) {
      stopPlay();
      if (d.preset && d.preset !== S.device.preset) { S.device.preset = d.preset; S.device.params = Object.assign({}, PH.PRESETS[d.preset].params); devCache = null; }
      if (d.dtype) S.device.type = d.dtype;
      S.device.variant = d.device;
      if (d.bias) { const v = parseBias(d.bias); if (v.vg != null) S.device.vg = v.vg; if (v.vd != null) S.device.vd = v.vd; }
      showDevice();
    } else if (d.arch) { stopPlay(); showArch(d.arch); }
  }
  section.querySelectorAll('[data-widget]').forEach((el) => {
    const h = W.mount(el.dataset.widget, el, ctx);
    if (h) mounted.push(h);
  });
  requestAnimationFrame(layoutStage);
}

function onClose() {
  unmountWidgets();
  requestAnimationFrame(layoutStage);
}

function unmountWidgets() {
  for (const h of mounted) if (h.destroy) h.destroy();
  mounted = [];
}

/* ----------------------------------------------------------------------------
 * Tooltip
 * ------------------------------------------------------------------------- */

function onHover(info) {
  const tip = $('#tip');
  if (!info) { tip.hidden = true; return; }
  tip.textContent = '';
  const b = document.createElement('b');
  b.textContent = info.title;
  tip.appendChild(b);
  if (info.text) {
    const s = document.createElement('div');
    s.textContent = info.text;
    tip.appendChild(s);
  }
  tip.hidden = false;
  tip.style.left = Math.min(info.x + 14, window.innerWidth - 270) + 'px';
  tip.style.top = (info.y + 16) + 'px';
}

/* ----------------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------------- */

const ctx = {
  S, PH, F,
  get dev() { return deviceObjects().dev; },
  get cap() { return deviceObjects().cap; },
  setBias, setDevice, goStep: (id) => goStep(typeof id === 'string' ? F.indexOf(id) : id),
  showDevice, showArch,
  get scene() { return scene; },
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
  // The 2D stage first: if even this fails, the page stays an article.
  try {
    xs = TR.xsection.createXSection($('#xs-host'), {
      onHover,
      onShapeClick() {},
    });
  } catch (err) {
    console.error(err);
    booted();
    return;
  }
  // 3D is optional.
  if (webglOK()) {
    try {
      for (const src of ['../js/vendor/three/three.global.js', '../js/vendor/three/OrbitControls.global.js', 'media/transistors/scene.js']) await loadScript(src);
      scene = TR.scene.createScene($('#scene-host'), { ctx });
      scene.pause();
    } catch (err) {
      console.error(err);
      scene = null;
    }
  }
  // Switching to app mode moves the drawer off-screen; don't animate that.
  const drawerEl = $('#xp-drawer');
  drawerEl.style.transition = 'none';
  EXP = initExplainer({ onOpen, onClose });
  requestAnimationFrame(() => requestAnimationFrame(() => { drawerEl.style.transition = ''; }));
  buildTimeline();
  wireDock();
  booted();
  if (scene) {
    scene.setAccent(cssVar('--link'));
    onThemeChange(() => { scene.setAccent(cssVar('--link')); scene.setTheme(); W.emit('theme'); });
  } else onThemeChange(() => W.emit('theme'));
  window.addEventListener('resize', layoutStage);
  new MutationObserver(() => requestAnimationFrame(layoutStage)).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // With no topic in the URL, open the overview so a first visit starts with
  // how to use the page. Stamping its hash keeps the back button coming here.
  if (!EXP.byId.has(decodeURIComponent(location.hash.slice(1)))) {
    try { history.replaceState(null, '', '#overview'); } catch (e) {}
    EXP.open('overview', { push: false });
  }
  if (!EXP.current) goStep(S.step, { animate: false, fromTopic: true });
  setMode(S.mode);
  renderCard();
  layoutStage();

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    W.tick(dt, ctx);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.Transistors.app = { S, xs, get scene() { return scene; }, ctx };
}

boot();
})(window.Transistors);
