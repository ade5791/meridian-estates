# S4 Report - Perf Matrix + Polish (Meridian Estates)

Date: 2026-02-07. All numbers below are measured, not estimated.

## 1. Perf matrix: quality x phase, per-cell browser isolation

Harness: tools/s4/matrix.mjs. Every cell launches a FRESH Chromium process
(per-cell isolation - reusing pages leaks renderer state forward and killed
matrix validity in the FPS mission). Each cell: orbiting camera (orbit=1),
AI game running, continuous dice tumble + card flip + pool-light fx
(fxloop=1), captured at deviceScaleFactor=2 for 12s after a 4s warm.
Full frame-time distribution reported - never a static-camera median.
Phases: early = fresh board; mid = ?fixture=midgame (houses, spread
ownership); end = ?fixture=endgame (hotels, max fx pressure).

### Hardware GL (RTX 3090, headless Chromium --enable-gpu) - the real number

| cell         | p50    | p95    | p99    | max    | fps(p50) | dpr | draw calls |
|--------------|--------|--------|--------|--------|----------|-----|------------|
| low x early  | 16.7ms | 16.8   | 16.8   | 18.8   | 59.9     | 1.0 | 135 |
| low x mid    | 16.7ms | 16.8   | 16.8   | 16.9   | 59.9     | 1.0 | 110 |
| low x end    | 16.7ms | 16.8   | 16.8   | 18.0   | 59.9     | 1.0 | 121 |
| med x early  | 16.7ms | 16.8   | 16.8   | 17.6   | 59.9     | 1.5 | 135 |
| med x mid    | 16.7ms | 16.8   | 16.8   | 17.9   | 59.9     | 1.5 | 110 |
| med x end    | 16.7ms | 16.8   | 16.8   | 16.9   | 59.9     | 1.5 | 121 |
| high x early | 16.7ms | 16.8   | 16.8   | 16.9   | 59.9     | 2.0 | 135 |
| high x mid   | 16.7ms | 16.8   | 16.8   | 16.9   | 59.9     | 2.0 | 110 |
| high x end   | 16.7ms | 16.8   | 16.9   | 17.0   | 59.9     | 2.0 | 121 |

9/9 cells: vsync-locked 60fps, p99 within 0.2ms of p50, zero page errors,
light count 8 -> 8 in every cell. MATRIX PASS (docs/s4/matrix_gpu.log,
docs/s4/matrix_results.json).

### SwiftShader (CPU software GL) - worst-case floor, kept for reference

low: 30-60fps p50; med: 15-20fps; high: 10fps (docs/s4/matrix_run.log).
This is a software rasterizer chewing 2560x1600+ pixels on CPU - it is the
absolute floor, not a device projection. On this floor the resilience
system behaved exactly as designed: the rolling-120-sample window fired
exactly ONE automatic step-down and the game stayed playable to completion.

### Quality presets (implemented this step)

- low:  DPR cap 1.0, shadows off
- med:  DPR cap 1.5, 1024 shadow map
- high: DPR cap 2.0, 2048 shadow map
- ?nostepdown=1 (QA-only) pins the preset during capture so a cell measures
  its declared quality, never a mid-capture downgrade.

## 2. Light pool constancy across a full AI game

tools/s4/lightgame.mjs: sampled scene light count every 500ms for an entire
seeded AI-vs-AI game (seed 9001, 35 rounds to bankruptcy win) with dice
glows, card flourishes and build flashes firing. Distinct light counts
observed: [8] (1 sun + 1 hemisphere + 6 pool). LIGHTPOOL PASS - scene light
count never changed at runtime.

## 3. Leak audit: 5x in-page restart + 30s idle

tools/s4/leak.mjs drives window.__qa.restart(), which tears down
render/ui/audio/lights and boots a fresh game on the same page.

Warm baseline -> final after 5 restarts + 30s idle:
canvas 1 -> 1, DOM nodes 103 -> 103, geometries 78 -> 78,
textures 51 -> 51, programs 6 -> 6, lights 8 -> 8. No per-cycle growth
(restart 5 <= restart 1 in every counter). Zero page errors. LEAK PASS.

Defects the audit exposed and fixed:
- createTokens() removed old token meshes without disposing geometry/material.
- refreshBuildings() allocated a new BoxGeometry per house/hotel per build
  event and disposed on removal - replaced with shared house/hotel
  geometry+material (zero allocation per build event).
- RenderSystem.dispose() only disposed the renderer - now walks the scene
  disposing every geometry/material/texture, clears the scene, and disposes
  render lists.
- Harness lesson re-confirmed: shader programs legitimately grow until every
  material variant has rendered once; the leak gate must diff against a WARM
  baseline or warm-up reports as a phantom leak.

## 4. Audio pass

src/audio/sfx.js - procedural WebAudio, zero assets: dice clatter (bandpass
noise bursts), token hops (pitched triangle blips per hop), cash register
(two-tone square), card flip (noise swish), build placement (low sine thunk),
win sting (4-note triangle arpeggio). AudioContext is NOT created until the
first pointer/key gesture (autoplay policy), then resumed; mute button
(44px) toggles output.

tools/s4/audio.mjs: 11/11 PASS under --autoplay-policy=user-gesture-required:
no AudioContext before first gesture; context running after gesture; all six
SFX handlers verified wired to their bus events by instrumentation; mute
toggles. AUDIO PASS.

## 5. Mobile touch + responsive layout

tools/s4/mobile.mjs: touch-emulated iPhone-class context (390x844 @3x,
hasTouch, isMobile) with a human seat so real action buttons render.
12/12 PASS:
- Roll button 82x44px, y=732/844 - reachable one-handed (bottom 40%).
- Touch tap on Roll advances the game.
- ALL visible touch targets >= 44px (exposed the 40px mute button - fixed).
- Orientation change portrait->landscape->portrait mid-game: serialized
  game state byte-identical before/after. Never resets.
- Landscape: action stack docks to the right edge, inside the viewport.
- Safe-area insets (env()) on HUD/actions/mute; touch-action: manipulation
  kills double-tap zoom; portrait camera pulls back (aspect-fit) so the
  whole board stays framed.
Screenshots: docs/s4/mobile_portrait.png, docs/s4/mobile_landscape.png.

## 6. Regression after all changes

- vitest: 23/23 pass (rules, contract conformance, watchdog).
- tools/verify-browser.mjs (seed 8899): full AI-vs-AI game to completion in
  a real browser - GAME OVER round 64, winner Ava by lastSolvent, 0 page
  errors, blackReads=0, forcedDirect=false, frameErrors=0.

## Fixed this step (exposed by the harnesses)

1. Token geometry/material leak on restart.
2. Per-build-event geometry allocation -> shared building assets.
3. dispose() shallow teardown -> full scene walk teardown.
4. Mute button below 44px touch minimum.
5. Per-frame Vector3 allocation in the camera path -> scratch vector.
6. Quality presets existed only as a constant - now actually drive DPR cap
   and shadow config.
7. verify-browser.mjs hardcoded port -> PORT env override.

## Not proven / honest limits

- GPU matrix ran on an RTX 3090; low-end mobile hardware performance is not
  measured (SwiftShader floor is the only proxy). The low preset exists for
  that tier.
- Audio verified by instrumentation (handlers fire, context runs), not by
  listening to output.
- Mobile checks are emulation (Playwright touch context), not a physical
  device.
