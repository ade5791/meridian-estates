// S6b: locks the two fixes that address the "glitching / never completes"
// report. Both are regressions that a screenshot or a 200 status cannot catch.
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/core/bus.js';
import { Engine } from '../src/rules/engine.js';
import { aiStep } from '../src/game/ai.js';

function playToEnd(seed, maxRounds, limit = 200000) {
  const bus = new EventBus();
  const engine = new Engine(bus);
  engine.newGame({
    seed,
    maxRounds,
    players: [
      { name: 'Ava', ai: true }, { name: 'Brick', ai: true },
      { name: 'Coral', ai: true }, { name: 'Dune', ai: true },
    ],
  });
  let steps = 0;
  while (engine.state.phase !== 'gameOver' && steps < limit) {
    if (!aiStep(engine)) break; // engine waiting on nobody = hang
    steps++;
  }
  return { engine, steps };
}

describe('S6b round cap', () => {
  it('defaults to 400 when unspecified (back-compat)', () => {
    const bus = new EventBus();
    const e = new Engine(bus);
    e.newGame({ seed: 7, players: [{ name: 'Ava', ai: true }, { name: 'Brick', ai: true }] });
    expect(e.state.maxRounds).toBe(400);
  });

  it('honours an explicit cap and terminates at or before it', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { engine } = playToEnd(seed, 30);
      expect(engine.state.maxRounds).toBe(30);
      expect(engine.state.phase).toBe('gameOver');
      expect(engine.state.round).toBeLessThanOrEqual(31);
    }
  });

  it('a 60-round game always reaches gameOver with a winner', () => {
    for (const seed of [11, 22, 33, 44, 55, 66]) {
      const { engine } = playToEnd(seed, 60);
      expect(engine.state.phase).toBe('gameOver');
      const solvent = engine.state.players.filter((p) => !p.bankrupt);
      expect(solvent.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('the cap survives a save/load round-trip', () => {
    const bus = new EventBus();
    const e = new Engine(bus);
    e.newGame({ seed: 9, maxRounds: 45, players: [{ name: 'Ava', ai: true }, { name: 'Brick', ai: true }] });
    const json = e.serialize();
    const bus2 = new EventBus();
    const e2 = new Engine(bus2);
    e2.newGame({ seed: 9, players: [{ name: 'Ava', ai: true }, { name: 'Brick', ai: true }] });
    e2.load(json, 'test');
    expect(e2.state.maxRounds).toBe(45);
  });

  it('the cap is cosmetic-free: same seed + same cap => identical outcome', () => {
    const a = playToEnd(123, 60);
    const b = playToEnd(123, 60);
    expect(a.engine.state.round).toBe(b.engine.state.round);
    expect(a.engine.state.players.map((p) => p.cash))
      .toEqual(b.engine.state.players.map((p) => p.cash));
  });
});
