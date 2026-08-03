// Entry: context registry, query params, setup screen, RAF loop with
// frame-error containment, AI driver pacing, QA surface, in-page restart.

import { EventBus } from './core/bus.js';
import { Engine } from './rules/engine.js';
import { aiStep } from './game/ai.js';
import { loadFixture } from './game/fixtures.js';
import { RenderSystem } from './render/scene.js';
import { LightPool } from './render/lightPool.js';
import { UISystem } from './ui/panels.js';
import { AudioSystem } from './audio/sfx.js';

// ---------- context registry ----------
class Context {
  constructor() { this.systems = {}; }
  register(id, sys) { this.systems[id] = sys; }
  get(id) { return this.systems[id]; }
}

const qs = new URLSearchParams(location.search);
// S5-FIX-01: mutable. The setup screen writes the chosen seed back here before
// startGame(); previously this was a const captured at module load, so a seed
// typed on the setup screen was written to the URL but NEVER used by the engine.
let seed = parseInt(qs.get('seed') || String((Date.now() % 100000) | 0), 10);
const fixture = qs.get('fixture');
const autoplay = qs.get('autoplay') === '1';
const quality = ['low', 'med', 'high'].includes(qs.get('quality')) ? qs.get('quality') : 'high';
const orbit = qs.get('orbit') === '1';
const playerCount = Math.min(4, Math.max(1, parseInt(qs.get('players') || '4', 10)));
const humanMask = qs.get('humans'); // e.g. "1" => seat0 human; default seat0 human unless autoplay
// S6b-FIX-05: optional round cap override. Unset => engine default (400).
const qsRounds = parseInt(qs.get('rounds') || '0', 10);

const NAMES = ['Ava', 'Brick', 'Coral', 'Dune'];

let current = null; // running game handle

function startGame(config) {
  const bus = new EventBus();
  const ctx = new Context();
  const engine = new Engine(bus);
  ctx.register('engine', engine);

  const canvas = document.getElementById('scene');
  const render = new RenderSystem(canvas, bus, { fast: autoplay, quality, orbit });
  ctx.register('render', render);
  render.init(ctx);

  // QA-only: pin quality during matrix capture. Marks the one automatic
  // step-down as already spent so a cell measures its declared preset,
  // never a mid-capture downgrade. Production never sets this.
  if (qs.get('nostepdown') === '1') render.resilience.steppedDown = true;

  // S6b-FIX-04: restore the player's chosen speed (?speed= overrides, then the
  // last saved preference). Cosmetic + AI-delay only; never touches the RNG,
  // so a game at 4x produces the identical event log to the same seed at 1x.
  // S6c-FIX: the DEFAULT is now 4x. Measured on the real human path (setup
  // screen -> clicks only): 1x = 4.0 rounds/min with 97% of wall-clock spent
  // waiting on AI opponents (a 30-round game ran 165s+ without finishing),
  // versus 4x = 19.2 rounds/min and a complete game with a declared winner in
  // 93.8s. Shipping 1x as the default was the single largest cause of the
  // "glitching, never completes" report. 1x remains selectable.
  let savedSpeed = Number(qs.get('speed'));
  if (!savedSpeed) {
    try { savedSpeed = Number(localStorage.getItem('meridian-speed')); } catch (e) { savedSpeed = 0; }
  }
  render.setSpeed([1, 2, 4, 8].includes(savedSpeed) ? savedSpeed : 4);

  const lights = new LightPool(6);
  ctx.register('lights', lights);
  lights.init(ctx);

  const audio = new AudioSystem(bus);
  ctx.register('audio', audio);
  audio.init(ctx);

  const ui = new UISystem(document.getElementById('ui'), bus);
  ctx.register('ui', ui);

  // start or load
  // S6b-FIX-05: config.maxRounds comes from the setup screen; ?rounds= wins
  // for QA/review states. Undefined leaves the engine default (400) intact.
  const maxRounds = qsRounds > 0 ? qsRounds : config.maxRounds;
  if (fixture) {
    const data = loadFixture(fixture, seed);
    if (data) {
      engine.newGame({ seed, players: config.players, maxRounds }); // init streams/tokens
      engine.load(data, 'fixture:' + fixture);
      // fixtures serialize their own seat flags; autoplay QA needs all-AI
      if (autoplay) engine.state.players.forEach((p) => { p.ai = true; });
      // a loaded fixture predates the cap field; honour an explicit override
      if (maxRounds > 0) engine.state.maxRounds = maxRounds;
    } else {
      engine.newGame({ seed, players: config.players, maxRounds });
    }
  } else {
    engine.newGame({ seed, players: config.players, maxRounds });
  }
  ui.init(ctx);
  render.syncAll();

  // expose for scripted browser verification
  window.__engine = engine;
  window.__bus = bus;
  window.__render = render;
  window.__audio = audio;
  window.__gameResult = null;
  bus.on('game:over', (p) => {
    window.__gameResult = { winner: p.winner, name: engine.player(p.winner).name, reason: p.reason, rounds: p.rounds };
  });

  // ---------- AI driver ----------
  // S6b-FIX-04: the AI think-delay is the dominant cost of a game's wall-clock
  // length (measured 3.0 rounds/min at 1x => ~15 min per game, mostly spent
  // watching AI). It now divides by the render speed multiplier, so the speed
  // control actually shortens the game rather than only the animations.
  let aiTimer = 0;
  const AI_BASE_DELAY = autoplay ? 30 : 900;
  const aiDelay = () => AI_BASE_DELAY / (render.speed || 1);

  // S6d-FIX-04: prewarm shaders BEFORE the first frame. With free camera
  // orbit the player can reveal materials that the fixed default angle never
  // drew, and those would otherwise compile mid-drag (measured 4 -> 7
  // programs). Compiling here moves the cost into load, where it is hidden.
  try {
    const n = render.prewarm();
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[prewarm] programs compiled:', n);
    }
  } catch (e) { /* prewarm is best-effort; never block boot */ }

  // ---------- RAF loop with frame-error containment (v2 rule 3) ----------
  let last = performance.now();
  let stopped = false;
  let rafId = 0;

  const frameLog = { samples: [], capture: false };

  function frame(now) {
    if (stopped) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(100, now - last); // post-pause delta cap
    last = now;
    try {
      render.update(dt);
      render.render();
      render.resilience.frame(dt);
      if (frameLog.capture && dt > 0) {
        frameLog.samples.push(dt);
        if (frameLog.samples.length > 6000) frameLog.samples.shift();
      }

      // drive AI when the engine waits on an AI decision and animations settled
      if (engine.state.phase !== 'gameOver') {
        aiTimer += dt;
        const animBlock = !autoplay && render.isAnimating();
        if (aiTimer >= aiDelay() && !animBlock) {
          if (aiStep(engine)) aiTimer = 0;
        }
      }
    } catch (err) {
      const drop = render.resilience.reportFrameError(err);
      if (drop) {
        try { render.stepDownQuality(); } catch (e) { /* keep playing */ }
      }
      // keep the loop alive - never let one bad frame kill the game
    }
  }
  rafId = requestAnimationFrame(frame);

  // QA-only: continuous cosmetic fx load (dice tumble + card flip + pool
  // lights) for the perf matrix, so every cell measures WITH effects firing
  // even after the AI game ends. Cosmetic listeners only - the engine never
  // subscribes to the bus, so gameplay state is untouched.
  let fxTimer = null;
  if (qs.get('fxloop') === '1') {
    let flip = 0;
    fxTimer = setInterval(() => {
      flip++;
      bus.emit('dice:rolled', { player: 0, d1: 1 + (flip % 6), d2: 1 + ((flip * 3) % 6), doubles: false, doubleCount: 0 });
      if (flip % 2 === 0) {
        bus.emit('card:drawn', { player: 0, deck: flip % 4 === 0 ? 'fortune' : 'ledger', cardId: 0, text: 'QA effect loop card text for perf capture' });
      }
    }, 700);
  }

  function stop() {
    if (fxTimer) clearInterval(fxTimer);
    stopped = true;
    cancelAnimationFrame(rafId);
    ui.dispose();
    audio.dispose();
    lights.dispose();
    render.dispose();
  }

  current = { ctx, engine, render, bus, stop, frameLog, config };
  return current;
}

// ---------- QA surface ----------
window.__qa = {
  startCapture() { if (current) { current.frameLog.samples.length = 0; current.frameLog.capture = true; } },
  frames() { return current ? current.frameLog.samples.slice() : []; },
  lightCount() {
    let n = 0;
    if (current) current.render.scene.traverse((o) => { if (o.isLight) n++; });
    return n;
  },
  info() {
    if (!current) return null;
    const r = current.render.renderer.info;
    return { geometries: r.memory.geometries, textures: r.memory.textures,
             programs: r.programs.length, calls: r.render.calls, triangles: r.render.triangles };
  },
  dpr() { return current ? current.render.renderer.getPixelRatio() : 0; },
  quality,
  resilience() {
    if (!current) return null;
    const r = current.render.resilience;
    return { forcedDirect: r.forcedDirect, blackReads: r.blackReads, checksDone: r.checksDone,
             postDropped: r.postDropped, steppedDown: r.steppedDown, frameErrors: r.frameErrors };
  },
  state() {
    if (!current) return null;
    const s = current.engine.state;
    // S6: expose `current` (seat whose turn it is) and the pending decision
    // type. Turn-handover cannot be proven from `round` alone -- round only
    // increments when the seat index WRAPS, so a 2-player 0->1 handover leaves
    // round unchanged. QA needs the seat itself.
    return { phase: s.phase, round: s.round, current: s.current,
             pending: s.pending ? s.pending.type : null,
             players: s.players.map((p) => ({ cash: p.cash, pos: p.pos, bankrupt: p.bankrupt })) };
  },
  domCounts() {
    return { canvas: document.querySelectorAll('canvas').length,
             nodes: document.getElementsByTagName('*').length };
  },
  restart() {
    // in-page teardown + fresh game (leak-audit path); reuses same config
    if (!current) return false;
    const cfg = current.config;
    current.stop();
    current = null;
    startGame(cfg);
    return true;
  },
  stop() { if (current) { current.stop(); current = null; } return true; },
};

// ---------- setup screen ----------
function showSetup() {
  const wrap = document.getElementById('setup');
  const seats = [];
  for (let i = 0; i < 4; i++) {
    seats.push(`
      <div class="seat">
        <b>Seat ${i + 1}: ${NAMES[i]}</b>
        <select id="seat-${i}">
          <option value="off" ${i >= 2 ? 'selected' : ''}>Empty</option>
          <option value="human" ${i === 0 ? 'selected' : ''}>Human</option>
          <option value="ai" ${i === 1 ? 'selected' : ''}>AI</option>
        </select>
      </div>`);
  }
  wrap.innerHTML = `
    <div class="setup-card">
      <h1>Meridian Estates</h1>
      <p class="sub">A 3D property trading board game</p>
      ${seats.join('')}
      <p class="seed-row">Game length:
        <select id="setup-rounds">
          <option value="30" selected>Short - 30 rounds (about 2 min)</option>
          <option value="60">Standard - 60 rounds (about 4 min)</option>
          <option value="120">Long - 120 rounds (about 8 min)</option>
          <option value="400">Marathon - 400 rounds</option>
        </select>
      </p>
      <p class="seed-row">Seed: <input type="number" id="setup-seed" value="${seed}"></p>
      <p class="setup-note">A game ends early when only one player is solvent.
        At the round cap the highest net worth wins. Times are measured at the
        default 4x speed with three AI opponents; the Speed button changes it at
        any time (4x, 8x, 1x, 2x) and never affects the outcome for a given seed.</p>
      <button class="btn primary big" id="setup-start">Start Game</button>
    </div>`;
  wrap.classList.remove('hidden');
  document.getElementById('setup-start').onclick = () => {
    const players = [];
    for (let i = 0; i < 4; i++) {
      const v = document.getElementById('seat-' + i).value;
      if (v !== 'off') players.push({ name: NAMES[i], ai: v === 'ai' });
    }
    if (players.length < 1) return;
    const s = parseInt(document.getElementById('setup-seed').value || '1', 10);
    seed = Number.isFinite(s) ? (s | 0) : seed;   // S5-FIX-01: actually apply it
    const u = new URL(location.href);
    u.searchParams.set('seed', String(seed));
    history.replaceState(null, '', u);
    const rSel = document.getElementById('setup-rounds');
    const chosenRounds = parseInt((rSel && rSel.value) || '60', 10);
    wrap.classList.add('hidden');
    startGame({ players, maxRounds: chosenRounds });
  };
}

// query-param driven start (deterministic review states / autoplay)
if (autoplay || fixture || qs.get('players') || qs.get('humans')) {
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const human = autoplay ? false
      : humanMask ? ((parseInt(humanMask, 10) >> i) & 1) === 1
      : i === 0;
    players.push({ name: NAMES[i], ai: !human });
  }
  document.getElementById('setup').classList.add('hidden');
  startGame({ players });
} else {
  showSetup();
}
