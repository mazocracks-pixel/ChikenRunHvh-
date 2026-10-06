# Native Skeet browser menu

This runs the supplied Menu.cpp and custom Dear ImGui 1.70 widgets in WebAssembly. The custom layout, carbon background, fonts, color controls and scrolling are retained. The seven tab names replace missing icon-font glyphs. Original empty groups now expose existing chicken-game controls.

`source-manifest.json` records original source hashes. `browser.cpp` supplies WebGL rendering, input and bindings; `config_bridge.inc` maps the original visual fields to `client/src/dev/skeet/nativeFields.ts`. TypeScript owns validated game settings; the C++ menu owns drawing and widget interaction. No Source-engine hooks or native DLL injection are used.

## Build

The server CSP includes `wasm-unsafe-eval`, required for compilation of the local WASM module; JavaScript `unsafe-eval` remains blocked.

Generated `client/public/skeet-native/menu.js` and `menu.wasm` are committed, so `npm run build` needs no C++ toolchain. After changing C++ source, activate Emscripten and run:

```powershell
./client/native/skeet/build.ps1 -Emcc em++
```

The checked build uses Emscripten 4.0.22. The original background PNG is also committed. Do not edit the generated JS or WASM directly.

## Game adaptations

Visual options run only while Skeet is selected in an HvH match. Switching panels or leaving restores scene, camera, materials and HUD effects. Settings persist through the existing validated config store; save/load controls include named presets and a current Native Skeet snapshot.

Override scope replaces the circular lens mask with a clear-view reticle, a shot pulse and weapon readiness. It retains the original `removeScopeOverlay` setting key so saved menus remain compatible. Magnification and firing accuracy stay governed by the same global weapon rules.

Player ESP and resolver displays use public snapshots. Materials use Three.js lighting, metallic surfaces, additive glow and a wireframe Bubble style. Hands, enemy money, bomb UI, Source ragdolls, matchmaking, clan tags and Danger Zone systems are omitted because HvH has no matching systems. Loot replaces dropped weapons; the dead-player list replaces unavailable spectator tracking; sound rings show public shot events. The trajectory preview follows a manual egg throw. No server damage, hitbox, movement or visibility authority is changed by visual controls.

## Checks

```powershell
npm run typecheck
npm test
npm run build
```

`scripts/check-native-menu.cjs` uses Playwright with Edge against the development client at localhost:3001 and server at localhost:3000. Install or provide an existing Playwright package via PLAYWRIGHT_PACKAGE; BASE_URL overrides the address, and QA_OUTPUT_DIR saves screenshots and a report. It checks actual canvas interaction, four tabs, weapon/stance selectors and quick pre-match configs, 1 ms jitter, key capture, native color pickers, config save/load, viewport fit, live visual effects, restoration and FFA isolation.

`scripts/check-shooting.cjs` uses the same environment to check the actual scope toggle, optics, instant hitscan streaks and server correction, sent/held jump origins, weapon cycling, small screens, reduced motion and ordinary-mode isolation. See [hitscan behavior](../../../docs/hitscan.md).

The compact C++ layout keeps Aim, Anti-aim, Visuals and Settings. Advanced visuals are expandable; saved native field names remain compatible. See [resolver changes](../../../docs/resolver-notes.md).

`scripts/check-hvh-duels.ts` runs four production-client Scout fights against real bots, including quick manual shots, airborne hits, simulated latency/fake lag and frame-by-frame scope continuity. Build first, then run it through the existing tsx runner with PLAYWRIGHT_PACKAGE and optional QA_OUTPUT_DIR.
