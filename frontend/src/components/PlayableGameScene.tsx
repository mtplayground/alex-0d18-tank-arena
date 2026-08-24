import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';

import { CameraRig } from '../terrain/CameraRig';
import { TankMovementController } from '../terrain/TankMovementController';
import { createInitialTankPose, type TankPose } from '../terrain/tankState';
import { ArenaEnvironment } from './ArenaEnvironment';

export function PlayableGameScene() {
  return (
    <Canvas shadows className="scene-preview" camera={{ position: [5.6, 4.6, 6.4], fov: 46 }}>
      <PlayableBattlefield />
    </Canvas>
  );
}

function PlayableBattlefield() {
  const tankPoseRef = useRef<TankPose>(createInitialTankPose());

  return (
    <>
      <ArenaEnvironment />
      <TankMovementController poseRef={tankPoseRef} />
      <CameraRig poseRef={tankPoseRef} />
    </>
  );
}
