import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchMissionProgress, saveMissionProgress } from '../api/client';
import type { MissionProgressEntry, MissionProgressUpdatePayload } from '../../../shared/protocol';
import { MISSIONS, type MissionDefinition } from './missions';
import type { ProjectileResolution } from './projectileModel';

export type MissionStatus = 'active' | 'campaign-complete' | 'complete';
export type MissionScreen = 'combat' | 'results' | 'select';
export type MissionSyncStatus = 'error' | 'loading' | 'local' | 'saved' | 'saving';

type MissionRunnerState = {
  completedMissionIds: string[];
  cursor: number;
  result: MissionResult | null;
  screen: MissionScreen;
  status: MissionStatus;
  targetIntegrity: number;
};

export type MissionResult = {
  damageDealt: number;
  missionId: string;
  nextMissionId: string | null;
  outcome: 'campaign-complete' | 'victory';
  remainingIntegrity: number;
  title: string;
};

export type MissionSequenceItem = {
  id: string;
  sequence: number;
  status: 'active' | 'complete' | 'locked';
};

export type MissionSelectItem = {
  actionLabel: string;
  mission: MissionDefinition;
  status: 'available' | 'complete' | 'locked' | 'selected';
};

export type MissionRunner = {
  activeMission: MissionDefinition;
  applyResolution: (resolution: ProjectileResolution) => void;
  continueFromResults: () => void;
  missionChoices: MissionSelectItem[];
  result: MissionResult | null;
  retryMission: () => void;
  screen: MissionScreen;
  sequence: MissionSequenceItem[];
  startMission: (missionId: string) => void;
  status: MissionStatus;
  syncStatus: MissionSyncStatus;
  targetIntegrity: number;
};

export function useMissionRunner(): MissionRunner {
  const [state, setState] = useState<MissionRunnerState>(() => ({
    completedMissionIds: [],
    cursor: 0,
    result: null,
    screen: 'select',
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
      if (current.screen !== 'combat' || current.status !== 'active') {
        return current;
      }

      const nextIntegrity = Math.max(0, current.targetIntegrity - resolution.damage.finalDamage);

      if (nextIntegrity > 0) {
        return { ...current, targetIntegrity: nextIntegrity };
      }

      const mission = MISSIONS[current.cursor];
      const isCampaignComplete = current.cursor >= MISSIONS.length - 1;
      const completedMissionIds = uniqueMissionIds([...current.completedMissionIds, mission.id]);

      return {
        ...current,
        completedMissionIds,
        result: {
          damageDealt: mission.targetIntegrity,
          missionId: mission.id,
          nextMissionId: isCampaignComplete ? null : MISSIONS[current.cursor + 1].id,
          outcome: isCampaignComplete ? 'campaign-complete' : 'victory',
          remainingIntegrity: 0,
          title: mission.title,
        },
        screen: 'results',
        status: isCampaignComplete ? 'campaign-complete' : 'complete',
        targetIntegrity: 0,
      };
    });
  }, []);

  useEffect(() => {
    if (!hydrated || !persistenceEnabled || state.screen === 'select') {
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

  const startMission = useCallback((missionId: string) => {
    setState((current) => {
      const nextCursor = MISSIONS.findIndex((mission) => mission.id === missionId);

      if (nextCursor < 0 || isMissionLocked(nextCursor, current.completedMissionIds)) {
        return current;
      }

      const nextMission = MISSIONS[nextCursor];
      const shouldResumeSelected =
        current.cursor === nextCursor &&
        !current.completedMissionIds.includes(nextMission.id) &&
        current.targetIntegrity > 0;

      return {
        ...current,
        cursor: nextCursor,
        result: null,
        screen: 'combat',
        status: 'active',
        targetIntegrity: shouldResumeSelected
          ? current.targetIntegrity
          : nextMission.targetIntegrity,
      };
    });
  }, []);

  const retryMission = useCallback(() => {
    setState((current) => {
      const mission = MISSIONS[current.cursor];

      return {
        ...current,
        result: null,
        screen: 'combat',
        status: 'active',
        targetIntegrity: mission.targetIntegrity,
      };
    });
  }, []);

  const continueFromResults = useCallback(() => {
    setState((current) => {
      if (current.status === 'campaign-complete') {
        return {
          ...current,
          result: null,
          screen: 'select',
        };
      }

      const nextCursor = Math.min(current.cursor + 1, MISSIONS.length - 1);
      const nextMission = MISSIONS[nextCursor];

      return {
        ...current,
        cursor: nextCursor,
        result: null,
        screen: 'select',
        status: 'active',
        targetIntegrity: nextMission.targetIntegrity,
      };
    });
  }, []);

  const sequence = useMemo<MissionSequenceItem[]>(
    () =>
      MISSIONS.map((mission, index) => ({
        id: mission.id,
        sequence: mission.sequence,
        status: state.completedMissionIds.includes(mission.id)
          ? 'complete'
          : index === state.cursor
            ? 'active'
            : isMissionLocked(index, state.completedMissionIds)
              ? 'locked'
              : 'active',
      })),
    [state.completedMissionIds, state.cursor],
  );

  const missionChoices = useMemo<MissionSelectItem[]>(
    () =>
      MISSIONS.map((mission, index) => {
        const isComplete = state.completedMissionIds.includes(mission.id);
        const locked = isMissionLocked(index, state.completedMissionIds);
        const isSelected = index === state.cursor && !isComplete && !locked;
        const status = locked
          ? 'locked'
          : isComplete
            ? 'complete'
            : isSelected
              ? 'selected'
              : 'available';

        return {
          actionLabel: locked ? 'Locked' : isComplete ? 'Replay' : isSelected ? 'Start' : 'Select',
          mission,
          status,
        };
      }),
    [state.completedMissionIds, state.cursor],
  );

  return {
    activeMission,
    applyResolution,
    continueFromResults,
    missionChoices,
    result: state.result,
    retryMission,
    screen: state.screen,
    sequence,
    startMission,
    status: state.status,
    syncStatus,
    targetIntegrity: state.targetIntegrity,
  };
}

function stateFromProgress(progress: MissionProgressEntry[]): MissionRunnerState {
  const byMission = new Map(progress.map((entry) => [entry.mission_key, entry]));
  const completedMissionIds = MISSIONS.filter(
    (mission) => byMission.get(mission.id)?.status === 'completed',
  ).map((mission) => mission.id);
  const firstIncompleteIndex = MISSIONS.findIndex(
    (mission) => byMission.get(mission.id)?.status !== 'completed',
  );

  if (firstIncompleteIndex === -1) {
    return {
      completedMissionIds,
      cursor: MISSIONS.length - 1,
      result: null,
      screen: 'select',
      status: 'campaign-complete',
      targetIntegrity: 0,
    };
  }

  const mission = MISSIONS[firstIncompleteIndex];
  const saved = byMission.get(mission.id);

  return {
    completedMissionIds,
    cursor: firstIncompleteIndex,
    result: null,
    screen: 'select',
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
  const isComplete =
    state.completedMissionIds.includes(mission.id) ||
    state.status === 'complete' ||
    state.status === 'campaign-complete';

  return {
    attempts: 1,
    best_score: isComplete ? mission.targetIntegrity : null,
    current_step: state.cursor,
    progress: {
      campaignComplete: state.status === 'campaign-complete',
      completedMissionIds: state.completedMissionIds,
      result: state.result,
      screen: state.screen,
      targetIntegrity: state.targetIntegrity,
    },
    status: isComplete ? 'completed' : 'in_progress',
  };
}

function isMissionLocked(index: number, completedMissionIds: string[]): boolean {
  return index > 0 && !completedMissionIds.includes(MISSIONS[index - 1].id);
}

function uniqueMissionIds(missionIds: string[]): string[] {
  return MISSIONS.filter((mission) => missionIds.includes(mission.id)).map((mission) => mission.id);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
