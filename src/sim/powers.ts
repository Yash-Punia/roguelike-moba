import type { Config, StatName } from '../data/schema';
import { cos, sin } from './math';
import { Stat } from './stats';

/** The Attack Drone goes once round its owner in this many ticks (render draws it from the same clock). */
export const DRONE_ORBIT_TICKS = 60;

/** Where an owner at (x, y) has its drone on `tick` (D-063). */
export function dronePosition(x: number, y: number, orbit: number, tick: number, out: { x: number; y: number }) {
  const a = ((tick % DRONE_ORBIT_TICKS) / DRONE_ORBIT_TICKS) * 2 * Math.PI;
  out.x = x + cos(a) * orbit;
  out.y = y + sin(a) * orbit;
  return out;
}

/** Config stat names → sim stats. */
export const STAT: Record<StatName, Stat> = {
  damage: Stat.Damage,
  fireRate: Stat.FireRate,
  maxHp: Stat.MaxHp,
  moveSpeed: Stat.MoveSpeed,
  range: Stat.Range,
  damageTaken: Stat.DamageTaken,
  ultCharge: Stat.UltCharge,
  damageVsChampions: Stat.DamageVsChampions,
  damageVsStructures: Stat.DamageVsStructures,
};

/**
 * A champion's owned powers folded into the numbers the systems read (D-060), rebuilt when a
 * power is taken or config changes, so no system searches the catalogue per tick. Amounts add
 * up per stack; durations, radii and thresholds take the largest owned. Ticks, fractions and
 * radians as converted at load. 0 = none.
 */
export interface PowerMods {
  /** Extra projectiles per trigger pull, and the angle between them. */
  shots: number;
  shotSpread: number;
  /** Cone weapons: wider and longer instead of extra projectiles. */
  coneAngle: number;
  coneRange: number;
  /** Extra bullets per burst. */
  burst: number;
  pierce: number;
  ricochetCount: number;
  ricochetRadius: number;
  ricochetPct: number;
  /** Every Nth shot is a critical hit. */
  critEvery: number;
  burnDps: number;
  burnTicks: number;
  markPct: number;
  markTicks: number;
  scavengeRadius: number;
  scavengePct: number;
  lowHpBelow: number;
  lowHpShield: number;
  lowHpTicks: number;
  lowHpCooldown: number;
  /** Conditional stat (Dug In). */
  dugInStat: Stat;
  dugInPct: number;
  dugInRadius: number;
  /** Stat buff after a takedown (Adrenaline). */
  killStat: Stat;
  killPct: number;
  killTicks: number;
  /** Burning ground from a cone weapon (Napalm Tank). */
  groundDps: number;
  groundTicks: number;
  groundRadius: number;
  groundEvery: number;
  bombletCount: number;
  bombletDamage: number;
  bombletRadius: number;
  bombletSpread: number;
  auraRadiusPct: number;
  auraExtraTicks: number;
  /** Tesla Rounds. */
  chainEvery: number;
  chainTargets: number;
  chainDamage: number;
  chainRadius: number;
  /** Ultimate charges stored (Overcharge: 2). */
  ultCharges: number;
  /** Airstrike Beacon. */
  bombCount: number;
  bombDamage: number;
  bombRadius: number;
  bombSpacing: number;
  bombTicks: number;
  /** Mortar Support. */
  mortarEvery: number;
  mortarDamage: number;
  mortarRadius: number;
  mortarTicks: number;
  /** Minefield. */
  mineEvery: number;
  mineDamage: number;
  mineRadius: number;
  mineMax: number;
  mineArm: number;
  mineTrigger: number;
  lastStand: boolean;
  /** Attack Drone. */
  dronePct: number;
  droneOrbit: number;
  /** War Dog (`dogHp` 0 = none). */
  dogHp: number;
  dogRadius: number;
  dogSpeed: number;
  dogBite: number;
  dogBiteTicks: number;
  dogReach: number;
  dogLeash: number;
  dogRespawn: number;
}

export function emptyMods(): PowerMods {
  return {
    shots: 0, shotSpread: 0, coneAngle: 0, coneRange: 0, burst: 0, pierce: 0, ricochetCount: 0, ricochetRadius: 0, ricochetPct: 0, critEvery: 0,
    burnDps: 0, burnTicks: 0, markPct: 0, markTicks: 0, scavengeRadius: 0, scavengePct: 0, lowHpBelow: 0, lowHpShield: 0, lowHpTicks: 0, lowHpCooldown: 0,
    dugInStat: Stat.DamageTaken, dugInPct: 0, dugInRadius: 0, killStat: Stat.MoveSpeed, killPct: 0, killTicks: 0,
    groundDps: 0, groundTicks: 0, groundRadius: 0, groundEvery: 0, bombletCount: 0, bombletDamage: 0, bombletRadius: 0, bombletSpread: 0, auraRadiusPct: 0, auraExtraTicks: 0,
    chainEvery: 0, chainTargets: 0, chainDamage: 0, chainRadius: 0, ultCharges: 1, bombCount: 0, bombDamage: 0, bombRadius: 0, bombSpacing: 0, bombTicks: 0,
    mortarEvery: 0, mortarDamage: 0, mortarRadius: 0, mortarTicks: 0, mineEvery: 0, mineDamage: 0, mineRadius: 0, mineMax: 0, mineArm: 0, mineTrigger: 0, lastStand: false,
    dronePct: 0, droneOrbit: 0, dogHp: 0, dogRadius: 0, dogSpeed: 0, dogBite: 0, dogBiteTicks: 0, dogReach: 0, dogLeash: 0, dogRespawn: 0,
  };
}

/** Rebuilds `m` from the owned stacks (in catalogue order, never by iterating `owned`). */
export function foldMods(m: PowerMods, p: Config['powers'], owned: Readonly<Record<string, number>>): PowerMods {
  Object.assign(m, emptyMods());
  for (const def of p.powers) {
    const n = owned[def.id] ?? 0;
    if (n === 0) continue;
    for (const fx of def.effects) {
      switch (fx.type) {
        case 'weaponMod':
          m.shots += fx.shots * n;
          m.shotSpread = Math.max(m.shotSpread, fx.shotSpread);
          if (fx.cone) {
            m.coneAngle += fx.cone.angle * n;
            m.coneRange += fx.cone.range * n;
          }
          m.burst += fx.burst * n;
          m.pierce += fx.pierce * n;
          if (fx.ricochet) {
            m.ricochetCount += fx.ricochet.count * n;
            m.ricochetRadius = Math.max(m.ricochetRadius, fx.ricochet.radius);
            m.ricochetPct = Math.max(m.ricochetPct, fx.ricochet.damagePct);
          }
          if (fx.critEvery > 0) m.critEvery = m.critEvery === 0 ? fx.critEvery : Math.min(m.critEvery, fx.critEvery);
          break;
        case 'onHit':
          if (fx.burn) {
            m.burnDps += fx.burn.dps * n;
            m.burnTicks = Math.max(m.burnTicks, fx.burn.seconds);
          }
          if (fx.mark) {
            m.markPct += fx.mark.pct * n;
            m.markTicks = Math.max(m.markTicks, fx.mark.seconds);
          }
          if (fx.chain) {
            m.chainEvery = fx.chain.every;
            m.chainTargets += fx.chain.targets * n;
            m.chainDamage = Math.max(m.chainDamage, fx.chain.damage);
            m.chainRadius = Math.max(m.chainRadius, fx.chain.radius);
          }
          break;
        case 'onNearbyMinionDeath':
          m.scavengePct += fx.healPct * n;
          m.scavengeRadius = Math.max(m.scavengeRadius, fx.radius);
          break;
        case 'onLowHp':
          m.lowHpShield += fx.shieldPct * n;
          m.lowHpBelow = Math.max(m.lowHpBelow, fx.belowPct);
          m.lowHpTicks = Math.max(m.lowHpTicks, fx.seconds);
          m.lowHpCooldown = Math.max(m.lowHpCooldown, fx.cooldownSeconds);
          break;
        case 'conditionalStat':
          m.dugInStat = STAT[fx.stat];
          m.dugInPct += fx.pct * n;
          m.dugInRadius = Math.max(m.dugInRadius, fx.radius);
          break;
        case 'onKill':
          m.killStat = STAT[fx.stat];
          m.killPct += fx.pct * n;
          m.killTicks = Math.max(m.killTicks, fx.seconds);
          break;
        case 'flameGround':
          m.groundDps += fx.dps * n;
          m.groundTicks = Math.max(m.groundTicks, fx.seconds);
          m.groundRadius = Math.max(m.groundRadius, fx.radius);
          m.groundEvery = m.groundEvery === 0 ? fx.everySeconds : Math.min(m.groundEvery, fx.everySeconds);
          break;
        case 'ultMod':
          if (fx.bomblets) {
            m.bombletCount += fx.bomblets.count * n;
            m.bombletDamage = Math.max(m.bombletDamage, fx.bomblets.damage);
            m.bombletRadius = Math.max(m.bombletRadius, fx.bomblets.radius);
            m.bombletSpread = Math.max(m.bombletSpread, fx.bomblets.spread);
          }
          m.auraRadiusPct += fx.radiusPct * n;
          m.auraExtraTicks += fx.extraSeconds * n;
          m.ultCharges = Math.max(m.ultCharges, fx.charges);
          if (fx.bombs) {
            m.bombCount += fx.bombs.count * n;
            m.bombDamage = Math.max(m.bombDamage, fx.bombs.damage);
            m.bombRadius = Math.max(m.bombRadius, fx.bombs.radius);
            m.bombSpacing = Math.max(m.bombSpacing, fx.bombs.spacing);
            m.bombTicks = Math.max(m.bombTicks, fx.bombs.flightSeconds);
          }
          break;
        case 'periodic':
          m.mortarEvery = fx.everySeconds;
          m.mortarDamage += fx.damage * n;
          m.mortarRadius = Math.max(m.mortarRadius, fx.radius);
          m.mortarTicks = Math.max(m.mortarTicks, fx.flightSeconds);
          break;
        case 'whileMoving':
          m.mineEvery = fx.everySeconds;
          m.mineDamage += fx.damage * n;
          m.mineRadius = Math.max(m.mineRadius, fx.radius);
          m.mineMax += fx.max * n;
          m.mineArm = Math.max(m.mineArm, fx.armSeconds);
          m.mineTrigger = Math.max(m.mineTrigger, fx.trigger);
          break;
        case 'oncePerLife':
          m.lastStand = true;
          break;
        case 'summon':
          if (fx.drone) {
            m.dronePct += fx.drone.damagePct * n;
            m.droneOrbit = Math.max(m.droneOrbit, fx.drone.orbit);
          }
          if (fx.dog) {
            Object.assign(m, {
              dogHp: fx.dog.maxHp, dogRadius: fx.dog.radius, dogSpeed: fx.dog.moveSpeed, dogBite: fx.dog.bite, dogBiteTicks: fx.dog.biteSeconds,
              dogReach: fx.dog.reach, dogLeash: fx.dog.leash, dogRespawn: fx.dog.respawnSeconds,
            });
          }
          break;
        case 'stat':
        case 'regen':
          break; // the stat model and regenSystem read these directly
      }
    }
  }
  return m;
}
