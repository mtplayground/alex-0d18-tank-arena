import { useFrame, useThree } from '@react-three/fiber';
import { type MutableRefObject, useMemo } from 'react';
import { Vector3 } from 'three';

import { DEFAULT_SIGHT_END, hasLineOfSight } from './occlusion';
import type { TankPose } from './tankState';

type CameraRigProps = {
  poseRef: MutableRefObject<TankPose>;
};

const FOLLOW_OFFSET = new Vector3(4.8, 4.3, 5.8);
const BLOCKED_SIGHT_OFFSET = new Vector3(0.8, 0.75, 0.5);
const BASE_TARGET_LIFT = 0.28;

export function CameraRig({ poseRef }: CameraRigProps) {
  const camera = useThree((state) => state.camera);
  const lookAt = useMemo(() => new Vector3(), []);
  const desiredPosition = useMemo(() => new Vector3(), []);

  useFrame((_, delta) => {
    const pose = poseRef.current;
    const tankPosition = new Vector3(...pose.position);
    const readableSightline = hasLineOfSight(
      [pose.position[0], pose.position[1] + 0.1, pose.position[2]],
      DEFAULT_SIGHT_END,
      { projectileRadius: 0.08 },
    );
    const blockedOffset = readableSightline ? new Vector3(0, 0, 0) : BLOCKED_SIGHT_OFFSET;
    const forwardBias = new Vector3(
      Math.sin(pose.heading),
      0,
      -Math.cos(pose.heading),
    ).multiplyScalar(0.95);

    lookAt
      .copy(tankPosition)
      .add(forwardBias)
      .lerp(new Vector3(...DEFAULT_SIGHT_END), readableSightline ? 0.12 : 0.22);
    lookAt.y = Math.max(lookAt.y + BASE_TARGET_LIFT, 0.55);

    desiredPosition.copy(tankPosition).add(FOLLOW_OFFSET).add(blockedOffset);
    desiredPosition.y = Math.max(desiredPosition.y, 3.4);

    const smoothing = 1 - Math.exp(-delta * 4.6);
    camera.position.lerp(desiredPosition, smoothing);
    camera.lookAt(lookAt);
  });

  return null;
}
