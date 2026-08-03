// Watchdog: AI-only seeded games must run to completion without stalling.
// Queen-freeze lesson generalized: no reachable game state may hang the turn
// loop. Every aiStep must either mutate observable state or end the game;
// N consecutive no-progress steps = stall = failure.
// Also: determinism (same seed => identical event log) and save/load fidelity.

import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/core/bus.js';
import { Engine } from '../src/rules/engine.js';
import { aiStep } from '../src/game/ai.js';
import { loadFixture, FIXTURES } from '../src/game/fixtures.js';

function aiGame(seed, { maxSteps = 60000, collect = false } = {}) {
  const bus = new EventBus();
  const log = [];
  if (collect) bus.onAny((e, p) => log.push(e + ':' + JSON.stringify(p)));
  const eng = new Engine(bus);
  eng.newGame({
    seed,
    players: [
      { name: 'A', ai: true }, { name: 'B', ai: true },
      { name: 'C', ai: true }, { name: 'D', ai: true },
    ],
  });
  let steps = 0;
  let lastFingerprint = '';
  let stallCount = 0;
  while (eng.state.phase !== 'gameOver' && steps < maxSteps) {
    const acted = aiStep(eng);
    steps++;
    if (!acted) {
      stallCount = 999; // engine waits on nobody = hang
      break;
    }
    const fp = JSON.stringify({
      c: eng.state.current, ph: eng.state.phase, r: eng.state.round,
      pn: eng.state.pending && eng.state.pending.type,
      nx: eng.state.pending && eng.state.pending.next,
      cash: eng.state.players.map((p) => p.cash),
      pos: eng.state.players.map((p) => p.pos),
    });
    if (fp === lastFingerprint) {
      stallCount++;
      if (stallCount > 50) break;
    } else stallCount = 0;
    lastFingerprint = fp;
  }
  return { eng, steps, stalled: stallCount > 50 || (eng.state.phase !== 'gameOver' && steps >= maxSteps), log };
}

describe('turn-loop watchdog', () => {
  it('AI-only games complete for 12 seeds without stall', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { eng, stalled, steps } = aiGame(seed * 31 + 5);
      expect(stalled, `seed ${seed * 31 + 5} stalled after ${steps} steps`).toBe(false);
      expect(eng.state.phase).toBe('gameOver');
      const winner = eng.state.players.find((p, i) => {
        return true;
      });
      expect(eng.state.round).toBeGreaterThan(1);
    }
  }, 120000);

  it('same seed produces an identical event log (determinism)', () => {
    const a = aiGame(4242, { collect: true });
    const b = aiGame(4242, { collect: true });
    expect(a.eng.state.phase).toBe('gameOver');
    expect(a.log.length).toBe(b.log.length);
    expect(a.log).toEqual(b.log);
  }, 60000);

  it('different seeds diverge', () => {
    const a = aiGame(1001, { collect: true });
    const b = aiGame(2002, { collect: true });
    expect(a.log).not.toEqual(b.log);
  }, 60000);

  it('save/load mid-game preserves state and the game still completes', () => {
    const bus = new EventBus();
    const eng = new Engine(bus);
    eng.newGame({
      seed: 777,
      players: [
        { name: 'A', ai: true }, { name: 'B', ai: true },
        { name: 'C', ai: true }, { name: 'D', ai: true },
      ],
    });
    for (let i = 0; i < 200; i++) { if (eng.state.phase === 'gameOver') break; aiStep(eng); }
    const snap = eng.serialize();

    const bus2 = new EventBus();
    const eng2 = new Engine(bus2);
    eng2.load(snap, 'test');
    expect(JSON.parse(eng2.serialize()).state).toEqual(JSON.parse(snap).state);

    let steps = 0;
    while (eng2.state.phase !== 'gameOver' && steps++ < 60000) {
      if (!aiStep(eng2)) break;
    }
    expect(eng2.state.phase).toBe('gameOver');
  }, 60000);

  it('all fixtures load and AI-only continuation completes', () => {
    for (const name of Object.keys(FIXTURES)) {
      const data = loadFixture(name);
      const bus = new EventBus();
      const eng = new Engine(bus);
      eng.load(data, 'fixture');
      // make every seat AI so the watchdog can drive it
      for (const p of eng.state.players) p.ai = true;
      let steps = 0;
      while (eng.state.phase !== 'gameOver' && steps++ < 60000) {
        if (!aiStep(eng)) break;
      }
      expect(eng.state.phase, `fixture ${name}`).toBe('gameOver');
    }
  }, 120000);
});
