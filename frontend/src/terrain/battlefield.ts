import { BufferGeometry, Float32BufferAttribute } from 'three';

export type Vec3 = [number, number, number];

export const BATTLEFIELD_SIZE = 12;
export const BATTLEFIELD_HALF_SIZE = BATTLEFIELD_SIZE / 2;

export type RidgeMarker = {
  id: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
};

export type RubblePiece = {
  id: string;
  position: Vec3;
  scale: Vec3;
  rotation: Vec3;
};

export type StructurePiece = {
  id: string;
  position: Vec3;
  scale: Vec3;
};

export const RIDGE_MARKERS: RidgeMarker[] = [
  {
    id: 'west-ridge',
    position: [-2.8, 0.42, -1.6],
    rotation: [0.18, -0.45, -0.08],
    scale: [4.7, 0.42, 0.72],
    color: '#687259',
  },
  {
    id: 'east-ridge',
    position: [2.4, 0.36, 1.4],
    rotation: [-0.08, 0.68, 0.05],
    scale: [4.2, 0.36, 0.62],
    color: '#596d62',
  },
];

export function createTerrainGeometry(): BufferGeometry {
  const segments = 56;
  const size = BATTLEFIELD_SIZE;
  const half = size / 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
    const z = (zIndex / segments) * size - half;

    for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
      const x = (xIndex / segments) * size - half;
      const y = terrainHeight(x, z);

      positions.push(x, y, z);
      uvs.push(xIndex / segments, zIndex / segments);
    }
  }

  for (let zIndex = 0; zIndex < segments; zIndex += 1) {
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const a = zIndex * (segments + 1) + xIndex;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;

      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

export function terrainHeight(x: number, z: number): number {
  const ridgeA = Math.exp(-Math.abs(z + 1.6 + Math.sin(x * 0.7) * 0.5)) * 0.48;
  const ridgeB = Math.exp(-Math.abs(z - 1.4 - Math.cos(x * 0.55) * 0.6)) * 0.38;
  const brokenGround = Math.sin(x * 1.7) * Math.cos(z * 1.35) * 0.08;
  const crater = Math.exp(-(Math.pow(x + 1.2, 2) + Math.pow(z - 0.6, 2)) / 1.4) * -0.42;

  return ridgeA + ridgeB + brokenGround + crater - 0.1;
}

export function createRubblePieces(): RubblePiece[] {
  return [
    [-3.8, -0.7, 0.7, 0.8, 0.5, 1.2, 0.1],
    [-3.2, -0.1, 1.1, 0.5, 0.8, 0.7, 0.6],
    [-2.5, 0.4, 0.8, 0.7, 0.7, 0.5, 1.1],
    [1.8, -0.6, 0.9, 0.9, 0.45, 0.6, 0.3],
    [2.5, 0.15, 1.4, 0.55, 0.7, 0.9, 0.9],
    [3.1, 0.8, 0.8, 0.7, 0.5, 0.6, 1.5],
    [0.4, 2.9, 0.7, 0.8, 0.45, 0.8, 0.2],
    [-0.5, 3.4, 1.0, 0.5, 0.6, 0.7, 1.3],
  ].map(([x, z, sx, sy, sz, ry, rz], index) => ({
    id: `rubble-${index + 1}`,
    position: [x, terrainHeight(x, z) + 0.18, z],
    scale: [sx, sy, sz],
    rotation: [0.4, ry, rz],
  }));
}

export function createStructures(): StructurePiece[] {
  return [
    {
      id: 'northwest-wall',
      position: [-4.6, terrainHeight(-4.6, 2.6) + 0.28, 2.6],
      scale: [1.7, 0.55, 0.42],
    },
    {
      id: 'northwest-pillar',
      position: [-3.7, terrainHeight(-3.7, 3.05) + 0.5, 3.05],
      scale: [0.46, 1, 0.46],
    },
    {
      id: 'southeast-wall',
      position: [4.15, terrainHeight(4.15, -2.8) + 0.26, -2.8],
      scale: [1.45, 0.5, 0.5],
    },
    {
      id: 'southeast-pillar',
      position: [3.3, terrainHeight(3.3, -3.1) + 0.44, -3.1],
      scale: [0.4, 0.88, 0.4],
    },
  ];
}
