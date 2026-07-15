import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';

import type { Vec3 } from './battlefield';
import {
  projectileMuzzlePosition,
  resolveProjectileShot,
  type ProjectileResolution,
} from './projectileModel';
import type { TankPose } from './tankState';
import { TACTICAL_COLORS } from './visualStyle';

type ProjectileSystemProps = {
  onResolution?: (resolution: ProjectileResolution) => void;
  poseRef: MutableRefObject<TankPose>;
};

type ActiveProjectile = {
  age: number;
  duration: number;
  end: Vec3;
  id: number;
  position: Vec3;
  resolution: ProjectileResolution;
  start: Vec3;
};

const PROJECTILE_SPEED = 8.5;
const FIRE_COOLDOWN_SECONDS = 0.55;

export function ProjectileSystem({ onResolution, poseRef }: ProjectileSystemProps) {
  const [projectiles, setProjectiles] = useState<ActiveProjectile[]>([]);
  const [lastResolution, setLastResolution] = useState<ProjectileResolution | null>(null);
  const nextId = useRef(1);
  const cooldown = useRef(0);

  const fireProjectile = useCallback(() => {
    if (cooldown.current > 0) {
      return;
    }

    const pose = poseRef.current;
    const start = projectileMuzzlePosition(pose);
    const resolution = resolveProjectileShot(pose);
    const distance = distanceBetween(start, resolution.impactPoint);
    const duration = Math.max(distance / PROJECTILE_SPEED, 0.12);

    cooldown.current = FIRE_COOLDOWN_SECONDS;
    setLastResolution(resolution);
    onResolution?.(resolution);
    setProjectiles((current) => [
      ...current,
      {
        age: 0,
        duration,
        end: resolution.impactPoint,
        id: nextId.current,
        position: start,
        resolution,
        start,
      },
    ]);
    nextId.current += 1;
  }, [onResolution, poseRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) {
        return;
      }

      event.preventDefault();
      fireProjectile();
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [fireProjectile]);

  useFrame((_, delta) => {
    cooldown.current = Math.max(0, cooldown.current - delta);

    const completed: ProjectileResolution[] = [];
    setProjectiles((current) => {
      if (current.length === 0) {
        return current;
      }

      return current.flatMap((projectile) => {
        const age = projectile.age + delta;

        if (age >= projectile.duration) {
          completed.push(projectile.resolution);
          return [];
        }

        return [
          {
            ...projectile,
            age,
            position: lerpVec3(projectile.start, projectile.end, age / projectile.duration),
          },
        ];
      });
    });

    if (completed.length > 0) {
      setLastResolution(completed[completed.length - 1]);
    }
  });

  return (
    <>
      {projectiles.map((projectile) => (
        <ProjectileVisual key={projectile.id} projectile={projectile} />
      ))}
      {lastResolution ? <ShotResult resolution={lastResolution} /> : null}
      <FireControl onFire={fireProjectile} />
    </>
  );
}

function ProjectileVisual({ projectile }: { projectile: ActiveProjectile }) {
  return (
    <mesh position={projectile.position}>
      <sphereGeometry args={[0.08, 16, 16]} />
      <meshStandardMaterial
        color={TACTICAL_COLORS.sightCore}
        emissive={TACTICAL_COLORS.sightBlocked}
        emissiveIntensity={0.9}
      />
    </mesh>
  );
}

function ShotResult({ resolution }: { resolution: ProjectileResolution }) {
  const label =
    resolution.kind === 'target-hit'
      ? `Hit ${resolution.damage.finalDamage} dmg`
      : `Blocked ${resolution.blocker.kind}`;

  return (
    <group position={resolution.impactPoint}>
      <mesh>
        <sphereGeometry args={[0.18, 18, 18]} />
        <meshStandardMaterial
          color={
            resolution.kind === 'target-hit'
              ? TACTICAL_COLORS.sightClear
              : TACTICAL_COLORS.sightBlocked
          }
          emissive={
            resolution.kind === 'target-hit'
              ? TACTICAL_COLORS.sightClear
              : TACTICAL_COLORS.sightBlocked
          }
          emissiveIntensity={0.55}
        />
      </mesh>
      <Html center distanceFactor={7.5} className="shot-result-readout">
        {label}
      </Html>
    </group>
  );
}

function FireControl({ onFire }: { onFire: () => void }) {
  return (
    <Html position={[-3.9, 2.25, 3.25]} transform occlude={false}>
      <button className="fire-control" type="button" onClick={onFire}>
        Fire
      </button>
    </Html>
  );
}

function lerpVec3(start: Vec3, end: Vec3, t: number): Vec3 {
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
    start[2] + (end[2] - start[2]) * t,
  ];
}

function distanceBetween(start: Vec3, end: Vec3): number {
  return new Vector3(...start).distanceTo(new Vector3(...end));
}
