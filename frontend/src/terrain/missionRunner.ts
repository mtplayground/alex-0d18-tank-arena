import { useCallback, useEffect, useMemo, useState } from 'react';

import { MISSIONS, type MissionDefinition } from './missions';
import type { ProjectileResolution } from './projectileModel';

export type MissionStatus = 'active' | 'campaign-complete' | 'complete';

type MissionRunnerState = {
  cursor: number;
  status: MissionStatus;
  targetIntegrity: number;
};

export type MissionSequenceItem = {
  id: string;
  sequence: number;
  status: 'active' | 'complete' | 'locked';
};

export type MissionRunner = {
  activeMission: MissionDefinition;
  applyResolution: (resolution: ProjectileResolution) => void;
  sequence: MissionSequenceItem[];
  status: MissionStatus;
  targetIntegrity: number;
};

const ADVANCE_DELAY_MS = 1200;

export function useMissionRunner(): MissionRunner {
  const [state, setState] = useState<MissionRunnerState>(() => ({
    cursor: 0,
    status: 'active',
    targetIntegrity: MISSIONS[0].targetIntegrity,
  }));
  const activeMission = MISSIONS[state.cursor];

  const applyResolution = useCallback((resolution: ProjectileResolution) => {
    if (resolution.kind !== 'target-hit') {
      return;
    }

    setState((current) => {
      if (current.status !== 'active') {
        return current;
      }

      const nextIntegrity = Math.max(0, current.targetIntegrity - resolution.damage.finalDamage);

      if (nextIntegrity > 0) {
        return { ...current, targetIntegrity: nextIntegrity };
      }

      return {
        ...current,
        status: current.cursor >= MISSIONS.length - 1 ? 'campaign-complete' : 'complete',
        targetIntegrity: 0,
      };
    });
  }, []);

  useEffect(() => {
    if (state.status !== 'complete') {
      return;
    }

    const timeout = window.setTimeout(() => {
      setState((current) => {
        const nextCursor = Math.min(current.cursor + 1, MISSIONS.length - 1);
        const nextMission = MISSIONS[nextCursor];

        return {
          cursor: nextCursor,
          status: 'active',
          targetIntegrity: nextMission.targetIntegrity,
        };
      });
    }, ADVANCE_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [state.status]);

  const sequence = useMemo<MissionSequenceItem[]>(
    () =>
      MISSIONS.map((mission, index) => ({
        id: mission.id,
        sequence: mission.sequence,
        status:
          index === state.cursor
            ? 'active'
            : index < state.cursor || state.status === 'campaign-complete'
              ? 'complete'
              : 'locked',
      })),
    [state.cursor, state.status],
  );

  return {
    activeMission,
    applyResolution,
    sequence,
    status: state.status,
    targetIntegrity: state.targetIntegrity,
  };
}
