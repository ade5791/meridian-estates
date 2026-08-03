# S5 - QA Gates: Player-Journey Matrix

Build: Meridian Estates v0.3.0 (post-S4)
Harness: `tools/s5/journey.mjs` (37 stages) x 4 profiles, Playwright chromium, local static server :8155
Evidence: `docs/s5/<profile>/<stage>.png` (163 screenshots), logs `tools/s5/run_<profile>.log`

## Result

| Profile | Viewport / DPR | Stages | Console+page errors |
|---|---|---|---|
| desktop | 1440x900 @1, mouse/keyboard | 37/37 PASS | 0 |
| portrait | 390x844 @3, touch | 37/37 PASS | 0 |
| landscape | 844x390 @3, touch | 37/37 PASS | 0 |
| reduced | 1440x900 @1, prefers-reduced-motion: reduce | 37/37 PASS | 0 |

**148/148 stage executions pass. Zero console errors across the full matrix.**

Regression: `vitest run` = 23/23 pass after all S5 fixes (no rules/contract/watchdog regression).

## Coverage

Journey: launch -> new-game config (players/AI/seed) -> first roll -> purchase -> rent -> Fortune card -> Ledger card -> jail entry -> jail exit x3 (pay / writ card / doubles) -> houses (even-build) -> hotel -> mortgage roundtrip -> trade accepted -> trade rejected -> bankruptcy to player + win screen -> bankruptcy to bank -> asset transfer -> save/load roundtrip.

Edge cases (seeded fixtures, not grinding): three doubles -> jail; exact landing on Go (exactly 1 pass-start credit); card that moves onto an owned property (rent charged on arrival); bankruptcy to bank vs to player; trade rejection leaves ownership untouched; save/load mid-auction restores the auction panel and the auction still completes.

Fixtures: `?fixture=midgame|endgame|jail|bankruptcy-imminent` all load, render with 0 mismatches, light count 8.

Resilience (v2 rules, forced):
- Frame-error containment: 5 injected frame errors -> post-fx dropped, game still advances.
- Black-frame watchdog: 2 forced black reads -> `forceDirect()` permanent, shadows/fog off, DPR 1, still playable.
- Fixed light pool: distinct scene light counts observed across a full game = `[8]`.

UI/ergonomics: settings + sound toggle, pause/offscreen RAF gate (ticks freeze offscreen, resume playable), reduced-motion honoured (card flourish mesh suppressed), no overflow, canvas fills viewport, all touch targets >= 44px, primary action one-hand reachable in portrait.

## Defects found and fixed this step (all severity-high, fixed before S6)

| ID | Defect | Root cause | Fix |
|---|---|---|---|
| S5-FIX-01 | Seed typed on the setup screen was ignored by the engine | setup screen read the URL seed but never wrote the chosen value back before `newGame()` | `src/main.js`: seed made mutable; setup screen updates `URLSearchParams` before `startGame()` |
| S5-FIX-02 | Save/load not byte-identical before the first AI turn | RNG streams instantiated lazily, so the `ai` stream was absent from early saves | `src/core/rng.js`: `RngStreams` eagerly instantiates all canonical streams (dice, deck.fortune, deck.ledger, ai); all 4 always serialized |
| S5-FIX-03 | Save/Load unreachable while a modal was open | `#panel-wrap` (z-index 30) sat above `#actions` (z-index 10) | `index.html`: `#actions` raised to z-index 35 |
| S5-FIX-07 | reduced-motion media listener never removed | handler added in ctor, absent from `dispose()`; also referenced a non-existent `this.opts` | `src/render/scene.js`: store `_fastOpt`, remove the `change` listener in `dispose()` |
| S5-FIX-08 | Console error under autoplay policy | `AudioContext.resume()` / `.close()` promise rejections unhandled | `src/audio/sfx.js`: `.catch(() => {})` on both |

Harness bug (not a product defect): stage 12 clicked the same tile 3x and expected 3 houses; the engine's even-build rule correctly refused. Corrected to build across tiles 6/8/9 and to assert the even-build button is disabled with its explanatory tooltip.

## New regressions vs S4 baseline

None. S4's baseline (light pool constant at 8, leak audit clean, 23/23 units, mobile targets >= 44px) still holds; every S5 stage that re-tests those areas passes.

## Not proven

- Real-GPU visual quality at human framerates: this matrix ran on headless chromium. S4 measured the 9-cell perf matrix on hardware GL separately; S5 asserts correctness and zero errors, not frame timing.
- Real physical touch devices (profiles are Playwright touch emulation).
- Screen readers / full accessibility audit - out of this step's scope.
