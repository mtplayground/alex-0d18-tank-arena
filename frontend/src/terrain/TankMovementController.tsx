import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BufferGeometry, Group, Line, LineBasicMaterial, Mesh, Vector3 } from 'three';

import { AiOpponentController } from './AiOpponentController';
import { CombatHud } from './CombatHud';
import { MissionPanel } from './MissionPanel';
import { MissionResultsScreen, MissionSelectScreen } from './MissionScreens';
import { ProjectileSystem } from './ProjectileSystem';
import { BoxSilhouette, CylinderSilhouette } from './Silhouette';
import { createInitialAiPose } from './aiBehavior';
import {
  bearingToPoint,
  calculateArmorAngle,
  normalizeRadians,
  rotateTowardAngle,
  type ArmorAngleReading,
} from './armorAngle';
import { BATTLEFIELD_HALF_SIZE, terrainHeight, type Vec3 } from './battlefield';
import { BASE_SHELL_DAMAGE, calculateDamageMitigation, type DamageMitigation } from './damageModel';
import { DEFAULT_SIGHT_END, evaluateProjectilePath } from './occlusion';
import { projectileMuzzlePosition, type ProjectileResolution } from './projectileModel';
import { TANK_EYE_HEIGHT, createInitialTankPose, type TankPose } from './tankState';
import { useMissionRunner } from './missionRunner';
import { TACTICAL_COLORS } from './visualStyle';

type TankMovementControllerProps = {
  poseRef: MutableRefObject<TankPose>;
};

type DriveInput = {
  forward: boolean;
  reverse: boolean;
  left: boolean;
  right: boolean;
};

const DRIVE_SPEED = 2.35;
const REVERSE_SPEED = 1.35;
const TURN_SPEED = 1.85;
const TURRET_TURN_SPEED = 2.8;
const TERRAIN_MARGIN = 0.85;

export function TankMovementController({ poseRef }: TankMovementControllerProps) {
  const groupRef = useRef<Group>(null);
  const turretRef = useRef<Group>(null);
  const driveInput = useKeyboardDrive();
  const tankPose = useRef(createInitialTankPose());
  const aiPoseRef = useRef<TankPose>(createInitialAiPose());
  const missionRunner = useMissionRunner();
  const [lastResolution, setLastResolution] = useState<ProjectileResolution | null>(null);
  const {
    activeMission,
    applyResolution,
    continueFromResults,
    missionChoices,
    result,
    retryMission,
    screen,
    sequence,
    startMission,
    status,
    syncStatus,
    targetIntegrity,
  } = missionRunner;
  const handleProjectileResolution = useCallback(
    (resolution: ProjectileResolution) => {
      setLastResolution(resolution);
      applyResolution(resolution);
    },
    [applyResolution],
  );

  useEffect(() => {
    setLastResolution(null);
    aiPoseRef.current = createInitialAiPose();
  }, [activeMission.id]);

  useFrame((_, delta) => {
    const nextPose = integrateTankPose(tankPose.current, driveInput.current, delta);
    tankPose.current = nextPose;
    poseRef.current = nextPose;

    if (groupRef.current) {
      groupRef.current.position.set(...nextPose.position);
      groupRef.current.rotation.y = nextPose.heading;
    }

    if (turretRef.current) {
      turretRef.current.rotation.y = normalizeRadians(nextPose.turretHeading - nextPose.heading);
    }
  });

  return (
    <>
      <group
        ref={groupRef}
        position={tankPose.current.position}
        rotation-y={tankPose.current.heading}
      >
        <TankModel turretRef={turretRef} />
      </group>
      <TankSightline poseRef={poseRef} targetPoseRef={aiPoseRef} />
      <AiOpponentController
        key={activeMission.id}
        aiPoseRef={aiPoseRef}
        missionIndex={activeMission.aiMissionIndex}
        playerPoseRef={poseRef}
      />
      <ProjectileSystem
        disabled={screen !== 'combat'}
        onResolution={handleProjectileResolution}
        poseRef={poseRef}
        targetPoseRef={aiPoseRef}
      />
      <ArmorAngleReadout poseRef={poseRef} targetPoseRef={aiPoseRef} />
      <CombatHud
        health={targetIntegrity}
        lastResolution={lastResolution}
        poseRef={poseRef}
        targetPoseRef={aiPoseRef}
      />
      {screen === 'combat' ? (
        <MissionPanel
          mission={activeMission}
          sequence={sequence}
          status={status}
          syncStatus={syncStatus}
        />
      ) : null}
      {screen === 'select' ? (
        <MissionSelectScreen
          missions={missionChoices}
          onStartMission={startMission}
          syncStatus={syncStatus}
        />
      ) : null}
      {screen === 'results' && result ? (
        <MissionResultsScreen
          onContinue={continueFromResults}
          onRetry={retryMission}
          result={result}
          syncStatus={syncStatus}
        />
      ) : null}
    </>
  );
}

function TankModel({ turretRef }: { turretRef: MutableRefObject<Group | null> }) {
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

function TankSightline({
  poseRef,
  targetPoseRef,
}: TankMovementControllerProps & { targetPoseRef?: MutableRefObject<TankPose> }) {
  const hitMarkerRef = useRef<Mesh>(null);
  const geometry = useMemo(() => new BufferGeometry(), []);
  const material = useMemo(
    () =>
      new LineBasicMaterial({
        color: TACTICAL_COLORS.sightClear,
        transparent: true,
        opacity: 1,
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
    const pose = poseRef.current;
    const targetPosition = targetPoseRef?.current.position ?? DEFAULT_SIGHT_END;
    const muzzle = projectileMuzzlePosition(pose);
    const result = evaluateProjectilePath(muzzle, targetPosition, 0.08);
    const end = result.hit?.point ?? targetPosition;

    geometry.setFromPoints([new Vector3(...muzzle), new Vector3(...end)]);
    material.color.set(result.clear ? TACTICAL_COLORS.sightClear : TACTICAL_COLORS.sightBlocked);

    if (hitMarkerRef.current) {
      hitMarkerRef.current.visible = !result.clear && result.hit !== undefined;
      if (result.hit) {
        hitMarkerRef.current.position.set(...result.hit.point);
      }
    }
  });

  return (
    <>
      <primitive object={line} />
      <mesh ref={hitMarkerRef} visible={false}>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshStandardMaterial
          color={TACTICAL_COLORS.sightBlocked}
          emissive={TACTICAL_COLORS.sightBlocked}
          emissiveIntensity={0.45}
        />
      </mesh>
    </>
  );
}

function ArmorAngleReadout({
  poseRef,
  targetPoseRef,
}: TankMovementControllerProps & { targetPoseRef?: MutableRefObject<TankPose> }) {
  const groupRef = useRef<Group>(null);
  const updateTimer = useRef(0);
  const [reading, setReading] = useState(() =>
    readArmorState(poseRef.current, targetPoseRef?.current),
  );

  useFrame((_, delta) => {
    const pose = poseRef.current;

    if (groupRef.current) {
      groupRef.current.position.set(pose.position[0], pose.position[1] + 1.05, pose.position[2]);
    }

    updateTimer.current += delta;
    if (updateTimer.current >= 0.12) {
      updateTimer.current = 0;
      setReading(readArmorState(pose, targetPoseRef?.current));
    }
  });

  return (
    <group ref={groupRef} position={poseRef.current.position}>
      <Html center distanceFactor={7.5} className="armor-angle-readout">
        <span>Hull {reading.armor.hullAngleDegrees}°</span>
        <strong>{reading.armor.hullFacing}</strong>
        <span>Turret {reading.armor.turretAngleDegrees}°</span>
        <strong>{reading.armor.turretFacing}</strong>
        <span>Damage {reading.damage.finalDamage}</span>
        <strong>{reading.damage.ruleLabel}</strong>
        <span>Mitigation {reading.damage.mitigationPercent}%</span>
        <strong>{reading.damage.outcome}</strong>
      </Html>
    </group>
  );
}

function useKeyboardDrive() {
  const input = useRef<DriveInput>({
    forward: false,
    reverse: false,
    left: false,
    right: false,
  });

  useEffect(() => {
    const update = (event: KeyboardEvent, pressed: boolean) => {
      if (event.repeat && pressed) {
        return;
      }

      switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
          input.current.forward = pressed;
          break;
        case 'KeyS':
        case 'ArrowDown':
          input.current.reverse = pressed;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          input.current.left = pressed;
          break;
        case 'KeyD':
        case 'ArrowRight':
          input.current.right = pressed;
          break;
        default:
          return;
      }

      event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent) => update(event, true);
    const onKeyUp = (event: KeyboardEvent) => update(event, false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return input;
}

function integrateTankPose(pose: TankPose, input: DriveInput, delta: number): TankPose {
  const throttle = Number(input.forward) - Number(input.reverse);
  const turn = Number(input.left) - Number(input.right);
  const speed = throttle >= 0 ? throttle * DRIVE_SPEED : throttle * REVERSE_SPEED;
  const heading = pose.heading + turn * TURN_SPEED * delta * (throttle === 0 ? 0.72 : 1);
  const forward = headingToForward(heading);
  const nextX = clamp(
    pose.position[0] + forward[0] * speed * delta,
    -BATTLEFIELD_HALF_SIZE + TERRAIN_MARGIN,
    BATTLEFIELD_HALF_SIZE - TERRAIN_MARGIN,
  );
  const nextZ = clamp(
    pose.position[2] + forward[1] * speed * delta,
    -BATTLEFIELD_HALF_SIZE + TERRAIN_MARGIN,
    BATTLEFIELD_HALF_SIZE - TERRAIN_MARGIN,
  );

  const position: Vec3 = [nextX, terrainHeight(nextX, nextZ) + TANK_EYE_HEIGHT, nextZ];
  const targetTurretHeading = bearingToPoint(position, DEFAULT_SIGHT_END);

  return {
    position,
    heading,
    speed,
    turretHeading: rotateTowardAngle(
      pose.turretHeading,
      targetTurretHeading,
      TURRET_TURN_SPEED * delta,
    ),
  };
}

function readArmorState(
  pose: TankPose,
  targetPose?: TankPose,
): { armor: ArmorAngleReading; damage: DamageMitigation } {
  const targetPosition = targetPose?.position ?? DEFAULT_SIGHT_END;
  const armor = calculateArmorAngle({
    hullHeading: pose.heading,
    incomingFireOrigin: targetPosition,
    tankPosition: pose.position,
    turretHeading: pose.turretHeading,
  });

  return {
    armor,
    damage: calculateDamageMitigation(armor, BASE_SHELL_DAMAGE),
  };
}

function headingToForward(heading: number): [number, number] {
  return [Math.sin(heading), -Math.cos(heading)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
