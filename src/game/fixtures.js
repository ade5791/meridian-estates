// Deterministic review fixtures. Loaded via ?fixture=<name>.
// Each returns a full serialized engine payload built by mutating a fresh
// seeded game, so RNG streams stay coherent.

import { Engine } from '../rules/engine.js';
import { EventBus } from '../core/bus.js';

function base(seed, players) {
  const bus = new EventBus();
  const eng = new Engine(bus);
  eng.newGame({
    seed,
    players: players || [
      { name: 'Ava', ai: false },
      { name: 'Brick', ai: true },
      { name: 'Coral', ai: true },
      { name: 'Dune', ai: true },
    ],
  });
  return eng;
}

export const FIXTURES = {
  midgame(seed = 42) {
    const e = base(seed);
    const s = e.state;
    // spread ownership: P0 owns grove group + a rail, P1 owns midtown partial,
    // P2 owns foundry group with houses, P3 has rails.
    const own = (tile, pid, houses = 0, mortgaged = false) => {
      s.tiles[tile].owner = pid; s.tiles[tile].houses = houses; s.tiles[tile].mortgaged = mortgaged;
    };
    own(6, 0); own(8, 0); own(9, 0); own(5, 0);
    own(11, 1); own(13, 1); own(1, 1, 0, true);
    own(16, 2, 2); own(18, 2, 2); own(19, 2, 2);
    own(15, 3); own(25, 3); own(35, 3); own(12, 3);
    s.players[0].cash = 820; s.players[1].cash = 430;
    s.players[2].cash = 610; s.players[3].cash = 990;
    s.players[0].pos = 14; s.players[1].pos = 3; s.players[2].pos = 24; s.players[3].pos = 33;
    s.round = 14;
    return e.serialize();
  },

  endgame(seed = 43) {
    const e = base(seed);
    const s = e.state;
    const own = (tile, pid, houses = 0, mortgaged = false) => {
      s.tiles[tile].owner = pid; s.tiles[tile].houses = houses; s.tiles[tile].mortgaged = mortgaged;
    };
    // P2 bankrupt already, P0 hotel empire vs P1 scraping by, P3 mid.
    s.players[2].bankrupt = true; s.players[2].cash = 0;
    own(31, 0, 5); own(32, 0, 5); own(34, 0, 5);
    own(37, 0, 3); own(39, 0, 3);
    own(21, 1, 0, true); own(23, 1, 0, true); own(24, 1);
    own(26, 3, 1); own(27, 3, 1); own(29, 3, 1);
    own(5, 3); own(15, 3);
    s.players[0].cash = 2400; s.players[1].cash = 90; s.players[3].cash = 500;
    s.players[0].pos = 20; s.players[1].pos = 28; s.players[3].pos = 5;
    s.round = 55;
    return e.serialize();
  },

  jail(seed = 44) {
    const e = base(seed);
    const s = e.state;
    // current player (0) is in jail with 1 turn served, has a release writ.
    s.players[0].pos = 10; s.players[0].inJail = true;
    s.players[0].jailTurns = 1; s.players[0].jailFree = 1;
    s.players[0].cash = 300;
    s.round = 8;
    s.pending = { type: 'jail', player: 0, canPay: true, hasCard: true, turns: 1 };
    return e.serialize();
  },

  'bankruptcy-imminent'(seed = 45) {
    const e = base(seed);
    const s = e.state;
    const own = (tile, pid, houses = 0, mortgaged = false) => {
      s.tiles[tile].owner = pid; s.tiles[tile].houses = houses; s.tiles[tile].mortgaged = mortgaged;
    };
    // P0 nearly broke with mortgaged scraps, one step from P1's hotel row.
    own(1, 0, 0, true); own(3, 0, 0, true);
    own(37, 1, 5); own(39, 1, 5);
    own(11, 1); own(13, 1); own(14, 1);
    s.players[0].cash = 60; s.players[0].pos = 36; // one card tile before Regent Parade
    s.players[1].cash = 3000;
    s.round = 30;
    return e.serialize();
  },
};

export function loadFixture(name, seed) {
  const f = FIXTURES[name];
  if (!f) return null;
  return f(seed);
}
