import type { Config, StatName } from '../data/schema';
import { Stat } from './stats';

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
}

export function emptyMods(): PowerMods {
  return {
    shots: 0, shotSpread: 0, coneAngle: 0, coneRange: 0, burst: 0, pierce: 0, ricochetCount: 0, ricochetRadius: 0, ricochetPct: 0, critEvery: 0,
    burnDps: 0, burnTicks: 0, markPct: 0, markTicks: 0, scavengeRadius: 0, scavengePct: 0, lowHpBelow: 0, lowHpShield: 0, lowHpTicks: 0, lowHpCooldown: 0,
    dugInStat: Stat.DamageTaken, dugInPct: 0, dugInRadius: 0, killStat: Stat.MoveSpeed, killPct: 0, killTicks: 0,
    groundDps: 0, groundTicks: 0, groundRadius: 0, groundEvery: 0, bombletCount: 0, bombletDamage: 0, bombletRadius: 0, bombletSpread: 0, auraRadiusPct: 0, auraExtraTicks: 0,
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
          break;
        case 'stat':
        case 'regen':
          break; // the stat model and regenSystem read these directly
      }
    }
  }
  return m;
}
