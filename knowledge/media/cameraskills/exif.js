/*
 * knowledge/cameraskills.html: reads the shooting settings out of a JPEG, so
 * a practice photo can fill in its own settings. Nothing is uploaded: the file
 * is read in the browser and only these few numbers are kept.
 *
 * parse(ArrayBuffer) returns null (not a JPEG, or no Exif) or
 *   { make, model, lens, focal, focal35, fnumber, exposure (seconds), iso,
 *     bias (stops), program, mode ('P'|'A'|'S'|'M'|''), flash (bool), date,
 *     filmSim, focusMode, afMode, shutterType,
 *     warnings: { blur, focus, exposure } }   // the camera's own flags
 * Fields that are missing from the file are undefined.
 *
 * The standard tags come from the Exif IFD. The film simulation and the
 * camera's blur/focus/exposure warnings live in Fujifilm's maker note, whose
 * layout and values follow ExifTool's FujiFilm tag table. No DOM; exports to
 * node so it can be checked against real files from the command line.
 */
(function (root) {
'use strict';

const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

// One TIFF directory: tag -> reader. `base` is what offsets are relative to.
function readIFD(v, base, at, le, limit) {
  const out = new Map();
  if (at + 2 > limit) return out;
  const n = v.getUint16(at, le);
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12;
    if (e + 12 > limit) break;
    const tag = v.getUint16(e, le), type = v.getUint16(e + 2, le), count = v.getUint32(e + 4, le);
    const bytes = (SIZE[type] || 1) * count;
    const pos = bytes <= 4 ? e + 8 : base + v.getUint32(e + 8, le);
    if (pos < 0 || pos + bytes > limit) continue;
    out.set(tag, { type, count, pos });
  }
  return out;
}
function value(v, le, f, i) {
  if (!f) return undefined;
  const p = f.pos + (i || 0) * (SIZE[f.type] || 1);
  switch (f.type) {
    case 1: case 7: return v.getUint8(p);
    case 3: return v.getUint16(p, le);
    case 4: return v.getUint32(p, le);
    case 9: return v.getInt32(p, le);
    case 5: { const d = v.getUint32(p + 4, le); return d ? v.getUint32(p, le) / d : undefined; }
    case 10: { const d = v.getInt32(p + 4, le); return d ? v.getInt32(p, le) / d : undefined; }
    case 2: {
      let s = '';
      for (let k = 0; k < f.count; k++) { const c = v.getUint8(f.pos + k); if (!c) break; s += String.fromCharCode(c); }
      return s.trim();
    }
    default: return undefined;
  }
}

const FILM = {
  0x000: 'PROVIA / Standard', 0x100: 'Studio Portrait', 0x110: 'Studio Portrait', 0x120: 'ASTIA / Soft', 0x130: 'Studio Portrait',
  0x200: 'Velvia / Vivid', 0x300: 'Studio Portrait Ex', 0x400: 'Velvia / Vivid', 0x500: 'PRO Neg. Std', 0x501: 'PRO Neg. Hi',
  0x600: 'CLASSIC CHROME', 0x700: 'ETERNA / Cinema', 0x800: 'CLASSIC Neg.', 0x900: 'ETERNA BLEACH BYPASS', 0xa00: 'NOSTALGIC Neg.', 0xb00: 'REALA ACE',
};
// Black-and-white simulations are recorded under the saturation tag instead.
const MONO = {
  0x300: 'MONOCHROME', 0x301: 'MONOCHROME + R filter', 0x302: 'MONOCHROME + Ye filter', 0x303: 'MONOCHROME + G filter', 0x310: 'SEPIA',
  0x500: 'ACROS', 0x501: 'ACROS + R filter', 0x502: 'ACROS + Ye filter', 0x503: 'ACROS + G filter',
};
const PROGRAM = { 1: 'M', 2: 'P', 3: 'A', 4: 'S' };

function fuji(v, start, end, out) {
  // "FUJIFILM", then a little-endian offset to the directory; offsets inside
  // are relative to the start of the maker note.
  let sig = '';
  for (let i = 0; i < 8; i++) sig += String.fromCharCode(v.getUint8(start + i));
  if (sig !== 'FUJIFILM') return;
  const dir = readIFD(v, start, start + v.getUint32(start + 8, true), true, end);
  const g = (tag) => value(v, true, dir.get(tag));
  const film = g(0x1401), sat = g(0x1003);
  if (MONO[sat]) out.filmSim = MONO[sat];
  else if (film !== undefined && FILM[film]) out.filmSim = FILM[film];
  const fm = g(0x1021);
  if (fm !== undefined) out.focusMode = fm === 1 ? 'manual' : 'auto';
  const af = g(0x1022);
  if (af !== undefined) out.afMode = af === 1 ? 'single point' : af === 0x100 ? 'zone' : af === 0x200 ? 'wide/tracking' : undefined;
  const st = g(0x1050);
  if (st !== undefined) out.shutterType = st === 0 ? 'mechanical' : st === 1 ? 'electronic' : st === 2 ? 'electronic (long exposure)' : 'electronic front curtain';
  out.warnings = { blur: g(0x1300) === 1, focus: g(0x1301) === 1, exposure: g(0x1302) === 1 };
}

function tiff(v, base, end) {
  const order = v.getUint16(base);
  const le = order === 0x4949;
  if (!le && order !== 0x4d4d) return null;
  if (v.getUint16(base + 2, le) !== 42) return null;
  const ifd0 = readIFD(v, base, base + v.getUint32(base + 4, le), le, end);
  const out = { make: value(v, le, ifd0.get(0x010f)), model: value(v, le, ifd0.get(0x0110)) };
  const ptr = value(v, le, ifd0.get(0x8769));
  if (ptr === undefined) return out;
  const ex = readIFD(v, base, base + ptr, le, end);
  const g = (tag, i) => value(v, le, ex.get(tag), i);
  out.exposure = g(0x829a);
  out.fnumber = g(0x829d);
  out.program = g(0x8822);
  out.mode = PROGRAM[out.program] || '';
  out.iso = g(0x8827);
  out.date = g(0x9003);
  out.bias = g(0x9204);
  const flash = g(0x9209);
  out.flash = flash === undefined ? undefined : (flash & 1) === 1;
  out.focal = g(0x920a);
  out.focal35 = g(0xa405) || undefined;
  out.lens = g(0xa434);
  const mn = ex.get(0x927c);
  if (mn && /fuji/i.test(out.make || '')) { try { fuji(v, mn.pos, Math.min(end, mn.pos + mn.count), out); } catch (e) {} }
  return out;
}

function parse(buf) {
  let v;
  try { v = new DataView(buf); } catch (e) { return null; }
  if (v.byteLength < 12 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    if (v.getUint8(off) !== 0xff) break;
    const marker = v.getUint8(off + 1), len = v.getUint16(off + 2);
    // APP1 holding "Exif\0\0"
    if (marker === 0xe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966 && v.getUint16(off + 8) === 0) {
      try { return tiff(v, off + 10, Math.min(v.byteLength, off + 2 + len)); } catch (e) { return null; }
    }
    if (marker === 0xda) break;        // image data starts: no Exif before it
    off += 2 + len;
  }
  return null;
}

// Shutter time the way cameras write it: 1/250, 0.5".
function shutterText(t) {
  if (!t) return '';
  if (t >= 0.3) return (Math.round(t * 10) / 10) + '"';
  return '1/' + Math.round(1 / t);
}

const api = { parse, shutterText };
root.CameraSkills = root.CameraSkills || {};
root.CameraSkills.exif = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
