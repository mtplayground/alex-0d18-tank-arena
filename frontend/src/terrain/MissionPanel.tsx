import { Html } from '@react-three/drei';

import type { MissionDefinition } from './missions';
import type { MissionSequenceItem, MissionStatus, MissionSyncStatus } from './missionRunner';

export function MissionPanel({
  mission,
  sequence,
  status,
  syncStatus,
}: {
  mission: MissionDefinition;
  sequence: MissionSequenceItem[];
  status: MissionStatus;
  syncStatus: MissionSyncStatus;
}) {
  return (
    <Html fullscreen prepend className="mission-panel-shell">
      <section className="mission-panel" aria-label="Mission sequence">
        <div>
          <span>Mission {mission.sequence}</span>
          <strong>{mission.title}</strong>
        </div>
        <p>{status === 'campaign-complete' ? 'Campaign complete' : mission.objective}</p>
        <div className="mission-meta">
          <span>{mission.tier}</span>
          <span>{statusLabel(status)}</span>
          <span>{syncStatusLabel(syncStatus)}</span>
        </div>
        <ol className="mission-sequence" aria-label="Mission progress">
          {sequence.map((item) => (
            <li key={item.id} className={`mission-dot mission-dot-${item.status}`}>
              {item.sequence}
            </li>
          ))}
        </ol>
      </section>
    </Html>
  );
}

function statusLabel(status: MissionStatus): string {
  switch (status) {
    case 'active':
      return 'engaged';
    case 'complete':
      return 'secured';
    case 'campaign-complete':
      return 'complete';
  }
}

function syncStatusLabel(status: MissionSyncStatus): string {
  switch (status) {
    case 'error':
      return 'save pending';
    case 'loading':
      return 'loading';
    case 'local':
      return 'local';
    case 'saved':
      return 'saved';
    case 'saving':
      return 'saving';
  }
}
