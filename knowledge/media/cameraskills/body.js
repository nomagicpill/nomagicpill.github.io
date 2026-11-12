/*
 * knowledge/cameraskills.html: the camera. A Fujifilm X-T30 III with the
 * XC 13-33mm kit lens, built from primitives (no model file), with every
 * control registered as a clickable part. Loaded by main.js after three.js.
 *
 * Units are centimetres. The lens points along +z, up is +y, and the grip
 * (the photographer's right hand) is on -x, so from in front the grip is on
 * the viewer's left, as it is on the real camera.
 *
 * buildBody(THREE) returns { group, parts, update(dt, time), select(id) }.
 * A part is { id, name, topic, view, anchor, normal, meshes, anim }: `topic`
 * is the drawer section that explains it, `view` the side to look from,
 * `anchor`/`normal` where its label sits and which way it faces.
 */
(function (CS) {
'use strict';

function buildBody(THREE) {
  const G = new THREE.Group();
  const parts = new Map();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  /* ---------- materials ---------- */
  const std = (color, metalness, roughness, extra) =>
    new THREE.MeshStandardMaterial(Object.assign({ color, metalness, roughness }, extra || {}));
  const M = {
    plate: std(0xcfd1d3, 0.92, 0.36),
    plateDark: std(0x9da0a4, 0.9, 0.42),
    skin: std(0x1b1b1d, 0.0, 0.93),
    black: std(0x151517, 0.25, 0.5),
    rubber: std(0x0d0d0e, 0.0, 0.96),
    glass: std(0x0b1222, 0.7, 0.06),
    red: std(0xb3261e, 0.1, 0.5),
    white: std(0xf2f2ee, 0.0, 0.6),
  };

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  // Vertical ridges for dial edges and lens rings.
  function ridges(light, dark, n) {
    const t = canvasTex(64, 8, (g, w, h) => {
      g.fillStyle = light; g.fillRect(0, 0, w, h);
      g.fillStyle = dark; g.fillRect(0, 0, w * 0.45, h);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(n, 1);
    return t;
  }

  // The engraved top of a dial: labels around the rim, tops toward the centre.
  function dialTop(labels, o) {
    o = o || {};
    return canvasTex(512, 512, (g, S) => {
      const c = S / 2;
      const grad = g.createRadialGradient(c, c, 20, c, c, c);
      grad.addColorStop(0, '#f1f1f0'); grad.addColorStop(0.85, '#dedfdf'); grad.addColorStop(1, '#b9bbbd');
      g.fillStyle = grad; g.beginPath(); g.arc(c, c, c, 0, 7); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.035)';
      for (let r = 14; r < c; r += 5) { g.beginPath(); g.arc(c, c, r, 0, 7); g.stroke(); }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const n = labels.length, span = o.span || Math.PI * 2;
      labels.forEach((lab, i) => {
        const a = (o.start || 0) + i * span / (o.span ? n - 1 : n);
        g.save();
        g.translate(c + Math.sin(a) * c * 0.76, c - Math.cos(a) * c * 0.76);
        g.rotate(a + Math.PI);
        const txt = typeof lab === 'string' ? lab : lab.t;
        g.fillStyle = (lab.c) || '#0b0b0b';
        g.font = 'bold ' + (o.font || 40) * (txt.length > 3 ? 0.66 : txt.length > 2 ? 0.84 : 1) + 'px Arial, Helvetica, sans-serif';
        g.fillText(txt, 0, 0);
        g.restore();
      });
      if (o.ticks) {
        g.strokeStyle = '#141414'; g.lineWidth = 3;
        for (let i = 0; i < o.ticks; i++) {
          const a = (o.start || 0) + i * span / (o.ticks - 1);
          const r0 = c * 0.93, r1 = c * (i % 3 === 0 ? 0.87 : 0.9);
          g.beginPath();
          g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0);
          g.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1);
          g.stroke();
        }
      }
    });
  }

  /* ---------- geometry helpers ---------- */
  function rrect(w, h, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
    s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    return s;
  }
  // A shape drawn in the x-z plane, extruded from y0 up to y1.
  function prism(shape, y0, y1, material, bevel) {
    const b = bevel || 0;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: y1 - y0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 10,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, y0 + b, 0);
    return new THREE.Mesh(geo, material);
  }
  // A rounded slab facing +z (or any way, once rotated): drawn in x-y, `d` thick.
  function slab(w, h, d, r, material, bevel) {
    const b = bevel === undefined ? Math.min(0.04, d / 4) : bevel;
    const geo = new THREE.ExtrudeGeometry(rrect(w, h, r), {
      depth: d - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 8,
    });
    geo.translate(0, 0, -d / 2 + b);
    return new THREE.Mesh(geo, material);
  }
  function cyl(r0, r1, h, material, axis, seg) {
    const geo = new THREE.CylinderGeometry(r1, r0, h, seg || 40);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    if (axis === 'x') geo.rotateZ(Math.PI / 2);
    return new THREE.Mesh(geo, material);
  }
  function at(obj, x, y, z, parent) { obj.position.set(x, y, z); (parent || G).add(obj); return obj; }

  function part(id, name, topic, view, anchor, normal, objs, anim) {
    const meshes = [];
    objs.forEach((o) => o.traverse((m) => {
      if (!m.isMesh) return;
      m.material = m.material.clone();
      m.userData.part = id;
      meshes.push(m);
    }));
    parts.set(id, { id, name, topic, view, anchor, normal: normal.clone().normalize(), meshes, anim, k: 0, objs });
  }

  /* ---------- the shell ---------- */
  const W = 11.84, TOP = 3.3, SHOULDER = 2.05, BELT = -2.85, BOT = -3.3, FRONT = 1.6, BACK = -1.6, MX = 0.5;
  const outline = rrect(W, 3.2, 0.72);
  G.add(prism(outline, BELT, SHOULDER, M.skin));
  G.add(prism(outline, SHOULDER, TOP, M.plate, 0.07));
  G.add(prism(outline, BOT, BELT, M.plate, 0.05));

  // Front grip and rear thumb rest.
  at(prism(rrect(1.75, 0.95, 0.42), BELT + 0.05, 1.75, M.skin, 0.08), -4.75, 0, FRONT + 0.22);
  at(prism(rrect(1.35, 0.5, 0.22), -0.55, 1.9, M.skin, 0.06), -5.05, 0, BACK - 0.12);

  // Strap lugs.
  [-1, 1].forEach((s) => at(cyl(0.16, 0.16, 0.3, M.plateDark, 'x'), s * (W / 2 + 0.08), 2.55, 0.55));

  /* ---------- viewfinder hump, flash, hot shoe ---------- */
  const humpShape = new THREE.Shape();
  humpShape.moveTo(-2.0, 0); humpShape.lineTo(2.0, 0); humpShape.lineTo(1.5, 1.3); humpShape.lineTo(-1.5, 1.3); humpShape.closePath();
  const humpGeo = new THREE.ExtrudeGeometry(humpShape, { depth: 3.2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 });
  humpGeo.translate(0, 0, -1.7);
  const hump = at(new THREE.Mesh(humpGeo, M.plate), MX, TOP - 0.02, 0);

  // The flash is the front half of the hump's roof; it hinges at its rear edge.
  const flashPivot = at(new THREE.Group(), MX, TOP + 1.3, -0.05);
  const flashLid = at(slab(2.9, 1.7, 0.36, 0.25, M.plate), 0, 0.18, 0.85, flashPivot);
  flashLid.rotation.x = -Math.PI / 2;
  const flashTube = at(slab(1.9, 0.5, 0.3, 0.1, M.white), 0, -0.2, 1.45, flashPivot);
  flashTube.visible = false;
  part('flash', 'Pop-up flash', 'cam-flash', 'front', V(MX, TOP + 1.75, 1.0), V(0, 0.6, 0.8), [flashLid, flashTube],
    (p, k) => { flashPivot.rotation.x = -0.95 * k; flashTube.visible = k > 0.05; });

  const shoe = at(new THREE.Group(), MX, TOP + 1.3 + 0.37, -0.85);
  at(slab(1.9, 1.5, 0.12, 0.08, M.plateDark), 0, 0, 0, shoe).rotation.x = -Math.PI / 2;
  [-1, 1].forEach((s) => at(slab(0.22, 1.5, 0.2, 0.04, M.plate), s * 0.84, 0.12, 0, shoe).rotation.x = -Math.PI / 2);
  part('hotShoe', 'Hot shoe', 'cam-flash', 'top', V(MX, TOP + 1.9, -0.85), V(0, 1, -0.2), [shoe]);

  /* ---------- top dials ---------- */
  function dial(r, h, tex, edgeRepeat) {
    const g = new THREE.Group();
    const edge = std(0xffffff, 0.9, 0.4, { map: ridges('#d6d8da', '#8e9195', edgeRepeat || 46) });
    at(cyl(r, r, h, edge, 'y', 64), 0, h / 2, 0, g);
    at(cyl(r, r * 0.95, 0.07, M.plate, 'y', 64), 0, h + 0.035, 0, g);
    const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 64), std(0xffffff, 0.15, 0.62, { map: tex }));
    face.rotation.x = -Math.PI / 2;
    at(face, 0, h + 0.072, 0, g);
    return g;
  }
  // The white index line a dial is read against, on the plate behind it.
  function indexMark(x, z) { at(slab(0.06, 0.28, 0.02, 0.01, M.white, 0), x, TOP + 0.012, z).rotation.x = -Math.PI / 2; }
  const wiggle = (obj, amount) => (p, k, t) => { obj.rotation.y = (obj.userData.rest || 0) + k * amount * Math.sin(t * 2.2); };

  // Film simulation dial, on the photographer's left shoulder.
  const FILM = ['STD', 'V', 'S', 'CC', 'RA', 'A', 'FS1', 'FS2', 'FS3', 'C'];
  const filmDial = at(dial(1.1, 0.72, dialTop(FILM, { font: 54 })), 4.15, TOP, -0.1);
  indexMark(4.15, -1.36);
  part('filmDial', 'Film simulation dial', 'cam-filmdial', 'top', V(4.15, TOP + 0.9, -0.1), V(0.2, 1, 0), [filmDial], wiggle(filmDial, 0.7));

  const flashLever = at(slab(0.5, 0.2, 0.16, 0.06, M.plateDark), 4.15, TOP + 0.1, 1.2);
  part('flashLever', 'Flash pop-up lever', 'cam-flash', 'top', V(4.15, TOP + 0.25, 1.35), V(0.2, 0.7, 0.7), [flashLever],
    (p, k, t) => { flashLever.position.x = 4.15 + 0.18 * k * Math.sin(t * 3); });

  // Shutter speed dial, right of the hump.
  const SPEEDS = [{ t: 'A', c: '#b3261e' }, '4000', '2000', '1000', '500', '250', { t: '180x', c: '#b3261e' }, '125', '60', '30', '15', '8', '4', '2', '1', 'T', 'B'];
  const shutterDial = at(dial(1.05, 0.8, dialTop(SPEEDS, { font: 46 }), 44), -2.72, TOP, -0.15);
  indexMark(-2.72, -1.36);
  part('shutterDial', 'Shutter speed dial', 'cam-shutterdial', 'top', V(-2.72, TOP + 1.0, -0.15), V(-0.1, 1, 0), [shutterDial], wiggle(shutterDial, 0.8));

  const autoLever = at(new THREE.Group(), -2.72, TOP + 0.02, -0.15);
  at(slab(0.34, 0.5, 0.14, 0.06, M.plateDark), 0, 0.07, 1.25, autoLever).rotation.x = -Math.PI / 2;
  autoLever.userData.rest = 0.25;
  autoLever.rotation.y = 0.25;
  part('autoLever', 'Auto mode selector lever', 'cam-modes', 'top', V(-2.4, TOP + 0.3, 1.2), V(-0.1, 0.8, 0.6), [autoLever],
    (p, k, t) => { autoLever.rotation.y = 0.25 - k * 0.25 * (1 + Math.sin(t * 2.4)); });

  // Shutter button inside the ON/OFF collar.
  const power = at(new THREE.Group(), -4.5, TOP, 0.85);
  at(cyl(0.62, 0.6, 0.22, std(0xffffff, 0.9, 0.4, { map: ridges('#d6d8da', '#96999d', 26) }), 'y'), 0, 0.11, 0, power);
  at(slab(0.22, 0.36, 0.12, 0.05, M.plateDark), 0, 0.1, 0.72, power).rotation.x = -Math.PI / 2;
  part('power', 'ON/OFF switch', 'cam-shutter', 'top', V(-4.5, TOP + 0.3, 1.5), V(-0.2, 0.7, 0.7), [power],
    (p, k, t) => { power.rotation.y = -0.35 * k * (1 + Math.sin(t * 2.4)); });
  const shutterBtn = at(new THREE.Group(), -4.5, TOP + 0.22, 0.85);
  at(cyl(0.38, 0.36, 0.2, M.plate, 'y'), 0, 0.1, 0, shutterBtn);
  at(cyl(0.2, 0.2, 0.03, M.plateDark, 'y'), 0, 0.21, 0, shutterBtn);
  part('shutterBtn', 'Shutter button', 'cam-shutter', 'top', V(-4.5, TOP + 0.7, 0.85), V(-0.2, 1, 0.2), [shutterBtn],
    (p, k, t) => { shutterBtn.position.y = TOP + 0.22 - 0.1 * k * Math.max(0, Math.sin(t * 3)); });

  const fnBtn = at(cyl(0.2, 0.19, 0.12, M.plateDark, 'y'), -5.3, TOP + 0.06, -0.05);
  part('fnBtn', 'Fn button', 'cam-q', 'top', V(-5.3, TOP + 0.35, -0.05), V(-0.4, 1, 0), [fnBtn]);

  // Exposure compensation dial, overhanging the rear right corner.
  const EC = ['+3', '+2', '+1', '0', '−1', '−2', '−3'];
  const expDial = at(dial(0.86, 0.62, dialTop(EC.concat([{ t: 'C', c: '#b3261e' }]), { font: 56, start: -2.2, span: 4.9, ticks: 19 }), 38), -4.72, TOP, -0.98);
  expDial.userData.rest = -2.2 + 3 * 4.9 / 7 - Math.PI / 2;      // rest with 0 against the mark
  expDial.rotation.y = expDial.userData.rest;
  indexMark(-3.72, -1.2);
  part('expDial', 'Exposure compensation dial', 'cam-expcomp', 'top', V(-4.72, TOP + 0.85, -0.98), V(-0.3, 1, -0.3), [expDial], wiggle(expDial, 0.6));

  /* ---------- command dials ---------- */
  function wheel() { return cyl(0.5, 0.5, 0.34, std(0xffffff, 0.3, 0.6, { map: ridges('#3a3a3d', '#0e0e10', 30) }), 'y', 40); }
  const frontDial = at(wheel(), -4.3, 2.45, FRONT + 0.12);
  part('frontDial', 'Front command dial', 'cam-dials', 'front', V(-4.3, 2.45, FRONT + 0.7), V(-0.2, 0.2, 1), [frontDial], wiggle(frontDial, 1.2));
  const rearDial = at(wheel(), -3.95, 2.5, BACK - 0.1);
  part('rearDial', 'Rear command dial', 'cam-dials', 'back', V(-3.95, 2.5, BACK - 0.7), V(0, 0.2, -1), [rearDial], wiggle(rearDial, 1.2));

  /* ---------- lens ---------- */
  const lens = at(new THREE.Group(), MX, -0.2, FRONT);
  at(cyl(2.5, 2.5, 0.24, M.plate, 'z', 64), 0, 0, 0.1, lens);
  at(cyl(2.9, 3.0, 0.7, M.black, 'z', 64), 0, 0, 0.57, lens);
  const zoomRing = at(cyl(3.1, 3.1, 1.5, std(0xffffff, 0.0, 0.9, { map: ridges('#232325', '#0a0a0b', 70) }), 'z', 64), 0, 0, 1.67, lens);
  const focusRing = at(cyl(3.03, 3.03, 0.46, std(0xffffff, 0.0, 0.85, { map: ridges('#1d1d1f', '#0a0a0b', 150) }), 'z', 64), 0, 0, 2.66, lens);
  at(cyl(2.95, 2.9, 0.16, M.black, 'z', 64), 0, 0, 2.97, lens);
  const inner = at(new THREE.Group(), 0, 0, 3.05, lens);
  const tube = at(cyl(2.5, 2.5, 2.0, M.black, 'z', 64), 0, 0, -0.2, inner);
  at(cyl(2.55, 2.5, 0.22, M.black, 'z', 64), 0, 0, 0.9, inner);
  const ringTex = canvasTex(512, 512, (g, S) => {
    g.fillStyle = '#0c0c0d'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#d8d8d4'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '21px Arial, Helvetica, sans-serif';
    const text = 'XC 13-33mm  1:3.5-6.3  OIS      ø49      ASPHERICAL LENS      ';
    for (let i = 0; i < text.length; i++) {
      const a = -2.0 + i * 0.105;
      g.save(); g.translate(S / 2 + Math.sin(a) * S * 0.41, S / 2 - Math.cos(a) * S * 0.41); g.rotate(a); g.fillText(text[i], 0, 0); g.restore();
    }
  });
  const nameRing = new THREE.Mesh(new THREE.RingGeometry(1.62, 2.42, 64), std(0xffffff, 0.1, 0.6, { map: ringTex }));
  at(nameRing, 0, 0, 1.012, inner);
  const glass = at(new THREE.Mesh(new THREE.SphereGeometry(3.2, 40, 16, 0, Math.PI * 2, 0, 0.53), M.glass), 0, 0, 0.99 - 2.76, inner);
  glass.rotation.x = Math.PI / 2;
  part('zoomRing', 'Zoom ring', 'cam-lens', 'front', V(MX + 2.2, 2.0, FRONT + 1.7), V(0.5, 0.6, 0.6), [zoomRing, inner],
    (p, k, t) => { zoomRing.rotation.z = 0.5 * k * Math.sin(t * 1.6); inner.position.z = 3.05 - 0.35 * k * (1 + Math.sin(t * 1.6)); });
  part('focusRing', 'Focus ring', 'cam-lens', 'front', V(MX - 2.2, 2.0, FRONT + 2.7), V(-0.5, 0.6, 0.6), [focusRing],
    (p, k, t) => { focusRing.rotation.z = 0.7 * k * Math.sin(t * 2); });

  /* ---------- front face ---------- */
  const release = at(cyl(0.3, 0.28, 0.2, M.black, 'z'), MX - 2.95, -1.75, FRONT + 0.08);
  part('lensRelease', 'Lens release button', 'cam-lens', 'front', V(MX - 2.95, -1.75, FRONT + 0.4), V(-0.3, -0.2, 1), [release]);

  const focusSel = at(new THREE.Group(), 4.35, -1.9, FRONT);
  const selTex = canvasTex(256, 256, (g, S) => {
    g.fillStyle = '#19191b'; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.fill();
    g.fillStyle = '#e8e8e4'; g.font = 'bold 54px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [['S', -0.75], ['C', 0], ['M', 0.75]].forEach(([s, a]) => g.fillText(s, S / 2 + Math.sin(a) * 84, S / 2 - Math.cos(a) * 84));
  });
  const selFace = new THREE.Mesh(new THREE.CircleGeometry(0.62, 40), std(0xffffff, 0.1, 0.6, { map: selTex }));
  at(selFace, 0, 0, 0.03, focusSel);
  const selKnob = at(new THREE.Group(), 0, 0, 0.04, focusSel);
  at(cyl(0.3, 0.28, 0.14, M.plateDark, 'z'), 0, 0, 0.07, selKnob);
  at(slab(0.1, 0.34, 0.1, 0.03, M.plate), 0, 0.2, 0.12, selKnob);
  selKnob.rotation.z = 0.75;
  part('focusSel', 'Focus mode selector', 'cam-focus', 'front', V(4.35, -1.9, FRONT + 0.4), V(0.3, -0.2, 1), [focusSel],
    (p, k, t) => { selKnob.rotation.z = 0.75 - k * 0.75 * (1 + Math.sin(t * 2)); });

  const afLamp = at(cyl(0.2, 0.2, 0.06, std(0xfff3d0, 0, 0.3, { emissive: 0x5a4a20 }), 'z'), -1.95, 2.6, FRONT + 0.02);
  part('afLamp', 'AF-assist / self-timer lamp', 'cam-focus', 'front', V(-1.95, 2.6, FRONT + 0.3), V(-0.1, 0.2, 1), [afLamp]);

  /* ---------- back ---------- */
  // Viewfinder eyepiece, eye sensor, dioptre wheel, VIEW MODE.
  const evf = at(new THREE.Group(), MX, TOP + 0.62, BACK - 0.28);
  at(slab(2.9, 1.75, 0.5, 0.35, M.rubber), 0, 0, 0, evf);
  at(slab(1.55, 1.0, 0.06, 0.12, std(0x121a2c, 0.4, 0.1, { emissive: 0x0a1630 })), -0.1, 0, -0.26, evf);
  at(slab(0.3, 0.55, 0.05, 0.05, M.glass), 1.05, 0, -0.26, evf);
  part('evf', 'Electronic viewfinder (EVF)', 'cam-evf', 'back', V(MX, TOP + 0.75, BACK - 0.7), V(0, 0.2, -1), [evf]);
  const diopter = at(cyl(0.3, 0.3, 0.22, std(0xffffff, 0.2, 0.7, { map: ridges('#3a3a3d', '#0e0e10', 22) }), 'x'), MX + 1.72, TOP + 0.75, BACK - 0.05);
  part('diopter', 'Diopter adjustment', 'cam-evf', 'back', V(MX + 2.0, TOP + 0.95, BACK - 0.3), V(0.7, 0.3, -0.7), [diopter], (p, k, t) => { diopter.rotation.x = k * Math.sin(t * 2); });
  const viewMode = at(cyl(0.2, 0.19, 0.12, M.black, 'x'), MX - 1.82, TOP + 0.5, BACK + 0.5);
  viewMode.rotation.z = -0.36;
  part('viewMode', 'VIEW MODE button', 'cam-evf', 'back', V(MX - 2.0, TOP + 0.6, BACK + 0.2), V(-0.8, 0.3, -0.5), [viewMode]);

  // LCD: hinged along its bottom edge so it can tip up toward the sky.
  const lcdTex = canvasTex(640, 428, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#6f97c4'); sky.addColorStop(0.55, '#d7c9a8'); sky.addColorStop(0.56, '#6a6258'); sky.addColorStop(1, '#2e2a26');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3d3a37'; g.fillRect(0, 150, 150, 120); g.fillRect(470, 110, 170, 160); g.fillStyle = '#56504a'; g.fillRect(150, 185, 110, 60);
    g.fillStyle = '#c96a4a'; g.beginPath(); g.arc(330, 215, 22, 0, 7); g.fill(); g.fillRect(308, 238, 44, 95);
    g.strokeStyle = '#3ee06a'; g.lineWidth = 4; g.strokeRect(296, 186, 68, 68);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, h - 46, w, 46); g.fillRect(0, 0, w, 34);
    g.fillStyle = '#ffffff'; g.font = 'bold 26px Arial, Helvetica, sans-serif'; g.textBaseline = 'middle';
    g.fillText('A', 16, h - 22); g.fillText('1/250', 70, h - 22); g.fillStyle = '#7fd0ff'; g.fillText('F5.6', 190, h - 22);
    g.fillStyle = '#ffffff'; g.fillText('±0', 300, h - 22); g.fillText('ISO 400', 500, h - 22);
    g.font = '20px Arial, Helvetica, sans-serif'; g.fillText('AF-S   CC   F   3:2   312', 16, 17);
  });
  const lcdPivot = at(new THREE.Group(), 1.55, -3.05, BACK - 0.02);
  const lcd = at(slab(7.3, 5.0, 0.3, 0.2, M.black), 0, 2.5, -0.15, lcdPivot);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.3, 4.2), new THREE.MeshBasicMaterial({ map: lcdTex, toneMapped: false }));
  screen.rotation.y = Math.PI;
  at(screen, 0, 2.55, -0.305, lcdPivot);
  part('lcd', 'LCD monitor (tilting touch screen)', 'cam-evf', 'back', V(1.55, -0.6, BACK - 0.5), V(0, 0, -1), [lcdPivot],
    (p, k) => { lcdPivot.rotation.x = -0.8 * k; lcdPivot.position.z = BACK - 0.02 - 0.5 * k; });

  // Buttons on the back. `face` is the outward direction: -z, except where noted.
  function backBtn(id, name, topic, x, y, r, material) {
    const b = at(cyl(r, r * 0.94, 0.14, material || M.black, 'z', 28), x, y, BACK - 0.05);
    part(id, name, topic, 'back', V(x, y, BACK - 0.35), V(0, 0, -1), [b],
      (p, k, t) => { b.position.z = BACK - 0.05 + 0.05 * k * Math.max(0, Math.sin(t * 3)); });
    return b;
  }
  backBtn('drive', 'DRIVE / delete button', 'cam-drive', 4.75, 2.62, 0.24);
  backBtn('play', 'Playback button', 'cam-menu', 3.75, 2.62, 0.24);
  backBtn('aeL', 'AE-L button', 'cam-locks', -2.75, 2.62, 0.24);
  backBtn('afL', 'AF-L button', 'cam-locks', -5.1, 2.62, 0.24);
  backBtn('menu', 'MENU/OK button', 'cam-menu', -3.55, -0.75, 0.36);
  backBtn('disp', 'DISP/BACK button', 'cam-menu', -3.55, -1.85, 0.3);

  const lamp = at(cyl(0.09, 0.09, 0.04, std(0x2a5a2a, 0, 0.3, { emissive: 0x0c4a14 }), 'z', 16), -2.45, 1.55, BACK - 0.01);
  part('lamp', 'Indicator lamp', 'cam-evf', 'back', V(-2.45, 1.55, BACK - 0.25), V(0, 0, -1), [lamp],
    (p, k, t) => { lamp.material.emissiveIntensity = 1 + 5 * k * (0.5 + 0.5 * Math.sin(t * 6)); });

  const stick = at(new THREE.Group(), -3.55, 0.55, BACK);
  at(cyl(0.34, 0.34, 0.06, M.black, 'z', 28), 0, 0, -0.03, stick);
  const nub = at(new THREE.Group(), 0, 0, -0.05, stick);
  at(cyl(0.17, 0.2, 0.22, std(0xffffff, 0, 0.9, { map: ridges('#2a2a2c', '#0b0b0c', 12) }), 'z', 20), 0, 0, -0.11, nub);
  part('stick', 'Focus stick', 'cam-stick', 'back', V(-3.55, 0.55, BACK - 0.5), V(0, 0, -1), [stick],
    (p, k, t) => { nub.rotation.x = 0.4 * k * Math.sin(t * 2.6); nub.rotation.y = 0.4 * k * Math.cos(t * 2.6); });

  const qBtn = at(cyl(0.2, 0.19, 0.12, M.black, 'z', 24), -5.25, 0.35, BACK - 0.36);
  part('qBtn', 'Q (quick menu) button', 'cam-q', 'back', V(-5.25, 0.35, BACK - 0.65), V(-0.3, 0, -1), [qBtn]);

  /* ---------- side and bottom ---------- */
  const ports = at(slab(1.7, 2.9, 0.08, 0.2, M.rubber), W / 2 + 0.02, 0.1, -0.1);
  ports.rotation.y = Math.PI / 2;
  part('ports', 'Connector cover', 'cam-ports', 'side', V(W / 2 + 0.3, 0.1, -0.1), V(1, 0, 0), [ports]);
  const batt = at(slab(3.4, 2.3, 0.06, 0.2, M.plateDark), -3.6, BOT - 0.01, 0);
  batt.rotation.x = Math.PI / 2;
  part('battery', 'Battery and card door', 'cam-ports', 'bottom', V(-3.6, BOT - 0.3, 0), V(0, -1, 0), [batt]);
  const tripod = at(cyl(0.32, 0.32, 0.05, M.black, 'y', 24), MX, BOT - 0.02, 0);
  part('tripod', 'Tripod mount', 'cam-ports', 'bottom', V(MX, BOT - 0.3, 0), V(0, -1, 0), [tripod]);

  G.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

  /* ---------- selection and animation ---------- */
  let selected = null;
  const accent = new THREE.Color(0x2563eb);
  function select(id) { selected = parts.has(id) ? id : null; }
  function update(dt, time) {
    parts.forEach((p) => {
      const target = p.id === selected ? 1 : 0;
      if (p.k === target && !target) return;
      p.k += (target - p.k) * Math.min(1, dt * 6);
      if (Math.abs(target - p.k) < 0.002) p.k = target;
      const glow = p.k * (0.35 + 0.25 * Math.sin(time * 4));
      p.meshes.forEach((m) => {
        if (!m.material.emissive) return;
        if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.material.emissive.clone();
        m.material.emissive.copy(m.userData.baseEmissive).lerp(accent, Math.min(1, glow));
      });
      if (p.anim) p.anim(p, p.k, time);
    });
  }

  return {
    group: G, parts, update, select,
    setAccent(c) { accent.set(c); },
    get selected() { return selected; },
  };
}

CS.buildBody = buildBody;
})(window.CameraSkills = window.CameraSkills || {});
