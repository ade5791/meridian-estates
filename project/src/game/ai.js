// AI opponent - documented value heuristic (see ARCHITECTURE.md).
// Every decision consumes the seeded 'ai' / 'auction' streams so full games
// replay identically from a seed. Pure function of (engine, pending/phase).

import { TILES, GROUPS } from '../rules/board.js';

const SAFETY_BASE = 150;
const SAFETY_PER_MORTGAGE = 25;

function safetyFloor(engine, pid) {
  let mortgages = 0;
  for (const ts of engine.state.tiles) if (ts.owner === pid && ts.mortgaged) mortgages++;
  return SAFETY_BASE + SAFETY_PER_MORTGAGE * mortgages;
}

function expectedRent(tile) {
  const t = TILES[tile];
  if (t.type === 'rail') return 50;   // avg 2-line rent
  if (t.type === 'util') return 28;   // avg 7 * 4
  return t.rent[0] * 2;               // assume group doubling eventually
}

function completesGroup(engine, pid, idx) {
  const t = TILES[idx];
  if (t.type !== 'prop') return false;
  return GROUPS[t.group].every((g) => g === idx || engine.tstate(g).owner === pid);
}

function blocksOpponent(engine, pid, idx) {
  const t = TILES[idx];
  if (t.type !== 'prop') return false;
  const others = engine.state.players.filter((p) => !p.bankrupt && p.id !== pid);
  for (const o of others) {
    const owned = GROUPS[t.group].filter((g) => engine.tstate(g).owner === o.id).length;
    if (owned >= GROUPS[t.group].length - 1) return true;
  }
  return false;
}

export function buyScore(engine, pid, idx, price) {
  let roi = expectedRent(idx) / price;
  if (completesGroup(engine, pid, idx)) roi *= 2;
  else if (blocksOpponent(engine, pid, idx)) roi *= 1.5;
  return roi;
}

// Decide and execute exactly ONE action for the AI whose input the engine is
// waiting on. Returns true if an action was taken.
export function aiStep(engine) {
  const s = engine.state;
  if (s.phase === 'gameOver') return false;
  const rng = engine.rng.get('ai');
  const pnd = s.pending;

  if (pnd) {
    const pid = pnd.type === 'auction' ? pnd.next
      : pnd.type === 'trade' ? pnd.to
      : pnd.player;
    const p = engine.player(pid);
    if (!p || !p.ai) return false; // waiting on a human

    switch (pnd.type) {
      case 'buy': {
        const floor = safetyFloor(engine, pid);
        const score = buyScore(engine, pid, pnd.tile, pnd.price);
        const affordable = p.cash - pnd.price >= floor;
        if ((score >= 0.05 && affordable) || (score >= 0.12 && p.cash >= pnd.price)) {
          engine.act('buy');
        } else {
          engine.act('declineBuy');
        }
        return true;
      }
      case 'auction': {
        const t = TILES[pnd.tile];
        const base = Math.floor((t.price || 100) * (0.4 + 0.3 * rng.next()));
        const want = buyScore(engine, pid, pnd.tile, t.price || 100) >= 0.05;
        const floor = safetyFloor(engine, pid);
        const maxBid = Math.max(0, p.cash - Math.floor(floor / 2));
        const bid = want ? Math.min(base, maxBid) : 0;
        engine.act('auctionBid', { player: pid, amount: bid });
        return true;
      }
      case 'jail': {
        if (pnd.hasCard) { engine.act('jailChoice', { choice: 'card' }); return true; }
        const early = s.round < 12;
        if (early && pnd.canPay) engine.act('jailChoice', { choice: 'pay' });
        else engine.act('jailChoice', { choice: 'roll' });
        return true;
      }
      case 'mustRaise': {
        raiseCash(engine, pid, pnd.amount);
        // settle if we made it
        if (engine.player(pid).cash >= pnd.amount) {
          engine.act('settleDebt', { player: pid });
        } else {
          // could not raise despite engine solvency check - force bankruptcy path
          engine.doBankrupt(pid, pnd.creditor === undefined ? null : pnd.creditor, pnd.amount);
        }
        return true;
      }
      case 'trade': {
        const accept = evaluateTrade(engine, pnd) >= 0;
        engine.act('respondTrade', { accept });
        return true;
      }
      default:
        return false;
    }
  }

  // no pending: normal phase actions for current player
  const p = engine.cur();
  if (!p.ai) return false;

  if (s.phase === 'awaitRoll') {
    engine.act('roll');
    return true;
  }
  if (s.phase === 'awaitEndTurn') {
    // one group-completing trade attempt per turn, AI-to-AI only,
    // pre-checked for acceptance (deterministic - can never decline-loop)
    if (tryProposeTrade(engine, p.id)) return true;
    manageAssets(engine, p.id);
    engine.act('endTurn');
    return true;
  }
  return false;
}

// Propose a cash-for-property trade that completes one of our color groups.
// Only targets AI owners, and only when evaluateTrade says they WILL accept,
// so a declined-trade loop is impossible. Consumes the 'ai' stream for jitter.
function tryProposeTrade(engine, pid) {
  const p = engine.player(pid);
  const rng = engine.rng.get('ai');
  const floor = safetyFloor(engine, pid);
  for (const gName of Object.keys(GROUPS)) {
    const g = GROUPS[gName];
    const mine = g.filter((i) => engine.tstate(i).owner === pid);
    if (mine.length !== g.length - 1) continue;
    const missing = g.find((i) => engine.tstate(i).owner !== pid);
    const ts = engine.tstate(missing);
    if (ts.owner === null || ts.houses > 0) continue;
    const other = engine.player(ts.owner);
    if (!other || !other.ai || other.bankrupt) continue;
    const t = TILES[missing];
    // responder's evaluateTrade demands >= 2x price when the tile completes
    // our group; add seeded jitter on top
    const offer = 2 * t.price + 10 + rng.int(40);
    const houseBudget = 3 * t.house;
    if (p.cash < offer + floor + houseBudget) continue;
    // pre-check acceptance with the responder's own criterion
    const wouldAccept = evaluateTrade(engine, {
      from: pid, to: ts.owner, give: [], get: [missing], giveCash: offer, getCash: 0,
    }) >= 0;
    if (!wouldAccept) continue;
    const r = engine.act('proposeTrade', {
      from: pid, to: ts.owner, give: [], get: [missing], giveCash: offer, getCash: 0,
    });
    if (r.ok) return true;
  }
  return false;
}

// value of a property to player pid (for trade evaluation)
function propValue(engine, pid, idx) {
  const t = TILES[idx];
  let v = t.price || 100;
  if (completesGroup(engine, pid, idx)) v *= 2;
  return v;
}

function evaluateTrade(engine, pnd) {
  // pnd.to is the AI evaluating. get = what AI receives, give... reversed naming:
  // proposer 'from' gives pnd.give (+giveCash) and receives pnd.get (+getCash).
  const ai = pnd.to;
  let gain = pnd.giveCash || 0;
  for (const i of pnd.give) {
    gain += propValue(engine, ai, i);
    if (completesGroup(engine, pnd.from, i)) gain += propValue(engine, ai, i); // denying counts too
  }
  let loss = pnd.getCash || 0;
  for (const i of pnd.get) {
    loss += propValue(engine, ai, i);
    if (completesGroup(engine, pnd.from, i)) loss += propValue(engine, ai, i) * 1.0; // completing opponent group counts x2 against
  }
  return gain - loss;
}

// sell houses / mortgage until cash >= amount (unmortgage-order in reverse:
// mortgage lowest rent/value first, sell houses from cheapest groups first)
function raiseCash(engine, pid, amount) {
  const p = engine.player(pid);
  // 1. sell houses, cheapest house cost first
  let guard = 0;
  while (p.cash < amount && guard++ < 200) {
    const candidates = engine.state.tiles
      .filter((ts) => ts.owner === pid && ts.houses > 0)
      .sort((a, b) => TILES[a.id].house - TILES[b.id].house);
    if (!candidates.length) break;
    const r = engine.act('sellHouse', { player: pid, tile: candidates[0].id });
    if (!r.ok) {
      // even-sell rule: pick tile with max houses in that group
      const g = GROUPS[TILES[candidates[0].id].group];
      const maxTile = g.reduce((m, x) => engine.tstate(x).houses > engine.tstate(m).houses ? x : m, g[0]);
      const r2 = engine.act('sellHouse', { player: pid, tile: maxTile });
      if (!r2.ok) break;
    }
  }
  // 2. mortgage, lowest expectedRent/price first
  guard = 0;
  while (p.cash < amount && guard++ < 100) {
    const candidates = engine.state.tiles
      .filter((ts) => ts.owner === pid && !ts.mortgaged && ts.houses === 0)
      .sort((a, b) => (expectedRent(a.id) / (TILES[a.id].price || 100)) - (expectedRent(b.id) / (TILES[b.id].price || 100)));
    if (!candidates.length) break;
    const r = engine.act('mortgage', { player: pid, tile: candidates[0].id, set: true });
    if (!r.ok) break;
  }
}

// end-of-turn asset management: unmortgage (highest rent/cost first), build houses
function manageAssets(engine, pid) {
  const p = engine.player(pid);
  const floor = safetyFloor(engine, pid);

  // unmortgage order: highest rent/unmortgageCost first
  let guard = 0;
  while (guard++ < 50) {
    const cands = engine.state.tiles
      .filter((ts) => ts.owner === pid && ts.mortgaged)
      .map((ts) => {
        const half = Math.floor((TILES[ts.id].price || 100) / 2);
        const cost = half + Math.ceil(half / 10);
        return { id: ts.id, cost, ratio: expectedRent(ts.id) / cost };
      })
      .sort((a, b) => b.ratio - a.ratio);
    if (!cands.length) break;
    const c = cands[0];
    if (p.cash <= floor + c.cost) break;
    const r = engine.act('mortgage', { player: pid, tile: c.id, set: false });
    if (!r.ok) break;
  }

  // house building: full groups only, even-build, best marginal rent per cost
  guard = 0;
  while (guard++ < 60) {
    const buildable = [];
    for (const gName of Object.keys(GROUPS)) {
      const g = GROUPS[gName];
      if (!g.every((i) => engine.tstate(i).owner === pid && !engine.tstate(i).mortgaged)) continue;
      // even-build: next tile is one with min houses
      const sorted = g.slice().sort((a, b) => engine.tstate(a).houses - engine.tstate(b).houses);
      const target = sorted[0];
      const ts = engine.tstate(target);
      if (ts.houses >= 5) continue;
      const t = TILES[target];
      const marginal = t.rent[ts.houses + 1] - t.rent[ts.houses];
      buildable.push({ tile: target, cost: t.house, score: marginal / t.house });
    }
    if (!buildable.length) break;
    buildable.sort((a, b) => b.score - a.score);
    const b = buildable[0];
    if (p.cash <= floor + b.cost) break;
    const r = engine.act('build', { player: pid, tile: b.tile, delta: 1 });
    if (!r.ok) break;
  }
}
