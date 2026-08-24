import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';

import { CameraRig } from '../terrain/CameraRig';
import { TankVisual } from '../terrain/TankVisual';
import { createInitialTankPose, type TankPose } from '../terrain/tankState';
import { useAssetManifest } from '../terrain/useAssetManifest';
import { ArenaEnvironment } from './ArenaEnvironment';

const ignoreAssetUnavailable = () => undefined;

export function ScenePreview() {
  const assetManifest = useAssetManifest();

  return (
    <Canvas shadows className="scene-preview" camera={{ position: [5.6, 4.6, 6.4], fov: 46 }}>
      <BattlefieldScene assetManifest={assetManifest} />
    </Canvas>
  );
}

function BattlefieldScene({
  assetManifest,
}: {
  assetManifest: ReturnType<typeof useAssetManifest>;
}) {
  const tankPoseRef = useRef<TankPose>(createInitialTankPose());

  return (
    <>
      <ArenaEnvironment assetManifest={assetManifest} onAssetUnavailable={ignoreAssetUnavailable} />
      <group position={tankPoseRef.current.position} rotation-y={tankPoseRef.current.heading}>
        <TankVisual />
      </group>
      <CameraRig poseRef={tankPoseRef} />
    </>
  );
}
