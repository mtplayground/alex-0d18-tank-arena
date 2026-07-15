import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchMissionProgress, saveMissionProgress } from '../api/client';
import type { MissionProgressEntry, MissionProgressUpdatePayload } from '../../../shared/protocol';
import { MISSIONS, type MissionDefinition } from './missions';
import type { ProjectileResolution } from './projectileModel';

export type MissionStatus = 'active' | 'campaign-complete' | 'complete';
export type MissionSyncStatus = 'error' | 'loading' | 'local' | 'saved' | 'saving';

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
  syncStatus: MissionSyncStatus;
  targetIntegrity: number;
};

const ADVANCE_DELAY_MS = 1200;

export function useMissionRunner(): MissionRunner {
  const [state, setState] = useState<MissionRunnerState>(() => ({
    cursor: 0,
    status: 'active',
    targetIntegrity: MISSIONS[0].targetIntegrity,
  }));
  const [hydrated, setHydrated] = useState(false);
  const [persistenceEnabled, setPersistenceEnabled] = useState(false);
  const [syncStatus, setSyncStatus] = useState<MissionSyncStatus>('loading');
  const activeMission = MISSIONS[state.cursor];

  useEffect(() => {
    const controller = new AbortController();

    fetchMissionProgress(controller.signal)
      .then((response) => {
        if (!response) {
          setPersistenceEnabled(false);
          setSyncStatus('local');
          return;
        }

        setState(stateFromProgress(response.missions));
        setPersistenceEnabled(true);
        setSyncStatus('saved');
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        setPersistenceEnabled(false);
        setSyncStatus('error');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setHydrated(true);
        }
      });

    return () => controller.abort();
  }, []);

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
    if (!hydrated || !persistenceEnabled) {
      return;
    }

    const controller = new AbortController();
    const mission = MISSIONS[state.cursor];
    const payload = progressPayloadForState(mission, state);

    setSyncStatus('saving');
    saveMissionProgress(mission.id, payload, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }

        if (!response) {
          setPersistenceEnabled(false);
          setSyncStatus('local');
          return;
        }

        setSyncStatus('saved');
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setSyncStatus('error');
        }
      });

    return () => controller.abort();
  }, [hydrated, persistenceEnabled, state]);

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
    syncStatus,
    targetIntegrity: state.targetIntegrity,
  };
}

function stateFromProgress(progress: MissionProgressEntry[]): MissionRunnerState {
  const byMission = new Map(progress.map((entry) => [entry.mission_key, entry]));
  const firstIncompleteIndex = MISSIONS.findIndex(
    (mission) => byMission.get(mission.id)?.status !== 'completed',
  );

  if (firstIncompleteIndex === -1) {
    return {
      cursor: MISSIONS.length - 1,
      status: 'campaign-complete',
      targetIntegrity: 0,
    };
  }

  const mission = MISSIONS[firstIncompleteIndex];
  const saved = byMission.get(mission.id);

  return {
    cursor: firstIncompleteIndex,
    status: 'active',
    targetIntegrity: savedTargetIntegrity(saved, mission.targetIntegrity),
  };
}

function savedTargetIntegrity(
  progress: MissionProgressEntry | undefined,
  fallback: number,
): number {
  const value = progress?.progress.targetIntegrity;

  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(fallback, Math.max(0, value))
    : fallback;
}

function progressPayloadForState(
  mission: MissionDefinition,
  state: MissionRunnerState,
): MissionProgressUpdatePayload {
  const isComplete = state.status === 'complete' || state.status === 'campaign-complete';

  return {
    attempts: 1,
    best_score: isComplete ? mission.targetIntegrity : null,
    current_step: state.cursor,
    progress: {
      campaignComplete: state.status === 'campaign-complete',
      completedMissionIds: completedMissionIdsForState(state),
      targetIntegrity: state.targetIntegrity,
    },
    status: isComplete ? 'completed' : 'in_progress',
  };
}

function completedMissionIdsForState(state: MissionRunnerState): string[] {
  if (state.status === 'campaign-complete') {
    return MISSIONS.map((mission) => mission.id);
  }

  return MISSIONS.filter(
    (_, index) => index < state.cursor || (state.status === 'complete' && index === state.cursor),
  ).map((mission) => mission.id);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
