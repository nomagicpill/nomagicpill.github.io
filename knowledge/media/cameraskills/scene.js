/*
 * knowledge/cameraskills.html: the stage. One WebGL canvas, two modes.
 *
 *   body   the X-T30 III itself (body.js): orbit it, click a control.
 *   world  a virtual viewfinder on the town (world.js). What you see is the
 *          photograph those settings would take: exposure, depth of field,
 *          motion blur, hand shake, noise, white balance and film simulation.
 *
 * How the photograph is made, each frame:
 *   1. the world is rendered in linear light into a float target with depth;
 *   2. a depth-of-field pass blurs each pixel by the lens's blur disc at its
 *      distance (the thin-lens formula from optics.js);
 *   3. steps 1-2 repeat at several instants across the exposure, with the
 *      camera nudged along a hand-shake path, and the results are averaged:
 *      that is motion blur and camera shake;
 *   4. a final pass applies the exposure, white balance, sensor clipping and
 *      noise for the ISO, the tone curve and the film simulation.
 * A small copy of step 1 is read back a few times a second as the light meter,
 * and a small copy of step 4 as the histogram.
 *
 * createStage(THREE, host, labelsHost, callbacks) returns the API at the end.
 * Loaded by main.js after three.js, OrbitControls, body.js and world.js.
 */
(function (CS) {
'use strict';

function createStage(THREE, host, labelsHost, cb) {
  const O = CS.optics;
  const clamp = O.clamp;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const rad = (d) => d * Math.PI / 180;

  const mobile = window.matchMedia('(max-width: 900px)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  const PR = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  renderer.setPixelRatio(PR);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive 3D view');

  let mode = 'body';
  let rect = { x: 0, y: 0, w: 100, h: 100 };       // free area of the stage, CSS px
  let size = { w: 100, h: 100 };
  let running = true;

  /* =====================================================================
   * Body mode
   * ================================================================== */
  const bodyScene = new THREE.Scene();
  const bodyCam = new THREE.PerspectiveCamera(30, 1, 1, 300);
  bodyCam.position.set(-9, 9, 24);
  const controls = new THREE.OrbitControls(bodyCam, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.enablePan = false; controls.minDistance = 11; controls.maxDistance = 60;
  controls.target.set(0.3, 0.6, 0.6);

  // A plain photo studio for the metal to reflect.
  (function () {
    const studio = new THREE.Scene();
    const wallM = new THREE.MeshBasicMaterial({ color: 0x8b8f96, side: THREE.BackSide });
    studio.add(new THREE.Mesh(new THREE.BoxGeometry(40, 30, 40), wallM));
    const panel = (w, h, x, y, z, v) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); studio.add(m);
    };
    panel(22, 14, 0, 14, 4, 7); panel(10, 16, -18, 3, 8, 4); panel(10, 16, 18, 4, -6, 3); panel(16, 8, 0, -2, 19, 2.2); panel(30, 30, 0, -14.5, 0, 0.5);
    const pm = new THREE.PMREMGenerator(renderer);
    bodyScene.environment = pm.fromScene(studio, 0.035).texture;
    bodyScene.environmentIntensity = 0.6;
    pm.dispose();
  })();
  bodyScene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 0.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(-8, 16, 14); bodyScene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.45); rim.position.set(10, 8, -14); bodyScene.add(rim);

  const body = CS.buildBody(THREE);
  body.group.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
  bodyScene.add(body.group);
  // A soft contact shadow.
  (function () {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,0.4)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(19, 11), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(0.3, -3.45, 1.2);
    bodyScene.add(m);
  })();

  const VIEWS = {
    hero: [-0.42, 0.5, 0.76], front: [-0.08, 0.16, 1], top: [0, 1, -0.24], back: [0.08, 0.2, -1],
    side: [1, 0.15, -0.3], bottom: [0, -1, 0.35], grip: [-0.75, 0.55, 0.4],
  };
  let fly = null;       // { from: Spherical, to: Spherical, t0: Vector3, t1: Vector3, k }
  function flyBody(dir, dist, target) {
    const from = new THREE.Spherical().setFromVector3(bodyCam.position.clone().sub(controls.target));
    const to = new THREE.Spherical().setFromVector3(V(dir[0], dir[1], dir[2]).normalize().multiplyScalar(dist));
    let d = to.theta - from.theta;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    to.theta = from.theta + d;
    fly = { from, to, t0: controls.target.clone(), t1: target || V(0.3, 0.6, 0.6), k: 0 };
  }
  const bodyDist = () => (rect.w < 480 ? 40 : rect.w < 800 ? 31 : 27);
  function bodyView(name) { flyBody(VIEWS[name] || VIEWS.hero, bodyDist()); }
  function bodySelect(id, opts) {
    body.select(id);
    labels.forEach((l) => { l.el.dataset.selected = String(l.part.id === id); });
    const p = body.parts.get(id);
    if (!p || (opts && opts.still)) return;
    const v = VIEWS[p.view] || VIEWS.hero;
    const dir = [v[0] + p.normal.x * 0.45, v[1] + p.normal.y * 0.45, v[2] + p.normal.z * 0.45];
    flyBody(dir, bodyDist() * 0.9, p.anchor.clone().multiplyScalar(0.35));
  }

  // Labels: one per part, shown only on the side facing the viewer.
  const labels = [];
  body.parts.forEach((p) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'xp-label cs-part';
    el.textContent = p.name;
    el.title = p.name;
    el.addEventListener('click', () => cb.onPart && cb.onPart(p.id));
    labelsHost.appendChild(el);
    labels.push({ el, part: p, x: 0, y: 0, w: 0 });
  });
  let labelsOn = true;
  const _v = V(0, 0, 0), _n = V(0, 0, 0);
  function placeLabels() {
    const placed = [];
    const sel = body.selected;
    const order = labels.slice().sort((a, b) => (b.part.id === sel) - (a.part.id === sel));
    order.forEach((l) => {
      const p = l.part;
      _n.copy(bodyCam.position).sub(p.anchor).normalize();
      const facing = _n.dot(p.normal);
      _v.copy(p.anchor).project(bodyCam);
      const show = labelsOn && mode === 'body' && facing > 0.12 && _v.z < 1;
      if (!show) { l.el.style.display = 'none'; return; }
      const x = rect.x + (_v.x * 0.5 + 0.5) * rect.w, y = rect.y + (-_v.y * 0.5 + 0.5) * rect.h;
      if (!l.w) l.w = l.el.offsetWidth || 90;
      const hw = l.w / 2 + 3;
      const hit = placed.some((q) => Math.abs(q.x - x) < hw + q.hw && Math.abs(q.y - y) < 22);
      l.el.style.display = '';
      // With a control selected, the rest shrink to dots so its label stands alone.
      l.el.classList.toggle('cs-dot', (hit || !!sel) && p.id !== sel);
      l.el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) translate(-50%,-50%)';
      if (!hit || p.id === sel) placed.push({ x, y, hw });
    });
  }

  // Picking parts with the mouse.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function partAt(ev) {
    const b = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - b.left - rect.x) / rect.w) * 2 - 1, -((ev.clientY - b.top - rect.y) / rect.h) * 2 + 1);
    ray.setFromCamera(ndc, bodyCam);
    const hits = ray.intersectObject(body.group, true);
    for (let i = 0; i < hits.length; i++) if (hits[i].object.userData.part) return hits[i].object.userData.part;
    return hits.length ? '' : null;
  }

  /* =====================================================================
   * World mode: the viewfinder
   * ================================================================== */
  const world = CS.buildWorld(THREE);
  const cam = new THREE.PerspectiveCamera(40, 1.5, 0.12, 800);
  cam.rotation.order = 'YXZ';

  const vf = {
    pos: V(0, 1.6, 10), yaw: 0, pitch: 0, roll: 0, f: 23, portrait: false,
    lens: O.LENSES.kit,
    user: { mode: 'A', ap: O.apertureIndex(5.6), sh: O.shutterIndex(1 / 250), iso: 0, isoAuto: true, comp: 0, minShutter: 1 / 125, maxISO: 6400 },
    focus: { mode: 'face', dist: 5, point: [0, 0] },
    film: O.FILMSIMS[0], wb: 'auto', ois: true, paused: false, zebra: false,
    time: 3, focusDist: 5, meterEV: 15, meterTarget: 15,
  };
  let resolved = O.resolveExposure(vf.user, vf.meterEV, vf.lens, vf.f);
  let frame = { x: 0, y: 0, w: 300, h: 200 };      // the 3:2 picture inside rect, CSS px
  let rtScene = null, rtAccum = null, rtW = 0, rtH = 0, quality = 1;
  const rtMeter = new THREE.WebGLRenderTarget(48, 32, { type: THREE.UnsignedByteType, depthBuffer: false });
  const rtHist = new THREE.WebGLRenderTarget(96, 64, { type: THREE.UnsignedByteType, depthBuffer: false });
  rtMeter.texture.minFilter = rtMeter.texture.magFilter = THREE.NearestFilter;
  const meterBuf = new Uint8Array(48 * 32 * 4), histBuf = new Uint8Array(96 * 64 * 4);

  const floatOK = !!(renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float')) || renderer.extensions.has('EXT_color_buffer_half_float');
  function makeTargets(w, h) {
    if (rtScene) { rtScene.dispose(); rtAccum.dispose(); }
    const type = floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType;
    rtScene = new THREE.WebGLRenderTarget(w, h, { type, depthBuffer: true, samples: 0 });
    rtScene.depthTexture = new THREE.DepthTexture(w, h);
    rtScene.depthTexture.minFilter = rtScene.depthTexture.magFilter = THREE.NearestFilter;
    rtAccum = new THREE.WebGLRenderTarget(w, h, { type, depthBuffer: false });
    rtW = w; rtH = h;
  }

  // A full-screen triangle for the passes.
  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  quadGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(quadGeo, null); quad.frustumCulled = false; quadScene.add(quad);
  const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  const dofMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true,
    uniforms: {
      tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() },
      uNear: { value: 0.12 }, uFar: { value: 800 }, uFocus: { value: 5 }, uCoc: { value: 0 }, uMaxR: { value: 0 },
      uDiff: { value: 0 }, uWeight: { value: 1 }, uSeed: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: [
      'uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uTexel;',
      'uniform float uNear, uFar, uFocus, uCoc, uMaxR, uDiff, uWeight, uSeed;',
      'varying vec2 vUv;',
      'float depthAt(vec2 uv){ float z = texture2D(tDepth, uv).x; return uNear * uFar / (uFar - z * (uFar - uNear)); }',
      // Radius in pixels of the blur disc for something at distance d.
      'float cocAt(float d){ float c = 0.5 * uCoc * abs(d - uFocus) / d; return min(uMaxR, sqrt(c * c + uDiff * uDiff)); }',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }',
      'void main(){',
      '  vec3 col = texture2D(tColor, vUv).rgb;',
      '  if (uMaxR < 0.7) { gl_FragColor = vec4(col * uWeight, 1.0); return; }',
      '  float d0 = depthAt(vUv), c0 = cocAt(d0);',
      '  vec3 acc = col; float wsum = 1.0;',
      '  float rot = hash(gl_FragCoord.xy) * 6.2831853;',
      '  for (int i = 1; i <= 44; i++) {',
      '    float fi = float(i), r = sqrt(fi / 44.0) * uMaxR, a = fi * 2.3999632 + rot;',
      '    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;',
      '    float d = depthAt(uv), c = cocAt(d);',
      // Something behind a sharp thing cannot smear over it.
      '    if (d > d0) c = min(c, c0 + 0.6);',
      '    float w = smoothstep(r - 1.0, r + 0.5, c);',
      '    acc += texture2D(tColor, uv).rgb * w; wsum += w;',
      '  }',
      '  gl_FragColor = vec4(acc / wsum * uWeight, 1.0);',
      '}',
    ].join('\n'),
  });

  const finalMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      tAccum: { value: null }, uGain: { value: 1 }, uWB: { value: V(1, 1, 1) }, uISO: { value: 1 }, uSeed: { value: 0 },
      uSat: { value: 1 }, uCon: { value: 1 }, uLift: { value: 0 }, uSh: { value: V(0, 0, 0) }, uHi: { value: V(0, 0, 0) },
      uVig: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uZebra: { value: 0 }, uBlink: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: [
      'uniform sampler2D tAccum; uniform float uGain, uISO, uSeed, uSat, uCon, uLift, uVig, uZebra, uBlink;',
      'uniform vec3 uWB, uSh, uHi; uniform vec2 uRes;',
      'varying vec2 vUv;',
      'float h(vec2 p, float k){ return fract(sin(dot(p + k * 17.13, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }',
      'float g(vec2 p, float k){ return (h(p, k) + h(p, k + 0.5) - 1.0) * 1.7; }',
      'void main(){',
      '  vec3 H = texture2D(tAccum, vUv).rgb * uGain * uWB;',
      '  vec2 q = vUv - 0.5; H *= 1.0 - uVig * dot(q, q) * 2.0;',
      '  vec2 px = floor(vUv * uRes);',
      '  float lum = dot(H, vec3(0.2126, 0.7152, 0.0722));',
      // Shot noise grows with the signal, read noise with the gain alone.
      '  float sig = sqrt(5e-5 * max(lum, 0.0) * uISO + 1.2e-7 * uISO * uISO);',
      '  H += sig * (0.8 * g(px, 4.0) + 0.45 * vec3(g(px, 1.0), g(px, 2.0), g(px, 3.0)));',
      '  float clip = step(1.42, min(H.r, min(H.g, H.b)));',
      '  H = clamp(H, 0.0, 1.45);',                       // the sensor saturates
      '  vec3 y = clamp(H * (1.0 + H / 1.96) / (1.0 + H), 0.0, 1.0);',   // highlight shoulder
      '  float L = dot(y, vec3(0.2126, 0.7152, 0.0722));',
      '  y = mix(vec3(L), y, uSat);',
      '  y = pow(max(y, 0.0) / 0.18, vec3(uCon)) * 0.18;',
      '  y += uLift + uSh * (1.0 - smoothstep(0.0, 0.3, L)) + uHi * smoothstep(0.25, 1.0, L);',
      '  y = clamp(y, 0.0, 1.0);',
      '  vec3 s = mix(12.92 * y, 1.055 * pow(y, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, y));',
      '  if (uZebra > 0.5) s = mix(s, vec3(0.0), clip * uBlink);',
      '  gl_FragColor = vec4(s, 1.0);',
      '}',
    ].join('\n'),
  });

  // The light meter: log2 luminance of the linear scene, packed into 8 bits.
  const meterMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tColor: { value: null } },
    vertexShader: VERT,
    fragmentShader: [
      'uniform sampler2D tColor; varying vec2 vUv;',
      'void main(){',
      '  float L = 0.0;',
      '  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++)',
      '    L += dot(texture2D(tColor, vUv + (vec2(float(i), float(j)) - 1.5) * vec2(0.005, 0.0075)).rgb, vec3(0.2126, 0.7152, 0.0722));',
      '  L /= 16.0;',
      '  gl_FragColor = vec4(clamp((log2(max(L, 1e-5)) + 14.0) / 20.0, 0.0, 1.0), 0.0, 0.0, 1.0);',
      '}',
    ].join('\n'),
  });

  function pass(material, target, x, y, w, h) {
    quad.material = material;
    renderer.setRenderTarget(target);
    if (!target) { renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h); renderer.setScissorTest(true); }
    renderer.render(quadScene, quadCam);
  }

  /* ---- layout ---- */
  function layout() {
    const b = host.getBoundingClientRect();
    size = { w: Math.max(50, b.width), h: Math.max(50, b.height) };
    renderer.setSize(size.w, size.h, false);
    canvas.style.width = '100%'; canvas.style.height = '100%';
    bodyCam.aspect = rect.w / rect.h; bodyCam.updateProjectionMatrix();
    const ar = vf.portrait ? 2 / 3 : 3 / 2, m = 8;
    let w = rect.w - 2 * m, h = w / ar;
    if (h > rect.h - 2 * m) { h = rect.h - 2 * m; w = h * ar; }
    frame = { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
    cam.aspect = ar;
    const scale = Math.min(1, 1500 / (w * PR)) * quality;
    const tw = Math.max(64, Math.round(w * PR * scale)), th = Math.max(64, Math.round(h * PR * scale));
    if (tw !== rtW || th !== rtH) makeTargets(tw, th);
    labels.forEach((l) => { l.w = 0; });
    if (cb.onLayout) cb.onLayout(frame);
  }
  function setRect(r) { rect = r; layout(); }

  /* ---- the virtual camera ---- */
  const fwd = V(0, 0, -1);
  function aim(yawOff, pitchOff) {
    const sensorV = vf.portrait ? O.SENSOR.w : O.SENSOR.h;
    cam.fov = 2 * Math.atan(sensorV / (2 * vf.f)) * 180 / Math.PI;
    cam.position.copy(vf.pos);
    cam.rotation.set(rad(vf.pitch) + (pitchOff || 0), -rad(vf.yaw) + (yawOff || 0), -rad(vf.roll));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    cam.getWorldDirection(fwd);
  }

  // Hand shake: a wandering aim whose speed averages TREMOR rad/s.
  const SHAKE = [1.3, 3.1, 6.7].map((f, i) => ({ w: 2 * Math.PI * f, a: O.TREMOR * Math.SQRT2 / (Math.sqrt(3) * 2 * Math.PI * f), px: i * 2.1, py: i * 3.7 + 1 }));
  function shakeAt(tau, out) {
    let x = 0, y = 0;
    for (let i = 0; i < 3; i++) { x += SHAKE[i].a * Math.sin(SHAKE[i].w * tau + SHAKE[i].px); y += SHAKE[i].a * Math.sin(SHAKE[i].w * tau * 1.13 + SHAKE[i].py); }
    out[0] = x; out[1] = y;
    return out;
  }

  /* ---- focus ---- */
  const afRay = new THREE.Raycaster();
  const _p = V(0, 0, 0), _q = V(0, 0, 0);
  let afInfo = { x: 0, y: 0, face: false, name: '', dist: 5, locked: true };
  let mainSubject = null;
  function depthOf(p) { return _q.copy(p).sub(vf.pos).dot(fwd); }
  function inFrame(p, margin) {
    _p.copy(p).project(cam);
    return _p.z < 1 && Math.abs(_p.x) < margin && Math.abs(_p.y) < margin ? _p : null;
  }
  function autofocus(frameNo) {
    const fo = vf.focus;
    let target = null;
    mainSubject = null;
    // Find the person the camera would lock on to: nearest face in the frame.
    let best = 1e9;
    world.subjects.forEach((s) => {
      const n = inFrame(s.pos, 0.96);
      if (!n) return;
      const d = depthOf(s.pos);
      if (d < 0.3 || d > 45) return;
      const score = d * (1 + 1.5 * Math.hypot(n.x - fo.point[0], n.y - fo.point[1]));
      if (score < best) { best = score; mainSubject = { s, d, x: n.x, y: n.y }; }
    });
    if (fo.mode === 'manual') {
      target = fo.dist;
      afInfo = { x: 0, y: 0, face: false, name: '', dist: target, manual: true };
    } else if (fo.mode === 'face' && mainSubject && (mainSubject.s.kind !== 'animal')) {
      target = mainSubject.d;
      afInfo = { x: mainSubject.x, y: mainSubject.y, face: true, name: mainSubject.s.name, dist: target, size: clamp(0.5 / mainSubject.d * (vf.f / 23), 0.03, 0.4) };
    } else {
      if (frameNo % 5 === 0 || afInfo.face || afInfo.manual) {
        afRay.setFromCamera(new THREE.Vector2(fo.point[0], fo.point[1]), cam);
        afRay.far = 400;
        const hits = afRay.intersectObjects(world.scene.children, true);
        let d = 400;
        for (let i = 0; i < hits.length; i++) {
          const m = hits[i].object.material;
          if (m && m.fog === false) continue;         // sky, sun, clouds
          d = depthOf(hits[i].point); break;
        }
        afInfo = { x: fo.point[0], y: fo.point[1], face: false, name: '', dist: d };
      }
      target = afInfo.dist;
    }
    target = Math.max(vf.lens.close, target);
    // Focus motors take a moment; work in 1/distance, as lenses do.
    const a = 1 / vf.focusDist, b = 1 / target;
    vf.focusDist = 1 / (a + (b - a) * 0.35);
    afInfo.locked = Math.abs(a - b) < 0.02 * b + 0.002;
  }

  /* ---- metering ---- */
  function readMeter() {
    meterMat.uniforms.tColor.value = rtScene.texture;
    renderer.setScissorTest(false);
    quad.material = meterMat;
    renderer.setRenderTarget(rtMeter);
    renderer.render(quadScene, quadCam);
    renderer.readRenderTargetPixels(rtMeter, 0, 0, 48, 32, meterBuf);
    // Geometric mean first, to cap light sources that would otherwise dominate.
    let ls = 0, n = 48 * 32;
    for (let i = 0; i < n; i++) ls += meterBuf[i * 4] / 255 * 20 - 14;
    const cap = Math.pow(2, ls / n + 3);
    let sum = 0, wsum = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) {
      const L = Math.min(cap, Math.pow(2, meterBuf[(y * 48 + x) * 4] / 255 * 20 - 14));
      const dx = (x - 23.5) / 24, dy = (y - 15.5) / 16, w = 1 + 1.2 * Math.max(0, 1 - (dx * dx + dy * dy));
      sum += L * w; wsum += w;
    }
    vf.meterTarget = world.light.ev + O.log2(Math.max(1e-5, sum / wsum) / 0.18);
  }
  let hist = { bins: new Float32Array(48), hi: 0, lo: 0, mean: 0.5 };
  function readHist() {
    const bins = new Float32Array(48);
    renderer.setScissorTest(false);
    quad.material = finalMat;
    const z = finalMat.uniforms.uZebra.value;
    finalMat.uniforms.uZebra.value = 0;          // measure the picture, not the warning drawn on it
    renderer.setRenderTarget(rtHist);
    renderer.render(quadScene, quadCam);
    finalMat.uniforms.uZebra.value = z;
    renderer.readRenderTargetPixels(rtHist, 0, 0, 96, 64, histBuf);
    let hi = 0, lo = 0, mean = 0;
    const n = 96 * 64;
    for (let i = 0; i < n; i++) {
      const r = histBuf[i * 4], g2 = histBuf[i * 4 + 1], b = histBuf[i * 4 + 2];
      const L = 0.2126 * r + 0.7152 * g2 + 0.0722 * b;
      bins[Math.min(47, Math.floor(L / 255 * 48))]++;
      if (Math.min(r, g2, b) >= 252) hi++;
      if (Math.max(r, g2, b) <= 5) lo++;
      mean += L;
    }
    // How bright the main subject's face came out (0 black, 1 white).
    let subjectLum = null;
    if (mainSubject) {
      const cx = Math.round((mainSubject.x * 0.5 + 0.5) * 95), cy = Math.round((mainSubject.y * 0.5 + 0.5) * 63);
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = cx + dx, Y = cy + dy;
        if (X < 0 || X > 95 || Y < 0 || Y > 63) continue;
        const i = (Y * 96 + X) * 4;
        sum += 0.2126 * histBuf[i] + 0.7152 * histBuf[i + 1] + 0.0722 * histBuf[i + 2]; cnt++;
      }
      if (cnt) subjectLum = sum / cnt / 255;
    }
    hist = { bins, hi: hi / n, lo: lo / n, mean: mean / n / 255, subjectLum };
    if (cb.onHistogram) cb.onHistogram(hist);
  }

  /* ---- white balance ---- */
  const WB = { daylight: [1, 1, 1], shade: [0.86, 0.95, 1.12], cloudy: [0.93, 0.98, 1.05], tungsten: [1, 0.7, 0.42], fluorescent: [0.95, 1, 0.8] };
  function wbGain(out) {
    let ref;
    if (vf.wb === 'auto') { const il = world.light.illum; ref = [1 + (il[0] - 1) * 0.82, 1 + (il[1] - 1) * 0.82, 1 + (il[2] - 1) * 0.82]; }
    else ref = WB[vf.wb] || WB.daylight;
    return out.set(ref[1] / ref[0], 1, ref[1] / ref[2]);
  }

  /* ---- blur bookkeeping, for the read-outs and the photo review ---- */
  const stats = { shakePx: 0, subjectPx: 0, defocus: 0, K: 1, cocInf: 0 };
  function longSidePx() { return vf.portrait ? rtH : rtW; }

  /* ---- one frame of the viewfinder ---- */
  const sh0 = [0, 0], sh1 = [0, 0];
  let frameNo = 0, shakeClock = 0, shadowDrawn = false;
  function renderWorld(dt, still) {
    frameNo++;
    if (!vf.paused && !still) vf.time += dt;
    shakeClock += dt * 0.12;
    aim();
    world.measure(vf.time, vf.pos);
    autofocus(frameNo);

    vf.meterEV += (vf.meterTarget - vf.meterEV) * Math.min(1, dt * 7);
    if (Math.abs(vf.meterTarget - vf.meterEV) < 0.02) vf.meterEV = vf.meterTarget;
    resolved = O.resolveExposure(vf.user, vf.meterEV, vf.lens, vf.f);
    const N = resolved.N, t = resolved.t, f = vf.f, s = vf.focusDist;

    // Blur in picture pixels: hand shake, the fastest subject, defocus.
    const long = longSidePx(), pxPerMm = long / O.SENSOR.w;
    const ois = vf.ois ? vf.lens.ois : 0;
    stats.shakePx = O.shakeBlur(f, t, ois) * pxPerMm;
    let subjPx = 0;
    world.subjects.forEach((sb) => {
      if (!inFrame(sb.pos, 1.15)) return;
      const x0 = _p.x, y0 = _p.y;
      _q.copy(sb.pos).addScaledVector(sb.vel, t).project(cam);
      const d = Math.hypot((_q.x - x0) * rtW, (_q.y - y0) * rtH) / 2;
      sb.blurPx = d;
      if (d > subjPx) subjPx = d;
    });
    stats.subjectPx = subjPx;
    const K = clamp(Math.ceil(Math.max(stats.shakePx, subjPx) / 1.3), 1, mobile ? 8 : 14);
    stats.K = K;

    const cocK = f * f / (N * (s * 1000 - f));                 // mm, the disc at infinity
    const cocPx = cocK * pxPerMm;                               // diameter in px at infinity
    const nearD = Math.max(0.3, 0.4 * s);
    const maxR = Math.min(mobile ? 16 : 26, 0.5 * cocPx * Math.max(1, Math.abs(nearD - s) / nearD) + 0.01);
    stats.cocInf = cocK;
    const du = dofMat.uniforms;
    du.tColor.value = rtScene.texture; du.tDepth.value = rtScene.depthTexture;
    du.uTexel.value.set(1 / rtW, 1 / rtH);
    du.uNear.value = cam.near; du.uFar.value = cam.far;
    du.uFocus.value = s; du.uCoc.value = cocPx;
    du.uDiff.value = 0.5 * O.airy(N) * pxPerMm * 0.6;
    du.uMaxR.value = Math.max(maxR, du.uDiff.value > 0.45 ? du.uDiff.value + 0.5 : 0);
    du.uWeight.value = 1 / K;

    world.aimSun(_p.copy(vf.pos).addScaledVector(fwd, 16).setY(0));
    // No sun, no shadows to redraw. But the map must be drawn once even then:
    // the shaders sample it whatever the light, and an unallocated shadow map
    // makes every lit surface fail to draw.
    renderer.shadowMap.needsUpdate = world.sun.intensity > 0 || !shadowDrawn;
    shadowDrawn = true;
    renderer.setScissorTest(false);
    renderer.setRenderTarget(rtAccum);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);

    shakeAt(shakeClock + 0.5 * t, sh0);
    const shakeScale = 1 / Math.pow(2, ois);
    for (let k = 0; k < K; k++) {
      const u = K === 1 ? 0.5 : k / (K - 1);
      if (K > 1) world.update(vf.time + (u - 0.5) * t, vf.pos);
      shakeAt(shakeClock + u * t, sh1);
      aim((sh1[0] - sh0[0]) * shakeScale, (sh1[1] - sh0[1]) * shakeScale);
      renderer.setRenderTarget(rtScene);
      renderer.clear(true, true, false);
      renderer.render(world.scene, cam);
      if (k === 0 && frameNo % 6 === 1) readMeter();
      du.uSeed.value = (frameNo * 0.37 + k * 1.7) % 100;
      pass(dofMat, rtAccum);
    }
    if (K > 1) { world.update(vf.time, vf.pos); aim(); }

    // Develop.
    const fu = finalMat.uniforms, fs = vf.film;
    fu.tAccum.value = rtAccum.texture;
    fu.uGain.value = Math.pow(2, world.light.ev - resolved.ev);
    wbGain(fu.uWB.value);
    fu.uISO.value = resolved.ISO / O.SENSOR.baseISO;
    if (!vf.paused || still) fu.uSeed.value = (frameNo * 0.618) % 50;
    fu.uSat.value = fs.sat; fu.uCon.value = fs.con; fu.uLift.value = fs.lift;
    fu.uSh.value.set(fs.sh[0], fs.sh[1], fs.sh[2]); fu.uHi.value.set(fs.hi[0], fs.hi[1], fs.hi[2]);
    fu.uVig.value = 0.5 * clamp(1 - (resolved.ap - resolved.wideI) / 6, 0, 1);
    fu.uRes.value.set(rtW, rtH);
    fu.uZebra.value = vf.zebra ? 1 : 0;
    fu.uBlink.value = Math.sin(performance.now() / 160) > 0 ? 1 : 0;
    if (frameNo % 6 === 3 || still) readHist();

    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.w, size.h);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    pass(finalMat, null, frame.x, size.h - frame.y - frame.h, frame.w, frame.h);
    renderer.setScissorTest(false);

    // Defocus of the main subject, in circles of confusion.
    stats.defocus = mainSubject ? O.blurDisc(f, N, s, Math.max(0.2, mainSubject.d)) / O.SENSOR.coc : 0;
    if (cb.onFrame) cb.onFrame(snapshot());
  }

  // Everyone in the frame: where they are in the picture and in the world,
  // which way they are moving, how blurred, and how wide their stride is.
  function census() {
    const out = [];
    world.subjects.forEach((sb) => {
      const n = inFrame(sb.pos, 1.0);
      if (!n) return;
      const x = n.x, y = n.y, d = depthOf(sb.pos);
      if (d < 0.2) return;
      _q.copy(sb.pos).addScaledVector(sb.vel, 0.2).project(cam);
      out.push({
        id: sb.id, name: sb.name, kind: sb.kind, x, y, d, dx: _q.x - x, wx: sb.pos.x, wz: sb.pos.z, speed: sb.vel.length(),
        blurSensorPx: (sb.blurPx || 0) / longSidePx() * O.SENSOR.px,
        spread: sb.person && sb.person.spread ? sb.person.spread() : 0,
      });
    });
    return out;
  }
  function snapshot(full) {
    const d = O.dof(vf.f, resolved.N, vf.focusDist);
    return {
      census: full ? census() : null,
      resolved, meterEV: vf.meterEV, focusDist: vf.focusDist, af: afInfo, dof: d, hist, stats,
      // The same blurs measured in the camera's own 6240-pixel-wide picture.
      shakeSensorPx: O.shakeBlur(vf.f, resolved.t, vf.ois ? vf.lens.ois : 0) / O.SENSOR.pitch,
      subjectSensorPx: stats.subjectPx / longSidePx() * O.SENSOR.px,
      subject: mainSubject ? { name: mainSubject.s.name, id: mainSubject.s.id, kind: mainSubject.s.kind, d: mainSubject.d, x: mainSubject.x, y: mainSubject.y, speed: mainSubject.s.vel.length(), blurSensorPx: (mainSubject.s.blurPx || 0) / longSidePx() * O.SENSOR.px } : null,
      pose: getPose(), light: world.light, film: vf.film, lens: vf.lens, portrait: vf.portrait, ois: vf.ois,
    };
  }

  /* ---- adaptive quality: keep the viewfinder smooth ---- */
  let slow = 0, fast = 0;
  function adapt(ms) {
    if (ms > 34) { slow++; fast = 0; } else if (ms < 20) { fast++; slow = Math.max(0, slow - 1); }
    if (slow > 25 && quality > 0.5) { quality = Math.max(0.5, quality - 0.15); slow = 0; layout(); }
    else if (fast > 400 && quality < 1) { quality = Math.min(1, quality + 0.15); fast = 0; layout(); }
  }

  /* ---- pose: where the photographer stands and looks ---- */
  function getPose() { return { x: vf.pos.x, y: vf.pos.y, z: vf.pos.z, yaw: vf.yaw, pitch: vf.pitch, roll: vf.roll, f: vf.f }; }
  let poseFly = null;
  function setPose(p, opts) {
    const to = Object.assign(getPose(), p);
    to.f = clamp(to.f, vf.lens.fmin, vf.lens.fmax);
    if (opts && opts.fly && mode === 'world') {
      const from = getPose();
      let dy = to.yaw - from.yaw;
      while (dy > 180) dy -= 360;
      while (dy < -180) dy += 360;
      to.yaw = from.yaw + dy;
      // A long way off: cut, don't fly through walls.
      if (Math.hypot(to.x - from.x, to.z - from.z) > 60) { applyPose(to); return; }
      poseFly = { from, to, k: 0, dur: opts.dur || 1.1 };
    } else { poseFly = null; applyPose(to); }
  }
  function applyPose(p) {
    vf.pos.set(p.x, Math.max(0.2, p.y), p.z); vf.yaw = p.yaw; vf.pitch = clamp(p.pitch, -80, 80); vf.roll = p.roll; vf.f = p.f;
    if (cb.onPose) cb.onPose(getPose());
  }
  const ease = (k) => k * k * (3 - 2 * k);

  /* ---- input ---- */
  const keys = new Set();
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'world') { drag = { x: e.clientX, y: e.clientY, moved: 0, body: true }; return; }
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
    poseFly = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (mode === 'body') {
      if (drag) { drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; return; }
      const id = partAt(e);
      canvas.style.cursor = id ? 'pointer' : 'grab';
      if (cb.onHover) cb.onHover(id ? body.parts.get(id).name : null, e.clientX, e.clientY);
      return;
    }
    if (!drag || pinch) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX; drag.y = e.clientY;
    const degPerPx = cam.fov / frame.h;
    vf.yaw -= dx * degPerPx; vf.pitch = clamp(vf.pitch + dy * degPerPx, -75, 75);
    if (cb.onPose) cb.onPose(getPose());
  });
  function endDrag(e) {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved > 6) return;
    const b = canvas.getBoundingClientRect();
    if (mode === 'body') {
      const id = partAt(e);
      if (id && cb.onPart) cb.onPart(id);
      return;
    }
    // A tap in the frame moves the focus point there, like touch AF.
    const x = (e.clientX - b.left - frame.x) / frame.w * 2 - 1, y = -((e.clientY - b.top - frame.y) / frame.h * 2 - 1);
    if (Math.abs(x) <= 1 && Math.abs(y) <= 1 && cb.onTap) cb.onTap(x, y);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => { if (cb.onHover) cb.onHover(null); });
  canvas.addEventListener('wheel', (e) => {
    if (mode !== 'world') return;
    e.preventDefault();
    setPose({ f: clamp(vf.f * Math.exp(-e.deltaY * 0.0012), vf.lens.fmin, vf.lens.fmax) });
  }, { passive: false });
  // Pinch to zoom on touch screens.
  let pinch = null;
  canvas.addEventListener('touchstart', (e) => { if (mode === 'world' && e.touches.length === 2) pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), f: vf.f }; }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    setPose({ f: clamp(pinch.f * d / pinch.d, vf.lens.fmin, vf.lens.fmax) });
  }, { passive: true });
  canvas.addEventListener('touchend', () => { pinch = null; }, { passive: true });

  const MOVE = { w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
  function typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
  window.addEventListener('keydown', (e) => {
    if (mode !== 'world' || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (MOVE[k] || k === 'r' || k === 'f') { keys.add(k); poseFly = null; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  // On-screen move buttons call this each frame they are held.
  const held = { x: 0, z: 0, y: 0 };
  function walk(dt) {
    let mx = held.x, mz = held.z, my = held.y;
    keys.forEach((k) => { if (MOVE[k]) { mx += MOVE[k][0]; mz += MOVE[k][1]; } else if (k === 'r') my += 1; else if (k === 'f') my -= 1; });
    if (!mx && !mz && !my) return;
    const sp = 2.4 * dt, yw = rad(vf.yaw);
    vf.pos.x += (Math.sin(yw) * mz + Math.cos(yw) * mx) * sp;
    vf.pos.z += (-Math.cos(yw) * mz + Math.sin(yw) * mx) * sp;
    vf.pos.y = clamp(vf.pos.y + my * sp * 0.6, 0.2, 12);
    if (cb.onPose) cb.onPose(getPose());
  }

  /* ---- the loop ---- */
  let last = performance.now(), clock = 0;
  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (document.hidden) return;
    drawFrame(dt);
  }
  function drawFrame(dt) {
    clock += dt;
    if (mode === 'body') {
      if (fly) {
        fly.k = Math.min(1, fly.k + dt / 0.8);
        const e = ease(fly.k), sp = new THREE.Spherical(
          fly.from.radius + (fly.to.radius - fly.from.radius) * e,
          fly.from.phi + (fly.to.phi - fly.from.phi) * e,
          fly.from.theta + (fly.to.theta - fly.from.theta) * e);
        controls.target.lerpVectors(fly.t0, fly.t1, e);
        bodyCam.position.setFromSpherical(sp).add(controls.target);
        if (fly.k >= 1) fly = null;
      }
      controls.update();
      body.update(dt, clock);
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.w, size.h);
      renderer.clear(true, true, false);
      renderer.setViewport(rect.x, size.h - rect.y - rect.h, rect.w, rect.h);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.render(bodyScene, bodyCam);
      placeLabels();
    } else {
      if (poseFly) {
        poseFly.k = Math.min(1, poseFly.k + dt / poseFly.dur);
        const e = ease(poseFly.k), a = poseFly.from, b = poseFly.to, mix = (k) => a[k] + (b[k] - a[k]) * e;
        applyPose({ x: mix('x'), y: mix('y'), z: mix('z'), yaw: mix('yaw'), pitch: mix('pitch'), roll: mix('roll'), f: mix('f') });
        if (poseFly && poseFly.k >= 1) poseFly = null;
      }
      walk(dt);
      renderer.toneMapping = THREE.NoToneMapping;
      const t0 = performance.now();
      renderWorld(dt, false);
      adapt(performance.now() - t0 + (dt * 1000 > 40 ? 20 : 0));
    }
  }

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    controls.enabled = m === 'body';
    canvas.style.cursor = m === 'body' ? 'grab' : 'crosshair';
    labels.forEach((l) => { l.el.style.display = 'none'; });
    layout();
  }

  // Take the picture: render once more and copy the frame out of the canvas.
  function capture(maxW) {
    renderer.toneMapping = THREE.NoToneMapping;
    const z = vf.zebra; vf.zebra = false;
    renderWorld(0, true);
    vf.zebra = z;
    const c = document.createElement('canvas');
    const w = Math.min(maxW || 900, Math.round(frame.w * PR)), h = Math.round(w * frame.h / frame.w);
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(canvas, frame.x * PR, frame.y * PR, frame.w * PR, frame.h * PR, 0, 0, w, h);
    let url = '';
    try { url = c.toDataURL('image/jpeg', 0.9); } catch (e) {}
    return { url, shot: snapshot(true) };
  }

  // What the plan view needs: where things are, seen from above.
  function plan() {
    return {
      pos: vf.pos, yaw: vf.yaw, hfov: (vf.portrait ? O.fov(vf.f).v : O.fov(vf.f).h), focusDist: vf.focusDist,
      dof: O.dof(vf.f, resolved.N, vf.focusDist),
      subjects: world.subjects.map((s) => ({ x: s.pos.x, z: s.pos.z, name: s.name, main: mainSubject && mainSubject.s === s })),
    };
  }

  layout();
  aim();
  requestAnimationFrame(tick);

  return {
    setMode, setRect, layout,
    get mode() { return mode; },
    body: {
      parts: body.parts, select: bodySelect, view: bodyView,
      setLabels(on) { labelsOn = on; },
      setAccent(c) { body.setAccent(c); },
    },
    world: {
      LIGHTS: world.LIGHTS, vf, held,
      setLight(id) { const l = world.setLight(id); vf.meterEV = vf.meterTarget = l.ev; return l; },
      setPose, getPose, capture, plan, snapshot,
      // Where a point in the world lands in the picture (-1..1 each way).
      project(p) { _p.set(p[0], p[1], p[2]); const front = depthOf(_p) > 0; _p.project(cam); return { x: _p.x, y: _p.y, front }; },
      setUser(u) { Object.assign(vf.user, u); },
      setLens(id) { vf.lens = O.LENSES[id] || O.LENSES.kit; vf.f = clamp(vf.f, vf.lens.fmin, vf.lens.fmax); if (cb.onPose) cb.onPose(getPose()); },
      setFilm(id) { vf.film = O.FILMSIMS.find((x) => x.id === id) || O.FILMSIMS[0]; },
      setFocus(fo) { Object.assign(vf.focus, fo); },
      setPortrait(p) { vf.portrait = !!p; layout(); },
      get resolved() { return resolved; },
      get frame() { return frame; },
    },
    // Advance n frames by hand (for checking things from the console).
    step(n, dt) { for (let i = 0; i < (n || 1); i++) drawFrame(dt || 1 / 30); },
    pause() { running = false; },
    resume() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(tick); } },
  };
}

CS.createStage = createStage;
})(window.CameraSkills = window.CameraSkills || {});
