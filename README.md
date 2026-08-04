# Meridian Estates

An original 3D property-trading board game, built in Three.js. Runs in the browser,
no install, no build step, and **zero external runtime dependencies** - Three.js is
served from this same origin.

**[Play it](https://ade5791.github.io/meridian-estates/)** - **[Rules, controls and measured results](https://ade5791.github.io/meridian-estates/about.html)**

## What it is

One to four seats, each independently human or AI. Roll, move, buy streets, rails and
utilities, decline into a sealed-bid auction, collect rent, build houses evenly and
then hotels, mortgage for cash, draw from two original card decks, land in the Holding
House, trade with rivals, and bankrupt your way to the last solvent player.

The game is deterministic: the same seed replays the same dice and the same card order.

## Review states

| Query parameter | Effect |
|---|---|
| `?seed=1234` | Fixes the dice and both card decks |
| `?players=4` | Number of seats (1-4) |
| `?humans=1` | How many seats are human; the rest are AI |
| `?autoplay=1` | Runs an AI-vs-AI game unattended |
| `?fixture=midgame` | Also `endgame`, `jail`, `bankruptcy-imminent` |

## Verified

- **29/29** live-URL checks on the deployed bytes (load, first input, full turn,
  card draw, save/load round-trip, mobile viewport, console health).
- **23/23** unit tests - rules, event-contract conformance, resilience watchdog.
- **148/148** player-journey stage executions across desktop, touch portrait, touch
  landscape and reduced-motion profiles, with 0 console errors.
- **9/9** perf-matrix cells vsync-locked at p50 16.7 ms on an RTX 3090.

Full detail and the honest limits of what was measured:
[docs/S6_PUBLISH_REPORT.md](docs/S6_PUBLISH_REPORT.md),
[docs/S5_QA_REPORT.md](docs/S5_QA_REPORT.md),
[docs/S4_PERF_REPORT.md](docs/S4_PERF_REPORT.md).

## Layout

- `index.html`, `src/`, `vendor/` - the published game (the exact gated bytes).
- `about.html` - landing page: rules, controls, measured results.
- `project/` - source of truth, unit tests, and `ARCHITECTURE.md` (the engine contract).
- `docs/` - QA and performance reports, the build manifest and build hash.

## Architecture

Subsystems never import one another; they communicate through a documented event
vocabulary that a conformance test diffs against `ARCHITECTURE.md` on every run. The
rules engine is headless - no DOM, no Three.js - and is unit-tested directly. Dice and
both card decks draw from named, seeded, serializable random streams. Audio is
generated procedurally with the Web Audio API; no audio files are shipped.

Runtime resilience: a fixed light pool (scene light count never changes), a black-frame
watchdog that permanently falls back to plain forward rendering after two black reads,
frame-error containment that drops post-processing rather than the game, and exactly
one automatic quality step-down.

## Licence and originality

Meridian Estates is an original work. Its name, board, street names, card decks and
artwork are original. It is not affiliated with, endorsed by, or derived from any
existing commercial board game or its publisher.

Three.js (`vendor/`) is MIT licensed, (c) three.js authors.
