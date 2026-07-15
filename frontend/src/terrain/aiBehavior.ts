import {
  bearingToPoint,
  calculateArmorAngle,
  normalizeRadians,
  rotateTowardAngle,
} from './armorAngle';
import { BATTLEFIELD_HALF_SIZE, terrainHeight, type Vec3 } from './battlefield';
import { evaluateProjectilePath } from './occlusion';
import { TANK_EYE_HEIGHT, type TankPose } from './tankState';

export type AiDifficultyTier = 'recruit' | 'veteran' | 'ace';

export type AiDifficultySettings = {
  aimTolerance: number;
  angleOffset: number;
  coverBias: number;
  driveSpeed: number;
  fireInterval: number;
  missionIndex: number;
  preferredRange: number;
  tier: AiDifficultyTier;
  turnSpeed: number;
  turretTurnSpeed: number;
};

export type AiBehaviorMode = 'advancing' | 'angling' | 'flanking' | 'seeking cover';

export type AiBehaviorState = {
  aimErrorDegrees: number;
  armorAngleDegrees: number;
  coverState: 'covered' | 'exposed';
  fireReady: boolean;
  mode: AiBehaviorMode;
  nextFireIn: number;
  range: number;
  tier: AiDifficultyTier;
};

export type AiOpponentState = {
  behavior: AiBehaviorState;
  fireCooldown: number;
  pose: TankPose;
  waypoint: Vec3;
};

type AiUpdateInput = {
  delta: number;
  elapsed: number;
  missionIndex: number;
  playerPose: TankPose;
  state: AiOpponentState;
};

const ARENA_MARGIN = 0.9;
const WAYPOINT_REACHED_DISTANCE = 0.22;
const COVER_MARGIN = 0.35;
const COVER_POINTS: Array<[number, number]> = [
  [-4.1, 2.85],
  [-3.15, 1.15],
  [2.45, 1.65],
  [3.75, -2.85],
  [0.35, 2.85],
];

export function getAiDifficultySettings(missionIndex: number): AiDifficultySettings {
  const boundedMission = Math.max(1, Math.floor(missionIndex));

  if (boundedMission >= 5) {
    return {
      aimTolerance: degreesToRadians(7),
      angleOffset: degreesToRadians(47),
      coverBias: 0.86,
      driveSpeed: 1.85,
      fireInterval: 1.9,
      missionIndex: boundedMission,
      preferredRange: 4.2,
      tier: 'ace',
      turnSpeed: 2.35,
      turretTurnSpeed: 3.4,
    };
  }

  if (boundedMission >= 3) {
    return {
      aimTolerance: degreesToRadians(11),
      angleOffset: degreesToRadians(42),
      coverBias: 0.72,
      driveSpeed: 1.55,
      fireInterval: 2.45,
      missionIndex: boundedMission,
      preferredRange: 4.55,
      tier: 'veteran',
      turnSpeed: 2.05,
      turretTurnSpeed: 2.8,
    };
  }

  return {
    aimTolerance: degreesToRadians(16),
    angleOffset: degreesToRadians(34),
    coverBias: 0.5,
    driveSpeed: 1.25,
    fireInterval: 3.15,
    missionIndex: boundedMission,
    preferredRange: 4.9,
    tier: 'recruit',
    turnSpeed: 1.75,
    turretTurnSpeed: 2.25,
  };
}

export function createInitialAiPose(): TankPose {
  const x = 4.75;
  const z = 2.35;
  const heading = 2.44;

  return {
    heading,
    position: [x, terrainHeight(x, z) + TANK_EYE_HEIGHT, z],
    speed: 0,
    turretHeading: heading,
  };
}

export function createInitialAiOpponent(missionIndex = 3): AiOpponentState {
  const pose = createInitialAiPose();
  const difficulty = getAiDifficultySettings(missionIndex);

  return {
    behavior: readBehaviorState(pose, pose, difficulty, 0, 'angling'),
    fireCooldown: difficulty.fireInterval * 0.55,
    pose,
    waypoint: pose.position,
  };
}

export function updateAiOpponent({
  delta,
  elapsed,
  missionIndex,
  playerPose,
  state,
}: AiUpdateInput): AiOpponentState {
  const difficulty = getAiDifficultySettings(missionIndex);
  const range = distance2d(state.pose.position, playerPose.position);
  const cover = readCoverState(state.pose, playerPose);
  const waypoint = chooseWaypoint(state, playerPose, difficulty, elapsed, range, cover);
  const mode = chooseMode(range, cover, difficulty);
  const desiredHeading = chooseHeading(state.pose, playerPose, waypoint, difficulty, mode, elapsed);
  const nextHeading = rotateTowardAngle(
    state.pose.heading,
    desiredHeading,
    difficulty.turnSpeed * delta,
  );
  const nextPosition = moveToward(state.pose.position, waypoint, difficulty.driveSpeed * delta);
  const targetTurretHeading = bearingToPoint(state.pose.position, playerPose.position);
  const nextTurretHeading = rotateTowardAngle(
    state.pose.turretHeading,
    targetTurretHeading,
    difficulty.turretTurnSpeed * delta,
  );
  const nextPose: TankPose = {
    heading: nextHeading,
    position: nextPosition,
    speed: distance2d(nextPosition, state.pose.position) / Math.max(delta, 0.001),
    turretHeading: nextTurretHeading,
  };
  const aimError = Math.abs(normalizeRadians(targetTurretHeading - nextTurretHeading));
  const lineToPlayer = evaluateProjectilePath(nextPose.position, playerPose.position, 0.08);
  const canFire =
    state.fireCooldown <= 0 &&
    lineToPlayer.clear &&
    aimError <= difficulty.aimTolerance &&
    range <= difficulty.preferredRange + 1.4;
  const nextCooldown = canFire ? difficulty.fireInterval : Math.max(0, state.fireCooldown - delta);

  return {
    behavior: readBehaviorState(nextPose, playerPose, difficulty, aimError, mode, canFire),
    fireCooldown: nextCooldown,
    pose: nextPose,
    waypoint,
  };
}

function chooseWaypoint(
  state: AiOpponentState,
  playerPose: TankPose,
  difficulty: AiDifficultySettings,
  elapsed: number,
  range: number,
  cover: 'covered' | 'exposed',
): Vec3 {
  if (
    cover === 'covered' &&
    distance2d(state.pose.position, state.waypoint) > WAYPOINT_REACHED_DISTANCE
  ) {
    return state.waypoint;
  }

  if (cover === 'exposed' && difficulty.coverBias >= 0.58) {
    return bestCoverPoint(playerPose.position, state.pose.position);
  }

  if (range > difficulty.preferredRange + 0.7) {
    return pointToward(state.pose.position, playerPose.position, 1.35);
  }

  const orbit = Math.sin(elapsed * 0.45) >= 0 ? 1 : -1;
  const bearing = bearingToPoint(playerPose.position, state.pose.position) + orbit * Math.PI * 0.42;
  const desiredRange = difficulty.preferredRange + Math.sin(elapsed * 0.7) * 0.45;

  return clampToArena([
    playerPose.position[0] + Math.sin(bearing) * desiredRange,
    0,
    playerPose.position[2] - Math.cos(bearing) * desiredRange,
  ]);
}

function chooseMode(
  range: number,
  cover: 'covered' | 'exposed',
  difficulty: AiDifficultySettings,
): AiBehaviorMode {
  if (cover === 'exposed' && difficulty.coverBias >= 0.58) {
    return 'seeking cover';
  }

  if (range > difficulty.preferredRange + 0.7) {
    return 'advancing';
  }

  if (cover === 'covered') {
    return 'angling';
  }

  return 'flanking';
}

function chooseHeading(
  pose: TankPose,
  playerPose: TankPose,
  waypoint: Vec3,
  difficulty: AiDifficultySettings,
  mode: AiBehaviorMode,
  elapsed: number,
): number {
  if (mode === 'advancing' || distance2d(pose.position, waypoint) > 0.55) {
    return bearingToPoint(pose.position, waypoint);
  }

  const threatBearing = bearingToPoint(pose.position, playerPose.position);
  const angleDirection = Math.sin(elapsed * 0.55) >= 0 ? 1 : -1;

  return normalizeRadians(threatBearing + difficulty.angleOffset * angleDirection);
}

function readBehaviorState(
  pose: TankPose,
  playerPose: TankPose,
  difficulty: AiDifficultySettings,
  aimError: number,
  mode: AiBehaviorMode,
  fireReady = false,
): AiBehaviorState {
  const armor = calculateArmorAngle({
    hullHeading: pose.heading,
    incomingFireOrigin: playerPose.position,
    tankPosition: pose.position,
    turretHeading: pose.turretHeading,
  });

  return {
    aimErrorDegrees: Math.round((aimError * 180) / Math.PI),
    armorAngleDegrees: armor.hullAngleDegrees,
    coverState: readCoverState(pose, playerPose),
    fireReady,
    mode,
    nextFireIn: difficulty.fireInterval,
    range: Math.round(distance2d(pose.position, playerPose.position) * 10) / 10,
    tier: difficulty.tier,
  };
}

function readCoverState(aiPose: TankPose, playerPose: TankPose): 'covered' | 'exposed' {
  const incoming = evaluateProjectilePath(playerPose.position, aiPose.position, 0.08);

  return !incoming.clear && incoming.hit && incoming.hit.distance < incoming.distance - COVER_MARGIN
    ? 'covered'
    : 'exposed';
}

function bestCoverPoint(playerPosition: Vec3, aiPosition: Vec3): Vec3 {
  return COVER_POINTS.map(([x, z]) => [x, terrainHeight(x, z) + TANK_EYE_HEIGHT, z] as Vec3).sort(
    (left, right) => {
      const leftCovered = readPointCover(playerPosition, left) ? 1 : 0;
      const rightCovered = readPointCover(playerPosition, right) ? 1 : 0;
      const leftScore = leftCovered * 8 - distance2d(aiPosition, left) * 0.35;
      const rightScore = rightCovered * 8 - distance2d(aiPosition, right) * 0.35;

      return rightScore - leftScore;
    },
  )[0];
}

function readPointCover(playerPosition: Vec3, point: Vec3): boolean {
  const path = evaluateProjectilePath(playerPosition, point, 0.08);

  return !path.clear && path.hit !== undefined && path.hit.distance < path.distance - COVER_MARGIN;
}

function pointToward(from: Vec3, to: Vec3, distance: number): Vec3 {
  const total = Math.max(distance2d(from, to), 0.001);
  const t = Math.min(distance / total, 1);

  return clampToArena([from[0] + (to[0] - from[0]) * t, 0, from[2] + (to[2] - from[2]) * t]);
}

function moveToward(from: Vec3, to: Vec3, step: number): Vec3 {
  const distance = distance2d(from, to);

  if (distance <= step || distance <= WAYPOINT_REACHED_DISTANCE) {
    return withTerrainHeight(to);
  }

  const t = step / distance;

  return withTerrainHeight([from[0] + (to[0] - from[0]) * t, 0, from[2] + (to[2] - from[2]) * t]);
}

function clampToArena(point: Vec3): Vec3 {
  const x = clamp(
    point[0],
    -BATTLEFIELD_HALF_SIZE + ARENA_MARGIN,
    BATTLEFIELD_HALF_SIZE - ARENA_MARGIN,
  );
  const z = clamp(
    point[2],
    -BATTLEFIELD_HALF_SIZE + ARENA_MARGIN,
    BATTLEFIELD_HALF_SIZE - ARENA_MARGIN,
  );

  return withTerrainHeight([x, 0, z]);
}

function withTerrainHeight(point: Vec3): Vec3 {
  return [point[0], terrainHeight(point[0], point[2]) + TANK_EYE_HEIGHT, point[2]];
}

function distance2d(left: Vec3, right: Vec3): number {
  return Math.hypot(left[0] - right[0], left[2] - right[2]);
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
