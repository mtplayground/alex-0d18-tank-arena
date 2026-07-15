import type { Vec3 } from './battlefield';

export type ArmorFacing = 'front' | 'angled' | 'side' | 'rear';

export type ArmorAngleReading = {
  hullAngleDegrees: number;
  hullFacing: ArmorFacing;
  turretAngleDegrees: number;
  turretFacing: ArmorFacing;
  threatBearingDegrees: number;
};

type ArmorAngleInput = {
  hullHeading: number;
  incomingFireOrigin: Vec3;
  tankPosition: Vec3;
  turretHeading: number;
};

export function calculateArmorAngle({
  hullHeading,
  incomingFireOrigin,
  tankPosition,
  turretHeading,
}: ArmorAngleInput): ArmorAngleReading {
  const threatBearing = bearingToPoint(tankPosition, incomingFireOrigin);
  const hullAngleDegrees = Math.round(
    radiansToDegrees(absoluteAngleDifference(hullHeading, threatBearing)),
  );
  const turretAngleDegrees = Math.round(
    radiansToDegrees(absoluteAngleDifference(turretHeading, threatBearing)),
  );

  return {
    hullAngleDegrees,
    hullFacing: classifyArmorFacing(hullAngleDegrees),
    turretAngleDegrees,
    turretFacing: classifyArmorFacing(turretAngleDegrees),
    threatBearingDegrees: Math.round(radiansToDegrees(normalizeRadians(threatBearing))),
  };
}

export function bearingToPoint(from: Vec3, to: Vec3): number {
  return Math.atan2(to[0] - from[0], -(to[2] - from[2]));
}

export function normalizeRadians(value: number): number {
  let nextValue = value;

  while (nextValue <= -Math.PI) {
    nextValue += Math.PI * 2;
  }

  while (nextValue > Math.PI) {
    nextValue -= Math.PI * 2;
  }

  return nextValue;
}

export function rotateTowardAngle(current: number, target: number, maxStep: number): number {
  const delta = normalizeRadians(target - current);

  if (Math.abs(delta) <= maxStep) {
    return target;
  }

  return normalizeRadians(current + Math.sign(delta) * maxStep);
}

function absoluteAngleDifference(left: number, right: number): number {
  return Math.abs(normalizeRadians(right - left));
}

function classifyArmorFacing(angleDegrees: number): ArmorFacing {
  if (angleDegrees <= 30) {
    return 'front';
  }

  if (angleDegrees <= 65) {
    return 'angled';
  }

  if (angleDegrees <= 115) {
    return 'side';
  }

  return 'rear';
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}
