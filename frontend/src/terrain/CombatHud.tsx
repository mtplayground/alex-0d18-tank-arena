import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, useRef, useState } from 'react';

import {
  bearingToPoint,
  calculateArmorAngle,
  type ArmorAngleReading,
  type ArmorFacing,
} from './armorAngle';
import { BASE_SHELL_DAMAGE, calculateDamageMitigation, type DamageMitigation } from './damageModel';
import { DEFAULT_SIGHT_END, evaluateProjectilePath, type CoverBlockerKind } from './occlusion';
import { type ProjectileResolution, projectileMuzzlePosition } from './projectileModel';
import type { TankPose } from './tankState';

type CombatHudProps = {
  health: number;
  lastResolution: ProjectileResolution | null;
  poseRef: MutableRefObject<TankPose>;
};

type CoverState = {
  detail: string;
  label: string;
  tone: 'clear' | 'covered';
};

type HudState = {
  armor: ArmorAngleReading;
  cover: CoverState;
  damage: DamageMitigation;
};

const COVER_MARGIN = 0.35;

export function CombatHud({ health, lastResolution, poseRef }: CombatHudProps) {
  const updateTimer = useRef(0);
  const [state, setState] = useState(() => readHudState(poseRef.current));

  useFrame((_, delta) => {
    updateTimer.current += delta;

    if (updateTimer.current >= 0.12) {
      updateTimer.current = 0;
      setState(readHudState(poseRef.current));
    }
  });

  return (
    <Html fullscreen prepend className="combat-hud-shell">
      <section className="combat-hud" aria-label="Combat status">
        <div className="hud-panel hud-panel-health">
          <span>Target Integrity</span>
          <strong>{health}%</strong>
          <div className="hud-meter" aria-hidden="true">
            <i style={{ width: `${health}%` }} />
          </div>
        </div>

        <div className={`hud-panel hud-panel-cover hud-tone-${state.cover.tone}`}>
          <span>Cover</span>
          <strong>{state.cover.label}</strong>
          <small>{state.cover.detail}</small>
        </div>

        <div className="hud-panel hud-panel-armor">
          <span>Armor Angle</span>
          <strong>
            {state.armor.hullAngleDegrees}° {formatFacing(state.armor.hullFacing)}
          </strong>
          <small>
            {state.damage.ruleLabel} · {state.damage.mitigationPercent}% mitigated
          </small>
        </div>

        <div className="hud-panel hud-panel-log">
          <span>Shot Result</span>
          <strong>{formatResolution(lastResolution)}</strong>
        </div>
      </section>
    </Html>
  );
}

function readHudState(pose: TankPose): HudState {
  const armor = calculateArmorAngle({
    hullHeading: pose.heading,
    incomingFireOrigin: DEFAULT_SIGHT_END,
    tankPosition: pose.position,
    turretHeading: pose.turretHeading,
  });

  return {
    armor,
    cover: readCoverState(pose),
    damage: calculateDamageMitigation(armor, BASE_SHELL_DAMAGE),
  };
}

function readCoverState(pose: TankPose): CoverState {
  const muzzle = projectileMuzzlePosition(pose);
  const path = evaluateProjectilePath(muzzle, DEFAULT_SIGHT_END, 0.08);

  if (!path.clear && path.hit && path.hit.distance < path.distance - COVER_MARGIN) {
    return {
      detail: `${formatBlocker(path.hit.kind)} interrupts the shot`,
      label: 'Covered',
      tone: 'covered',
    };
  }

  const targetHeading = bearingToPoint(pose.position, DEFAULT_SIGHT_END);

  return {
    detail: `Open lane ${Math.round((targetHeading * 180) / Math.PI)}°`,
    label: 'Exposed',
    tone: 'clear',
  };
}

function formatResolution(resolution: ProjectileResolution | null): string {
  if (!resolution) {
    return 'Ready';
  }

  if (resolution.kind === 'blocked') {
    return `Blocked by ${formatBlocker(resolution.blocker.kind)}`;
  }

  return `${resolution.damage.finalDamage} damage · ${resolution.damage.ruleLabel}`;
}

function formatFacing(facing: ArmorFacing): string {
  switch (facing) {
    case 'front':
      return 'front';
    case 'angled':
      return 'angled';
    case 'side':
      return 'side';
    case 'rear':
      return 'rear';
  }
}

function formatBlocker(kind: CoverBlockerKind): string {
  switch (kind) {
    case 'terrain':
      return 'terrain';
    case 'ridge':
      return 'ridge';
    case 'rubble':
      return 'rubble';
    case 'structure':
      return 'structure';
  }
}
