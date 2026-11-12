/*
 * knowledge/cameraskills.html: the world the virtual camera photographs.
 * Four places in one scene, all built from primitives:
 *   street  a shopping street running toward an arch          (around x 0, z +15..-42)
 *   plaza   a square with a fountain and a clock tower         (z -44..-95)
 *   park    grass, trees and a friend to photograph            (x 30..70, z -45..-90)
 *   room    a living room with a window, a table and a child   (around x 200)
 * plus the light: presets from noon sun to night, each with the EV at which
 * a mid-grey surface in that light is correctly exposed.
 *
 * Units are metres, y up. Everything that moves is a pure function of time,
 * so the renderer can sample several instants inside one exposure to draw
 * motion blur.
 *
 * buildWorld(THREE) returns { scene, sun, subjects, setLight, update, LIGHTS, ... }.
 */
(function (CS) {
'use strict';

function buildWorld(THREE) {
  const scene = new THREE.Scene();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const lam = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));

  // Small seeded generator, so the town is the same on every visit.
  let seed = 20261111;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  function tex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  function mesh(geo, material, parent, x, y, z) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; m.receiveShadow = true;
    (parent || scene).add(m);
    return m;
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cylG = (r0, r1, h, seg) => new THREE.CylinderGeometry(r1, r0, h, seg || 12);
  const sph = (r, a, b) => new THREE.SphereGeometry(r, a || 12, b || 8);

  // Things that glow once the light fails.
  const glow = { windows: [], lamps: [], lampLights: [], shop: [] };

  /* ================= sky, sun, ground ================= */
  const skyGeo = new THREE.SphereGeometry(520, 24, 14);
  skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);
  function paintSky(zenith, horizon) {
    const p = skyGeo.attributes.position, c = skyGeo.attributes.color, a = new THREE.Color(), z = new THREE.Color(zenith), h = new THREE.Color(horizon);
    for (let i = 0; i < p.count; i++) {
      const k = Math.pow(Math.max(0, p.getY(i) / 520), 0.45);
      a.copy(h).lerp(z, k);
      c.setXYZ(i, a.r, a.g, a.b);
    }
    c.needsUpdate = true;
  }
  const sunDisc = new THREE.Mesh(sph(11, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  scene.add(sunDisc);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x9a8f80, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05;
  scene.add(sun); scene.add(sun.target);
  scene.fog = new THREE.Fog(0xbfd4ea, 70, 500);

  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    for (let j = 0; j < 4; j++) {
      const s = new THREE.Mesh(sph(14 + rnd() * 12, 10, 6), m);
      s.position.set(j * 16 - 24 + rnd() * 6, rnd() * 5, rnd() * 8); s.scale.y = 0.42;
      g.add(s);
    }
    const a = rnd() * Math.PI * 2;
    g.position.set(Math.cos(a) * 330, 95 + rnd() * 70, Math.sin(a) * 330);
    g.lookAt(0, 60, 0);
    scene.add(g); clouds.push(m);
  }

  const ground = mesh(new THREE.PlaneGeometry(900, 900), lam(0x7a8a5a), scene, 0, -0.02, 0);
  ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
  // Hills on the horizon, for scale and haze.
  [[-170, -300, 60, 150], [-40, -340, 85, 190], [120, -310, 70, 170], [260, -260, 55, 140], [-300, -180, 50, 130]].forEach(([x, z, h, r]) => {
    const m = mesh(new THREE.ConeGeometry(r, h, 7), lam(0x5f7355, { flatShading: true }), scene, x, h / 2 - 2, z);
    m.castShadow = false; m.rotation.y = rnd() * 3;
  });

  /* ================= people ================= */
  const subjects = [];      // things a photographer would call "the subject"
  const movers = [];        // { update(t) }

  function person(o) {
    o = Object.assign({ h: 1.72, shirt: 0x3b6ea8, pants: 0x2b2f3a, skin: 0xd9a47c, hair: 0x2a1c14, sleeves: true }, o || {});
    const g = new THREE.Group(), body = new THREE.Group();
    body.scale.setScalar(o.h / 1.72); g.add(body);
    const mS = lam(o.shirt), mP = lam(o.pants), mK = lam(o.skin), mH = lam(o.hair), mShoe = lam(0x1d1b1a);
    const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 3, 8);
    const pelvis = new THREE.Group(); pelvis.position.y = 0.9; body.add(pelvis);
    const torso = new THREE.Group(); pelvis.add(torso);
    mesh(cap(0.165, 0.34), mS, torso, 0, 0.3, 0).scale.z = 0.72;
    if (o.skirt) mesh(cylG(0.3, 0.17, 0.55, 10), lam(o.skirt), pelvis, 0, -0.2, 0);
    const limb = (side) => {
      const th = new THREE.Group(); th.position.set(side * 0.095, 0, 0); pelvis.add(th);
      mesh(cap(0.075, 0.33), mP, th, 0, -0.21, 0);
      const sh = new THREE.Group(); sh.position.y = -0.44; th.add(sh);
      mesh(cap(0.06, 0.32), mP, sh, 0, -0.2, 0);
      mesh(box(0.1, 0.07, 0.25), mShoe, sh, 0, -0.425, 0.05);
      return { th, sh };
    };
    const arm = (side) => {
      const up = new THREE.Group(); up.position.set(side * 0.225, 0.53, 0); torso.add(up);
      mesh(cap(0.05, 0.24), mS, up, 0, -0.15, 0);
      const fo = new THREE.Group(); fo.position.y = -0.3; up.add(fo);
      mesh(cap(0.042, 0.22), o.sleeves ? mS : mK, fo, 0, -0.13, 0);
      mesh(sph(0.05, 8, 6), mK, fo, 0, -0.29, 0);
      up.rotation.z = side * 0.08;
      return { up, fo };
    };
    const legs = [limb(-1), limb(1)], arms = [arm(-1), arm(1)];
    mesh(cylG(0.05, 0.05, 0.1, 8), mK, torso, 0, 0.66, 0);
    const head = new THREE.Group(); head.position.y = 0.8; torso.add(head);
    const skull = mesh(sph(0.115, 16, 12), mK, head); skull.scale.set(0.95, 1.12, 1.02);
    const hair = mesh(new THREE.SphereGeometry(0.123, 16, 10, 0, Math.PI * 2, 0, Math.PI * (o.longHair ? 0.62 : 0.5)), mH, head, 0, 0.012, -0.012);
    hair.rotation.x = o.longHair ? -0.95 : -0.62; hair.scale.set(0.97, 1.1, 1.04);
    if (o.longHair) mesh(cap(0.1, 0.16), mH, head, 0, -0.1, -0.07).scale.z = 0.6;
    if (o.hat) { mesh(cylG(0.2, 0.2, 0.015, 16), lam(o.hat), head, 0, 0.085, 0.01); mesh(cylG(0.12, 0.11, 0.1, 16), lam(o.hat), head, 0, 0.13, 0); }
    const eyeM = lam(0x1a1412);
    [-1, 1].forEach((s) => mesh(sph(0.014, 6, 5), eyeM, head, s * 0.042, 0.012, 0.108).castShadow = false);
    mesh(sph(0.016, 6, 5), mK, head, 0, -0.018, 0.118).castShadow = false;
    const api = {
      group: g, head, pelvis, torso, legs, arms, h: o.h,
      // How far apart the legs are: 0 standing, about 1 in full stride.
      spread() { return Math.abs(legs[0].th.rotation.x - legs[1].th.rotation.x); },
      stand() { legs.forEach((l) => { l.th.rotation.x = 0; l.sh.rotation.x = 0; }); pelvis.position.y = 0.9; return api; },
      sit() { legs.forEach((l) => { l.th.rotation.x = -Math.PI / 2 + 0.08; l.sh.rotation.x = Math.PI / 2 - 0.05; }); pelvis.position.y = 0.56; return api; },
      // phase in radians; amount 1 = a brisk walk, more for a run.
      stride(ph, amt) {
        const a = amt || 1;
        legs.forEach((l, i) => {
          const s = Math.sin(ph + i * Math.PI);
          l.th.rotation.x = -0.5 * a * s;
          l.sh.rotation.x = Math.max(0, Math.cos(ph + i * Math.PI + 0.6)) * 0.9 * a;
        });
        arms.forEach((m, i) => { m.up.rotation.x = 0.45 * a * Math.sin(ph + i * Math.PI); m.fo.rotation.x = -0.25 * a - 0.2 * (a - 1); });
        pelvis.position.y = 0.9 - 0.02 * a + 0.02 * a * Math.abs(Math.cos(ph));
      },
    };
    return api;
  }

  function addSubject(id, name, p, kind) {
    const s = { id, name, kind: kind || 'person', obj: p.group, head: p.head, person: p, pos: V(0, 0, 0), vel: V(0, 0, 0) };
    subjects.push(s);
    return s;
  }
  const _a = V(0, 0, 0), _b = V(0, 0, 0);
  function headOf(s, out) { return s.head.getWorldPosition(out); }

  // Walk a straight leg there and back, turning round at each end.
  function patrol(p, a, b, speed, offset, run) {
    const len = a.distanceTo(b), dir = b.clone().sub(a).normalize(), yaw = Math.atan2(dir.x, dir.z);
    const stepLen = run ? 1.9 : 1.45;
    movers.push({
      update(t) {
        const d = (t * speed + offset * len) % (2 * len), fwd = d < len, s = fwd ? d : 2 * len - d;
        p.group.position.copy(a).addScaledVector(dir, s);
        p.group.rotation.y = fwd ? yaw : yaw + Math.PI;
        p.stride((t * speed + offset * len) / stepLen * Math.PI * 2 / 2, run ? 1.7 : 1);
      },
    });
  }
  // Walk one way and reappear at the start.
  function loop(p, a, b, speed, offset, anim) {
    const len = a.distanceTo(b), dir = b.clone().sub(a).normalize(), yaw = Math.atan2(dir.x, dir.z);
    movers.push({
      update(t) {
        const s = (t * speed + offset * len) % len;
        p.group.position.copy(a).addScaledVector(dir, s);
        p.group.rotation.y = yaw;
        if (anim) anim(t); else p.stride((t * speed + offset * len) / 1.45 * Math.PI, 1);
      },
    });
  }

  /* ================= textures ================= */
  const noise = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '0,0,0' : '255,255,255') + ',' + (rnd() * a) + ')'; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3); } };
  const asphalt = tex(256, 256, (g, w, h) => { g.fillStyle = '#4a4b4e'; g.fillRect(0, 0, w, h); noise(g, w, h, 900, 0.07); }, [6, 30]);
  const paving = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#b9b2a4'; g.fillRect(0, 0, w, h); noise(g, w, h, 500, 0.05);
    g.strokeStyle = 'rgba(70,62,50,0.55)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
  const pave = (rx, ry) => { const t = paving.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); return t; };
  const grass = tex(256, 256, (g, w, h) => { g.fillStyle = '#6f9450'; g.fillRect(0, 0, w, h); noise(g, w, h, 1400, 0.09); }, [20, 20]);
  const wood = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#a97c50'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(60,35,15,' + (0.05 + rnd() * 0.12) + ')'; g.fillRect(0, i * 32, w, 31); g.fillStyle = 'rgba(40,22,8,0.5)'; g.fillRect(0, i * 32 + 31, w, 1); g.fillRect((i * 97) % w, i * 32, 1, 32); }
  }, [3, 3]);

  // A building front and its night-time twin (lit windows only).
  function facade(wM, hM, wall, o) {
    const W = 512, H = 512, sx = W / wM, sy = H / hM, lit = [];
    const map = tex(W, H, (g) => {
      g.fillStyle = wall; g.fillRect(0, 0, W, H);
      noise(g, W, H, 500, 0.04);
      const floors = Math.max(1, Math.floor((hM - 3.6) / 3.1)), cols = Math.max(2, Math.round(wM / 2.7));
      // Ground floor: a shop or a plain plinth.
      const gy = H - 3.5 * sy;
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, gy, W, 3.5 * sy);
      if (o.shop) {
        g.fillStyle = o.sign || '#2e4a3e'; g.fillRect(0.4 * sx, gy + 0.15 * sy, W - 0.8 * sx, 0.6 * sy);
        g.fillStyle = '#20262c'; g.fillRect(0.5 * sx, gy + 0.95 * sy, W - 2.6 * sx, 2.3 * sy);
        lit.push([0.5 * sx, gy + 0.95 * sy, W - 2.6 * sx, 2.3 * sy, 1]);
        g.fillStyle = '#3a2a20'; g.fillRect(W - 1.8 * sx, gy + 0.95 * sy, 1.2 * sx, 2.55 * sy);
      } else {
        g.fillStyle = '#3a2a20'; g.fillRect(W / 2 - 0.6 * sx, gy + 0.9 * sy, 1.2 * sx, 2.6 * sy);
        for (let c = 0; c < cols; c++) { if (Math.abs((c + 0.5) / cols - 0.5) < 0.12) continue; const x = (c + 0.5) / cols * W; g.fillStyle = '#27303a'; g.fillRect(x - 0.5 * sx, gy + 1.0 * sy, 1.0 * sx, 1.4 * sy); if (rnd() < 0.4) lit.push([x - 0.5 * sx, gy + 1.0 * sy, 1.0 * sx, 1.4 * sy, 0]); }
      }
      for (let f = 0; f < floors; f++) {
        const y = gy - (f + 1) * 3.1 * sy + 0.7 * sy;
        for (let c = 0; c < cols; c++) {
          const x = (c + 0.5) / cols * W;
          g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x - 0.68 * sx, y - 0.12 * sy, 1.36 * sx, 1.95 * sy);
          g.fillStyle = '#2a3440'; g.fillRect(x - 0.55 * sx, y, 1.1 * sx, 1.7 * sy);
          g.fillStyle = 'rgba(160,190,215,0.28)'; g.fillRect(x - 0.55 * sx, y, 0.5 * sx, 1.7 * sy);
          if (o.shutters) { g.fillStyle = o.shutters; g.fillRect(x - 0.95 * sx, y, 0.36 * sx, 1.7 * sy); g.fillRect(x + 0.59 * sx, y, 0.36 * sx, 1.7 * sy); }
          if (rnd() < 0.45) lit.push([x - 0.55 * sx, y, 1.1 * sx, 1.7 * sy, 0]);
        }
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y + 2.25 * sy, W, 0.12 * sy);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, W, 0.35 * sy);
    });
    const emap = tex(W, H, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      lit.forEach(([x, y, w, h, shop]) => { g.fillStyle = shop ? '#ffe2b0' : pick(['#ffcf8a', '#ffd9a0', '#f6c27a', '#dfe6ff']); g.fillRect(x, y, w, h); });
    });
    return { map, emap };
  }

  const WALLS = ['#d9c7a3', '#c98f6b', '#e2d6bf', '#b9a58a', '#d7b98a', '#c7cfd4', '#e0c9b0', '#b98a6e', '#d2c4a8'];
  const plain = lam(0xb6a890), roofM = lam(0x6b4a3c);
  // A building whose decorated face looks along `face` ('+x', '-x', '+z' or '-z').
  function building(x0, x1, z0, z1, h, face, o) {
    o = o || {};
    const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0), along = face[1] === 'x' ? d : w;
    const f = facade(along, h, o.wall || pick(WALLS), o);
    const front = lam(0xffffff, { map: f.map, emissiveMap: f.emap, emissive: 0xffffff, emissiveIntensity: 0 });
    glow.windows.push(front);
    const mats = [plain, plain, roofM, plain, plain, plain];
    mats[{ '+x': 0, '-x': 1, '+z': 4, '-z': 5 }[face]] = front;
    return mesh(box(w, h, d), mats, scene, (x0 + x1) / 2, h / 2, (z0 + z1) / 2);
  }

  function tree(x, z, s, parent) {
    const g = new THREE.Group(); g.position.set(x, 0, z); (parent || scene).add(g);
    mesh(cylG(0.2 * s, 0.13 * s, 2.6 * s, 7), lam(0x5a4130), g, 0, 1.3 * s, 0);
    const green = lam(pick([0x4f7d3a, 0x5c8a40, 0x456f35, 0x6a9648]), { flatShading: true });
    [[0, 3.6, 0, 1.7], [0.9, 3.1, 0.3, 1.2], [-0.8, 3.2, -0.4, 1.25], [0.1, 4.6, -0.2, 1.15]].forEach(([a, b, c, r]) =>
      mesh(new THREE.IcosahedronGeometry(r * s, 1), green, g, a * s, b * s, c * s));
    g.rotation.y = rnd() * 6;
    return g;
  }

  function lampPost(x, z, parent) {
    const g = new THREE.Group(); g.position.set(x, 0, z); (parent || scene).add(g);
    const iron = lam(0x26292c);
    mesh(cylG(0.09, 0.06, 4.2, 8), iron, g, 0, 2.1, 0);
    mesh(cylG(0.16, 0.16, 0.35, 8), iron, g, 0, 0.18, 0);
    const globe = new THREE.MeshLambertMaterial({ color: 0xf3ead2, emissive: 0xffc980, emissiveIntensity: 0 });
    glow.lamps.push(globe);
    mesh(sph(0.24, 12, 8), globe, g, 0, 4.35, 0).castShadow = false;
    mesh(cylG(0.3, 0.05, 0.12, 8), iron, g, 0, 4.62, 0);
    return g;
  }
  function lampLight(x, y, z, k) {
    const l = new THREE.PointLight(0xffc27a, 0, 26, 2);
    l.position.set(x, y, z); l.userData.k = k || 1;
    scene.add(l); glow.lampLights.push(l);
  }

  /* ================= the street ================= */
  mesh(new THREE.PlaneGeometry(6, 62), lam(0xffffff, { map: asphalt }), scene, 0, 0, -11).rotation.x = -Math.PI / 2;
  [-1, 1].forEach((s) => {
    const side = mesh(box(3, 0.14, 62), lam(0xffffff, { map: pave(2, 40) }), scene, s * 4.5, 0.07, -11);
    side.castShadow = false;
  });
  const paint = lam(0xe9e6dc);
  for (let z = 18; z > -40; z -= 4) { if (z < -9 && z > -15.5) continue; mesh(box(0.14, 0.012, 1.8), paint, scene, 0, 0.006, z).castShadow = false; }
  for (let x = -2.5; x <= 2.5; x += 1) mesh(box(0.5, 0.012, 3), paint, scene, x, 0.007, -12).castShadow = false;

  // Buildings down both sides.
  (function () {
    const shops = [['#7a2e2a', true], ['#2e4a3e', true], [null, false], ['#2c3e5e', true], [null, false], ['#6a4a1e', true], [null, false]];
    [-1, 1].forEach((s) => {
      let z = 20, i = 0;
      while (z > -41) {
        const w = Math.min(7 + Math.floor(rnd() * 5), z + 41.5), h = 9.5 + Math.floor(rnd() * 3) * 3.1, sp = shops[(i + (s > 0 ? 0 : 3)) % shops.length];
        building(s * 6, s * (6 + 9), z - w, z, h, s > 0 ? '-x' : '+x', { shop: sp[1], sign: sp[0], shutters: rnd() < 0.5 ? pick(['#3f5a4a', '#4a5f78', '#7a4a3a']) : null });
        z -= w; i++;
      }
    });
  })();
  // Street furniture.
  for (let z = 12; z > -38; z -= 12) { lampPost(3.35, z); lampPost(-3.35, z - 6); }
  [[3.35, 0], [-3.35, -18], [3.35, -24]].forEach(([x, z]) => lampLight(x, 4.2, z));
  [[-4.6, 9], [-4.6, -22], [-4.6, -33]].forEach(([x, z]) => {
    tree(x, z, 0.85);
    mesh(box(1.2, 0.3, 1.2), lam(0x8a7f70), scene, x, 0.29, z);
  });
  // Awnings over three shop fronts.
  const stripes = (a, b) => tex(128, 32, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * 16, 0, 16, h); } });
  [[5.2, 3, '#a8322c'], [5.2, -19.5, '#2e5d8a'], [-5.2, -27, '#3d6b4a']].forEach(([x, z, c]) => {
    const a = mesh(box(1.7, 0.06, 4.6), lam(0xffffff, { map: stripes(c, '#f1ece0') }), scene, x, 3.05, z);
    a.rotation.z = (x > 0 ? 1 : -1) * 0.33;
  });
  // A fruit stall with its vendor: the classic street subject.
  (function () {
    const g = new THREE.Group(); g.position.set(4.75, 0.14, -8); scene.add(g);
    mesh(box(1.3, 0.85, 2.6), lam(0x7b5a3a), g, 0, 0.42, 0);
    const cols = [0xd9482b, 0xf0a92c, 0x7fae3a, 0xc7372f, 0xf2d14a, 0x8a3d6e];
    for (let i = 0; i < 6; i++) {
      const cx = -0.3 + (i % 2) * 0.6, cz = -0.9 + Math.floor(i / 2) * 0.9;
      mesh(box(0.52, 0.16, 0.74), lam(0x9a7a50), g, cx, 0.95, cz);
      const fm = lam(cols[i]);
      for (let k = 0; k < 9; k++) mesh(sph(0.085, 7, 5), fm, g, cx - 0.16 + (k % 3) * 0.16, 1.07 + (k > 5 ? 0.06 : 0), cz - 0.22 + Math.floor(k / 3) * 0.2).castShadow = false;
    }
    [[-0.6, -1.25], [0.6, -1.25], [-0.6, 1.25], [0.6, 1.25]].forEach(([x, z]) => mesh(cylG(0.03, 0.03, 2.5, 6), lam(0x333333), g, x, 1.25, z));
    const can = mesh(box(1.9, 0.05, 3.0), lam(0xffffff, { map: stripes('#d6452f', '#f4efe2') }), g, -0.15, 2.52, 0);
    can.rotation.z = -0.12;
    const v = person({ shirt: 0x8a3b2e, pants: 0x3a3a3a, hair: 0x5a5a5a, skin: 0xc98f6b }).stand();
    v.group.position.set(5.75, 0.14, -8.2); v.group.rotation.y = -Math.PI / 2 - 0.2;
    v.arms[0].up.rotation.x = -0.9; v.arms[0].fo.rotation.x = -0.6;
    scene.add(v.group);
    addSubject('vendor', 'Fruit vendor', v);
  })();
  // Two friends at a café table.
  (function () {
    const g = new THREE.Group(); g.position.set(-4.6, 0.14, -3.2); scene.add(g);
    const steel = lam(0x8f9499);
    mesh(cylG(0.4, 0.4, 0.04, 16), lam(0xe9e4d8), g, 0, 0.74, 0);
    mesh(cylG(0.04, 0.04, 0.72, 6), steel, g, 0, 0.37, 0);
    mesh(cylG(0.035, 0.03, 0.09, 8), lam(0xffffff), g, 0.12, 0.8, 0.05);
    mesh(cylG(0.035, 0.03, 0.09, 8), lam(0xffffff), g, -0.14, 0.8, -0.06);
    [[-1, 0xb8563a, 0x2a2a30, 0x3a2414, true], [1, 0x3f6b8a, 0x4a4032, 0x1a1a1a, false]].forEach(([s, shirt, pants, hair, long]) => {
      mesh(box(0.42, 0.04, 0.42), steel, g, 0, 0.46, s * 0.72);
      mesh(box(0.42, 0.45, 0.04), steel, g, 0, 0.7, s * 0.93);
      const p = person({ shirt, pants, hair, longHair: long, h: 1.68 }).sit();
      p.group.position.set(0, 0, s * 0.74); p.group.rotation.y = s > 0 ? Math.PI : 0;
      p.arms[0].up.rotation.x = -0.7; p.arms[0].fo.rotation.x = -1.2;
      g.add(p.group);
      addSubject('cafe' + s, 'Friend at the café', p);
    });
  })();
  // A red post box and a bin: clutter to keep out of frames.
  mesh(cylG(0.24, 0.24, 1.15, 12), lam(0xb1281f), scene, 3.6, 0.71, -3);
  mesh(cylG(0.26, 0.2, 0.1, 12), lam(0x8e1f18), scene, 3.6, 1.33, -3);
  mesh(cylG(0.22, 0.26, 0.8, 10), lam(0x3e4a44), scene, -3.5, 0.54, -9.5);

  // The arch at the end of the street, framing the plaza beyond.
  (function () {
    const s = new THREE.Shape();
    s.moveTo(-7.5, 0); s.lineTo(7.5, 0); s.lineTo(7.5, 10.5); s.lineTo(-7.5, 10.5); s.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-3.4, 0); hole.lineTo(-3.4, 4.4); hole.absarc(0, 4.4, 3.4, Math.PI, 0, true); hole.lineTo(3.4, 0); hole.closePath();
    s.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 1.8, bevelEnabled: false, curveSegments: 20 });
    mesh(geo, lam(0xcbbfa6), scene, 0, 0, -43.4);
    mesh(box(15.6, 0.5, 2.2), lam(0xb3a78f), scene, 0, 10.75, -42.5);
  })();

  // Walkers and a cyclist.
  const walkerA = person({ shirt: 0xd8b23a, pants: 0x2a3550, hair: 0x1c1410, longHair: true, skin: 0xe0b08a });
  scene.add(walkerA.group); addSubject('walkerA', 'Woman in yellow', walkerA);
  loop(walkerA, V(4.2, 0.14, -38), V(4.2, 0.14, 16), 1.4, 0.55);
  const walkerB = person({ shirt: 0x9a3434, pants: 0x38383c, hair: 0x4a3524, hat: 0x2b2b2b });
  scene.add(walkerB.group); addSubject('walkerB', 'Man in the red jacket', walkerB);
  patrol(walkerB, V(-5.2, 0.02, -12), V(5.2, 0.02, -12), 1.3, 0.2);
  const walkerC = person({ shirt: 0x4a6a54, pants: 0x5a4a3a, hair: 0xb9b2a4, h: 1.64 });
  scene.add(walkerC.group); addSubject('walkerC', 'Older man', walkerC);
  loop(walkerC, V(-4.2, 0.14, 14), V(-4.2, 0.14, -38), 1.05, 0.3);

  const jogger = person({ shirt: 0x2f9a8a, pants: 0x20242c, hair: 0x3a2a1a, sleeves: false, h: 1.76 });
  scene.add(jogger.group); addSubject('jogger', 'Jogger', jogger);
  patrol(jogger, V(-3.75, 0.14, 12), V(-3.75, 0.14, -36), 3.2, 0.45, true);

  (function () {     // the cyclist
    const g = new THREE.Group(); scene.add(g);
    const frame = lam(0x1f5f8a), tyre = lam(0x18181a);
    const wheels = [0.52, -0.52].map((z) => { const w = mesh(new THREE.TorusGeometry(0.33, 0.028, 6, 20), tyre, g, 0, 0.36, z); w.rotation.y = Math.PI / 2; return w; });
    const tube = (a, b) => { const d = b.clone().sub(a), m = mesh(cylG(0.022, 0.022, d.length(), 6), frame, g); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); };
    const bb = V(0, 0.34, -0.05), seat = V(0, 0.92, -0.25), headT = V(0, 0.95, 0.38), rear = V(0, 0.36, -0.52), front = V(0, 0.36, 0.52);
    tube(bb, seat); tube(bb, headT); tube(seat, headT); tube(seat, rear); tube(bb, rear); tube(headT, front);
    mesh(box(0.46, 0.03, 0.03), tyre, g, 0, 1.0, 0.38);
    mesh(box(0.14, 0.04, 0.26), tyre, g, 0, 0.95, -0.27);
    const r = person({ shirt: 0xe07a2e, pants: 0x23262b, hair: 0x2a1c14, hat: 0xdedad0 });
    r.pelvis.position.y = 0.98; r.group.position.z = -0.25;
    r.torso.rotation.x = 0.55; r.head.rotation.x = -0.45;
    r.arms.forEach((a) => { a.up.rotation.x = -0.75; a.fo.rotation.x = -0.25; });
    g.add(r.group);
    addSubject('cyclist', 'Cyclist', r, 'bike').obj = g;
    const a = V(-1.3, 0, -40), len = 58;
    movers.push({
      update(t) {
        const s = (t * 5.5 + 12) % len;
        g.position.set(a.x, 0, a.z + s);
        wheels.forEach((w) => { w.rotation.x = s / 0.33; });
        r.legs.forEach((l, i) => { const ph = s / 0.33 * 0.45 + i * Math.PI; l.th.rotation.x = -1.05 + 0.4 * Math.sin(ph); l.sh.rotation.x = 1.15 + 0.4 * Math.cos(ph); });
      },
    });
  })();

  /* ================= the plaza ================= */
  mesh(new THREE.PlaneGeometry(60, 54), lam(0xffffff, { map: pave(30, 27) }), scene, 0, 0.005, -70).rotation.x = -Math.PI / 2;
  // Fountain.
  (function () {
    const stone = lam(0xc9c1b0);
    mesh(cylG(3.3, 3.3, 0.6, 28), stone, scene, 0, 0.3, -60);
    const water = mesh(cylG(3.0, 3.0, 0.05, 28), new THREE.MeshLambertMaterial({ color: 0x4f8fb0, emissive: 0x123040 }), scene, 0, 0.56, -60);
    water.castShadow = false;
    mesh(cylG(0.5, 0.35, 1.9, 12), stone, scene, 0, 1.3, -60);
    mesh(cylG(0.4, 1.3, 0.3, 16), stone, scene, 0, 2.3, -60);
    mesh(sph(0.3, 10, 8), stone, scene, 0, 2.75, -60);
  })();
  // Clock tower.
  (function () {
    const t = tex(256, 1024, (g, w, h) => {
      g.fillStyle = '#cdbb98'; g.fillRect(0, 0, w, h); noise(g, w, h, 1200, 0.05);
      g.strokeStyle = 'rgba(80,60,40,0.28)'; g.lineWidth = 2;
      for (let y = 0; y < h; y += 26) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.fillStyle = '#efe8d6'; g.beginPath(); g.arc(w / 2, 150, 78, 0, 7); g.fill();
      g.strokeStyle = '#2a241c'; g.lineWidth = 7; g.stroke();
      g.lineWidth = 8; g.beginPath(); g.moveTo(w / 2, 150); g.lineTo(w / 2 + 34, 118); g.moveTo(w / 2, 150); g.lineTo(w / 2 - 10, 92); g.stroke();
      g.fillStyle = '#2f2a26';
      [330, 520, 710].forEach((y) => { g.beginPath(); g.moveTo(w / 2 - 22, y + 90); g.lineTo(w / 2 - 22, y + 20); g.arc(w / 2, y + 20, 22, Math.PI, 0); g.lineTo(w / 2 + 22, y + 90); g.fill(); });
      g.beginPath(); g.moveTo(w / 2 - 44, h); g.lineTo(w / 2 - 44, h - 110); g.arc(w / 2, h - 110, 44, Math.PI, 0); g.lineTo(w / 2 + 44, h); g.fill();
    });
    const m = lam(0xffffff, { map: t });
    mesh(box(5.4, 27, 5.4), m, scene, 0, 13.5, -86);
    mesh(box(6.2, 0.7, 6.2), lam(0xb9a987), scene, 0, 27.3, -86);
    const roof = mesh(new THREE.ConeGeometry(4.3, 7, 4), lam(0x8a4a38), scene, 0, 31.1, -86);
    roof.rotation.y = Math.PI / 4;
  })();
  // Buildings round the square, with arcades.
  building(-45, -30, -96, -44.5, 11, '+x', { shop: true, sign: '#5a3d2a', wall: '#dccdb0' });
  building(-30, -4.5, -104, -96, 12.5, '+z', { wall: '#d3bfa0', shutters: '#55705f' });
  building(4.5, 30, -104, -96, 14, '+z', { wall: '#c9a586', shop: true, sign: '#274a66' });
  [[-16, -52], [-16, -64], [-16, -76], [16, -52], [16, -64], [16, -76], [-16, -88], [16, -88]].forEach(([x, z]) => tree(x, z, 1.15));
  [[-10, -50], [10, -50], [-10, -72], [10, -72]].forEach(([x, z]) => lampPost(x, z));
  lampLight(0, 4.4, -52, 1.4); lampLight(0, 5, -70, 1.4);
  [[-9, -60, 0], [9, -60, Math.PI]].forEach(([x, z, r]) => {       // benches
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = r + Math.PI / 2; scene.add(g);
    mesh(box(1.8, 0.07, 0.45), lam(0x6f4f32), g, 0, 0.45, 0); mesh(box(1.8, 0.4, 0.06), lam(0x6f4f32), g, 0, 0.75, -0.22);
    [-0.8, 0.8].forEach((bx) => mesh(box(0.07, 0.45, 0.42), lam(0x2a2a2a), g, bx, 0.22, 0));
  });
  // People in the square: two tourists and passers-by.
  const tourist = person({ shirt: 0x4f8f8a, pants: 0xc9b998, hair: 0x6a4a2a, sleeves: false, hat: 0xe8dcc0 }).stand();
  tourist.group.position.set(-2.6, 0, -52.5); tourist.group.rotation.y = Math.PI * 0.9;
  tourist.arms.forEach((a) => { a.up.rotation.x = -1.1; a.fo.rotation.x = -1.3; });
  scene.add(tourist.group); addSubject('tourist', 'Tourist taking a picture', tourist);
  const sitter = person({ shirt: 0xb24a6a, pants: 0x3a4a6a, hair: 0x241810, longHair: true }).sit();
  sitter.group.position.set(2.3, 0.12, -57.3); sitter.group.rotation.y = 0.5;
  scene.add(sitter.group); addSubject('sitter', 'Woman on the fountain edge', sitter);
  const walkerD = person({ shirt: 0x3a4f7a, pants: 0x2a2a2e, hair: 0x1c1410 });
  scene.add(walkerD.group); addSubject('walkerD', 'Man crossing the square', walkerD);
  patrol(walkerD, V(-13, 0, -50), V(13, 0, -50), 1.35, 0.6);
  const walkerE = person({ shirt: 0xe5e0d4, pants: 0x6a3a3a, hair: 0x7a5a3a, longHair: true, h: 1.66, skirt: 0x6a3a3a });
  scene.add(walkerE.group); addSubject('walkerE', 'Woman in white', walkerE);
  patrol(walkerE, V(7, 0, -47), V(7, 0, -80), 1.2, 0.1);

  /* ================= the park ================= */
  const park = mesh(new THREE.PlaneGeometry(46, 52), lam(0xffffff, { map: grass }), scene, 53, 0.01, -69);
  park.rotation.x = -Math.PI / 2;
  const path = mesh(new THREE.PlaneGeometry(2.4, 52), lam(0xcdb892), scene, 37.5, 0.02, -69);
  path.rotation.x = -Math.PI / 2;
  for (let z = -46; z > -94; z -= 2.2) mesh(box(0.9, 1.0, 2.0), lam(0x4a6a3a, { flatShading: true }), scene, 30.6, 0.5, z);   // hedge
  [[49, -52, 1.3], [56, -60, 1.5], [52, -70, 1.2], [60, -74, 1.6], [47, -80, 1.3], [66, -56, 1.4], [70, -68, 1.5], [58, -86, 1.4], [44, -90, 1.2], [68, -84, 1.3], [63, -48, 1.2], [74, -78, 1.4]].forEach(([x, z, s]) => tree(x, z, s));
  // Flower bed in the foreground, for layers.
  (function () {
    const cols = [0xe0475a, 0xf2c23a, 0xf4f0e6, 0xb65ad0, 0xf08a3a].map((c) => lam(c)), leaf = lam(0x3f7a3a);
    for (let i = 0; i < 130; i++) {
      const x = 38.9 + rnd() * 1.8, z = -66.4 - rnd() * 3.6, h = 0.25 + rnd() * 0.3;
      mesh(cylG(0.01, 0.01, h, 4), leaf, scene, x, h / 2, z).castShadow = false;
      mesh(sph(0.035 + rnd() * 0.03, 6, 5), pick(cols), scene, x, h + 0.02, z).castShadow = false;
    }
  })();
  // The pole and bin that grow out of heads if you stand in the wrong place.
  lampPost(41.6, -62.3);
  mesh(cylG(0.22, 0.26, 0.8, 10), lam(0x3e4a44), scene, 42.4, 0.4, -61.2);
  (function () {       // a bench
    const g = new THREE.Group(); g.position.set(40.4, 0, -55.5); g.rotation.y = -0.4; scene.add(g);
    mesh(box(1.8, 0.07, 0.45), lam(0x6f4f32), g, 0, 0.45, 0); mesh(box(1.8, 0.4, 0.06), lam(0x6f4f32), g, 0, 0.75, -0.22);
    [-0.8, 0.8].forEach((bx) => mesh(box(0.07, 0.45, 0.42), lam(0x2a2a2a), g, bx, 0.22, 0));
  })();
  // Your friend. Turns to face the camera, as friends do.
  const friend = person({ shirt: 0xc45a3a, pants: 0x34425a, hair: 0x2f1d12, longHair: true, skin: 0xdba27a, h: 1.68 }).stand();
  friend.group.position.set(39.4, 0.02, -62);
  friend.arms[1].up.rotation.z = 0.25; friend.arms[1].fo.rotation.z = -0.9; friend.arms[1].fo.rotation.x = -0.5;
  scene.add(friend.group);
  const friendS = addSubject('friend', 'Your friend', friend);
  // A dog, flat out round the trees.
  (function () {
    const g = new THREE.Group(); scene.add(g);
    const fur = lam(0xb8834a), dark = lam(0x5a3a1e);
    mesh(box(0.26, 0.26, 0.7), fur, g, 0, 0.42, 0);
    const head = new THREE.Group(); head.position.set(0, 0.6, 0.42); g.add(head);
    mesh(box(0.22, 0.22, 0.26), fur, head); mesh(box(0.12, 0.1, 0.16), dark, head, 0, -0.04, 0.18);
    [-1, 1].forEach((s) => mesh(box(0.05, 0.14, 0.08), dark, head, s * 0.1, 0.12, -0.06));
    const tail = mesh(box(0.05, 0.05, 0.3), fur, g, 0, 0.56, -0.46); tail.rotation.x = 0.7;
    const legs = [[-0.09, 0.26], [0.09, 0.26], [-0.09, -0.26], [0.09, -0.26]].map(([x, z]) => {
      const l = new THREE.Group(); l.position.set(x, 0.32, z); g.add(l); mesh(box(0.07, 0.32, 0.07), fur, l, 0, -0.16, 0); return l;
    });
    const s = { id: 'dog', name: 'Dog', kind: 'animal', obj: g, head, pos: V(0, 0, 0), vel: V(0, 0, 0) };
    subjects.push(s);
    movers.push({
      update(t) {
        const a = t * 7.5 / 6.5;
        g.position.set(50 + Math.cos(a) * 6.5, 0, -63 + Math.sin(a) * 4.2);
        g.rotation.y = Math.atan2(-Math.sin(a) * 6.5, Math.cos(a) * 4.2);
        legs.forEach((l, i) => { l.rotation.x = 0.9 * Math.sin(t * 16 + (i < 2 ? 0 : Math.PI)); });
        g.position.y = 0.05 * Math.abs(Math.sin(t * 16));
      },
    });
  })();

  /* ================= the room ================= */
  const room = new THREE.Group(); room.position.set(200, 0, 0); scene.add(room);
  const roomLights = {};
  (function () {
    const wall = lam(0xe6ddcc), trim = lam(0xf4f0e8);
    const floor = mesh(new THREE.PlaneGeometry(7, 6), lam(0xffffff, { map: wood }), room, 0, 0.01, 0); floor.rotation.x = -Math.PI / 2;
    mesh(box(7.3, 0.15, 6.3), lam(0x9a9a9a), room, 0, -0.08, 0);
    mesh(box(7.3, 0.15, 6.3), trim, room, 0, 2.78, 0);
    mesh(box(0.15, 2.8, 6.3), wall, room, -3.57, 1.4, 0);
    mesh(box(0.15, 2.8, 6.3), wall, room, 3.57, 1.4, 0);
    mesh(box(7.3, 2.8, 0.15), wall, room, 0, 1.4, 3.07);
    // Far wall with a window in it: four pieces round the opening.
    mesh(box(7.3, 0.9, 0.15), wall, room, 0, 0.45, -3.07);
    mesh(box(7.3, 0.4, 0.15), wall, room, 0, 2.6, -3.07);
    mesh(box(2.0, 1.5, 0.15), wall, room, -2.65, 1.65, -3.07);
    mesh(box(2.9, 1.5, 0.15), wall, room, 2.2, 1.65, -3.07);
    const pane = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    roomLights.pane = pane;
    mesh(new THREE.PlaneGeometry(2.4, 1.5), pane, room, -0.45, 1.65, -3.1).castShadow = false;
    mesh(box(0.05, 1.5, 0.06), trim, room, -0.45, 1.65, -3.02); mesh(box(2.4, 0.05, 0.06), trim, room, -0.45, 1.65, -3.02);
    mesh(box(2.6, 0.08, 0.3), trim, room, -0.45, 0.88, -2.92);
    [-1.85, 0.95].forEach((x) => mesh(box(0.45, 1.9, 0.08), lam(0x7a8fa6), room, x, 1.6, -2.93));
    // Table, cake, chairs and two adults.
    const oak = lam(0x8a6238);
    mesh(box(1.9, 0.06, 0.95), oak, room, 0.2, 0.75, -0.7);
    [[-0.8, -0.38], [0.8, -0.38], [-0.8, 0.38], [0.8, 0.38]].forEach(([x, z]) => mesh(box(0.07, 0.74, 0.07), oak, room, 0.2 + x, 0.37, -0.7 + z));
    mesh(cylG(0.17, 0.17, 0.12, 16), lam(0xf4e9da), room, 0.2, 0.84, -0.7);
    mesh(cylG(0.175, 0.175, 0.03, 16), lam(0xd9667a), room, 0.2, 0.915, -0.7);
    const flame = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    roomLights.flame = flame;
    for (let i = 0; i < 5; i++) { const a = i * 1.257; mesh(cylG(0.006, 0.006, 0.07, 5), lam(0xf2f2f2), room, 0.2 + Math.cos(a) * 0.1, 0.96, -0.7 + Math.sin(a) * 0.1); mesh(sph(0.014, 6, 5), flame, room, 0.2 + Math.cos(a) * 0.1, 1.01, -0.7 + Math.sin(a) * 0.1).castShadow = false; }
    [[-0.6, 0xf2f2f2], [0.5, 0xdfe8f0], [0.95, 0xf2f2f2]].forEach(([x, c]) => mesh(cylG(0.11, 0.11, 0.015, 14), lam(c), room, 0.2 + x, 0.79, -0.55));
    const chair = (x, z, r) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = r; room.add(g); mesh(box(0.44, 0.05, 0.44), oak, g, 0, 0.46, 0); mesh(box(0.44, 0.5, 0.05), oak, g, 0, 0.72, -0.2); [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].forEach(([a, b]) => mesh(box(0.04, 0.46, 0.04), oak, g, a, 0.23, b)); return g; };
    chair(-0.35, -1.5, 0); chair(0.8, -1.5, 0); chair(1.45, -0.7, -Math.PI / 2);
    const mum = person({ shirt: 0x4a7a6a, pants: 0x2a2a34, hair: 0x4a2c1a, longHair: true, h: 1.66 }).sit();
    mum.group.position.set(-0.35, 0, -1.42); room.add(mum.group);
    mum.arms.forEach((a) => { a.up.rotation.x = -0.9; a.fo.rotation.x = -0.9; });
    addSubject('mum', 'Mum at the table', mum);
    const grandad = person({ shirt: 0x7a6a8a, pants: 0x4a4438, hair: 0xd0ccc4, h: 1.74, skin: 0xd2a084 }).sit();
    grandad.group.position.set(0.8, 0, -1.42); room.add(grandad.group);
    grandad.arms[0].up.rotation.x = -0.8; grandad.arms[0].fo.rotation.x = -1.0;
    addSubject('grandad', 'Grandad at the table', grandad);
    // Sofa, rug, shelf, pictures, floor lamp.
    const sofa = lam(0x5a7088);
    mesh(box(0.9, 0.42, 2.1), sofa, room, -2.95, 0.3, 1.2); mesh(box(0.25, 0.75, 2.1), sofa, room, -3.3, 0.55, 1.2);
    [0.2, 2.2].forEach((z) => mesh(box(0.9, 0.6, 0.22), sofa, room, -2.95, 0.4, z));
    mesh(box(0.5, 0.36, 0.5), lam(0xd9a93a), room, -2.9, 0.68, 0.7).rotation.y = 0.4;
    const rug = mesh(new THREE.PlaneGeometry(2.6, 1.8), lam(0x9a4a3a), room, -0.9, 0.02, 1.4); rug.rotation.x = -Math.PI / 2;
    const books = tex(256, 256, (g, w, h) => { g.fillStyle = '#5a4028'; g.fillRect(0, 0, w, h); for (let r = 0; r < 4; r++) { let x = 6; while (x < w - 12) { const bw = 8 + rnd() * 14; g.fillStyle = pick(['#a83a32', '#2f5d7a', '#d9b24a', '#3d6b4a', '#e8dfc8', '#6a4a7a', '#c96a3a']); g.fillRect(x, r * 64 + 10 + rnd() * 8, bw, 50); x += bw + 1; } } });
    mesh(box(0.35, 2.0, 1.8), [lam(0x5a4028), lam(0xffffff, { map: books }), lam(0x5a4028), lam(0x5a4028), lam(0x5a4028), lam(0x5a4028)], room, 3.3, 1.0, 0.6);
    [[1.6, 1.7, 0xc98a5a], [2.6, 1.55, 0x5a8a9a]].forEach(([x, y, c]) => { mesh(box(0.62, 0.48, 0.03), lam(0x2a2420), room, x, y, -2.98); mesh(box(0.5, 0.36, 0.035), lam(c), room, x, y, -2.975); });
    mesh(cylG(0.02, 0.02, 1.5, 6), lam(0x2a2a2a), room, -3.0, 0.75, -2.3);
    const shade = new THREE.MeshLambertMaterial({ color: 0xf2e2c0, emissive: 0xffc27a, emissiveIntensity: 0 });
    roomLights.shade = shade;
    mesh(cylG(0.24, 0.15, 0.3, 14), shade, room, -3.0, 1.6, -2.3).castShadow = false;
    mesh(cylG(0.2, 0.2, 0.03, 10), lam(0x2a2a2a), room, -3.0, 0.02, -2.3);

    roomLights.window = new THREE.PointLight(0xdfeaff, 0, 14, 1.6); roomLights.window.position.set(-0.45, 1.8, -2.3);
    roomLights.ceiling = new THREE.PointLight(0xffc98a, 0, 12, 1.8); roomLights.ceiling.position.set(0.3, 2.45, -0.4);
    roomLights.floor = new THREE.PointLight(0xffb870, 0, 8, 2); roomLights.floor.position.set(-2.8, 1.5, -2.1);
    // Daylight bounced back off the wall behind the photographer: without it,
    // people facing away from the window would be far darker than in a real room.
    roomLights.bounce = new THREE.PointLight(0xf3efe6, 0, 10, 2); roomLights.bounce.position.set(0.3, 1.7, 2.6);
    // Lights stay in the scene at zero when unused: a constant light count means
    // changing the light never forces the shaders to recompile.
    [roomLights.window, roomLights.ceiling, roomLights.floor, roomLights.bounce].forEach((l) => room.add(l));
    mesh(cylG(0.2, 0.3, 0.14, 14), lam(0xf4f0e8), room, 0.3, 2.64, -0.4).castShadow = false;
  })();
  // The birthday child, tearing up and down in front of the table.
  const kid = person({ shirt: 0xe04a5a, pants: 0x3a5a8a, hair: 0xd9b46a, h: 1.12, skin: 0xe6b894, sleeves: false });
  kid.head.scale.setScalar(1.28);
  scene.add(kid.group); addSubject('kid', 'The birthday kid', kid);
  patrol(kid, V(197.6, 0.01, 0.9), V(202.4, 0.01, 0.9), 2.6, 0.3, true);

  /* ================= light ================= */
  // ev: the EV (ISO 100) at which mid-grey in this light is correctly exposed.
  // illum: the colour of the dominant light, which white balance works against.
  const LIGHTS = [
    { id: 'sunny', name: 'Midday sun', where: 'out', ev: 15, sun: [3.1, 0xfff4e2], dir: [0.26, 0.8, 0.54], hemi: [1.15, 0xbfd6ff, 0x9c8f7c], sky: [0x2f6fc4, 0xbcd8f2], fog: 0xc3d8ee, disc: 60, illum: [1, 0.985, 0.95], glow: 0, cloud: 0xffffff },
    { id: 'overcast', name: 'Overcast', where: 'out', ev: 12.3, sun: [0.55, 0xffffff], dir: [0.3, 0.9, 0.3], hemi: [2.7, 0xe6ecf4, 0xb4b0a8], sky: [0xaab4c0, 0xd8dde2], fog: 0xd0d6dc, disc: 0, illum: [0.96, 0.985, 1.03], glow: 0, cloud: 0xc8ccd2, soft: true },
    { id: 'golden', name: 'Golden hour', where: 'out', ev: 12.6, sun: [2.9, 0xffb267], dir: [-0.08, 0.22, 0.97], hemi: [0.75, 0x9fb8e6, 0x8a7a66], sky: [0x4f78b4, 0xf5c690], fog: 0xe9c9a4, disc: 55, illum: [1, 0.8, 0.56], glow: 0, cloud: 0xffd9b0 },
    { id: 'dusk', name: 'Blue hour', where: 'out', ev: 6.5, sun: [0, 0xffffff], dir: [-0.8, 0.1, 0.5], hemi: [2.5, 0x8fa8e0, 0x56607a], sky: [0x1d2f5e, 0xc08a78], fog: 0x6a78a0, disc: 0, illum: [0.72, 0.84, 1.08], glow: 0.55, cloud: 0x7a84a8, soft: true },
    { id: 'night', name: 'Night street', where: 'out', ev: 4.3, sun: [0, 0xffffff], dir: [0.3, 0.8, 0.3], hemi: [0.3, 0x4a5a8a, 0x2a2a34], sky: [0x05070f, 0x141a2c], fog: 0x0c1020, disc: 0, illum: [1, 0.74, 0.46], glow: 1, cloud: 0x10141f, soft: true },
    { id: 'window', name: 'Window light', where: 'in', ev: 7.2, sun: [0, 0xffffff], dir: [0.3, 0.8, 0.3], hemi: [1.5, 0xe6ecf8, 0xb8a890], sky: [0x5f8fd0, 0xcfe0f2], fog: 0xcfe0f2, disc: 0, illum: [0.95, 0.985, 1.04], glow: 0, cloud: 0xffffff, room: { pane: 10, window: 16, ceiling: 0, floor: 0, shade: 0, bounce: 40 } },
    { id: 'evening', name: 'Evening lamps', where: 'in', ev: 5, sun: [0, 0xffffff], dir: [0.3, 0.8, 0.3], hemi: [0.22, 0xffd9b0, 0x6a5440], sky: [0x05070f, 0x141a2c], fog: 0x0c1020, disc: 0, illum: [1, 0.72, 0.42], glow: 1, cloud: 0x10141f, room: { pane: 0.05, window: 0, ceiling: 9, floor: 5, shade: 5 } },
  ];
  let light = LIGHTS[0];
  const sunDir = V(0, 1, 0);
  function setLight(id) {
    light = LIGHTS.find((l) => l.id === id) || LIGHTS[0];
    sun.intensity = light.sun[0]; sun.color.set(light.sun[1]);
    sunDir.set(light.dir[0], light.dir[1], light.dir[2]).normalize();
    hemi.intensity = light.hemi[0]; hemi.color.set(light.hemi[1]); hemi.groundColor.set(light.hemi[2]);
    paintSky(light.sky[0], light.sky[1]);
    scene.fog.color.set(light.fog);
    sunDisc.visible = light.disc > 0;
    sunDisc.material.color.set(light.sun[1]).multiplyScalar(light.disc);
    sunDisc.position.copy(sunDir).multiplyScalar(470);
    clouds.forEach((m) => m.color.set(light.cloud));
    glow.windows.forEach((m) => { m.emissiveIntensity = 2.6 * light.glow; });
    glow.lamps.forEach((m) => { m.emissiveIntensity = 7 * light.glow; });
    const outLamps = light.where === 'out' && light.glow > 0;
    glow.lampLights.forEach((l) => { l.intensity = outLamps ? 85 * light.glow * l.userData.k : 0; });
    const r = light.room || { pane: 1, window: 0, ceiling: 0, floor: 0, shade: 0 };
    roomLights.pane.color.setRGB(0.86 * r.pane, 0.93 * r.pane, 1.0 * r.pane);
    ['window', 'ceiling', 'floor', 'bounce'].forEach((k) => { roomLights[k].intensity = r[k] || 0; });
    roomLights.shade.emissiveIntensity = r.shade;
    roomLights.flame.color.setRGB(1, 0.8, 0.45).multiplyScalar(light.where === 'in' ? 6 : 1);
    return light;
  }

  /* ================= time ================= */
  const _h0 = V(0, 0, 0), _h1 = V(0, 0, 0);
  // Put everything where it is at world time t. `eye` is the camera position,
  // which the friend looks at and the sun's shadow box follows.
  function update(t, eye) {
    for (let i = 0; i < movers.length; i++) movers[i].update(t);
    if (eye) {
      const p = friend.group.position;
      friend.group.rotation.y = Math.atan2(eye.x - p.x, eye.z - p.z);
    }
  }
  function aimSun(target) {
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(sunDir, 120);
    sun.target.updateMatrixWorld();
  }
  // Head position and velocity of every subject at time t (velocity by
  // looking a twentieth of a second ahead).
  function measure(t, eye) {
    update(t + 0.05, eye);
    subjects.forEach((s) => { s.obj.updateWorldMatrix(true, true); headOf(s, s.vel); });
    update(t, eye);
    subjects.forEach((s) => { s.obj.updateWorldMatrix(true, true); headOf(s, s.pos); s.vel.sub(s.pos).multiplyScalar(20); });
    return subjects;
  }

  setLight('sunny');
  update(0, null);

  return { scene, sun, hemi, subjects, LIGHTS, setLight, update, measure, aimSun, get light() { return light; }, friend: friendS };
}

CS.buildWorld = buildWorld;
})(window.CameraSkills = window.CameraSkills || {});
