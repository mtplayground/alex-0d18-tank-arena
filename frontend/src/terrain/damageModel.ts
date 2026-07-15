import type { ArmorAngleReading, ArmorFacing } from './armorAngle';

export type DamageOutcome = 'clean hit' | 'reduced' | 'glancing' | 'deflected';

export type DamageMitigation = {
  armorAngleDegrees: number;
  baseDamage: number;
  finalDamage: number;
  mitigationPercent: number;
  outcome: DamageOutcome;
  ruleLabel: string;
};

export const BASE_SHELL_DAMAGE = 100;

export function calculateDamageMitigation(
  armor: ArmorAngleReading,
  baseDamage = BASE_SHELL_DAMAGE,
): DamageMitigation {
  const mitigationPercent = mitigationForFacing(armor.hullFacing, armor.hullAngleDegrees);
  const outcome = outcomeForMitigation(armor.hullFacing, armor.hullAngleDegrees, mitigationPercent);
  const finalDamage =
    outcome === 'deflected'
      ? 0
      : Math.max(0, Math.round(baseDamage * (1 - mitigationPercent / 100)));

  return {
    armorAngleDegrees: armor.hullAngleDegrees,
    baseDamage,
    finalDamage,
    mitigationPercent: outcome === 'deflected' ? 100 : Math.round(mitigationPercent),
    outcome,
    ruleLabel: labelForOutcome(outcome),
  };
}

function mitigationForFacing(facing: ArmorFacing, angleDegrees: number): number {
  switch (facing) {
    case 'front':
      return interpolate(angleDegrees, 0, 30, 12, 28);
    case 'angled':
      if (angleDegrees >= 58) {
        return 100;
      }
      return interpolate(angleDegrees, 31, 57, 36, 64);
    case 'side':
      return interpolate(Math.abs(angleDegrees - 90), 0, 25, 6, 18);
    case 'rear':
      return 0;
  }
}

function outcomeForMitigation(
  facing: ArmorFacing,
  angleDegrees: number,
  mitigationPercent: number,
): DamageOutcome {
  if (facing === 'angled' && angleDegrees >= 58) {
    return 'deflected';
  }

  if (mitigationPercent >= 45) {
    return 'glancing';
  }

  if (mitigationPercent >= 15) {
    return 'reduced';
  }

  return 'clean hit';
}

function labelForOutcome(outcome: DamageOutcome): string {
  switch (outcome) {
    case 'deflected':
      return 'No damage';
    case 'glancing':
      return 'Glancing';
    case 'reduced':
      return 'Reduced';
    case 'clean hit':
      return 'Clean';
  }
}

function interpolate(
  value: number,
  inputMin: number,
  inputMax: number,
  outputMin: number,
  outputMax: number,
): number {
  const t = Math.min(Math.max((value - inputMin) / (inputMax - inputMin), 0), 1);
  return outputMin + (outputMax - outputMin) * t;
}
