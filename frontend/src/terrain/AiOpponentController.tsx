import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from 'react';
import { BufferGeometry, Group, Line, LineBasicMaterial, Vector3 } from 'three';

import { BoxSilhouette, CylinderSilhouette } from './Silhouette';
import {
  createInitialAiOpponent,
  updateAiOpponent,
  type AiBehaviorState,
  type AiOpponentState,
} from './aiBehavior';
import { normalizeRadians } from './armorAngle';
import { evaluateProjectilePath } from './occlusion';
import { projectileMuzzlePosition } from './projectileModel';
import type { TankPose } from './tankState';
import { TACTICAL_COLORS } from './visualStyle';

type AiOpponentControllerProps = {
  aiPoseRef: MutableRefObject<TankPose>;
  missionIndex: number;
  playerPoseRef: MutableRefObject<TankPose>;
};

type AiReadoutState = AiBehaviorState & {
  missionIndex: number;
};

export function AiOpponentController({
  aiPoseRef,
  missionIndex,
  playerPoseRef,
}: AiOpponentControllerProps) {
  const groupRef = useRef<Group>(null);
  const turretRef = useRef<Group>(null);
  const elapsed = useRef(0);
  const updateTimer = useRef(0);
  const aiState = useRef<AiOpponentState>(createInitialAiOpponent(missionIndex));
  const [readout, setReadout] = useState<AiReadoutState>({
    ...aiState.current.behavior,
    missionIndex,
  });

  useFrame((_, delta) => {
    elapsed.current += delta;
    aiState.current = updateAiOpponent({
      delta,
      elapsed: elapsed.current,
      missionIndex,
      playerPose: playerPoseRef.current,
      state: aiState.current,
    });
    aiPoseRef.current = aiState.current.pose;

    if (groupRef.current) {
      groupRef.current.position.set(...aiState.current.pose.position);
      groupRef.current.rotation.y = aiState.current.pose.heading;
    }

    if (turretRef.current) {
      turretRef.current.rotation.y = normalizeRadians(
        aiState.current.pose.turretHeading - aiState.current.pose.heading,
      );
    }

    updateTimer.current += delta;
    if (updateTimer.current >= 0.18) {
      updateTimer.current = 0;
      setReadout({ ...aiState.current.behavior, missionIndex });
    }
  });

  return (
    <>
      <group
        ref={groupRef}
        position={aiState.current.pose.position}
        rotation-y={aiState.current.pose.heading}
      >
        <AiTankModel turretRef={turretRef} />
      </group>
      <AiTargetingLine aiPoseRef={aiPoseRef} playerPoseRef={playerPoseRef} />
      <AiReadout aiPoseRef={aiPoseRef} state={readout} />
    </>
  );
}

function AiTankModel({ turretRef }: { turretRef: MutableRefObject<Group | null> }) {
  return (
    <group position={[0, -0.23, 0]}>
      <BoxSilhouette args={[1.18, 0.43, 1.75]} expansion={1.08} />
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.18, 0.43, 1.75]} />
        <meshStandardMaterial color="#754c5f" flatShading roughness={0.52} metalness={0.16} />
      </mesh>
      <group ref={turretRef}>
        <BoxSilhouette args={[0.68, 0.33, 0.82]} position={[0, 0.34, 0]} expansion={1.08} />
        <mesh position={[0, 0.34, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.68, 0.33, 0.82]} />
          <meshStandardMaterial color="#9b6864" flatShading roughness={0.46} metalness={0.18} />
        </mesh>
        <CylinderSilhouette
          args={[0.075, 0.075, 1.15, 16]}
          position={[0, 0.41, -0.86]}
          rotation={[Math.PI / 2, 0, 0]}
          expansion={1.18}
        />
        <mesh position={[0, 0.41, -0.86]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.075, 0.075, 1.15, 16]} />
          <meshStandardMaterial color={TACTICAL_COLORS.ink} roughness={0.4} metalness={0.28} />
        </mesh>
      </group>
      <BoxSilhouette args={[0.18, 0.2, 1.86]} position={[-0.37, -0.27, 0]} expansion={1.08} />
      <mesh position={[-0.37, -0.27, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.18, 0.2, 1.86]} />
        <meshStandardMaterial color="#2d2630" flatShading roughness={0.64} metalness={0.14} />
      </mesh>
      <BoxSilhouette args={[0.18, 0.2, 1.86]} position={[0.37, -0.27, 0]} expansion={1.08} />
      <mesh position={[0.37, -0.27, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.18, 0.2, 1.86]} />
        <meshStandardMaterial color="#2d2630" flatShading roughness={0.64} metalness={0.14} />
      </mesh>
    </group>
  );
}

function AiTargetingLine({
  aiPoseRef,
  playerPoseRef,
}: {
  aiPoseRef: MutableRefObject<TankPose>;
  playerPoseRef: MutableRefObject<TankPose>;
}) {
  const geometry = useMemo(() => new BufferGeometry(), []);
  const material = useMemo(
    () =>
      new LineBasicMaterial({
        color: TACTICAL_COLORS.sightBlocked,
        opacity: 0.8,
        transparent: true,
      }),
    [],
  );
  const line = useMemo(() => new Line(geometry, material), [geometry, material]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    const start = projectileMuzzlePosition(aiPoseRef.current);
    const end = playerPoseRef.current.position;
    const path = evaluateProjectilePath(start, end, 0.08);

    geometry.setFromPoints([new Vector3(...start), new Vector3(...(path.hit?.point ?? end))]);
    material.color.set(path.clear ? TACTICAL_COLORS.sightClear : TACTICAL_COLORS.sightBlocked);
  });

  return <primitive object={line} />;
}

function AiReadout({
  aiPoseRef,
  state,
}: {
  aiPoseRef: MutableRefObject<TankPose>;
  state: AiReadoutState;
}) {
  return (
    <group
      position={[
        aiPoseRef.current.position[0],
        aiPoseRef.current.position[1] + 1.1,
        aiPoseRef.current.position[2],
      ]}
    >
      <Html center distanceFactor={7.5} className="ai-readout">
        <span>AI {state.tier}</span>
        <strong>Mission {state.missionIndex}</strong>
        <span>{state.mode}</span>
        <strong>{state.coverState}</strong>
        <span>Hull {state.armorAngleDegrees}°</span>
        <strong>{state.fireReady ? 'firing' : `${state.range}m`}</strong>
      </Html>
    </group>
  );
}
