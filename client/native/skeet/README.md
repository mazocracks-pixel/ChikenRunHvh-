# Native Skeet browser menu

This runs the supplied Menu.cpp and custom Dear ImGui 1.70 widgets in WebAssembly. The custom layout, carbon background, fonts, color controls and scrolling are retained. The icon font is missing, so `Menu.cpp` draws each tab's icon with ImGui shapes (crosshair, shield, pistol, eye, gear, paint drop, player) above its name. Original empty groups now expose existing chicken-game controls; `BrowserGroup` draws their section headings in bold with a divider and lines controls up with the original ones. **Misc > Settings > Menu color** sets `ImGuiCol_MenuTheme` (ticks, sliders, the selected tab) and is saved like any other field.

`source-manifest.json` records original source hashes. `browser.cpp` supplies WebGL rendering, input and bindings; `config_bridge.inc` maps the original visual fields to `client/src/dev/skeet/nativeFields.ts`. TypeScript owns validated game settings; the C++ menu owns drawing and widget interaction. No Source-engine hooks or native DLL injection are used.

## Build

The server CSP includes `wasm-unsafe-eval`, required for compilation of the local WASM module; JavaScript `unsafe-eval` remains blocked.

Generated `client/public/skeet-native/menu.js` and `menu.wasm` are committed, so `npm run build` needs no C++ toolchain. After changing C++ source, activate Emscripten and run:

```powershell
./client/native/skeet/build.ps1 -Emcc em++
```

The checked build uses Emscripten 4.0.22 (rebuilding the same source with it gives byte-identical output). If `em++` is not on PATH, set `EM_CONFIG` to the emsdk `.emscripten` file and call `upstream\emscripten\em++.bat` by its full path. The original background PNG is also committed. Do not edit the generated JS or WASM directly.

## Game adaptations

Visual options run only while Skeet is selected in an HvH match. Switching panels or leaving restores scene, camera, materials and HUD effects. Settings persist through the existing validated config store; save/load controls include named presets and a current Native Skeet snapshot.

Player ESP and resolver displays use public snapshots. Materials use Three.js lighting, metallic surfaces, additive glow and a wireframe Bubble style. Hands, enemy money, bomb UI, Source ragdolls, matchmaking, clan tags and Danger Zone systems are left out of the menu because HvH has no matching systems. Loot replaces dropped weapons; the dead-player list replaces unavailable spectator tracking; sound rings show public shot events. The trajectory preview follows a manual egg throw. No server damage, hitbox, movement or visibility authority is changed by visual controls.

## Checks

```powershell
npm run typecheck
npm test
npm run build
```

`scripts/check-native-menu.cjs` uses Playwright with Edge against the development client at localhost:3001 and server at localhost:3000 (it opens **Switch mode** to reach **Create room**). Install or provide an existing Playwright package via PLAYWRIGHT_PACKAGE; BASE_URL overrides the address, and QA_OUTPUT_DIR saves screenshots and a report. It checks actual canvas interaction, seven tabs, 1 ms jitter, key capture, native color pickers, config save/load, viewport fit, live visual effects, restoration and FFA isolation.
