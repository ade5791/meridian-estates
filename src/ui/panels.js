// DOM UI: turn HUD, buy/auction, rent toast, jail choice, tax toast,
// manage (build/mortgage), trade, save/load, game over.
// Listens to bus events; mutates game ONLY via engine.act().

import { TILES, GROUPS, GROUP_COLORS } from '../rules/board.js';

const TOKEN_CSS = ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6'];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class UISystem {
  static id = 'ui';
  static deps = ['engine'];

  constructor(root, bus) {
    this.root = root;
    this.bus = bus;
    this.toastTimer = null;
  }

  init(ctx) {
    this.ctx = ctx;
    this.engine = ctx.get('engine');
    this.buildDom();
    this.bindEvents();
    this.refreshHud();
    this.refreshActions();
  }

  buildDom() {
    this.root.innerHTML = `
      <div id="hud">
        <div id="players"></div>
        <div id="turn-info"></div>
        <div id="game-status" aria-live="polite"></div>
      </div>
      <div id="actions"></div>
      <div id="log"></div>
      <div id="panel-wrap" class="hidden"><div id="panel"></div></div>
      <div id="toast" class="hidden"></div>
    `;
    this.$players = this.root.querySelector('#players');
    this.$turn = this.root.querySelector('#turn-info');
    this.$status = this.root.querySelector('#game-status');
    this.$actions = this.root.querySelector('#actions');
    this.$log = this.root.querySelector('#log');
    this.$panelWrap = this.root.querySelector('#panel-wrap');
    this.$panel = this.root.querySelector('#panel');
    this.$toast = this.root.querySelector('#toast');
  }

  log(msg) {
    const d = el('div', 'log-line', msg);
    this.$log.prepend(d);
    while (this.$log.children.length > 60) this.$log.lastChild.remove();
  }

  toast(msg, ms = 2600) {
    this.$toast.textContent = msg;
    this.$toast.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.$toast.classList.add('hidden'), ms);
  }

  name(pid) { return this.engine.player(pid).name; }
  tname(idx) { return TILES[idx].name; }

  bindEvents() {
    const b = this.bus;
    b.on('turn:begin', (p) => { this.refreshHud(); this.refreshActions(); this.log(`Round ${p.round}: ${this.name(p.player)}'s turn`); });
    b.on('dice:rolled', (p) => this.log(`${this.name(p.player)} rolled ${p.d1}+${p.d2}${p.doubles ? ' (doubles)' : ''}`));
    b.on('tile:landed', (p) => this.log(`${this.name(p.player)} landed on ${this.tname(p.tile)}`));
    b.on('cash:changed', () => this.refreshHud());
    b.on('property:bought', (p) => { this.log(`${this.name(p.player)} bought ${this.tname(p.tile)} for ${p.price}`); this.refreshHud(); });
    b.on('rent:paid', (p) => this.toast(`${this.name(p.from)} paid ${p.amount} rent to ${this.name(p.to)} (${this.tname(p.tile)})`));
    b.on('tax:paid', (p) => this.toast(`${this.name(p.player)} paid ${p.amount} tax at ${this.tname(p.tile)}`));
    b.on('card:drawn', (p) => this.log(`${this.name(p.player)} drew: ${p.text}`));
    b.on('jail:entered', (p) => this.toast(`${this.name(p.player)} was sent to the Holding House`));
    b.on('jail:exited', (p) => this.log(`${this.name(p.player)} left the Holding House (${p.method})`));
    b.on('auction:started', (p) => this.log(`Auction: ${this.tname(p.tile)}`));
    b.on('auction:won', (p) => this.log(`${this.name(p.player)} won ${this.tname(p.tile)} at auction for ${p.price}`));
    b.on('auction:passed', (p) => this.log(`No bids for ${this.tname(p.tile)}`));
    b.on('build:changed', (p) => this.log(`${this.tname(p.tile)}: ${p.houses >= 5 ? 'hotel' : p.houses + ' house(s)'}`));
    b.on('mortgage:changed', (p) => this.log(`${this.tname(p.tile)} ${p.mortgaged ? 'mortgaged' : 'unmortgaged'}`));
    b.on('trade:proposed', (p) => this.log(`Trade proposed: ${this.name(p.from)} -> ${this.name(p.to)}`));
    b.on('trade:resolved', (p) => { this.log(`Trade ${p.accepted ? 'ACCEPTED' : 'declined'}`); this.refreshHud(); });
    b.on('player:bankrupt', (p) => { this.toast(`${this.name(p.player)} is bankrupt`); this.refreshHud(); });
    b.on('game:over', (p) => this.showGameOver(p));
    b.on('pending:changed', () => { this.refreshPanel(); this.refreshActions(); });
    b.on('phase:changed', () => { this.refreshPanel(); this.refreshActions(); });
    b.on('state:loaded', () => { this.refreshHud(); this.refreshPanel(); this.refreshActions(); this.log('State loaded'); });
    b.on('turn:end', () => this.refreshActions());
  }

  refreshHud() {
    const s = this.engine.state;
    this.$players.innerHTML = '';
    s.players.forEach((p, i) => {
      const d = el('div', 'player-chip' + (i === s.current ? ' current' : '') + (p.bankrupt ? ' dead' : ''));
      d.innerHTML = `<span class="dot" style="background:${TOKEN_CSS[i % 4]}"></span>
        <b>${p.name}</b>${p.ai ? ' <i>(AI)</i>' : ''} - ${p.bankrupt ? 'OUT' : p.cash}
        ${p.inJail ? ' [JAIL]' : ''}${p.jailFree ? ' [WRIT]' : ''}`;
      this.$players.appendChild(d);
    });
    // S6b-FIX-05: show the finish line. Previously the HUD read "Round 12"
    // with no ceiling anywhere on screen, so a correctly-running game gave the
    // player no evidence it would ever end.
    const cap = s.maxRounds || 400;
    const alive = s.players.filter((p) => !p.bankrupt).length;
    this.$turn.textContent = `Round ${s.round} / ${cap}  -  ${alive} of ${s.players.length} solvent`;
  }

  refreshActions() {
    const s = this.engine.state;
    this.$actions.innerHTML = '';
    if (s.phase === 'gameOver') return;
    const p = this.engine.cur();
    if (p.ai) { this.$actions.appendChild(el('div', 'ai-note', `${p.name} (AI) is thinking...`)); this.addUtilityButtons(); return; }
    if (s.pending) { this.addUtilityButtons(); return; }

    if (s.phase === 'awaitRoll') {
      const b = el('button', 'btn primary', 'Roll Dice');
      b.onclick = () => this.engine.act('roll');
      this.$actions.appendChild(b);
    }
    if (s.phase === 'awaitEndTurn') {
      const manage = el('button', 'btn', 'Manage');
      manage.onclick = () => this.showManage(p.id);
      this.$actions.appendChild(manage);
      const trade = el('button', 'btn', 'Trade');
      trade.onclick = () => this.showTradeBuilder(p.id);
      this.$actions.appendChild(trade);
      const b = el('button', 'btn primary', 'End Turn');
      b.onclick = () => this.engine.act('endTurn');
      this.$actions.appendChild(b);
    }
    this.addUtilityButtons();
  }

  addUtilityButtons() {
    const save = el('button', 'btn small', 'Save');
    save.onclick = () => {
      localStorage.setItem('meridian-save', this.engine.serialize());
      this.toast('Game saved');
    };
    const load = el('button', 'btn small', 'Load');
    load.onclick = () => {
      const data = localStorage.getItem('meridian-save');
      if (!data) return this.toast('No save found');
      this.engine.load(data, 'localStorage');
    };
    const exp = el('button', 'btn small', 'Export');
    exp.onclick = () => {
      const blob = new Blob([this.engine.serialize()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'meridian-estates-save.json';
      a.click();
      URL.revokeObjectURL(a.href);
    };
    // S6b-FIX-04: speed control. Measured 3.0 rounds/min at 1x => a typical
    // 41-49 round game takes ~15 minutes, most of it watching AI opponents
    // think. This is the single biggest reason a game felt like it never
    // finished. Always rendered (including during AI turns) so a waiting
    // player can always speed things up. Cosmetic only - identical outcomes.
    const speedBtn = el('button', 'btn small', 'Speed ' + this.speedLabel());
    speedBtn.title = 'Game speed - affects animation and AI thinking time only';
    speedBtn.onclick = () => {
      // S6c-FIX: 4x is the shipped default, so the cycle starts there and
      // offers 8x for players who want an even faster AI-vs-AI game.
      const order = [4, 8, 1, 2];
      const r = this.ctx.get('render');
      const cur = r && r.speed ? r.speed : 1;
      const next = order[(order.indexOf(cur) + 1) % order.length] || 1;
      if (r) r.setSpeed(next);
      try { localStorage.setItem('meridian-speed', String(next)); } catch (e) { /* private mode */ }
      this.refreshActions();
      this.toast('Speed ' + next + 'x');
    };

    // S6d-FIX-03: camera reset. Free orbit is only safe to ship if the player
    // can always get back to the solved framing - otherwise a bad drag looks
    // like the board broke. Always rendered, including during AI turns.
    const viewBtn = el('button', 'btn small', 'Reset View');
    viewBtn.title = 'Recentre the camera (drag to orbit, scroll or pinch to zoom, R resets)';
    viewBtn.onclick = () => {
      const r = this.ctx.get('render');
      if (r && r.resetView) r.resetView();
      this.toast('View reset');
    };

    const wrap = el('div', 'util-btns');
    wrap.append(save, load, exp, speedBtn, viewBtn);
    this.$actions.appendChild(wrap);
  }

  speedLabel() {
    const r = this.ctx ? this.ctx.get('render') : null;
    return (r && r.speed ? r.speed : 1) + 'x';
  }

  // ---------- pending-driven panels ----------
  refreshPanel() {
    const pnd = this.engine.state.pending;
    if (!pnd) { this.hidePanel(); return; }
    // AI decisions are handled by the AI driver; only show panels for humans
    const pid = pnd.type === 'auction' ? pnd.next : pnd.type === 'trade' ? pnd.to : pnd.player;
    const p = this.engine.player(pid);
    if (p && p.ai) { this.hidePanel(); return; }

    switch (pnd.type) {
      case 'buy': return this.showBuy(pnd);
      case 'auction': return this.showAuctionBid(pnd);
      case 'jail': return this.showJail(pnd);
      case 'mustRaise': return this.showMustRaise(pnd);
      case 'trade': return this.showTradeRespond(pnd);
    }
  }

  showPanel(html) {
    this.$panel.innerHTML = html;
    this.$panelWrap.classList.remove('hidden');
  }
  hidePanel() { this.$panelWrap.classList.add('hidden'); }

  tileCard(idx) {
    const t = TILES[idx];
    const color = t.group ? '#' + GROUP_COLORS[t.group].toString(16).padStart(6, '0') : '#888';
    const rentRows = t.rent
      ? `<div class="rent-rows">Rent ${t.rent[0]} - 1h ${t.rent[1]} - 2h ${t.rent[2]} - 3h ${t.rent[3]} - 4h ${t.rent[4]} - hotel ${t.rent[5]}</div>`
      : '';
    return `<div class="tile-card"><div class="tile-strip" style="background:${color}"></div>
      <h3>${t.name}</h3>${t.price ? `<div>Price ${t.price}</div>` : ''}${rentRows}</div>`;
  }

  showBuy(pnd) {
    this.showPanel(`
      ${this.tileCard(pnd.tile)}
      <p>${this.name(pnd.player)}, buy for ${pnd.price}?</p>
      <button class="btn primary" id="p-buy">Buy</button>
      <button class="btn" id="p-pass">Decline (auction)</button>
    `);
    this.$panel.querySelector('#p-buy').onclick = () => this.engine.act('buy');
    this.$panel.querySelector('#p-pass').onclick = () => this.engine.act('declineBuy');
  }

  showAuctionBid(pnd) {
    const p = this.engine.player(pnd.next);
    this.showPanel(`
      ${this.tileCard(pnd.tile)}
      <p>Sealed-bid auction. ${p.name}, enter your bid (cash ${p.cash}):</p>
      <input type="number" id="p-bid" min="0" max="${p.cash}" value="0" />
      <button class="btn primary" id="p-submit">Submit Bid</button>
    `);
    this.$panel.querySelector('#p-submit').onclick = () => {
      const v = parseInt(this.$panel.querySelector('#p-bid').value || '0', 10);
      this.engine.act('auctionBid', { player: pnd.next, amount: v });
    };
  }

  showJail(pnd) {
    const btns = [];
    if (pnd.hasCard) btns.push(`<button class="btn primary" data-c="card">Use Release Writ</button>`);
    if (pnd.canPay) btns.push(`<button class="btn" data-c="pay">Pay 50 Fine</button>`);
    btns.push(`<button class="btn" data-c="roll">Try for Doubles</button>`);
    this.showPanel(`<h3>Holding House</h3><p>${this.name(pnd.player)}, turn ${pnd.turns + 1} of 3 inside.</p>${btns.join(' ')}`);
    this.$panel.querySelectorAll('button').forEach((b) => {
      b.onclick = () => this.engine.act('jailChoice', { choice: b.dataset.c });
    });
  }

  showMustRaise(pnd) {
    const p = this.engine.player(pnd.player);
    const rows = this.engine.state.tiles
      .filter((ts) => ts.owner === pnd.player)
      .map((ts) => {
        const t = TILES[ts.id];
        const acts = [];
        if (ts.houses > 0) acts.push(`<button class="btn small" data-a="sellHouse" data-t="${ts.id}">Sell house (+${Math.floor(t.house / 2)})</button>`);
        if (!ts.mortgaged && ts.houses === 0) acts.push(`<button class="btn small" data-a="mortgage" data-t="${ts.id}">Mortgage (+${Math.floor(t.price / 2)})</button>`);
        return `<div class="manage-row"><span>${t.name}${ts.mortgaged ? ' (M)' : ''} h:${ts.houses}</span>${acts.join('')}</div>`;
      }).join('');
    this.showPanel(`
      <h3>Raise ${pnd.amount}</h3>
      <p>${p.name} owes ${pnd.amount} (${pnd.reason}). Cash: ${p.cash}</p>
      <div class="manage-list">${rows || '<i>No assets</i>'}</div>
      <button class="btn primary" id="p-settle" ${p.cash >= pnd.amount ? '' : 'disabled'}>Pay Debt</button>
    `);
    this.$panel.querySelectorAll('button[data-a]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a, t = parseInt(b.dataset.t, 10);
        if (a === 'sellHouse') this.engine.act('sellHouse', { player: pnd.player, tile: t });
        else this.engine.act('mortgage', { player: pnd.player, tile: t, set: true });
        this.refreshPanel(); this.refreshHud();
      };
    });
    this.$panel.querySelector('#p-settle').onclick = () => this.engine.act('settleDebt', { player: pnd.player });
  }

  // ---------- manage screen (free action while awaitEndTurn) ----------
  showManage(pid) {
    const s = this.engine.state;
    const rows = s.tiles
      .filter((ts) => ts.owner === pid)
      .map((ts) => {
        const t = TILES[ts.id];
        const acts = [];
        if (t.type === 'prop' && this.engine.canBuildOn(pid, ts.id) && ts.houses < 5) {
          // S5-FIX-04: reflect the even-build rule and affordability in the UI.
          // Previously the Build button was always offered and the engine then
          // rejected the click with a "Cannot: evenBuild" toast -- an action
          // that looks available but always fails. Now the button is disabled
          // and says why, so the affordance matches the rules.
          const grp = this.engine.groupTiles ? this.engine.groupTiles(t.group) : null;
          const minH = grp ? Math.min(...grp.map((g) => this.engine.tstate(g).houses)) : ts.houses;
          const uneven = ts.houses > minH;
          const broke = this.engine.player(pid).cash < t.house;
          const why = uneven ? ' title="Even-build: build the rest of the group first"'
                    : broke ? ' title="Not enough cash"' : '';
          acts.push(`<button class="btn small" data-a="build" data-t="${ts.id}"${uneven || broke ? ' disabled' : ''}${why}>Build (${t.house})</button>`);
        }
        if (ts.houses > 0) acts.push(`<button class="btn small" data-a="sellHouse" data-t="${ts.id}">Sell house</button>`);
        if (!ts.mortgaged && ts.houses === 0) acts.push(`<button class="btn small" data-a="mortgage" data-t="${ts.id}">Mortgage</button>`);
        if (ts.mortgaged) acts.push(`<button class="btn small" data-a="unmortgage" data-t="${ts.id}">Unmortgage (${Math.floor(t.price / 2) + Math.ceil(Math.floor(t.price / 2) / 10)})</button>`);
        return `<div class="manage-row"><span>${t.name}${ts.mortgaged ? ' (M)' : ''} h:${ts.houses}</span>${acts.join('')}</div>`;
      }).join('');
    this.showPanel(`
      <h3>Manage - ${this.name(pid)}</h3>
      <div class="manage-list">${rows || '<i>No properties owned</i>'}</div>
      <button class="btn" id="p-close">Close</button>
    `);
    this.$panel.querySelectorAll('button[data-a]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a, t = parseInt(b.dataset.t, 10);
        let r;
        if (a === 'build') r = this.engine.act('build', { player: pid, tile: t, delta: 1 });
        else if (a === 'sellHouse') r = this.engine.act('sellHouse', { player: pid, tile: t });
        else if (a === 'mortgage') r = this.engine.act('mortgage', { player: pid, tile: t, set: true });
        else r = this.engine.act('mortgage', { player: pid, tile: t, set: false });
        if (r && !r.ok) this.toast('Cannot: ' + r.error);
        this.showManage(pid); this.refreshHud();
      };
    });
    this.$panel.querySelector('#p-close').onclick = () => this.hidePanel();
  }

  // ---------- trade ----------
  showTradeBuilder(pid) {
    const s = this.engine.state;
    const others = s.players.filter((p) => !p.bankrupt && p.id !== pid);
    const mine = s.tiles.filter((ts) => ts.owner === pid && ts.houses === 0);
    const optionsFor = (arr) => arr.map((ts) => `<label><input type="checkbox" value="${ts.id}"> ${TILES[ts.id].name}</label>`).join('');
    this.showPanel(`
      <h3>Propose Trade</h3>
      <p>Trade with:
        <select id="tr-to">${others.map((o) => `<option value="${o.id}">${o.name}</option>`).join('')}</select>
      </p>
      <div class="trade-cols">
        <div><h4>You give</h4><div id="tr-give">${optionsFor(mine) || '<i>nothing tradable</i>'}</div>
          <p>Cash: <input type="number" id="tr-givecash" value="0" min="0"></p></div>
        <div><h4>You get</h4><div id="tr-get"></div>
          <p>Cash: <input type="number" id="tr-getcash" value="0" min="0"></p></div>
      </div>
      <button class="btn primary" id="tr-send">Propose</button>
      <button class="btn" id="tr-cancel">Cancel</button>
    `);
    const $to = this.$panel.querySelector('#tr-to');
    const $get = this.$panel.querySelector('#tr-get');
    const renderGet = () => {
      const to = parseInt($to.value, 10);
      const theirs = s.tiles.filter((ts) => ts.owner === to && ts.houses === 0);
      $get.innerHTML = optionsFor(theirs) || '<i>nothing tradable</i>';
    };
    $to.onchange = renderGet;
    renderGet();
    this.$panel.querySelector('#tr-cancel').onclick = () => this.hidePanel();
    this.$panel.querySelector('#tr-send').onclick = () => {
      const to = parseInt($to.value, 10);
      const give = [...this.$panel.querySelectorAll('#tr-give input:checked')].map((i) => parseInt(i.value, 10));
      const get = [...$get.querySelectorAll('input:checked')].map((i) => parseInt(i.value, 10));
      const giveCash = parseInt(this.$panel.querySelector('#tr-givecash').value || '0', 10);
      const getCash = parseInt(this.$panel.querySelector('#tr-getcash').value || '0', 10);
      if (!give.length && !get.length && !giveCash && !getCash) return this.toast('Empty trade');
      const r = this.engine.act('proposeTrade', { from: pid, to, give, get, giveCash, getCash });
      if (!r.ok) this.toast('Cannot: ' + r.error);
    };
  }

  showTradeRespond(pnd) {
    const giveNames = pnd.give.map((i) => TILES[i].name).join(', ') || 'nothing';
    const getNames = pnd.get.map((i) => TILES[i].name).join(', ') || 'nothing';
    this.showPanel(`
      <h3>Trade Offer</h3>
      <p>${this.name(pnd.from)} offers: <b>${giveNames}</b>${pnd.giveCash ? ' + ' + pnd.giveCash + ' cash' : ''}</p>
      <p>In exchange for: <b>${getNames}</b>${pnd.getCash ? ' + ' + pnd.getCash + ' cash' : ''}</p>
      <button class="btn primary" id="tr-acc">Accept</button>
      <button class="btn" id="tr-dec">Decline</button>
    `);
    this.$panel.querySelector('#tr-acc').onclick = () => this.engine.act('respondTrade', { accept: true });
    this.$panel.querySelector('#tr-dec').onclick = () => this.engine.act('respondTrade', { accept: false });
  }

  showGameOver(p) {
    this.$status.textContent = `GAME OVER: ${this.name(p.winner)}`;
    this.showPanel(`
      <h3>Game Over</h3>
      <p><b>${this.name(p.winner)}</b> wins by ${p.reason === 'turnCap' ? 'net worth at the round cap' : 'being the last solvent player'} after ${p.rounds} rounds.</p>
      <button class="btn primary" onclick="location.reload()">New Game</button>
    `);
  }

  update() {}
  dispose() { this.root.innerHTML = ''; }
}
