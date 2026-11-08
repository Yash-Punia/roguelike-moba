# Project Warfront — Game Design Document

Oct 31, 2026 · @Yash Punia

## 1. Overview

Project Warfront (working title) is a 3v3 mobile MOBA played in portrait mode, where the only inputs are a movement joystick and one Ultimate button. Champions auto-fire, level up during the match, and draft one of three roguelike powers on every level-up. A match targets 8 to 10 minutes and ends when one team destroys the other team's Headquarters (HQ).

| Item | Decision |
| --- | --- |
| Platform | iOS and Android phones, portrait orientation only |
| Genre | Lane-pushing MOBA with auto-shooter combat and in-match roguelike drafting |
| Team size | 3v3 (one champion per lane by default); empty slots filled by bots |
| Match length | 8 to 10 minutes target; hard cap 13 minutes |
| Camera | Top-down 3D, high tilted angle similar to Brawl Stars, fixed (no camera control) |
| Theme | Stylised, fictional world-war armies: trenches, sandbags, bunkers, tanks |
| Art | Low poly, flat shaded, Red vs Blue team colours |
| Audience | Mid-core mobile players who enjoy Brawl Stars or Archero and want a first, low-friction MOBA |

### Elevator pitch

*Drag to move, everything else fights for you.* Lead your soldier down a war-torn lane, out-position the enemy, draft a wild build of powers, and blow up their HQ before the 10-minute whistle.

### Design pillars

1. **One thumb of skill.** All skill lives in movement: positioning, kiting, dodging, choosing a lane and choosing when to fight. Aiming and ability juggling are removed.
2. **MOBA bones, intact.** Three lanes, minion waves, defensive structures, a jungle (the Trenches), neutral mini-bosses, levels and a destroy-the-base win condition all stay.
3. **A new build every match.** Each level-up offers three powers. Two players on the same champion should rarely play the same build twice.
4. **Readable at a glance.** On a 6-inch portrait screen, a player must read friend vs foe, threat and target in under one second. Colour, silhouette and size do the work.
5. **Short and complete.** One match fits a commute. Every match has a laning phase, a skirmish phase and a final push.

### Research foundations

The design borrows deliberately from both PC MOBAs and mobile hits. The key lessons applied in this document:

- **The MOBA skeleton is three lanes, a jungle and turret dependencies.** Academic surveys describe the genre as a symmetrical map of three lanes, neutral jungles and towers that must be destroyed in order, with heroes levelling during the match ([Emergent Mind MOBA overview](https://www.emergentmind.com/topics/moba); [Honor of Kings study, arXiv 2401.16444](https://arxiv.org/pdf/2401.16444)). Warfront keeps all of these.
- **Mobile MOBAs win by condensing, not cutting.** Wild Rift kept League's fundamentals but shrank the map, weakened structures, reduced defences and brought ultimates in earlier, cutting sessions to about 15 minutes ([Naavik, Wild Rift: How to Adapt a MOBA for Mobile](https://naavik.co/f2p-mobile/wild-rift-adapting-moba/)). Warfront pushes the same levers further: one structure per lane per team and a 10-minute target.
- **Reward presence, not precision.** Wild Rift grants gold for being near a minion death, with a bonus for the last hit ([Naavik](https://naavik.co/f2p-mobile/wild-rift-adapting-moba/)). Warfront has no gold at all; XP is shared by proximity, so auto-fire never feels like it is "stealing" last hits.
- **Auto-attack plus positioning is a proven mobile loop.** Archero's core is simple movement with automatic firing at the nearest enemy, layered with a pick-one-of-three ability draft that gives each run its own build ([Game Developer, Finding the Fun: Archero Part 1](https://www.gamedeveloper.com/design/finding-the-fun-archero-part-1---gameplay)). Warfront fires while moving (unlike Archero's stop-to-shoot) to keep the MOBA's chase-and-kite feel.
- **The cross-genre gap is the opportunity.** Naavik argues traditional mobile MOBAs struggle in Western markets and points to Brawl Stars-style hybrids as the better path ([Naavik](https://naavik.co/f2p-mobile/wild-rift-adapting-moba/)). Warfront sits exactly in that gap: Brawl Stars controls and camera, MOBA structure, Archero-style drafting.

## 2. Core loop and match flow

The moment-to-moment loop is: move into a fight, let the gun work, collect XP, draft a power, fire the Ultimate when it is full, and push a lane. The match loop is: win lanes, take objectives, break a sub-base, destroy the HQ.

### Moment-to-moment loop (5 to 20 seconds)

1. **Move** with the joystick into range of enemies.
2. **Auto-fire** at the best target (Section 6 defines the rules).
3. **Earn XP and Ultimate charge** from nearby kills and damage.
4. **Level up** and tap one of three power cards (Section 8).
5. **Fire the Ultimate** when the button glows, ideally on a champion or a contested objective.
6. **Reposition**: retreat when low, rotate to another lane, or dive into the Trenches.

### Match phases

| Phase | Time | What players do | Design goal |
| --- | --- | --- | --- |
| Deploy | 0:00 to 0:15 | Pick lanes, walk out; first wave spawns at 0:15 | Teach lane choice with zero pressure |
| Laning | 0:15 to \~3:00 | Clear waves, poke the lane opponent, take Trench camps | Levels 1 to 5, first Ultimates, first drafts |
| Skirmish | \~3:00 to \~6:00 | Halftrack and Field Gun mini-bosses spawn (2:00); roaming and 2v1 ganks | First sub-base usually falls in this window |
| Push | \~6:00 to 10:00 | Behemoth spawns at 6:00; teams group for the HQ | Big team fights; levels 9 to 12; Epic powers online |
| Sudden Death | 10:00 to 13:00 | Air raids: all structures take +50% damage, respawns +50% longer | Force an ending |
| Time-out | 13:00 | Team whose HQ has the higher HP percentage wins; ties go to most sub-bases destroyed, then most champion takedowns | Guarantee a result |

### Win and lose

- **Win:** destroy the enemy HQ.
- **Lose:** your HQ is destroyed, or you are behind at the 13:00 time-out.
- **Surrender:** available from 5:00 with a unanimous vote (all 3 human players; bots abstain).

### Why 3v3

Three lanes and three players give each player one lane by default, so there is always something useful to do without team chat. Three players also shorten matchmaking queues and keep screen clutter manageable in portrait view. The trade-off is fewer team-fight permutations than 5v5, which the roguelike draft compensates for with build variety.

## 3. Controls and camera

The player has exactly two inputs in combat: a floating movement joystick and one Ultimate button. Firing, aiming and target choice are automatic.

### Inputs

| Input | Where | Behaviour |
| --- | --- | --- |
| Movement joystick | Touch anywhere on the screen that isn't a button, card or the minimap | Floating: spawns under the thumb. 8 mm dead zone; full speed at 60% of the ring radius. Release = stop. |
| Ultimate button | Bottom right, 22 mm diameter | Fills clockwise as it charges. Glows and pulses when ready. Tap = cast on the automatic target. Greyed out with a "no target" icon if nothing valid is in range. |
| Power card | Slides up above the joystick on level-up | Tap one of three cards. Play never pauses (Section 8). |
| Ping (optional) | Long-press the minimap | Places one of three pings: Attack, Defend, Danger. Not needed to play. |

### Auto-fire rules

- Champions fire **while moving** at full rate. This keeps the MOBA chase-and-kite feel.
- The upper body (or weapon) rotates independently towards the target; the legs follow the joystick. This makes the current target readable at a glance.
- No manual target lock. All targeting follows the priority rules in Section 6.
- Firing pauses for 0.2 s after a target dies, to read as a deliberate retarget rather than jitter.

### Camera

| Setting | Value | Note |
| --- | --- | --- |
| Projection | Perspective, 35° vertical FOV | Low FOV keeps the near-orthographic Brawl Stars look |
| Pitch | 60° down from horizontal | High angle so units never hide behind cover |
| Visible area | About 16 m wide × 26 m deep | The full width of one lane plus part of each neighbouring Trench |
| Framing | Player sits 40% up from the bottom of the play area | More view ahead (towards the enemy) than behind |
| Follow | Smooth follow, 0.15 s lag; nudges 2 m ahead in the move direction | Never rotates, never zooms in combat |
| Orientation | Your own HQ is always at the bottom of the screen | Both teams see the map from their own side |

### Accessibility and comfort

- Left-handed layout swaps the joystick zone and the Ultimate button.
- A "Hold to cast" option prevents accidental Ultimates.
- Haptics on level-up, Ultimate ready and taking big hits (can be disabled).
- Colour-blind mode replaces Red vs Blue with Orange vs Blue and adds team shape markers under units (Section 10).

## 4. Arena: The Front

The Front is a tall, narrow battlefield 36 m wide and 110 m long, with each team's HQ at one end and three parallel lanes between them. Trenches fill the space between lanes and hold the neutral camps and mini-bosses. The map is rotationally symmetric (a 180° turn maps Blue onto Red), so both teams have identical distances to every objective.

&#91;embedded content: The Front · map layout, Blue HQ at the bottom\]

Each lane holds one Sub-base per team; the Trenches between lanes hold the camps and both mini-boss pits, and the Behemoth waits in the Crater at the centre.

### Layout and dimensions

| Element | Position (x, y in m; Blue HQ at the bottom) | Notes |
| --- | --- | --- |
| Blue HQ / Red HQ | (0, −48) / (0, +48) | Spawn pad and healing zone around each HQ |
| Lanes | Left x = −12, Centre x = 0, Right x = +12 | Lanes are 6 m wide; side lanes bend inward over the last 10 m to meet the HQ |
| Sub-bases | One per lane per team, at y = −24 (Blue) and y = +24 (Red) | 6 sub-bases in total |
| No-man's land | Horizontal band at y = 0, 6 m deep | Craters, barbed wire, burnt trees; splits each team's half |
| Trenches | Between lanes: x from −9 to −3 and +3 to +9, y from −20 to +20 | 4 Trench zones (2 per team half) |
| Mini-boss pits | Left pit (−6, 0): Halftrack · Right pit (+6, 0): Field Gun | Inside the Trenches, on the no-man's-land line |
| The Crater | Map centre (0, 0), 8 m wide | Behemoth spawns here at 6:00; the centre lane splits around it |

### Travel times (base move speed 3.5 m/s)

| Route | Distance | Time |
| --- | --- | --- |
| HQ to own sub-base | 24 m | \~7 s |
| HQ to no-man's land | 48 m | \~14 s |
| Lane to neighbouring lane (through a Trench) | 12 m | \~3.5 s |
| HQ to enemy HQ | 96 m | \~27 s |

Short lane-to-lane times make roaming and ganking cheap, which is how a 3v3 creates 2v1 moments without a dedicated jungler.

### The Trenches (jungle)

The Trenches are sunken, board-lined dugouts between the lanes. They are the jungle equivalent: neutral camps, shortcuts and ambush cover.

- **Concealment:** a unit inside a Trench is hidden from enemies outside it, unless they are within 3 m. Firing reveals the shooter for 1 s. Hidden units cannot be auto-targeted, so Trenches enable surprise attacks without needing fog of war.
- **Entries:** each Trench zone has 3 openings: one onto each neighbouring lane and one onto no-man's land.
- **Cover:** sandbag walls inside the Trenches block bullets and grenades but not flames, which keeps Gamma strong in tight spaces.
- **Supply crates:** one medkit crate per Trench zone, restoring 25% max HP; respawns every 45 s.

### Neutral camps and mini-bosses

| Camp | Where | First spawn | Respawn | Reward |
| --- | --- | --- | --- | --- |
| Deserter Squad (3 riflemen) | 1 per Trench zone (4 total) | 0:30 | 40 s | 60 XP shared, +5% Ultimate charge |
| Sniper Nest (1 sniper, long range, low HP) | 1 per Trench zone (4 total) | 0:30 | 60 s | 80 XP shared, +8% Ultimate charge |
| **Halftrack** (mini-boss) | Left pit | 2:00 | 90 s | 250 XP to each team member; **Supply Drop** buff: +15% damage and +10% move speed for 60 s |
| **Field Gun** (mini-boss) | Right pit | 2:00 | 90 s | 250 XP to each team member; **Artillery Support**: the next 2 friendly waves in every lane bring an extra Bazooka Tank |
| **Behemoth** (major boss) | The Crater | 6:00 | 120 s | 400 XP to each team member; the Behemoth revives on your side and pushes the centre lane for 60 s or until destroyed |

Mini-boss behaviour: each has a telegraphed attack pattern (red ground markers 0.8 s before impact) so that movement, the only skill input, is what wins the fight. Mini-bosses leash back to their pit and fully heal if pulled more than 10 m away. The killing blow decides which team gets the reward, so contested bosses create the classic MOBA "steal" moment.

## 5. Structures and minions

Each team defends one Sub-base per lane and one HQ. The HQ is invulnerable until at least one of the team's Sub-bases has fallen, which preserves the MOBA rule that you must break a lane before you can win. All numbers below are starting values for the first playable build and are expected to change in tuning.

### Structures

| Stat | Sub-base (Pillbox Bunker) | HQ (Command Bunker) |
| --- | --- | --- |
| HP | 6,000 | 10,000 |
| Weapon | Heavy machine gun | Twin flak cannons |
| Damage | 200 per shot, 1 shot/s | 300 per shot, 1 shot/s, hits 2 targets |
| Range | 8 m | 9 m |
| Warm-up | +25% damage per consecutive hit on the same champion, up to +100% | Same |
| Backdoor protection | Takes 50% less damage when no enemy minion is within 10 m | Same |
| Vulnerable | From 0:00 | Only after 1 or more of its team's Sub-bases is destroyed |
| Regeneration | None once damaged below 50% | 1% max HP per second when no enemy is within 12 m |

**Structure targeting (aggro):** structures follow the MOBA convention so that diving has risk and minions matter.

1. If an enemy champion damages an allied champion inside the structure's range, the structure switches to that champion immediately.
2. Otherwise it attacks the nearest enemy minion.
3. With no minions in range, it attacks the nearest enemy champion.

This rule overrides nothing in the champion targeting priority (Section 6); it only defines what the structure shoots.

**When a Sub-base falls**, that lane's spawn upgrades for the attacking team: every wave in that lane gains 1 extra MG Soldier and its Bazooka Tank spawns every wave instead of every third wave ("Shock Troops"). This creates lane pressure the defenders must answer, like super minions in League of Legends.

### Minions

| Stat | MG Soldier | Bazooka Tank |
| --- | --- | --- |
| Role | Weak, numerous lane fodder | Strong siege unit |
| Look | Helmeted infantryman with a light machine gun | Small squat tank with a bazooka-style launcher on top |
| HP | 300 | 1,100 |
| Attack | 8 damage per bullet, 3 bullets/s (24 DPS) | 100 damage rocket every 2 s, 1.5 m splash |
| Range | 5 m | 6 m |
| Move speed | 2.6 m/s | 2.2 m/s |
| Bonus | None | +100% damage to structures; takes 50% less damage from structures |
| XP when killed | 30 | 80 |
| Ultimate charge when killed | +3% | +8% |

**Waves**

- First wave at 0:15, then every 25 s, in all three lanes at once.
- A wave is 3 MG Soldiers. Every third wave adds 1 Bazooka Tank; from 5:00, every second wave.
- Minions gain +6% HP and damage per minute of match time, so late waves stay relevant.
- Minions march along the lane, fight what they meet, and continue to the enemy Sub-base and then the HQ.

**Minion targeting:** nearest enemy minion, then nearest enemy structure, then nearest enemy champion. If an enemy champion damages an allied champion within 6 m, nearby minions switch to that champion for 3 s ("call for help"). This punishes trading inside the enemy wave.

**XP sharing:** a minion's XP goes to every allied champion within 10 m of it when it dies, split evenly. No last-hit is required, because auto-fire would make last-hitting a matter of luck.

## 6. Auto-targeting system

A champion always shoots the highest-priority enemy class inside its weapon range, and within that class, the nearest unit. The class order is **Champion > HQ (Base) > Sub-base > Minion > Neutral**. Neutral camps and mini-bosses are added at the bottom so that a champion in a Trench never ignores an enemy minion or champion to shoot a camp.

&#91;embedded content: Auto-targeting · 5 priority classes, then nearest unit\]

The ladder is walked top to bottom; the first class with any valid unit wins, and distance only decides within that class.

### Rules

1. **Build the candidate list** every 0.1 s: enemy units that are alive, inside weapon range, in line of sight (not behind a sandbag wall), and not hidden in a Trench. An invulnerable HQ is not a candidate.
2. **Pick the class:** take the highest-priority class that has at least one candidate.
3. **Pick the unit:** within that class, the nearest unit, measured to the edge of its collider. A tie within 0.5 m goes to the unit with the lowest HP percentage.
4. **Stick to the current target** while it stays valid and within range + 0.5 m. This stops flicker at range edges.
5. **Switch only when it matters:** a higher class entering range overrides the current target after 0.15 s. Within the same class, switch only if the new unit is more than 1.5 m nearer.
6. **On a kill,** re-run the selection immediately and resume firing after the 0.2 s retarget pause.

```
function selectTarget(champ):
    candidates = enemies.filter(u =>
        u.alive and !u.hidden and !u.invulnerable
        and dist(champ, u) <= champ.range and lineOfSight(champ, u))
    if candidates.empty: return null
    topClass = max(candidates.map(u => u.priority))   // Champion=5, HQ=4, SubBase=3, Minion=2, Neutral=1
    pool = candidates.filter(u => u.priority == topClass)
    best = argmin(pool, u => (dist(champ, u), u.hpPercent))
    cur = champ.currentTarget
    if cur in candidates:
        if cur.priority == topClass and dist(champ, best) > dist(champ, cur) - 1.5:
            return cur                                 // stickiness
    return best
```

### Design consequences

- **Champions are always the first thing you shoot.** A player who walks into an enemy champion's range starts a duel, so positioning decides every trade. This is the main source of skill.
- **You cannot farm under fire.** If the enemy champion stands within range, you will shoot them, not the wave. Players manage this by spacing: stand where the wave is in range but the champion is not.
- **Sieging needs a clear lane.** Defenders near their Sub-base pull fire away from it. To take a structure, kill or chase off the defenders first, which naturally creates team fights at objectives.
- **HQ before Sub-base** matters only in the rare case both are in range; it makes the final push decisive.
- **Trenches create counterplay.** Because hidden units are not candidates, a champion in a Trench can wait out a turret shot or set up an ambush.

### Ultimates and targeting

Ultimates use the same class order with their own range, plus champion-specific exceptions defined in Section 7. If no valid target exists, the Ultimate button greys out instead of wasting the charge.

### Optional advanced setting (post-prototype)

A "Structure focus" toggle in settings could flip Sub-base above Minion and below Champion for players who prefer to siege. It stays off by default to protect the one-input promise; test it only if playtests show frustration with targeting during sieges.

## 7. Champions

The launch roster is three champions covering the three classic roles: Alpha (all-rounder), Beta (fast skirmisher) and Gamma (tank and support). Each has one weapon, one passive trait and one Ultimate; everything else comes from the in-match power draft. Stats grow by +5% max HP and +4% damage per level.

### Base stats at level 1

| Stat | Alpha | Beta | Gamma |
| --- | --- | --- | --- |
| Role | All-rounder | Skirmisher | Tank / support |
| Max HP | 1,000 | 750 | 1,500 |
| Weapon | Heavy revolver | SMG, burst fire | Flamethrower |
| Damage | 95 per shot | 4 bullets × 24 per burst | 28 per tick, 5 ticks/s, hits every enemy in the cone |
| Fire rate | 1.2 shots/s | 1 burst every 0.85 s | Continuous |
| Single-target DPS | \~114 | \~113 | \~140 (per target) |
| Range | 7 m | 6 m | 4 m cone, 40° wide |
| Move speed | 3.5 m/s | 4.0 m/s | 3.0 m/s |
| Ultimate passive charge time | 50 s | 55 s | 65 s |

### Alpha — the Sergeant

A steady veteran with a heavy revolver: slow, hard-hitting shots at average range, average health and average speed. Alpha is the champion new players should start with.

- **Weapon — Service Revolver:** single 25 m/s bullets, 95 damage, 1.2 shots/s, 7 m range.
- **Trait — Steady Hand:** after standing still for 0.5 s, gain +20% fire rate until moving again. This rewards picking a good spot, without adding an input.
- **Ultimate — Frag Grenade:**
  - Cast range 9 m. Target order: nearest enemy champion; if none, the enemy HQ (if vulnerable); if none, the nearest enemy Sub-base; if none, the nearest enemy minion. Neutral camps are targeted only if nothing else is in range.
  - The grenade lobs in a 0.6 s arc (a red circle marks the landing spot, so the target can try to dodge).
  - Explosion: 250 damage (+20 per level) in a 3 m radius.
  - Leaves a **fire pool**, 3 m radius for 4 s, dealing 50 damage per second (+5 per level) to enemies inside. Structures take 50% from the fire.
- **Plays well:** holds a lane alone, zones enemies off a wave with the fire pool, finishes structures.

### Beta — the Runner

A quick SMG specialist who sprays bursts of bullets. She is the fastest champion and the most fragile.

- **Weapon — Burst SMG:** bursts of 4 bullets (24 damage each) every 0.85 s, 6 m range, slight spread (±4°).
- **Trait — Light Feet:** +20% move speed after 2 s without dealing or taking damage. Makes her the best roamer between lanes.
- **Ultimate — Lead Storm:**
  - A 3 s channelled barrage in a line 10 m long and 4 m wide, aimed at the highest-priority target within 10 m (the same class order as Section 6). With no target, it fires in her movement direction.
  - The line tracks her current target, turning at up to 90° per second.
  - 20 bullets per second, 12 damage each (+1 per level), hitting every enemy in the line.
  - Every enemy hit is **slowed by 35% for 1.5 s**, refreshed while they stay in the line.
  - Beta can move at 70% speed while channelling, so the player still steers the fight.
- **Plays well:** roams through the Trenches to gank, chases low-HP champions, shreds minion waves with Lead Storm.

### Gamma — the Furnace

A tanky flamethrower trooper with high health and high close-range damage. He is slow, short-ranged and built to stand in front of the team.

- **Weapon — Flamethrower:** a 4 m, 40° cone that damages every enemy inside it, 140 DPS per target. Flames pass over sandbag walls.
- **Trait — Charge:** +30% move speed while moving towards the nearest enemy champion within 8 m. This lets a slow tank close the gap on ranged champions using only the joystick.
- **Ultimate — Heat Wave:**
  - A 7 m radius aura centred on Gamma that moves with him for 6 s.
  - **Allies inside:** heal 3% max HP per second and deal +20% damage.
  - **Enemies inside:** burn for 3% max HP per second and deal −20% damage.
  - Affects champions and minions. Structures are unaffected (keeps HQ fights fair).
  - No target is required; the button is usable whenever it is charged.
- **Plays well:** leads pushes into Sub-bases, wins fights in the cramped Trenches, turns team fights with Heat Wave.

### Matchup triangle

The three kits form a soft counter loop, so lane swaps and roaming matter:

- **Alpha beats Beta:** longer range and burst damage punish her low HP; the grenade catches her dives.
- **Beta beats Gamma:** her speed, range and Lead Storm slow keep him out of flame range.
- **Gamma beats Alpha:** Charge closes the gap on Alpha's slower kiting, and his HP outlasts the revolver.

These are soft counters. Power drafts can overturn them, which is intended.

## 8. Progression: levels, power draft and Ultimate charge

Champions start each match at level 1 and can reach level 12, drafting one power on each of the 11 level-ups. There is no gold, no shop and no item build; the draft replaces all of that. Powers last for the whole match, including through deaths, and reset when the match ends.

### XP sources

| Source | XP | Shared with |
| --- | --- | --- |
| MG Soldier | 30 | Allied champions within 10 m, split evenly |
| Bazooka Tank | 80 | Allied champions within 10 m, split evenly |
| Deserter Squad / Sniper Nest | 60 / 80 | Allied champions within 10 m |
| Enemy champion takedown | 120 + 25 × victim's level | Everyone who damaged the victim in the last 8 s; the killer gets +30 |
| Halftrack / Field Gun | 250 each | Whole team, anywhere on the map |
| Behemoth | 400 | Whole team, anywhere on the map |
| Sub-base destroyed | 150 | Whole team |

### XP needed per level

| Level | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| XP from previous level | 100 | 120 | 140 | 160 | 180 | 200 | 220 | 240 | 260 | 280 | 300 |
| Total XP | 100 | 220 | 360 | 520 | 700 | 900 | 1,120 | 1,360 | 1,620 | 1,900 | 2,200 |

A solo laner earns roughly 240 XP per minute from waves alone, so an active player reaches level 12 at around 7 to 8 minutes, just before Sudden Death.

### Draft rules

1. On level-up, a tray of **3 power cards** slides up above the joystick. The match never pauses.
2. **Tap a card** to take it. If the player does not choose within 10 s, the highlighted (recommended) card is taken automatically. The recommendation favours cards that share tags with powers already owned.
3. If another level-up happens while the tray is open, the next offer queues (maximum 2 queued).
4. **Rarity odds:** Common 65%, Rare 30%, Epic 5%. At levels 4, 8 and 12, one card is a guaranteed Epic ("Field Promotion").
5. Every offer contains at least one card from the champion's signature pool or one that fits their weapon.
6. **One free reroll** per match.
7. **Stack caps:** a Common can be taken up to 3 times, a Rare up to 2 times, an Epic once.
8. **Weapon adaptation:** projectile powers convert for Gamma's flamethrower (for example, +1 projectile becomes +10° cone width and +0.5 m range).

### Power catalogue (v1)

| Power | Rarity | Pool | Effect |
| --- | --- | --- | --- |
| Rapid Fire | Common | All | +12% fire rate |
| Hollow Points | Common | All | +12% damage |
| Field Rations | Common | All | +15% max HP |
| Light Boots | Common | All | +8% move speed |
| Long Barrel | Common | All | +8% weapon range |
| Flak Vest | Common | All | −10% damage taken |
| Field Medic | Common | All | Regenerate 2% max HP per second after 3 s out of combat |
| Quick Charge | Common | All | +15% Ultimate charge from all sources |
| Double Tap | Rare | All | +1 bullet per shot, fired straight after it at the same target (Gamma: +10° cone, +0.5 m range) |
| Ricochet | Rare | All | Bullets bounce to 1 more enemy within 4 m for 50% damage |
| Piercing Rounds | Rare | All | Bullets pass through the first enemy hit |
| Incendiary Rounds | Rare | All | Hits burn for 20 damage per second for 2 s |
| Tracer Rounds | Rare | All | Enemies you hit take +10% damage from all sources for 2 s |
| Demolition Expert | Rare | All | +35% damage to structures |
| Bounty Hunter | Rare | All | +20% damage to enemy champions |
| Scavenger | Rare | All | Heal 3% max HP whenever a nearby enemy minion dies |
| Second Wind | Rare | All | Below 30% HP, gain a 20% max HP shield for 3 s (30 s cooldown) |
| Dug In | Rare | All | −25% damage taken while near an allied structure or inside a Trench |
| Mortar Support | Epic | All | Every 6 s, a mortar shell hits your current target for 150 damage in a 2.5 m radius |
| Attack Drone | Epic | All | A drone circles you and fires at your target for 40% of your DPS |
| War Dog | Epic | All | A loyal dog fights beside you, biting for 60 damage per second; respawns 20 s after dying |
| Tesla Rounds | Epic | All | Every 5th hit chains lightning to 3 nearby enemies for 120 damage each |
| Minefield | Epic | All | While moving, drop a mine every 6 s (120 damage, 2 m radius, max 3 active) |
| Last Stand | Epic | All | Once per life, a lethal hit leaves you at 1 HP and invulnerable for 1.5 s |
| Overcharge | Epic | All | The Ultimate can store 2 charges |
| Airstrike Beacon | Epic | All | Casting the Ultimate also calls a line of 3 bombs across your target, 200 damage each |
| Dead Eye | Rare | Alpha | Every 6th revolver shot is a critical hit for double damage |
| Cluster Grenade | Epic | Alpha | Frag Grenade splits into 3 bomblets for 100 damage each around the impact |
| Extended Mag | Rare | Beta | +2 bullets per burst |
| Adrenaline | Rare | Beta | +30% move speed for 2 s after any takedown |
| Napalm Tank | Rare | Gamma | Flames leave burning ground for 2 s (30 damage per second) |
| Inferno Shell | Epic | Gamma | Heat Wave radius +30% and duration +2 s |

### Ultimate charge

The Ultimate meter fills from 0% to 100% passively over the champion's charge time (Section 7), and faster through combat. Charge is kept through death.

| Source | Charge |
| --- | --- |
| Passive | 100% over 50 s (Alpha), 55 s (Beta), 65 s (Gamma) |
| MG Soldier / Bazooka Tank dies within 10 m | +3% / +8% |
| Neutral camp killed | +5% to +8% |
| Mini-boss / Behemoth killed (whole team) | +15% / +25% |
| Enemy champion takedown (kill or assist) | +25% |
| Damage dealt to enemy champions | +1% per 100 damage |
| Damage taken from enemy champions | +1% per 150 damage |

Charging from damage taken lets tanks and losing players reach their Ultimate sooner, which doubles as a light comeback tool.

## 9. Death, respawn and comeback

Death costs time, not progress: a dead champion keeps their level, powers and Ultimate charge, and respawns at the HQ after 4 s + 1.2 s per level (maximum 18 s). Comeback tools are light, so a lead still matters, but a team that falls behind early can recover through objectives.

### Death and respawn

- **Respawn timer:** 4 s + 1.2 s × level, capped at 18 s; ×1.5 during Sudden Death.
- **Kept on death:** level, XP, powers, Ultimate charge.
- **Healing:** the HQ spawn pad heals 10% max HP per second. There is no recall button; walking back is the decision.
- **Redeploy sprint:** after respawning, +50% move speed until the champion deals or takes damage or crosses no-man's land. This replaces Wild Rift-style teleport and gets players back into action within about 10 s.
- **Spectate:** while dead, the camera follows the killer for 2 s, then a teammate.

### Bounties and catch-up

| Mechanic | Rule |
| --- | --- |
| Kill streak bounty | A champion with 3 or more takedowns without dying is worth +100 XP more per extra takedown (cap +300) |
| Level catch-up | XP from a champion takedown gets +15% per level the victim is above the killer (cap +60%) |
| Underdog charge | The team with fewer standing Sub-bases gains +20% passive Ultimate charge |
| HQ last line | When a team's HQ drops below 30%, its defensive fire rate rises by 50% for the rest of the match |

### Balance levers

These are the dials to adjust during playtests, in order of preference:

1. Wave interval and minion stats (controls match length and lane pressure).
2. Structure HP and backdoor protection (controls how fast pushes end games).
3. XP curve (controls how quickly Epic powers come online).
4. Power numbers and rarity odds (controls build strength and variance).
5. Champion base stats (last, because players learn champions by their numbers).

Target metrics for the first tuning pass: median match 8 to 10 minutes; under 10% of matches reach the 13:00 time-out; each champion's win rate within 47% to 53%; no single power picked in more than 40% of offers in which it appears.

## 10. UI and audio

The HUD keeps the top strip for match information and the bottom third for the thumbs, leaving the middle of the portrait screen clear for the fight. The visual style of every asset, including the UI art, is defined in Section 11.

### HUD layout (portrait)

| Zone | Contents |
| --- | --- |
| Top strip (12% of height) | Match timer in the centre; each team's Sub-base and HQ icons with HP pips on either side; kill score |
| Top right | Minimap: a narrow vertical strip of the 3 lanes, showing structures, champions, mini-bosses and pings |
| Play area (middle \~60%) | The world. Floating HP bars above units, damage numbers, level-up flash |
| Above thumbs | Power card tray (3 cards, each \~30% of screen width) with a 10 s timer bar |
| Bottom left | Joystick zone, own HP bar, level badge and XP bar |
| Bottom right | Ultimate button with charge ring; small reroll icon while the card tray is open |

### Readability rules

- **Team colour on everything that moves:** uniforms, vehicle stripes, flags, HP bars, bullet tracers and ground rings. The local player's team is always shown in Blue, and the enemy in Red (the standard Brawl Stars convention), so "blue is friend" never needs to be relearned. Spectator and replay views use true team colours.
- **Size signals threat:** champions are about 1.4× the height of an MG Soldier; Bazooka Tanks are wide and boxy; mini-bosses are 2× to 3× champion size.
- **Target line:** a thin line in team colour links your champion to its current target, so auto-targeting is never a mystery.
- **Telegraphs:** every big enemy hit (mini-boss attacks, the grenade landing spot, Lead Storm's line) shows a red ground marker at least 0.5 s before damage.
- **Colour-blind mode:** Orange vs Blue, plus a circle (friend) or diamond (enemy) ring under each unit.

### Audio and feedback

- Each weapon has a distinct sound: revolver crack, SMG rattle, flamethrower roar. Players should identify an off-screen champion by ear.
- Radio-style voice lines for key events: "Enemy Sub-base destroyed", "Halftrack spotted", "Our HQ is under attack".
- A rising siren when an enemy Ultimate targets you.
- Level-up stinger plus a short haptic pulse; Ultimate-ready chime.
- Music: marching snare and brass, intensifying in Sudden Death.

## 11. Art direction

Warfront looks like a toy-soldier diorama of a world-war battlefield: flat-shaded low poly, chunky proportions, mud and smoke everywhere, with team Red and team Blue as the only saturated colours. Every asset in this section is low poly for fast iteration; detail comes from silhouette, colour and effects, not texture.

### Visual pillars

1. **Toy-soldier diorama.** The camera looks down on what feels like a tabletop war game: slightly oversized heads, hands and weapons, simple shapes, lively animation.
2. **War-torn, not grim.** Mud, craters, smoke and fire set the world-war mood, but there is no blood or gore. Defeated units are knocked out, not killed on screen. Target rating: PEGI 12 / ESRB Teen.
3. **Read at phone size.** A champion is about 1 cm tall on screen. Silhouette and team colour must identify it without zooming.
4. **Low poly everywhere.** Flat shading, no normal maps, no detailed textures. One shared palette atlas for almost everything.
5. **Fiction, not history.** World-war era vehicles, uniforms and weapons, but invented factions and insignia. No real national flags, emblems or political symbols.

### Technical style rules

| Rule | Value |
| --- | --- |
| Shading | Flat (faceted) shading; colour from a single 256 × 256 palette atlas or vertex colours |
| Triangle budget | Champions \~3,000 · MG Soldier \~800 · Bazooka Tank \~1,500 · Sub-base \~4,000 · HQ \~6,000 · mini-bosses \~5,000 · Behemoth \~8,000 · props 50 to 500 |
| Lighting | One warm directional "late afternoon" sun at \~45°, baked ambient occlusion, cool ambient fill for shadows |
| Outline | Optional thin dark outline on champions only, to lift them off busy ground |
| Post-processing | Light colour grade (warm highlights, cool shadows), small bloom on fire and muzzle flashes only, soft vignette; no depth of field |
| Modular kit | Environment built on a 2 m grid from reusable pieces (trench walls, sandbags, fences, craters) |
| Rigging | One shared humanoid skeleton for champions, soldiers and neutral infantry so animations can be retargeted |
| Tools | Blender for modelling and rigging; the engine's particle system for VFX |

### Colour palette

The environment stays in muted earth tones so that team colours, fire and telegraphs always pop. Starting values for the palette atlas:

| Swatch | Hex | Used for |
| --- | --- | --- |
| Mud brown | #6B5843 | Lanes, no-man's land, craters |
| Olive drab | #6F7445 | Grass patches, canvas, neutral uniforms |
| Khaki | #B9A57A | Sandbags, dirt highlights, UI panels |
| Trench wood | #8A6A45 | Trench boards, crates, fence posts |
| Concrete | #9A968C | Bunkers, Sub-bases, HQ |
| Gunmetal | #4F575A | Weapons, vehicles, barbed wire |
| Smoke grey | #8C8C86 | Smoke, ash, ruins |
| Blue team | #2F7DE1 (shade #1F4F94) | Blue Brigade units, flags, tracers, HP bars |
| Red team | #D6423A (shade #8E2622) | Red Legion units, flags, tracers, HP bars |
| Fire orange | #FF8A2A | Flames, explosions, Gamma's lenses |
| Muzzle yellow | #FFD45C | Muzzle flashes, level-up, Epic rarity |
| Danger red | #FF3B30 (semi-transparent) | Ground telegraphs only, never used on units |

Team colour covers roughly 25% to 35% of every team unit: helmet or cap, armband, scarf or chest patch, and a weapon wrap or vehicle stripe. As stated in Section 10, the local player's team always renders as Blue.

### The arena

| Zone | Look | Key props |
| --- | --- | --- |
| HQ area | Fortified compound: concrete Command Bunker under camouflage netting, a radio mast, supply tents in team colour, a sandbagged spawn pad | Searchlights, flag poles, fuel drums, parked jeeps (decor) |
| Lanes | Packed-mud roads with tyre tracks and puddles, bordered by low sandbag walls and broken fences | Telegraph poles, road signs with invented place names, abandoned carts |
| Sub-base surrounds | Small strongpoint: the Pillbox on a raised mound with a sandbag ring and team flag | Ammo crates, sandbag stacks, a spent-shell pile |
| Trenches | Sunken, zig-zag dugouts lined with wooden boards; darker and slightly cooler lit to read as cover | Duckboards, ladders, lanterns, bunk entrances, medkit crates with a white cross on khaki |
| No-man's land | Churned mud, shell craters, coils of barbed wire, tank traps, burnt tree stumps | Wrecked biplane, rusted helmets, drifting low smoke |
| The Crater | A deep blast crater with exposed rock and a ring of debris; the Behemoth sits in it like a sleeping beast | Broken rails, scattered shells, steam vents |
| Map edge | Ruined farmhouse walls, rows of sandbags and wire; the ground falls away into haze | Distant church tower ruin, windmill silhouette |

- **Team dressing:** each half of the map carries its own team's flags, tents and painted crates, so players always know which side of no-man's land they are on.
- **Ambient life (non-interactive):** distant artillery flashes on the horizon, biplanes crossing the sky, birds scattering from trees when explosions land near them, slow drifting smoke.
- **Cosmetic destruction:** crates, fences and lamp posts shatter into a few low-poly chunks when hit. Gameplay-relevant cover (sandbag walls) never breaks.
- **Time of day:** late afternoon for the launch map; dusk and rainy variants later as cosmetic map themes.

### Structures

| Structure | Design | Damage states | Destruction |
| --- | --- | --- | --- |
| Sub-base (Pillbox Bunker) | Hexagonal concrete pillbox, heavy MG barrel through a slit, sandbag ring, team flag on a pole | 66%: cracks and chips · 33%: sandbags blown away, chunks missing, light smoke · below 33%: fire inside, flag torn | Roof caves in, dust and smoke column, then it stays as rubble for the rest of the match |
| HQ (Command Bunker) | Large concrete bunker with radio mast, twin flak cannons on the roof, camouflage netting, big team banner | Same three stages, plus sparks from the mast and a siren light at 30% | Chain of explosions, mast topples, 1 s slow motion, then the victory or defeat screen |

### Champions

|  | Alpha — the Sergeant | Beta — the Runner | Gamma — the Furnace |
| --- | --- | --- | --- |
| Silhouette | Upright and broad-shouldered; long coat flares at the bottom | Slim, leaning forward; a long scarf trails behind her | Wide and round, almost a barrel; twin tanks on the back |
| Outfit | Peaked cap, greatcoat, ammo bandolier, heavy boots | Aviator cap with goggles, short flight jacket, light pack | Padded fire-proof suit, gas-mask helmet with round glowing lenses |
| Weapon | Oversized revolver held one-handed | Compact SMG with a drum magazine | Flamethrower nozzle linked by a hose to the fuel tanks |
| Team colour | Cap band, armband, coat lining | Scarf, goggle strap, jacket stripes | Helmet stripe, tank caps, shoulder plates |
| Trait visual | Steady Hand: a brief glint runs along the revolver | Light Feet: dust trail and speed lines at her heels | Charge: steam bursts from his tank valves |
| Ultimate visual | Pulls the pin with his teeth, overhand throw | Braces, sprays from the hip, casings pour out | Slams the nozzle down; a heat ring bursts outward |

**Animation set (per champion):** idle, run, an upper-body aim layer that turns towards the target independently of the legs, fire, Ultimate cast, hit react, knock-out (falls with a dust puff and a bouncing helmet, then fades), respawn, victory and defeat poses.

### Minions and neutrals

| Unit | Design | Motion and defeat |
| --- | --- | --- |
| MG Soldier | Short infantryman in a team-colour helmet, light machine gun on the shoulder, small backpack | Marches in a loose column with a bounce; when defeated, falls and sinks into the ground after 1.5 s |
| Bazooka Tank | Squat tracked vehicle with a one-man turret carrying a launcher tube; team-colour stripe and a painted number | Treads kick up mud and exhaust puffs; when destroyed, pops, turret flips, hull burns for 2 s then fades |
| Shock Troops | MG Soldiers with bigger packs and a bright rank stripe | Same as MG Soldier, slightly larger |
| Deserter Squad | Mismatched grey and brown uniforms, no team colour, white rag armbands | Sit around a campfire until pulled |
| Sniper Nest | A sniper in a ghillie cape inside a sandbag nest | Laser-thin red aim line before each shot |
| Halftrack (mini-boss) | Armoured halftrack with a mounted gun, rusty olive paint, hazard-yellow stripes | Charges along a telegraphed line, sprays a cone |
| Field Gun (mini-boss) | Big wheeled artillery piece with a crew of two | Lobs shells at red circles on the ground |
| Behemoth (boss) | A giant land-ironclad: three turrets, smokestacks, rivets, rust streaks | Wakes with a roar of steam; when captured, team-colour banners unroll down its sides |

Neutrals use rust, olive and hazard-yellow so they can never be mistaken for either team.

### Visual effects (VFX)

All effects are built from low-poly meshes and simple flat-coloured particles: no photo textures, no full-screen effects.

| Effect | Look |
| --- | --- |
| Muzzle flash | A four-point low-poly star in muzzle yellow, 2 to 3 frames, with a tiny smoke puff |
| Bullet tracers | Thin stretched quads in team colour, so you can see who is shooting at whom |
| Bullet impacts | Mud puffs on ground, sparks on metal and concrete, wood splinters on crates |
| Explosions | Expanding orange fireball (low-poly sphere), dark cube debris, then a rising grey smoke puff; light camera shake on big ones |
| Smoke | Icosphere puffs that grow, drift with a shared wind direction and fade |
| Fire | Stylised flame cones that flicker and rise, with occasional embers |
| Alpha's Frag Grenade | Arc trail, red landing circle, explosion, then a fire pool of flickering flame cones on scorched ground |
| Beta's Lead Storm | Red line telegraph on the ground, dense tracer stream, shell casings pouring from the gun; slowed enemies drag dust swirls at their feet |
| Gamma's flamethrower | A cone of tumbling flame polygons with heat shimmer; scorch marks left on the ground |
| Gamma's Heat Wave | A pulsing heat ring on the ground with rising embers; allies inside glow gold, enemies inside smoulder red-orange |
| Level-up | Gold rank chevron pops above the champion, short light column, brass "ding" |
| Ultimate ready | Weapon glints; small sparks orbit the Ultimate button |
| Respawn | A smoke-grenade pop on the HQ spawn pad, the champion steps out of the smoke |
| Sudden Death air raids | The sky reddens; biplanes cross the screen and drop bombs on map edges (cosmetic) |
| Structure destruction | Concrete chunks, a dust shockwave ring, a lingering smoke column |

**VFX rules:** effects never cover a ground telegraph; enemy telegraphs always draw on top; tracers and impacts keep team colour; a "Reduced effects" setting cuts particle counts by half and removes camera shake.

### UI art

The interface looks like field-issue military kit: stencil lettering, canvas and khaki paper, brass gauges and stamps. Layout and readability rules stay as defined in Section 10.

| Element | Art treatment |
| --- | --- |
| Typography | A stencil display font for headings and big callouts; a clean, bold sans-serif for numbers, timers and body text |
| Panels | Khaki canvas and paper textures in flat colour, with stitched or riveted edges |
| Ultimate button | A round brass pressure gauge; the needle and ring fill as it charges, and it glows when ready |
| HP bars | Team-colour bars split into 250 HP segments, with a thin dark frame |
| Level badge | Military rank chevrons: one chevron per few levels, gold at level 12 |
| Power cards | "Field orders" cards with a low-poly 3D icon, a short title and one line of effect; rarity shown by frame: Common in bronze, Rare in silver, Epic in gold with a wax-seal stamp |
| Player names | Small dog-tag plates |
| Minimap | A war-room map table: pins for champions, small flags for structures, a small grey X for knocked-out units |
| Pings | Stamped icons: Attack (crossed rifles), Defend (shield), Danger (exclamation in a triangle) |
| Main menu | A low-poly war-room diorama: the selected champion stands by a map table, with a window onto the front |
| Victory / defeat | Victory: a raised team banner with confetti-like paper scraps; defeat: a torn banner in drizzle |

### Asset priority for the prototype

1. Greybox arena kit (lanes, trench walls, sandbags) and the palette atlas.
2. Alpha, MG Soldier and the Sub-base, with their core animations.
3. Core VFX: muzzle flash, tracers, impacts, explosion, smoke.
4. Beta, Gamma, Bazooka Tank, HQ and their Ultimate effects.
5. Neutrals, mini-bosses, Behemoth and the full UI art pass.

## 12. Modes, bots and meta progression

Launch with one core mode (3v3 Frontline) plus a bot-only practice mode; add variants only once the core is fun. Outside the match, progression unlocks champions and cosmetics, never in-match power.

### Modes

| Mode | Players | Length | Status |
| --- | --- | --- | --- |
| Frontline (core) | 3v3 | 8 to 10 min | Prototype and launch |
| Boot Camp (tutorial) | 1 human + bots | \~5 min, scripted | Prototype |
| Practice vs Bots | 1 to 3 humans + bots | 8 to 10 min | Launch |
| Skirmish (single lane) | 1v1 | \~4 min, one lane, one Sub-base each | Post-launch test |
| Blitz | 3v3 | \~5 min; faster waves, start at level 3 | Post-launch event |
| Ranked Frontline | 3v3 | 8 to 10 min | After the player base supports it |

### Bots

- Fill empty slots after 15 s of matchmaking, and power Practice mode.
- Behaviour tree: stay with the lane wave → fight when HP is above 40% → retreat below 30% → take a Trench camp when the lane is clear → group for mini-bosses on spawn → join pushes when 2 allies are in a lane.
- Draft: bots pick by tag weights per champion (Alpha: damage, Beta: speed and on-hit, Gamma: HP and aura).
- Difficulty tiers change reaction time (0.6 s to 0.2 s), retreat thresholds and Trench usage.

### Meta progression

- **Account level:** XP from every match; unlocks champions (Beta at account level 3, Gamma at level 6), modes and cosmetics.
- **Champion mastery:** per-champion track with badges, skins and voice lines.
- **Collection, not power:** all powers in the catalogue are available to everyone from the first match. Meta unlocks never add stats in PvP.

### Monetisation guardrails

- Revenue from cosmetics (skins, weapon finishes, HQ banners, victory emotes) and a seasonal pass with free and premium tracks.
- New champions can be earned through play within a reasonable time; direct purchase only speeds that up.
- No paid stat boosts, no paid power rerolls, no energy timers that block play.

## 13. Technical notes, roadmap, risks and open questions

### Technical notes

| Area | Recommendation |
| --- | --- |
| Engine | Unity (URP) or Godot 4; both handle low-poly mobile 3D well. Pick the one the team knows. |
| Networking | Server-authoritative simulation at 20 to 30 Hz; client-side prediction for own movement only. Targeting, damage and XP are computed on the server so auto-targeting cannot be cheated. |
| Performance target | 60 fps on mid-range Android (3 to 4 years old); 30 fps floor on low-end devices with effects reduced. |
| Unit budget | Up to \~70 active units (6 champions, \~50 minions, camps, bosses); GPU instancing for minions; pooled projectiles. |
| Draw calls | Under 150; single palette atlas; baked lighting with one real-time shadow caster. |
| Data-driven design | All stats, waves, powers and XP curves live in data files (ScriptableObjects or JSON) so designers tune without code changes. |
| Telemetry | Log match length, structure fall times, power offers and picks, deaths by position and Ultimate usage from the first playtest. |

### Prototype roadmap

The build grows in four gated phases, from a single-lane feel test to a soft launch; each gate must pass before the next phase starts.

&#91;embedded content: Prototype roadmap · 4 phases, 3 gates\]

The first gate is the most important: if movement alone does not feel skilful in a single lane, no amount of content will fix the core.

### Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Auto-fire feels like the game plays itself | Low agency kills retention | Strong telegraphs, dodgeable Ultimates, Trench ambushes, Steady Hand and Charge traits; measure deaths avoided by movement |
| Draft cards interrupt combat | Tapping a card mid-fight costs movement | Non-blocking tray, 10 s timer, auto-pick of the recommendation, queueing |
| Snowballing in a 3v3 | One early kill can decide a short match | Bounties, level catch-up, underdog charge, Behemoth as a late swing |
| Screen clutter in portrait | Projectiles and effects hide threats | Effect budget, team-colour tracers, size hierarchy, reduced-effects option |
| Structure priority frustration | Players want to hit the Sub-base, not the defender | Clear target line, backdoor rules explained in Boot Camp, optional Structure focus setting |
| Western mobile MOBA market is hard | Wild Rift and Pokémon Unite underperformed in the West | Lean into the cross-genre hook: Brawl Stars controls plus roguelike drafting |

### Open questions

- Should the Bazooka Tank be a small tracked vehicle (current proposal) or a heavy infantryman carrying a bazooka?
- Should Alpha's Frag Grenade include the enemy HQ in its target order? This document adds it after champions, in line with the global priority; the original brief listed champion, Sub-base, then minion.
- Is 3v3 the final team size, or should 5v5 be tested once the core loop is proven?
- Should Gamma's Heat Wave be a moving aura (current) or a fixed zone placed where he casts it?
- Do we want fog of war beyond Trench concealment?
- How many champions are needed for launch: 6, 9 or 12?

### Sources

- [Wild Rift: How to Adapt a MOBA for Mobile — Naavik](https://naavik.co/f2p-mobile/wild-rift-adapting-moba/)
- [Finding the Fun: Archero Part 1 — Gameplay, Game Developer](https://www.gamedeveloper.com/design/finding-the-fun-archero-part-1---gameplay)
- [MOBA overview — Emergent Mind](https://www.emergentmind.com/topics/moba)
- [Human-Agent Collaboration in Honor of Kings, arXiv 2401.16444](https://arxiv.org/pdf/2401.16444)
