// Focused rules-engine unit tests: rent math, jail, build/mortgage rules,
// trading, auction, bankruptcy, turn cap.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/core/bus.js';
import { Engine } from '../src/rules/engine.js';

function fresh(seed = 5) {
  const bus = new EventBus();
  const events = [];
  bus.onAny((e, p) => events.push({ e, p }));
  const eng = new Engine(bus);
  eng.newGame({
    seed,
    players: [
      { name: 'A', ai: false }, { name: 'B', ai: false },
      { name: 'C', ai: false },
    ],
  });
  return { eng, events, bus };
}

describe('rent', () => {
  it('base rent, group-doubled rent, house rent', () => {
    const { eng } = fresh();
    eng.state.tiles[1].owner = 1;
    expect(eng.computeRent(1)).toBe(2);
    eng.state.tiles[3].owner = 1; // full harbor group
    expect(eng.computeRent(1)).toBe(4);
    eng.state.tiles[1].houses = 3;
    expect(eng.computeRent(1)).toBe(90);
  });
  it('rail rent scales 25/50/100/200', () => {
    const { eng } = fresh();
    eng.state.tiles[5].owner = 1;
    expect(eng.computeRent(5)).toBe(25);
    eng.state.tiles[15].owner = 1;
    expect(eng.computeRent(5)).toBe(50);
    eng.state.tiles[25].owner = 1;
    eng.state.tiles[35].owner = 1;
    expect(eng.computeRent(5)).toBe(200);
  });
  it('mortgaged property charges no rent on landing', () => {
    const { eng, events } = fresh();
    eng.state.tiles[1].owner = 1;
    eng.state.tiles[1].mortgaged = true;
    eng.state.players[0].pos = 0;
    // force-land player 0 on tile 1
    eng.landOn(1);
    expect(events.some((x) => x.e === 'rent:paid')).toBe(false);
  });
});

describe('build and mortgage rules', () => {
  it('even-build enforced; cannot build without full group', () => {
    const { eng } = fresh();
    eng.state.tiles[1].owner = 0;
    expect(eng.act('build', { player: 0, tile: 1, delta: 1 }).ok).toBe(false);
    eng.state.tiles[3].owner = 0;
    expect(eng.act('build', { player: 0, tile: 1, delta: 1 }).ok).toBe(true);
    // second house on same tile violates even-build (other tile has 0)
    expect(eng.act('build', { player: 0, tile: 1, delta: 1 }).ok).toBe(false);
    expect(eng.act('build', { player: 0, tile: 3, delta: 1 }).ok).toBe(true);
  });
  it('mortgage pays half price; unmortgage costs 110%', () => {
    const { eng } = fresh();
    eng.state.tiles[39].owner = 0;
    const cash0 = eng.state.players[0].cash;
    expect(eng.act('mortgage', { player: 0, tile: 39, set: true }).ok).toBe(true);
    expect(eng.state.players[0].cash).toBe(cash0 + 200);
    expect(eng.act('mortgage', { player: 0, tile: 39, set: false }).ok).toBe(true);
    expect(eng.state.players[0].cash).toBe(cash0 + 200 - 220);
  });
  it('cannot mortgage with houses on the tile', () => {
    const { eng } = fresh();
    eng.state.tiles[1].owner = 0;
    eng.state.tiles[1].houses = 1;
    expect(eng.act('mortgage', { player: 0, tile: 1, set: true }).ok).toBe(false);
  });
});

describe('jail', () => {
  it('three doubles sends to jail', () => {
    const { eng, events } = fresh();
    eng.state.doubleCount = 2;
    // force a doubles roll by monkeypatching the dice stream
    const rng = eng.rng.get('dice');
    let calls = 0;
    rng.die = () => 4;
    eng.act('roll');
    expect(events.some((x) => x.e === 'jail:entered' && x.p.reason === 'threeDoubles')).toBe(true);
    expect(eng.cur().inJail).toBe(true);
  });
  it('paying the fine exits jail and rolls', () => {
    const { eng, events } = fresh();
    const p = eng.cur();
    p.inJail = true; p.jailTurns = 0; p.pos = 10;
    eng.offerJailChoice();
    expect(eng.state.pending.type).toBe('jail');
    const cash = p.cash;
    eng.act('jailChoice', { choice: 'pay' });
    expect(p.inJail).toBe(false);
    expect(events.some((x) => x.e === 'jail:exited' && x.p.method === 'paid')).toBe(true);
  });
});

describe('trade', () => {
  it('accepted trade transfers properties and cash', () => {
    const { eng } = fresh();
    eng.state.tiles[1].owner = 0;
    eng.state.tiles[39].owner = 1;
    const c0 = eng.state.players[0].cash, c1 = eng.state.players[1].cash;
    expect(eng.act('proposeTrade', { from: 0, to: 1, give: [1], get: [39], giveCash: 100, getCash: 0 }).ok).toBe(true);
    expect(eng.act('respondTrade', { accept: true }).ok).toBe(true);
    expect(eng.state.tiles[1].owner).toBe(1);
    expect(eng.state.tiles[39].owner).toBe(0);
    expect(eng.state.players[0].cash).toBe(c0 - 100);
    expect(eng.state.players[1].cash).toBe(c1 + 100);
  });
  it('trade with houses on a tile is rejected', () => {
    const { eng } = fresh();
    eng.state.tiles[1].owner = 0;
    eng.state.tiles[1].houses = 1;
    expect(eng.act('proposeTrade', { from: 0, to: 1, give: [1], get: [] }).ok).toBe(false);
  });
});

describe('auction', () => {
  it('sealed bids resolve to highest bidder', () => {
    const { eng, events } = fresh();
    eng.startAuction(39);
    expect(eng.state.pending.type).toBe('auction');
    eng.act('auctionBid', { player: 0, amount: 100 });
    eng.act('auctionBid', { player: 1, amount: 250 });
    eng.act('auctionBid', { player: 2, amount: 200 });
    expect(eng.state.tiles[39].owner).toBe(1);
    const won = events.find((x) => x.e === 'auction:won');
    expect(won.p.price).toBe(250);
  });
  it('zero bids -> property stays with bank', () => {
    const { eng, events } = fresh();
    eng.startAuction(39);
    eng.act('auctionBid', { player: 0, amount: 0 });
    eng.act('auctionBid', { player: 1, amount: 0 });
    eng.act('auctionBid', { player: 2, amount: 0 });
    expect(eng.state.tiles[39].owner).toBe(null);
    expect(events.some((x) => x.e === 'auction:passed')).toBe(true);
  });
});

describe('bankruptcy and endings', () => {
  it('unpayable debt bankrupts and transfers assets to creditor', () => {
    const { eng, events } = fresh();
    eng.state.players[0].cash = 10;
    eng.state.tiles[1].owner = 0; // tiny asset, liquidation value 30
    eng.state.tiles[39].owner = 1;
    eng.state.tiles[39].houses = 5;
    eng.state.players[0].pos = 38;
    eng.landOn(39); // rent 2000 >> 10 + 30
    expect(eng.state.players[0].bankrupt).toBe(true);
    expect(eng.state.tiles[1].owner).toBe(1);
    expect(events.some((x) => x.e === 'player:bankrupt' && x.p.creditor === 1)).toBe(true);
  });
  it('last solvent player wins', () => {
    const { eng, events } = fresh();
    eng.state.players[1].bankrupt = true;
    eng.state.players[0].cash = 5;
    eng.state.tiles[39].owner = 2;
    eng.state.tiles[39].houses = 5;
    eng.state.players[0].pos = 38;
    eng.landOn(39);
    const over = events.find((x) => x.e === 'game:over');
    expect(over).toBeTruthy();
    expect(over.p.winner).toBe(2);
    expect(over.p.reason).toBe('lastSolvent');
  });
  it('turn cap ends game by net worth', () => {
    const { eng, events } = fresh();
    eng.state.round = 400;
    eng.state.current = eng.state.players.length - 1; // wrap increments round
    eng.state.players[1].cash = 9999;
    eng.state.phase = 'awaitEndTurn';
    eng.act('endTurn');
    const over = events.find((x) => x.e === 'game:over');
    expect(over).toBeTruthy();
    expect(over.p.reason).toBe('turnCap');
    expect(over.p.winner).toBe(1);
  });
});

describe('cards', () => {
  it('passing start credits 200', () => {
    const { eng, events } = fresh();
    eng.state.players[0].pos = 38;
    eng.moveBy(4); // 38 -> 2 passes start
    expect(events.some((x) => x.e === 'cash:changed' && x.p.reason === 'passStart' && x.p.delta === 200)).toBe(true);
  });
});
