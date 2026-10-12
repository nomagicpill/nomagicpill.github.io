/*
 * The model behind knowledge/draftblockchain.html: fourteen nodes gossiping
 * over a small peer-to-peer network and keeping a real, if tiny, blockchain.
 *
 * Real: every key is a secp256k1 key, every payment is signed with ECDSA and
 * checked by the nodes, every block has a Bitcoin-style 80-byte header whose
 * double SHA-256 genuinely meets its target, and Merkle roots, coin
 * ownership (UTXOs), fees and fork choice work the way Bitcoin's do.
 * Simplified: the transaction format, the difficulty (about 1 hash in 65,000
 * wins, not 1 in 10^23), the timing (a block every ~10 seconds, and messages
 * that crawl between nodes so forks are easy to see) and a proof-of-stake mode
 * modelled loosely on Ethereum's. When a miner's simulated luck says it has
 * found a block, the model then searches for a nonce that really works.
 *
 * No DOM and no three.js, so it also loads in node (require it) for checking.
 * In the page it becomes Blockchain.model.
 *
 * Units: amounts in satoshis (1 coin = 100,000,000), fee rates in sat/vB,
 * time in model seconds.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const C = isNode ? require('./crypto.js') : root.Blockchain.crypto;
  const api = factory(C);
  if (isNode) module.exports = api;
  else root.Blockchain.model = api;
})(this, function (C) {
'use strict';

const COIN = 100000000;
const SUBSIDY = 312500000;          // 3.125 coins: Bitcoin's block subsidy since April 2024
const DUST = 1000;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----------------------------------------------------------------------------
 * The cast. Order is position around the ring: the first seven are the
 * western half (69% of the hash rate), the last seven the eastern.
 * Hash shares echo real Bitcoin pools (the biggest two find about half the
 * blocks); stake echoes Ethereum (a liquid-staking pool and an exchange hold
 * nearly 40%).
 * ------------------------------------------------------------------------- */

const CAST = [
  { id: 'poolA', name: 'Pool A', kind: 'pool', hash: 0.30, stake: 220, coins: 0 },
  { id: 'ana', name: 'Ana', kind: 'person', hash: 0, stake: 60, coins: 30 },
  { id: 'poolB', name: 'Pool B', kind: 'pool', hash: 0.22, stake: 100, coins: 0 },
  { id: 'ben', name: 'Ben', kind: 'person', hash: 0, stake: 40, coins: 25 },
  { id: 'exchange', name: 'Exchange', kind: 'exchange', hash: 0, stake: 160, coins: 150 },
  { id: 'poolC', name: 'Pool C', kind: 'pool', hash: 0.17, stake: 80, coins: 0 },
  { id: 'chen', name: 'Chen', kind: 'person', hash: 0, stake: 50, coins: 40 },
  { id: 'shop', name: 'Shop', kind: 'shop', hash: 0, stake: 20, coins: 10 },
  { id: 'poolD', name: 'Pool D', kind: 'pool', hash: 0.13, stake: 60, coins: 0 },
  { id: 'dara', name: 'Dara', kind: 'person', hash: 0, stake: 40, coins: 20 },
  { id: 'poolE', name: 'Pool E', kind: 'pool', hash: 0.10, stake: 50, coins: 0 },
  { id: 'eli', name: 'Eli', kind: 'person', hash: 0, stake: 40, coins: 15 },
  { id: 'home', name: 'Home miner', kind: 'miner', hash: 0.08, stake: 30, coins: 0 },
  { id: 'mallory', name: 'Mallory', kind: 'person', hash: 0, stake: 50, coins: 60 },
];

// Peer links: each node to its two neighbours on either side, plus a few
// long-distance links, so any node is at most three or four hops from any other.
const CHORDS = [[0, 7], [3, 10], [5, 12], [2, 9]];

const DEFAULT_KNOBS = {
  blockTime: 10,          // seconds between blocks, on average (Bitcoin: 600)
  latency: 0.35,          // seconds per hop, roughly (Bitcoin: well under one)
  zeroBits: 16,           // proof-of-work target: hashes must start with this many zero bits
  txRate: 0.45,           // payments per second
  demand: 1,              // multiplier on txRate (the fee-spike scenario raises it)
  maxBlockVsize: 1800,    // block space, in virtual bytes (Bitcoin: 1,000,000)
  slotTime: 3,            // proof of stake: seconds per slot (Ethereum: 12)
  slotsPerEpoch: 8,       // (Ethereum: 32)
  attackShare: 0.45,      // the double-spend scenario: attacker's share of hash rate
  confirmations: 3,       // ... and how many confirmations the shop waits for
};

const SCENARIOS = [
  { id: 'normal', name: 'An ordinary day', mode: null,
    blurb: 'People pay each other, nodes pass the payments along, and miners race to bundle them into blocks.' },
  { id: 'fork', name: 'Two blocks at once', mode: 'pow',
    blurb: 'Two miners find a block at the same moment and the network briefly disagrees.' },
  { id: 'partition', name: 'The network splits', mode: 'pow',
    blurb: 'A broken cable cuts the network in two, each half builds its own chain, and the reunion undoes one of them.' },
  { id: 'tamper', name: 'Rewriting history', mode: 'pow',
    blurb: 'Mallory edits a payment buried four blocks deep and finds out what it would take to make the edit stick.' },
  { id: 'doublespend', name: 'Double-spend attack', mode: 'pow',
    blurb: 'Mallory rents mining power, pays the shop, and mines a secret chain in which the payment never happened.' },
  { id: 'feespike', name: 'A fee spike', mode: 'pow',
    blurb: 'A rush of demand fills every block, the mempool swells, and the price of block space climbs.' },
  { id: 'slashing', name: 'A validator double-signs', mode: 'pos',
    blurb: 'Under proof of stake, Mallory signs two blocks for one slot and loses stake for it.' },
  { id: 'offline', name: 'A third goes offline', mode: 'pos',
    blurb: 'Validators holding 38% of the stake drop out; blocks keep coming but finality stops until the inactivity leak restores it.' },
];

/* ----------------------------------------------------------------------------
 * Transactions: a Bitcoin-like format, simplified. Inputs point at earlier
 * outputs ("coins") and carry the owner's public key and signature; outputs
 * lock value to the hash of a public key.
 * ------------------------------------------------------------------------- */

function serializeTx(tx, withSigs) {
  const parts = [C.u32le(1), Uint8Array.of(tx.ins.length)];
  for (const i of tx.ins) {
    parts.push(C.reverse(C.fromHex(i.txid)), C.u32le(i.vout));
    if (withSigs) parts.push(C.fromHex(i.pub), C.fromHex(i.r), C.fromHex(i.s));
  }
  parts.push(Uint8Array.of(tx.outs.length));
  for (const o of tx.outs) parts.push(C.u64le(o.value), C.fromHex(o.to));
  if (tx.coinbase !== undefined) parts.push(C.u32le(tx.coinbase), C.utf8(tx.tag || ''));
  return C.concat(...parts);
}

// What input i's signature covers: every input and output, so changing any
// amount or recipient breaks every signature.
const sighash = (tx, i) => C.sha256d(C.concat(serializeTx(tx, false), C.u32le(i)));
const txidOf = (tx) => C.hex(C.reverse(C.sha256d(serializeTx(tx, true))));
const vsizeOf = (tx) => (tx.coinbase !== undefined ? 100 : 11 + 68 * tx.ins.length + 31 * tx.outs.length);
const outSum = (tx) => tx.outs.reduce((a, o) => a + o.value, 0);

function signTx(tx, keys) {
  tx.ins.forEach((inp, i) => {
    const key = keys[i];
    const sig = C.sign(sighash(tx, i), key.d);
    inp.pub = C.hex(key.pubC);
    inp.r = C.hex(C.bigToBytes(sig.r));
    inp.s = C.hex(C.bigToBytes(sig.s));
  });
  tx.id = txidOf(tx);
  return tx;
}

/* ----------------------------------------------------------------------------
 * The model
 * ------------------------------------------------------------------------- */

function createModel(opts = {}) {
  const seed = opts.seed !== undefined ? opts.seed : (Math.random() * 4294967296) >>> 0;
  const rng = mulberry32(seed);
  const knobs = Object.assign({}, DEFAULT_KNOBS, opts.knobs);
  const T0 = opts.seed !== undefined ? 1760000000 : Math.floor(Date.now() / 1000) - 7200;

  // Keys: random in the page; derived from the seed when checking in node, so
  // runs repeat exactly.
  const keyFor = (label) => C.keyInfo(opts.seed !== undefined
    ? C.mod(C.bytesToBig(C.sha256(C.utf8('model key ' + label + ' ' + seed))), C.N - 1n) + 1n
    : C.randomPrivateKey());

  const nodes = CAST.map((c, i) => {
    const a = Math.PI * (0.5 + (2 * i + 0.5) / CAST.length);
    return Object.assign({}, c, {
      index: i, x: Math.cos(a), z: -Math.sin(a), peers: [],
      key: keyFor(c.id), key2: c.id === 'mallory' ? keyFor('mallory-2') : null,
      tip: null, known: new Set(), seenAt: new Map(), seenTx: new Set(),
      online: true, slashed: false, activeStake: c.stake, west: i < CAST.length / 2,
    });
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const node = (id) => byId.get(id);
  const ownerOf = new Map();          // hash160 -> node id
  for (const n of nodes) {
    ownerOf.set(C.hex(n.key.hash160), n.id);
    if (n.key2) ownerOf.set(C.hex(n.key2.hash160), n.id);
  }

  const edges = [];
  const link = (i, j) => {
    const a = nodes[i], b = nodes[j];
    if (a.peers.includes(b.id)) return;
    const len = Math.hypot(a.x - b.x, a.z - b.z);
    const e = { a: a.id, b: b.id, len, cross: a.west !== b.west };
    edges.push(e);
    a.peers.push(b.id);
    b.peers.push(a.id);
  };
  for (let i = 0; i < nodes.length; i++) { link(i, (i + 1) % nodes.length); link(i, (i + 2) % nodes.length); }
  for (const [i, j] of CHORDS) link(i, j);
  const edgeOf = (a, b) => edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

  const S = {
    t: 0,
    mode: 'pow',
    blocks: new Map(),
    children: new Map(),
    txs: new Map(),
    mempool: new Map(),
    confirmed: new Map(),       // txid -> hash of the canonical block holding it
    conflicted: new Set(),
    sigCache: new Map(),
    messages: [],
    events: [],
    jobs: [],
    canonical: null,
    genesis: null,
    partition: false,
    attack: null,
    forced: null,
    suspendMining: false,
    realHashes: 0,
    seq: 0,
    lastBlockAt: 0,
    intervals: [],
    tracked: new Set(),
    warmLeft: opts.warmBlocks !== undefined ? opts.warmBlocks : 8,
    script: null,
    scriptWait: null,
    scenario: 'normal',
    pos: null,
  };

  const emit = (type, data = {}) => { data.type = type; data.t = S.t; S.events.push(data); };
  const block = (h) => S.blocks.get(h);
  const parentOf = (b) => (b ? S.blocks.get(b.header.prev) : null);
  const tipOf = (n) => S.blocks.get(n.tip);

  /* ----- Validation ----- */

  function sigsValid(tx) {
    if (tx.coinbase !== undefined) return true;
    if (S.sigCache.has(tx.id)) return S.sigCache.get(tx.id);
    let ok = true;
    try {
      tx.ins.forEach((inp, i) => {
        if (ok && !C.verify(sighash(tx, i), { r: BigInt('0x' + inp.r), s: BigInt('0x' + inp.s) }, C.decodePoint(C.fromHex(inp.pub)))) ok = false;
      });
    } catch (e) { ok = false; }
    S.sigCache.set(tx.id, ok);
    return ok;
  }

  function checkTx(tx, utxo, used) {
    if (tx.coinbase !== undefined) return { ok: true, fee: 0 };
    let inSum = 0;
    for (const inp of tx.ins) {
      const key = inp.txid + ':' + inp.vout;
      if (used && used.has(key)) return { ok: false, reason: 'spends a coin twice in one block' };
      const u = utxo.get(key);
      if (!u) return { ok: false, reason: 'spends a coin that does not exist or is already spent', missing: key };
      if (C.hex(C.hash160(C.fromHex(inp.pub))) !== u.to) return { ok: false, reason: 'the key does not match the coin\'s owner' };
      inSum += u.value;
    }
    if (!sigsValid(tx)) return { ok: false, reason: 'a signature does not verify' };
    const out = outSum(tx);
    if (out > inSum) return { ok: false, reason: 'pays out more than it spends' };
    return { ok: true, fee: inSum - out };
  }

  function applyTx(utxo, tx, used) {
    for (const inp of tx.ins) { const k = inp.txid + ':' + inp.vout; utxo.delete(k); if (used) used.add(k); }
    tx.outs.forEach((o, i) => utxo.set(tx.id + ':' + i, { value: o.value, to: o.to }));
  }

  // Full check of a block against its parent; fills in its coin set.
  function validateBlock(b) {
    const p = parentOf(b);
    const fail = (reason) => { b.valid = false; b.reason = reason; b.utxo = null; return false; };
    if (b.height > 0) {
      if (!p) return fail('its parent is unknown');
      if (!p.valid) return fail('it builds on an invalid block');
      if (b.height !== p.height + 1) return fail('wrong height');
    }
    if (C.headerHash(b.header) !== b.hash) return fail('its hash does not match its header');
    if (b.kind === 'pow' && !C.meetsTarget(b.hash, b.header.bits)) return fail('its hash does not meet the proof-of-work target');
    if (b.kind === 'pos' && b.sig && !C.verify(C.sha256(C.fromHex(b.hash)), b.sig, node(b.miner).key.pub)) return fail('the proposer\'s signature does not verify');
    if (C.merkleRoot(b.txs.map((t) => t.id)) !== b.header.merkle) return fail('its Merkle root does not match its transactions');
    const utxo = new Map(p ? p.utxo : []);
    const used = new Set();
    let fees = 0;
    for (const tx of b.txs.slice(1)) {
      if (txidOf(tx) !== tx.id) return fail('a transaction ID does not match its contents');
      const r = checkTx(tx, utxo, used);
      if (!r.ok) return fail('a transaction ' + r.reason);
      fees += r.fee;
      applyTx(utxo, tx, used);
    }
    const cb = b.txs[0];
    if (txidOf(cb) !== cb.id) return fail('the coinbase ID does not match its contents');
    if (b.height > 0 && outSum(cb) > SUBSIDY + fees) return fail('the miner paid itself more than the reward plus fees');
    applyTx(utxo, cb, null);
    b.valid = true;
    b.reason = null;
    b.fees = fees;
    b.utxo = utxo;
    return true;
  }

  /* ----- Building blocks ----- */

  function coinbaseTx(height, n, value) {
    const tx = { coinbase: height, tag: n.id, ins: [], outs: [{ value, to: C.hex(n.key.hash160) }] };
    tx.id = txidOf(tx);
    tx.fee = 0; tx.vsize = vsizeOf(tx); tx.feeRate = 0; tx.from = null; tx.toId = n.id; tx.amount = value;
    return tx;
  }

  const headerTime = () => T0 + Math.round(S.t * 60);

  function makeBlock(parent, txs, n, kind) {
    const height = parent ? parent.height + 1 : 0;
    const fees = txs.reduce((a, t) => a + (t.fee || 0), 0);
    const cb = height === 0 ? genesisTx() : coinbaseTx(height, n, SUBSIDY + fees);
    const all = [cb, ...txs];
    const header = {
      version: 0x20000000,
      prev: parent ? parent.hash : '0'.repeat(64),
      merkle: C.merkleRoot(all.map((t) => t.id)),
      time: headerTime(),
      bits: kind === 'pow' ? C.bitsForZeros(knobs.zeroBits) : 0x2100ffff,
      nonce: 0,
    };
    return { header, height, txs: all, miner: n ? n.id : null, kind, fees, hash: null, valid: false };
  }

  function genesisTx() {
    const tx = { coinbase: 0, tag: 'genesis', ins: [], outs: [] };
    for (const n of nodes) if (n.coins) tx.outs.push({ value: n.coins * COIN, to: C.hex(n.key.hash160) });
    tx.id = txidOf(tx);
    tx.fee = 0; tx.vsize = vsizeOf(tx); tx.feeRate = 0; tx.from = null;
    return tx;
  }

  // Choose transactions for a block on `parent`: highest fee rate first, as
  // long as they fit and are valid on that chain.
  function selectTxs(parent, n, { include = [], skipMempool = false } = {}) {
    const utxo = new Map(parent.utxo);
    const used = new Set();
    const pool = skipMempool ? [] : [...S.mempool.values()].filter((tx) => n.seenTx.has(tx.id)).sort((a, b) => b.feeRate - a.feeRate);
    const cands = [...include, ...pool];
    const out = [];
    const taken = new Set();
    let vsize = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const tx of cands) {
        if (taken.has(tx.id) || vsize + tx.vsize > knobs.maxBlockVsize) continue;
        const r = checkTx(tx, utxo, used);
        if (!r.ok) continue;
        applyTx(utxo, tx, used);
        out.push(tx);
        taken.add(tx.id);
        vsize += tx.vsize;
      }
    }
    return out;
  }

  function registerBlock(b) {
    b.hash = b.hash || C.headerHash(b.header);
    if (S.blocks.has(b.hash)) return S.blocks.get(b.hash);
    validateBlock(b);
    const p = parentOf(b);
    b.work = (p ? p.work : 0) + (b.kind === 'pow' ? Math.pow(2, C.leadingZeroBits(C.bitsToTarget(b.header.bits).toString(16).padStart(64, '0')) - 16) : 1);
    b.born = S.t;
    b.canon = false;
    b.lane = 0;
    b.seq = S.seq++;
    S.blocks.set(b.hash, b);
    if (p) {
      if (!S.children.has(p.hash)) S.children.set(p.hash, []);
      S.children.get(p.hash).push(b.hash);
    }
    return b;
  }

  /* ----- Mining (proof of work) ----- */

  function startJob(n, { parent = null, include = [], priv = false, attack = false, onDone = null } = {}) {
    const p = parent || tipOf(n);
    if (!p || !p.utxo) return null;
    const txs = selectTxs(p, n, { include });
    const b = makeBlock(p, txs, n, 'pow');
    const job = { n, b, miner: C.headerMiner(b.header), nonce: (rng() * 4000000000) >>> 0, priv, attack, onDone };
    S.jobs.push(job);
    return job;
  }

  function runJobs(budgetMs) {
    const t0 = now();
    while (S.jobs.length && now() - t0 < budgetMs) {
      const j = S.jobs[0];
      const before = j.miner.hashes;
      const found = j.miner.search(j.nonce, 3000);
      S.realHashes += j.miner.hashes - before;
      if (found < 0) { j.nonce = (j.nonce + 3000) >>> 0; continue; }
      S.jobs.shift();
      j.b.header.nonce = found;
      finishBlock(j);
    }
  }

  function finishBlock(j) {
    const b = registerBlock(j.b);
    const n = j.n;
    b.private = j.priv;
    b.attack = j.attack;
    if (b.kind === 'pow' && !b.private) {
      if (S.lastBlockAt && S.warmLeft <= 0) S.intervals.push(S.t - S.lastBlockAt);
      if (S.intervals.length > 40) S.intervals.shift();
      S.lastBlockAt = S.t;
    }
    learn(n, b);
    if (S.attack && n.id === S.attack.node && j.attack) {
      S.attack.tip = b.hash;
      S.attack.blocks.push(b.hash);
      n.tip = b.hash;
    } else if (!n.slashed) {
      considerTip(n, b);
    }
    emit('found', { node: n.id, hash: b.hash, private: b.private });
    if (!b.private) broadcastBlock(n, b, null);
    if (j.onDone) j.onDone(b);
    afterBlocksChanged();
  }

  function powTick(dt) {
    if (S.suspendMining) return;
    const attacking = S.attack && S.attack.mining;
    for (const n of nodes) {
      if (!n.hash || !n.online) continue;
      if (S.jobs.some((j) => j.n === n && !j.attack)) continue;
      const lambda = n.hash / knobs.blockTime;
      if (rng() < lambda * dt) startJob(n);
    }
    // The attacker's hash power is extra (rented, or new machines), so it is
    // `share` of the new total: share / (1 - share) times the honest rate.
    if (attacking && !S.jobs.some((j) => j.attack)) {
      const lambda = S.attack.share / (1 - S.attack.share) / knobs.blockTime;
      if (rng() < lambda * dt) {
        const m = node(S.attack.node);
        const include = S.attack.include.filter((tx) => !chainHas(block(S.attack.tip), tx.id));
        startJob(m, { parent: block(S.attack.tip), include, priv: S.attack.private, attack: true });
      }
    }
  }

  function chainHas(b, txid) {
    for (let x = b; x; x = parentOf(x)) if (x.txs.some((t) => t.id === txid)) return true;
    return false;
  }

  /* ----- Gossip ----- */

  function learn(n, b) {
    // A node that hears of a block fetches any ancestors it is missing.
    const chain = [];
    for (let x = b; x && !n.known.has(x.hash); x = parentOf(x)) chain.push(x);
    for (const x of chain) { n.known.add(x.hash); n.seenAt.set(x.hash, S.t); }
  }

  function canSend(a, b) {
    const na = node(a), nb = node(b);
    if (!na.online || !nb.online) return false;
    if (S.partition && na.west !== nb.west) return false;
    return true;
  }

  function hopTime(a, b) {
    const e = edgeOf(a, b);
    return knobs.latency * (0.55 + 0.45 * e.len / 2) * (0.8 + 0.4 * rng());
  }

  function send(kind, from, to, id, extra) {
    const dur = hopTime(from, to);
    S.messages.push(Object.assign({ kind, from, to, id, t0: S.t, t1: S.t + dur }, extra));
  }

  function broadcastBlock(n, b, except, only) {
    for (const p of n.peers) {
      if (p === except || (only && !only.includes(p))) continue;
      if (!canSend(n.id, p)) continue;
      if (node(p).known.has(b.hash)) continue;
      send('block', n.id, p, b.hash, { bad: !b.valid });
    }
  }

  function broadcastTx(n, tx, except) {
    for (const p of n.peers) {
      if (p === except || !canSend(n.id, p) || node(p).seenTx.has(tx.id)) continue;
      send('tx', n.id, p, tx.id, { feeRate: tx.feeRate });
    }
  }

  function deliver(m) {
    const n = node(m.to);
    if (!n.online || (S.partition && node(m.from).west !== n.west)) return;
    if (m.kind === 'tx') {
      if (n.seenTx.has(m.id)) return;
      const tx = S.txs.get(m.id);
      n.seenTx.add(m.id);
      if (S.mempool.has(m.id) || !S.confirmed.has(m.id)) broadcastTx(n, tx, m.from);
      return;
    }
    if (m.kind === 'block') {
      const b = block(m.id);
      if (!b || n.known.has(b.hash) || (n.rejected && n.rejected.has(b.hash))) return;
      if (!b.valid) {
        n.rejected = n.rejected || new Set();
        n.rejected.add(b.hash);
        emit('reject', { node: n.id, hash: b.hash, reason: b.reason });
        return;
      }
      learn(n, b);
      for (const tx of b.txs) n.seenTx.add(tx.id);
      if (S.attack && n.id === S.attack.node) { broadcastBlock(n, b, m.from); return; }
      if (S.mode === 'pos') noteEquivocation(n, b);
      considerTip(n, b);
      broadcastBlock(n, b, m.from);
    }
  }

  // Fork choice. Proof of work: the chain with the most work wins, and on a
  // tie a node keeps the block it saw first. Proof of stake: see ghostHead().
  function considerTip(n, b) {
    const old = tipOf(n);
    let next;
    if (S.mode === 'pos') next = ghostHead(n);
    else next = !old || b.work > old.work + 1e-9 ? b : old;
    if (!next || next === old) return;
    n.tip = next.hash;
    if (old && !isAncestor(old, next)) {
      const fork = forkPoint(old, next);
      emit('reorg', { node: n.id, depth: old.height - fork.height, from: old.hash, to: next.hash });
    }
  }

  function isAncestor(a, b) {
    let x = b;
    while (x && x.height > a.height) x = parentOf(x);
    return x === a;
  }

  function forkPoint(a, b) {
    while (a && b && a !== b) {
      if (a.height >= b.height) a = parentOf(a);
      else b = parentOf(b);
    }
    return a || b;
  }

  /* ----- Consensus as the network sees it ----- */

  function honestNodes() {
    return nodes.filter((n) => n.online && !(S.attack && n.id === S.attack.node));
  }

  function computeCanonical() {
    const weight = new Map();
    for (const n of honestNodes()) {
      const w = S.mode === 'pos' ? n.activeStake + 1e-6 : 1;
      weight.set(n.tip, (weight.get(n.tip) || 0) + w);
    }
    let best = null;
    for (const [h, w] of weight) {
      const b = block(h);
      if (!b) continue;
      if (!best) { best = b; continue; }
      const score = S.mode === 'pos' ? [w, b.height] : [b.work, w];
      const bestScore = S.mode === 'pos' ? [weight.get(best.hash), best.height] : [best.work, weight.get(best.hash)];
      if (score[0] > bestScore[0] + 1e-9 || (Math.abs(score[0] - bestScore[0]) <= 1e-9 && score[1] > bestScore[1])) best = b;
    }
    return best;
  }

  function setCanonical(nb) {
    const ob = block(S.canonical);
    if (!nb || ob === nb) return;
    const removed = [], added = [];
    let a = ob, b = nb;
    while (a !== b) {
      if (a && (!b || a.height >= b.height)) { removed.push(a); a = parentOf(a); }
      else { added.push(b); b = parentOf(b); }
    }
    const returned = [];
    for (const x of removed) {
      x.canon = false;
      for (const tx of x.txs.slice(1)) { S.confirmed.delete(tx.id); returned.push(tx); }
    }
    for (const x of added.reverse()) {
      x.canon = true;
      for (const tx of x.txs.slice(1)) { S.confirmed.set(tx.id, x.hash); S.mempool.delete(tx.id); S.conflicted.delete(tx.id); }
    }
    let back = 0;
    for (const tx of returned) if (!S.confirmed.has(tx.id)) { S.mempool.set(tx.id, tx); back++; }
    S.canonical = nb.hash;
    if (removed.length && ob) emit('canonReorg', { depth: removed.length, returned: back, from: ob.hash, to: nb.hash });
    revalidateMempool(nb);
  }

  // Drop waiting transactions that can no longer be valid (their coins were
  // spent by something else): the fate of the loser of a double spend.
  function revalidateMempool(tip) {
    if (!tip.utxo) return;
    const work = new Map(tip.utxo);
    const list = [...S.mempool.values()].sort((a, b) => a.seq - b.seq);
    for (const tx of list) {
      const r = checkTx(tx, work, null);
      if (r.ok) { applyTx(work, tx, null); continue; }
      S.mempool.delete(tx.id);
      S.conflicted.add(tx.id);
      emit('conflicted', { txid: tx.id, tracked: S.tracked.has(tx.id) });
    }
  }

  function afterBlocksChanged() {
    const c = computeCanonical();
    if (c) setCanonical(c);
    relane();
  }

  // Lanes for drawing: the canonical chain is lane 0; each side branch gets
  // its own lane so the scene can draw it beside the main chain.
  function relane() {
    const tip = block(S.canonical);
    if (!tip) return;
    const lo = tip.height - 40;
    const list = [...S.blocks.values()].filter((b) => b.height >= lo).sort((a, b) => a.height - b.height || a.seq - b.seq);
    const continued = new Set();
    let next = 1;
    for (const b of list) {
      if (b.canon) { b.lane = 0; continue; }
      const p = parentOf(b);
      if (p && !p.canon && p.lane && !continued.has(p.hash)) { b.lane = p.lane; continued.add(p.hash); continue; }
      b.lane = next;
      next = next >= 3 ? 1 : next + 1;
    }
  }

  /* ----- Wallets ----- */

  // Wallets spend from the chain the network agrees on (a phone wallet asks
  // several nodes, and spending coins a block is about to spend causes conflicts).
  function walletView() {
    return block(S.canonical);
  }

  function pendingSpends() {
    const s = new Set();
    for (const tx of S.mempool.values()) for (const i of tx.ins) s.add(i.txid + ':' + i.vout);
    return s;
  }

  function coinsOf(id, view) {
    const n = node(id);
    const t = view || block(S.canonical);
    if (!t || !t.utxo) return [];
    const mine = new Set([C.hex(n.key.hash160)]);
    if (n.key2) mine.add(C.hex(n.key2.hash160));
    const out = [];
    for (const [k, u] of t.utxo) if (mine.has(u.to)) out.push({ key: k, txid: k.slice(0, 64), vout: Number(k.slice(65)), value: u.value, to: u.to });
    return out.sort((a, b) => b.value - a.value);
  }

  const balance = (id) => coinsOf(id).reduce((a, c) => a + c.value, 0);

  function estimateFeeRate(blocks = 1) {
    const list = [...S.mempool.values()].sort((a, b) => b.feeRate - a.feeRate);
    const cap = knobs.maxBlockVsize * blocks * 0.95;
    let v = 0;
    for (const tx of list) { v += tx.vsize; if (v >= cap) return Math.max(1, Math.ceil(tx.feeRate + 1)); }
    return 1;
  }

  // Build and sign a payment. Spends the payer's largest coins first and
  // sends the change back to the payer.
  function buildPayment(fromId, toId, amount, { feeRate = null, urgency = 'normal', toKey = null, coins = null } = {}) {
    const from = node(fromId);
    const rate = feeRate || Math.max(1, Math.round(estimateFeeRate(urgency === 'high' ? 1 : urgency === 'low' ? 6 : 3) * (1 + 0.4 * rng())));
    const pending = pendingSpends();
    const avail = coins || coinsOf(fromId, walletView(from)).filter((c) => !pending.has(c.key));
    const picked = [];
    let sum = 0;
    for (const c of avail) {
      picked.push(c);
      sum += c.value;
      if (sum >= amount + rate * (11 + 68 * picked.length + 62)) break;
    }
    const fee = rate * (11 + 68 * picked.length + 62);
    if (sum < amount + fee) return null;
    const toHash = toKey ? C.hex(toKey.hash160) : C.hex(node(toId).key.hash160);
    const tx = { ins: picked.map((c) => ({ txid: c.txid, vout: c.vout })), outs: [{ value: amount, to: toHash }] };
    const change = sum - amount - fee;
    if (change >= DUST) tx.outs.push({ value: change, to: C.hex(from.key.hash160) });
    const keys = picked.map((c) => (from.key2 && c.to === C.hex(from.key2.hash160) ? from.key2 : from.key));
    signTx(tx, keys);
    tx.vsize = vsizeOf(tx);
    tx.fee = sum - outSum(tx);
    tx.feeRate = tx.fee / tx.vsize;
    tx.from = fromId;
    tx.toId = toId;
    tx.amount = amount;
    tx.seq = S.seq++;
    tx.created = S.t;
    return tx;
  }

  function broadcast(fromId, tx) {
    const n = node(fromId);
    S.txs.set(tx.id, tx);
    S.mempool.set(tx.id, tx);
    n.seenTx.add(tx.id);
    broadcastTx(n, tx, null);
    emit('tx', { node: fromId, txid: tx.id });
    return tx;
  }

  function pay(fromId, toId, amount, o = {}) {
    const tx = buildPayment(fromId, toId, amount, o);
    if (!tx) return null;
    if (o.label) tx.label = o.label;
    if (o.track) S.tracked.add(tx.id);
    return broadcast(fromId, tx);
  }

  const PAYERS = nodes;

  function randomPayment() {
    const cands = PAYERS.filter((n) => n.online && !(S.attack && n.id === S.attack.node)).map((n) => ({ n, w: Math.sqrt(Math.max(0, balance(n.id) / COIN - 0.3)) })).filter((c) => c.w > 0);
    const total = cands.reduce((a, c) => a + c.w, 0);
    if (!total) return null;
    let r = rng() * total, from = cands[0].n;
    for (const c of cands) { r -= c.w; if (r <= 0) { from = c.n; break; } }
    const payees = nodes.filter((n) => n !== from && n.kind !== 'pool' && n.kind !== 'miner');
    const to = payees[Math.floor(rng() * payees.length)];
    const bal = balance(from.id);
    const coffee = to.kind === 'shop' && rng() < 0.6;
    let amount = coffee ? Math.round((0.004 + rng() * 0.02) * COIN) : Math.round(bal * (0.02 + rng() * 0.18) / 100000) * 100000;
    amount = Math.max(amount, 200000);
    const u = rng();
    return pay(from.id, to.id, amount, { urgency: u < 0.3 ? 'high' : u < 0.8 ? 'normal' : 'low' });
  }

  /* ----- Attacks ----- */

  function startAttack({ share, base, include = [], priv = true }) {
    const m = node('mallory');
    S.attack = { node: 'mallory', share, tip: base, base, include, private: priv, blocks: [], mining: true, started: S.t };
    m.hash = 0;
    m.tip = base;
  }

  function releaseAttack() {
    const a = S.attack;
    if (!a) return;
    const m = node(a.node);
    for (const h of a.blocks) {
      const b = block(h);
      if (b.private) { b.private = false; }
    }
    a.mining = false;
    S.attack = null;
    S.jobs = S.jobs.filter((j) => !j.attack);
    const tip = block(a.tip);
    m.tip = tip.hash;
    for (const h of a.blocks) for (const tx of block(h).txs) m.seenTx.add(tx.id);
    broadcastBlock(m, tip, null);
    emit('release', { node: m.id, hash: tip.hash, count: a.blocks.length });
    afterBlocksChanged();
  }

  function stopAttack() {
    const a = S.attack;
    if (!a) return;
    S.attack = null;
    S.jobs = S.jobs.filter((j) => !j.attack);
    const m = node(a.node);
    m.tip = S.canonical;
    afterBlocksChanged();
  }

  // A transaction that spends the same coins as `tx` but pays Mallory's
  // other address: the other half of a double spend.
  function conflictingTx(tx, toKey) {
    const from = node(tx.from);
    const coins = tx.ins.map((i) => {
      const u = findOutput(i.txid, i.vout);
      return { txid: i.txid, vout: i.vout, value: u.value, to: u.to, key: i.txid + ':' + i.vout };
    });
    const total = coins.reduce((a, c) => a + c.value, 0);
    const rate = Math.ceil(tx.feeRate);
    const out = { ins: coins.map((c) => ({ txid: c.txid, vout: c.vout })), outs: [{ value: total - rate * (11 + 68 * coins.length + 31), to: C.hex(toKey.hash160) }] };
    signTx(out, coins.map((c) => (from.key2 && c.to === C.hex(from.key2.hash160) ? from.key2 : from.key)));
    out.vsize = vsizeOf(out);
    out.fee = total - outSum(out);
    out.feeRate = out.fee / out.vsize;
    out.from = tx.from;
    out.toId = tx.from;
    out.amount = outSum(out);
    out.seq = S.seq++;
    out.private = true;
    S.txs.set(out.id, out);
    return out;
  }

  function findOutput(txid, vout) {
    const tx = S.txs.get(txid) || findTxInChain(txid);
    return tx ? tx.outs[vout] : null;
  }

  function findTxInChain(txid) {
    for (const b of S.blocks.values()) for (const t of b.txs) if (t.id === txid) return t;
    return null;
  }

  // A copy of block b with one transaction's first output redirected, and
  // nothing else redone: the naive edit. Returns the forged block (invalid).
  function forgeEdit(b, txid, toKey, { register = true, times = 0 } = {}) {
    const txs = b.txs.map((t) => {
      if (t.id !== txid) return t;
      const c = JSON.parse(JSON.stringify(t));
      if (times) c.outs[0].value *= times;
      else c.outs[0].to = C.hex(toKey.hash160);
      c.id = txidOf(c);
      c.edited = true;
      return c;
    });
    const header = Object.assign({}, b.header, { merkle: C.merkleRoot(txs.map((t) => t.id)) });
    const f = { header, height: b.height, txs, miner: b.miner, kind: b.kind, fees: b.fees, forged: true, hash: C.headerHash(header) };
    if (!register) { validateBlock(f); return f; }
    return registerBlock(f);
  }

  /* ----- Proof of stake ----- */

  const epochOf = (slot) => Math.floor(slot / knobs.slotsPerEpoch);
  const validators = () => nodes.filter((n) => !n.slashed);
  const totalStake = () => validators().reduce((a, n) => a + n.activeStake, 0);

  function setMode(mode) {
    if (mode === S.mode) return;
    S.mode = mode;
    S.jobs = S.jobs.filter((j) => j.attack);
    if (mode === 'pos') {
      // The Merge, in miniature: the current tip becomes the anchor, already
      // justified and final, and blocks from now on are proposed, not mined.
      const anchor = block(S.canonical);
      const slot = Math.floor(S.t / knobs.slotTime);
      anchor.slot = anchor.slot !== undefined ? anchor.slot : slot;
      anchor.justified = anchor.finalized = true;
      S.pos = {
        slot, anchor: anchor.hash, votes: new Map(), cps: new Map(),
        justified: anchor.hash, justifiedEpoch: epochOf(slot), finalized: anchor.hash, finalizedEpoch: epochOf(slot),
        attested: new Set(), equivocations: [], proposers: new Map(), missed: 0, forcedProposer: null, lastEpoch: epochOf(slot),
      };
      const rec = { epoch: epochOf(slot), hash: anchor.hash, stake: totalStake(), voters: new Set(), justified: true };
      S.pos.cps.set(rec.epoch + '|' + rec.hash, rec);
      for (let x = parentOf(anchor); x && !x.finalized; x = parentOf(x)) x.finalized = true;
      emit('mode', { mode });
    } else {
      emit('mode', { mode });
    }
    for (const n of nodes) if (mode === 'pow' && !(S.attack && n.id === S.attack.node)) n.tip = S.canonical;
    afterBlocksChanged();
  }

  // Ethereum picks each slot's proposer pseudo-randomly in proportion to
  // stake, from randomness the validators themselves mix in (RANDAO). Here a
  // hash of the seed and slot number stands in for it.
  function proposerFor(slot) {
    if (S.pos.forcedProposer && S.pos.forcedProposer.slot === slot) return node(S.pos.forcedProposer.id);
    const vals = validators();
    const total = totalStake();
    const h = C.sha256(C.utf8('randao ' + seed + ' ' + slot));
    let r = ((h[0] << 24 | h[1] << 16 | h[2] << 8 | h[3]) >>> 0) / 4294967296 * total;
    for (const v of vals) { r -= v.activeStake; if (r <= 0) return v; }
    return vals[vals.length - 1];
  }

  function signBlock(b, n) {
    b.hash = C.headerHash(b.header);
    b.sig = C.sign(C.sha256(C.fromHex(b.hash)), n.key.d);
  }

  function proposeBlock(n, slot, { variant = 0, sendTo = null } = {}) {
    const parent = tipOf(n);
    if (!parent || !parent.utxo) return null;
    let txs = selectTxs(parent, n);
    if (variant) txs = txs.slice(0, Math.max(0, txs.length - variant));
    const b = makeBlock(parent, txs, n, 'pos');
    b.slot = slot;
    b.header.time = T0 + Math.round(slot * knobs.slotTime * 60);
    b.header.nonce = slot >>> 0;
    if (variant) b.header.version = 0x20000000 + variant;
    const ev = S.pos.equivocations.find((e) => !e.included && n.known.has(e.a) && n.known.has(e.b));
    if (ev && n.id !== ev.validator) { b.slashings = [ev.validator]; ev.included = true; }
    signBlock(b, n);
    const reg = registerBlock(b);
    reg.private = false;
    learn(n, reg);
    n.tip = reg.hash;
    broadcastBlock(n, reg, null, sendTo);
    emit('found', { node: n.id, hash: reg.hash, slot });
    afterBlocksChanged();
    return reg;
  }

  function noteEquivocation(n, b) {
    if (b.kind !== 'pos' || b.slot === undefined) return;
    for (const h of n.known) {
      if (h === b.hash) continue;
      const o = block(h);
      if (o && o.kind === 'pos' && o.slot === b.slot && o.miner === b.miner) {
        if (!S.pos.equivocations.some((e) => e.validator === b.miner && e.slot === b.slot)) {
          S.pos.equivocations.push({ validator: b.miner, slot: b.slot, a: o.hash, b: b.hash, included: false });
          emit('equivocation', { node: n.id, validator: b.miner, slot: b.slot });
        }
      }
    }
  }

  function applySlashings() {
    let depth = 0;
    for (let x = block(S.canonical); x && x.kind === 'pos' && depth < 16; x = parentOf(x), depth++) {
      if (!x.slashings || x.slashApplied) continue;
      x.slashApplied = true;
      for (const id of x.slashings) {
        const v = node(id);
        if (v.slashed) continue;
        v.slashed = true;
        v.penalty = v.activeStake / 32;
        v.activeStake -= v.penalty;
        emit('slashed', { node: id, by: x.miner, hash: x.hash });
      }
    }
  }

  function checkpointFor(head, epoch) {
    const boundary = epoch * knobs.slotsPerEpoch;
    let b = head;
    while (b && b.slot !== undefined && b.slot > boundary && b.hash !== S.pos.anchor) b = parentOf(b);
    return b;
  }

  // GHOST, simplified: from the latest justified checkpoint, keep stepping to
  // the child whose subtree has the most stake voting for it.
  function ghostHead(n) {
    let b = block(S.pos.justified);
    if (!b || !n.known.has(b.hash)) b = block(S.pos.finalized);
    if (!b || !n.known.has(b.hash)) return tipOf(n);
    for (;;) {
      const kids = (S.children.get(b.hash) || []).map(block).filter((k) => k.valid && n.known.has(k.hash) && !k.private);
      if (!kids.length) return b;
      if (kids.length === 1) { b = kids[0]; continue; }
      let best = null, bestW = -1;
      for (const k of kids) {
        let w = 0;
        for (const [vid, vote] of S.pos.votes) {
          const h = block(vote.head);
          if (h && isAncestor(k, h)) w += node(vid).activeStake;
        }
        const seen = n.seenAt.get(k.hash);
        if (w > bestW || (w === bestW && seen < n.seenAt.get(best.hash))) { best = k; bestW = w; }
      }
      b = best;
    }
  }

  function attest(v) {
    const head = tipOf(v);
    if (!head) return;
    const epoch = epochOf(S.pos.slot);
    const cp = checkpointFor(head, epoch);
    S.pos.votes.set(v.id, { head: head.hash, epoch, target: cp.hash });
    const key = epoch + '|' + cp.hash;
    let rec = S.pos.cps.get(key);
    if (!rec) { rec = { epoch, hash: cp.hash, stake: 0, voters: new Set(), justified: false }; S.pos.cps.set(key, rec); }
    if (!rec.voters.has(v.id)) { rec.voters.add(v.id); rec.stake += v.activeStake; }
    emit('attest', { node: v.id, hash: head.hash, target: cp.hash });
    if (!rec.justified && rec.stake >= (2 / 3) * totalStake()) justify(rec);
  }

  function justify(rec) {
    rec.justified = true;
    const b = block(rec.hash);
    b.justified = true;
    if (rec.epoch >= S.pos.justifiedEpoch) { S.pos.justified = rec.hash; S.pos.justifiedEpoch = rec.epoch; }
    emit('justified', { hash: rec.hash, epoch: rec.epoch });
    // Two justified checkpoints in a row finalize the first (Casper FFG).
    for (const prev of S.pos.cps.values()) {
      if (prev.epoch !== rec.epoch - 1 || !prev.justified) continue;
      const pb = block(prev.hash);
      if (!isAncestor(pb, b) && pb !== b) continue;
      if (pb.finalized && prev.epoch <= S.pos.finalizedEpoch) continue;
      for (let x = pb; x && !x.finalized; x = parentOf(x)) x.finalized = true;
      S.pos.finalized = pb.hash;
      S.pos.finalizedEpoch = prev.epoch;
      emit('finalized', { hash: pb.hash, epoch: prev.epoch });
    }
  }

  function posTick() {
    const P = S.pos;
    const slot = Math.floor(S.t / knobs.slotTime);
    while (P.slot < slot) {
      P.slot++;
      P.attested = new Set();
      const epoch = epochOf(P.slot);
      if (epoch !== P.lastEpoch) { P.lastEpoch = epoch; onEpoch(epoch); }
      const v = proposerFor(P.slot);
      P.proposers.set(P.slot, v.id);
      if (P.proposers.size > 64) P.proposers.delete(P.proposers.keys().next().value);
      if (!v.online || v.slashed) { P.missed++; emit('missed', { node: v.id, slot: P.slot }); continue; }
      if (P.forcedProposer && P.forcedProposer.slot === P.slot && P.forcedProposer.equivocate) {
        const west = v.peers.filter((p) => node(p).west), east = v.peers.filter((p) => !node(p).west);
        const a = proposeBlock(v, P.slot, { sendTo: west.length ? west : v.peers.slice(0, 2) });
        const parentTip = a ? parentOf(a) : null;
        if (parentTip) v.tip = parentTip.hash;
        const b = proposeBlock(v, P.slot, { variant: 1, sendTo: east.length ? east : v.peers.slice(2) });
        if (a && b) { v.tip = a.hash; noteEquivocation(v, b); emit('doubleSign', { node: v.id, a: a.hash, b: b.hash, slot: P.slot }); }
        continue;
      }
      proposeBlock(v, P.slot);
    }
    // Validators attest halfway through their assigned slot.
    if (S.t >= (P.slot + 0.5) * knobs.slotTime) {
      for (const v of validators()) {
        if (!v.online || P.attested.has(v.id)) continue;
        if (v.index % knobs.slotsPerEpoch !== P.slot % knobs.slotsPerEpoch) continue;
        P.attested.add(v.id);
        attest(v);
      }
    }
  }

  // Each epoch without finality, validators that are not voting lose a growing
  // slice of stake (Ethereum's inactivity leak, much accelerated here) until
  // those still voting hold two-thirds again.
  function onEpoch(epoch) {
    const P = S.pos;
    const since = epoch - P.finalizedEpoch;
    if (since > 2) {
      for (const v of validators()) {
        if (v.online) continue;
        const loss = v.activeStake * Math.min(0.3, 0.06 * (since - 2));
        v.activeStake -= loss;
        v.leaked = (v.leaked || 0) + loss;
      }
      emit('leak', { epoch, since });
    }
  }

  /* ----- Scenario scripts ----- */

  const say = (text, o = {}) => Object.assign({ say: text }, o);
  const wait = (s) => ({ wait: s });
  const until = (fn, timeout = 60) => ({ until: fn, timeout });
  const pct = (x) => Math.round(x * 100) + '%';
  const coins = (sats) => {
    if (sats < 100000) return sats.toLocaleString() + (sats === 1 ? ' satoshi' : ' satoshis');
    const c = sats / COIN;
    return (c >= 100 ? c.toFixed(0) : c.toFixed(4).replace(/\.?0+$/, '')) + (c === 1 ? ' coin' : ' coins');
  };
  const nameOf = (id) => node(id).name;
  const nth = (n) => n + (n === 1 ? ' block' : ' blocks');

  const SCRIPTS = {
    *fork() {
      yield say('Watch the top of the chain. Two pools on opposite sides of the network are about to find a block at almost the same moment.', { focus: 'chain' });
      yield wait(2.5);
      S.forced = { ids: ['poolA', 'poolD'], blocks: [] };
      S.suspendMining = true;
      for (const id of S.forced.ids) startJob(node(id), { onDone: (b) => S.forced.blocks.push(b) });
      yield until(() => S.forced.blocks.length === 2, 10);
      S.suspendMining = false;
      const [a, b] = S.forced.blocks;
      yield wait(knobs.latency * 3);
      yield say(`Pool A and Pool D each found block ${a.height}. The news spreads out from each side, and every node keeps whichever version reached it first, so for now the network disagrees about the newest block. The thin lines show which block each node believes in.`, { pause: true, focus: 'overview' });
      const resolved = () => (S.children.get(a.hash) || []).length + (S.children.get(b.hash) || []).length > 0;
      yield until(resolved, 90);
      const winner = (S.children.get(a.hash) || []).length ? a : b;
      const loser = winner === a ? b : a;
      const child = block((S.children.get(winner.hash))[0]);
      yield until(() => consensus(), 8);
      yield say(`${nameOf(child.miner)} found the next block on top of ${nameOf(winner.miner)}'s. That branch now has more work behind it, so every node switches to it. ${nameOf(loser.miner)}'s block is orphaned: its reward disappears, and its transactions go back to the mempool to be mined again. A payment with one confirmation can be undone this way, without anyone cheating.`, { focus: 'chain' });
      S.forced = null;
    },

    *partition() {
      yield say('An undersea cable breaks. The network splits into a western and an eastern half, and neither half can hear the other.', { focus: 'overview' });
      yield wait(1.5);
      S.partition = true;
      const base = block(S.canonical);
      const westTip = () => tipOf(node('poolA')), eastTip = () => tipOf(node('poolD'));
      yield wait(knobs.blockTime * 2.2);
      yield say(`Both halves keep mining, each unaware of the other, so each builds its own chain from block ${base.height}. The west has 69% of the hash rate, so its chain should grow faster.`);
      yield until(() => westTip().height > base.height && eastTip().height > base.height && westTip().work > eastTip().work, knobs.blockTime * 8);
      yield wait(knobs.blockTime);
      const eastDepth = eastTip().height - forkPoint(westTip(), eastTip()).height;
      S.partition = false;
      // Reconnected nodes trade their latest blocks.
      for (const e of edges) if (e.cross) {
        const a = node(e.a), b = node(e.b);
        broadcastBlock(a, tipOf(a), null, [b.id]);
        broadcastBlock(b, tipOf(b), null, [a.id]);
      }
      yield say(`The cable is repaired and blocks flood across. Every eastern node now sees a chain with more work than its own and switches to it, undoing the last ${nth(eastDepth)} the east mined.`, { focus: 'chain' });
      yield until(() => consensus(), 20);
      const returned = [...S.mempool.values()].filter((t) => t.created < S.t - 3).length;
      yield say(`The network agrees again. The east's blocks are orphaned, and transactions only they contained are back in the mempool${returned ? ` (${returned} waiting now)` : ''}. A payment the east thought was confirmed never was: confirmations count only on the chain that wins.`);
    },

    *tamper() {
      const m = node('mallory');
      yield say('Mallory pays the shop 2 coins for a month of coffee. Watch the payment spread and get mined.', { focus: 'shop' });
      const p = pay('mallory', 'shop', 2 * COIN, { urgency: 'high', track: true, label: 'Mallory\'s coffee' });
      if (!p) { yield say('Mallory has no coins to spend right now. Try again in a minute.'); return; }
      yield until(() => confirmations(p.id) >= 4, knobs.blockTime * 12);
      const blk = block(S.confirmed.get(p.id));
      if (!blk) return;
      yield say(`The payment is in block ${blk.height}, now ${nth(confirmations(p.id))} deep. Mallory wants his coins back, so he edits his copy of block ${blk.height} to pay himself instead, and sends it to his neighbours.`, { focus: 'chain', pause: true });
      const forged = forgeEdit(blk, p.id, m.key2);
      S.lastForged = forged.hash;
      learn(m, forged);
      broadcastBlock(m, forged, null);
      yield wait(knobs.latency * 3);
      yield say(`They throw it away at once (the red block). Changing the recipient broke his signature, which covered the old one; the block's hash changed, so it no longer starts with the required zeros; and block ${blk.height + 1} still points to the old hash, so the chain no longer links.`, { pause: true, focus: 'block:' + forged.hash });
      const parent = parentOf(blk);
      const resigned = conflictingTx(p, m.key2);
      yield say(`So he does it properly: he signs a fresh transaction sending the same coins to himself and re-mines block ${blk.height} with it. That gives a valid block, but it starts a new branch ${nth(block(S.canonical).height - parent.height)} behind the real chain, and Mallory has 10% of the hash rate.`, { focus: 'chain' });
      startAttack({ share: 0.10, base: parent.hash, include: [resigned], priv: false });
      yield wait(knobs.blockTime * 5);
      const mine = S.attack ? S.attack.blocks.length : 0;
      const gap = block(S.canonical).height - (S.attack ? block(S.attack.tip).height : parent.height);
      yield say(`${mine ? `He has mined ${nth(mine)}, and every node accepts them as valid and then ignores them, because they sit on a chain with less work.` : 'He hasn\'t found a single block yet.'} The rest of the network finds nine blocks for each of his, so his branch is now ${nth(gap)} behind and falling further back. To make the edit stick he would need more hash power than everyone else combined: a 51% attack.`);
      yield wait(knobs.blockTime * 2);
      stopAttack();
    },

    *doublespend() {
      const q = clamp(knobs.attackShare, 0.05, 0.9), k = Math.round(clamp(knobs.confirmations, 1, 10));
      const m = node('mallory');
      const price = Math.min(20, Math.floor(balance('mallory') / COIN * 0.7)) * COIN;
      if (price < COIN) { yield say('Mallory is short of coins for this; try again after a few blocks.'); return; }
      yield say(`Mallory rents ${pct(q)} of all mining power for the afternoon (hash-rental markets make this possible for smaller coins) and points it at a secret chain of his own.`, { focus: 'overview' });
      const base = block(S.canonical);
      const p = pay('mallory', 'shop', price, { urgency: 'high', track: true, label: 'a used car' });
      const steal = conflictingTx(p, m.key2);
      startAttack({ share: q, base: base.hash, include: [steal], priv: true });
      yield say(`Then he pays the shop ${coins(price)} for a used car. In his secret chain he puts a different transaction that sends the same coins to another of his own addresses. Only one of the two can ever be valid. The shop will hand over the keys after ${nth(k).replace('block', 'confirmation')}.`, { focus: 'shop', pause: true });
      const lead = () => (S.attack ? block(S.attack.tip).work - block(S.canonical).work : -99);
      yield until(() => confirmations(p.id) >= k || lead() < -6, knobs.blockTime * (k + 30));
      if (confirmations(p.id) >= k) {
        const l = Math.round(lead());
        yield say(`The payment has ${k} confirmation${k > 1 ? 's' : ''}, so the shop hands over the car. Mallory's secret chain is ${l > 0 ? `${nth(l)} ahead` : l < 0 ? `${nth(-l)} behind` : 'level with the public chain'}.`, { focus: 'chain' });
        yield wait(4);
      }
      yield until(() => (confirmations(p.id) >= k && lead() > 0.5) || lead() < -6, knobs.blockTime * 30);
      if (S.attack && lead() > 0.5) {
        const n = S.attack.blocks.length;
        releaseAttack();
        yield say(`Mallory publishes his secret chain: ${nth(n)}, more work than the public one. Every node switches to it.`, { focus: 'chain' });
        yield until(() => consensus(), 15);
        yield say(`The payment to the shop has vanished from history, and the coins sit in Mallory's other address. The shop has lost a car. This is why exchanges wait for many confirmations, and why it matters that no one controls most of the mining power.`, { focus: 'shop' });
      } else {
        stopAttack();
        yield say(`Mallory falls 6 blocks behind and gives up. He paid for the rented hash power and his secret blocks are worthless. With less than half the hash rate, the odds of ever catching up shrink with every block the shop waits (see 51% attacks).`, { focus: 'chain' });
      }
    },

    *feespike() {
      yield say('A popular launch: suddenly everyone wants to transact at once.', { focus: 'mempool' });
      knobs.demand = 6;
      yield wait(knobs.blockTime * 4.5);
      yield say(`Blocks here hold about a dozen payments, and every one is full. The mempool, the waiting room, has ${S.mempool.size} payments in it. Miners take the highest fee rates first, so wallets bid up: getting into the next block now takes about ${estimateFeeRate(1)} sat/vB, up from 1 or 2. Send one with a low fee and watch it wait.`);
      yield wait(knobs.blockTime * 3);
      knobs.demand = 1;
      yield say('The rush ends. Each block still takes the best-paying payments from the top of the pile, so the backlog clears and fees drift back down.');
      yield until(() => S.mempool.size < 8, knobs.blockTime * 20);
      yield say('Back to normal. Nothing about the protocol changed: block space is fixed, and the fee is its price.');
    },

    *slashing() {
      if (S.mode !== 'pos') setMode('pos');
      yield wait(knobs.slotTime * 1.5);
      yield say('Mallory has been picked to propose the next block, and he cheats: he signs two different blocks for the same slot and sends one to each side of the network.', { focus: 'overview' });
      S.pos.forcedProposer = { id: 'mallory', slot: S.pos.slot + 1, equivocate: true };
      yield until(() => S.pos.equivocations.some((e) => e.validator === 'mallory'), knobs.slotTime * 4);
      yield wait(knobs.latency * 3);
      yield say('For a moment the network is split, as when two miners find blocks at once. But two signatures by one validator on two blocks for one slot are proof of cheating that anyone can check.', { pause: true });
      yield until(() => node('mallory').slashed, knobs.slotTime * 6);
      yield say('The next proposer puts that proof in its block. Mallory is slashed: part of his stake is destroyed and he is forced out of the validator set. Under proof of stake, cheating costs the cheater\'s own money.', { focus: 'mallory' });
      S.pos.forcedProposer = null;
    },

    *offline() {
      if (S.mode !== 'pos') setMode('pos');
      yield wait(knobs.slotTime * 1.5);
      const down = ['poolA', 'exchange'];
      const share = down.reduce((a, id) => a + node(id).activeStake, 0) / totalStake();
      yield say(`A bad software update knocks Pool A and the exchange offline: ${pct(share)} of all stake.`, { focus: 'overview' });
      for (const id of down) node(id).online = false;
      const finalAt = S.pos.finalizedEpoch;
      yield wait(knobs.slotTime * knobs.slotsPerEpoch * 2.5);
      yield say('Blocks keep coming, because any online validator picked for a slot can propose one. But nothing is being finalized: a checkpoint needs votes from two-thirds of all stake, and too little is voting.');
      yield until(() => S.pos.finalizedEpoch > finalAt, knobs.slotTime * knobs.slotsPerEpoch * 14);
      const left = down.reduce((a, id) => a + node(id).activeStake, 0) / totalStake();
      yield say(`Ethereum's answer is the inactivity leak: while finality is stalled, validators who aren't voting lose stake, a little more each epoch, until those who are voting hold two-thirds again. Here it runs much faster. The offline stake is down to ${pct(left)}, and checkpoints are finalizing again.`);
      yield wait(knobs.slotTime * 3);
      for (const id of down) { const n = node(id); n.online = true; n.tip = S.canonical; learn(n, block(S.canonical)); }
      yield say('Pool A and the exchange come back online, poorer. The chain never stopped; it only stopped becoming final for a while.');
    },
  };

  function runScenario(id) {
    stopScenario();
    S.scenario = id;
    const sc = SCENARIOS.find((s) => s.id === id);
    if (sc && sc.mode && sc.mode !== S.mode) setMode(sc.mode);
    S.script = SCRIPTS[id] ? SCRIPTS[id]() : null;
    S.scriptWait = null;
    emit('scenario', { id });
  }

  function stopScenario() {
    if (S.attack) stopAttack();
    S.script = null;
    S.scriptWait = null;
    S.forced = null;
    S.suspendMining = false;
    if (S.partition) {
      S.partition = false;
      for (const n of nodes) learn(n, block(S.canonical));
    }
    knobs.demand = 1;
    for (const n of nodes) if (!n.online) { n.online = true; learn(n, block(S.canonical)); n.tip = S.canonical; }
    if (S.pos) S.pos.forcedProposer = null;
  }

  function resume() { if (S.scriptWait && S.scriptWait.pause) S.scriptWait = null; }

  function stepScript() {
    for (let guard = 0; S.script && guard < 12; guard++) {
      const w = S.scriptWait;
      let result;
      if (w) {
        if (w.pause) return;
        if (w.wait !== undefined && S.t < w.end) return;
        if (w.until) {
          const done = w.until();
          if (!done && S.t < w.end) return;
          result = done;
        }
      }
      S.scriptWait = null;
      let r;
      try { r = S.script.next(result); } catch (e) { S.script = null; throw e; }
      if (r.done) { S.script = null; emit('scriptEnd', { id: S.scenario }); return; }
      const y = r.value;
      if (y.say) { emit('story', { text: y.say, focus: y.focus || null, pause: !!y.pause }); if (y.pause) { S.scriptWait = { pause: true }; return; } continue; }
      if (y.wait !== undefined) { S.scriptWait = { wait: y.wait, end: S.t + y.wait }; continue; }
      if (y.until) { S.scriptWait = { until: y.until, end: S.t + y.timeout }; continue; }
    }
  }

  /* ----- Clock ----- */

  let payAcc = 1;

  function warm(budgetMs = 30) {
    // Before the clock starts: mine a genesis block and a short history,
    // as if the page were a new node downloading the chain.
    const t0 = now();
    if (!S.genesis) {
      const g = makeBlock(null, [], null, 'pow');
      const job = { n: null, b: g, miner: C.headerMiner(g.header), nonce: 0 };
      S.genesisJob = job;
      S.genesis = true;
    }
    if (S.genesisJob) {
      const j = S.genesisJob;
      while (now() - t0 < budgetMs) {
        const before = j.miner.hashes;
        const f = j.miner.search(j.nonce, 3000);
        S.realHashes += j.miner.hashes - before;
        if (f < 0) { j.nonce += 3000; continue; }
        j.b.header.nonce = f;
        const g = registerBlock(j.b);
        g.canon = true;
        S.genesis = g.hash;
        S.canonical = g.hash;
        for (const n of nodes) { n.tip = g.hash; learn(n, g); }
        S.genesisJob = null;
        break;
      }
      if (S.genesisJob) return false;
    }
    while (S.warmLeft > 0 && now() - t0 < budgetMs) {
      if (!S.jobs.length) {
        S.t = -S.warmLeft * knobs.blockTime;
        const k = 2 + Math.floor(rng() * 4);
        for (let i = 0; i < k; i++) {
          const tx = randomPayment();
          if (tx) for (const n of nodes) n.seenTx.add(tx.id);
        }
        S.messages = [];
        const miners = nodes.filter((n) => n.hash);
        let r = rng(), m = miners[0];
        for (const x of miners) { r -= x.hash; if (r <= 0) { m = x; break; } }
        startJob(m);
      }
      runJobs(budgetMs - (now() - t0));
      if (!S.jobs.length) {
        S.warmLeft--;
        const tip = block(S.canonical);
        for (const n of nodes) { learn(n, tip); n.tip = tip.hash; }
        S.messages = [];
      }
    }
    if (S.warmLeft > 0) return false;
    S.t = 0;
    S.lastBlockAt = 0;
    S.events = S.events.filter((e) => e.type === 'story');
    return true;
  }

  function step(dt, budgetMs = 8) {
    S.t += dt;
    // Messages arriving now.
    if (S.messages.length) {
      const due = [];
      S.messages = S.messages.filter((m) => (m.t1 <= S.t ? (due.push(m), false) : true));
      due.sort((a, b) => a.t1 - b.t1);
      let changed = false;
      for (const m of due) { deliver(m); if (m.kind === 'block') changed = true; }
      if (changed) afterBlocksChanged();
    }
    // New payments arrive at random (a Poisson process).
    payAcc -= dt;
    while (payAcc <= 0) {
      randomPayment();
      payAcc += -Math.log(1 - rng()) / (knobs.txRate * knobs.demand);
    }
    if (S.mode === 'pow') powTick(dt);
    else posTick();
    // A visitor shouldn't stare at a quiet chain for a minute because the
    // dice ran cold: if no block has come by the fifth second, one does.
    if (S.mode === 'pow' && !S.lastBlockAt && S.t > 5 && !S.jobs.length && !S.suspendMining) {
      const miners = nodes.filter((n) => n.hash && n.online);
      let r = rng(), m = miners[0];
      for (const x of miners) { r -= x.hash; if (r <= 0) { m = x; break; } }
      startJob(m);
    }
    runJobs(budgetMs);
    if (S.mode === 'pos') {
      applySlashings();
      // Heads move as votes arrive, not only when blocks do.
      if (Math.floor(S.t * 4) !== Math.floor((S.t - dt) * 4)) {
        for (const n of nodes) if (n.online && !(S.attack && n.id === S.attack.node)) considerTip(n, tipOf(n));
        afterBlocksChanged();
      }
    }
    stepScript();
    pruneOld();
  }

  let pruneAt = 0;
  function pruneOld() {
    if (S.t < pruneAt) return;
    pruneAt = S.t + 30;
    const tip = block(S.canonical);
    if (!tip) return;
    for (const b of S.blocks.values()) if (b.height < tip.height - 150 && b.utxo) b.utxo = null;
    for (const [id, tx] of S.txs) if (S.confirmed.has(id) && block(S.confirmed.get(id)).height < tip.height - 150) S.txs.delete(id);
    if (S.sigCache.size > 4000) S.sigCache.clear();
  }

  /* ----- Queries ----- */

  function confirmations(txid) {
    const h = S.confirmed.get(txid);
    if (!h) return 0;
    return block(S.canonical).height - block(h).height + 1;
  }

  function consensus() {
    const tips = new Set(honestNodes().map((n) => n.tip));
    return tips.size === 1;
  }

  function txStatus(txid) {
    const tx = S.txs.get(txid);
    if (S.confirmed.has(txid)) return { state: 'confirmed', conf: confirmations(txid), block: block(S.confirmed.get(txid)), tx };
    if (S.conflicted.has(txid)) return { state: 'conflicted', tx };
    if (S.mempool.has(txid)) return { state: 'mempool', seenBy: nodes.filter((n) => n.seenTx.has(txid)).length, tx };
    return { state: 'unknown', tx };
  }

  function canonicalChain(n = 20) {
    const out = [];
    for (let b = block(S.canonical); b && out.length < n; b = parentOf(b)) out.push(b);
    return out;
  }

  // Re-check a block from scratch, for the inspector: every number recomputed,
  // every signature verified again rather than taken from the cache.
  function verifyReport(b) {
    const p = parentOf(b);
    const checks = [];
    const add = (ok, label, detail) => checks.push({ ok, label, detail });
    const hash = C.headerHash(b.header);
    add(hash === b.hash || b.forged, 'Header hashes to ' + hash.slice(0, 16) + '…', 'double SHA-256 of the 80-byte header');
    if (b.kind === 'pow') add(C.meetsTarget(hash, b.header.bits), 'Hash meets the target', 'needs ' + knobs.zeroBits + ' leading zero bits; has ' + C.leadingZeroBits(hash));
    else add(!!b.sig && C.verify(C.sha256(C.fromHex(hash)), b.sig, node(b.miner).key.pub), 'Signed by the slot\'s proposer', nameOf(b.miner) + ', slot ' + b.slot);
    if (p) {
      const childLinks = (S.children.get(b.hash) || []).length;
      add(b.header.prev === p.hash, 'Links to block ' + p.height, 'previous-block hash ' + p.hash.slice(0, 12) + '…');
      if (b.forged) {
        const realKids = (S.children.get(p.hash) || []).map(block).filter((k) => k.height === b.height && !k.forged);
        const next = realKids.length ? (S.children.get(realKids[0].hash) || []).map(block)[0] : null;
        if (next) add(next.header.prev === hash, 'Block ' + next.height + ' still points to it', 'it points to ' + next.header.prev.slice(0, 12) + '…');
      } else if (childLinks) add(true, 'Block ' + (b.height + 1) + ' points to it', '');
    }
    const root = C.merkleRoot(b.txs.map((t) => txidOf(t)));
    add(root === b.header.merkle, 'Merkle root matches its ' + b.txs.length + ' transactions', root.slice(0, 16) + '…');
    const utxo = new Map(p && p.utxo ? p.utxo : []);
    let fees = 0;
    b.txs.slice(1).forEach((tx, i) => {
      const t0 = now();
      let sigOK = true;
      try {
        tx.ins.forEach((inp, j) => {
          if (sigOK && !C.verify(sighash(tx, j), { r: BigInt('0x' + inp.r), s: BigInt('0x' + inp.s) }, C.decodePoint(C.fromHex(inp.pub)))) sigOK = false;
        });
      } catch (e) { sigOK = false; }
      let coinsOK = true, inSum = 0;
      for (const inp of tx.ins) {
        const u = utxo.get(inp.txid + ':' + inp.vout);
        if (!u || C.hex(C.hash160(C.fromHex(inp.pub))) !== u.to) coinsOK = false;
        else inSum += u.value;
      }
      const sumOK = !coinsOK || outSum(tx) <= inSum;
      if (coinsOK && sumOK) { fees += inSum - outSum(tx); applyTx(utxo, tx, null); }
      const ms = now() - t0;
      const why = !sigOK ? 'signature does not match the transaction' + (sumOK ? '' : ', and it pays out more than it spends')
        : !coinsOK ? 'spends coins it doesn\'t own' : !sumOK ? 'pays out more than it spends' : `signature checks out (${ms.toFixed(1)} ms)`;
      add(sigOK && coinsOK && sumOK, 'Payment ' + (i + 1) + ': ' + describeTx(tx), why);
    });
    if (b.height > 0) add(outSum(b.txs[0]) <= SUBSIDY + fees, 'Miner\'s reward is ' + coins(outSum(b.txs[0])), 'allowed: ' + coins(SUBSIDY) + ' new + ' + coins(fees) + ' in fees');
    return checks;
  }

  function describeTx(tx) {
    if (tx.coinbase !== undefined) return 'new coins to ' + (tx.tag === 'genesis' ? 'everyone' : nameOf(tx.tag));
    const to = ownerOf.get(tx.outs[0].to);
    return (tx.from ? nameOf(tx.from) : '?') + ' → ' + (to ? nameOf(to) : '?') + ', ' + coins(tx.outs[0].value);
  }

  function drainEvents() { const e = S.events; S.events = []; return e; }

  function setKnob(k, v) {
    knobs[k] = v;
  }

  return {
    S, knobs, nodes, edges, node, COIN, SUBSIDY,
    warm, step, setMode, setKnob, runScenario, stopScenario, resume,
    pay, buildPayment, broadcast, estimateFeeRate, balance, coinsOf, ownerOf,
    block, parentOf, canonicalChain, confirmations, consensus, txStatus, verifyReport, forgeEdit, describeTx,
    drainEvents, isAncestor, forkPoint, totalStake, epochOf, track: (id) => S.tracked.add(id),
    get canonical() { return block(S.canonical); },
    sighash, txidOf, coins,
  };
}

return { createModel, CAST, SCENARIOS, DEFAULT_KNOBS, COIN, SUBSIDY, serializeTx, sighash, txidOf, mulberry32 };
});
