/*
 * The 3D scenes for knowledge/transistors.html, built from three.js
 * primitives (the classic build vendored in js/vendor/three, global THREE).
 * main.js loads this only once WebGL is known to work.
 *
 * One scene, many "stations", only one visible at a time and each built the
 * first time it is shown:
 *   feed, cz, ingot, saw, wafer          making the wafer
 *   probe, sort, grind, dice, bond, mold, final   test and packaging
 *   arch-planar, arch-strain, arch-hkmg, arch-finfet, arch-gaa,
 *   arch-cfet, arch-bspdn               one transistor of each generation
 * The transistor models can be cut open. The cut is made by building only the
 * back half of every solid (no clipping planes), so each cut face is a real
 * capped surface in the right material.
 *
 * Material colours for device parts come from the page's --tx-* tokens, the
 * same as the 2D cross-sections; machinery uses its own naturalistic colours.
 * Becomes Transistors.scene.
 */
(function (TR, THREE) {
'use strict';
const { OrbitControls } = THREE;
const { cssVar, isDark } = window.Explainer;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t >= 1 ? 1 : t <= 0 ? 0 : t * t * (3 - 2 * t));

function createScene(host, { ctx } = {}) {
  const mobile = window.matchMedia('(max-width: 900px)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '3D scene. Drag to orbit, scroll or pinch to zoom.');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.5;
  controls.maxDistance = 60;
  controls.screenSpacePanning = true;

  scene.add(new THREE.HemisphereLight('#ffffff', '#6f6c66', 1.4));
  const key = new THREE.DirectionalLight('#ffffff', 2.0);
  key.position.set(6, 10, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.7);
  fill.position.set(-8, 4, -5);
  scene.add(fill);

  // A soft studio environment so polished silicon and metal have something to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 18, 30), new THREE.MeshBasicMaterial({ color: '#a7abb2', side: THREE.BackSide }));
  envScene.add(room);
  for (const [x, y, z, w, h, c] of [[0, 8.9, 0, 18, 18, '#ffffff'], [-14.9, 3, 0, 12, 6, '#cfe0ff'], [14.9, 2, 4, 8, 4, '#ffe9cf'], [0, 3, -14.9, 14, 5, '#ffffff']]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    p.position.set(x, y, z);
    p.lookAt(0, 0, 0);
    envScene.add(p);
  }
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;

  /* ------------------------------------------------------------------------
   * Materials
   * --------------------------------------------------------------------- */

  const tokMats = [];   // materials coloured from CSS tokens, refreshed on theme change
  function tok(v, opts = {}) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.55, metalness: 0.05 }, opts));
    m.color.set(cssVar(v) || '#999999');
    m.userData.tok = v;
    tokMats.push(m);
    return m;
  }
  const M = {
    si: () => tok('--tx-si', { roughness: 0.45, metalness: 0.15 }),
    nw: () => tok('--tx-nw'), pw: () => tok('--tx-pw'),
    np: () => tok('--tx-np'), pp: () => tok('--tx-pp'),
    ox: () => tok('--tx-ox', { transparent: true, opacity: 0.55, depthWrite: false }),
    oxs: () => tok('--tx-ox'),
    nit: () => tok('--tx-nit'), poly: () => tok('--tx-npoly'), sil: () => tok('--tx-sil'),
    w: () => tok('--tx-w', { metalness: 0.6, roughness: 0.35 }), cu: () => tok('--tx-cu', { metalness: 0.75, roughness: 0.3 }),
    hk: () => tok('--tx-hk'), tin: () => tok('--tx-tin', { metalness: 0.5 }), mg: () => tok('--tx-mg', { metalness: 0.55, roughness: 0.35 }),
    sige: () => tok('--tx-sige'), lowk: () => tok('--tx-lowk', { transparent: true, opacity: 0.35, depthWrite: false }),
    elec: () => tok('--tx-elec', { emissive: '#1f4fd1', emissiveIntensity: 0.6 }),
  };
  const nat = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.1 }, o));
  const steel = () => nat('#9aa1a8', { metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide });
  const siMirror = () => nat('#d3d8df', { metalness: 0.9, roughness: 0.14 });

  function setTheme() {
    for (const m of tokMats) m.color.set(cssVar(m.userData.tok) || '#999999');
    scene.background = new THREE.Color(cssVar('--bg') || '#ffffff');
  }
  setTheme();

  /* ------------------------------------------------------------------------
   * Geometry helpers
   * --------------------------------------------------------------------- */

  function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    if (parent) parent.add(o);
    return o;
  }
  // An axis-aligned box from corner ranges, cut to the back half if `cut`
  // names an axis ('x' keeps x <= 0, 'z' keeps z <= 0).
  function boxAt(parent, mat, x0, x1, y0, y1, z0, z1, cut) {
    if (cut === 'z') z1 = Math.min(z1, 0);
    if (cut === 'x') x1 = Math.min(x1, 0);
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return null;
    return mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, parent, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }
  // A prism: a 2D outline in the (a, b) plane extruded along `axis` from s0 to s1.
  function prism(parent, mat, pts, axis, s0, s1, cut) {
    if (cut === axis) s1 = Math.min(s1, 0);
    if (s1 - s0 < 1e-4) return null;
    let P = pts;
    if (cut && cut !== axis) {
      // Clip the outline itself to <= 0 along the cut axis (outline uses a = the other horizontal axis).
      P = clipPoly(pts, 0);
      if (P.length < 3) return null;
    }
    // For an x extrusion the outline is mirrored first, so that turning the
    // extrusion onto the x axis brings the outline's first coordinate out as +z.
    const sh = new THREE.Shape(P.map(([a, b]) => new THREE.Vector2(axis === 'x' ? -a : a, b)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: s1 - s0, bevelEnabled: false });
    const m = new THREE.Mesh(geo, mat);
    if (axis === 'z') { m.position.z = s0; }
    else if (axis === 'x') { geo.rotateY(Math.PI / 2); m.position.x = s0; }
    parent.add(m);
    return m;
  }
  // Sutherland-Hodgman against a <= c on the first coordinate.
  function clipPoly(pts, c) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const pin = p[0] <= c, qin = q[0] <= c;
      if (pin) out.push(p);
      if (pin !== qin) { const t = (c - p[0]) / (q[0] - p[0]); out.push([c, p[1] + t * (q[1] - p[1])]); }
    }
    return out;
  }

  /* ------------------------------------------------------------------------
   * Labels: HTML tags that follow 3D points
   * --------------------------------------------------------------------- */

  const labelLayer = document.getElementById('labels3d');
  let labels = [];
  function setLabels(list) {
    if (!labelLayer) return;
    labelLayer.textContent = '';
    labels = list.map((L) => {
      const d = document.createElement('div');
      d.className = 'xp-label tx3d-label';
      const b = document.createElement('b');
      b.textContent = L.text;
      d.appendChild(b);
      if (L.sub) { const s = document.createElement('small'); s.textContent = L.sub; d.appendChild(s); }
      labelLayer.appendChild(d);
      return { el: d, pos: L.pos, get: L.get };
    });
  }
  const tmp = new THREE.Vector3();
  function placeLabels() {
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    for (const L of labels) {
      const p = L.get ? L.get() : L.pos;
      tmp.copy(p).project(camera);
      const hide = tmp.z > 1 || !showLabels;
      L.el.style.display = hide ? 'none' : '';
      if (hide) continue;
      // The projection already includes the view offset, so NDC maps straight onto the canvas.
      const x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h;
      L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
  let showLabels = true;

  /* ------------------------------------------------------------------------
   * Shared textures
   * --------------------------------------------------------------------- */

  // A patterned wafer: dies with a little thin-film colour, scribe lines between.
  function waferTexture(dieMm = 14, overlay) {
    const N = 1024;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const s = N / 300;
    g.fillStyle = '#7d8590';
    g.fillRect(0, 0, N, N);
    const dies = [];
    const n = Math.ceil(150 / dieMm) + 1;
    for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
      const x0 = i * dieMm, y0 = j * dieMm;
      const corners = [[x0, y0], [x0 + dieMm, y0], [x0, y0 + dieMm], [x0 + dieMm, y0 + dieMm]];
      if (corners.some(([x, y]) => x * x + y * y > 146 * 146)) continue;
      dies.push([x0, y0]);
      const px = (x0 + 150) * s, py = (y0 + 150) * s, d = dieMm * s;
      const hue = 205 + 40 * Math.sin((x0 * 0.04 + y0 * 0.03));
      const grad = g.createLinearGradient(px, py, px + d, py + d);
      grad.addColorStop(0, `hsl(${hue}, 38%, 46%)`);
      grad.addColorStop(0.5, `hsl(${hue + 50}, 34%, 52%)`);
      grad.addColorStop(1, `hsl(${hue + 110}, 30%, 44%)`);
      g.fillStyle = grad;
      g.fillRect(px + 2, py + 2, d - 4, d - 4);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(px + d * 0.12, py + d * 0.12, d * 0.45, d * 0.3);
      g.fillStyle = 'rgba(0,0,0,0.15)';
      g.fillRect(px + d * 0.6, py + d * 0.5, d * 0.3, d * 0.35);
    }
    if (overlay) overlay(g, s, dies);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { tex: t, canvas: c, g, dies, s };
  }

  function waferDisk(parent, radius, thick, topMat, sideMat) {
    const geo = new THREE.CylinderGeometry(radius, radius, thick, 96, 1);
    const m = new THREE.Mesh(geo, [sideMat, topMat, sideMat]);
    // CylinderGeometry groups: 0 side, 1 top, 2 bottom. Map the top's UVs to a full square.
    const uv = geo.attributes.uv;
    const pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(pos.getY(i) - thick / 2) < 1e-6 || Math.abs(pos.getY(i) + thick / 2) < 1e-6) {
        uv.setXY(i, pos.getX(i) / (2 * radius) + 0.5, 0.5 - pos.getZ(i) / (2 * radius));
      }
    }
    parent.add(m);
    return m;
  }

  /* ------------------------------------------------------------------------
   * Stations
   * --------------------------------------------------------------------- */

  const STATIONS = {};
  const built = {};
  let active = null;
  let time = 0;

  // ---- feed: sand to polysilicon ------------------------------------------
  STATIONS.feed = () => {
    const G = new THREE.Group();
    const floor = mesh(new THREE.CylinderGeometry(7, 7, 0.1, 64), nat('#d9d7d2', { roughness: 0.9 }), G, 0, -0.05, 0);
    floor.material.color.set(isDark() ? '#3a3a37' : '#e2e0da');
    mesh(new THREE.ConeGeometry(1.3, 0.8, 48), nat('#d6c193', { roughness: 0.95 }), G, -3.6, 0.4, 0.6);
    // Siemens reactor: a bell jar over U-shaped rods glowing at ~1,100 °C.
    mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.2, 48), steel(), G, 0, 0.1, 0);
    const jar = nat('#cfd8e3', { transparent: true, opacity: 0.18, metalness: 0.2, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
    mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.6, 48, 1, true), jar, G, 0, 1.5, 0);
    const dome = mesh(new THREE.SphereGeometry(1.4, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), jar, G, 0, 2.8, 0);
    void dome;
    const glow = nat('#7b7f86', { emissive: '#ff6a1a', emissiveIntensity: 0.9, metalness: 0.4, roughness: 0.4 });
    for (const zx of [[-0.45, 0], [0.45, 0]]) {
      for (const dx of [-0.25, 0.25]) mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.3, 16), glow, G, zx[0] + dx, 1.35, zx[1]);
      const bridge = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.62, 16), glow, G, zx[0], 2.5, zx[1]);
      bridge.rotation.z = Math.PI / 2;
    }
    // A pile of polysilicon chunks.
    const chunkGeo = new THREE.IcosahedronGeometry(0.2, 0);
    const chunks = new THREE.InstancedMesh(chunkGeo, nat('#8d939b', { metalness: 0.7, roughness: 0.3 }), 70);
    const d = new THREE.Object3D();
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 70; i++) {
      const r = Math.pow(rnd(), 0.7) * 1.1, a = rnd() * Math.PI * 2;
      d.position.set(3.6 + r * Math.cos(a), 0.15 + (1.1 - r) * 0.55 * rnd() + 0.1, 0.4 + r * Math.sin(a));
      d.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
      const s = 0.6 + rnd() * 0.8;
      d.scale.set(s, s * (0.7 + rnd() * 0.5), s);
      d.updateMatrix();
      chunks.setMatrixAt(i, d.matrix);
    }
    G.add(chunks);
    return {
      group: G, view: [[0, 1.2, 0], [0.5, 4.2, 10.5]],
      labels: [
        { text: 'Quartz sand', sub: 'SiO₂', pos: new THREE.Vector3(-3.6, 0.95, 0.6) },
        { text: 'Siemens reactor', sub: 'SiHCl₃ + H₂ → Si on 1,100 °C rods', pos: new THREE.Vector3(0, 3.4, 0) },
        { text: 'Polysilicon', sub: '11 nines pure', pos: new THREE.Vector3(3.6, 1.0, 0.4) },
      ],
      tick() { glow.emissiveIntensity = 0.75 + 0.2 * Math.sin(time * 2.2); },
    };
  };

  // ---- cz: the crystal puller --------------------------------------------------
  const CZ = { phases: ['melt', 'dip', 'neck', 'crown', 'body', 'tail'], target: { melt: 0, dip: 0.12, neck: 0.55, crown: 1.7, body: 5.2, tail: 6.4 } };
  STATIONS.cz = () => {
    const G = new THREE.Group();
    // Cut-away chamber: most of a cylinder, open toward the viewer. Cylinder
    // angles put a point at (sin t, cos t); thetaC is the camera's direction.
    const open = Math.PI * 0.6;
    const thetaC = Math.atan2(7.2, 10.5);
    const chamberMat = steel();
    mesh(new THREE.CylinderGeometry(3.3, 3.3, 4.2, 64, 1, true, thetaC + open / 2, Math.PI * 2 - open), chamberMat, G, 0, 0.3, 0);
    mesh(new THREE.CylinderGeometry(1.9, 1.9, 7.5, 48, 1, true, thetaC + open / 2, Math.PI * 2 - open), chamberMat, G, 0, 6.15, 0);
    const lid = mesh(new THREE.RingGeometry(1.9, 3.3, 64, 1, thetaC - Math.PI / 2 + open / 2, Math.PI * 2 - open), chamberMat, G, 0, 2.4, 0);
    lid.rotation.x = -Math.PI / 2;
    mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.15, 64), steel(), G, 0, -1.85, 0);
    // Heater bars.
    const heat = nat('#5b4a44', { emissive: '#ff4a12', emissiveIntensity: 1.0, roughness: 0.6 });
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * 2 * i / 26;
      const d = Math.atan2(Math.sin(a - thetaC), Math.cos(a - thetaC));
      if (Math.abs(d) < open / 2) continue;
      mesh(new THREE.BoxGeometry(0.14, 2.1, 0.14), heat, G, 2.75 * Math.sin(a), -0.45, 2.75 * Math.cos(a));
    }
    // Susceptor and crucible (rotating together).
    const pot = new THREE.Group();
    G.add(pot);
    const cup = (r, h, t) => {
      const pts = [new THREE.Vector2(0, -h), new THREE.Vector2(r - 0.3, -h), new THREE.Vector2(r, -h + 0.3), new THREE.Vector2(r, 0.3), new THREE.Vector2(r - t, 0.3), new THREE.Vector2(r - t, -h + 0.3 + t * 0.5), new THREE.Vector2(r - 0.3 - t, -h + t), new THREE.Vector2(0, -h + t)];
      return new THREE.LatheGeometry(pts, 64);
    };
    mesh(cup(2.45, 1.65, 0.16), nat('#3c3d40', { roughness: 0.8 }), pot, 0, 0, 0);
    mesh(cup(2.28, 1.48, 0.07), nat('#f1efe9', { transparent: true, opacity: 0.55, roughness: 0.15, side: THREE.DoubleSide }), pot, 0, 0, 0);
    const melt = mesh(new THREE.CylinderGeometry(2.2, 2.0, 1.25, 64), nat('#ffb04a', { emissive: '#ff7a10', emissiveIntensity: 1.25, roughness: 0.25, metalness: 0.0 }), pot, 0, -0.63, 0);
    // Polysilicon chunks for the melt-down phase.
    const chunkGeo = new THREE.IcosahedronGeometry(0.28, 0);
    const chunks = new THREE.InstancedMesh(chunkGeo, nat('#8d939b', { metalness: 0.7, roughness: 0.3 }), 60);
    const cm = [];
    let seed = 5;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 60; i++) { const r = Math.sqrt(rnd()) * 1.9, a = rnd() * 6.283; cm.push([r * Math.cos(a), -0.2 + rnd() * 0.9, r * Math.sin(a), rnd() * 6, 0.7 + rnd() * 0.6]); }
    pot.add(chunks);
    // The crystal.
    const crystalMat = nat('#9aa1ab', { metalness: 0.9, roughness: 0.22 });
    const crystal = new THREE.Mesh(new THREE.BufferGeometry(), crystalMat);
    G.add(crystal);
    const cable = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), nat('#cfcfcf', { metalness: 0.8 }), G, 0, 0, 0);
    const chuck = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 16), steel(), G, 0, 0, 0);
    const ring = mesh(new THREE.TorusGeometry(1, 0.035, 8, 64), nat('#fff1b0', { emissive: '#ffd36a', emissiveIntensity: 2.0 }), G, 0, 0.02, 0);
    ring.rotation.x = Math.PI / 2;

    function radiusAt(d) {
      if (d < 0.12) return 0.07;                                // seed
      if (d < 0.55) return 0.03;                                // neck (~3 mm, drawn thicker)
      if (d < 1.7) return 0.03 + (1.5 - 0.03) * Math.pow((d - 0.55) / 1.15, 0.75);   // crown
      if (d < 5.2) return 1.5;                                  // body (2 m, drawn shorter)
      return 1.5 * Math.sqrt(Math.max(0, 1 - (d - 5.2) / 1.25)); // tail
    }
    let Lg = 0, Lgoal = 0, phase = 'body', lifted = 0;
    function rebuild() {
      const pts = [new THREE.Vector2(0, 0)];
      const n = 90;
      for (let i = 0; i <= n; i++) {
        const d = Lg * (1 - i / n);          // from the growth interface up to the seed
        pts.push(new THREE.Vector2(Math.max(0.0005, radiusAt(d)), Lg * i / n));
      }
      pts.push(new THREE.Vector2(0, Lg));
      crystal.geometry.dispose();
      crystal.geometry = new THREE.LatheGeometry(pts, 64);
      crystal.position.y = lifted;
      const top = Lg + lifted;
      cable.scale.y = Math.max(0.01, 11.2 - top);
      cable.position.y = top + 0.3 + (11.2 - top) / 2;
      chuck.position.y = top + 0.15;
      const rr = phase === 'melt' || Lg < 0.11 || lifted > 0 ? 0 : radiusAt(Lg);
      ring.visible = rr > 0;
      ring.scale.set(rr + 0.04, rr + 0.04, 1);
    }
    function setPhase(p) {
      phase = p;
      Lgoal = CZ.target[p];
      if (p === 'melt') { Lg = 0; lifted = 0.9; }
      if (p === 'dip') { lifted = 0; if (Lg > 0.12) Lg = 0; }
      if (p !== 'tail' && p !== 'melt' && Lg > Lgoal) Lg = CZ.target[CZ.phases[Math.max(0, CZ.phases.indexOf(p) - 1)]];
      rebuild();
    }
    setPhase('crown');
    Lg = 0.6;
    setPhase('body');
    let meltT = 0;
    return {
      group: G, view: [[0, 1.8, 0], [8.5, 5.5, 12.5]],
      setCz(p) { meltT = 0; setPhase(p); },
      get debug() { return { Lg, Lgoal, phase, lifted }; },
      labels: [
        { text: 'Silicon melt', sub: '1,414 °C', pos: new THREE.Vector3(1.6, -0.1, 1.2) },
        { text: 'Quartz crucible', sub: 'in a graphite susceptor', pos: new THREE.Vector3(-2.2, -1.2, 1.0) },
        { text: 'Heater', pos: new THREE.Vector3(-2.75, 0.9, -0.6) },
        { text: 'Growing crystal', sub: 'pulled ~1 mm/min, rotating', get: () => new THREE.Vector3(1.0, Math.max(0.6, Math.min(Lg, 4) * 0.6) + lifted, 0.9) },
        { text: 'Pull cable', pos: new THREE.Vector3(0, 9.0, 0) },
      ],
      tick(dt) {
        crystal.rotation.y += dt * 0.8;
        pot.rotation.y -= dt * 0.35;
        heat.emissiveIntensity = 0.9 + 0.15 * Math.sin(time * 1.7);
        // Chunks melt down in the first phase.
        meltT += dt;
        const d = new THREE.Object3D();
        const fade = phase === 'melt' ? clamp(1 - meltT / 5, 0, 1) : 0;
        chunks.visible = fade > 0;
        if (fade > 0) {
          cm.forEach(([x, y, z, r, s], i) => { d.position.set(x, y * fade - 0.05, z); d.rotation.set(r, r * 0.7, 0); d.scale.setScalar(s * fade); d.updateMatrix(); chunks.setMatrixAt(i, d.matrix); });
          chunks.instanceMatrix.needsUpdate = true;
          melt.scale.y = 0.4 + 0.6 * (1 - fade);
          melt.position.y = -0.63 - (1 - melt.scale.y) * 0.62;
          if (lifted > 0 && fade <= 0.02) lifted = 0.9;
        } else { melt.scale.y = 1; melt.position.y = -0.63; }
        // Grow toward the phase's target.
        if (Lg < Lgoal) {
          const rate = phase === 'body' ? 0.9 : phase === 'neck' ? 0.25 : phase === 'crown' ? 0.5 : phase === 'tail' ? 0.45 : 0.3;
          Lg = Math.min(Lgoal, Lg + rate * dt);
          rebuild();
        }
        if (phase === 'tail' && Lg >= Lgoal && lifted < 0.8) { lifted += dt * 0.3; rebuild(); }
        void ease;
      },
    };
  };

  // ---- ingot: crop, grind, notch ---------------------------------------------------
  STATIONS.ingot = () => {
    const G = new THREE.Group();
    const si = nat('#9aa1ab', { metalness: 0.9, roughness: 0.22 });
    const rough = nat('#8b9098', { metalness: 0.5, roughness: 0.75 });
    const body = mesh(new THREE.CylinderGeometry(1.5, 1.5, 6, 72), si, G, 0, 1.7, 0);
    body.rotation.z = Math.PI / 2;
    // The as-grown surface: slightly oversize and bumpy, removed where the wheel has passed.
    const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    rough.clippingPlanes = [plane];
    const shell = mesh(new THREE.CylinderGeometry(1.58, 1.58, 6, 72, 12), rough, G, 0, 1.7, 0);
    shell.rotation.z = Math.PI / 2;
    const pos = shell.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { const k = 1 + 0.012 * Math.sin(pos.getY(i) * 7); pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); }
    shell.geometry.computeVertexNormals();
    // Cropped cones.
    const crown = mesh(new THREE.ConeGeometry(1.5, 1.3, 72), si, G, -4.0, 1.4, 0.3);
    crown.rotation.z = Math.PI / 2;
    crown.rotation.y = 0.25;
    const tail = mesh(new THREE.ConeGeometry(1.5, 1.6, 72), si, G, 4.2, 1.4, 0.3);
    tail.rotation.z = -Math.PI / 2;
    tail.rotation.y = -0.25;
    // Notch: a groove along the top.
    boxAt(G, nat('#2c2f33'), -3, 3, 3.17, 3.21, -0.05, 0.05);
    // Rollers and grinding wheel.
    for (const z of [-0.9, 0.9]) { const r = mesh(new THREE.CylinderGeometry(0.25, 0.25, 7, 24), steel(), G, 0, 0.05, z); r.rotation.z = Math.PI / 2; }
    const wheel = mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.45, 48), nat('#b9b3a8', { roughness: 0.9 }), G, 0, 1.7, -2.65);
    wheel.rotation.x = Math.PI / 2;
    renderer.localClippingEnabled = true;
    return {
      group: G, view: [[0, 1.4, 0], [2.5, 5.0, 9.5]],
      labels: [
        { text: 'Crown and tail cropped', pos: new THREE.Vector3(-4.1, 2.4, 0.3) },
        { text: 'Grinding wheel', sub: 'grinds the body to exactly 300 mm', get: () => new THREE.Vector3(wheel.position.x, 2.8, -2.65) },
        { text: 'Notch groove', sub: 'marks a ⟨110⟩ direction', pos: new THREE.Vector3(1.8, 3.25, 0) },
      ],
      tick(dt) {
        const x = -3.2 + 6.4 * ((time * 0.12) % 1);
        wheel.position.x = x;
        wheel.rotation.y += dt * 8;
        plane.constant = -Math.max(-3, Math.min(3, x));
        body.rotation.x += dt * 0.6;
      },
    };
  };

  // ---- saw: multi-wire saw ---------------------------------------------------------
  STATIONS.saw = () => {
    const G = new THREE.Group();
    renderer.localClippingEnabled = true;
    const si = nat('#9aa1ab', { metalness: 0.9, roughness: 0.22 });
    const solidCut = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const sliceCut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const solidMat = si.clone(); solidMat.clippingPlanes = [solidCut];
    const sliceMat = si.clone(); sliceMat.clippingPlanes = [sliceCut];
    const ingot = new THREE.Group();
    G.add(ingot);
    const solid = mesh(new THREE.CylinderGeometry(1.5, 1.5, 5, 72), solidMat, ingot);
    solid.rotation.x = Math.PI / 2;
    const n = 34;
    for (let i = 0; i < n; i++) {
      const z = -2.5 + 5 * (i + 0.5) / n;
      const s = mesh(new THREE.CylinderGeometry(1.5, 1.5, 5 / n * 0.62, 64), sliceMat, ingot, 0, 0, z);
      s.rotation.x = Math.PI / 2;
    }
    boxAt(ingot, nat('#4d5257'), -0.5, 0.5, 1.45, 1.85, -2.6, 2.6);   // glue beam
    // Guide rollers and the wire web.
    for (const x of [-3.3, 3.3]) for (const y of [0, -3.2]) {
      const r = mesh(new THREE.CylinderGeometry(0.55, 0.55, 5.6, 40), nat('#d9d4c8', { roughness: 0.6 }), G, x, y - 0.55, 0);
      r.rotation.x = Math.PI / 2;
    }
    const stripes = document.createElement('canvas');
    stripes.width = 64; stripes.height = 4;
    const sg = stripes.getContext('2d');
    sg.fillStyle = '#d7d9dc'; sg.fillRect(0, 0, 64, 4);
    sg.fillStyle = '#7d8187'; for (let x = 0; x < 64; x += 16) sg.fillRect(x, 0, 6, 4);
    const tex = new THREE.CanvasTexture(stripes);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(20, 1);
    const wireMat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.8, roughness: 0.35 });
    const wireGeo = new THREE.CylinderGeometry(0.018, 0.018, 6.6, 6);
    wireGeo.rotateZ(Math.PI / 2);
    for (let i = 0; i <= n; i++) {
      const z = -2.5 + 5 * i / n;
      mesh(wireGeo, wireMat, G, 0, 0, z);
      mesh(wireGeo, wireMat, G, 0, -3.2 - 1.1, z);
    }
    return {
      group: G, view: [[0, -0.6, 0], [6.5, 4.0, 8.5]],
      labels: [
        { text: 'Wire web', sub: 'one wire, hundreds of turns', pos: new THREE.Vector3(-2.6, 0.1, 2.4) },
        { text: 'Ingot pressed down through it', get: () => new THREE.Vector3(0, ingot.position.y + 1.6, 1.2) },
        { text: 'Wafers, still glued to a beam', get: () => new THREE.Vector3(0.9, ingot.position.y - 1.2, 2.4) },
      ],
      tick(dt) {
        tex.offset.x -= dt * 2.5;
        const t = (time * 0.08) % 1;
        ingot.position.y = 1.5 - 3.0 * t;
      },
    };
  };

  // ---- wafer: polished, notched, marked --------------------------------------------
  STATIONS.wafer = () => {
    const G = new THREE.Group();
    const R = 1.5;
    const sh = new THREE.Shape();
    const notchA = 0.03;
    sh.absarc(0, 0, R, -Math.PI / 2 + notchA, Math.PI * 1.5 - notchA, false);
    sh.lineTo(0, -R + 0.07);
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 160 });
    geo.rotateX(-Math.PI / 2);
    const wafer = mesh(geo, siMirror(), G, 0, 0.62, 0);
    mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.6, 48), steel(), G, 0, 0.3, 0);
    // Laser ID near the notch.
    const c = document.createElement('canvas');
    c.width = 256; c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 256, 48);
    g.fillStyle = '#4b4f55'; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.fillText('TX26-0417-07', 128, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const mark = mesh(new THREE.PlaneGeometry(0.55, 0.1), new THREE.MeshBasicMaterial({ map: t, transparent: true }), wafer, 0, 0.043, 1.18);
    mark.rotation.x = -Math.PI / 2;
    return {
      group: G, view: [[0, 0.6, 0], [0, 3.3, 4.6]],
      labels: [
        { text: '300 mm across', pos: new THREE.Vector3(-1.5, 0.7, 0) },
        { text: '775 µm thick', sub: 'drawn about 5× thicker', pos: new THREE.Vector3(1.5, 0.66, 0) },
        { text: 'Notch', pos: new THREE.Vector3(0, 0.66, 1.5) },
        { text: 'Laser-scribed ID', pos: new THREE.Vector3(0, 0.66, 1.15) },
      ],
      tick(dt) { wafer.rotation.y += dt * 0.15; },
    };
  };

  // ---- probe (WAT) and sort -------------------------------------------------------
  function probeStation(kind) {
    const G = new THREE.Group();
    const binColors = { pass: '#2fa84f', fail: '#d03b3b' };
    const W = waferTexture(14);
    const top = new THREE.MeshStandardMaterial({ map: W.tex, metalness: 0.35, roughness: 0.35 });
    const stage = new THREE.Group();
    G.add(stage);
    waferDisk(stage, 1.5, 0.03, top, nat('#8c939b', { metalness: 0.8 }));
    mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.25, 64), nat('#c9ccd0', { metalness: 0.6, roughness: 0.3 }), stage, 0, -0.14, 0);
    // Probe card: a board with an opening and needles.
    const card = new THREE.Group();
    G.add(card);
    const board = mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.06, 64, 1, false), nat('#2f5a3b', { roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false }), card, 0, 0.75, 0);
    void board;
    boxAt(card, nat('#c8b26a', { metalness: 0.7, roughness: 0.3 }), -0.35, 0.35, 0.79, 0.84, -0.35, 0.35);
    const needle = nat('#d8d8d8', { metalness: 0.9, roughness: 0.2 });
    const tips = [];
    if (kind === 'probe') {
      // Cantilever needles converging on a row of pads in a scribe line.
      for (let i = 0; i < 12; i++) {
        const side = i % 2 ? 1 : -1;
        const tx = -0.11 + 0.02 * i, tz = 0;
        const from = new THREE.Vector3(tx + side * 0.05, 0.71, side * 0.5);
        const to = new THREE.Vector3(tx, 0.035, tz);
        const len = from.distanceTo(to);
        const m = mesh(new THREE.CylinderGeometry(0.004, 0.008, len, 6), needle, card);
        m.position.copy(from).add(to).multiplyScalar(0.5);
        m.lookAt(to);
        m.rotateX(Math.PI / 2);
        tips.push(to);
      }
    } else {
      // Vertical probes over a whole die.
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        if (i > 0 && i < 7 && j > 0 && j < 7) continue;
        const x = -0.06 + 0.12 * i / 7, z = -0.06 + 0.12 * j / 7;
        mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.7, 4), needle, card, x, 0.38, z);
      }
    }
    // Sites to visit.
    const sites = [];
    if (kind === 'probe') {
      for (const [x, z] of [[0, 0], [0.7, 0.2], [-0.6, 0.5], [0.3, -0.8], [-0.9, -0.3], [1.0, -0.4], [-0.2, 1.1], [0.5, 0.9], [-1.1, 0.3]]) sites.push([x, z]);
    } else {
      // Die centres in scene units (1 unit = 100 mm), raster order.
      for (const [x0, y0] of W.dies) sites.push([(x0 + 7) / 100, (y0 + 7) / 100, x0, y0]);
      sites.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    }
    let idx = 0, tSite = 0;
    let seed = 3;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    function mark(i) {
      if (kind !== 'sort') return;
      const x0 = sites[i][2], y0 = sites[i][3];
      const r = Math.hypot(x0 + 7, y0 + 7);
      const fail = rnd() < 0.06 + 0.25 * Math.pow(r / 150, 4);
      W.g.fillStyle = fail ? binColors.fail : binColors.pass;
      W.g.globalAlpha = 0.6;
      W.g.fillRect((x0 + 150) * W.s + 4, (y0 + 150) * W.s + 4, 14 * W.s - 8, 14 * W.s - 8);
      W.g.globalAlpha = 1;
      W.tex.needsUpdate = true;
    }
    function reset() {
      const fresh = waferTexture(14);
      W.g.drawImage(fresh.canvas, 0, 0);
      W.tex.needsUpdate = true;
      fresh.tex.dispose();
    }
    return {
      group: G, view: kind === 'probe' ? [[0, 0.3, 0], [0.4, 2.6, 3.4]] : [[0, 0.3, 0], [0, 3.2, 3.6]],
      labels: kind === 'probe'
        ? [{ text: 'Probe card', sub: 'needles land on scribe-line pads', pos: new THREE.Vector3(0.9, 0.85, 0.9) }, { text: 'Test structures in the scribe lines', pos: new THREE.Vector3(0, 0.06, 0) }, { text: 'Wafer on a moving chuck', pos: new THREE.Vector3(-1.4, 0.05, 0.6) }]
        : [{ text: 'Probe card', sub: 'one die at a time', pos: new THREE.Vector3(1.2, 0.85, 0.6) }, { text: 'Bin map', sub: 'green pass, red fail', pos: new THREE.Vector3(-1.2, 0.05, 0.9) }],
      tick(dt) {
        tSite += dt;
        const dwell = kind === 'probe' ? 1.4 : 0.09;
        if (tSite > dwell) {
          tSite = 0;
          mark(idx);
          idx = (idx + 1) % sites.length;
          if (idx === 0 && kind === 'sort') reset();
        }
        const [x, z] = sites[idx];
        const lift = kind === 'probe' ? clamp(1 - tSite / 0.25, 0, 1) * 0.04 : 0;
        stage.position.x = lerp(stage.position.x, -x, kind === 'probe' ? 0.12 : 0.6);
        stage.position.z = lerp(stage.position.z, -z, kind === 'probe' ? 0.12 : 0.6);
        stage.position.y = -lift;
      },
    };
  }
  STATIONS.probe = () => probeStation('probe');
  STATIONS.sort = () => probeStation('sort');

  // ---- grind: backgrinding -----------------------------------------------------------
  STATIONS.grind = () => {
    const G = new THREE.Group();
    mesh(new THREE.CylinderGeometry(1.65, 1.65, 0.3, 64), nat('#b9b6ad', { roughness: 0.9 }), G, 0, -0.15, 0);   // porous chuck
    mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.015, 64), nat('#3f6fb0', { roughness: 0.6 }), G, 0, 0.008, 0);  // tape
    const wafer = mesh(new THREE.CylinderGeometry(1.5, 1.5, 1, 96), nat('#8f969f', { metalness: 0.7, roughness: 0.45 }), G, 0, 0.05, 0);
    const wheel = new THREE.Group();
    G.add(wheel);
    mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.5, 48), steel(), wheel, 0, 0.45, 0);
    const seg = nat('#e8e2d2', { roughness: 0.95 });
    for (let i = 0; i < 28; i++) { const a = Math.PI * 2 * i / 28; const m = mesh(new THREE.BoxGeometry(0.14, 0.12, 0.08), seg, wheel, 1.22 * Math.cos(a), 0.14, 1.22 * Math.sin(a)); m.rotation.y = -a; }
    mesh(new THREE.CylinderGeometry(0.25, 0.25, 2.5, 24), steel(), wheel, 0, 1.9, 0);
    wheel.position.set(1.22, 0, 0);
    return {
      group: G, view: [[0.3, 0.3, 0], [2.8, 3.2, 4.2]],
      labels: [
        { text: 'Diamond grinding wheel', pos: new THREE.Vector3(2.4, 0.8, 0) },
        { text: 'Wafer, face down on tape', sub: 'back side up', pos: new THREE.Vector3(-1.2, 0.12, 0.8) },
        { text: '775 µm → ~100 µm', pos: new THREE.Vector3(-0.6, 0.3, -1.2) },
      ],
      tick(dt) {
        wheel.rotation.y += dt * 6;
        wafer.rotation.y -= dt * 0.8;
        const t = (time * 0.07) % 1;
        const th = lerp(0.08, 0.012, ease(t / 0.9));
        wafer.scale.y = th;
        wafer.position.y = 0.016 + th / 2;
        wheel.position.y = 0.016 + th - 0.08;
      },
    };
  };

  // ---- dice: dicing saw ------------------------------------------------------------------
  STATIONS.dice = () => {
    const G = new THREE.Group();
    const W = waferTexture(14);
    mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.01, 64), nat('#9cc3e6', { transparent: true, opacity: 0.8, roughness: 0.4 }), G, 0, 0, 0);   // tape
    const ring = mesh(new THREE.RingGeometry(1.75, 2.15, 64), steel(), G, 0, 0.02, 0);
    ring.rotation.x = -Math.PI / 2;
    waferDisk(G, 1.5, 0.015, new THREE.MeshStandardMaterial({ map: W.tex, metalness: 0.35, roughness: 0.35 }), nat('#8c939b', { metalness: 0.8 }));
    G.children[G.children.length - 1].position.y = 0.015;
    const head = new THREE.Group();
    G.add(head);
    const blade = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.012, 64), nat('#d8d8d8', { metalness: 0.9, roughness: 0.25 }), head, 0, 0.3, 0);
    blade.rotation.x = Math.PI / 2;
    boxAt(head, nat('#e9e7e2', { roughness: 0.5 }), -0.3, 0.3, 0.45, 0.95, -0.25, 0.25);
    const lines = [];
    for (let j = -10; j <= 10; j++) lines.push(j * 14);
    let li = 0, x = -1.6;
    return {
      group: G, view: [[0, 0.2, 0], [0.3, 2.9, 3.6]],
      labels: [
        { text: 'Dicing blade', sub: 'diamond, ~30 µm thick', get: () => new THREE.Vector3(head.position.x, 1.05, head.position.z) },
        { text: 'Tape frame', pos: new THREE.Vector3(-1.95, 0.05, 0.4) },
        { text: 'Cut streets', pos: new THREE.Vector3(0.6, 0.03, -0.9) },
      ],
      tick(dt) {
        blade.rotation.y += dt * 20;
        x += dt * 1.6;
        head.position.set(x, 0, lines[li] / 100);
        // Draw the cut behind the blade on the texture.
        const px = (x * 100 + 150) * W.s;
        W.g.fillStyle = '#2b2e33';
        W.g.fillRect(px - 8, (lines[li] + 150) * W.s - 1.5, 8, 3);
        W.tex.needsUpdate = true;
        if (x > 1.6) {
          x = -1.6; li++;
          if (li >= lines.length) {
            li = 0;
            const fresh = waferTexture(14);
            W.g.drawImage(fresh.canvas, 0, 0);
            fresh.tex.dispose();
          }
        }
      },
    };
  };

  // ---- bond and mold: a leadframe package ---------------------------------------------------
  function packageStation(mold) {
    const G = new THREE.Group();
    const cuFrame = nat('#c98a55', { metalness: 0.75, roughness: 0.35 });
    boxAt(G, cuFrame, -1.0, 1.0, 0, 0.12, -1.0, 1.0);   // die pad
    const leads = [];
    for (let s = 0; s < 4; s++) for (let i = 0; i < 9; i++) {
      const t = -1.2 + 2.4 * (i + 0.5) / 9;
      const [x, z, w, d] = s === 0 ? [t, 1.55, 0.16, 0.6] : s === 1 ? [t, -1.55, 0.16, 0.6] : s === 2 ? [1.55, t, 0.6, 0.16] : [-1.55, t, 0.6, 0.16];
      boxAt(G, cuFrame, x - w / 2, x + w / 2, 0, 0.12, z - d / 2, z + d / 2);
      leads.push([x, z, s]);
    }
    boxAt(G, nat('#47494d', { metalness: 0.4, roughness: 0.5 }), -0.85, 0.85, 0.12, 0.27, -0.85, 0.85);   // die
    const padMat = nat('#d7d9db', { metalness: 0.8, roughness: 0.3 });
    const gold = nat('#e0b44c', { metalness: 1.0, roughness: 0.25 });
    const wires = [];
    for (const [x, z, s] of leads) {
      const p0 = s < 2 ? new THREE.Vector3(x * 0.62, 0.27, Math.sign(z) * 0.76) : new THREE.Vector3(Math.sign(x) * 0.76, 0.27, z * 0.62);
      boxAt(G, padMat, p0.x - 0.04, p0.x + 0.04, 0.27, 0.28, p0.z - 0.04, p0.z + 0.04);
      const p3 = s < 2 ? new THREE.Vector3(x, 0.12, z - Math.sign(z) * 0.18) : new THREE.Vector3(x - Math.sign(x) * 0.18, 0.12, z);
      const p1 = p0.clone().add(new THREE.Vector3(0, 0.45, 0));
      const p2 = p3.clone().lerp(p0, 0.35).add(new THREE.Vector3(0, 0.25, 0));
      const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
      const wm = mesh(new THREE.TubeGeometry(curve, 24, 0.012, 6, false), gold, G);
      wires.push(wm);
    }
    const capillary = mesh(new THREE.ConeGeometry(0.05, 0.6, 16), nat('#e8e6e1', { roughness: 0.4 }), G, 0, 0.9, 0);
    capillary.rotation.x = Math.PI;
    let moldMesh = null;
    if (mold) {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 512;
      const g = c.getContext('2d');
      g.fillStyle = '#1d1e20'; g.fillRect(0, 0, 512, 512);
      g.fillStyle = '#9a9c9f'; g.font = 'bold 54px Arial'; g.textAlign = 'center';
      g.fillText('TX-2026', 256, 230); g.font = '36px Arial'; g.fillText('2643 A3', 256, 300);
      g.beginPath(); g.arc(70, 70, 22, 0, Math.PI * 2); g.fill();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const side = nat('#1d1e20', { roughness: 0.75 });
      const topM = new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 });
      moldMesh = mesh(new THREE.BoxGeometry(3.3, 0.75, 3.3), [side, side, topM, side, side, side], G, 0, 0.42, 0);
    }
    let shown = mold ? wires.length : 0;
    wires.forEach((w, i) => { w.visible = i < shown; });
    return {
      group: G, view: [[0, 0.3, 0], [2.4, 3.4, 4.2]],
      labels: mold
        ? [{ text: 'Epoxy mold compound', sub: 'cures at ~175 °C', pos: new THREE.Vector3(0, 0.85, 1.4) }, { text: 'Leads', pos: new THREE.Vector3(1.75, 0.1, 1.2) }]
        : [{ text: 'Die', pos: new THREE.Vector3(0, 0.3, 0) }, { text: 'Gold wire, ~20 µm', pos: new THREE.Vector3(0.9, 0.55, 1.1) }, { text: 'Lead', pos: new THREE.Vector3(1.6, 0.13, -0.3) }, { text: 'Capillary', get: () => capillary.position.clone().add(new THREE.Vector3(0, 0.35, 0)) }],
      tick(dt) {
        if (mold) {
          moldMesh.visible = (time % 8) < 5;
          capillary.visible = false;
          return;
        }
        const per = 0.35;
        const k = Math.floor(time / per) % (wires.length + 6);
        shown = Math.min(wires.length, k);
        wires.forEach((w, i) => { w.visible = i < shown; });
        const target = wires[Math.min(wires.length - 1, shown)].geometry.parameters.path.v0;
        capillary.position.lerp(new THREE.Vector3(target.x, 0.62, target.z), 0.25);
      },
    };
  }
  STATIONS.bond = () => packageStation(false);
  STATIONS.mold = () => packageStation(true);

  // ---- final: tray, handler, socket --------------------------------------------------------
  STATIONS.final = () => {
    const G = new THREE.Group();
    boxAt(G, nat('#2b2d31', { roughness: 0.8 }), -2.4, 0.6, 0, 0.18, -1.4, 1.4);   // tray
    const pk = nat('#1d1e20', { roughness: 0.7 });
    const parts = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      const x = -2.1 + i * 0.6, z = -1.05 + j * 0.7;
      const m = boxAt(G, pk, x - 0.2, x + 0.2, 0.18, 0.3, z - 0.2, z + 0.2);
      parts.push(m);
    }
    // Test socket with a lid, and the handler's pick head.
    boxAt(G, nat('#c9ccd0', { metalness: 0.4 }), 1.4, 2.6, 0, 0.45, -0.6, 0.6);
    const pad = boxAt(G, nat('#d9b65a', { metalness: 0.8, roughness: 0.3 }), 1.8, 2.2, 0.45, 0.47, -0.2, 0.2);
    const headMat = nat('#4a7ab5', { roughness: 0.5 });
    const head = boxAt(G, headMat, -0.25, 0.25, 0, 0.5, -0.25, 0.25);
    const carried = boxAt(G, pk, -0.2, 0.2, 0, 0.12, -0.2, 0.2);
    const flags = [];
    let cur = 0, t = 0;
    const route = (k) => parts[k].position;
    return {
      group: G, view: [[0, 0.4, 0], [1.2, 3.5, 5.2]],
      labels: [
        { text: 'Tray of packaged parts', pos: new THREE.Vector3(-0.9, 0.4, 1.4) },
        { text: 'Test socket', sub: 'hot and cold, at speed', pos: new THREE.Vector3(2.0, 0.6, 0.6) },
        { text: 'Handler', get: () => head.position.clone().add(new THREE.Vector3(0, 0.6, 0)) },
      ],
      tick(dt) {
        t += dt;
        const P = route(cur);
        const sock = new THREE.Vector3(2.0, 0.47, 0);
        let pos;
        if (t < 1.2) pos = new THREE.Vector3().lerpVectors(P.clone().setY(0.36), sock, ease(t / 1.2));
        else if (t < 2.0) pos = sock.clone();
        else if (t < 3.2) pos = new THREE.Vector3().lerpVectors(sock, P.clone().setY(0.36), ease((t - 2.0) / 1.2));
        else {
          const pass = ((cur * 7) % 9) !== 4;
          const f = boxAt(G, nat(pass ? '#2fa84f' : '#d03b3b', { emissive: pass ? '#1a6b30' : '#7a1a1a', emissiveIntensity: 0.5 }), P.x - 0.06, P.x + 0.06, 0.31, 0.35, P.z - 0.06, P.z + 0.06);
          flags.push(f);
          cur = (cur + 1) % parts.length;
          if (cur === 0) { flags.forEach((x) => G.remove(x)); flags.length = 0; }
          t = 0;
          pos = route(cur).clone().setY(0.36);
        }
        parts.forEach((p, i) => { p.visible = !(i === cur && t < 3.2); });
        carried.position.set(pos.x, pos.y + 0.06, pos.z);
        head.position.set(pos.x, pos.y + 0.37, pos.z);
        pad.material.emissive = new THREE.Color(t > 1.2 && t < 2.0 ? '#806020' : '#000000');
      },
    };
  };

  /* ------------------------------------------------------------------------
   * Transistor architectures
   * --------------------------------------------------------------------- */

  let cutaway = false;

  // Solids never overlap, so cut faces never fight: the substrate is built
  // in pieces around the source, drain, channel and isolation.
  function planarBase(G, cut, opts = {}) {
    const m = opts.mats;
    const body = opts.body || m.si;
    boxAt(G, body, -3, 3, -1.6, -0.9, -1.5, 1.5, cut);
    boxAt(G, body, -2.4, 2.4, -0.9, -0.5, -1.5, 1.5, cut);
    boxAt(G, m.oxs, -3, -2.4, -0.9, 0.04, -1.5, 1.5, cut);
    boxAt(G, m.oxs, 2.4, 3, -0.9, 0.04, -1.5, 1.5, cut);
    if (!opts.noSD) {
      boxAt(G, body, -0.45, 0.45, -0.5, -0.07, -1.5, 1.5, cut);
      boxAt(G, m.elec, -0.45, 0.45, -0.07, 0, -1.5, 1.5, cut);
      boxAt(G, opts.sd || m.np, -2.4, -0.45, -0.5, 0, -1.5, 1.5, cut);
      boxAt(G, opts.sd || m.np, 0.45, 2.4, -0.5, 0, -1.5, 1.5, cut);
      boxAt(G, m.sil, -2.4, -0.85, 0, 0.07, -1.5, 1.5, cut);
      boxAt(G, m.sil, 0.85, 2.4, 0, 0.07, -1.5, 1.5, cut);
    }
    const zc = opts.contactZ || 0.07;
    for (const s of [-1, 1]) boxAt(G, m.w, Math.min(s * 1.63, s * 2.07), Math.max(s * 1.63, s * 2.07), zc, 2.0, -0.25, 0.25, cut);
  }

  function gateStack(G, cut, m, kind) {
    if (kind === 'poly') {
      boxAt(G, m.oxs, -0.5, 0.5, 0, 0.06, -1.45, 1.45, cut);
      boxAt(G, m.poly, -0.5, 0.5, 0.06, 1.2, -1.45, 1.45, cut);
      boxAt(G, m.sil, -0.5, 0.5, 1.2, 1.28, -1.45, 1.45, cut);
    } else {
      // Replacement metal gate: interface oxide, a U of high-k, work-function metal, fill.
      boxAt(G, m.oxs, -0.5, 0.5, 0, 0.03, -1.45, 1.45, cut);
      boxAt(G, m.hk, -0.5, 0.5, 0.03, 0.1, -1.45, 1.45, cut);
      boxAt(G, m.hk, -0.5, -0.43, 0.1, 1.25, -1.45, 1.45, cut);
      boxAt(G, m.hk, 0.43, 0.5, 0.1, 1.25, -1.45, 1.45, cut);
      boxAt(G, m.tin, -0.43, 0.43, 0.1, 0.2, -1.45, 1.45, cut);
      boxAt(G, m.tin, -0.43, -0.35, 0.2, 1.25, -1.45, 1.45, cut);
      boxAt(G, m.tin, 0.35, 0.43, 0.2, 1.25, -1.45, 1.45, cut);
      boxAt(G, m.mg, -0.35, 0.35, 0.2, 1.25, -1.45, 1.45, cut);
    }
    for (const s of [-1, 1]) boxAt(G, m.nit, Math.min(s * 0.5, s * 0.85), Math.max(s * 0.5, s * 0.85), 0, 1.15, -1.45, 1.45, cut);
  }

  function archMats() {
    const m = {};
    for (const k of Object.keys(M)) m[k] = M[k]();
    return m;
  }

  // The gate-all-around family. opts: stacked (CFET), noSub (backside power:
  // the substrate is thinned away).
  function gaaDevice(G, cut, m, opts = {}) {
    const stacked = !!opts.stacked;
    if (!opts.noSub) boxAt(G, m.pw, -2.6, 2.6, -1.6, -0.5, -1.5, 1.5, cut);
    boxAt(G, m.oxs, -2.6, 2.6, -0.5, -0.3, -1.5, 1.5, cut);
    const sheets = stacked ? [-0.05, 0.45, 1.25, 1.75] : [0.1, 0.62, 1.14];
    const st = 0.2, sw = 0.85, hk = 0.05, gx0 = -0.42, gx1 = 0.42;
    sheets.forEach((y, i) => {
      boxAt(G, m.si, -1.4, gx0, y, y + st, -sw, sw, cut);
      boxAt(G, m.elec, gx0, gx1, y, y + st, -sw, sw, cut);
      boxAt(G, m.si, gx1, 1.4, y, y + st, -sw, sw, cut);
      boxAt(G, m.hk, gx0, gx1, y - hk, y, -sw - hk, sw + hk, cut);
      boxAt(G, m.hk, gx0, gx1, y + st, y + st + hk, -sw - hk, sw + hk, cut);
      boxAt(G, m.hk, gx0, gx1, y, y + st, -sw - hk, -sw, cut);
      boxAt(G, m.hk, gx0, gx1, y, y + st, sw, sw + hk, cut);
      if (i < sheets.length - 1 && !(stacked && i === 1)) for (const s of [-1, 1]) boxAt(G, m.nit, Math.min(s * 0.42, s * 0.56), Math.max(s * 0.42, s * 0.56), y + st, sheets[i + 1], -sw, sw, cut);
    });
    const top = sheets[sheets.length - 1] + st + 0.55;
    const ys = [-0.3].concat(sheets.flatMap((y) => [y - hk, y + st + hk]), [top]);
    for (let i = 0; i < ys.length; i += 2) {
      const a = ys[i], b = ys[i + 1];
      if (stacked && i === 4) {
        // Between the pFET and nFET halves: metal, isolation, metal.
        boxAt(G, m.mg, gx0, gx1, a, 0.78, -1.5, 1.5, cut);
        boxAt(G, m.oxs, gx0, gx1, 0.78, 1.0, -1.5, 1.5, cut);
        boxAt(G, m.mg, gx0, gx1, 1.0, b, -1.5, 1.5, cut);
      } else boxAt(G, m.mg, gx0, gx1, a, b, -1.5, 1.5, cut);
    }
    for (const y of sheets) { boxAt(G, m.mg, gx0, gx1, y - hk, y + st + hk, -1.5, -sw - hk, cut); boxAt(G, m.mg, gx0, gx1, y - hk, y + st + hk, sw + hk, 1.5, cut); }
    for (const s of [-1, 1]) boxAt(G, m.nit, Math.min(s * 0.42, s * 0.56), Math.max(s * 0.42, s * 0.56), sheets[sheets.length - 1] + st, top, -1.5, 1.5, cut);
    for (const s of [-1, 1]) {
      const x0 = Math.min(s * 0.56, s * 1.4), x1 = Math.max(s * 0.56, s * 1.4);
      const xa = Math.min(s * 1.4, s * 2.2), xb = Math.max(s * 1.4, s * 2.2);
      // Source/drain epi grows from the sheet ends; the sheets end inside it.
      const epi = (mat, y0, y1) => {
        const inside = sheets.filter((y) => y >= y0 && y + st <= y1);
        let yy = y0;
        for (const y of inside) { boxAt(G, mat, x0, x1, yy, y, -1.0, 1.0, cut); yy = y + st; }
        boxAt(G, mat, x0, x1, yy, y1, -1.0, 1.0, cut);
        for (const y of inside) { boxAt(G, mat, x0, x1, y, y + st, -1.0, -sw, cut); boxAt(G, mat, x0, x1, y, y + st, sw, 1.0, cut); }
        boxAt(G, mat, xa, xb, y0, y1, -1.0, 1.0, cut);
      };
      if (stacked) { epi(m.pp, -0.3, 0.72); boxAt(G, m.oxs, Math.min(x0, xa), Math.max(x1, xb), 0.72, 1.06, -1.0, 1.0, cut); epi(m.np, 1.06, 2.15); }
      else epi(m.np, -0.3, sheets[sheets.length - 1] + st + 0.1);
    }
    return { top, sheets };
  }

  const CUT_AXIS = { finfet: 'x', gaa: 'x', cfet: 'x', bspdn: 'x' };

  const ARCH = {
    planar(G, cut, m) {
      planarBase(G, cut, { mats: m, body: m.pw });
      gateStack(G, cut, m, 'poly');
      return {
        view: [[0, 0.2, 0], [5.0, 4.6, 7.0]],
        labels: [
          ['Source', [-1.2, 0.15, 1.5]], ['Drain', [1.2, 0.15, 1.5]], ['Gate (poly-Si)', [0, 1.35, 1.45]],
          ['Gate oxide', '1–2 nm, here SiON', [0, 0.04, 1.6]], ['Channel', 'forms under the gate', [0, -0.05, 0.9]], ['Spacer', [0.7, 1.15, 1.45]], ['Shallow trench isolation', [2.7, 0.08, 1.4]], ['Contact', [1.85, 2.0, 0]],
        ],
      };
    },
    strain(G, cut, m) {
      planarBase(G, cut, { mats: m, body: m.nw, noSD: true, contactZ: 0.23 });
      gateStack(G, cut, m, 'poly');
      // Embedded SiGe source and drain in a sigma-shaped recess, slightly raised;
      // the silicon between them is cut to the matching shape.
      const prof = [[-2.4, 0.16], [-0.86, 0.16], [-0.7, -0.22], [-0.95, -0.5], [-2.4, -0.5]];
      prism(G, m.sige, prof, 'z', -1.5, 1.5, cut);
      prism(G, m.sige, prof.map(([x, y]) => [-x, y]).reverse(), 'z', -1.5, 1.5, cut);
      const col = [[-0.79, 0], [0.79, 0], [0.7, -0.22], [0.95, -0.5], [-0.95, -0.5], [-0.7, -0.22]];
      prism(G, m.nw, col, 'z', -1.5, 1.5, cut);
      boxAt(G, m.sil, -2.4, -0.86, 0.16, 0.23, -1.5, 1.5, cut);
      boxAt(G, m.sil, 0.86, 2.4, 0.16, 0.23, -1.5, 1.5, cut);
      for (const s of [-1, 1]) {
        const a = new THREE.ArrowHelper(new THREE.Vector3(-s, 0, 0), new THREE.Vector3(s * 1.35, -0.25, 1.75), 0.7, cssVar('--tx-hole') || '#d1392f', 0.22, 0.14);
        G.add(a);
      }
      return {
        view: [[0, 0.1, 0], [4.6, 3.8, 7.2]],
        labels: [
          ['SiGe source/drain', 'germanium atoms are bigger', [-1.6, 0.3, 1.5]], ['Squeezed channel', 'holes ~50% faster', [0, -0.2, 1.8]], ['PMOS gate', [0, 1.35, 1.45]],
        ],
      };
    },
    hkmg(G, cut, m) {
      planarBase(G, cut, { mats: m, body: m.pw });
      gateStack(G, cut, m, 'metal');
      return {
        view: [[0, 0.3, 0], [4.2, 3.6, 6.2]],
        labels: [
          ['High-k (HfO₂)', '~2 nm, lines the gate trench', [-0.47, 0.8, 1.5]], ['Work-function metal', 'sets V_T', [0.39, 0.7, 1.5]], ['Gate fill', 'Al or W', [0, 1.2, 1.5]], ['Interface SiO₂', '~0.5 nm', [0, 0.02, 1.7]],
        ],
      };
    },
    finfet(G, cut, m) {
      const fins = [-1.0, 0, 1.0], fw = 0.11, ftop = 1.0;
      boxAt(G, m.pw, -3, 3, -1.6, -0.9, -1.6, 1.6, cut);
      const gx0 = -0.42, gx1 = 0.42, hk = 0.05;
      for (const z of fins) {
        // The fin: silicon outside the gate, a channel inside it.
        boxAt(G, m.si, -3, gx0, -0.9, ftop, z - fw, z + fw, cut);
        boxAt(G, m.si, gx0, gx1, -0.9, 0, z - fw, z + fw, cut);
        boxAt(G, m.elec, gx0, gx1, 0, ftop, z - fw, z + fw, cut);
        boxAt(G, m.si, gx1, 3, -0.9, ftop, z - fw, z + fw, cut);
      }
      const edges = [-1.6].concat(fins.flatMap((z) => [z - fw, z + fw]), [1.6]);
      for (let i = 0; i < edges.length; i += 2) boxAt(G, m.oxs, -3, 3, -0.9, 0, edges[i], edges[i + 1], cut);
      for (const z of fins) {
        boxAt(G, m.hk, gx0, gx1, ftop, ftop + hk, z - fw - hk, z + fw + hk, cut);
        boxAt(G, m.hk, gx0, gx1, 0, ftop, z - fw - hk, z - fw, cut);
        boxAt(G, m.hk, gx0, gx1, 0, ftop, z + fw, z + fw + hk, cut);
      }
      boxAt(G, m.mg, gx0, gx1, ftop + hk, 1.8, -1.6, 1.6, cut);
      const gEdges = [-1.6].concat(fins.flatMap((z) => [z - fw - hk, z + fw + hk]), [1.6]);
      for (let i = 0; i < gEdges.length; i += 2) boxAt(G, m.mg, gx0, gx1, 0, ftop + hk, gEdges[i], gEdges[i + 1], cut);
      // Gate spacers, cut around the fins.
      for (const s of [-1, 1]) {
        const x0 = Math.min(s * 0.42, s * 0.62), x1 = Math.max(s * 0.42, s * 0.62);
        boxAt(G, m.nit, x0, x1, ftop, 1.75, -1.6, 1.6, cut);
        for (let i = 0; i < edges.length; i += 2) boxAt(G, m.nit, x0, x1, 0, ftop, edges[i], edges[i + 1], cut);
      }
      // Epitaxial source/drain diamonds wrapping each fin, outside the spacers.
      for (const z of fins) {
        const hex = [[z, 0.15], [z + 0.34, 0.6], [z + 0.3, 1.15], [z, 1.38], [z - 0.3, 1.15], [z - 0.34, 0.6]];
        for (const [a, b] of [[0.62, 2.6], [-2.6, -0.62]]) {
          prism(G, m.np, hex, 'x', a, b, cut);
        }
      }
      for (const s of [-1, 1]) boxAt(G, m.w, Math.min(s * 1.4, s * 1.85), Math.max(s * 1.4, s * 1.85), 1.38, 2.3, -1.45, 1.45, cut);
      return {
        view: [[0, 0.6, 0], [5.2, 4.8, 6.0]],
        labels: [
          ['Fin', '~8 nm wide silicon', [-2.0, 0.6, 1.0]], ['Gate on three sides', [0, 1.85, 0.5]], ['Channel', 'on the fin’s top and sides', [0, 0.5, 1.1]], ['Epitaxial source/drain', [1.6, 1.4, 0]], ['Shallow trench isolation', [-2.2, 0.02, 1.5]], ['Trench contact', [1.62, 2.3, -1.0]],
        ],
      };
    },
    gaa(G, cut, m) {
      const r = gaaDevice(G, cut, m);
      return {
        view: [[0, 0.7, 0], [5.0, 4.0, 5.6]],
        labels: [['Nanosheets', '~5 nm thick, 3 high', [-1.1, 1.3, 0.85]], ['Gate on all four sides', [0, r.top, 0.6]], ['Inner spacers', [0.5, 0.45, 0.85]], ['Source/drain epi', [1.8, 1.5, 1.0]]],
      };
    },
    cfet(G, cut, m) {
      const r = gaaDevice(G, cut, m, { stacked: true });
      return {
        view: [[0, 0.8, 0], [5.0, 4.0, 5.8]],
        labels: [['nFET sheets (top)', [-1.1, 1.85, 0.9]], ['pFET sheets (bottom)', [-1.1, 0.2, 0.9]], ['Shared gate', [0, r.top, 0.6]], ['Isolation between', [1.8, 0.9, 1.0]]],
      };
    },
    bspdn(G, cut, m) {
      gaaDevice(G, cut, m, { noSub: true });
      // Signal wiring above (front side), power wiring below (back side).
      const top = 2.3;
      for (let l = 0; l < 4; l++) {
        const y0 = top + l * 0.5;
        boxAt(G, m.lowk, -2.6, 2.6, y0, y0 + 0.15, -1.5, 1.5, cut);
        boxAt(G, m.lowk, -2.6, 2.6, y0 + 0.3, y0 + 0.45, -1.5, 1.5, cut);
        if (l % 2 === 0) {
          const zs = [-1.25, -0.75, -0.25, 0.25, 0.75, 1.25];
          let zz = -1.5;
          for (const z of zs) { boxAt(G, m.lowk, -2.6, 2.6, y0 + 0.15, y0 + 0.3, zz, z - 0.08, cut); boxAt(G, m.cu, -2.6, 2.6, y0 + 0.15, y0 + 0.3, z - 0.08, z + 0.08, cut); zz = z + 0.08; }
          boxAt(G, m.lowk, -2.6, 2.6, y0 + 0.15, y0 + 0.3, zz, 1.5, cut);
        } else {
          let xx = -2.6;
          for (let i = 0; i < 8; i++) { const x = -2.3 + i * 0.66; boxAt(G, m.lowk, xx, x - 0.08, y0 + 0.15, y0 + 0.3, -1.5, 1.5, cut); boxAt(G, m.cu, x - 0.08, x + 0.08, y0 + 0.15, y0 + 0.3, -1.5, 1.5, cut); xx = x + 0.08; }
          boxAt(G, m.lowk, xx, 2.6, y0 + 0.15, y0 + 0.3, -1.5, 1.5, cut);
        }
      }
      boxAt(G, nat('#b9bcc1', { transparent: true, opacity: 0.35, depthWrite: false }), -2.6, 2.6, top + 2.05, top + 2.5, -1.5, 1.5, cut);
      // Back side: substrate gone; contacts down to thick power rails.
      for (const s of [-1, 1]) boxAt(G, m.w, Math.min(s * 1.6, s * 2.0), Math.max(s * 1.6, s * 2.0), -1.9, -0.3, -0.2, 0.2, cut);
      boxAt(G, m.lowk, -2.6, 2.6, -1.9, -0.5, -1.5, 1.5, cut === 'x' ? 'x' : cut);
      for (const x of [-1.8, 1.8]) boxAt(G, m.cu, x - 0.35, x + 0.35, -2.4, -1.9, -1.5, 1.5, cut);
      boxAt(G, m.cu, -2.6, 2.6, -3.0, -2.5, -1.0, 1.0, cut);
      return {
        view: [[0, 0.5, 0], [6.0, 4.5, 8.0]],
        labels: [
          ['Signal wiring (front side)', [-2.2, 3.4, 1.4]], ['Carrier wafer, bonded on top', [0, 4.6, 1.4]], ['Transistors', [0, 1.0, 1.4]],
          ['Backside contact', [1.8, -1.0, 0]], ['Power wiring (back side)', [-1.3, -2.6, 1.4]],
        ],
      };
    },
  };

  function buildArch(name) {
    const G = new THREE.Group();
    const m = archMats();
    const cutAxis = CUT_AXIS[name] || 'z';
    let info = null;
    function rebuild() {
      G.children.slice().forEach((c) => { G.remove(c); if (c.geometry) c.geometry.dispose(); });
      info = ARCH[name](G, cutaway ? cutAxis : null, m);
    }
    rebuild();
    const toV = (p) => new THREE.Vector3(p[0], p[1], p[2]);
    return {
      group: G, view: info.view,
      labels: info.labels.map((L) => (L.length === 2 ? { text: L[0], pos: toV(L[1]) } : { text: L[0], sub: L[1], pos: toV(L[2]) })),
      rebuild,
      tick() {},
    };
  }
  for (const a of Object.keys(ARCH)) STATIONS['arch-' + a] = () => buildArch(a);

  /* ------------------------------------------------------------------------
   * Showing a station, camera moves
   * --------------------------------------------------------------------- */

  let fly = null;
  function show(name) {
    if (!STATIONS[name]) return;
    if (!built[name]) {
      built[name] = STATIONS[name]();
      scene.add(built[name].group);
    }
    for (const k in built) built[k].group.visible = k === name;
    active = built[name];
    activeName = name;
    setLabels(active.labels || []);
    const [t, o] = active.view;
    const target = new THREE.Vector3(...t);
    // Stand back further on narrow or portrait screens, where the horizontal
    // field of view is what limits the framing.
    const aspect = (host.clientWidth || window.innerWidth) / (host.clientHeight || window.innerHeight);
    const k = 1.3 * Math.pow(Math.max(1, 1.4 / aspect), 0.85);
    const pos = target.clone().add(new THREE.Vector3(...o).multiplyScalar(k));
    const fromT = controls.target.clone(), fromP = camera.position.clone();
    if (!started) { controls.target.copy(target); camera.position.copy(pos); started = true; fly = null; }
    else fly = { t0: performance.now(), fromT, fromP, target, pos };
  }
  let activeName = null;
  let started = false;

  /* ------------------------------------------------------------------------
   * Loop, sizing
   * --------------------------------------------------------------------- */

  const viewOffset = { x: 0, y: 0 };
  function resize() {
    const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    if (viewOffset.x || viewOffset.y) camera.setViewOffset(w, h, viewOffset.x, viewOffset.y, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  let running = false, raf = 0, last = performance.now();
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    if (fly) {
      const t = ease((now - fly.t0) / 900);
      controls.target.lerpVectors(fly.fromT, fly.target, t);
      camera.position.lerpVectors(fly.fromP, fly.pos, t);
      if (t >= 1) fly = null;
    }
    controls.update();
    if (active && active.tick) active.tick(dt);
    renderer.render(scene, camera);
    placeLabels();
    raf = requestAnimationFrame(frame);
  }

  return {
    show,
    pause() { running = false; cancelAnimationFrame(raf); if (labelLayer) labelLayer.hidden = true; },
    resume() { if (running) return; running = true; last = performance.now(); resize(); if (labelLayer) labelLayer.hidden = false; raf = requestAnimationFrame(frame); },
    setOffset(x, y) { viewOffset.x = x; viewOffset.y = y; resize(); },
    setAccent() {},
    setTheme,
    setCz(p) { if (!built.cz) show('cz'); built.cz.setCz(p); },
    setCutaway(on) {
      cutaway = on;
      for (const k in built) if (k.startsWith('arch-') && built[k].rebuild) built[k].rebuild();
    },
    get cutaway() { return cutaway; },
    setLabelsVisible(v) { showLabels = v; },
    get station() { return activeName; },
    get debug() { return { running, time, active: activeName, cz: built.cz && built.cz.debug }; },
  };
}

TR.scene = { createScene };
})(window.Transistors, window.THREE);
