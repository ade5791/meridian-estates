// Seeded RNG: xoshiro128** with named forkable streams. Serializable.
// All gameplay randomness (dice, decks, AI, auction) flows through here.

function splitmix32(a) {
  return function () {
    a |= 0; a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0);
  };
}

export class Xoshiro128 {
  constructor(s0, s1, s2, s3) {
    this.s = new Uint32Array([s0, s1, s2, s3]);
    // avoid all-zero state
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1;
  }
  static fromSeed(seed) {
    const sm = splitmix32(seed | 0);
    return new Xoshiro128(sm(), sm(), sm(), sm());
  }
  nextUint32() {
    const s = this.s;
    const result = (Math.imul(rotl(Math.imul(s[1], 5), 7), 9)) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }
  next() { return this.nextUint32() / 4294967296; } // [0,1)
  int(maxExclusive) { return this.nextUint32() % maxExclusive; }
  die() { return 1 + this.int(6); }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }
  getState() { return Array.from(this.s); }
  setState(a) { this.s = new Uint32Array(a); }
}

function rotl(x, k) { return ((x << k) | (x >>> (32 - k))) >>> 0; }

// The canonical gameplay stream set. Every stream is instantiated eagerly so
// that serialize() always emits the SAME key set regardless of which streams
// have been touched yet.
// S5-FIX-02: previously streams were created lazily on first get(), so a save
// taken before any AI decision omitted the "ai" key while a save taken after
// included it. A save/load round trip therefore produced a byte-different
// serialization (save -> load -> serialize was not idempotent), which breaks
// deterministic replay and the save/load fidelity gate.
export const STREAM_NAMES = ['dice', 'deck.fortune', 'deck.ledger', 'ai', 'auction'];

// Named stream manager forked from one master seed.
export class RngStreams {
  constructor(masterSeed) {
    this.masterSeed = masterSeed | 0;
    this.streams = {};
    for (const n of STREAM_NAMES) this.get(n);
  }
  get(name) {
    if (!this.streams[name]) {
      // stable per-name seed: master seed mixed with name hash
      let h = 2166136261;
      for (let i = 0; i < name.length; i++) {
        h ^= name.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      this.streams[name] = Xoshiro128.fromSeed((this.masterSeed ^ h) | 0);
    }
    return this.streams[name];
  }
  serialize() {
    const out = { masterSeed: this.masterSeed, states: {} };
    // S5-FIX-02: stable, sorted key order so serialize() is byte-deterministic.
    for (const k of Object.keys(this.streams).sort()) out.states[k] = this.streams[k].getState();
    return out;
  }
  static deserialize(data) {
    const r = new RngStreams(data.masterSeed);
    for (const k of Object.keys(data.states || {})) {
      r.get(k).setState(data.states[k]);
    }
    return r;
  }
}
