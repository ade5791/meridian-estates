// Meridian Estates HEADLESS rules engine.
// No DOM, no three.js. All randomness from named RngStreams.
// Never blocks: required input surfaces as state.pending, answered via act().

import { TILES, GROUPS, RAILS, UTILS, FORTUNE_CARDS, LEDGER_CARDS } from './board.js';
import { RngStreams } from '../core/rng.js';

const START_CASH = 1500;
const START_BONUS = 200;
const JAIL_TILE = 10;
const JAIL_FINE = 50;
const MAX_ROUNDS = 400;

export class Engine {
  constructor(bus, opts) {
    this.bus = bus;
    this.opts = opts || {};
  }

  // ---------- setup ----------
  newGame({ seed, players, maxRounds }) {
    // players: [{ name, ai: bool }]
    // S6b-FIX-05: the round cap is now per-game state instead of a hard 400.
    // 400 rounds at the measured 3.0 rounds/min is a >2 hour ceiling, which is
    // why a game that is working correctly still reads as "never completes".
    // Default stays 400 so existing saves/fixtures are unchanged; the setup
    // screen and ?rounds= can pick a shorter, human-sized game.
    const cap = Number(maxRounds);
    this.rng = new RngStreams(seed | 0);
    this.state = {
      seed: seed | 0,
      round: 1,
      maxRounds: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : MAX_ROUNDS,
      current: 0,
      phase: 'awaitRoll', // awaitRoll | awaitEndTurn | gameOver
      doubleCount: 0,
      pending: null,       // { type, ... } decision surfaced to UI/AI
      players: players.map((p, i) => ({
        id: i, name: p.name, ai: !!p.ai,
        cash: START_CASH, pos: 0,
        inJail: false, jailTurns: 0, jailFree: 0,
        bankrupt: false,
      })),
      tiles: TILES.map((t) => ({
        id: t.id,
        owner: null,
        houses: 0,      // 5 = hotel
        mortgaged: false,
      })),
      decks: {
        fortune: this.rng.get('deck.fortune').shuffle(FORTUNE_CARDS.map((c) => c.id)),
        ledger: this.rng.get('deck.ledger').shuffle(LEDGER_CARDS.map((c) => c.id)),
      },
    };
    this.emit('turn:begin', { player: 0, round: 1 });
    this.setPending(null);
    return this.state;
  }

  emit(event, payload) { this.bus.emit(event, payload); }
  setPending(p) {
    this.state.pending = p;
    this.emit('pending:changed', { pending: p ? { ...p } : null });
  }

  // Single writer for state.phase. The UI action bar is a pure function of
  // (phase, pending, current player), so a phase transition MUST be observable
  // or the bar goes stale (measured: after buying, the bar still offered
  // "Roll Dice" while the engine was already in awaitEndTurn -> human seat
  // could never end its turn).
  setPhase(phase) {
    if (this.state.phase === phase) return;
    this.state.phase = phase;
    this.emit('phase:changed', { phase, player: this.state.current });
  }

  tile(i) { return TILES[i]; }
  tstate(i) { return this.state.tiles[i]; }
  // S5-FIX-04: expose colour-group membership so the UI can reflect the
  // even-build rule instead of offering a button the rules will reject.
  groupTiles(group) { return GROUPS[group] || []; }
  player(i) { return this.state.players[i]; }
  cur() { return this.state.players[this.state.current]; }

  alivePlayers() { return this.state.players.filter((p) => !p.bankrupt); }

  // ---------- money ----------
  credit(pid, amount, reason) {
    const p = this.player(pid);
    p.cash += amount;
    this.emit('cash:changed', { player: pid, delta: amount, balance: p.cash, reason });
  }

  // Try to charge. If insolvent, surface a mustRaise pending (sell/mortgage)
  // for humans; AI auto-liquidates via engine helper. Returns true if fully paid.
  charge(pid, amount, reason, creditorPid = null) {
    const p = this.player(pid);
    if (p.cash >= amount) {
      p.cash -= amount;
      this.emit('cash:changed', { player: pid, delta: -amount, balance: p.cash, reason });
      if (creditorPid !== null) this.credit(creditorPid, amount, reason);
      return true;
    }
    // attempt auto-liquidation of everything (worst case) to test solvency
    const liquid = p.cash + this.liquidationValue(pid);
    if (liquid < amount) {
      this.doBankrupt(pid, creditorPid, amount);
      return false;
    }
    // solvent if they sell: surface decision
    this.setPending({
      type: 'mustRaise', player: pid, amount, reason,
      creditor: creditorPid,
    });
    return false;
  }

  liquidationValue(pid) {
    let v = 0;
    for (const ts of this.state.tiles) {
      if (ts.owner !== pid) continue;
      const t = this.tile(ts.id);
      if (ts.houses > 0) v += ts.houses * (t.house / 2) * (ts.houses === 5 ? 0 : 1) + (ts.houses === 5 ? 5 * (t.house / 2) : 0);
      if (!ts.mortgaged) v += Math.floor((t.price || 0) / 2);
    }
    return v;
  }

  doBankrupt(pid, creditorPid, debt) {
    const p = this.player(pid);
    p.bankrupt = true;
    // transfer assets
    for (const ts of this.state.tiles) {
      if (ts.owner === pid) {
        if (creditorPid !== null) {
          ts.owner = creditorPid;
          // creditor inherits mortgage state; houses are sold to bank
          if (ts.houses > 0) {
            const t = this.tile(ts.id);
            this.credit(creditorPid, ts.houses === 5 ? 5 * (t.house / 2) : ts.houses * (t.house / 2), 'houseSale');
            ts.houses = 0;
            this.emit('build:changed', { player: creditorPid, tile: ts.id, houses: 0 });
          }
        } else {
          ts.owner = null; ts.houses = 0; ts.mortgaged = false;
        }
      }
    }
    if (creditorPid !== null && p.cash > 0) this.credit(creditorPid, p.cash, 'bankruptcyTransfer');
    p.cash = 0;
    this.emit('player:bankrupt', { player: pid, creditor: creditorPid });
    const alive = this.alivePlayers();
    if (alive.length === 1) {
      this.endGame(alive[0].id, 'lastSolvent');
    } else if (pid === this.state.current) {
      this.setPending(null);
      this.advanceTurn();
    }
  }

  endGame(winner, reason) {
    this.setPhase('gameOver');
    this.setPending(null);
    this.emit('game:over', { winner, reason, rounds: this.state.round });
  }

  netWorth(pid) {
    const p = this.player(pid);
    let v = p.cash;
    for (const ts of this.state.tiles) {
      if (ts.owner !== pid) continue;
      const t = this.tile(ts.id);
      v += ts.mortgaged ? Math.floor((t.price || 0) / 2) : (t.price || 0);
      v += (ts.houses === 5 ? 5 : ts.houses) * (t.house || 0);
    }
    return v;
  }

  // ---------- turn flow ----------
  // act(action, params) is the ONLY mutation entry point for UI/AI.
  act(action, params = {}) {
    const s = this.state;
    if (s.phase === 'gameOver') return { ok: false, error: 'gameOver' };
    const pnd = s.pending;

    switch (action) {
      case 'roll': {
        if (s.phase !== 'awaitRoll' || pnd) return { ok: false, error: 'notNow' };
        return this.doRoll();
      }
      case 'endTurn': {
        if (s.phase !== 'awaitEndTurn' || pnd) return { ok: false, error: 'notNow' };
        this.advanceTurn();
        return { ok: true };
      }
      case 'buy': {
        if (!pnd || pnd.type !== 'buy') return { ok: false, error: 'noOffer' };
        return this.doBuy(pnd.player, pnd.tile);
      }
      case 'declineBuy': {
        if (!pnd || pnd.type !== 'buy') return { ok: false, error: 'noOffer' };
        return this.startAuction(pnd.tile);
      }
      case 'auctionBid': {
        if (!pnd || pnd.type !== 'auction') return { ok: false, error: 'noAuction' };
        return this.doAuctionBid(params.player, params.amount | 0);
      }
      case 'jailChoice': {
        if (!pnd || pnd.type !== 'jail') return { ok: false, error: 'noJail' };
        return this.doJailChoice(params.choice);
      }
      case 'build': {
        if (pnd) return { ok: false, error: 'pendingBlocks' };
        return this.doBuild(params.player, params.tile, params.delta | 0);
      }
      case 'mortgage': {
        // allowed during mustRaise for the debtor, or freely when no pending
        if (pnd && !(pnd.type === 'mustRaise' && pnd.player === params.player)) return { ok: false, error: 'pendingBlocks' };
        return this.doMortgage(params.player, params.tile, !!params.set);
      }
      case 'sellHouse': {
        if (pnd && !(pnd.type === 'mustRaise' && pnd.player === params.player)) return { ok: false, error: 'pendingBlocks' };
        return this.doBuild(params.player, params.tile, -1);
      }
      case 'settleDebt': {
        if (!pnd || pnd.type !== 'mustRaise' || pnd.player !== params.player) return { ok: false, error: 'noDebt' };
        const p = this.player(pnd.player);
        if (p.cash < pnd.amount) return { ok: false, error: 'stillShort' };
        const { amount, reason, creditor } = pnd;
        this.setPending(null);
        p.cash -= amount;
        this.emit('cash:changed', { player: p.id, delta: -amount, balance: p.cash, reason });
        if (creditor !== null && creditor !== undefined) this.credit(creditor, amount, reason);
        this.afterResolve();
        return { ok: true };
      }
      case 'proposeTrade': {
        if (pnd) return { ok: false, error: 'pendingBlocks' };
        return this.doProposeTrade(params);
      }
      case 'respondTrade': {
        if (!pnd || pnd.type !== 'trade') return { ok: false, error: 'noTrade' };
        return this.doRespondTrade(!!params.accept);
      }
      default:
        return { ok: false, error: 'unknownAction:' + action };
    }
  }

  doRoll() {
    const s = this.state;
    const p = this.cur();
    const rng = this.rng.get('dice');
    const d1 = rng.die(), d2 = rng.die();
    const doubles = d1 === d2;

    if (p.inJail) {
      this.emit('dice:rolled', { player: p.id, d1, d2, doubles, doubleCount: 0 });
      if (doubles) {
        p.inJail = false; p.jailTurns = 0;
        this.emit('jail:exited', { player: p.id, method: 'doubles' });
        this.moveBy(d1 + d2);
      } else {
        p.jailTurns++;
        if (p.jailTurns >= 3) {
          // must pay fine then move
          p.inJail = false; p.jailTurns = 0;
          if (this.charge(p.id, JAIL_FINE, 'jailFine')) {
            this.emit('jail:exited', { player: p.id, method: 'forcedFine' });
            this.moveBy(d1 + d2);
          } else {
            // mustRaise pending or bankrupt; stash the move
            this._afterDebt = () => {
              this.emit('jail:exited', { player: p.id, method: 'forcedFine' });
              this.moveBy(d1 + d2);
            };
          }
        } else {
          this.setPhase('awaitEndTurn');
        }
      }
      return { ok: true, d1, d2 };
    }

    if (doubles) s.doubleCount++; else s.doubleCount = 0;
    this.emit('dice:rolled', { player: p.id, d1, d2, doubles, doubleCount: s.doubleCount });

    if (s.doubleCount >= 3) {
      s.doubleCount = 0;
      this.sendToJail(p.id, 'threeDoubles');
      return { ok: true, d1, d2 };
    }
    this.moveBy(d1 + d2);
    return { ok: true, d1, d2 };
  }

  moveBy(steps) {
    const p = this.cur();
    const from = p.pos;
    let to = (from + steps) % 40;
    if (to < 0) to += 40;
    const path = [];
    const dir = steps >= 0 ? 1 : -1;
    for (let i = 1; i <= Math.abs(steps); i++) path.push((from + dir * i + 400) % 40);
    const passedStart = steps > 0 && (from + steps) >= 40;
    p.pos = to;
    if (passedStart) this.credit(p.id, START_BONUS, 'passStart');
    this.emit('token:moved', { player: p.id, from, to, path, passedStart });
    this.landOn(to);
  }

  teleport(to, collectStart) {
    const p = this.cur();
    const from = p.pos;
    const passedStart = collectStart && to < from;
    p.pos = to;
    if (passedStart || (collectStart && to === 0)) this.credit(p.id, START_BONUS, 'passStart');
    this.emit('token:moved', { player: p.id, from, to, path: [to], passedStart: !!(passedStart || (collectStart && to === 0)) });
    this.landOn(to);
  }

  landOn(idx) {
    const p = this.cur();
    const t = this.tile(idx);
    this.emit('tile:landed', { player: p.id, tile: idx });

    switch (t.type) {
      case 'prop': case 'rail': case 'util': {
        const ts = this.tstate(idx);
        if (ts.owner === null) {
          if (p.cash >= t.price) {
            this.setPending({ type: 'buy', player: p.id, tile: idx, price: t.price });
            this.emit('offer:buy', { player: p.id, tile: idx, price: t.price });
          } else {
            this.startAuction(idx);
          }
        } else if (ts.owner !== p.id && !ts.mortgaged) {
          const rent = this.computeRent(idx);
          if (this.charge(p.id, rent, 'rent', ts.owner)) {
            this.emit('rent:paid', { from: p.id, to: ts.owner, tile: idx, amount: rent });
            this.afterResolve();
          } else {
            this._afterDebt = this._afterDebt || (() => {
              this.emit('rent:paid', { from: p.id, to: ts.owner, tile: idx, amount: rent });
            });
          }
          return;
        }
        break;
      }
      case 'tax': {
        if (this.charge(p.id, t.amount, 'tax')) {
          this.emit('tax:paid', { player: p.id, tile: idx, amount: t.amount });
          this.afterResolve();
        }
        return;
      }
      case 'card': {
        this.drawCard(t.deck);
        return;
      }
      case 'gotojail': {
        this.sendToJail(p.id, 'tile');
        return;
      }
      // start, jail (visiting), parking: nothing
    }
    this.afterResolve();
  }

  computeRent(idx) {
    const t = this.tile(idx);
    const ts = this.tstate(idx);
    const owner = ts.owner;
    if (t.type === 'rail') {
      const n = RAILS.filter((r) => this.tstate(r).owner === owner && !this.tstate(r).mortgaged).length;
      return 25 * Math.pow(2, n - 1);
    }
    if (t.type === 'util') {
      const n = UTILS.filter((u) => this.tstate(u).owner === owner && !this.tstate(u).mortgaged).length;
      const rng = this.rng.get('dice');
      const roll = rng.die() + rng.die();
      return roll * (n === 2 ? 10 : 4);
    }
    // property
    if (ts.houses > 0) return t.rent[ts.houses];
    const groupTiles = GROUPS[t.group];
    const ownsAll = groupTiles.every((g) => this.tstate(g).owner === owner);
    return ownsAll ? t.rent[0] * 2 : t.rent[0];
  }

  doBuy(pid, idx) {
    const t = this.tile(idx);
    const ts = this.tstate(idx);
    const p = this.player(pid);
    if (p.cash < t.price) return { ok: false, error: 'cash' };
    this.setPending(null);
    p.cash -= t.price;
    this.emit('cash:changed', { player: pid, delta: -t.price, balance: p.cash, reason: 'purchase' });
    ts.owner = pid;
    this.emit('property:bought', { player: pid, tile: idx, price: t.price });
    this.afterResolve();
    return { ok: true };
  }

  // ---------- auction (sealed bid, one round) ----------
  startAuction(idx) {
    const bidders = this.alivePlayers().map((p) => p.id);
    this.setPending({ type: 'auction', tile: idx, bidders, bids: {}, next: bidders[0] });
    this.emit('auction:started', { tile: idx, bidders });
    return { ok: true };
  }

  doAuctionBid(pid, amount) {
    const pnd = this.state.pending;
    if (pnd.next !== pid) return { ok: false, error: 'notYourBid' };
    const p = this.player(pid);
    const bid = Math.max(0, Math.min(amount, p.cash));
    pnd.bids[pid] = bid;
    const i = pnd.bidders.indexOf(pid);
    if (i + 1 < pnd.bidders.length) {
      pnd.next = pnd.bidders[i + 1];
      this.setPending({ ...pnd });
      return { ok: true };
    }
    // all bids in - resolve
    let best = null, bestBid = 0;
    for (const b of pnd.bidders) {
      const v = pnd.bids[b] || 0;
      if (v > bestBid) { bestBid = v; best = b; }
    }
    const idx = pnd.tile;
    this.setPending(null);
    if (best === null || bestBid <= 0) {
      this.emit('auction:passed', { tile: idx });
    } else {
      const w = this.player(best);
      w.cash -= bestBid;
      this.emit('cash:changed', { player: best, delta: -bestBid, balance: w.cash, reason: 'auction' });
      this.tstate(idx).owner = best;
      this.emit('auction:won', { tile: idx, player: best, price: bestBid });
    }
    this.afterResolve();
    return { ok: true };
  }

  // ---------- cards ----------
  drawCard(deckName) {
    const p = this.cur();
    const deck = this.state.decks[deckName];
    const cardId = deck.shift();
    deck.push(cardId); // recycle to bottom
    const all = deckName === 'fortune' ? FORTUNE_CARDS : LEDGER_CARDS;
    const card = all.find((c) => c.id === cardId);
    this.emit('card:drawn', { player: p.id, deck: deckName, cardId, text: card.text });
    const fx = card.fx;

    if (fx.cash !== undefined) {
      if (fx.cash >= 0) { this.credit(p.id, fx.cash, 'card'); this.afterResolve(); }
      else if (this.charge(p.id, -fx.cash, 'card')) this.afterResolve();
      return;
    }
    if (fx.goto !== undefined) { this.teleport(fx.goto, true); return; }
    if (fx.move !== undefined) { this.moveBy(fx.move); return; }
    if (fx.jail) { this.sendToJail(p.id, 'card'); return; }
    if (fx.jailFree) { p.jailFree++; this.afterResolve(); return; }
    if (fx.nearestRail) {
      let pos = p.pos;
      let target = RAILS.find((r) => r > pos);
      if (target === undefined) target = RAILS[0];
      this.teleport(target, target < pos);
      return;
    }
    if (fx.repairs) {
      let cost = 0;
      for (const ts of this.state.tiles) {
        if (ts.owner === p.id) {
          if (ts.houses === 5) cost += fx.repairs[1];
          else cost += ts.houses * fx.repairs[0];
        }
      }
      if (cost === 0 || this.charge(p.id, cost, 'repairs')) this.afterResolve();
      return;
    }
    if (fx.payEach) {
      const others = this.alivePlayers().filter((x) => x.id !== p.id);
      const total = fx.payEach * others.length;
      if (this.charge(p.id, total, 'payEach')) {
        for (const o of others) this.credit(o.id, fx.payEach, 'payEach');
        this.afterResolve();
      }
      return;
    }
    if (fx.collectEach) {
      for (const o of this.alivePlayers().filter((x) => x.id !== p.id)) {
        // simple: others pay if they can, else skipped (documented simplification)
        if (o.cash >= fx.collectEach) {
          o.cash -= fx.collectEach;
          this.emit('cash:changed', { player: o.id, delta: -fx.collectEach, balance: o.cash, reason: 'collectEach' });
          this.credit(p.id, fx.collectEach, 'collectEach');
        }
      }
      this.afterResolve();
      return;
    }
    this.afterResolve();
  }

  // ---------- jail ----------
  sendToJail(pid, reason) {
    const p = this.player(pid);
    p.pos = JAIL_TILE;
    p.inJail = true;
    p.jailTurns = 0;
    this.state.doubleCount = 0;
    this.emit('jail:entered', { player: pid, reason });
    this.emit('token:moved', { player: pid, from: p.pos, to: JAIL_TILE, path: [JAIL_TILE], passedStart: false });
    this.setPhase('awaitEndTurn');
    this.setPending(null);
  }

  // called at the START of a jailed player's turn (before roll)
  offerJailChoice() {
    const p = this.cur();
    this.setPending({
      type: 'jail', player: p.id,
      canPay: p.cash >= JAIL_FINE, hasCard: p.jailFree > 0, turns: p.jailTurns,
    });
  }

  doJailChoice(choice) {
    const p = this.cur();
    this.setPending(null);
    if (choice === 'card' && p.jailFree > 0) {
      p.jailFree--;
      p.inJail = false; p.jailTurns = 0;
      this.emit('jail:exited', { player: p.id, method: 'card' });
      return this.doRoll();
    }
    if (choice === 'pay' && p.cash >= JAIL_FINE) {
      p.cash -= JAIL_FINE;
      this.emit('cash:changed', { player: p.id, delta: -JAIL_FINE, balance: p.cash, reason: 'jailFine' });
      p.inJail = false; p.jailTurns = 0;
      this.emit('jail:exited', { player: p.id, method: 'paid' });
      return this.doRoll();
    }
    // roll attempt
    return this.doRoll();
  }

  // ---------- build / mortgage ----------
  canBuildOn(pid, idx) {
    const t = this.tile(idx);
    if (!t || t.type !== 'prop') return false;
    const ts = this.tstate(idx);
    if (ts.owner !== pid || ts.mortgaged) return false;
    const group = GROUPS[t.group];
    if (!group.every((g) => this.tstate(g).owner === pid && !this.tstate(g).mortgaged)) return false;
    return true;
  }

  doBuild(pid, idx, delta) {
    const t = this.tile(idx);
    const ts = this.tstate(idx);
    if (!t || t.type !== 'prop') return { ok: false, error: 'notProp' };
    if (ts.owner !== pid) return { ok: false, error: 'notOwner' };
    if (delta > 0) {
      if (!this.canBuildOn(pid, idx)) return { ok: false, error: 'noGroup' };
      if (ts.houses >= 5) return { ok: false, error: 'maxed' };
      // even-build rule
      const group = GROUPS[t.group];
      const min = Math.min(...group.map((g) => this.tstate(g).houses));
      if (ts.houses > min) return { ok: false, error: 'evenBuild' };
      const p = this.player(pid);
      if (p.cash < t.house) return { ok: false, error: 'cash' };
      p.cash -= t.house;
      this.emit('cash:changed', { player: pid, delta: -t.house, balance: p.cash, reason: 'build' });
      ts.houses++;
      this.emit('build:changed', { player: pid, tile: idx, houses: ts.houses });
      return { ok: true };
    }
    if (delta < 0) {
      if (ts.houses <= 0) return { ok: false, error: 'noHouses' };
      const group = GROUPS[t.group];
      const max = Math.max(...group.map((g) => this.tstate(g).houses));
      if (ts.houses < max) return { ok: false, error: 'evenSell' };
      ts.houses--;
      this.credit(pid, Math.floor(t.house / 2), 'houseSale');
      this.emit('build:changed', { player: pid, tile: idx, houses: ts.houses });
      return { ok: true };
    }
    return { ok: false, error: 'zeroDelta' };
  }

  doMortgage(pid, idx, set) {
    const t = this.tile(idx);
    const ts = this.tstate(idx);
    if (ts.owner !== pid) return { ok: false, error: 'notOwner' };
    if (set) {
      if (ts.mortgaged) return { ok: false, error: 'already' };
      if (ts.houses > 0) return { ok: false, error: 'hasHouses' };
      ts.mortgaged = true;
      this.credit(pid, Math.floor(t.price / 2), 'mortgage');
      this.emit('mortgage:changed', { player: pid, tile: idx, mortgaged: true });
      return { ok: true };
    }
    if (!ts.mortgaged) return { ok: false, error: 'notMortgaged' };
    const half = Math.floor(t.price / 2);
    const cost = half + Math.ceil(half / 10); // principal + 10% interest, integer-safe
    const p = this.player(pid);
    if (p.cash < cost) return { ok: false, error: 'cash' };
    p.cash -= cost;
    this.emit('cash:changed', { player: pid, delta: -cost, balance: p.cash, reason: 'unmortgage' });
    ts.mortgaged = false;
    this.emit('mortgage:changed', { player: pid, tile: idx, mortgaged: false });
    return { ok: true };
  }

  // ---------- trading ----------
  doProposeTrade({ from, to, give, get, giveCash, getCash }) {
    // give/get: arrays of tile ids owned by from/to respectively (no houses on any)
    give = give || []; get = get || [];
    giveCash = giveCash | 0; getCash = getCash | 0;
    for (const i of give) {
      const ts = this.tstate(i);
      if (ts.owner !== from || ts.houses > 0) return { ok: false, error: 'invalidGive' };
    }
    for (const i of get) {
      const ts = this.tstate(i);
      if (ts.owner !== to || ts.houses > 0) return { ok: false, error: 'invalidGet' };
    }
    if (this.player(from).cash < giveCash) return { ok: false, error: 'giveCash' };
    if (this.player(to).cash < getCash) return { ok: false, error: 'getCash' };
    this.setPending({ type: 'trade', from, to, give, get, giveCash, getCash });
    this.emit('trade:proposed', { from, to, give: [...give, giveCash], get: [...get, getCash] });
    return { ok: true };
  }

  doRespondTrade(accept) {
    const pnd = this.state.pending;
    const { from, to, give, get, giveCash, getCash } = pnd;
    this.setPending(null);
    if (accept) {
      for (const i of give) { this.tstate(i).owner = to; }
      for (const i of get) { this.tstate(i).owner = from; }
      if (giveCash) {
        this.player(from).cash -= giveCash;
        this.emit('cash:changed', { player: from, delta: -giveCash, balance: this.player(from).cash, reason: 'trade' });
        this.credit(to, giveCash, 'trade');
      }
      if (getCash) {
        this.player(to).cash -= getCash;
        this.emit('cash:changed', { player: to, delta: -getCash, balance: this.player(to).cash, reason: 'trade' });
        this.credit(from, getCash, 'trade');
      }
    }
    this.emit('trade:resolved', { from, to, accepted: accept });
    return { ok: true };
  }

  // ---------- resolution / turn advance ----------
  afterResolve() {
    if (this.state.phase === 'gameOver') return;
    if (this.state.pending) return; // still waiting on a decision
    if (this._afterDebt) { const f = this._afterDebt; this._afterDebt = null; f(); return; }
    const s = this.state;
    if (s.doubleCount > 0 && !this.cur().inJail && !this.cur().bankrupt) {
      this.setPhase('awaitRoll'); // roll again on doubles
    } else {
      this.setPhase('awaitEndTurn');
    }
  }

  advanceTurn() {
    const s = this.state;
    if (s.phase === 'gameOver') return;
    this.emit('turn:end', { player: s.current });
    s.doubleCount = 0;
    // next non-bankrupt player
    let n = s.current;
    for (let i = 0; i < s.players.length; i++) {
      n = (n + 1) % s.players.length;
      if (!s.players[n].bankrupt) break;
    }
    if (n <= s.current) {
      s.round++;
      // S6b-FIX-05: read the cap off state (older saves lack it -> MAX_ROUNDS).
      if (s.round > (s.maxRounds || MAX_ROUNDS)) {
        // turn cap: highest net worth wins
        let best = null, bw = -1;
        for (const p of this.alivePlayers()) {
          const w = this.netWorth(p.id);
          if (w > bw) { bw = w; best = p.id; }
        }
        this.endGame(best, 'turnCap');
        return;
      }
    }
    s.current = n;
    this.setPhase('awaitRoll');
    this.emit('turn:begin', { player: n, round: s.round });
    if (this.cur().inJail) this.offerJailChoice();
    else this.setPending(null);
  }

  // ---------- serialization ----------
  serialize() {
    return JSON.stringify({
      v: 1,
      state: this.state,
      rng: this.rng.serialize(),
    });
  }

  load(json, source) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    this.state = data.state;
    this.rng = RngStreams.deserialize(data.rng);
    this.emit('state:loaded', { source: source || 'unknown' });
    this.emit('pending:changed', { pending: this.state.pending ? { ...this.state.pending } : null });
    return this.state;
  }
}
