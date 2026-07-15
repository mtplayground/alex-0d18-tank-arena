import {
  RIDGE_MARKERS,
  createRubblePieces,
  createStructures,
  terrainHeight,
  type Vec3,
} from './battlefield';

export type { Vec3 } from './battlefield';

export type CoverBlockerKind = 'terrain' | 'ridge' | 'rubble' | 'structure';

export type CoverHit = {
  kind: CoverBlockerKind;
  id: string;
  point: Vec3;
  distance: number;
};

export type LineOfSightResult = {
  clear: boolean;
  start: Vec3;
  end: Vec3;
  distance: number;
  hit?: CoverHit;
};

export type LineOfSightOptions = {
  terrainSamples?: number;
  terrainClearance?: number;
  projectileRadius?: number;
};

type BoxObstacle = {
  type: 'box';
  kind: Extract<CoverBlockerKind, 'ridge' | 'structure'>;
  id: string;
  center: Vec3;
  halfExtents: Vec3;
};

type SphereObstacle = {
  type: 'sphere';
  kind: Extract<CoverBlockerKind, 'rubble'>;
  id: string;
  center: Vec3;
  radius: number;
};

type CoverObstacle = BoxObstacle | SphereObstacle;

export const DEFAULT_SIGHT_START: Vec3 = [-4.9, terrainHeight(-4.9, -2.35) + 0.72, -2.35];
export const DEFAULT_SIGHT_END: Vec3 = [4.75, terrainHeight(4.75, 2.35) + 0.72, 2.35];

export function hasLineOfSight(start: Vec3, end: Vec3, options: LineOfSightOptions = {}): boolean {
  return lineOfSight(start, end, options).clear;
}

export function evaluateProjectilePath(start: Vec3, end: Vec3, radius = 0.08): LineOfSightResult {
  return lineOfSight(start, end, { projectileRadius: radius });
}

export function lineOfSight(
  start: Vec3,
  end: Vec3,
  options: LineOfSightOptions = {},
): LineOfSightResult {
  const direction = subtract(end, start);
  const distance = length(direction);

  if (distance === 0) {
    return { clear: true, start, end, distance: 0 };
  }

  const terrainHit = traceTerrain(start, end, distance, options);
  const obstacleHit = traceObstacles(start, direction, distance, options.projectileRadius ?? 0);
  const hit = closestHit(terrainHit, obstacleHit);

  return {
    clear: hit === undefined,
    start,
    end,
    distance,
    hit,
  };
}

function traceTerrain(
  start: Vec3,
  end: Vec3,
  distance: number,
  { terrainSamples = 96, terrainClearance = 0, projectileRadius = 0 }: LineOfSightOptions,
): CoverHit | undefined {
  const clearance = terrainClearance + projectileRadius;

  for (let index = 1; index < terrainSamples; index += 1) {
    const t = index / terrainSamples;
    const point = lerp(start, end, t);
    const blockingHeight = terrainHeight(point[0], point[2]) + clearance;

    if (blockingHeight >= point[1]) {
      return {
        kind: 'terrain',
        id: 'terrain-surface',
        point: [point[0], blockingHeight, point[2]],
        distance: distance * t,
      };
    }
  }

  return undefined;
}

function traceObstacles(
  start: Vec3,
  direction: Vec3,
  distance: number,
  projectileRadius: number,
): CoverHit | undefined {
  return buildCoverObstacles(projectileRadius)
    .map((obstacle) => traceObstacle(start, direction, distance, obstacle))
    .filter((hit): hit is CoverHit => hit !== undefined)
    .sort((left, right) => left.distance - right.distance)[0];
}

function buildCoverObstacles(projectileRadius: number): CoverObstacle[] {
  const structures = createStructures().map<BoxObstacle>((structure) => ({
    type: 'box',
    kind: 'structure',
    id: structure.id,
    center: structure.position,
    halfExtents: inflateHalfExtents(
      [structure.scale[0] / 2, structure.scale[1] / 2, structure.scale[2] / 2],
      projectileRadius,
    ),
  }));

  const ridges = RIDGE_MARKERS.map<BoxObstacle>((ridge) => ({
    type: 'box',
    kind: 'ridge',
    id: ridge.id,
    center: ridge.position,
    halfExtents: inflateHalfExtents(
      [ridge.scale[0] / 2, ridge.scale[1] / 2, ridge.scale[2] / 2],
      projectileRadius,
    ),
  }));

  const rubble = createRubblePieces().map<SphereObstacle>((piece) => ({
    type: 'sphere',
    kind: 'rubble',
    id: piece.id,
    center: piece.position,
    radius: Math.max(...piece.scale) * 0.18 + projectileRadius,
  }));

  return [...structures, ...ridges, ...rubble];
}

function traceObstacle(
  start: Vec3,
  direction: Vec3,
  distance: number,
  obstacle: CoverObstacle,
): CoverHit | undefined {
  const t =
    obstacle.type === 'box'
      ? rayBoxIntersection(start, direction, obstacle.center, obstacle.halfExtents)
      : raySphereIntersection(start, direction, obstacle.center, obstacle.radius);

  if (t === undefined || t < 0 || t > 1) {
    return undefined;
  }

  return {
    kind: obstacle.kind,
    id: obstacle.id,
    point: add(start, multiply(direction, t)),
    distance: distance * t,
  };
}

function rayBoxIntersection(
  start: Vec3,
  direction: Vec3,
  center: Vec3,
  halfExtents: Vec3,
): number | undefined {
  let tMin = 0;
  let tMax = 1;

  for (let axis = 0; axis < 3; axis += 1) {
    const min = center[axis] - halfExtents[axis];
    const max = center[axis] + halfExtents[axis];
    const origin = start[axis];
    const delta = direction[axis];

    if (Math.abs(delta) < 1e-7) {
      if (origin < min || origin > max) {
        return undefined;
      }
      continue;
    }

    const inverseDelta = 1 / delta;
    let near = (min - origin) * inverseDelta;
    let far = (max - origin) * inverseDelta;

    if (near > far) {
      [near, far] = [far, near];
    }

    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);

    if (tMin > tMax) {
      return undefined;
    }
  }

  return tMin;
}

function raySphereIntersection(
  start: Vec3,
  direction: Vec3,
  center: Vec3,
  radius: number,
): number | undefined {
  const offset = subtract(start, center);
  const a = dot(direction, direction);
  const b = 2 * dot(offset, direction);
  const c = dot(offset, offset) - radius * radius;
  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) {
    return undefined;
  }

  const root = Math.sqrt(discriminant);
  const near = (-b - root) / (2 * a);
  const far = (-b + root) / (2 * a);

  if (near >= 0 && near <= 1) {
    return near;
  }

  if (far >= 0 && far <= 1) {
    return far;
  }

  return undefined;
}

function closestHit(...hits: Array<CoverHit | undefined>): CoverHit | undefined {
  return hits
    .filter((hit): hit is CoverHit => hit !== undefined)
    .sort((left, right) => left.distance - right.distance)[0];
}

function inflateHalfExtents(halfExtents: Vec3, amount: number): Vec3 {
  return [halfExtents[0] + amount, halfExtents[1] + amount, halfExtents[2] + amount];
}

function lerp(start: Vec3, end: Vec3, t: number): Vec3 {
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
    start[2] + (end[2] - start[2]) * t,
  ];
}

function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function multiply(value: Vec3, scalar: number): Vec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function length(value: Vec3): number {
  return Math.sqrt(dot(value, value));
}
