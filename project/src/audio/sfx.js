// Audio subsystem: procedural WebAudio SFX, muted until first user gesture
// (browser autoplay policy). No assets. Sounds: dice clatter, token hops,
// cash register, card flip, build placement, win sting.

export class AudioSystem {
  static id = 'audio';
  static deps = [];

  constructor(bus) {
    this.bus = bus;
    this.ac = null;
    this.master = null;
    this.muted = false;
    this.unlocked = false;
    this.timers = [];
    this.unsubs = [];
    this._unlock = () => {
      if (this.ac) return;
      try {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ac.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ac.destination);
        // S5-FIX-08: resume() rejects when called without a user gesture; an
      // unhandled rejection surfaces as a console error and fails the QA gate.
      if (this.ac.state === 'suspended') { const p = this.ac.resume(); if (p && p.catch) p.catch(() => {}); }
        this.unlocked = true;
      } catch (e) { /* no audio available */ }
      window.removeEventListener('pointerdown', this._unlock);
      window.removeEventListener('keydown', this._unlock);
    };
  }

  init(ctx) {
    this.ctx = ctx;
    window.addEventListener('pointerdown', this._unlock);
    window.addEventListener('keydown', this._unlock);
    const b = this.bus;
    this.unsubs.push(b.on('dice:rolled', () => this.diceClatter()));
    this.unsubs.push(b.on('token:moved', (p) => this.tokenHops(p.path ? p.path.length : 3)));
    this.unsubs.push(b.on('cash:changed', (p) => { if (p.delta > 0) this.cashRegister(); }));
    this.unsubs.push(b.on('card:drawn', () => this.cardFlip()));
    this.unsubs.push(b.on('build:changed', (p) => { if (p.houses > 0) this.buildThunk(); }));
    this.unsubs.push(b.on('game:over', () => this.winSting()));
    this.buildMuteButton();
  }

  buildMuteButton() {
    const btn = document.createElement('button');
    btn.id = 'mute-btn';
    btn.textContent = 'Sound: on';
    btn.setAttribute('style',
      'position:fixed;top:12px;right:12px;z-index:60;background:#223246;color:#e8e4d8;' +
      'border:1px solid #3a516b;border-radius:8px;padding:8px 12px;font-family:Georgia,serif;' +
      'font-size:12px;cursor:pointer;min-height:44px;min-width:44px;');
    btn.addEventListener('pointerup', () => {
      this.muted = !this.muted;
      btn.textContent = this.muted ? 'Sound: off' : 'Sound: on';
    });
    document.body.appendChild(btn);
    this.muteBtn = btn;
  }

  ok() { return this.unlocked && !this.muted && this.ac && this.ac.state === 'running'; }

  later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }

  env(dur, gain) {
    const g = this.ac.createGain();
    const t = this.ac.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    return g;
  }

  noise(dur, gain, freq) {
    if (!this.ok()) return;
    const len = Math.floor(this.ac.sampleRate * dur);
    const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const n = this.ac.createBufferSource();
    n.buffer = buf;
    const f = this.ac.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.4;
    n.connect(f); f.connect(this.env(dur, gain));
    n.start();
  }

  tone(freq, dur, gain, type) {
    if (!this.ok()) return;
    const o = this.ac.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = freq;
    o.connect(this.env(dur, gain));
    o.start(); o.stop(this.ac.currentTime + dur + 0.05);
  }

  diceClatter() {
    if (!this.ok()) return;
    for (let i = 0; i < 4; i++) this.later(() => this.noise(0.06, 0.35, 2000 + Math.random() * 1600), i * 70);
  }
  tokenHops(n) {
    if (!this.ok()) return;
    const hops = Math.min(4, n);
    for (let i = 0; i < hops; i++) this.later(() => this.tone(500 + i * 60, 0.07, 0.14, 'triangle'), i * 110);
  }
  cashRegister() {
    if (!this.ok()) return;
    this.tone(1245, 0.09, 0.18, 'square');
    this.later(() => this.tone(1865, 0.12, 0.18, 'square'), 70);
  }
  cardFlip() { this.noise(0.09, 0.3, 900); }
  buildThunk() { this.tone(140, 0.15, 0.35, 'sine'); this.noise(0.05, 0.18, 500); }
  winSting() {
    if (!this.ok()) return;
    [523, 659, 784, 1046].forEach((f, i) => this.later(() => this.tone(f, 0.35, 0.22, 'triangle'), i * 140));
  }

  update() {}

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    window.removeEventListener('pointerdown', this._unlock);
    window.removeEventListener('keydown', this._unlock);
    if (this.muteBtn && this.muteBtn.parentNode) this.muteBtn.parentNode.removeChild(this.muteBtn);
    if (this.ac) { try { const p = this.ac.close(); if (p && p.catch) p.catch(() => {}); } catch (e) {} this.ac = null; }
  }
}
