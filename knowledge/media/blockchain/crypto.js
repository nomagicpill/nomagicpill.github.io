/*
 * The cryptography behind knowledge/draftblockchain.html, written out in
 * plain JavaScript so nothing on the page is a black box: SHA-256, SHA-512,
 * RIPEMD-160 and Keccak-256; the secp256k1 curve and ECDSA signatures;
 * Base58Check and Bech32 addresses; BIP-39 recovery phrases and BIP-32
 * key derivation. These are the same algorithms Bitcoin and Ethereum use, and
 * every result can be checked against any other implementation.
 *
 * Written to teach, not to guard money: it has not been audited, and its
 * point arithmetic is not constant-time. Nothing here should hold real funds.
 *
 * No DOM, so it also loads in node (require it), which is how it was checked
 * against node's own crypto module and the published test vectors. In the
 * page it becomes Blockchain.crypto.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Blockchain = root.Blockchain || {}).crypto = api;
})(this, function (root) {
'use strict';

/* ----------------------------------------------------------------------------
 * Bytes
 * ------------------------------------------------------------------------- */

const utf8 = (s) => new TextEncoder().encode(s);

function hex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}

function fromHex(h) {
  if (h.length % 2) h = '0' + h;
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) {
    const v = parseInt(h.substr(i * 2, 2), 16);
    if (Number.isNaN(v)) throw new Error('Not hex: ' + h);
    b[i] = v;
  }
  return b;
}

function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const reverse = (b) => Uint8Array.from(b).reverse();

function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function randomBytes(n) {
  const b = new Uint8Array(n);
  const c = root && root.crypto ? root.crypto : typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (!c || !c.getRandomValues) throw new Error('No secure random number generator');
  c.getRandomValues(b);
  return b;
}

const bytesToBig = (b) => (b.length ? BigInt('0x' + hex(b)) : 0n);

function bigToBytes(x, n = 32) {
  const h = x.toString(16).padStart(n * 2, '0');
  if (h.length > n * 2) throw new Error('Number too large for ' + n + ' bytes');
  return fromHex(h);
}

function u32le(x) { return Uint8Array.of(x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255); }
function u32be(x) { return Uint8Array.of((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255); }
function u64le(x) {
  const lo = x % 4294967296, hi = Math.floor(x / 4294967296);
  return concat(u32le(lo), u32le(hi));
}
const bswap = (x) => ((x & 255) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24);

/* ----------------------------------------------------------------------------
 * "Nothing up my sleeve" constants. SHA-2's round constants are the leading
 * bits of the fractional parts of the cube roots of the first primes, and its
 * starting state the same for square roots. Computing them here, rather than
 * pasting 200 hex numbers, shows there is no hidden choice in them.
 * ------------------------------------------------------------------------- */

const PRIMES = [];
for (let n = 2; PRIMES.length < 80; n++) if (PRIMES.every((p) => n % p)) PRIMES.push(n);

function iroot(x, k) {          // floor(x^(1/k)) for BigInt x, by Newton's method
  if (x < 2n) return x;
  const K = BigInt(k);
  let r = 1n << BigInt(Math.ceil(x.toString(2).length / k));
  for (;;) {
    const next = ((K - 1n) * r + x / r ** (K - 1n)) / K;
    if (next >= r) return r;
    r = next;
  }
}

// Fractional part of p^(1/k), as `bits` bits.
const fracRoot = (p, k, bits) => iroot(BigInt(p) << BigInt(bits * k), k) & ((1n << BigInt(bits)) - 1n);

const K256 = Int32Array.from(PRIMES.slice(0, 64), (p) => Number(fracRoot(p, 3, 32)) | 0);
const H256 = Int32Array.from(PRIMES.slice(0, 8), (p) => Number(fracRoot(p, 2, 32)) | 0);
const K512 = new Int32Array(160);
PRIMES.forEach((p, i) => { const v = fracRoot(p, 3, 64); K512[2 * i] = Number(v >> 32n) | 0; K512[2 * i + 1] = Number(v & 0xffffffffn) | 0; });
const H512 = new Int32Array(16);
PRIMES.slice(0, 8).forEach((p, i) => { const v = fracRoot(p, 2, 64); H512[2 * i] = Number(v >> 32n) | 0; H512[2 * i + 1] = Number(v & 0xffffffffn) | 0; });

/* ----------------------------------------------------------------------------
 * SHA-256
 * ------------------------------------------------------------------------- */

function compress256(st, w) {
  for (let j = 16; j < 64; j++) {
    const x = w[j - 15], y = w[j - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
  }
  let a = st[0], b = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
  for (let j = 0; j < 64; j++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K256[j] + w[j]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  st[0] = (st[0] + a) | 0; st[1] = (st[1] + b) | 0; st[2] = (st[2] + c) | 0; st[3] = (st[3] + d) | 0;
  st[4] = (st[4] + e) | 0; st[5] = (st[5] + f) | 0; st[6] = (st[6] + g) | 0; st[7] = (st[7] + h) | 0;
}

const W64 = new Int32Array(64);

function sha256(msg) {
  const len = msg.length;
  const n = (len + 9 + 63) >> 6;
  const buf = new Uint8Array(n * 64);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 4, (len * 8) >>> 0);
  dv.setUint32(buf.length - 8, Math.floor(len / 0x20000000));
  const st = Int32Array.from(H256);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 16; j++) W64[j] = dv.getInt32(i * 64 + j * 4);
    compress256(st, W64);
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setInt32(i * 4, st[i]);
  return out;
}

const sha256d = (m) => sha256(sha256(m));

/* ----------------------------------------------------------------------------
 * SHA-512, with each 64-bit word held as a pair of 32-bit halves (hi, lo)
 * ------------------------------------------------------------------------- */

const W160 = new Int32Array(160);

function compress512(st, w) {
  for (let j = 16; j < 80; j++) {
    const xh = w[2 * (j - 15)], xl = w[2 * (j - 15) + 1];
    const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
    const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
    const yh = w[2 * (j - 2)], yl = w[2 * (j - 2) + 1];
    const s1h = ((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6);
    const s1l = ((yl >>> 19) | (yh << 13)) ^ ((yh >>> 29) | (yl << 3)) ^ ((yl >>> 6) | (yh << 26));
    const l = (s1l >>> 0) + (w[2 * (j - 7) + 1] >>> 0) + (s0l >>> 0) + (w[2 * (j - 16) + 1] >>> 0);
    w[2 * j] = (s1h + w[2 * (j - 7)] + s0h + w[2 * (j - 16)] + ((l / 4294967296) | 0)) | 0;
    w[2 * j + 1] = l | 0;
  }
  let ah = st[0], al = st[1], bh = st[2], bl = st[3], ch = st[4], cl = st[5], dh = st[6], dl = st[7];
  let eh = st[8], el = st[9], fh = st[10], fl = st[11], gh = st[12], gl = st[13], hh = st[14], hl = st[15];
  for (let j = 0; j < 80; j++) {
    const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
    const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
    const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
    const l1 = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[2 * j + 1] >>> 0) + (w[2 * j + 1] >>> 0);
    const t1h = (hh + S1h + chh + K512[2 * j] + w[2 * j] + ((l1 / 4294967296) | 0)) | 0;
    const t1l = l1 | 0;
    const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
    const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
    const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch), mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
    const l2 = (S0l >>> 0) + (mjl >>> 0);
    const t2h = (S0h + mjh + ((l2 / 4294967296) | 0)) | 0;
    const t2l = l2 | 0;
    hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
    const l3 = (dl >>> 0) + (t1l >>> 0);
    eh = (dh + t1h + ((l3 / 4294967296) | 0)) | 0; el = l3 | 0;
    dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
    const l4 = (t1l >>> 0) + (t2l >>> 0);
    ah = (t1h + t2h + ((l4 / 4294967296) | 0)) | 0; al = l4 | 0;
  }
  const v = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
  for (let i = 0; i < 16; i += 2) {
    const l = (st[i + 1] >>> 0) + (v[i + 1] >>> 0);
    st[i] = (st[i] + v[i] + ((l / 4294967296) | 0)) | 0;
    st[i + 1] = l | 0;
  }
}

// Finish a SHA-512 whose state has already absorbed `prefix` bytes (a whole
// number of blocks). HMAC and PBKDF2 use this to reuse the keyed states.
function sha512Finish(st, msg, prefix = 0) {
  const len = msg.length;
  const n = (len + 17 + 127) >> 7;
  const buf = new Uint8Array(n * 128);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = (prefix + len) * 8;
  dv.setUint32(buf.length - 4, bits >>> 0);
  dv.setUint32(buf.length - 8, Math.floor(bits / 4294967296));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 32; j++) W160[j] = dv.getInt32(i * 128 + j * 4);
    compress512(st, W160);
  }
  const out = new Uint8Array(64);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) ov.setInt32(i * 4, st[i]);
  return out;
}

function sha512Block(st, block) {
  const dv = new DataView(block.buffer, block.byteOffset, 128);
  for (let j = 0; j < 32; j++) W160[j] = dv.getInt32(j * 4);
  compress512(st, W160);
}

const sha512 = (msg) => sha512Finish(Int32Array.from(H512), msg, 0);

/* ----------------------------------------------------------------------------
 * HMAC and PBKDF2
 * ------------------------------------------------------------------------- */

function hmac(hash, blockSize, key, msg) {
  if (key.length > blockSize) key = hash(key);
  const k = new Uint8Array(blockSize);
  k.set(key);
  const ip = k.map((x) => x ^ 0x36), op = k.map((x) => x ^ 0x5c);
  return hash(concat(op, hash(concat(ip, msg))));
}

const hmacSha256 = (key, msg) => hmac(sha256, 64, key, msg);
const hmacSha512 = (key, msg) => hmac(sha512, 128, key, msg);

// PBKDF2-HMAC-SHA512, as BIP-39 uses it (2048 rounds). The keyed inner and
// outer states are computed once, so each round costs two compressions.
function pbkdf2Sha512(password, salt, iterations, dkLen = 64) {
  let key = password.length > 128 ? sha512(password) : password;
  const k = new Uint8Array(128);
  k.set(key);
  const ist = Int32Array.from(H512), ost = Int32Array.from(H512);
  sha512Block(ist, k.map((x) => x ^ 0x36));
  sha512Block(ost, k.map((x) => x ^ 0x5c));
  const mac = (m) => sha512Finish(Int32Array.from(ost), sha512Finish(Int32Array.from(ist), m, 128), 128);
  const out = new Uint8Array(dkLen);
  for (let block = 1, o = 0; o < dkLen; block++, o += 64) {
    let u = mac(concat(salt, u32be(block)));
    const t = Uint8Array.from(u);
    for (let i = 1; i < iterations; i++) {
      u = mac(u);
      for (let j = 0; j < 64; j++) t[j] ^= u[j];
    }
    out.set(t.subarray(0, Math.min(64, dkLen - o)), o);
  }
  return out;
}

/* ----------------------------------------------------------------------------
 * RIPEMD-160 (Bitcoin addresses hash a public key with SHA-256, then this)
 * ------------------------------------------------------------------------- */

const RL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13];
const RR = [5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11];
const SL = [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6];
const SR = [8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11];
const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];

function rmdF(j, x, y, z) {
  if (j < 16) return x ^ y ^ z;
  if (j < 32) return (x & y) | (~x & z);
  if (j < 48) return (x | ~y) ^ z;
  if (j < 64) return (x & z) | (y & ~z);
  return x ^ (y | ~z);
}

const rol = (x, n) => (x << n) | (x >>> (32 - n));

function ripemd160(msg) {
  const len = msg.length;
  const n = (len + 9 + 63) >> 6;
  const buf = new Uint8Array(n * 64);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, (len * 8) >>> 0, true);
  dv.setUint32(buf.length - 4, Math.floor(len / 0x20000000), true);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const X = new Int32Array(16);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 16; j++) X[j] = dv.getInt32(i * 64 + j * 4, true);
    let al = h[0], bl = h[1], cl = h[2], dl = h[3], el = h[4];
    let ar = al, br = bl, cr = cl, dr = dl, er = el;
    for (let j = 0; j < 80; j++) {
      const r = j >> 4;
      let t = (rol((al + rmdF(j, bl, cl, dl) + X[RL[j]] + KL[r]) | 0, SL[j]) + el) | 0;
      al = el; el = dl; dl = rol(cl, 10); cl = bl; bl = t;
      t = (rol((ar + rmdF(79 - j, br, cr, dr) + X[RR[j]] + KR[r]) | 0, SR[j]) + er) | 0;
      ar = er; er = dr; dr = rol(cr, 10); cr = br; br = t;
    }
    const t = (h[1] + cl + dr) | 0;
    h[1] = (h[2] + dl + er) | 0;
    h[2] = (h[3] + el + ar) | 0;
    h[3] = (h[4] + al + br) | 0;
    h[4] = (h[0] + bl + cr) | 0;
    h[0] = t;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) ov.setInt32(i * 4, h[i], true);
  return out;
}

const hash160 = (b) => ripemd160(sha256(b));

/* ----------------------------------------------------------------------------
 * Keccak-256 (Ethereum's hash: the original Keccak padding, not SHA3-256's).
 * The round constants and rotation amounts are generated from the
 * specification's own recipes rather than pasted.
 * ------------------------------------------------------------------------- */

const KECCAK_RC = (() => {
  const rcBit = (t) => {
    if (t % 255 === 0) return 1;
    let R = 1;
    for (let i = 1; i <= t % 255; i++) { R <<= 1; if (R & 0x100) R ^= 0x171; }
    return R & 1;
  };
  const out = new Int32Array(48);   // hi, lo pairs
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j <= 6; j++) {
      if (!rcBit(j + 7 * i)) continue;
      const bit = (1 << j) - 1;
      if (bit < 32) out[2 * i + 1] |= 1 << bit;
      else out[2 * i] |= 1 << (bit - 32);
    }
  }
  return out;
})();

const KECCAK_ROT = (() => {
  const r = new Array(25).fill(0);
  let x = 1, y = 0;
  for (let t = 0; t < 24; t++) {
    r[x + 5 * y] = (((t + 1) * (t + 2)) / 2) % 64;
    [x, y] = [y, (2 * x + 3 * y) % 5];
  }
  return r;
})();

function rotl64(h, l, n) {
  if (n === 0) return [h, l];
  if (n < 32) return [(h << n) | (l >>> (32 - n)), (l << n) | (h >>> (32 - n))];
  if (n === 32) return [l, h];
  const m = n - 32;
  return [(l << m) | (h >>> (32 - m)), (h << m) | (l >>> (32 - m))];
}

function keccakF(H, L) {
  const CH = new Int32Array(5), CL = new Int32Array(5), BH = new Int32Array(25), BL = new Int32Array(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      CH[x] = H[x] ^ H[x + 5] ^ H[x + 10] ^ H[x + 15] ^ H[x + 20];
      CL[x] = L[x] ^ L[x + 5] ^ L[x + 10] ^ L[x + 15] ^ L[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const [rh, rl] = rotl64(CH[(x + 1) % 5], CL[(x + 1) % 5], 1);
      const dh = CH[(x + 4) % 5] ^ rh, dl = CL[(x + 4) % 5] ^ rl;
      for (let y = 0; y < 25; y += 5) { H[x + y] ^= dh; L[x + y] ^= dl; }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const [rh, rl] = rotl64(H[x + 5 * y], L[x + 5 * y], KECCAK_ROT[x + 5 * y]);
        const to = y + 5 * ((2 * x + 3 * y) % 5);
        BH[to] = rh; BL[to] = rl;
      }
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        H[x + y] = BH[x + y] ^ (~BH[((x + 1) % 5) + y] & BH[((x + 2) % 5) + y]);
        L[x + y] = BL[x + y] ^ (~BL[((x + 1) % 5) + y] & BL[((x + 2) % 5) + y]);
      }
    }
    H[0] ^= KECCAK_RC[2 * round];
    L[0] ^= KECCAK_RC[2 * round + 1];
  }
}

function keccak256(msg) {
  const rate = 136;
  const n = Math.floor(msg.length / rate) + 1;
  const buf = new Uint8Array(n * rate);
  buf.set(msg);
  buf[msg.length] ^= 0x01;
  buf[buf.length - 1] ^= 0x80;
  const H = new Int32Array(25), L = new Int32Array(25);
  const dv = new DataView(buf.buffer);
  for (let b = 0; b < n; b++) {
    for (let i = 0; i < rate / 8; i++) {
      L[i] ^= dv.getInt32(b * rate + i * 8, true);
      H[i] ^= dv.getInt32(b * rate + i * 8 + 4, true);
    }
    keccakF(H, L);
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) { ov.setInt32(i * 8, L[i], true); ov.setInt32(i * 8 + 4, H[i], true); }
  return out;
}

/* ----------------------------------------------------------------------------
 * secp256k1: the curve y^2 = x^3 + 7 over the integers modulo P
 * ------------------------------------------------------------------------- */

const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};

const mod = (a, m = P) => { const r = a % m; return r < 0n ? r + m : r; };

function inv(a, m = P) {
  let [r0, r1] = [mod(a, m), m];
  let [s0, s1] = [1n, 0n];
  while (r1) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error('No inverse');
  return mod(s0, m);
}

function powMod(b, e, m) {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

// Points in Jacobian coordinates [X, Y, Z] (x = X/Z^2, y = Y/Z^3): adding
// without a division at every step. Z = 0 is the point at infinity.
const INF = [0n, 1n, 0n];

function jDouble([X, Y, Z]) {
  if (Z === 0n || Y === 0n) return INF;
  const A = (X * X) % P, B = (Y * Y) % P, C = (B * B) % P;
  const D = mod(2n * ((X + B) ** 2n - A - C));
  const E = (3n * A) % P, F = (E * E) % P;
  const X3 = mod(F - 2n * D);
  return [X3, mod(E * (D - X3) - 8n * C), (2n * Y * Z) % P];
}

function jAdd(p, q) {
  const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q;
  if (Z1 === 0n) return q;
  if (Z2 === 0n) return p;
  const Z1Z1 = (Z1 * Z1) % P, Z2Z2 = (Z2 * Z2) % P;
  const U1 = (X1 * Z2Z2) % P, U2 = (X2 * Z1Z1) % P;
  const S1 = (Y1 * Z2 * Z2Z2) % P, S2 = (Y2 * Z1 * Z1Z1) % P;
  if (U1 === U2) return S1 === S2 ? jDouble(p) : INF;
  const H = mod(U2 - U1), I = (4n * H * H) % P, J = (H * I) % P;
  const r = mod(2n * (S2 - S1)), V = (U1 * I) % P;
  const X3 = mod(r * r - J - 2n * V);
  return [X3, mod(r * (V - X3) - 2n * S1 * J), mod(((Z1 + Z2) ** 2n - Z1Z1 - Z2Z2) * H)];
}

function toAffine([X, Y, Z]) {
  if (Z === 0n) return null;
  const zi = inv(Z), zi2 = (zi * zi) % P;
  return { x: (X * zi2) % P, y: (Y * zi2 * zi) % P };
}

const toJ = (pt) => (pt ? [pt.x, pt.y, 1n] : INF);

// k * pt by double-and-add: about 256 doublings and 128 additions for a
// 256-bit k, which is why going forward is quick and going back is not.
function mul(pt, k) {
  k = mod(k, N);
  let acc = INF;
  const base = toJ(pt);
  for (let i = BigInt(k.toString(2).length) - 1n; i >= 0n; i--) {
    acc = jDouble(acc);
    if ((k >> i) & 1n) acc = jAdd(acc, base);
  }
  return toAffine(acc);
}

// k * G with a table of G, 2G, 4G, ... 2^255 G: additions only.
let G_POW = null;
function mulG(k) {
  k = mod(k, N);
  if (!G_POW) {
    G_POW = [];
    let p = toJ(G);
    for (let i = 0; i < 256; i++) { G_POW.push(toJ(toAffine(p))); p = jDouble(p); }
  }
  let acc = INF;
  for (let i = 0; k > 0n; i++, k >>= 1n) if (k & 1n) acc = jAdd(acc, G_POW[i]);
  return toAffine(acc);
}

function addPoints(a, b) { return toAffine(jAdd(toJ(a), toJ(b))); }

function onCurve(pt) { return !!pt && mod(pt.y * pt.y - pt.x ** 3n - 7n) === 0n; }

function encodePoint(pt, compressed = true) {
  if (compressed) return concat(Uint8Array.of(pt.y & 1n ? 3 : 2), bigToBytes(pt.x));
  return concat(Uint8Array.of(4), bigToBytes(pt.x), bigToBytes(pt.y));
}

function decodePoint(b) {
  if (b[0] === 4 && b.length === 65) {
    const pt = { x: bytesToBig(b.subarray(1, 33)), y: bytesToBig(b.subarray(33)) };
    if (!onCurve(pt)) throw new Error('Point not on curve');
    return pt;
  }
  if ((b[0] === 2 || b[0] === 3) && b.length === 33) {
    const x = bytesToBig(b.subarray(1));
    // P = 3 (mod 4), so a square root is a power: y = (x^3 + 7)^((P+1)/4).
    let y = powMod(x ** 3n + 7n, (P + 1n) / 4n, P);
    if (mod(y * y - x ** 3n - 7n) !== 0n) throw new Error('Point not on curve');
    if ((y & 1n) !== BigInt(b[0] & 1)) y = P - y;
    return { x, y };
  }
  throw new Error('Bad point encoding');
}

/* ----------------------------------------------------------------------------
 * ECDSA
 * ------------------------------------------------------------------------- */

const bits2int = (b) => bytesToBig(b.length > 32 ? b.subarray(0, 32) : b);

// RFC 6979: the per-signature secret k derived from the key and message, so
// a bad random number generator can't leak the key (see "nonce reuse").
function rfc6979(d, h) {
  const x = bigToBytes(d), hb = bigToBytes(mod(bits2int(h), N));
  let V = new Uint8Array(32).fill(1), K = new Uint8Array(32);
  K = hmacSha256(K, concat(V, Uint8Array.of(0), x, hb));
  V = hmacSha256(K, V);
  K = hmacSha256(K, concat(V, Uint8Array.of(1), x, hb));
  V = hmacSha256(K, V);
  for (;;) {
    V = hmacSha256(K, V);
    const k = bytesToBig(V);
    if (k >= 1n && k < N) return k;
    K = hmacSha256(K, concat(V, Uint8Array.of(0)));
    V = hmacSha256(K, V);
  }
}

// Sign a 32-byte message hash. `k` may be supplied to show what goes wrong
// when one is reused; `lowS` follows Bitcoin's rule that s be in the lower half.
function sign(hash, d, { k = null, lowS = true } = {}) {
  const z = bits2int(hash);
  for (let tries = 0; ; tries++) {
    const kk = k !== null ? k : rfc6979(d, tries ? sha256(concat(hash, u32be(tries))) : hash);
    const R = mulG(kk);
    const r = mod(R.x, N);
    if (r === 0n) { if (k !== null) throw new Error('Bad k'); continue; }
    let s = mod(inv(kk, N) * (z + r * d), N);
    if (s === 0n) { if (k !== null) throw new Error('Bad k'); continue; }
    if (lowS && s > N / 2n) s = N - s;
    return { r, s, k: kk, R };
  }
}

function verify(hash, sig, Q) {
  const { r, s } = sig;
  if (!Q || r <= 0n || s <= 0n || r >= N || s >= N) return false;
  const z = bits2int(hash);
  const w = inv(s, N);
  const X = toAffine(jAdd(toJ(mulG(mod(z * w, N))), toJ(mul(Q, mod(r * w, N)))));
  return !!X && mod(X.x, N) === r;
}

// Two signatures made with the same k give away the private key:
// k = (z1 - z2) / (s1 - s2), then d = (s k - z) / r.
function recoverFromReusedK(z1, s1, z2, s2, r) {
  const k = mod((z1 - z2) * inv(mod(s1 - s2, N), N), N);
  const d = mod((s1 * k - z1) * inv(r, N), N);
  return { k, d };
}

/* ----------------------------------------------------------------------------
 * Addresses
 * ------------------------------------------------------------------------- */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(b) {
  let n = bytesToBig(b), s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (let i = 0; i < b.length && b[i] === 0; i++) s = '1' + s;
  return s;
}

const base58check = (payload) => base58(concat(payload, sha256d(payload).subarray(0, 4)));

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function convertBits(data, from, to) {
  let acc = 0, bits = 0;
  const out = [], maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >>> bits) & maxv); }
  }
  if (bits) out.push((acc << (to - bits)) & maxv);
  return out;
}

// Native SegWit (BIP-173), version 0: what most Bitcoin wallets hand out.
function segwitAddress(program, hrp = 'bc', version = 0) {
  const data = [version, ...convertBits(program, 8, 5)];
  const hrpx = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const pm = bech32Polymod([...hrpx, ...data, 0, 0, 0, 0, 0, 0]) ^ (version === 0 ? 1 : 0x2bc830a3);
  const chk = [0, 1, 2, 3, 4, 5].map((i) => (pm >>> (5 * (5 - i))) & 31);
  return hrp + '1' + [...data, ...chk].map((v) => BECH32[v]).join('');
}

// Legacy pay-to-public-key-hash: the "1..." addresses of Bitcoin's first years.
const p2pkhAddress = (pub) => base58check(concat(Uint8Array.of(0), hash160(pub)));
const p2wpkhAddress = (pub) => segwitAddress(hash160(pub));

// Ethereum: the last 20 bytes of the Keccak-256 of the raw public key, with
// EIP-55's mixed-case checksum.
function ethAddress(pt) {
  const raw = hex(keccak256(encodePoint(pt, false).subarray(1)).subarray(12));
  const h = hex(keccak256(utf8(raw)));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? raw[i].toUpperCase() : raw[i];
  return out;
}

/* ----------------------------------------------------------------------------
 * Keys
 * ------------------------------------------------------------------------- */

function randomPrivateKey() {
  for (;;) {
    const d = bytesToBig(randomBytes(32));
    if (d > 0n && d < N) return d;
  }
}

function keyInfo(d) {
  const pub = mulG(d);
  const pubC = encodePoint(pub, true);
  return {
    d, pub, pubC,
    hash160: hash160(pubC),
    btc: p2wpkhAddress(pubC),
    btcLegacy: p2pkhAddress(pubC),
    eth: ethAddress(pub),
  };
}

/* ----------------------------------------------------------------------------
 * BIP-39: recovery phrases
 * ------------------------------------------------------------------------- */

function bitsOf(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(2).padStart(8, '0');
  return s;
}

function entropyToMnemonic(entropy, words) {
  const cs = entropy.length / 4;   // checksum bits: one per 32 bits of entropy
  const bits = bitsOf(entropy) + bitsOf(sha256(entropy)).slice(0, cs);
  const out = [];
  for (let i = 0; i < bits.length; i += 11) out.push(words[parseInt(bits.slice(i, i + 11), 2)]);
  return out;
}

// Check a phrase: every word must be on the list, and the last few bits must
// match the checksum computed from the rest.
function checkMnemonic(phrase, words) {
  const list = Array.isArray(phrase) ? phrase : phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const unknown = list.filter((w) => words.indexOf(w) < 0);
  if (unknown.length || ![12, 15, 18, 21, 24].includes(list.length)) {
    return { ok: false, unknown, length: list.length };
  }
  const bits = list.map((w) => words.indexOf(w).toString(2).padStart(11, '0')).join('');
  const entBits = (bits.length * 32) / 33;
  const ent = new Uint8Array(entBits / 8);
  for (let i = 0; i < ent.length; i++) ent[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const got = bits.slice(entBits);
  const want = bitsOf(sha256(ent)).slice(0, bits.length - entBits);
  return { ok: got === want, unknown: [], length: list.length, entropy: ent, checksumGot: got, checksumWant: want, bits };
}

function mnemonicToSeed(phrase, passphrase = '') {
  const m = (Array.isArray(phrase) ? phrase.join(' ') : phrase).normalize('NFKD');
  return pbkdf2Sha512(utf8(m), utf8(('mnemonic' + passphrase).normalize('NFKD')), 2048, 64);
}

/* ----------------------------------------------------------------------------
 * BIP-32: a tree of keys from one seed
 * ------------------------------------------------------------------------- */

const HARD = 0x80000000;

function masterKey(seed) {
  const I = hmacSha512(utf8('Bitcoin seed'), seed);
  return { k: bytesToBig(I.subarray(0, 32)), c: I.subarray(32) };
}

function childKey({ k, c }, index) {
  const data = index >= HARD
    ? concat(Uint8Array.of(0), bigToBytes(k), u32be(index))
    : concat(encodePoint(mulG(k), true), u32be(index));
  const I = hmacSha512(c, data);
  const IL = bytesToBig(I.subarray(0, 32));
  if (IL >= N) throw new Error('Invalid child (astronomically unlikely); try the next index');
  return { k: mod(IL + k, N), c: I.subarray(32) };
}

function parsePath(path) {
  return path.split('/').slice(1).map((s) => (s.endsWith("'") ? parseInt(s, 10) + HARD : parseInt(s, 10)));
}

function derivePath(seed, path) {
  let node = masterKey(seed);
  for (const i of parsePath(path)) node = childKey(node, i);
  return node;
}

/* ----------------------------------------------------------------------------
 * Bitcoin-style block headers and proof of work
 * ------------------------------------------------------------------------- */

// Target from the header's compact "bits" field: mantissa * 256^(exponent-3).
function bitsToTarget(bits) {
  const exp = bits >>> 24, mant = BigInt(bits & 0x007fffff);
  return exp <= 3 ? mant >> BigInt(8 * (3 - exp)) : mant << BigInt(8 * (exp - 3));
}

function targetToBits(target) {
  let size = Math.ceil(target.toString(16).length / 2);
  let mant = size <= 3 ? Number(target << BigInt(8 * (3 - size))) : Number(target >> BigInt(8 * (size - 3)));
  if (mant & 0x00800000) { mant >>= 8; size++; }
  return ((size << 24) | mant) >>> 0;
}

const DIFF1 = bitsToTarget(0x1d00ffff);   // Bitcoin's difficulty-1 target (its first block's)
const difficulty = (bits) => Number(DIFF1 * 1000000n / bitsToTarget(bits)) / 1e6;

// A target that a fraction 2^-zeroBits of hashes meet: hashes "start with"
// zeroBits zero bits.
const bitsForZeros = (zeroBits) => targetToBits((1n << BigInt(256 - zeroBits)) - 1n);

function serializeHeader(h) {
  return concat(u32le(h.version), reverse(fromHex(h.prev)), reverse(fromHex(h.merkle)), u32le(h.time), u32le(h.bits), u32le(h.nonce));
}

// Bitcoin shows hashes byte-reversed, so the zeros a miner hunts for come first.
const headerHash = (h) => hex(reverse(sha256d(serializeHeader(h))));

const meetsTarget = (hashHex, bits) => BigInt('0x' + hashHex) <= bitsToTarget(bits);

function leadingZeroBits(hashHex) {
  let n = 0;
  for (const ch of hashHex) {
    const v = parseInt(ch, 16);
    if (v === 0) { n += 4; continue; }
    return n + Math.clz32(v) - 28;
  }
  return n;
}

// Merkle root of txids (display hex), Bitcoin's way: hash pairs with double
// SHA-256, duplicating the last when a level has an odd count.
function merkleLevels(txids) {
  if (!txids.length) return [[hex(new Uint8Array(32))]];
  let level = txids.map((t) => reverse(fromHex(t)));
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256d(concat(level[i], level[i + 1] || level[i])));
    level = next;
    levels.push(level);
  }
  return levels.map((l) => l.map((b) => hex(reverse(b))));
}

const merkleRoot = (txids) => { const L = merkleLevels(txids); return L[L.length - 1][0]; };

// The search miners run. The header's first 64 bytes don't change from one
// nonce to the next, so their SHA-256 state (the "midstate") is computed once;
// each try is then two compressions instead of three.
function headerMiner(header) {
  const bytes = serializeHeader(Object.assign({}, header, { nonce: 0 }));
  const dv = new DataView(bytes.buffer);
  const mid = Int32Array.from(H256);
  const w = new Int32Array(64);
  for (let j = 0; j < 16; j++) w[j] = dv.getInt32(j * 4);
  compress256(mid, w);
  const tail = [dv.getInt32(64), dv.getInt32(68), dv.getInt32(72)];
  const tb = bigToBytes(bitsToTarget(header.bits));
  const tdv = new DataView(tb.buffer);
  const target = Array.from({ length: 8 }, (_, i) => tdv.getUint32(i * 4));
  const st = new Int32Array(8), st2 = new Int32Array(8);
  const w1 = new Int32Array(64), w2 = new Int32Array(64);
  let hashes = 0;

  function hashNonce(nonce) {
    w1.fill(0);
    w1[0] = tail[0]; w1[1] = tail[1]; w1[2] = tail[2]; w1[3] = bswap(nonce >>> 0);
    w1[4] = 0x80000000 | 0; w1[15] = 640;
    st.set(mid);
    compress256(st, w1);
    w2.fill(0);
    for (let i = 0; i < 8; i++) w2[i] = st[i];
    w2[8] = 0x80000000 | 0; w2[15] = 256;
    st2.set(H256);
    compress256(st2, w2);
    hashes++;
  }

  // Compare against the target in display order, word by word.
  function hit() {
    for (let i = 0; i < 8; i++) {
      const v = bswap(st2[7 - i]) >>> 0;
      if (v < target[i]) return true;
      if (v > target[i]) return false;
    }
    return true;
  }

  function displayHash() {
    let s = '';
    for (let i = 7; i >= 0; i--) s += (bswap(st2[i]) >>> 0).toString(16).padStart(8, '0');
    return s;
  }

  return {
    // Try `count` nonces from `start`; returns the winning nonce or -1.
    search(start, count, onTry) {
      for (let n = start; n < start + count; n++) {
        hashNonce(n);
        if (onTry) onTry(n, st2);
        if (hit()) return n >>> 0;
      }
      return -1;
    },
    hashOf(nonce) { hashNonce(nonce); return displayHash(); },
    topWord: () => bswap(st2[7]) >>> 0,
    displayHash,
    get hashes() { return hashes; },
  };
}

return {
  // bytes
  utf8, hex, fromHex, concat, reverse, equal, randomBytes, bytesToBig, bigToBytes, u32le, u32be, u64le,
  // hashes
  sha256, sha256d, sha512, ripemd160, hash160, keccak256, hmacSha256, hmacSha512, pbkdf2Sha512,
  K256, H256,
  // curve and signatures
  P, N, G, mod, inv, powMod, mul, mulG, addPoints, onCurve, encodePoint, decodePoint,
  sign, verify, rfc6979, recoverFromReusedK, bits2int,
  // addresses and keys
  base58, base58check, segwitAddress, p2pkhAddress, p2wpkhAddress, ethAddress, randomPrivateKey, keyInfo,
  // wallets
  entropyToMnemonic, checkMnemonic, mnemonicToSeed, masterKey, childKey, derivePath, parsePath, HARD,
  // blocks
  bitsToTarget, targetToBits, bitsForZeros, difficulty, DIFF1, serializeHeader, headerHash, meetsTarget,
  leadingZeroBits, merkleLevels, merkleRoot, headerMiner,
};
});
