import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';

import { CameraRig } from '../terrain/CameraRig';
import { TankMovementController } from '../terrain/TankMovementController';
import { TerrainRenderer } from '../terrain/TerrainRenderer';
import { createInitialTankPose, type TankPose } from '../terrain/tankState';

export function ScenePreview() {
  return (
    <Canvas shadows className="scene-preview" camera={{ position: [5.6, 4.6, 6.4], fov: 46 }}>
      <BattlefieldScene />
    </Canvas>
  );
}

function BattlefieldScene() {
  const tankPoseRef = useRef<TankPose>(createInitialTankPose());

  return (
    <>
      <color attach="background" args={['#dce5e7']} />
      <fog attach="fog" args={['#dce5e7', 9, 18]} />
      <ambientLight intensity={0.48} />
      <directionalLight
        castShadow
        intensity={2}
        position={[4.5, 7, 3.5]}
        shadow-mapSize-height={1024}
        shadow-mapSize-width={1024}
      />
      <TerrainRenderer />
      <TankMovementController poseRef={tankPoseRef} />
      <CameraRig poseRef={tankPoseRef} />
    </>
  );
}
