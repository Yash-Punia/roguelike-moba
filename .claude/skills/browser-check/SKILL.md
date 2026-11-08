---
name: browser-check
description: Run Warfront in Chrome (Chrome DevTools MCP), place champions and step the sim through window.warfront, take screenshots, and read fps, draw calls and console errors. Use to verify anything visible in the game, a perf budget, or bot behaviour in a live match.
---

# Check the game in a browser

## Use Chrome DevTools, not the built-in pane

The game loop runs on `requestAnimationFrame`. The app's built-in Browser pane gets no animation frames while it's hidden, so the match freezes at 0:00 (perf overlay shows 0 fps). Use the Chrome DevTools MCP tools (`mcp__plugin_chrome-devtools-mcp_chrome-devtools__*`). They drive their own Chrome, which keeps running. Load them in one ToolSearch call:

`select:mcp__plugin_chrome-devtools-mcp_chrome-devtools__new_page,…__navigate_page,…__resize_page,…__evaluate_script,…__take_screenshot,…__list_console_messages,…__list_pages`

## Steps

1. **Dev server:** `preview_start` with `{name: "dev"}` (`.claude/launch.json`, port 5173). It reuses one that is already running. Never start it from Bash.
2. **Open:** `new_page` with `http://localhost:5173/?<params>` (first time), then `navigate_page` on that page id. Useful params:
   - `lanes=3` (The Front) / `lanes=2` (The Bridgehead), `seed=N` (repeatable match), `perf` (show the stats bar)
   - `nobot` (alone), `nowaves`, `dummy` / `dummy=armed` (1v1 dummy), `fog`, `champ=beta|gamma`, `size=2..5`, `lane=left|centre|right`
3. **Portrait:** `resize_page` 540 × 960 (the game is a 9:16–9:21 portrait frame).
4. **Drive it** with `evaluate_script` (`waitForStableDom: false`). Dev builds expose `window.warfront = { sim, view, loop, bot, bots, squads, config }`:
   ```js
   async () => {
     const w = window.warfront;
     const me = w.sim.entityOf(0);
     Object.assign(w.sim.stores.transforms.get(me), { x: 9.5, y: -53.5 }); // teleport (sim metres)
     await new Promise((r) => setTimeout(r, 1500)); // let the camera follow
     const s = w.sim.snapshot();
     return { tick: w.sim.tick, camps: s.camps.map((c) => c.members), perf: document.querySelector('.perf-overlay')?.textContent };
   }
   ```
   - Pause / slow: `w.loop.paused = true`, `w.loop.timeScale = 0.5`.
   - Step manually while paused: `w.sim.step([])` (bots and input are skipped, so it is only for sim state).
   - Cheats: `w.sim.debug.*` (`kill`, `giveXp`, `levelUp`, `fillUltimate`, `grantPower`, `spawnWave`, `setHqShields`…).
   - Bot state: `w.bots.map((b) => b.bot.mode)`, `w.squads[0].plans`.
   - Health and HP: `w.sim.stores.healths.get(id).hp`. Camp state: `w.sim.camps`.
   - Never write sim state in shipped code. This is dev-only poking.
5. **Screenshot:** `take_screenshot` (jpeg, quality ~60). Report what is visible and the time on the HUD clock.
6. **Perf:** the overlay (`?perf`, in dev builds or with `?debug`) reads `fps · worst · sim · render · calls · tris`. Mobile budget: **≤ 120 draw calls, ≤ 150k triangles** (D-044). Measure on the busiest scene, usually The Front (`lanes=3`).
7. **Errors:** `list_console_messages` with `types: ["error"]`.

## Coordinates

Sim x = left/right, y = towards the Red HQ (Blue spawn ≈ (0, −66.5)). Camp, room and structure positions: `data/map-3lane.json` / `data/map-2lane.json` (`camps`, `walkable`, `structures`), spec in `concept_arts/warfront_map_layouts.md`. Teleporting into raised ground gets pushed out by movement: pick lane, trench or room centres.

Don't steer with synthetic key events. They work, but walking a champion through the trenches by key timing is slow and unreliable; teleport instead.
