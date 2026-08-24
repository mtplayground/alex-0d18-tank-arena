import type { MutableRefObject } from 'react';
import type { Group } from 'three';

import { BoxSilhouette, CylinderSilhouette } from './Silhouette';
import { TACTICAL_COLORS } from './visualStyle';

type TankVisualProps = {
  turretRef?: MutableRefObject<Group | null>;
};

export function TankVisual({ turretRef }: TankVisualProps) {
  return (
    <group position={[0, -0.23, 0]}>
      <BoxSilhouette args={[1.2, 0.45, 1.8]} />
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.45, 1.8]} />
        <meshStandardMaterial
          color={TACTICAL_COLORS.tankBase}
          flatShading
          roughness={0.5}
          metalness={0.14}
        />
      </mesh>
      <group ref={turretRef}>
        <BoxSilhouette args={[0.7, 0.35, 0.85]} position={[0, 0.35, 0]} expansion={1.075} />
        <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.7, 0.35, 0.85]} />
          <meshStandardMaterial
            color={TACTICAL_COLORS.tankTop}
            flatShading
            roughness={0.45}
            metalness={0.18}
          />
        </mesh>
        <CylinderSilhouette
          args={[0.08, 0.08, 1.2, 16]}
          position={[0, 0.42, -0.9]}
          rotation={[Math.PI / 2, 0, 0]}
          expansion={1.18}
        />
        <mesh position={[0, 0.42, -0.9]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 1.2, 16]} />
          <meshStandardMaterial color={TACTICAL_COLORS.ink} roughness={0.4} metalness={0.28} />
        </mesh>
      </group>
      <BoxSilhouette args={[0.18, 0.2, 1.9]} position={[-0.38, -0.27, 0]} expansion={1.08} />
      <mesh position={[-0.38, -0.27, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.18, 0.2, 1.9]} />
        <meshStandardMaterial
          color={TACTICAL_COLORS.tankTrack}
          flatShading
          roughness={0.65}
          metalness={0.15}
        />
      </mesh>
      <BoxSilhouette args={[0.18, 0.2, 1.9]} position={[0.38, -0.27, 0]} expansion={1.08} />
      <mesh position={[0.38, -0.27, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.18, 0.2, 1.9]} />
        <meshStandardMaterial
          color={TACTICAL_COLORS.tankTrack}
          flatShading
          roughness={0.65}
          metalness={0.15}
        />
      </mesh>
    </group>
  );
}
