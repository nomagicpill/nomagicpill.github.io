/*
 * The 3D view for knowledge/draftblockchain.html: fourteen nodes on a ring,
 * the peer links between them with messages flying along, the blockchain as a
 * helix rising out of the middle (side branches stick out from it), and the
 * mempool as a pool of waiting payments around its base. Built from three.js
 * primitives (the classic build vendored in js/vendor/three, global THREE).
 * Becomes Blockchain.scene; main.js loads it only once three.js has loaded.
 *
 * The model (model.js) owns all state; this module only draws it. Coordinates:
 * y is up, the ring of nodes sits on a platform whose top is y = 0, and the
 * western half of the network (model's `west`) is at negative x.
 */
(function (BC, THREE) {
'use strict';
const { OrbitControls } = THREE;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));

const RING = 128;                 // node radius
const PLATFORM = 182;
const POOL_IN = 54, POOL_OUT = 90;
const HELIX = { r0: 17, lane: 11.5, step: 0.56, dy: 4.6, top: 50, show: 14 };

// Camera framings: [target, offset from target].
const VIEWS = {
  overview: [[0, 8, 6], [0, 235, 300]],
  network: [[0, 0, 0], [0, 420, 90]],
  chain: [[0, 34, 0], [78, 34, 118]],
  mempool: [[0, 0, 62], [0, 92, 132]],
};

const LANE_COLORS = ['#8a8a85', '#e8833a', '#14a3a3', '#c45ab3'];
const PERSON_COLORS = { ana: '#d9534f', ben: '#3a7bd5', chen: '#2e9e5b', dara: '#c98a1b', eli: '#7b5cc4', mallory: '#3b3b44' };

function createScene(container, { model, onPick, onHover, labelLayer } = {}) {
  const M = model;
  const mobile = window.matchMedia('(max-width: 900px)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '3D model of a peer-to-peer network keeping a blockchain. Drag to orbit, scroll or pinch to zoom, click a node, a block or the mempool to read about it.');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffffff');
  scene.fog = new THREE.Fog(scene.background.clone(), 520, 1300);
  const camera = new THREE.PerspectiveCamera(38, 1, 2, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 25;
  controls.maxDistance = 800;
  controls.maxPolarAngle = 1.45;
  controls.screenSpacePanning = false;
  controls.maxTargetRadius = 260;
  controls.autoRotateSpeed = 0.35;

  const hemi = new THREE.HemisphereLight('#ffffff', '#8c8a84', 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(180, 320, 140);
  scene.add(sun);

  /* ----- Theme ----- */
  const T = {};
  function readTheme(dark) {
    Object.assign(T, dark ? {
      bg: '#121212', platform: '#24262b', rim: '#303339', pool: '#1b4a6b', well: '#101113', edge: '#4a525e', edgeCut: '#d0453d',
      building: '#5d6878', roof: '#454e5a', pad: '#2d3036', ink: '#c9c9c4', lights: '#6fe0ff', desk: '#5a4a3a', glass: '#9fb7cf',
    } : {
      bg: '#ffffff', platform: '#ecebe6', rim: '#d9d7cf', pool: '#b9d5ea', well: '#8d8a83', edge: '#bdbbb3', edgeCut: '#d0453d',
      building: '#aeb7c4', roof: '#7f8a99', pad: '#dcdad3', ink: '#3a3a38', lights: '#1aa3d9', desk: '#9c7b5a', glass: '#c9dbe9',
    });
    T.dark = dark;
  }
  readTheme(false);

  /* ----- Platform ----- */
  const mats = {};
  const std = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0.05 }, extra));
  mats.platform = std('#ecebe6');
  mats.rim = std('#d9d7cf');
  mats.pool = std('#a9cbe4', { transparent: true, opacity: 0.75, roughness: 0.3 });
  mats.well = std('#4a4a48', { roughness: 1 });
  mats.building = std('#aeb7c4');
  mats.roof = std('#7f8a99');
  mats.pad = std('#dcdad3');
  mats.desk = std('#9c7b5a');
  mats.glass = std('#c9dbe9', { roughness: 0.2 });
  mats.white = std('#f4f3ef');
  mats.awningA = std('#d9534f');
  mats.awningB = std('#f4f3ef');
  mats.shroud = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false });
  mats.edge = new THREE.MeshBasicMaterial({ color: '#a3a39b', transparent: true, opacity: 0.85 });
  mats.edgeCut = new THREE.MeshBasicMaterial({ color: '#d0453d', transparent: true, opacity: 0.35 });

  const platform = new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM, PLATFORM + 4, 10, 120), mats.platform);
  platform.position.y = -5;
  scene.add(platform);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(PLATFORM + 1, 1.6, 8, 160), mats.rim);
  rim.rotation.x = Math.PI / 2;
  scene.add(rim);
  const pool = new THREE.Mesh(new THREE.RingGeometry(POOL_IN, POOL_OUT, 120, 1), mats.pool);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.12;
  pool.userData.id = 'mempool';
  scene.add(pool);
  const well = new THREE.Mesh(new THREE.CircleGeometry(HELIX.r0 + 9, 64), mats.well);
  well.rotation.x = -Math.PI / 2;
  well.position.y = 0.14;
  well.userData.id = 'chain';
  scene.add(well);

  /* ----- Nodes ----- */
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 18);
  const SPH = new THREE.SphereGeometry(1, 16, 12);
  const part = (g, mat, x, y, z, sx, sy, sz, parent) => {
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };

  const NV = {};          // per-node visuals
  const pickables = [pool, well];

  for (const n of M.nodes) {
    const g = new THREE.Group();
    const pos = new THREE.Vector3(n.x * RING, 0, n.z * RING);
    g.position.copy(pos);
    g.lookAt(0, 0, 0);
    scene.add(g);
    const v = { n, g, pos, fans: [], lights: null, top: 12, screen: null };
    part(CYL, mats.pad, 0, 0.6, 0, 14, 1.2, 14, g);
    if (n.kind === 'pool' || n.kind === 'miner') {
      const small = n.kind === 'miner';
      const w = small ? 11 : 22, h = small ? 6 : 9, d = small ? 9 : 14;
      part(BOX, mats.building, 0, 1.2 + h / 2, 0, w, h, d, g);
      part(BOX, mats.roof, 0, 1.2 + h + 0.4, 0, w + 1, 0.8, d + 1, g);
      v.lightMat = new THREE.MeshBasicMaterial({ color: '#1aa3d9' });
      v.lights = part(BOX, v.lightMat, 0, 1.2 + h * 0.45, d / 2 + 0.06, w * 0.82, h * 0.18, 0.2, g);
      const nf = small ? 1 : 3;
      for (let i = 0; i < nf; i++) {
        const fx = small ? 0 : (i - 1) * 6.5;
        const housing = part(CYL, mats.roof, fx, 1.2 + h + 1.2, 0, 2.6, 0.9, 2.6, g);
        const blade = part(BOX, mats.white, fx, 1.2 + h + 1.75, 0, 4.4, 0.2, 0.9, g);
        const blade2 = part(BOX, mats.white, fx, 1.2 + h + 1.75, 0, 0.9, 0.2, 4.4, g);
        v.fans.push(blade, blade2);
        housing.userData.fan = true;
      }
      v.top = 1.2 + h + 3;
    } else if (n.kind === 'exchange') {
      part(BOX, mats.white, 0, 1.9, 0, 22, 1.4, 16, g);
      part(BOX, mats.white, 0, 3.1, 0, 20, 1.2, 14, g);
      for (let i = 0; i < 5; i++) part(CYL, mats.white, (i - 2) * 4.2, 8.2, 5, 0.9, 9.4, 0.9, g);
      part(BOX, mats.building, 0, 8.2, -1.5, 18, 9.4, 9, g);
      part(BOX, mats.white, 0, 13.4, 0.5, 21, 1.2, 14, g);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 20, 3), mats.white);
      ped.rotation.z = Math.PI / 2;
      ped.rotation.x = Math.PI / 2;
      ped.scale.set(1, 1, 0.55);
      ped.position.set(0, 16, 0.5);
      g.add(ped);
      v.top = 20;
    } else if (n.kind === 'shop') {
      part(BOX, mats.building, 0, 5.2, -1, 15, 8, 10, g);
      for (let i = 0; i < 6; i++) {
        const a = part(BOX, i % 2 ? mats.awningB : mats.awningA, -6.25 + i * 2.5, 8.3, 5.4, 2.5, 0.4, 4.2, g);
        a.rotation.x = 0.35;
      }
      part(BOX, mats.glass, 0, 4.2, 4.05, 11, 4.6, 0.2, g);
      v.top = 13;
    } else {
      // A person at a laptop.
      const desk = part(BOX, mats.desk, 0, 4.6, 1.5, 9, 0.6, 5, g);
      desk.userData.desk = true;
      part(BOX, mats.desk, -3.8, 2.4, 1.5, 0.6, 4, 4, g);
      part(BOX, mats.desk, 3.8, 2.4, 1.5, 0.6, 4, 4, g);
      part(BOX, mats.roof, 0, 5.05, 1.6, 4.4, 0.3, 3, g);
      v.screenMat = new THREE.MeshBasicMaterial({ color: '#888888' });
      const scr = part(BOX, v.screenMat, 0, 6.8, 3.0, 4.4, 3.2, 0.25, g);
      scr.rotation.x = -0.25;
      v.screen = scr;
      const body = std(PERSON_COLORS[n.id] || '#888888');
      part(CYL, body, 0, 4.4, -2.6, 1.7, 5.2, 1.4, g);
      part(SPH, std('#e3b896'), 0, 8.4, -2.6, 1.5, 1.6, 1.5, g);
      if (n.id === 'mallory') {
        const hood = part(SPH, body, 0, 8.7, -2.9, 1.75, 1.8, 1.75, g);
        hood.scale.y = 1.7;
      }
      v.top = 11;
    }
    // Status light: the colour of the block this node believes is newest.
    v.statusMat = new THREE.MeshBasicMaterial({ color: '#888888' });
    v.status = part(SPH, v.statusMat, 0, v.top + 3.2, 0, 1.5, 1.5, 1.5, g);
    v.anchor = new THREE.Vector3(pos.x, v.top + 7, pos.z);
    v.lightPos = new THREE.Vector3(pos.x, v.top + 3.2, pos.z);
    // Pick volume
    const pick = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ visible: false }));
    pick.scale.set(26, v.top + 6, 26);
    pick.position.set(0, (v.top + 6) / 2, 0);
    g.add(pick);
    pick.userData.id = 'node:' + n.id;
    pick.userData.size = 26;
    pickables.push(pick);
    // Shown over a node that is offline.
    v.shroud = part(CYL, mats.shroud, 0, (v.top + 5) / 2, 0, 15, v.top + 5, 15, g);
    v.shroud.visible = false;
    NV[n.id] = v;
  }

  /* ----- Peer links ----- */
  const EV = [];
  for (const e of M.edges) {
    const a = NV[e.a].pos, b = NV[e.b].pos;
    const ya = NV[e.a].top + 1, yb = NV[e.b].top + 1;
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const long = e.len > 1.2;
    const ctrl = new THREE.Vector3(mid.x * (long ? 0.6 : 0.9), (long ? 82 : 10) + e.len * 14, mid.z * (long ? 0.6 : 0.9));
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(a.x, ya, a.z), ctrl, new THREE.Vector3(b.x, yb, b.z));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, long ? 48 : 20, long ? 0.26 : 0.32, 6, false), mats.edge);
    scene.add(tube);
    EV.push({ e, curve, tube });
  }
  const curveFor = (from, to) => {
    for (const x of EV) {
      if (x.e.a === from && x.e.b === to) return { curve: x.curve, rev: false };
      if (x.e.a === to && x.e.b === from) return { curve: x.curve, rev: true };
    }
    return null;
  };

  /* ----- Messages in flight ----- */
  const MAX_TX = 500, MAX_BLK = 160;
  const txDots = new THREE.InstancedMesh(new THREE.SphereGeometry(1.9, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }), MAX_TX);
  txDots.frustumCulled = false;
  const blkDots = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 2.8, 6), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }), MAX_BLK);
  blkDots.frustumCulled = false;
  scene.add(txDots, blkDots);
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
  for (let i = 0; i < MAX_TX; i++) txDots.setColorAt(i, _c.set('#ffffff'));
  for (let i = 0; i < MAX_BLK; i++) blkDots.setColorAt(i, _c.set('#ffffff'));

  /* ----- Mempool chips ----- */
  const MAX_CHIPS = 320;
  const chips = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), MAX_CHIPS);
  chips.frustumCulled = false;
  scene.add(chips);
  for (let i = 0; i < MAX_CHIPS; i++) chips.setColorAt(i, _c.set('#ffffff'));
  const chipState = new Map();   // txid -> { x, z, a, born, leaving, to, t }

  // Fee rate -> colour: a sequential ramp, cool (cheap) to hot (urgent). The
  // page's --bc-fee* tokens supply it (see setTheme), so legends match.
  let FEE_RAMP = ['#ef9a68', '#e67a3e', '#cf5d24', '#a2461b', '#733213'];
  // Same bins as the page's legend: 1-3, 4-9, 10-29, 30-59, 60+ sat/vB.
  function feeColor(rate, out) {
    const i = rate < 4 ? 0 : rate < 10 ? 1 : rate < 30 ? 2 : rate < 60 ? 3 : 4;
    return out.set(FEE_RAMP[i]);
  }

  /* ----- Blocks ----- */
  const BLOCK_GEO = new THREE.BoxGeometry(9.5, 3.6, 9.5);
  const EDGE_GEO = new THREE.EdgesGeometry(new THREE.BoxGeometry(10.6, 4.6, 10.6));
  const LINK_GEO = new THREE.CylinderGeometry(0.55, 0.55, 1, 8);
  const blocks = new Map();     // hash -> visual
  const blockGroup = new THREE.Group();
  scene.add(blockGroup);

  function hashHue(hash) { return (parseInt(hash.slice(-6), 16) % 360) / 360; }

  function blockColor(b, out) {
    if (!b.valid) return out.set('#d0453d');
    return out.setHSL(hashHue(b.hash), T.dark ? 0.5 : 0.55, T.dark ? 0.52 : 0.56);
  }

  function makeBlockVisual(b) {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.1, transparent: true });
    const mesh = new THREE.Mesh(BLOCK_GEO, mat);
    mesh.userData.id = 'block:' + b.hash;
    mesh.userData.size = 10;
    const linkMat = new THREE.MeshBasicMaterial({ color: '#8a8a85', transparent: true });
    const link = new THREE.Mesh(LINK_GEO, linkMat);
    const collar = new THREE.LineSegments(EDGE_GEO, new THREE.LineBasicMaterial({ color: '#e0b030' }));
    collar.visible = false;
    mesh.add(collar);
    blockGroup.add(mesh, link);
    pickables.push(mesh);
    const v = { b, mesh, mat, link, linkMat, collar, pos: new THREE.Vector3(), target: new THREE.Vector3(), fly: null, alpha: 0 };
    blocks.set(b.hash, v);
    return v;
  }

  function dropBlockVisual(v) {
    blockGroup.remove(v.mesh, v.link);
    v.mat.dispose();
    v.linkMat.dispose();
    v.collar.material.dispose();
    const i = pickables.indexOf(v.mesh);
    if (i >= 0) pickables.splice(i, 1);
    blocks.delete(v.b.hash);
  }

  function helixPos(height, lane, tipH, out) {
    const a = height * HELIX.step;
    const r = HELIX.r0 + lane * HELIX.lane;
    return out.set(r * Math.cos(a), HELIX.top - (tipH - height) * HELIX.dy, r * Math.sin(a));
  }

  /* ----- Proof-of-stake furniture: stake stacks and the proposer's beam ----- */
  const MAX_COINS = 260;
  const coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(3.1, 3.1, 1.2, 24), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.5 }), MAX_COINS);
  coins.frustumCulled = false;
  scene.add(coins);
  for (let i = 0; i < MAX_COINS; i++) coins.setColorAt(i, _c.set('#e0b030'));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 6, 90, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#f5c542', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  scene.add(beam);
  let beamAt = null, beamT = 0;

  /* ----- Effects: pulses and attestation sparks ----- */
  const pulses = [];
  const PULSE_GEO = new THREE.RingGeometry(0.85, 1, 48);
  function pulse(pos, color, size = 22, dur = 1.1, y = 0.4) {
    const m = new THREE.Mesh(PULSE_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, y, pos.z);
    scene.add(m);
    pulses.push({ m, t: 0, dur, size });
  }
  const sparks = [];
  const MAX_SPARKS = 120;
  const sparkMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ color: '#f5c542' }), MAX_SPARKS);
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  /* ----- Lines from each node to the block it believes is newest ----- */
  const tipGeo = new THREE.BufferGeometry();
  const tipPos = new Float32Array(M.nodes.length * 6), tipCol = new Float32Array(M.nodes.length * 6);
  tipGeo.setAttribute('position', new THREE.BufferAttribute(tipPos, 3));
  tipGeo.setAttribute('color', new THREE.BufferAttribute(tipCol, 3));
  const tipLines = new THREE.LineSegments(tipGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }));
  tipLines.frustumCulled = false;
  scene.add(tipLines);

  /* ----- Selection ring ----- */
  const selRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 64), new THREE.MeshBasicMaterial({ color: '#2563eb' }));
  selRing.rotation.x = Math.PI / 2;
  selRing.visible = false;
  scene.add(selRing);
  let selected = null;

  /* ----- Labels ----- */
  const labels = {};
  function addLabel(id, title) {
    if (!labelLayer) return null;
    const el = document.createElement('div');
    el.className = 'xp-label';
    el.innerHTML = '<b></b><small></small>';
    el.querySelector('b').textContent = title;
    el.addEventListener('click', (e) => { e.stopPropagation(); if (onPick) onPick(id); });
    labelLayer.appendChild(el);
    labels[id] = { el, title: el.querySelector('b'), sub: el.querySelector('small'), text: '', head: title, anchor: new THREE.Vector3() };
    return labels[id];
  }
  for (const n of M.nodes) addLabel('node:' + n.id, n.name);
  addLabel('tip', 'Newest block');
  addLabel('mempool', 'Mempool');

  /* ----- Camera ----- */
  let tween = null;
  const offset = { x: 0, y: 0, tx: 0, ty: 0 };

  function viewFor(id) {
    let target, rel;
    if (VIEWS[id]) { target = new THREE.Vector3(...VIEWS[id][0]); rel = new THREE.Vector3(...VIEWS[id][1]); }
    else if (id && id.startsWith('node:') && NV[id.slice(5)]) {
      // Look at the node from outside the ring, with the chain behind it.
      const p = NV[id.slice(5)].pos;
      target = new THREE.Vector3(p.x * 0.72, 10, p.z * 0.72);
      rel = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(125).add(new THREE.Vector3(0, 92, 0));
    } else if (id && id.startsWith('block:') && blocks.has(id.slice(6))) {
      const p = blocks.get(id.slice(6)).pos;
      target = p.clone();
      rel = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(100).add(new THREE.Vector3(0, 42, 0));
      if (rel.lengthSq() < 1) rel.set(0, 42, 100);
    } else return viewFor('overview');
    const pos = target.clone().add(rel);
    // Phones: back off, much more in portrait, where the ring is widest
    // relative to the screen.
    const portrait = camera.aspect < 0.8;
    if (mobile || portrait) pos.sub(target).multiplyScalar(portrait ? (id === 'overview' || id === 'network' ? 1.75 : 1.4) : 1.25).add(target);
    return { target, pos };
  }

  function focus(id, instant = false) {
    if (id && NV[id]) id = 'node:' + id;
    const { target, pos } = viewFor(id);
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      controls.target.copy(target);
      camera.position.copy(pos);
      controls.update();
      tween = null;
      return;
    }
    tween = { t: 0, dur: 1.3, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target, toP: pos };
  }

  /* ----- Picking ----- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, false).filter((h) => h.object.visible !== false || h.object.userData.id.startsWith('node:'));
    if (!hits.length) return null;
    // Blocks and nodes win over the floor they stand on.
    const rank = (id) => (id.startsWith('block:') ? 0 : id.startsWith('node:') ? 1 : 2);
    hits.sort((a, b) => rank(a.object.userData.id) - rank(b.object.userData.id) || a.distance - b.distance);
    return hits[0].object.userData.id;
  }

  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved < 6 && onPick) {
      const id = pickAt(e.clientX, e.clientY);
      if (id) onPick(id);
    }
  });
  let hoverT = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !onHover) return;
    const t = performance.now();
    if (t - hoverT < 60) return;
    hoverT = t;
    const id = down ? null : pickAt(e.clientX, e.clientY);
    renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    onHover(id, e.clientX, e.clientY);
  });
  renderer.domElement.addEventListener('pointerleave', () => { if (onHover) onHover(null); });
  controls.addEventListener('start', () => { tween = null; controls.autoRotate = false; });

  /* ----- Resize ----- */
  let vw = 1, vh = 1;
  function resize() {
    vw = container.clientWidth || window.innerWidth;
    vh = container.clientHeight || window.innerHeight;
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.fov = camera.aspect < 0.8 ? 54 : 38;
    applyOffset();
  }
  function applyOffset() {
    if (Math.abs(offset.x) > 0.5 || Math.abs(offset.y) > 0.5) camera.setViewOffset(vw, vh, offset.x, offset.y, vw, vh);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  focus('overview', true);

  /* ----- Theme ----- */
  function setTheme(dark, accent, feeRamp) {
    readTheme(dark);
    if (feeRamp && feeRamp.every(Boolean)) FEE_RAMP = feeRamp;
    scene.background.set(T.bg);
    scene.fog.color.set(T.bg);
    mats.platform.color.set(T.platform);
    mats.rim.color.set(T.rim);
    mats.pool.color.set(T.pool);
    mats.well.color.set(T.well);
    mats.building.color.set(T.building);
    mats.roof.color.set(T.roof);
    mats.pad.color.set(T.pad);
    mats.desk.color.set(T.desk);
    mats.glass.color.set(T.glass);
    mats.edge.color.set(T.edge);
    hemi.intensity = dark ? 1.1 : 1.6;
    hemi.groundColor.set(dark ? '#202020' : '#8c8a84');
    sun.intensity = dark ? 1.2 : 1.6;
    txDots.material.color.set(dark ? '#ffffff' : '#ffffff');
    if (accent) selRing.material.color.set(accent);
    for (const v of blocks.values()) v.colorKey = null;
  }

  /* ----------------------------------------------------------------------
   * Per-frame update
   * ------------------------------------------------------------------- */
  let time = 0;
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let lastTipH = null;
  let ready = false;

  function frame(dt, view) {
    time += dt;
    dt = Math.min(dt, 0.1);
    if (tween) {
      tween.t += dt / tween.dur;
      const k = ease(tween.t);
      controls.target.lerpVectors(tween.fromT, tween.toT, k);
      camera.position.lerpVectors(tween.fromP, tween.toP, k);
      if (tween.t >= 1) tween = null;
    }
    controls.update();
    offset.x += (offset.tx - offset.x) * Math.min(1, dt * 8);
    offset.y += (offset.ty - offset.y) * Math.min(1, dt * 8);
    applyOffset();

    const S = M.S;
    const tip = M.canonical;
    if (!tip) { renderer.render(scene, camera); return; }

    updateBlocks(dt, tip, view);
    updateNodes(dt, view);
    updateEdges();
    updateMessages(view);
    updateMempool(dt, tip, view);
    updateStake(dt);
    updateEffects(dt);
    updateTipLines(view);
    updateSelection();
    ready = true;

    renderer.render(scene, camera);
    placeLabels(view, tip);
  }

  function updateBlocks(dt, tip, view) {
    const S = M.S;
    const tipH = tip.height;
    if (lastTipH === null) lastTipH = tipH;
    lastTipH += (tipH - lastTipH) * Math.min(1, dt * 4);
    const lo = tipH - HELIX.show;
    const live = new Set();
    for (const b of S.blocks.values()) {
      if (b.height < lo || b.height > tipH + 12) continue;
      live.add(b.hash);
      let v = blocks.get(b.hash);
      if (!v) {
        v = makeBlockVisual(b);
        helixPos(b.height, b.lane, lastTipH, v.target);
        // New blocks rise out of the node that made them.
        const maker = b.miner && NV[b.miner];
        if (maker && ready && S.t - b.born < 2) {
          v.pos.set(maker.pos.x, maker.top + 6, maker.pos.z);
          v.fly = { t: 0, from: v.pos.clone() };
        } else {
          v.pos.copy(v.target);
        }
      }
      helixPos(b.height, b.lane, lastTipH, v.target);
      if (v.fly) {
        v.fly.t += dt / 1.3;
        const k = ease(v.fly.t);
        v.pos.lerpVectors(v.fly.from, v.target, k);
        v.pos.y += Math.sin(Math.PI * Math.min(1, v.fly.t)) * 38;
        if (v.fly.t >= 1) v.fly = null;
      } else {
        v.pos.lerp(v.target, Math.min(1, dt * 5));
      }
      v.mesh.position.copy(v.pos);
      v.mesh.rotation.y = -b.height * HELIX.step;
      // Colour and look: stale branches are faded, Mallory's secret chain is
      // a ghost, invalid blocks are red and pulse.
      const key = (b.valid ? 1 : 0) + '|' + b.canon + '|' + !!b.private + '|' + T.dark;
      if (v.colorKey !== key) {
        v.colorKey = key;
        blockColor(b, v.mat.color);
        if (!b.canon && b.valid && !b.private) v.mat.color.lerp(_c.set(T.dark ? '#555555' : '#cccccc'), 0.45);
        v.mat.emissive.set(b.private ? '#5a2a8a' : '#000000');
      }
      const below = v.pos.y < -1;
      const targetAlpha = below ? 0 : b.private ? 0.42 : !b.valid ? 0.95 : b.canon ? 1 : 0.7;
      v.alpha += (targetAlpha - v.alpha) * Math.min(1, dt * 6);
      v.mat.opacity = v.alpha;
      v.mat.depthWrite = v.alpha > 0.9;
      v.mesh.visible = v.alpha > 0.02;
      if (!b.valid) v.mat.emissive.setRGB(0.35 + 0.25 * Math.sin(time * 6), 0.05, 0.05);
      // Finality (proof of stake): gold frame when final, silver when justified.
      v.collar.visible = !!(b.finalized || b.justified) && b.kind === 'pos';
      if (v.collar.visible) v.collar.material.color.set(b.finalized ? '#e0b030' : '#b8bcc4');
    }
    // Links from each block down to its parent.
    for (const v of blocks.values()) {
      const p = M.parentOf(v.b);
      const pv = p ? blocks.get(p.hash) : null;
      if (!pv || !v.mesh.visible) { v.link.visible = false; continue; }
      v.link.visible = true;
      tmpV.subVectors(v.pos, pv.pos);
      const len = tmpV.length();
      v.link.position.addVectors(v.pos, pv.pos).multiplyScalar(0.5);
      v.link.scale.set(1, Math.max(0.01, len - 3.6), 1);
      v.link.quaternion.setFromUnitVectors(up, tmpV.normalize());
      v.linkMat.color.set(v.b.private ? '#8a5cc4' : !v.b.valid ? '#d0453d' : v.b.canon ? T.ink : LANE_COLORS[v.b.lane % 4]);
      v.linkMat.opacity = Math.min(v.alpha, pv.alpha) * (v.b.canon ? 0.8 : 0.6);
    }
    for (const [h, v] of blocks) if (!live.has(h)) dropBlockVisual(v);
  }

  function updateNodes(dt, view) {
    const S = M.S;
    const pos = S.mode === 'pos';
    for (const n of M.nodes) {
      const v = NV[n.id];
      const t = M.block(n.tip);
      if (t) blockColor(t, v.statusMat.color);
      if (!n.online) v.statusMat.color.set('#555555');
      if (v.screenMat) {
        v.screenMat.color.copy(v.statusMat.color);
        if (!n.online) v.screenMat.color.set('#222222');
      }
      const busy = S.jobs.some((j) => j.n === n);
      const spin = !pos && n.online && (n.hash > 0 || (S.attack && S.attack.node === n.id)) ? 4 + 18 * n.hash : 0;
      for (const f of v.fans) f.rotation.y += spin * dt;
      if (v.lightMat) {
        const on = !pos && n.online;
        v.lightMat.color.set(on ? T.lights : '#444444');
        if (on && busy) v.lightMat.color.set('#ffffff');
        else if (on) v.lightMat.color.lerp(_c.set('#ffffff'), 0.25 + 0.25 * Math.sin(time * (6 + n.index)));
      }
      v.shroud.visible = !n.online;
    }
  }

  function updateEdges() {
    const S = M.S;
    for (const x of EV) {
      const cut = (S.partition && x.e.cross) || !M.node(x.e.a).online || !M.node(x.e.b).online;
      const mat = cut ? mats.edgeCut : mats.edge;
      if (x.tube.material !== mat) x.tube.material = mat;
    }
  }

  function updateMessages(view) {
    const S = M.S;
    let nt = 0, nb = 0;
    if (view.messages !== false) {
      for (const m of S.messages) {
        const c = curveFor(m.from, m.to);
        if (!c) continue;
        const u = clamp((S.t - m.t0) / (m.t1 - m.t0), 0, 1);
        c.curve.getPoint(c.rev ? 1 - u : u, _p);
        if (m.kind === 'tx' && nt < MAX_TX) {
          _m4.compose(_p, _q.identity(), _s.setScalar(m.id === view.tracked ? 2 : 1));
          txDots.setMatrixAt(nt, _m4);
          feeColor(m.feeRate || 1, _c);
          txDots.setColorAt(nt, _c);
          nt++;
        } else if (m.kind === 'block' && nb < MAX_BLK) {
          _m4.compose(_p, _q.setFromAxisAngle(up, time * 2), _s.setScalar(1));
          blkDots.setMatrixAt(nb, _m4);
          const b = M.block(m.id);
          if (b) blockColor(b, _c); else _c.set('#888888');
          blkDots.setColorAt(nb, _c);
          nb++;
        }
      }
    }
    txDots.count = nt;
    blkDots.count = nb;
    txDots.instanceMatrix.needsUpdate = true;
    blkDots.instanceMatrix.needsUpdate = true;
    if (txDots.instanceColor) txDots.instanceColor.needsUpdate = true;
    if (blkDots.instanceColor) blkDots.instanceColor.needsUpdate = true;
  }

  function updateMempool(dt, tip, view) {
    const S = M.S;
    // New arrivals take a spot in the pool; departures fly to their block.
    for (const [id, tx] of S.mempool) {
      if (chipState.has(id)) continue;
      const h1 = parseInt(id.slice(0, 6), 16) / 16777216, h2 = parseInt(id.slice(6, 12), 16) / 16777216;
      const a = h1 * Math.PI * 2, r = lerp(POOL_IN + 4, POOL_OUT - 4, h2);
      chipState.set(id, { x: r * Math.cos(a), z: r * Math.sin(a), rot: h2 * 6, born: time, leaving: null, rate: tx.feeRate, size: tx.vsize });
    }
    for (const [id, c] of chipState) {
      if (S.mempool.has(id) || c.leaving) continue;
      const h = S.confirmed.get(id);
      const bv = h ? blocks.get(h) : null;
      c.leaving = { t: 0, to: bv ? bv.pos.clone() : null, bad: S.conflicted.has(id) };
    }
    let i = 0;
    const list = [...chipState.entries()].sort((a, b) => (a[1].leaving ? 0 : 1) - (b[1].leaving ? 0 : 1) || b[1].rate - a[1].rate);
    for (const [id, c] of list) {
      let x = c.x, y = 0.9 + 0.35 * Math.sin(time * 1.7 + c.rot * 3), z = c.z, s = 1;
      if (c.leaving) {
        c.leaving.t += dt / (c.leaving.to ? 0.9 : 0.6);
        const k = ease(c.leaving.t);
        if (c.leaving.to) {
          x = lerp(c.x, c.leaving.to.x, k);
          z = lerp(c.z, c.leaving.to.z, k);
          y = lerp(y, c.leaving.to.y, k) + Math.sin(Math.PI * k) * 12;
          s = 1 - 0.7 * k;
        } else {
          y -= 3 * k;
          s = 1 - k;
        }
        if (c.leaving.t >= 1) { chipState.delete(id); continue; }
      } else {
        s = Math.min(1, (time - c.born) * 3);
      }
      if (i >= MAX_CHIPS) continue;
      const w = 4 + Math.min(3, c.size / 90);
      const big = id === view.tracked ? 1.7 : 1;
      _m4.compose(_p.set(x, y, z), _q.setFromAxisAngle(up, c.rot), _s.set(w * s * big, 1.4 * s * big, 3 * s * big));
      chips.setMatrixAt(i, _m4);
      if (c.leaving && c.leaving.bad) _c.set('#d0453d');
      else feeColor(c.rate, _c);
      chips.setColorAt(i, _c);
      i++;
    }
    chips.count = i;
    chips.instanceMatrix.needsUpdate = true;
    if (chips.instanceColor) chips.instanceColor.needsUpdate = true;
  }

  function updateStake(dt) {
    const S = M.S;
    const pos = S.mode === 'pos';
    let i = 0;
    if (pos) {
      for (const n of M.nodes) {
        const v = NV[n.id];
        const count = Math.max(1, Math.round(n.activeStake / 20));
        // Beside the node, on the side facing along the ring.
        tmpV.set(-n.z, 0, n.x).multiplyScalar(17).add(v.pos);
        for (let k = 0; k < count && i < MAX_COINS; k++, i++) {
          _m4.compose(_p.set(tmpV.x, 0.9 + k * 1.3, tmpV.z), _q.identity(), _s.setScalar(1));
          coins.setMatrixAt(i, _m4);
          coins.setColorAt(i, _c.set(n.slashed ? '#d0453d' : !n.online ? '#8a8a85' : '#e0b030'));
        }
      }
    }
    coins.count = i;
    coins.instanceMatrix.needsUpdate = true;
    if (coins.instanceColor) coins.instanceColor.needsUpdate = true;
    // Beam on this slot's proposer.
    if (pos && S.pos) {
      const id = S.pos.proposers.get(S.pos.slot);
      if (id && id !== beamAt) { beamAt = id; beamT = 0; }
    } else beamAt = null;
    beamT += dt;
    if (beamAt) {
      const v = NV[beamAt];
      beam.position.set(v.pos.x, 45, v.pos.z);
      const missed = !M.node(beamAt).online || M.node(beamAt).slashed;
      beam.material.color.set(missed ? '#8a8a85' : '#f5c542');
      beam.material.opacity = 0.4 * Math.max(0, 1 - beamT / (M.knobs.slotTime * 1.1));
    } else beam.material.opacity = 0;
  }

  function updateEffects(dt) {
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += dt / p.dur;
      const s = 2 + p.size * ease(p.t);
      p.m.scale.set(s, s, s);
      p.m.material.opacity = Math.max(0, 0.9 * (1 - p.t));
      if (p.t >= 1) { scene.remove(p.m); p.m.material.dispose(); pulses.splice(i, 1); }
    }
    let i = 0;
    for (let k = sparks.length - 1; k >= 0; k--) {
      const s = sparks[k];
      s.t += dt / 0.9;
      if (s.t >= 1) { sparks.splice(k, 1); continue; }
      const bv = blocks.get(s.hash);
      const to = bv ? bv.pos : s.from;
      const e = ease(s.t);
      _p.lerpVectors(s.from, to, e);
      _p.y += Math.sin(Math.PI * e) * 20;
      if (i < MAX_SPARKS) {
        _m4.compose(_p, _q.identity(), _s.setScalar(1));
        sparkMesh.setMatrixAt(i++, _m4);
      }
    }
    sparkMesh.count = i;
    sparkMesh.instanceMatrix.needsUpdate = true;
  }

  function updateTipLines(view) {
    const show = view.views !== false;
    tipLines.visible = show;
    if (!show) return;
    M.nodes.forEach((n, i) => {
      const v = NV[n.id];
      const bv = blocks.get(n.tip);
      const a = v.lightPos, b = bv ? bv.pos : v.lightPos;
      tipPos.set([a.x, a.y, a.z, b.x, b.y + 2, b.z], i * 6);
      const blk = M.block(n.tip);
      _c.set(!n.online ? '#555555' : blk && blk.private ? '#8a5cc4' : LANE_COLORS[blk && !blk.canon ? blk.lane % 4 || 1 : 0]);
      if (blk && blk.canon) _c.set(T.dark ? '#7a7a76' : '#9a9a94');
      tipCol.set([_c.r, _c.g, _c.b, _c.r, _c.g, _c.b], i * 6);
    });
    tipGeo.attributes.position.needsUpdate = true;
    tipGeo.attributes.color.needsUpdate = true;
  }

  function updateSelection() {
    if (!selected) { selRing.visible = false; return; }
    if (selected.startsWith('node:') && NV[selected.slice(5)]) {
      const v = NV[selected.slice(5)];
      selRing.visible = true;
      selRing.position.set(v.pos.x, 1.6, v.pos.z);
      selRing.scale.setScalar(16 + Math.sin(time * 3) * 0.6);
    } else if (selected.startsWith('block:') && blocks.has(selected.slice(6))) {
      const v = blocks.get(selected.slice(6));
      selRing.visible = true;
      selRing.position.copy(v.pos);
      selRing.scale.setScalar(9 + Math.sin(time * 3) * 0.4);
    } else if (selected === 'mempool') {
      selRing.visible = true;
      selRing.position.set(0, 0.6, 0);
      selRing.scale.setScalar(POOL_OUT + 2);
    } else selRing.visible = false;
  }

  function placeLabels(view, tip) {
    if (!labelLayer) return;
    const show = view.labels !== false;
    labelLayer.style.display = show ? '' : 'none';
    if (!show) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const tv = blocks.get(tip.hash);
    for (const id in labels) {
      const L = labels[id];
      let anchor;
      if (id.startsWith('node:')) anchor = NV[id.slice(5)].anchor;
      else if (id === 'tip') { if (!tv) { L.el.style.display = 'none'; continue; } anchor = tmpV2.copy(tv.pos).setY(tv.pos.y + 5); }
      else if (id === 'mempool') anchor = tmpV2.set(0, 4, POOL_OUT - 4);
      const text = view.labelText ? view.labelText[id] || '' : '';
      if (text !== L.text) { L.sub.textContent = text; L.text = text; }
      const head = view.labelHead && view.labelHead[id];
      if (head && head !== L.head) { L.title.textContent = head; L.head = head; }
      tmpV.copy(anchor).project(camera);
      const dist = camera.position.distanceTo(anchor);
      const visible = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 && dist < 900;
      if (!visible) { L.el.style.display = 'none'; continue; }
      L.el.style.display = '';
      const x = (tmpV.x * 0.5 + 0.5) * rect.width + rect.left;
      const y = (-tmpV.y * 0.5 + 0.5) * rect.height + rect.top;
      L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      L.el.style.opacity = String(clamp(1.3 - dist / 650, 0.4, 1));
      L.el.dataset.selected = String(id === selected);
    }
  }

  /* ----- Events from the model ----- */
  function onEvents(events) {
    for (const e of events) {
      const v = e.node && NV[e.node];
      if (e.type === 'found' && v) pulse(v.pos, '#f5c542', 26, 1.2);
      else if (e.type === 'reject' && v) pulse(v.pos, '#d0453d', 20, 1.0, 0.8);
      else if (e.type === 'reorg' && v) pulse(v.pos, '#e8833a', 18, 0.9, 0.6);
      else if (e.type === 'missed' && v) pulse(v.pos, '#8a8a85', 16, 1.0);
      else if (e.type === 'slashed' && v) { pulse(v.pos, '#d0453d', 44, 1.8); pulse(v.pos, '#d0453d', 30, 1.4, 1.2); }
      else if (e.type === 'attest' && v && sparks.length < MAX_SPARKS) sparks.push({ from: v.lightPos.clone(), hash: e.hash, t: 0 });
      else if (e.type === 'canonReorg') pulse(new THREE.Vector3(0, 0, 0), '#e8833a', 60, 1.4, 0.5);
      else if (e.type === 'conflicted') pulse(new THREE.Vector3(0, 0, (POOL_IN + POOL_OUT) / 2), '#d0453d', 10, 0.8, 1);
    }
  }

  return {
    frame, focus, onEvents, setTheme,
    setSelected(id) { selected = id; },
    setOffset(x, y) { offset.tx = x; offset.ty = y; },
    autoRotate(on) { controls.autoRotate = on; },
    nodePos: (id) => NV[id] && NV[id].pos,
    blockVisible: (hash) => blocks.has(hash),
  };
}

BC.scene = { createScene };
})(window.Blockchain = window.Blockchain || {}, window.THREE);
