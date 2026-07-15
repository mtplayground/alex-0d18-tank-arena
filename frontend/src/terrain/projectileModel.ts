import { bearingToPoint, calculateArmorAngle } from './armorAngle';
import type { Vec3 } from './battlefield';
import { BASE_SHELL_DAMAGE, calculateDamageMitigation, type DamageMitigation } from './damageModel';
import { DEFAULT_SIGHT_END, evaluateProjectilePath, type CoverHit } from './occlusion';
import type { TankPose } from './tankState';

export type ProjectileResolution =
  | {
      impactPoint: Vec3;
      kind: 'blocked';
      blocker: CoverHit;
    }
  | {
      damage: DamageMitigation;
      impactPoint: Vec3;
      kind: 'target-hit';
    };

export function resolveProjectileShot(pose: TankPose, targetPose?: TankPose): ProjectileResolution {
  const start = projectileMuzzlePosition(pose);
  const targetPosition = targetPose?.position ?? DEFAULT_SIGHT_END;
  const path = evaluateProjectilePath(start, targetPosition, 0.08);

  if (!path.clear && path.hit && path.hit.distance < path.distance - 0.35) {
    return {
      impactPoint: path.hit.point,
      kind: 'blocked',
      blocker: path.hit,
    };
  }

  const targetHeading = targetPose?.heading ?? bearingToPoint(DEFAULT_SIGHT_END, pose.position);
  const targetTurretHeading = targetPose?.turretHeading ?? targetHeading;
  const armor = calculateArmorAngle({
    hullHeading: targetHeading,
    incomingFireOrigin: pose.position,
    tankPosition: targetPosition,
    turretHeading: targetTurretHeading,
  });

  return {
    damage: calculateDamageMitigation(armor, BASE_SHELL_DAMAGE),
    impactPoint: targetPosition,
    kind: 'target-hit',
  };
}

export function projectileMuzzlePosition({ position, turretHeading }: TankPose): Vec3 {
  const forward = headingToForward(turretHeading);

  return [position[0] + forward[0] * 1.24, position[1] + 0.08, position[2] + forward[1] * 1.24];
}

function headingToForward(heading: number): [number, number] {
  return [Math.sin(heading), -Math.cos(heading)];
}
