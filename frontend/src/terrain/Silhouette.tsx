import { BackSide } from 'three';

import type { Vec3 } from './battlefield';
import { TACTICAL_COLORS } from './visualStyle';

type BoxSilhouetteProps = {
  args: Vec3;
  expansion?: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
};

type CylinderSilhouetteProps = {
  args: [number, number, number, number];
  expansion?: number;
  position?: Vec3;
  rotation?: Vec3;
};

type DodecahedronSilhouetteProps = {
  expansion?: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
};

export function BoxSilhouette({
  args,
  expansion = 1.055,
  position,
  rotation,
  scale = [1, 1, 1],
}: BoxSilhouetteProps) {
  return (
    <mesh
      position={position}
      rotation={rotation}
      scale={expandScale(scale, expansion)}
      renderOrder={-1}
    >
      <boxGeometry args={args} />
      <meshBasicMaterial color={TACTICAL_COLORS.ink} side={BackSide} />
    </mesh>
  );
}

export function CylinderSilhouette({
  args,
  expansion = 1.08,
  position,
  rotation,
}: CylinderSilhouetteProps) {
  return (
    <mesh
      position={position}
      rotation={rotation}
      scale={[expansion, expansion, expansion]}
      renderOrder={-1}
    >
      <cylinderGeometry args={args} />
      <meshBasicMaterial color={TACTICAL_COLORS.ink} side={BackSide} />
    </mesh>
  );
}

export function DodecahedronSilhouette({
  expansion = 1.09,
  position,
  rotation,
  scale = [1, 1, 1],
}: DodecahedronSilhouetteProps) {
  return (
    <mesh
      position={position}
      rotation={rotation}
      scale={expandScale(scale, expansion)}
      renderOrder={-1}
    >
      <dodecahedronGeometry args={[0.18, 0]} />
      <meshBasicMaterial color={TACTICAL_COLORS.ink} side={BackSide} />
    </mesh>
  );
}

function expandScale(scale: Vec3, expansion: number): Vec3 {
  return [scale[0] * expansion, scale[1] * expansion, scale[2] * expansion];
}
