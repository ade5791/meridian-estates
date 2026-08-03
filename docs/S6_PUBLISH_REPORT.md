# S6 - Publish and Live Verification

Game: **Meridian Estates** (original IP, property-trading genre)
Live URL: **https://ade5791.github.io/meridian-estates/**
Landing page: **https://ade5791.github.io/meridian-estates/about.html**
Repository: **https://github.com/ade5791/meridian-estates**

## Published artifact

| Item | Value |
|---|---|
| Build hash (SHA-256 of the sorted per-file manifest) | `c2eab958b646e8be1704ad489b6038d0927a8612459bc81fec656fd471d3f136` |
| Files in the published build | 17 |
| Total bytes | 2,142,620 |
| Commit SHA deployed | `7949052625e16ce2a7cf5b67586afefb75dcf1d4` |
| Pages source | branch `main`, path `/` |
| Pages status at verification | `built` |

Per-file hashes: `docs/BUILD_MANIFEST.txt` in the published repo.

### Byte-identity of what shipped

The gate is only meaningful if the bytes tested are the bytes served. Three checks,
in order:

1. **Publish tree vs gated dist** - every file hashed; 0 drift.
2. **Git line-ending normalization disabled** (`.gitattributes: * -text`). The first
   push warned that git would rewrite LF to CRLF, which would have published
   *different* bytes than the hash covers. Re-committed with normalization off and
   re-verified: **0 byte drift** after commit.
3. **Live URL vs local dist** - `index.html` downloaded from GitHub Pages and hashed:
   `49c02b717f145b87d32f213e91067baab5f5f7ce893eb51c883493900daab06e` on both sides.
   **Live bytes match the gated bytes.**

## Verification on the LIVE URL (not a 200 check)

`tools/s6-verify.mjs` drives a real Chromium against `https://ade5791.github.io/meridian-estates/`.
**29/29 checks pass.** Page load to interactive module: 2,668 ms.

| Area | Check | Result |
|---|---|---|
| Load | HTTP 200; app module boots (`window.__qa`) | pass |
| Dependencies | Three.js resolves to this origin, not a CDN | pass |
| Dependencies | every runtime resource same-origin (14 resources, 0 foreign) | pass |
| First input | Start Game accepted | pass |
| Render | canvas has a real 1440x900 drawing buffer | pass |
| Render | centre-block pixel read is non-black | pass |
| Full turn | Roll -> token moves tile 0 -> 8 | pass |
| Full turn | property purchased, buyer cash 1500 -> 1400 | pass |
| Full turn | turn passes to the next seat (seat 0 -> 1) | pass |
| Cards | Fortune/Ledger draw observed in the live log | pass |
| Save/load | Save writes; Load restores a playable state | pass |
| Save/load | save -> load -> save round-trips identically (2895 == 2895, state identical) | pass |
| Resilience | no forceDirect, 0 black reads, 0 frame errors after a full session | pass |
| Resilience | light pool constant at 8 | pass |
| Landing page | 200, has play link + controls + rules + stated limits | pass |
| Console | 0 console/page errors, desktop | pass |
| Mobile 390x844 @3 | canvas fills viewport, non-black, no horizontal overflow | pass |
| Mobile | primary action 82x44 px, one-hand reachable, tap advances the game | pass |
| Mobile | 0 console/page errors | pass |

### Live end-to-end game

An unattended AI-vs-AI game on the deployed build
(`?seed=4242&autoplay=1&players=4`) ran to **`gameOver` in 41 rounds**, with
**0 page errors, 0 console errors, 0 frame errors, 0 black reads, no forceDirect**.
The runtime took its single permitted quality step-down (`steppedDown: true`) under
the software rasterizer used by the headless harness - the designed behaviour.

Screenshots: `docs/s6/live_landing.png`, `live_game_desktop.png`,
`live_game_mobile.png`, `live_game_over.png`.

## Pre-publish gates

- `vitest run`: **23/23 pass** (rules, event-contract conformance, resilience watchdog).
- Local gate on the exact dist bytes before push: **29/29 pass**.
- Build integrity assertions (in `tools/s6-fullbuild.ps1`), all enforced as hard failures:
  required files present; `phase:changed` present in shipped `panels.js`; `setPhase`
  present in shipped `engine.js`; no raw `state.phase =` assignments remaining; no
  external http(s) reference in any shipped HTML or app JS.
- Three.js revision assertion: the build fetches r0.180.0 and **fails the build** if
  `REVISION` is not `180`. This deliberately vendors the revision the S4/S5 QA
  matrices actually ran against, rather than the untested r185 copy sitting in the
  working tree's `vendor/`.

## Defect found and fixed during this step

**UI action-bar soft-lock after a property purchase.** The engine mutated
`state.phase` at five sites without emitting anything, while the UI's
`refreshActions()` was subscribed only to `pending:changed` - which fires *before*
`afterResolve()` sets the new phase. After buying a property the phase became
`awaitEndTurn` but the action bar still showed "Roll Dice", so a human player could
not reach "End Turn". Fixed contract-first, in this order:

1. `ARCHITECTURE.md` - added `phase:changed` to the event vocabulary table with its
   payload `[phase, player]`.
2. `src/core/vocabulary.js` - declared the event.
3. `src/rules/engine.js` - added a `setPhase()` setter that emits it, and replaced all
   five raw assignments.
4. `src/ui/panels.js` - subscribed to `phase:changed` alongside `pending:changed`.

The contract test verifies the new event is declared, present in the vocabulary, and
emitted with exactly those payload keys during seeded full games.

## Harness correction (not a product defect)

The gate previously compared two saves taken seconds apart and required them to be
byte-identical. That is not a serialization test: an AI seat legitimately acts between
the two saves, so the second save *should* differ. Confirmed by direct measurement -
a synchronous save -> load -> save round trip is byte-identical (2909 == 2909) and the
restored state matches field-for-field, while a delayed one differs only because the
game advanced. The check now asserts the real property: loading reproduces exactly
what was written.

## Landing page

`about.html` carries rules, a desktop/touch control table, the review-state query
parameters, and a "Measured results" section. Every figure on it was cross-checked
against `docs/s4/matrix_results.json` and `docs/S5_QA_REPORT.md` this step:
p50 16.7 ms, p95 16.8 ms, p99 16.8-16.9 ms, worst frame 18.8 ms, draw calls 110-135,
0 errors in every cell, light count 8 in every cell, 148/148 S5 stage executions,
23/23 unit tests. The page also carries an explicit "Not verified" section.

## Not proven

- **Real physical touch devices.** All touch results are Playwright touch emulation.
- **GPU coverage.** The S4 frame-time matrix was captured on one GPU (RTX 3090) in
  headless Chromium. Integrated graphics and mobile SoCs are uncharacterised. The
  live-URL verification in this step ran on a software rasterizer, so it proves
  correctness and error-freedom on the deployed build, **not** frame timing.
- **Visual quality against an external reference.** Not judged.
- **Screen readers / full accessibility audit.** Out of scope.
- **Cross-browser.** Verified in Chromium only; Firefox and Safari untested.
- **Networked multiplayer.** Does not exist; play is hotseat plus AI on one machine.
