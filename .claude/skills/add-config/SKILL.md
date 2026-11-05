---
name: add-config
description: Add a tunable gameplay number or a new /data config file to Warfront the project's way - JSON value, zod schema with unit conversion, loader and export wiring, live re-derive, and pinned test values. Use whenever a feature introduces a number, since no gameplay number may live in code.
---

# Add a config value or file

Every gameplay number lives in `/data` and is tunable live from the debug panel (CLAUDE.md).

## A value in an existing file

1. **JSON** (`data/<file>.json`): write it in the config's units (seconds, percent as `15`, degrees, metres).
   - Insert text; don't rewrite the file with `JSON.stringify` (it expands inline arrays).
   - Mind CRLF line endings.
2. **Schema** (`src/data/schema.ts`): add the field to that section's zod object with a `/** doc comment */`. Convert at load:
   - `secs()`: seconds → ticks, `round(s × 30)`;
   - `pct()`: 15 → 0.15;
   - `deg()`: degrees → radians;
   - `positive()` / `nonneg()` for plain numbers;
   - `.default(x)` when old data or fixtures may lack it. Write the default in output units (ticks, fractions).
3. **Use it** through `config.<section>.<field>`, never a copy. If a value is cached on entities at spawn (weapon, HP, speed), re-derive it in `setConfig` in `src/sim/sim.ts`, as the lane minions and camp units do there.
4. **Tests:** tests that depend on the number pin it in their own config tweak (`arena(units, (c) => …)` or a `pin…()` helper), so retuning `/data` never breaks them. Write test values in output units (ticks, fractions, radians).

## A new file

As `data/neutrals.json` was added:

1. `data/<name>.json`.
2. `src/data/schema.ts`: a `const <Name> = z.object({...})` and a `<name>: <Name>` field in `ConfigSchema`. Export any type you need (`export type X = z.output<…>`).
3. `src/data/load.ts`: `import <name> from '../../data/<name>.json'`, add it to `rawConfig`, and add `<name>: '<name>.json'` to `configFiles` (export path).
4. The debug panel (`src/tools/debug-panel.ts`) walks every `rawConfig` section, so the new file gets its folder and export button with no change there.
5. `tests/helpers.ts` `fixtureConfig()` parses `rawConfig`, so tests get the file too. Pin what they rely on.

## Map data

Map geometry and placements live in `data/map-3lane.json` (The Front) and `data/map-2lane.json` (The Bridgehead), from `concept_arts/warfront_map_layouts.md`. Add a new map field to `MapConfig` with `.default([])` (or a default value), so `tests/fixtures/map-open.json` keeps parsing. Fill both maps and add a placement test in `tests/map.test.ts` or the feature's test file.

## Check

`rtk npm run typecheck`, then the tests. Change the value live in the debug panel (F1 → `<file>.json`) during a `browser-check` to confirm it re-derives.
