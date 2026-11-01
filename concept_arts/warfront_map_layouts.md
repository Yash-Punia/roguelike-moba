# Warfront — Map Layout Spec v2 (for AI level and image tools)

Both maps share one coordinate system and one art style. Every number here is taken from the same data that builds the 3D renders and plan sheets (MP-01, MP-02).

- **Units:** metres. Origin (0, 0) is the exact centre of the map.
- **Axes:** x runs left to right; y runs from the Blue base (bottom, negative y) toward the Red base (top, positive y).
- **Symmetry:** both maps are rotationally symmetric. Any object at (x, y) has a twin at (−x, −y) for the other team.
- **Camera:** in game it looks down at a 60° pitch from the Blue side, about 16 m wide, in portrait orientation.

## What changed from v1

- Maps are about twice the area: The Front grew from 36 × 110 m to 68 × 164 m, The Bridgehead from 32 × 92 m to 60 × 152 m.
- Lanes are 8 m wide (was 6 m) and curve in soft S-bends instead of running straight.
- The jungle is no longer open ground with boxes in it. It is raised, blocked earth cut by a connected trench network with lane exits, junctions and dugout rooms.
- Mini-bosses sit in 13 m sunken arenas inside the jungle, reached only through trenches, with 3–4 entrances each.
- The Behemoth arena is 18–20 m across with four ways in. The Bridgehead now has a Behemoth too, on an island in the river.

## Shared art direction (paste this before either map prompt)

> Top-down 3D low-poly diorama for a mobile MOBA. Flat-shaded faceted terrain, no textures, every surface a single flat colour. Chibi toy-soldier scale: heroes about 1.9 m tall, soldiers about 1.15 m. A stylised, non-gory world-war setting with mud, trenches, sandbags, barbed wire, concrete bunkers, wooden planks, burnt trees and shell craters. Two fictional armies: Blue (#2F6BD6) and Red (#D23C32). Team colour appears only on helmets, flags, banners, tents and stripes. The ground is desaturated: lanes are light packed dirt (#9A8160) with darker wheel ruts (#8B7354), the raised jungle ground is rough olive-brown (#6C6043), trench floors are dark (#4E3E2F), boss arena floors are scorched brown (#5D4A37, Behemoth #3E3226), and the area near each HQ is green grass (#76803F). Warm late-afternoon key light from the upper left, cool fill and soft shadows. Danger red (#FF3B30) is used only for attack telegraphs.

## Building blocks

| Element | Size | Look |
| --- | --- | --- |
| HQ (Command Bunker) | 5.0 × 4.2 m footprint, 3.4 m tall plus a 4.4 m radio mast | Two-step concrete bunker, twin flak guns on the roof, camouflage net, large team banner, searchlights, a ring of sandbags; attack range 9 m |
| Spawn pad | 4.6 m disc | Concrete with a team-colour ring and yellow hazard markers, 5.5 m in front of the HQ |
| Sub-base (Pillbox) | 2.9 m hexagon, 1.9 m tall | Concrete pillbox, team stripe and flag, sandbag ring; attack range 8 m |
| Lane | 8 m wide (centre branches 7 m) | Packed light dirt, two darker wheel ruts, telegraph poles and sandbag revetments along the outside |
| Trench | 4 m wide, sunk 0.85 m | Plank walls with posts on both sides, duckboard walkway down the middle; walls only where the trench meets raised ground, so lane mouths are open |
| Raised jungle ground | +0.3 to +1.4 m | Rough, impassable earth with burnt trees, stumps, rubble, ruined walls, barbed wire and tank traps; grass and bushes near the HQs |
| Deserter camp room | 3.6–4.2 m radius | Plank-walled dugout with a stone-ring campfire, 3 or 4 neutral deserters, crate and lantern |
| Sniper nest room | 3 m radius | Dugout with a three-row sandbag horseshoe and a ghillie-caped sniper facing the nearest lane |
| Medkit room | 2.4 m radius | Small dugout with a cream medkit crate, a short sandbag wall and a lantern |
| Mini-boss arena | 6.5 m radius, sunk 0.5 m | Round scorched dish, yellow-black hazard posts round the rim with gaps at each trench entrance, two sandbag horseshoes; Halftrack or Field Gun in the middle |
| Behemoth arena | 9–10 m radius | Scorched bowl with four sandbag horseshoes, four tank traps and a rock rim; the Behemoth (a rusted four-turret land ironclad) waits in the middle |

---

## Map 1 — The Front (3 lanes)

- **Arena:** 68 × 164 m (x from −34 to 34, y from −82 to 82), with a raised embankment of ruins and burnt trees around the edge.
- **Players:** 3v3 (also 5v5).
- **Match length:** 10–12 minutes.
- **Ground levels:** lanes and bases at 0 m; trenches and camp dugouts −0.85 m; mini-boss arenas −0.5 m; Behemoth arena −0.55 m at the rim to −0.9 m in the centre; blocked jungle ground raised +0.3 to +1.4 m.

### Lanes

Each lane is a smooth curve (Catmull-Rom spline) through the control points below. Width is the full walkable width.

| Lane | Width | Control points (Blue → Red) | Length |
| --- | --- | --- | --- |
| Left | 8 m | (-6, -66) → (-16, -62) → (-25, -54) → (-28, -42) → (-24, -30) → (-27, -17) → (-25, -4) → (-28, 9) → (-25, 22) → (-27, 35) → (-24, 48) → (-17, 59) → (-7, 66) | 154 m |
| Centre (Blue trunk) | 8 m | (0, -67) → (3, -56) → (-2, -46) → (3, -36) → (0, -27) → (0, -20) | 51 m |
| Centre (Red trunk) | 8 m | (0, 20) → (0, 27) → (-3, 36) → (2, 46) → (-3, 56) → (0, 67) | 51 m |
| Centre west branch | 7 m | (0, -20) → (-8, -16.5) → (-14, -8) → (-15, 0) → (-14, 8) → (-8, 16.5) → (0, 20) | 55 m |
| Centre east branch | 7 m | (0, -20) → (8, -16.5) → (14, -8) → (15, 0) → (14, 8) → (8, 16.5) → (0, 20) | 55 m |
| Right | 8 m | (6, 66) → (16, 62) → (25, 54) → (28, 42) → (24, 30) → (27, 17) → (25, 4) → (28, -9) → (25, -22) → (27, -35) → (24, -48) → (17, -59) → (7, -66) | 154 m |

HQ aprons: flat ellipses 24 × 15 m centred at (0, -68.5) and (0, 68.5), joining all lanes in front of each HQ. Base areas: flat 50 × 26 m ellipses at (0, -71) and (0, 71).

### Structures

| # | Element | Position (x, y) |
| --- | --- | --- |
| 1 | Blue HQ (Command Bunker) | (0, -72) |
| 2 | Red HQ (Command Bunker) | (0, 72) |
| 3 | Blue spawn pad | (0, -66.5) |
| 4 | Red spawn pad | (0, 66.5) |
| 5 | Blue Left Sub-base | (-27.5, -40) |
| 6 | Blue Centre Sub-base | (1, -40) |
| 7 | Blue Right Sub-base | (26, -40) |
| 8 | Red Left Sub-base | (-26, 40) |
| 9 | Red Centre Sub-base | (-1, 40) |
| 10 | Red Right Sub-base | (27.5, 40) |

Sub-bases sit on the lane centre line; their 8 m attack ring covers the full lane width.

### Jungle (trench network)

All ground between lanes is raised rough earth that units cannot walk on. Movement through it is only along 375 m of sunken trenches. Trenches are 4 m wide (the open ramps into the Behemoth arena are 5 m), plank-walled on both sides, with a duckboard walkway; they are drawn as smooth curves through the points below.

**Rooms** (circular dugouts at trench depth):

| Tag | Room | Centre | Radius | Half |
| --- | --- | --- | --- | --- |
| C1 | Deserter camp (4 deserters) | (-14, -44) | 4.2 m | Blue |
| C2 | Deserter camp (3 deserters) | (13, -52) | 3.6 m | Blue |
| C3 | Deserter camp (3 deserters) | (-13, 52) | 3.6 m | Red |
| C4 | Deserter camp (4 deserters) | (14, 44) | 4.2 m | Red |
| M1 | Medkit room | (-9, -56) | 2.4 m | Blue |
| M2 | Medkit room | (8, -24) | 2.4 m | Blue |
| M3 | Medkit room | (-8, 24) | 2.4 m | Red |
| M4 | Medkit room | (9, 56) | 2.4 m | Red |
| S1 | Sniper nest | (-15, -26) | 3 m | Blue |
| S2 | Sniper nest | (18, -17) | 3 m | Blue |
| S3 | Sniper nest | (-18, 17) | 3 m | Red |
| S4 | Sniper nest | (15, 26) | 3 m | Red |

**Trenches** (each listed once; every trench on one half has a twin at (−x, −y)):

| From | To | Path points | Width | Length |
| --- | --- | --- | --- | --- |
| S3 sniper nest | Halftrack arena | (-18, 17) → (-16.5, 24) → (-14.5, 33) | 4 m | 16 m |
| Halftrack arena | C3 deserter camp | (-14.5, 38) → (-13.5, 45) → (-13, 52) | 4 m | 14 m |
| C3 deserter camp | Centre lane | (-13, 52) → (-9, 54.5) → (-4, 55) | 4 m | 10 m |
| C3 deserter camp | Left lane | (-13, 52) → (-18, 51.5) → (-21, 50.5) | 4 m | 8 m |
| Halftrack arena | Left lane | (-17, 36) → (-23, 36.5) | 4.4 m | 6 m |
| Halftrack arena | Centre lane | (-12, 34) → (-4, 32) | 4.4 m | 8 m |
| S3 sniper nest | Centre branch lane | (-18, 17) → (-17.5, 12) → (-14.5, 8) | 4 m | 10 m |
| M3 medkit room | trench junction | (-8, 24) → (-12, 24.6) → (-16, 24.5) | 4 m | 8 m |
| M3 medkit room | Centre lane | (-8, 24) → (-3, 24) | 4 m | 5 m |
| S3 sniper nest | Left lane | (-18, 17) → (-22.5, 18) | 4 m | 5 m |
| S4 sniper nest | Centre lane | (15, 26) → (10, 29) → (3.5, 30) | 4 m | 12 m |
| S4 sniper nest | C4 deserter camp | (15, 26) → (14.5, 35) → (14, 44) | 4 m | 18 m |
| C4 deserter camp | Right lane | (14, 44) → (19, 45.5) → (24, 45) | 4 m | 10 m |
| C4 deserter camp | Centre lane | (14, 44) → (8, 42) → (2.5, 41) | 4 m | 12 m |
| C4 deserter camp | M4 medkit room | (14, 44) → (11, 51) → (9, 56) | 4 m | 13 m |
| M4 medkit room | Centre lane | (9, 56) → (5, 57.5) → (1, 58) | 4 m | 8 m |
| S4 sniper nest | Right lane | (15, 26) → (19, 19.5) → (24, 17) | 4 m | 13 m |
| Centre branch lane | Right lane | (14.6, 4.5) → (18.5, 2.5) → (23.5, 4) | 4 m | 10 m |
| Behemoth arena | Centre lane | (0, 8) → (0, 20) | 5 m open ramp | 12 m |
| Behemoth arena | Centre branch lane | (8, 0) → (15, 0) | 5 m open ramp | 7 m |

### Objectives

| Objective | Centre | Arena | Entrances | Notes |
| --- | --- | --- | --- | --- |
| Behemoth | (0, 0) | 20 m wide, sunk 0.55–0.9 m | 4 | Four sandbag horseshoes and four tank traps for cover; rock rim between the ramps. |
| Halftrack | (-14.5, 35) | 13 m wide, sunk 0.5 m | 4 | Red half. Yellow-black hazard posts round the rim (gaps at the entrances), two sandbag covers. |
| Field Gun | (14.5, -35) | 13 m wide, sunk 0.5 m | 4 | Blue half. Yellow-black hazard posts round the rim (gaps at the entrances), two sandbag covers. |

### Dressing

- Base areas: green grass, four team tents per side, two flags by the spawn pad, two searchlights, crates and drums, a radio mast, sandbag walls at the base exits.
- Outer lanes: a telegraph pole about every 11 m on the outside of the lane, every third swapped for a sandbag revetment.
- Middle band (|y| < 15): barbed wire, tank traps and scorched ground on the raised jungle; two wrecked biplanes at (30, −10) and (−30, 10).
- About 60 shell craters (1–2 m radius) scattered only on raised ground, never on lanes or trenches.
- Map edge: ruined walls, burnt trees, sandbag walls and tank traps every 4 m.

### Travel times (move speed 3.5 m/s)

- HQ to own Sub-base: ≈ 32 m, 9 s.
- Sub-base to the Behemoth arena via the centre lane: ≈ 40 m, 11 s.
- Lane to lane through a trench quadrant: 20–28 m, 6–8 s.
- Blue Left Sub-base to the Field Gun arena through the trenches: ≈ 30 m, 9 s.
- HQ to HQ along an outer lane: 154 m, ≈ 44 s.

### Prompt (copy-paste)

> Top-down 3D low-poly diorama of a stylised world-war battlefield for a mobile MOBA, portrait orientation, 68 by 164 metres. Flat-shaded faceted terrain, no textures, chibi toy-soldier scale. Blue concrete Command Bunker with radio mast, team tents and searchlights on green grass at the bottom; identical red one at the top. Three wide light-tan packed-dirt lanes with wheel ruts wind gently from base to base: left and right lanes hug the map edges in soft S-curves, the centre lane wiggles up the middle and splits into two branches that ring a large central blast crater. One hexagonal concrete pillbox per lane per team in a ring of sandbags, at about one quarter and three quarters of the map. The ground between the lanes is raised rough olive-brown earth with burnt trees, rubble and ruined walls, cut by a network of sunken plank-lined trenches with duckboards that branch and connect to every lane. The trenches lead into round dugouts: deserter campfires, sandbag sniper nests and medkit crates. Two round sunken arenas with yellow-black hazard posts sit inside the trench networks: an olive armoured halftrack in the upper-left one, a wheeled field gun behind sandbags in the lower-right one. In the exact centre a 20-metre scorched crater with sandbag cover holds a rusted multi-turret land ironclad. Barbed wire and tank traps across the middle, shell craters scattered on the open ground, telegraph poles along the outer lanes, ruined walls along the map edges. Warm late-afternoon light from the upper left, soft shadows, desaturated earth tones so blue and red units stand out.

---

## Map 2 — The Bridgehead (2 lanes)

- **Arena:** 60 × 152 m (x from −30 to 30, y from −76 to 76), with a raised embankment of ruins and burnt trees around the edge.
- **Players:** 2v2 or 3v3.
- **Match length:** 7–9 minutes.
- **Ground levels:** lanes and bases at 0 m; trenches and camp dugouts −0.85 m; mini-boss arenas −0.5 m; Behemoth island −0.2 to −0.3 m (dry gravel above the water line); blocked jungle ground raised +0.3 to +1.4 m. River bed −1.0 m under a water surface at −0.5 m; fords −0.62 m.

### Lanes

Each lane is a smooth curve (Catmull-Rom spline) through the control points below. Width is the full walkable width.

| Lane | Width | Control points (Blue → Red) | Length |
| --- | --- | --- | --- |
| Left | 8 m | (-6, -59) → (-14, -56) → (-20, -47) → (-19, -35) → (-23, -23) → (-21, -12) → (-21, -4) → (-21, 4) → (-21, 12) → (-24, 24) → (-21, 36) → (-23, 46) → (-18, 55) → (-7, 60) | 137 m |
| Right | 8 m | (6, 59) → (14, 56) → (20, 47) → (19, 35) → (23, 23) → (21, 12) → (21, 4) → (21, -4) → (21, -12) → (24, -24) → (21, -36) → (23, -46) → (18, -55) → (7, -60) | 137 m |

HQ aprons: flat ellipses 22 × 15 m centred at (0, -62.5) and (0, 62.5), joining all lanes in front of each HQ. Base areas: flat 44 × 24 m ellipses at (0, -65) and (0, 65).

### Structures

| # | Element | Position (x, y) |
| --- | --- | --- |
| 1 | Blue HQ (Command Bunker) | (0, -66) |
| 2 | Red HQ (Command Bunker) | (0, 66) |
| 3 | Blue spawn pad | (0, -60.5) |
| 4 | Red spawn pad | (0, 60.5) |
| 5 | Blue Left Sub-base | (-19, -35) |
| 6 | Blue Right Sub-base | (21, -36) |
| 7 | Red Left Sub-base | (-21, 36) |
| 8 | Red Right Sub-base | (19, 35) |

Sub-bases sit on the lane centre line; their 8 m attack ring covers the full lane width.

### River

- Centre line y = 2.5 · sin(x / 8); 7 m wide, banks slope over 1.4 m. Impassable on foot.
- Bridges: 8 × 12 m plank bridge centred at (-21, -1.2); 8 × 12 m plank bridge centred at (21, 1.2). Lanes cross here.
- Fords: 4 m stepping-stone wades (units slowed 20% while in water). (-9, -22) → (-11, -15) → (-11.5, -6) → (-11, 3) → (-8.5, 9.5) → (-5, 14); and (9, 22) → (11, 15) → (11.5, 6) → (11, -3) → (8.5, -9.5) → (5, -14).
- The Behemoth island in the centre is dry gravel; the river flows round it.

### Jungle (trench network)

All ground between lanes is raised rough earth that units cannot walk on. Movement through it is only along 317 m of sunken trenches. Trenches are 4 m wide, plank-walled on both sides, with a duckboard walkway; they are drawn as smooth curves through the points below.

**Rooms** (circular dugouts at trench depth):

| Tag | Room | Centre | Radius | Half |
| --- | --- | --- | --- | --- |
| C1 | Deserter camp (4 deserters) | (-9, -22) | 3.8 m | Blue |
| C2 | Deserter camp (3 deserters) | (5, -14) | 3 m | Blue |
| C3 | Deserter camp (3 deserters) | (-5, 14) | 3 m | Red |
| C4 | Deserter camp (4 deserters) | (9, 22) | 3.8 m | Red |
| M1 | Medkit room | (-6, -40) | 2.4 m | Blue |
| M2 | Medkit room | (6, 40) | 2.4 m | Red |
| S1 | Sniper nest | (11, -46) | 3 m | Blue |
| S2 | Sniper nest | (-11, 46) | 3 m | Red |

**Trenches** (each listed once; every trench on one half has a twin at (−x, −y)):

| From | To | Path points | Width | Length |
| --- | --- | --- | --- | --- |
| Halftrack arena | Left lane | (-12, 29) → (-18.5, 30) | 4.4 m | 7 m |
| Halftrack arena | C4 deserter camp | (-3, 27) → (3, 24) → (9, 22) | 4 m | 13 m |
| C4 deserter camp | Right lane | (9, 22) → (14, 22) → (18.5, 22) | 4 m | 9 m |
| Halftrack arena | C3 deserter camp | (-8, 24) → (-6, 19) → (-5, 14) | 4 m | 10 m |
| C3 deserter camp | Behemoth arena | (-5, 14) → (-3, 10.5) → (-1.5, 8) | 4 m | 7 m |
| C4 deserter camp | M2 medkit room | (9, 22) → (7.5, 31) → (6, 40) | 4 m | 18 m |
| M2 medkit room | S2 sniper nest | (6, 40) → (-2, 43) → (-11, 46) | 4 m | 18 m |
| S2 sniper nest | Left lane | (-11, 46) → (-17.5, 46.5) | 4 m | 7 m |
| Halftrack arena | S2 sniper nest | (-8, 32) → (-10, 39) → (-11, 46) | 4 m | 14 m |
| M2 medkit room | Red base apron | (6, 40) → (3, 49) → (0, 55.5) | 4 m | 17 m |
| C1 deserter camp | C3 deserter camp | (-9, -22) → (-11, -15) → (-11.5, -6) → (-11, 3) → (-8.5, 9.5) → (-5, 14) | 4 m ford | 38 m |

### Objectives

| Objective | Centre | Arena | Entrances | Notes |
| --- | --- | --- | --- | --- |
| Behemoth | (0, 0) | 18 m wide, dry island 0.2–0.3 m below lane level | 4 | Island in the river. Four sandbag horseshoes and four tank traps for cover. |
| Halftrack | (-8, 28) | 13 m wide, sunk 0.5 m | 4 | Red half. Yellow-black hazard posts round the rim (gaps at the entrances), two sandbag covers. |
| Field Gun | (8, -28) | 13 m wide, sunk 0.5 m | 4 | Blue half. Yellow-black hazard posts round the rim (gaps at the entrances), two sandbag covers. |

### Dressing

- Base areas: as on The Front.
- Reeds along both river banks wherever the bank is not a lane, trench or arena.
- Telegraph poles and sandbag revetments along both lanes.
- Two wrecked biplanes at (26, −14) and (−26, 14).
- About 48 shell craters on the raised jungle ground.

### Travel times (move speed 3.5 m/s)

- HQ to own Sub-base: ≈ 30 m, 9 s.
- Lane to lane through one half's trench lattice: 35–40 m, 10–12 s.
- Own small camp to the Behemoth island: ≈ 8 m, 2 s.
- HQ to HQ along a lane: 137 m, ≈ 39 s.

### Prompt (copy-paste)

> Top-down 3D low-poly diorama of a stylised world-war battlefield for a mobile MOBA, portrait orientation, 60 by 152 metres. Flat-shaded faceted terrain, no textures, chibi toy-soldier scale. Blue concrete Command Bunker with radio mast, team tents and searchlights on green grass at the bottom; identical red one at the top. Two wide light-tan packed-dirt lanes with wheel ruts snake along the left and right sides of the map, each with one hexagonal concrete pillbox per team in a ring of sandbags. A meandering grey-blue river crosses the middle; each lane crosses it on a wide wooden plank bridge. The whole centre is raised rough olive-brown ground with burnt trees and rubble, cut on each side by a lattice of sunken plank-lined trenches with duckboards: they cross from lane to lane, loop around a round sunken arena with yellow-black hazard posts, and lead to deserter campfires, a sandbag sniper nest and a medkit dugout. An olive armoured halftrack waits in the upper arena, a wheeled field gun behind sandbags in the lower arena. In the middle of the river, a large round gravel island holds a rusted multi-turret land ironclad, reached by trenches and two shallow stepping-stone fords. Reeds along the banks, shell craters in the open ground, team tents near each HQ, ruined walls along the edges. Warm late-afternoon light from the upper left, soft shadows, desaturated earth tones so blue and red units stand out.
