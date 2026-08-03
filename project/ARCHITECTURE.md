# Meridian Estates - 3D Property Trading Board Game
## Architecture Contract (written BEFORE code, per threejs-aaa-master-playbook v2)

Original IP: game name "Meridian Estates", all street/card/corner names original.
Generic mechanics only (dice movement, property purchase, rent, houses/hotels,
jail, chance-style cards, bankruptcy win). No Hasbro trademarks anywhere.

## Subsystem interface

Every subsystem exports a class with `static id`, `static deps`, and
`init(ctx)` / `update(dt)` / `dispose()`. Cross-subsystem access ONLY via
`ctx.get(id)` at runtime and via the event bus. No cross-subsystem imports.

Directory ownership:
- `src/core/`   - rng (seeded xoshiro128**, named streams), event bus, vocabulary
- `src/rules/`  - HEADLESS rules engine + board data. Zero DOM, zero three.js.
- `src/game/`   - AI heuristic, fixtures, save/load codecs. Headless.
- `src/render/` - three.js scene: board, tokens, dice, camera, light pool,
                  black-frame watchdog, frame-error containment. Listens to events.
- `src/ui/`     - DOM panels (buy/auction, rent, card flip, jail, tax, manage,
                  trade, setup, save/load). Listens to events, calls engine.act().

## Determinism scoping (v2 rule 4)

Seeded RNG streams (xoshiro128**, forked by name from one master seed):
`dice`, `deck.fortune`, `deck.ledger`, `ai`, `auction`.
ALL gameplay randomness consumes these streams, including every AI decision,
so a full game replays identically from `?seed=`.
Cosmetic animation (token hops, dice tumble, card flip, light pulses) is driven
by performance.now / RAF delta - DOCUMENTED trade-off: visuals are not
frame-deterministic, game outcomes are.

## Runtime resilience (v2 rules 1-3)

1. FIXED LIGHT POOL: 6 PointLights created once at init, added to the scene
   once, intensity 0 when idle. Effects (dice glow, card flourish, build flash)
   acquire()/release(); overflow effects run unlit. Scene light count NEVER
   changes at runtime (program-key stability).
2. BLACK-FRAME WATCHDOG: readPixels an 8x8 center block at ~1.5s and ~3s after
   first frame; two all-black reads => permanent forceDirect(): plain forward
   render (no tone-mapping extras, no shadows, pixelRatio 1).
3. FRAME-ERROR CONTAINMENT: try/catch inside the RAF loop; 3 repeated frame
   errors => drop post/shadow features and keep playing. Exactly ONE automatic
   quality step-down, decided from a rolling 120-sample fps window.

## Turn state machine (rules engine)

States: `awaitRoll -> moving -> resolving -> (pendingDecision)* -> awaitEndTurn -> next player`.
The engine NEVER blocks: every required input is surfaced as
`state.pending = { type, player, ... }` and answered via `engine.act(action, params)`.
Watchdog invariant (queen-freeze lesson generalized): no reachable game state
may leave `pending === null` AND `phase` not advanceable; the vitest watchdog
test drives seeded AI-only games to completion under a hard step budget.

Termination guarantee: last solvent player wins; hard cap 400 rounds, then
highest net worth wins (`game:over` reason `turnCap`).

## Auction rule (documented simplification)

Declined properties go to a single sealed-bid auction: each solvent player
submits one bid (AI bids from heuristic + `auction` stream; humans get a panel).
Highest bid wins, ties broken by seat order. Zero bids => property stays with bank.

## AI value heuristic (documented)

- Buy priority by ROI: expectedRent / price, weighted x2 if purchase completes
  a color group, x1.5 if it blocks an opponent's group; buy if cash after
  purchase >= safety floor (150 + 25 per owned mortgage).
- Unmortgage order: highest (rent / unmortgageCost) first, only when
  cash > floor + cost.
- House building: only on full groups; even-build; priority = group with
  highest marginal rent per house cost; stop at safety floor.
- Trade acceptance: accept if netValue(get) - netValue(give) >= 0, where a
  property completing own group counts x2 and one completing opponent group
  counts x2 against. Counter-offers not modeled.
- Jail: pay early game (< round 12) to keep buying; roll late game.
- All tie-breaks and bid jitter consume the `ai` / `auction` streams.

## Quality presets

- high: shadows on, pixelRatio min(devicePixelRatio,2), antialias
- low:  shadows off, pixelRatio 1 (auto step-down target and forceDirect target)

## Event vocabulary (source of truth - machine parsed by tests)

Payload keys are exact and exhaustive; the conformance test fails on any
emitted event missing from this table or carrying undeclared keys.

| event | payload keys |
|---|---|
| turn:begin | player, round |
| dice:rolled | player, d1, d2, doubles, doubleCount |
| token:moved | player, from, to, path, passedStart |
| tile:landed | player, tile |
| offer:buy | player, tile, price |
| property:bought | player, tile, price |
| auction:started | tile, bidders |
| auction:won | tile, player, price |
| auction:passed | tile |
| rent:paid | from, to, tile, amount |
| card:drawn | player, deck, cardId, text |
| tax:paid | player, tile, amount |
| jail:entered | player, reason |
| jail:exited | player, method |
| build:changed | player, tile, houses |
| mortgage:changed | player, tile, mortgaged |
| trade:proposed | from, to, give, get |
| trade:resolved | from, to, accepted |
| cash:changed | player, delta, balance, reason |
| player:bankrupt | player, creditor |
| turn:end | player |
| game:over | winner, reason, rounds |
| state:loaded | source |
| pending:changed | pending |
| phase:changed | phase, player |

## Deterministic review states

`?seed=<n>` master seed. `?fixture=midgame|endgame|jail|bankruptcy-imminent`
loads a hand-authored serialized state. `?autoplay=1` all seats AI + fast
animations; on game:over sets `window.__gameResult` and `#game-status`
textContent `GAME OVER: <winner>` for scripted browser verification.
`?players=N` (1-4), `?humans=bitmask`.
