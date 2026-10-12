/*
 * The 3D diorama for knowledge/powergrid.html: terrain, plants, lines, towns,
 * weather and power-flow particles, built from three.js primitives (the
 * classic build vendored in js/vendor/three, global THREE). Becomes
 * PowerGrid.scene; main.js loads it only once three.js has loaded.
 *
 * main.js owns all state. It calls frame(dt, view) once per animation frame
 * with what the grid is doing; this module only draws it.
 *
 * Coordinates: x runs west to east, z north (negative, the mountains) to south
 * (positive, the towns), y is up. The sun rises in +x and sets in -x.
 */
(function (PG, THREE) {
'use strict';
const { OrbitControls } = THREE;
const { mergeGeometries } = THREE.BufferGeometryUtils;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ----------------------------------------------------------------------------
 * Terrain
 * ------------------------------------------------------------------------- */

const W = 980, D = 700;
const LAKE = { x: -238, z: 30, r: 46 };
const RIVER = [[-218, -166], [-222, -122], [-258, -84], [-266, -42], [-252, -10]];
const BORDER = [[284, -350], [279, -130], [290, 40], [281, 350]];
const BORDER_X = 284;

// Flat pads under facilities: [x, z, width, depth, y].
const PADS = [
  [-195, -56, 104, 78, 2.2], [-104, -62, 96, 72, 2.2], [0, -86, 74, 58, 2.2], [76, -46, 50, 38, 2.2],
  [198, -47, 108, 78, 2.2], [150, 46, 54, 32, 2.2], [-20, 40, 62, 46, 2.2], [100, 72, 38, 28, 2.2],
  [-96, 120, 32, 24, 2.2], [-158, 178, 150, 86, 2.2], [60, 125, 32, 24, 2.2], [92, 184, 126, 74, 2.2],
  [170, 120, 58, 38, 2.2], [216, 176, 74, 54, 2.2], [254, 50, 34, 32, 2.2], [314, 50, 32, 32, 2.2],
  [-96, -136, 54, 36, 6], [396, 150, 76, 54, 2.2], [396, -36, 44, 32, 2.2], [130, -124, 20, 16, 7],
  [-188, -150, 26, 20, 2.2],
];

function n2(x, z) {
  return Math.sin(x * 0.013 + 1.3) * Math.cos(z * 0.011 - 0.7) * 0.6
    + Math.sin(x * 0.031 + z * 0.023) * 0.3
    + Math.sin(x * 0.071 - z * 0.053 + 2.1) * 0.1;
}

function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

function rawHeight(x, z) {
  let h = 2.0 + 1.2 * n2(x, z);
  const m = smoothstep(-115, -215, z);
  if (m > 0) {
    let mh = m * (58 + 26 * n2(x * 1.7 + 40, z * 1.3 - 20) + 14 * Math.sin(x * 0.021 + 0.5));
    // The hydro valley: a gorge through the range, flooded behind the dam.
    const c = 1 - smoothstep(14, 52, Math.abs(x + 218));
    if (c > 0) mh = mh * (1 - c) + Math.min(mh, z < -172 ? 4 : 0) * c;
    h += mh;
  }
  // The wind farm's ridge.
  h += 10 * Math.exp(-((z + 150) ** 2) / 260) * smoothstep(20, 60, x) * (1 - smoothstep(255, 285, x));
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dl < LAKE.r + 16) h = Math.min(h, lerp(-3, h, smoothstep(LAKE.r - 12, LAKE.r + 16, dl)));
  const dr = distToPolyline(x, z, RIVER);
  if (dr < 14 && z > -170) h = Math.min(h, lerp(-2.5, h, smoothstep(3, 12, dr)));
  const db = distToPolyline(x, z, BORDER);
  if (db < 16) h = Math.min(h, lerp(-2.5, h, smoothstep(5, 15, db)));
  return h;
}

function heightAt(x, z) {
  let h = rawHeight(x, z);
  for (const [px, pz, pw, pd, py] of PADS) {
    const dx = Math.max(0, Math.abs(x - px) - pw / 2);
    const dz = Math.max(0, Math.abs(z - pz) - pd / 2);
    const f = 1 - smoothstep(0, 12, Math.hypot(dx, dz));
    if (f > 0) h = lerp(h, py, f);
  }
  return h;
}

/* ----------------------------------------------------------------------------
 * Geometry helpers: everything static is collected into Parts with a colour
 * per part, then merged into one vertex-coloured mesh (one draw call).
 * ------------------------------------------------------------------------- */

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = {};
const cylGeo = (seg) => CYL[seg] || (CYL[seg] = new THREE.CylinderGeometry(1, 1, 1, seg));

class Parts {
  constructor() { this.list = []; }

  add(geo, color, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    g.applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)));
    _c.set(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.list.push(g);
    return g;
  }

  // Boxes and cylinders sit on their base at y.
  box(color, x, y, z, w, h, d, ry = 0) { return this.add(BOX, color, x, y + h / 2, z, w, h, d, 0, ry, 0); }
  cyl(color, x, y, z, r, h, seg = 12) { return this.add(cylGeo(seg), color, x, y + h / 2, z, r, h, r); }
  taper(color, x, y, z, rb, rt, h, seg = 12) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y + h / 2, z);
  }
  // A horizontal cylinder from (x1,y1,z1) to (x2,y2,z2).
  pipe(color, a, b, r, seg = 8) {
    const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = v.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
    return this.add(g, color, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  }
  sphere(color, x, y, z, r, detail = 1) { return this.add(new THREE.IcosahedronGeometry(r, detail), color, x, y, z); }
  dome(color, x, y, z, r) {
    return this.add(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), color, x, y, z);
  }

  mesh(material) {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list, false);
    this.list.forEach((x) => x.dispose());
    this.list = [];
    return new THREE.Mesh(g, material);
  }
}

// A ribbon (road, rail bed) draped over the terrain.
function ribbon(points, width, color, lift = 0.15, minY = 1.0) {
  const pos = [];
  const step = 4;
  const samples = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) samples.push([lerp(ax, bx, k / n), lerp(az, bz, k / n)]);
  }
  samples.push(points[points.length - 1]);
  for (let i = 0; i < samples.length - 1; i++) {
    const [ax, az] = samples[i], [bx, bz] = samples[i + 1];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * width / 2, nz = dx / l * width / 2;
    const ya = Math.max(minY, heightAt(ax, az)) + lift, yb = Math.max(minY, heightAt(bx, bz)) + lift;
    pos.push(ax + nx, ya, az + nz, ax - nx, ya, az - nz, bx + nx, yb, bz + nz);
    pos.push(ax - nx, ya, az - nz, bx - nx, yb, bz - nz, bx + nx, yb, bz + nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return { geo: g, color };
}

/* ----------------------------------------------------------------------------
 * Transmission and distribution lines
 * ------------------------------------------------------------------------- */

// Voltage classes: colour of the power-flow particles and, in voltage mode,
// of the wires themselves.
const VCLASS = {
  500: { label: '500 kV transmission', color: '#c084fc', tower: 'lattice' },
  138: { label: '138 kV subtransmission', color: '#60a5fa', tower: 'mono' },
  12: { label: '12.47 kV distribution', color: '#4ade80', tower: 'pole' },
  0: { label: '120/240 V service', color: '#facc15', tower: 'none' },
  dc: { label: '± DC link', color: '#fb923c', tower: 'dc' },
};

// Each line runs from its source end to its sink end. `flow` names what
// main.js's view supplies for it (a generation group or a load share).
const LINES = [
  { id: 'nuc', cls: 500, flow: 'nuclear', pts: [[-152, -36], [-122, -16], [-90, 4], [-58, 24]] },
  { id: 'coal', cls: 500, flow: 'coal', pts: [[-66, -42], [-52, -16], [-40, 10], [-34, 24]] },
  { id: 'gas', cls: 500, flow: 'gascc', pts: [[26, -64], [22, -34], [14, -6], [4, 22]] },
  { id: 'peak', cls: 138, flow: 'peaker', pts: [[66, -30], [44, -8], [10, 26]] },
  { id: 'hydro', cls: 500, flow: 'hydro', pts: [[-184, -156], [-158, -124], [-128, -110], [-86, -112], [-58, -96], [-58, -64], [-62, -30], [-54, 0], [-46, 26]] },
  { id: 'geo', cls: 138, flow: 'other', pts: [[-80, -130], [-68, -118], [-58, -96]] },
  { id: 'wind', cls: 500, flow: 'wind', pts: [[130, -118], [104, -96], [76, -78], [48, -62], [36, -34], [24, -6], [8, 24]] },
  { id: 'solar', cls: 500, flow: 'solar', pts: [[150, -14], [112, 0], [76, 10], [40, 18], [10, 30]] },
  { id: 'batt', cls: 138, flow: 'storage', pts: [[124, 46], [96, 44], [66, 44], [36, 44], [10, 44]] },
  { id: 'tie', cls: 500, flow: 'tie', pts: [[12, 34], [60, 30], [110, 24], [170, 22], [215, 30], [240, 46]] },
  { id: 'dc', cls: 'dc', flow: 'tie', pts: [[270, 50], [284, 50], [298, 50]] },
  { id: 'subA', cls: 138, flow: 'town', pts: [[-40, 60], [-62, 84], [-82, 110]] },
  { id: 'subB', cls: 138, flow: 'city', pts: [[0, 62], [24, 90], [48, 114]] },
  { id: 'fact', cls: 138, flow: 'factory', pts: [[8, 60], [52, 98], [100, 110], [146, 116]] },
  { id: 'dcen', cls: 138, flow: 'datacenter', pts: [[6, 62], [18, 100], [30, 140], [124, 142], [178, 150], [194, 158]] },
  { id: 'nbr1', cls: 138, flow: 'neighbor', pts: [[330, 58], [350, 92], [372, 122]] },
  { id: 'nbr2', cls: 138, flow: 'neighborGen', pts: [[392, -20], [370, 0], [345, 28], [330, 44]] },
];

/* ----------------------------------------------------------------------------
 * Facilities: everything clickable. `box` is the pick volume, `cam` the
 * camera offset used when focusing, `anchor` where the label floats.
 * ------------------------------------------------------------------------- */

const FAC = {
  nuclear: { name: 'Nuclear plant', box: [-245, 0, -95, -145, 46, -18] },
  coal: { name: 'Coal plant', box: [-152, 0, -98, -62, 76, -26] },
  gascc: { name: 'Gas combined cycle', box: [-36, 0, -112, 34, 34, -58] },
  peaker: { name: 'Gas peaker', box: [52, 0, -62, 98, 16, -28] },
  hydro: { name: 'Hydro dam', box: [-255, 0, -186, -176, 30, -146] },
  geo: { name: 'Geothermal plant', box: [-124, 0, -154, -68, 24, -118] },
  wind: { name: 'Wind farm', box: [36, 0, -172, 260, 60, -126] },
  solar: { name: 'Solar farm', box: [144, 0, -86, 252, 8, -8] },
  battery: { name: 'Battery storage', box: [122, 0, 30, 178, 10, 62] },
  hub: { name: 'Transmission substation', box: [-52, 0, 16, 12, 22, 64] },
  control: { name: 'Grid control center', box: [82, 0, 58, 118, 18, 86] },
  distsub: { name: 'Distribution substation', box: [-112, 0, 108, -80, 14, 132] },
  town: { name: 'Neighborhood', box: [-232, 0, 134, -84, 14, 222] },
  city: { name: 'Downtown', box: [30, 0, 146, 154, 64, 222] },
  factory: { name: 'Factory', box: [140, 0, 100, 200, 24, 140] },
  datacenter: { name: 'Data center', box: [178, 0, 148, 254, 16, 204] },
  hvdc: { name: 'AC–DC–AC tie', box: [236, 0, 34, 330, 22, 66] },
  neighbor: { name: 'Neighboring grid', box: [330, 0, -60, 470, 40, 190] },
  pole: { name: 'Pole-top transformer', box: [-118, 0, 141, -106, 12, 152] },
  gsu: { name: 'Step-up transformer', box: [-160, 0, -50, -138, 10, -30] },
  line345: { name: 'Transmission line', box: [-124, 0, -22, -86, 36, 10] },
};

// Camera framings: [target, offset from target].
const VIEWS = {
  overview: [[20, 0, -10], [0, 420, 500]],
  nuclear: [[-196, 14, -58], [-40, 72, 128]],
  coal: [[-104, 16, -62], [60, 70, 110]],
  gascc: [[0, 10, -84], [50, 50, 90]],
  peaker: [[76, 6, -44], [34, 30, 58]],
  hydro: [[-216, 14, -170], [40, 50, 90]],
  geo: [[-96, 8, -136], [36, 36, 70]],
  wind: [[146, 30, -150], [40, 60, 150]],
  solar: [[198, 2, -46], [10, 70, 110]],
  battery: [[150, 4, 46], [30, 34, 60]],
  hub: [[-20, 6, 40], [36, 50, 76]],
  control: [[100, 6, 72], [30, 30, 54]],
  distsub: [[-96, 4, 120], [26, 30, 50]],
  town: [[-158, 4, 178], [40, 70, 110]],
  city: [[92, 20, 184], [40, 70, 120]],
  factory: [[170, 6, 120], [30, 34, 62]],
  datacenter: [[216, 6, 176], [30, 40, 70]],
  hvdc: [[284, 8, 50], [10, 50, 90]],
  neighbor: [[380, 10, 60], [-30, 120, 200]],
  pole: [[-112, 8, 147], [14, 6, 20]],
  gsu: [[-150, 4, -40], [20, 14, 30]],
  line345: [[-104, 20, -8], [34, 26, 60]],
  house: [[-137, 4, 152], [18, 10, 26]],
};

/* ----------------------------------------------------------------------------
 * The scene
 * ------------------------------------------------------------------------- */

function createScene(container, { onPick, onHover, labelLayer } = {}) {
  const plumeSources = [];
  const mobile = window.matchMedia('(max-width: 900px)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '3D model of a power grid. Drag to orbit, scroll or pinch to zoom, click a facility to read about it.');
  renderer.domElement.setAttribute('role', 'img');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 2, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 18;
  controls.maxDistance = 900;
  controls.maxPolarAngle = 1.38;
  controls.screenSpacePanning = false;
  controls.maxTargetRadius = 430;
  controls.autoRotateSpeed = 0.4;

  const sky = new THREE.Color('#9cc9ee');
  scene.background = sky.clone();
  scene.fog = new THREE.Fog(sky.clone(), 650, 1700);

  const hemi = new THREE.HemisphereLight('#dceeff', '#6b7a52', 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -480, right: 480, top: 360, bottom: -360, near: 10, far: 1600 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight('#8fa6d8', 0);
  moon.position.set(-200, 300, 200);
  scene.add(moon);

  const matStatic = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const matBasicVC = new THREE.MeshBasicMaterial({ vertexColors: true });

  // ----- Terrain -----
  const tGeo = new THREE.PlaneGeometry(W, D, 196, 140);
  tGeo.rotateX(-Math.PI / 2);
  const tPos = tGeo.attributes.position;
  const nV = tPos.count;
  const baseCol = new Float32Array(nV * 3), snowCol = new Float32Array(nV * 3);
  const cGrass = new THREE.Color('#7ea35a'), cGrass2 = new THREE.Color('#6a9149'), cDry = new THREE.Color('#a4a36a');
  const cSand = new THREE.Color('#c9b98d'), cRock = new THREE.Color('#8c857a'), cRock2 = new THREE.Color('#a39b8e');
  const cSnow = new THREE.Color('#f3f5f7'), cNbr = new THREE.Color('#b0a46a');
  for (let i = 0; i < nV; i++) {
    const x = tPos.getX(i), z = tPos.getZ(i);
    const h = heightAt(x, z);
    tPos.setY(i, h);
    const c = new THREE.Color();
    if (h < 0.9) c.copy(cSand);
    else if (h < 14) c.copy(cGrass).lerp(cGrass2, 0.5 + 0.5 * n2(x * 2.3, z * 2.1)).lerp(cDry, clamp((h - 6) / 10, 0, 0.5));
    else if (h < 30) c.copy(cGrass2).lerp(cRock, (h - 14) / 16);
    else c.copy(cRock).lerp(cRock2, clamp((h - 30) / 30, 0, 1));
    if (h > 62) c.lerp(cSnow, clamp((h - 62) / 10, 0, 1));
    if (x > BORDER_X + 6 && h < 14) c.lerp(cNbr, 0.45);
    c.toArray(baseCol, i * 3);
    const s = new THREE.Color().copy(cSnow);
    if (h < 0.9) s.lerp(cSand, 0.4);
    if (h > 14 && h < 40) s.lerp(cRock, 0.18);
    s.toArray(snowCol, i * 3);
  }
  const tCol = new Float32Array(baseCol);
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  tGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(tGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  let snowNow = 0;

  const water = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ color: '#3f7fae', transparent: true, opacity: 0.9 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.25;
  water.receiveShadow = true;
  scene.add(water);
  const reservoir = new THREE.Mesh(new THREE.PlaneGeometry(76, 150), water.material);
  reservoir.rotation.x = -Math.PI / 2;
  reservoir.position.set(-218, 17.5, -248);
  scene.add(reservoir);

  // ----- Static scenery -----
  const P = new Parts();
  const towers = new Parts();
  const glowParts = new Parts();
  const groundY = 2.2;

  buildNuclear(P);
  buildCoal(P);
  buildGasCC(P);
  buildPeaker(P);
  buildHydro(P);
  buildGeothermal(P);
  buildHub(P);
  buildControl(P);
  buildDistSub(P, -96, 120);
  buildDistSub(P, 60, 125);
  buildFactory(P);
  buildDataCenter(P);
  buildConverters(P);
  buildNeighbor(P);
  buildBatteryYard(P, glowParts);
  buildSolarBase(P);

  // Roads and rail
  const roadDefs = [
    ribbon([[-490, 150], [-232, 150], [-84, 150], [-40, 140], [30, 150], [160, 150], [250, 150], [276, 150]], 5, '#5d5a55'),
    ribbon([[-154, -29], [-60, -29]], 4.2, '#6a5e52', 0.12, 1.4),
    ribbon([[-210, 180], [-90, 180]], 4, '#5d5a55'), ribbon([[-210, 205], [-90, 205]], 4, '#5d5a55'),
    ribbon([[-90, 150], [-90, 210]], 4, '#5d5a55'), ribbon([[-150, 150], [-150, 210]], 3.4, '#5d5a55'),
    ribbon([[-210, 150], [-210, 210]], 3.4, '#5d5a55'),
  ];
  for (const r of roadDefs) {
    const g = r.geo;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    _c.set(r.color);
    for (let i = 0; i < n; i++) _c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    P.list.push(g);
  }
  buildTrain(P);

  // ----- Town, trees, city -----
  const houses = buildTown(P);
  const nbrHouses = buildNeighborTown(P);
  const trees = buildTrees();
  scene.add(trees.mesh);
  const city = buildCity();
  scene.add(city.mesh);

  // ----- Lines -----
  const lines = buildLines(towers);
  const distLines = buildDistribution(towers, houses);
  lines.push(...distLines);
  const allLines = lines;

  const staticMesh = P.mesh(matStatic);
  staticMesh.castShadow = true;
  staticMesh.receiveShadow = true;
  scene.add(staticMesh);
  const towerMesh = towers.mesh(matStatic);
  towerMesh.castShadow = true;
  scene.add(towerMesh);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#9ef0a8' });
  const glowMesh = glowParts.mesh(glowMat);
  if (glowMesh) { glowMesh.material = glowMat; scene.add(glowMesh); }

  // ----- Animated: wind rotors, solar trackers, plumes, particles -----
  const wind = buildWindFarm();
  const solar = buildSolarPanels();
  const plumes = buildPlumes();
  const particles = buildParticles(allLines);
  const weather = buildWeather();
  const clouds = buildClouds();
  const ring = buildRing();

  // ----- Pick volumes -----
  const pickables = [];
  const pickGroup = new THREE.Group();
  for (const [id, f] of Object.entries(FAC)) {
    const [x1, y1, z1, x2, y2, z2] = f.box;
    const m = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial());
    m.position.set((x1 + x2) / 2, groundY + (y1 + y2) / 2, (z1 + z2) / 2);
    m.scale.set(x2 - x1, y2 - y1, z2 - z1);
    m.updateMatrixWorld(true);
    m.userData.id = id;
    m.userData.size = Math.max(x2 - x1, z2 - z1);
    pickables.push(m);
    f.center = m.position.clone();
    f.size = m.userData.size;
    f.anchor = new THREE.Vector3(m.position.x, groundY + y2 + 4, m.position.z);
  }
  FAC.wind.anchor.set(146, 92, -150);
  FAC.solar.anchor.y = 16;
  FAC.city.anchor.y = 70;

  /* ----- Labels ----- */
  const labels = {};
  const LABELED = ['nuclear', 'coal', 'gascc', 'peaker', 'hydro', 'geo', 'wind', 'solar', 'battery', 'hub', 'control', 'distsub', 'town', 'city', 'factory', 'datacenter', 'hvdc', 'neighbor'];
  if (labelLayer) {
    for (const id of LABELED) {
      const el = document.createElement('div');
      el.className = 'xp-label';
      el.innerHTML = `<b></b><small></small>`;
      el.querySelector('b').textContent = FAC[id].name;
      el.addEventListener('click', (e) => { e.stopPropagation(); if (onPick) onPick(id); });
      labelLayer.appendChild(el);
      labels[id] = { el, sub: el.querySelector('small'), text: '' };
    }
  }

  /* ----- Camera ----- */
  let tween = null;
  const offset = { x: 0, y: 0, tx: 0, ty: 0 };

  function viewFor(id) {
    const v = VIEWS[id] || VIEWS.overview;
    const target = new THREE.Vector3(...v[0]);
    const pos = target.clone().add(new THREE.Vector3(...v[1]));
    // Phones: back off, more for portrait (its horizontal view is narrow).
    const portrait = camera.aspect < 0.8;
    if (mobile || portrait) pos.sub(target).multiplyScalar(portrait ? (id === 'overview' ? 1.25 : 1.15) : 1.35).add(target);
    return { target, pos };
  }

  function focus(id, instant = false) {
    const { target, pos } = viewFor(id);
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      controls.target.copy(target);
      camera.position.copy(pos);
      controls.update();
      tween = null;
      return;
    }
    tween = { t: 0, dur: 1.4, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target, toP: pos };
  }

  /* ----- Picking ----- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, false);
    if (!hits.length) return null;
    // Prefer the smallest volume under the cursor: a pole beats the town.
    hits.sort((a, b) => a.object.userData.size - b.object.userData.size);
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
    const now = performance.now();
    if (now - hoverT < 60) return;
    hoverT = now;
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
    // A taller field of view in portrait keeps the scene from feeling cropped.
    camera.fov = camera.aspect < 0.8 ? 52 : 38;
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

  /* ----------------------------------------------------------------------
   * Per-frame update
   * ------------------------------------------------------------------- */
  let time = 0;
  let lastSun = new THREE.Vector3();
  let shadowClock = 1;
  const tmpV = new THREE.Vector3();
  let selected = null;

  function frame(dt, view) {
    time += dt;
    dt = Math.min(dt, 0.1);

    if (tween) {
      tween.t += dt / tween.dur;
      const k = tween.t >= 1 ? 1 : 1 - Math.pow(1 - tween.t, 3);
      controls.target.lerpVectors(tween.fromT, tween.toT, k);
      camera.position.lerpVectors(tween.fromP, tween.toP, k);
      if (tween.t >= 1) tween = null;
    }
    controls.update();

    offset.x += (offset.tx - offset.x) * Math.min(1, dt * 8);
    offset.y += (offset.ty - offset.y) * Math.min(1, dt * 8);
    applyOffset();

    updateSky(view);
    updateSnow(view.snow || 0);
    wind.update(dt, view);
    solar.update(view);
    plumes.update(dt, view);
    particles.update(dt, view);
    weather.update(dt, view, controls.target);
    clouds.update(dt, view);
    houses.update(view);
    nbrHouses.update(view);
    trees.update(time, view);
    city.update(view);
    updateLines(view);
    updateGlow(view);
    ring.update(time, selected);

    // Shadows are the most expensive pass: refresh them when the sun has moved.
    shadowClock += dt;
    if (shadowClock > 0.25 && sun.position.distanceTo(lastSun) > 2) {
      renderer.shadowMap.needsUpdate = true;
      lastSun.copy(sun.position);
      shadowClock = 0;
    }

    renderer.render(scene, camera);
    placeLabels(view);
  }

  function updateSky(view) {
    const elev = view.sunElev;                  // 0..1, 0 at horizon or below
    const up = view.sunUp;                      // -1..1 smooth across horizon
    const az = view.sunAz;                      // 0 at sunrise (east) .. PI at sunset (west)
    const maxEl = view.season === 'winter' ? 0.62 : view.season === 'spring' ? 0.95 : 1.15;
    const el = Math.max(0.03, elev * maxEl);
    tmpV.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el) * 0.85 + 0.25).normalize();
    sun.position.copy(tmpV).multiplyScalar(700);
    sun.target.position.set(0, 0, 0);

    const day = smoothstep(-0.12, 0.25, up);
    const golden = (1 - smoothstep(0.05, 0.35, Math.abs(up))) * day;
    const eclipse = view.eclipse || 0;
    const cloud = view.cloud || 0;
    const storm = clamp((view.rain || 0) + (view.snow || 0) * 0.6, 0, 1);

    const dayCol = new THREE.Color('#9cc9ee').lerp(new THREE.Color('#9aa6b2'), Math.max(cloud * 0.6, storm * 0.8));
    const night = new THREE.Color('#0d1630');
    const c = night.clone().lerp(dayCol, day * (1 - 0.75 * eclipse));
    c.lerp(new THREE.Color('#f2a35c'), golden * 0.45 * (1 - cloud));
    if (view.heat) c.lerp(new THREE.Color('#e9d7a8'), 0.25 * day);
    scene.background.copy(c);
    scene.fog.color.copy(c);
    scene.fog.near = lerp(650, 260, storm);
    scene.fog.far = lerp(1700, 900, storm);

    const sunI = 2.5 * day * (1 - 0.92 * eclipse) * (1 - 0.55 * cloud) * (1 - 0.5 * storm);
    sun.intensity = sunI;
    sun.color.set('#fff3dc').lerp(new THREE.Color('#ffb070'), golden);
    hemi.intensity = 0.35 + 0.95 * day * (1 - 0.7 * eclipse);
    hemi.color.set('#dceeff').lerp(new THREE.Color('#33476e'), 1 - day);
    moon.intensity = 0.55 * (1 - day);
    water.material.color.set('#3f7fae').lerp(new THREE.Color('#14243d'), 1 - day);
    renderer.toneMappingExposure = 1.05 + 0.25 * (1 - day);
  }

  function updateSnow(target) {
    if (Math.abs(target - snowNow) < 0.002) return;
    snowNow += (target - snowNow) * 0.08;
    if (Math.abs(target - snowNow) < 0.01) snowNow = target;
    for (let i = 0; i < nV * 3; i++) tCol[i] = lerp(baseCol[i], snowCol[i], snowNow);
    tGeo.attributes.color.needsUpdate = true;
    renderer.shadowMap.needsUpdate = true;
  }

  function updateGlow(view) {
    // Battery container status lights: green charging, amber discharging.
    const s = view.out ? view.out.storage : 0;
    if (s > 0.05) glowMat.color.set('#ffb347');
    else if (s < -0.05) glowMat.color.set('#7cf29a');
    else glowMat.color.set('#5f7a8a');
  }

  /* ----- Labels ----- */
  function placeLabels(view) {
    if (!labelLayer) return;
    const show = view.labels !== false;
    labelLayer.style.display = show ? '' : 'none';
    if (!show) return;
    const rect = renderer.domElement.getBoundingClientRect();
    for (const id in labels) {
      const L = labels[id];
      const text = view.labelText ? view.labelText[id] || '' : '';
      if (text !== L.text) { L.sub.textContent = text; L.text = text; }
      tmpV.copy(FAC[id].anchor).project(camera);
      const dist = camera.position.distanceTo(FAC[id].anchor);
      const visible = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 && dist < 780;
      if (!visible) { L.el.style.display = 'none'; continue; }
      L.el.style.display = '';
      const x = (tmpV.x * 0.5 + 0.5) * rect.width + rect.left;
      const y = (-tmpV.y * 0.5 + 0.5) * rect.height + rect.top;
      L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      L.el.style.opacity = String(clamp(1.25 - dist / 700, 0.35, 1));
      L.el.dataset.selected = String(id === selected);
    }
  }

  /* ----- Lines: wire colours and states ----- */
  function updateLines(view) {
    const vm = !!view.voltageMode;
    const dayish = view.sunUp > 0;
    for (const L of allLines) {
      const st = lineState(L, view);
      let col;
      if (st === 'overload') col = (Math.sin(time * 10) > 0) ? '#ff3b30' : '#ff8a80';
      else if (st === 'tripped') col = '#a33';
      else if (vm) col = VCLASS[L.cls].color;
      else col = dayish ? '#2c2c2c' : '#5b6170';
      if (L.colNow !== col) { L.wire.material.color.set(col); L.colNow = col; }
      L.wire.material.opacity = st === 'dead' ? 0.35 : 1;
    }
  }

  function lineState(L, view) {
    if (view.lineState && view.lineState[L.id]) return view.lineState[L.id];
    if (view.energized && !view.energized.has(L.energizedBy || L.id)) return 'dead';
    return 'on';
  }

  /* ======================================================================
   * Builders
   * =================================================================== */

  function coolingTower(parts, x, z, h, rb) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const r = rb * (1 - 0.42 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 0.06 * t);
      pts.push(new THREE.Vector2(r, t * h));
    }
    const g = new THREE.LatheGeometry(pts, 28);
    parts.add(g, '#d9d5cc', x, groundY, z);
    parts.cyl('#b8b3a8', x, groundY, z, rb * 1.02, 1.2, 28);
    return [x, groundY + h, z];
  }

  function gsu(parts, x, z, ry = 0) {
    parts.box('#5f6c66', x, groundY, z, 4, 4, 5, ry);
    for (let i = -1; i <= 1; i++) parts.box('#6f7c76', x + i * 1.4, groundY + 0.6, z + 2.9, 0.7, 3, 0.8, ry);
    for (let i = -1; i <= 1; i++) parts.cyl('#c8c2b0', x + i * 1.2, groundY + 4, z - 0.8, 0.25, 2.2, 6);
  }

  function gantry(parts, x, z, w = 14, h = 12, along = 'x') {
    const c = '#9aa0a6';
    if (along === 'x') {
      parts.box(c, x - w / 2, groundY, z, 0.6, h, 0.6);
      parts.box(c, x + w / 2, groundY, z, 0.6, h, 0.6);
      parts.box(c, x, groundY + h - 0.6, z, w, 0.6, 0.6);
    } else {
      parts.box(c, x, groundY, z - w / 2, 0.6, h, 0.6);
      parts.box(c, x, groundY, z + w / 2, 0.6, h, 0.6);
      parts.box(c, x, groundY + h - 0.6, z, 0.6, 0.6, w);
    }
  }

  function yard(parts, x, z, w, d) {
    parts.box('#aaa49a', x, groundY - 0.2, z, w, 0.45, d);
    // fence
    const f = '#7d7f80';
    parts.box(f, x, groundY, z - d / 2, w, 1.4, 0.15);
    parts.box(f, x, groundY, z + d / 2, w, 1.4, 0.15);
    parts.box(f, x - w / 2, groundY, z, 0.15, 1.4, d);
    parts.box(f, x + w / 2, groundY, z, 0.15, 1.4, d);
  }

  function buildNuclear(p) {
    plumeSources.push({ group: 'nuclear', at: coolingTower(p, -226, -74, 36, 13), kind: 'steam', scale: 1.6 });
    plumeSources.push({ group: 'nuclear', at: coolingTower(p, -200, -80, 36, 13), kind: 'steam', scale: 1.6 });
    for (const cx of [-184, -164]) {
      p.cyl('#e7e2d8', cx, groundY, -50, 7.5, 16, 24);
      p.dome('#e7e2d8', cx, groundY + 16, -50, 7.5);
      p.cyl('#b9b2a6', cx, groundY + 5, -50, 7.6, 1, 24);
    }
    p.box('#b6bec6', -174, groundY, -34, 30, 11, 12);
    p.box('#9ea7b0', -174, groundY + 11, -34, 30, 1.4, 12);
    p.box('#cfc9be', -198, groundY, -38, 14, 8, 12);
    p.box('#cfc9be', -205, groundY, -56, 10, 6, 8);
    p.box('#8d8d86', -230, groundY - 0.5, -20, 10, 3, 6);         // intake on the lake
    p.pipe('#8a8a8a', [-226, groundY + 1, -26], [-198, groundY + 1, -40], 0.8);
    yard(p, -150, -40, 22, 18);
    gsu(p, -156, -44);
    gsu(p, -148, -44);
    gantry(p, -150, -34, 16, 13);
  }

  function buildCoal(p) {
    p.box('#9b9283', -112, groundY, -64, 18, 30, 16);
    p.box('#857d70', -112, groundY + 30, -64, 12, 4, 10);
    p.box('#a8aeb4', -92, groundY, -58, 26, 12, 14);
    p.box('#8b8f93', -128, groundY, -52, 12, 12, 10);
    p.box('#8b8f93', -128, groundY, -40, 12, 10, 8);
    p.taper('#c9c4bb', -134, groundY, -72, 3.4, 2.3, 72, 14);
    p.cyl('#c0392b', -134, groundY + 62, -72, 2.42, 3, 14);
    p.cyl('#ecf0f1', -134, groundY + 65, -72, 2.38, 3, 14);
    p.cyl('#c0392b', -134, groundY + 68, -72, 2.34, 3, 14);
    plumeSources.push({ group: 'coal', at: [-134, groundY + 72, -72], kind: 'smoke', scale: 1.1 });
    plumeSources.push({ group: 'coal', at: coolingTower(p, -82, -86, 26, 10), kind: 'steam', scale: 1.2 });
    for (const [x, z, r] of [[-142, -40, 8], [-130, -36, 6], [-146, -54, 6]]) {
      p.add(new THREE.ConeGeometry(r, r * 0.55, 9), '#2a2a2a', x, groundY + r * 0.27, z);
    }
    p.pipe('#6b6b6b', [-138, groundY + 2, -44], [-118, groundY + 22, -60], 0.8);
    yard(p, -74, -42, 18, 14);
    gsu(p, -78, -44);
    gsu(p, -70, -44);
  }

  function buildGasCC(p) {
    for (const z of [-96, -78]) {
      p.box('#b7bcc2', -22, groundY, z, 14, 8, 7);          // gas turbine enclosure
      p.box('#a0a7ae', -22, groundY + 8, z, 5, 3, 4);        // inlet filter house
      p.box('#9ea5ac', -4, groundY, z, 18, 14, 8);           // HRSG
      p.cyl('#c5c9cd', 8, groundY, z, 2.2, 30, 14);          // stack
      plumeSources.push({ group: 'gascc', at: [8, groundY + 30, z], kind: 'exhaust', scale: 0.7 });
    }
    p.box('#b2b8be', -22, groundY, -62, 18, 12, 10);         // steam turbine hall
    p.box('#8e969e', 18, groundY + 8, -70, 22, 7, 18);       // air-cooled condenser
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) p.cyl('#3d4349', 11 + i * 7, groundY + 15, -76 + j * 12, 2.6, 0.5, 14);
    for (const [x, z] of [[9, -63], [27, -63], [9, -77], [27, -77]]) p.box('#7c848b', x, groundY, z, 0.8, 8, 0.8);
    p.pipe('#c0a050', [-40, groundY + 1, -350], [-40, groundY + 1, -110], 0.9);
    p.box('#d0b060', -40, groundY, -108, 4, 3, 4);
    yard(p, 26, -54, 16, 12);
    gsu(p, 22, -56);
    gsu(p, 30, -56);
  }

  function buildPeaker(p) {
    for (const [i, x] of [58, 70, 82].entries()) {
      p.box('#c0c4c8', x, groundY, -50, 8, 5, 4.5);
      p.box('#aab0b6', x - 2, groundY + 5, -50, 3, 2, 3);
      p.cyl('#b4b9be', x + 3, groundY, -50, 1.6, 12, 12);
      plumeSources.push({ group: 'peaker', at: [x + 3, groundY + 12, -50], kind: 'exhaust', scale: 0.55, unit: i });
    }
    p.cyl('#d8d7cf', 90, groundY, -34, 5, 6, 18);            // backup fuel oil tank
    yard(p, 66, -32, 14, 9);
    gsu(p, 66, -34);
  }

  function buildHydro(p) {
    // A stepped gravity dam across the gorge at z = -174: thick at the base,
    // narrow at the crest, holding the reservoir behind it.
    p.box('#c9c4b9', -218, -1, -170, 76, 9, 17);
    p.box('#cfcabf', -218, 8, -172, 76, 9, 12);
    p.box('#d5d0c5', -218, 17, -174, 76, 8, 7);
    for (let i = -3; i <= 3; i++) p.box('#a9a49a', -218 + i * 9, 25, -174, 3, 2.5, 7.5);
    p.box('#bdb6a8', -218, 0, -161, 32, 9, 10);             // powerhouse at the toe
    for (let i = -1.5; i <= 1.5; i++) p.pipe('#7b7f82', [-218 + i * 7, 18, -171], [-218 + i * 7, 6, -164], 1.1);
    yard(p, -188, -150, 20, 14);
    gsu(p, -192, -152);
    gsu(p, -184, -152);
    plumeSources.push({ group: 'hydro', at: [-218, 1.2, -155], kind: 'spray', scale: 1.0 });
  }

  function buildGeothermal(p) {
    const y = 6;
    p.box('#c4b59a', -100, y, -138, 16, 9, 10);
    p.box('#9c958a', -82, y, -136, 16, 7, 7);
    for (let i = 0; i < 3; i++) p.cyl('#5c5f62', -88 + i * 6, y + 7, -136, 2.2, 1.6, 12);
    for (const [x, z] of [[-118, -146], [-112, -126], [-74, -124]]) {
      p.box('#8f8a80', x, y, z, 4, 2, 4);
      p.cyl('#9b9b95', x, y + 2, z, 0.6, 2.5, 8);
    }
    p.pipe('#b9b6ad', [-118, y + 2.5, -146], [-104, y + 2.5, -142], 0.6);
    p.pipe('#b9b6ad', [-112, y + 2.5, -126], [-104, y + 2.5, -134], 0.6);
    p.pipe('#b9b6ad', [-74, y + 2.5, -124], [-94, y + 2.5, -134], 0.6);
    for (let i = 0; i < 3; i++) plumeSources.push({ group: 'other', at: [-88 + i * 6, y + 9, -136], kind: 'steam', scale: 0.7 });
    plumeSources.push({ group: 'other', at: [-118, y + 4.5, -146], kind: 'steam', scale: 0.4 });
  }

  function buildHub(p) {
    yard(p, -20, 40, 56, 40);
    for (const [x, z] of [[-34, 34], [-24, 34], [-14, 34], [-34, 48], [-24, 48]]) {
      p.box('#5c6863', x, groundY, z, 5, 5, 6);
      p.box('#6d7973', x + 3, groundY + 0.6, z, 1, 3.6, 5);
      for (let i = -1; i <= 1; i++) p.cyl('#cfc8b4', x + i * 1.4, groundY + 5, z - 1, 0.3, 3, 6);
    }
    for (let i = 0; i < 5; i++) gantry(p, -40 + i * 10, 26, 8, 14, 'z');
    for (let i = 0; i < 4; i++) p.box('#8b9196', -4 + i * 4, groundY, 52, 1.6, 3, 1.6);
    p.pipe('#b7bcc0', [-44, groundY + 13, 22], [4, groundY + 13, 22], 0.25);
    p.pipe('#b7bcc0', [-44, groundY + 13, 30], [4, groundY + 13, 30], 0.25);
    p.box('#d3cec4', 0, groundY, 30, 8, 4, 6);               // control house
  }

  function buildControl(p) {
    p.box('#d6d2c8', 100, groundY, 72, 24, 10, 14);
    p.box('#6f9fc2', 100, groundY + 4, 64.9, 22, 3, 0.3);
    p.box('#6f9fc2', 100, groundY + 7.5, 64.9, 22, 1.6, 0.3);
    p.box('#c2bdb2', 100, groundY + 10, 72, 10, 3, 8);
    p.add(new THREE.SphereGeometry(3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), '#e8e8e8', 109, groundY + 13, 76, 1, 1, 1, -Math.PI / 2.3, 0.6, 0);
    p.box('#4c4f52', 100, groundY - 0.15, 82, 28, 0.3, 8);
  }

  function buildDistSub(p, x, z) {
    yard(p, x, z, 26, 18);
    p.box('#5c6863', x - 5, groundY, z, 4, 4, 5);
    p.box('#5c6863', x + 4, groundY, z, 4, 4, 5);
    gantry(p, x, z - 6, 18, 9);
    for (let i = 0; i < 4; i++) p.box('#8b9196', x - 9 + i * 6, groundY, z + 6, 1.4, 2.6, 1.4);
  }

  function buildFactory(p) {
    p.box('#9aa3ab', 170, groundY, 122, 40, 9, 24);
    for (let i = 0; i < 5; i++) p.add(new THREE.CylinderGeometry(0, 4.2, 24, 3, 1), '#7f8a93', 154 + i * 8, groundY + 11, 122, 1, 1, 1, Math.PI / 2, 0, 0);
    p.cyl('#a59e94', 192, groundY, 112, 1.8, 22, 12);
    p.box('#6b737a', 150, groundY, 108, 8, 5, 6);
    p.box('#4c4f52', 170, groundY - 0.15, 136, 44, 0.3, 6);
    plumeSources.push({ group: 'factory', at: [192, groundY + 22, 112], kind: 'steam', scale: 0.5 });
  }

  function buildDataCenter(p) {
    p.box('#d9dde1', 220, groundY, 178, 46, 9, 30);
    p.box('#c3c9ce', 220, groundY + 9, 178, 46, 0.6, 30);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
      p.cyl('#4a5057', 202 + i * 7, groundY + 9.6, 170 + j * 14, 2.2, 1.4, 12);
    }
    for (let i = 0; i < 8; i++) {
      p.box('#3f4a52', 200 + i * 5.4, groundY, 196, 4, 3, 3);
      p.cyl('#2f363c', 201.5 + i * 5.4, groundY + 3, 196, 0.35, 2, 6);
    }
    yard(p, 194, 158, 16, 12);
    p.box('#5c6863', 191, groundY, 158, 4, 4, 5);
    p.box('#5c6863', 198, groundY, 158, 4, 4, 5);
    for (let i = 0; i < 8; i++) plumeSources.push({ group: 'dcBackup', at: [201.5 + i * 5.4, groundY + 5, 196], kind: 'smoke', scale: 0.35 });
  }

  function buildConverters(p) {
    for (const [x, flip] of [[254, 1], [314, -1]]) {
      yard(p, x, 50, 30, 28);
      p.box('#c9ced3', x, groundY, 54, 16, 12, 12);          // valve hall
      p.box('#b3b9bf', x, groundY + 12, 54, 16, 1, 12);
      for (let i = -1; i <= 1; i++) p.box('#5c6863', x - 6 * flip + i * 4.2, groundY, 42, 3.6, 4, 4);
      for (let i = 0; i < 6; i++) p.cyl('#cfd2d4', x - 10 + i * 4, groundY, 40, 0.5, 6, 6);  // AC filters
      p.cyl('#6c7378', x + 9 * flip, groundY, 56, 2, 4, 14);  // smoothing reactor
    }
  }

  function buildNeighbor(p) {
    // A gas plant and wind turbines on the other interconnection.
    p.box('#b7bcc2', 390, groundY, -40, 14, 8, 7);
    p.box('#9ea5ac', 404, groundY, -40, 12, 12, 8);
    p.cyl('#c5c9cd', 412, groundY, -40, 2, 24, 12);
    plumeSources.push({ group: 'neighborGen', at: [412, groundY + 24, -40], kind: 'exhaust', scale: 0.6 });
  }

  function buildBatteryYard(p, glow) {
    yard(p, 150, 46, 50, 28);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
      const x = 132 + c * 7, z = 38 + r * 8;
      p.box('#e9ebee', x, groundY, z, 6, 2.8, 3);
      p.box('#5d666d', x, groundY + 2.8, z, 2.2, 0.8, 1.6);
      glow.box('#ffffff', x + 2.6, groundY + 1.6, z + 1.52, 0.5, 0.5, 0.05);
    }
    p.box('#5c6863', 172, groundY, 56, 4, 4, 5);
  }

  function buildSolarBase(p) {
    for (let i = 0; i < 10; i++) {
      const x = 152 + i * 10;
      for (const z of [-66, -36]) {
        for (let k = -2; k <= 2; k++) p.box('#7a7f84', x, groundY, z + k * 5, 0.25, 1.6, 0.25);
      }
    }
    for (let i = 0; i < 3; i++) p.box('#c9ced3', 160 + i * 34, groundY, -50, 3, 2.4, 2);
    yard(p, 150, -14, 12, 9);
    p.box('#5c6863', 150, groundY, -14, 3.5, 3.5, 4);
  }

  function buildTrain(p) {
    // Coal hoppers on the plant's unloading siding.
    for (let i = 0; i < 9; i++) {
      const x = -146 + i * 7.2;
      p.box('#2e2e2e', x, groundY + 0.6, -29, 6.4, 3, 3);
      p.box('#151515', x, groundY + 3.6, -29, 6.0, 0.4, 2.6);
    }
    p.box('#b5452e', -78, groundY + 0.6, -29, 7, 4, 3.2);
  }

  function buildTown(p) {
    // Houses along three streets, each with a window pair facing the street.
    const spots = [];
    for (const zStreet of [150, 180, 205]) {
      for (let x = -205; x <= -100; x += 13) {
        if (zStreet === 150 && x > -110) continue;
        spots.push([x, zStreet - 8, 0]);
        if (zStreet !== 205) spots.push([x + 6, zStreet + 8, Math.PI]);
      }
    }
    const n = spots.length;
    const body = new THREE.InstancedMesh(BOX, new THREE.MeshLambertMaterial({ flatShading: true }), n);
    const roofGeo = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-1, 0), new THREE.Vector2(1, 0), new THREE.Vector2(0, 1)]), { depth: 1, bevelEnabled: false });
    roofGeo.translate(0, 0, -0.5);
    const roof = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ flatShading: true }), n);
    const winGeo = new THREE.PlaneGeometry(1, 1);
    const win = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial(), n * 2);
    const ac = new THREE.InstancedMesh(BOX, new THREE.MeshLambertMaterial({ color: '#c9ccce' }), n);
    const siding = ['#e8dcc8', '#c9d6df', '#d7c2a8', '#e6e2d6', '#b9c7b0', '#d9b9a3', '#f0ead8'];
    const roofs = ['#7b3b32', '#5a4c40', '#6b6b6b', '#4e5a63'];
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3();
    spots.forEach(([x, z, ry], i) => {
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      body.setMatrixAt(i, M.compose(T.set(x, groundY + 2.2, z), Q, S.set(7, 4.4, 6.5)));
      body.setColorAt(i, _c.set(siding[i % siding.length]));
      roof.setMatrixAt(i, M.compose(T.set(x, groundY + 4.4, z), Q, S.set(3.9, 2.8, 7.0)));
      roof.setColorAt(i, _c.set(roofs[(i * 7) % roofs.length]));
      const face = ry === 0 ? 3.3 : -3.3;
      for (let k = 0; k < 2; k++) {
        win.setMatrixAt(i * 2 + k, M.compose(T.set(x - 1.8 + k * 3.6, groundY + 2.4, z + face), Q, S.set(1.6, 1.4, 1)));
      }
      ac.setMatrixAt(i, M.compose(T.set(x + 4.4, groundY + 0.7, z), Q, S.set(1.2, 1.4, 1.2)));
    });
    for (const m of [body, roof, ac]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
    scene.add(win);
    const lit = new THREE.Color('#ffcf73'), off = new THREE.Color('#1f2731'), dayGlass = new THREE.Color('#566676');
    const state = new Array(n).fill(-1);
    return {
      spots,
      update(view) {
        const night = 1 - smoothstep(-0.05, 0.2, view.sunUp);
        const shed = view.shed || 0;
        const phase = Math.floor((view.hour || 0) * 2);
        for (let i = 0; i < n; i++) {
          const powered = houseEnergized(view, i, n) && !(shed > 0 && hash(i * 7.13 + phase * 3.7) < shed);
          const s = powered ? (night > 0.5 ? 2 : 1) : 0;
          if (s === state[i]) continue;
          state[i] = s;
          const col = s === 2 ? lit : s === 1 ? dayGlass : (night > 0.5 ? off : dayGlass);
          win.setColorAt(i * 2, col);
          win.setColorAt(i * 2 + 1, col);
        }
        if (win.instanceColor) win.instanceColor.needsUpdate = true;
      },
    };
  }

  function houseEnergized(view, i, n) {
    if (!view.energized) return !view.blackout;
    // During restoration, a share of the town comes back with each feeder.
    const frac = view.townRestored || 0;
    return view.energized.has('subA') && i / n < frac;
  }

  function buildNeighborTown(p) {
    const spots = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) spots.push([370 + c * 12 + (r % 2) * 5, 132 + r * 16]);
    const n = spots.length;
    const body = new THREE.InstancedMesh(BOX, new THREE.MeshLambertMaterial({ flatShading: true }), n);
    const win = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), n);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3();
    spots.forEach(([x, z], i) => {
      body.setMatrixAt(i, M.compose(T.set(x, groundY + 2.2, z), Q, S.set(7, 4.4, 6.5)));
      body.setColorAt(i, _c.set(['#e3d2b8', '#d4c7b0', '#cbbfa8'][i % 3]));
      win.setMatrixAt(i, M.compose(T.set(x, groundY + 2.4, z + 3.3), Q, S.set(3, 1.4, 1)));
    });
    body.castShadow = true;
    scene.add(body, win);
    let last = -1;
    return {
      update(view) {
        const night = 1 - smoothstep(-0.05, 0.2, view.sunUp);
        const s = night > 0.5 ? 1 : 0;
        if (s === last) return;
        last = s;
        for (let i = 0; i < n; i++) win.setColorAt(i, _c.set(s ? '#ffcf73' : '#566676'));
        win.instanceColor.needsUpdate = true;
      },
    };
  }

  function buildTrees() {
    const foliage = new THREE.ConeGeometry(2.4, 6, 7);
    foliage.translate(0, 5, 0);
    const trunk = new THREE.CylinderGeometry(0.4, 0.5, 2.2, 6);
    trunk.translate(0, 1.1, 0);
    const parts = new Parts();
    parts.add(foliage, '#3f6e36', 0, 0, 0);
    parts.add(trunk, '#6b4f36', 0, 0, 0);
    const geo = mergeGeometries(parts.list, false);
    const spots = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const blocked = (x, z) => PADS.some(([px, pz, pw, pd]) => Math.abs(x - px) < pw / 2 + 6 && Math.abs(z - pz) < pd / 2 + 6);
    let tries = 0;
    while (spots.length < 300 && tries++ < 6000) {
      const x = (rnd() - 0.5) * (W - 60), z = (rnd() - 0.5) * (D - 60);
      const h = heightAt(x, z);
      if (h < 1.2 || h > 26 || blocked(x, z)) continue;
      if (Math.abs(x - BORDER_X) < 14) continue;
      spots.push([x, h - 0.2, z, 0.7 + rnd() * 0.7, rnd() * 6.28]);
    }
    const mesh = new THREE.InstancedMesh(geo, matStatic, spots.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3(), E = new THREE.Euler();
    function place(lean, t) {
      spots.forEach(([x, y, z, s, r], i) => {
        const sway = lean > 0 ? lean * (0.8 + 0.2 * Math.sin(t * 2.3 + r * 3)) : 0;
        E.set(0, r, 0);
        Q.setFromEuler(E);
        if (sway > 0) Q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sway));
        mesh.setMatrixAt(i, M.compose(T.set(x, y, z), Q, S.set(s, s, s)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    place(0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    let lastLean = 0;
    return {
      mesh,
      update(t, view) {
        const lean = (view.rain || 0) > 0.5 ? 0.35 * (view.rain || 0) : 0;
        if (lean > 0 || lastLean > 0) { place(lean, t); lastLean = lean; }
      },
    };
  }

  function buildCity() {
    // Window texture: a grid of windows. The map is the daytime facade; the
    // emissive map lights a random subset at night.
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#9aa7b3'; g.fillRect(0, 0, 64, 64);
    const ce = document.createElement('canvas');
    ce.width = 64; ce.height = 64;
    const ge = ce.getContext('2d');
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 64, 64);
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = '#4d6072';
      g.fillRect(x * 8 + 1.5, y * 8 + 2, 5, 4.5);
      if (rnd() < 0.62) { ge.fillStyle = rnd() < 0.8 ? '#ffd88a' : '#cfe6ff'; ge.fillRect(x * 8 + 1.5, y * 8 + 2, 5, 4.5); }
    }
    const map = new THREE.CanvasTexture(cv), emap = new THREE.CanvasTexture(ce);
    for (const t of [map, emap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; }
    const geos = [];
    const blocks = [
      [52, 160, 14, 46], [72, 158, 12, 34], [92, 162, 16, 58], [114, 160, 12, 40], [134, 164, 12, 24],
      [50, 184, 12, 26], [70, 186, 14, 52], [94, 188, 12, 36], [116, 186, 16, 62], [138, 188, 10, 30],
      [58, 208, 14, 20], [82, 208, 12, 28], [104, 210, 14, 22], [128, 208, 12, 18],
    ];
    for (const [x, z, w, h] of blocks) {
      const b = new THREE.BoxGeometry(w, h, w);
      const uv = b.attributes.uv;
      // Scale UVs by face size so every tower gets windows of the same size.
      for (let i = 0; i < uv.count; i++) {
        const face = Math.floor(i / 4);
        const isTop = face === 2 || face === 3;
        uv.setXY(i, uv.getX(i) * (isTop ? 0.01 : w / 8), uv.getY(i) * (isTop ? 0.01 : h / 8));
      }
      b.translate(x, groundY + h / 2, z);
      geos.push(b);
    }
    const mat = new THREE.MeshLambertMaterial({ map, emissiveMap: emap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 });
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return {
      mesh,
      update(view) {
        const night = 1 - smoothstep(-0.05, 0.25, view.sunUp);
        const powered = view.energized ? view.energized.has('subB') : !view.blackout;
        mat.emissiveIntensity = powered ? night * 1.1 * (1 - 0.6 * (view.shed || 0)) : 0;
      },
    };
  }

  /* ----- Lines, towers, conductors ----- */
  function towerGeom(parts, cls, x, z, heading) {
    const y = Math.max(1.2, heightAt(x, z));
    const c = '#8f969c';
    const cos = Math.cos(heading), sin = Math.sin(heading);
    // local (u across the line, v along it) -> world
    const at = (u, v) => [x + u * cos - v * sin, z + u * sin + v * cos];
    const put = (u, yy, v, w, h, d) => { const [wx, wz] = at(u, v); parts.box(c, wx, y + yy, wz, w, h, d, -heading); };
    if (cls === 500) {
      const H = 30;
      for (const [u, v] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
        const [bx, bz] = at(u, v), [tx, tz] = at(u * 0.35, v * 0.35);
        parts.pipe(c, [bx, y, bz], [tx, y + H - 4, tz], 0.22, 4);
      }
      for (const yy of [6, 13, 20]) {
        const k = 1 - yy / (H - 4) * 0.65;
        put(0, yy, -2.2 * k, 4.4 * k, 0.25, 0.25);
        put(0, yy, 2.2 * k, 4.4 * k, 0.25, 0.25);
        put(-2.2 * k, yy, 0, 0.25, 0.25, 4.4 * k);
        put(2.2 * k, yy, 0, 0.25, 0.25, 4.4 * k);
      }
      put(0, H - 4, 0, 20, 0.6, 1.2);
      put(-6, H - 4, 0, 0.4, 4, 0.4);
      put(6, H - 4, 0, 0.4, 4, 0.4);
      return { y, phases: [[-9, H - 5], [0, H - 5], [9, H - 5]] };
    }
    if (cls === 138) {
      const H = 19;
      parts.taper('#9aa0a5', x, y, z, 0.7, 0.4, H, 8);
      put(-2.2, H - 2, 0, 4.4, 0.3, 0.3);
      put(2.2, H - 5, 0, 4.4, 0.3, 0.3);
      put(-2.2, H - 8, 0, 4.4, 0.3, 0.3);
      return { y, phases: [[-4.2, H - 2.5], [4.2, H - 5.5], [-4.2, H - 8.5]] };
    }
    if (cls === 'dc') {
      const H = 24;
      for (const u of [-1.8, 1.8]) {
        const [bx, bz] = at(u, 0);
        parts.pipe(c, [bx, y, bz], [x, y + H - 3, z], 0.3, 4);
      }
      put(0, H - 3, 0, 14, 0.6, 1);
      return { y, phases: [[-6, H - 4], [6, H - 4]] };
    }
    // Distribution: a wood pole with a crossarm.
    const H = 10;
    parts.cyl('#6e5a44', x, y, z, 0.28, H, 6);
    put(0, H - 1, 0, 3.6, 0.3, 0.3);
    return { y, phases: [[-1.6, H - 0.7], [0, H - 0.2], [1.6, H - 0.7]] };
  }

  function catenary(a, b, sag, out) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      out.push(lerp(a.x, b.x, t0), lerp(a.y, b.y, t0) - sag * 4 * t0 * (1 - t0), lerp(a.z, b.z, t0));
      out.push(lerp(a.x, b.x, t1), lerp(a.y, b.y, t1) - sag * 4 * t1 * (1 - t1), lerp(a.z, b.z, t1));
    }
  }

  function makeLine(parts, def) {
    const pts = def.pts;
    const segs = [];
    const path = [];
    let prevAttach = null;
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const [nx, nz] = pts[Math.min(i + 1, pts.length - 1)];
      const [px, pz] = pts[Math.max(i - 1, 0)];
      const heading = Math.atan2(nz - pz, nx - px) - Math.PI / 2;
      const tw = towerGeom(parts, def.cls, x, z, heading);
      const cos = Math.cos(heading), sin = Math.sin(heading);
      const attach = tw.phases.map(([u, yy]) => new THREE.Vector3(x + u * cos, tw.y + yy, z + u * sin));
      if (prevAttach) {
        const span = Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
        const sag = def.cls === 12 ? 0.5 : span * 0.035;
        for (let k = 0; k < attach.length; k++) catenary(prevAttach[k], attach[k], sag, segs);
        const mid = Math.floor(attach.length / 2);
        const a = prevAttach[mid], b = attach[mid];
        for (let s = 0; s <= 8; s++) {
          const t = s / 8;
          if (s === 0 && path.length) continue;
          path.push(new THREE.Vector3(lerp(a.x, b.x, t), lerp(a.y, b.y, t) - sag * 4 * t * (1 - t) - 0.3, lerp(a.z, b.z, t)));
        }
      }
      prevAttach = attach;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    const wire = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#2c2c2c', transparent: true }));
    scene.add(wire);
    let len = 0;
    const cum = [0];
    for (let i = 1; i < path.length; i++) { len += path[i].distanceTo(path[i - 1]); cum.push(len); }
    return Object.assign({}, def, { wire, path, cum, len });
  }

  function buildLines(parts) {
    return LINES.map((d) => makeLine(parts, d));
  }

  function buildDistribution(parts, houses) {
    // Feeders from the distribution substation run down each street; every
    // few poles a can transformer steps 7.2 kV down to 120/240 V for the
    // houses on either side.
    const out = [];
    const feeders = [
      { id: 'fdr1', z: 150, x0: -98, x1: -208 },
      { id: 'fdr2', z: 180, x0: -94, x1: -208 },
      { id: 'fdr3', z: 205, x0: -94, x1: -208 },
    ];
    feeders.forEach((f, fi) => {
      const pts = [[-96, 132]];
      if (fi > 0) pts.push([-92, f.z - 4]);
      for (let x = f.x0; x >= f.x1; x -= 14) pts.push([x, f.z - 3.2]);
      const line = makeLine(parts, { id: f.id, cls: 12, flow: 'townFeeder', pts, energizedBy: 'subA' });
      out.push(line);
      // Can transformers on every third pole.
      for (let i = 2; i < pts.length; i += 3) {
        const [x, z] = pts[i];
        const y = Math.max(1.2, heightAt(x, z));
        parts.cyl('#7d858b', x + 0.9, y + 6.4, z, 0.65, 1.6, 10);
      }
    });
    // Service drops: a few short spans from poles to houses (120/240 V).
    const drops = [];
    houses.spots.forEach(([x, z], i) => {
      if (i % 3 !== 0) return;
      const street = [150, 180, 205].reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
      const px = Math.round((x + 96) / 14) * 14 - 96;
      drops.push({ id: 'svc' + i, cls: 0, flow: 'service', pts: [[px, street - 3.2], [x, z]], energizedBy: 'subA', house: i });
    });
    for (const d of drops) {
      const a = d.pts[0], b = d.pts[1];
      const ya = Math.max(1.2, heightAt(a[0], a[1])) + 8.8, yb = groundY + 3.6;
      const segs = [];
      catenary(new THREE.Vector3(a[0], ya, a[1]), new THREE.Vector3(b[0], yb, b[1]), 0.6, segs);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      const wire = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#2c2c2c', transparent: true }));
      scene.add(wire);
      const path = [new THREE.Vector3(a[0], ya, a[1]), new THREE.Vector3((a[0] + b[0]) / 2, (ya + yb) / 2 - 0.6, (a[1] + b[1]) / 2), new THREE.Vector3(b[0], yb, b[1])];
      const cum = [0, path[1].distanceTo(path[0])];
      cum.push(cum[1] + path[2].distanceTo(path[1]));
      out.push(Object.assign({}, d, { wire, path, cum, len: cum[2] }));
    }
    return out;
  }

  /* ----- Wind farm ----- */
  function buildWindFarm() {
    const spots = [];
    for (let i = 0; i < 12; i++) spots.push([46 + i * 19, -150 + Math.sin(i * 1.7) * 8]);
    const nbr = [[340, -150], [372, -132], [404, -152], [436, -136]];
    const all = spots.concat(nbr);
    const towersP = new Parts();
    const hubs = [];
    for (const [x, z] of all) {
      const y = heightAt(x, z);
      towersP.taper('#f2f2f0', x, y, z, 1.15, 0.6, 36, 10);
      towersP.box('#e9e9e6', x, y + 35.6, z + 1, 2.2, 2.4, 5);
      hubs.push(new THREE.Vector3(x, y + 36.8, z + 3.6));
    }
    const tm = towersP.mesh(matStatic);
    tm.castShadow = true;
    scene.add(tm);
    // Rotor: three blades and a hub in the XY plane, spinning about Z.
    const rp = new Parts();
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3;
      const blade = new THREE.BoxGeometry(1.3, 19, 0.35);
      blade.translate(0, 10, 0);
      rp.add(blade, '#f7f7f5', 0, 0, 0, 1, 1, 1, 0, 0, a);
    }
    rp.sphere('#e3e3e0', 0, 0, 0, 1.3, 1);
    const rotorGeo = mergeGeometries(rp.list, false);
    const rotors = new THREE.InstancedMesh(rotorGeo, matStatic, all.length);
    rotors.castShadow = true;
    scene.add(rotors);
    const angles = all.map((_, i) => i * 0.7);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.25);
    return {
      update(dt, view) {
        // Rotor speed follows the wind up to rated speed; above the cut-out
        // (storms) or when iced, blades feather and stop.
        const cf = view.windCF || 0;
        let rpm = cf > 0.04 ? 6 + 9 * Math.min(1, cf / 0.6) : 0;
        if (view.windCutout) rpm = 0;
        const iced = view.snow > 0.5 ? 0.45 : 0;
        for (let i = 0; i < all.length; i++) {
          const nbrT = i >= spots.length;
          const frozen = !nbrT && iced > 0 && hash(i * 3.1) < iced;
          const r = frozen ? 0 : nbrT ? 9 : rpm;
          angles[i] += r / 60 * Math.PI * 2 * dt;
          Q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angles[i]);
          Q.copy(yawQ).multiply(Q2);
          rotors.setMatrixAt(i, M.compose(hubs[i], Q, S));
        }
        rotors.instanceMatrix.needsUpdate = true;
      },
    };
  }

  /* ----- Solar trackers ----- */
  function buildSolarPanels() {
    const spots = [];
    for (let i = 0; i < 10; i++) for (const z of [-66, -36]) spots.push([152 + i * 10, z]);
    const geo = new THREE.BoxGeometry(5.2, 0.25, 26);
    const mat = new THREE.MeshLambertMaterial({ color: '#203f63', flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), T = new THREE.Vector3();
    let last = 99;
    return {
      update(view) {
        // Single-axis trackers follow the sun east to west; flat at night.
        let tilt = 0;
        if (view.sunUp > 0) tilt = clamp(Math.cos(view.sunAz) * 1.0, -0.95, 0.95);
        if (view.rain > 0.6) tilt = 0;
        if (Math.abs(tilt - last) < 0.003) return;
        last = tilt;
        Q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt);
        spots.forEach(([x, z], i) => mesh.setMatrixAt(i, M.compose(T.set(x, groundY + 1.8, z), Q, S)));
        mesh.instanceMatrix.needsUpdate = true;
      },
    };
  }

  /* ----- Plumes: steam, smoke, exhaust and spray ----- */
  function buildPlumes() {
    const MAX = 520;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.78, depthWrite: false, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const puffs = [];
    const acc = new Array(plumeSources.length).fill(0);
    const KIND = {
      steam: { color: '#f4f6f8', life: 6, rise: 6, grow: 2.6, size: 2.2, rate: 5 },
      smoke: { color: '#8e8c88', life: 7, rise: 5, grow: 2.2, size: 1.6, rate: 4 },
      exhaust: { color: '#dfe3e6', life: 2.5, rise: 7, grow: 1.6, size: 1.0, rate: 5 },
      spray: { color: '#ffffff', life: 1.6, rise: 2.5, grow: 1.3, size: 1.4, rate: 9 },
    };
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3();
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return {
      update(dt, view) {
        const drift = 1.5 + 4 * (view.windCF || 0.3) + (view.rain || 0) * 8;
        plumeSources.forEach((src, i) => {
          const k = KIND[src.kind];
          let level = view.plume ? view.plume[src.group] || 0 : 0;
          if (src.group === 'peaker' && view.peakerUnits !== undefined) level = src.unit < view.peakerUnits ? 1 : 0;
          if (level <= 0.01) return;
          acc[i] += dt * k.rate * level;
          while (acc[i] >= 1 && puffs.length < MAX) {
            acc[i] -= 1;
            puffs.push({ x: src.at[0] + (rnd() - 0.5) * 2, y: src.at[1], z: src.at[2] + (rnd() - 0.5) * 2, age: 0, k, s: src.scale * (0.8 + rnd() * 0.4), c: k.color });
          }
          if (acc[i] > 1) acc[i] = 1;
        });
        let j = 0;
        for (let i = 0; i < puffs.length; i++) {
          const p = puffs[i];
          p.age += dt;
          const t = p.age / p.k.life;
          if (t >= 1) continue;
          p.y += p.k.rise * dt * (1 - 0.5 * t);
          p.x -= drift * dt * 0.8;
          p.z -= drift * dt * 0.3;
          const sz = p.k.size * p.s * (0.6 + p.k.grow * t) * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
          mesh.setMatrixAt(j, M.compose(T.set(p.x, p.y, p.z), Q, S.set(sz, sz * 0.85, sz)));
          mesh.setColorAt(j, _c.set(p.c));
          puffs[j++] = p;
        }
        puffs.length = j;
        mesh.count = j;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      },
    };
  }

  /* ----- Power-flow particles ----- */
  function buildParticles(lines) {
    let total = 0;
    for (const L of lines) {
      L.np = L.cls === 0 ? 2 : clamp(Math.round(L.len / 8), 3, 40);
      L.p0 = total;
      total += L.np;
      L.u = Array.from({ length: L.np }, (_, i) => i / L.np);
    }
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.62, 8, 6), new THREE.MeshBasicMaterial(), total);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const M = new THREE.Matrix4(), T = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
    for (const L of lines) {
      _c.set(VCLASS[L.cls].color);
      for (let i = 0; i < L.np; i++) mesh.setColorAt(L.p0 + i, _c);
    }
    mesh.instanceColor.needsUpdate = true;
    const red = new THREE.Color('#ff3b30');
    return {
      update(dt, view) {
        const show = view.flows !== false;
        for (const L of lines) {
          const st = lineState(L, view);
          const raw = view.lineFlow ? view.lineFlow[L.flow] : 0;
          const f = st === 'dead' || st === 'tripped' ? 0 : raw || 0;
          const dir = f < 0 ? -1 : 1;
          const mag = Math.abs(f);
          const speed = mag > 0.005 ? (st === 'overload' ? 70 : 10 + 34 * Math.min(1.4, mag)) : 0;
          const vis = show && mag > 0.005;
          for (let i = 0; i < L.np; i++) {
            let u = L.u[i] + dir * speed * dt / Math.max(1, L.len);
            u -= Math.floor(u);
            L.u[i] = u;
            if (!vis) { mesh.setMatrixAt(L.p0 + i, M.makeScale(0, 0, 0)); continue; }
            pointOnPath(L, u, T);
            const s = (L.cls === 12 || L.cls === 0 ? 0.38 : 1) * (0.7 + 0.5 * Math.min(1, mag));
            mesh.setMatrixAt(L.p0 + i, M.compose(T, Q, S.set(s, s, s)));
            if (st === 'overload') mesh.setColorAt(L.p0 + i, red);
            else if (L.wasOver) mesh.setColorAt(L.p0 + i, _c.set(VCLASS[L.cls].color));
          }
          L.wasOver = st === 'overload';
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      },
    };
  }

  function pointOnPath(L, u, out) {
    const d = u * L.len;
    let i = 1;
    while (i < L.cum.length - 1 && L.cum[i] < d) i++;
    const a = L.path[i - 1], b = L.path[i];
    const seg = L.cum[i] - L.cum[i - 1] || 1;
    return out.lerpVectors(a, b, (d - L.cum[i - 1]) / seg);
  }

  /* ----- Weather ----- */
  function buildWeather() {
    const N = mobile ? 1500 : 3200;
    const snowGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(N * 3);
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N; i++) { sp[i * 3] = (rnd() - 0.5) * 700; sp[i * 3 + 1] = rnd() * 180; sp[i * 3 + 2] = (rnd() - 0.5) * 560; }
    snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.7, transparent: true, opacity: 0.9, depthWrite: false }));
    snow.frustumCulled = false;
    scene.add(snow);

    const R = mobile ? 900 : 1800;
    const rainPos = new Float32Array(R * 6);
    const rainBase = new Float32Array(R * 3);
    for (let i = 0; i < R; i++) { rainBase[i * 3] = (rnd() - 0.5) * 700; rainBase[i * 3 + 1] = rnd() * 160; rainBase[i * 3 + 2] = (rnd() - 0.5) * 560; }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#c8d6e5', transparent: true, opacity: 0.55 }));
    rain.frustumCulled = false;
    scene.add(rain);

    return {
      update(dt, view, target) {
        const s = view.snow || 0, r = view.rain || 0;
        snow.visible = s > 0.02;
        rain.visible = r > 0.02;
        if (snow.visible) {
          snow.material.opacity = 0.9 * s;
          const a = snowGeo.attributes.position.array;
          for (let i = 0; i < N; i++) {
            a[i * 3 + 1] -= (9 + (i % 7)) * dt;
            a[i * 3] += Math.sin(time + i) * dt * 2 - 3 * dt;
            if (a[i * 3 + 1] < 0) a[i * 3 + 1] += 180;
            if (a[i * 3] < -350) a[i * 3] += 700;
          }
          snow.position.set(target.x, 0, target.z);
          snowGeo.attributes.position.needsUpdate = true;
        }
        if (rain.visible) {
          rain.material.opacity = 0.55 * r;
          for (let i = 0; i < R; i++) {
            rainBase[i * 3 + 1] -= 140 * dt;
            rainBase[i * 3] -= 40 * dt * r;
            if (rainBase[i * 3 + 1] < 0) rainBase[i * 3 + 1] += 160;
            if (rainBase[i * 3] < -350) rainBase[i * 3] += 700;
            const x = rainBase[i * 3], y = rainBase[i * 3 + 1], z = rainBase[i * 3 + 2];
            rainPos.set([x, y, z, x + 1.6 * r, y + 4.5, z], i * 6);
          }
          rain.position.set(target.x, 0, target.z);
          rainGeo.attributes.position.needsUpdate = true;
        }
      },
    };
  }

  function buildClouds() {
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.92, flatShading: true });
    const list = [];
    let seed = 9;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 12; i++) {
      const parts = new Parts();
      const n = 4 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) parts.sphere('#ffffff', (k - n / 2) * 9 + rnd() * 4, rnd() * 4, rnd() * 10, 8 + rnd() * 6, 1);
      const m = parts.mesh(mat);
      m.position.set((rnd() - 0.5) * 900, 120 + rnd() * 40, (rnd() - 0.5) * 600);
      m.castShadow = true;
      m.userData.speed = 3 + rnd() * 4;
      m.userData.rank = rnd();
      group.add(m);
      list.push(m);
    }
    scene.add(group);
    return {
      update(dt, view) {
        const c = clamp(Math.max(view.cloud || 0, (view.rain || 0) * 0.9, (view.snow || 0) * 0.8), 0, 1);
        mat.color.set('#ffffff').lerp(new THREE.Color('#7b8591'), clamp((view.rain || 0) + (view.snow || 0) * 0.5, 0, 1) * 0.8);
        const night = 1 - smoothstep(-0.1, 0.2, view.sunUp);
        mat.color.lerp(new THREE.Color('#3a4258'), night * 0.8);
        for (const m of list) {
          m.visible = m.userData.rank < c * 1.05;
          m.position.x += m.userData.speed * dt * (1 + 3 * (view.rain || 0));
          if (m.position.x > 520) m.position.x -= 1040;
        }
      },
    };
  }

  function buildRing() {
    const mat = new THREE.MeshBasicMaterial({ color: '#2563eb', transparent: true, opacity: 0.7, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    return {
      mat,
      update(t, id) {
        const f = id && FAC[id];
        mesh.visible = !!f;
        if (!f) return;
        const r = f.size * 0.62 * (1 + 0.04 * Math.sin(t * 3));
        mesh.scale.set(r, r, r);
        mesh.position.set(f.center.x, Math.max(groundY, heightAt(f.center.x, f.center.z)) + 0.6, f.center.z);
      },
    };
  }

  /* ----- Public API ----- */
  return {
    frame,
    focus,
    resize,
    setSelected(id) { selected = FAC[id] ? id : null; },
    setOffset(x, y) { offset.tx = x; offset.ty = y; },
    setAccent(c) { ring.mat.color.set(c); },
    autoRotate(on) { controls.autoRotate = on; },
    facilities: FAC,
    views: VIEWS,
    hasView: (id) => !!VIEWS[id],
    camera,
    controls,
    renderer,
  };
}


function hash(x) {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

PG.scene = { heightAt, VCLASS, createScene };
})(window.PowerGrid = window.PowerGrid || {}, window.THREE);
