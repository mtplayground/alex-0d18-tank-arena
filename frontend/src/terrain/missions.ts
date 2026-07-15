import type { AiDifficultyTier } from './aiBehavior';

export type MissionDefinition = {
  aiMissionIndex: number;
  callsign: string;
  id: string;
  objective: string;
  sequence: number;
  targetIntegrity: number;
  tier: AiDifficultyTier;
  title: string;
};

export const MISSIONS: MissionDefinition[] = [
  {
    aiMissionIndex: 1,
    callsign: 'Range Gate',
    id: 'range-gate',
    objective: 'Break a cautious target before it settles behind the west ridge.',
    sequence: 1,
    targetIntegrity: 100,
    tier: 'recruit',
    title: 'Range Gate',
  },
  {
    aiMissionIndex: 2,
    callsign: 'Rubble Sweep',
    id: 'rubble-sweep',
    objective: 'Track a flanking opponent through broken center cover.',
    sequence: 2,
    targetIntegrity: 100,
    tier: 'recruit',
    title: 'Rubble Sweep',
  },
  {
    aiMissionIndex: 3,
    callsign: 'Crossfire Lane',
    id: 'crossfire-lane',
    objective: 'Punish a veteran crew that angles while seeking cover.',
    sequence: 3,
    targetIntegrity: 100,
    tier: 'veteran',
    title: 'Crossfire Lane',
  },
  {
    aiMissionIndex: 4,
    callsign: 'Hull Down',
    id: 'hull-down',
    objective: 'Force a veteran defender out from structure cover.',
    sequence: 4,
    targetIntegrity: 100,
    tier: 'veteran',
    title: 'Hull Down',
  },
  {
    aiMissionIndex: 5,
    callsign: 'Ace Rotation',
    id: 'ace-rotation',
    objective: 'Defeat an ace opponent with tighter aim and stronger angling.',
    sequence: 5,
    targetIntegrity: 100,
    tier: 'ace',
    title: 'Ace Rotation',
  },
];
