import { Html } from '@react-three/drei';

import type { MissionResult, MissionSelectItem, MissionSyncStatus } from './missionRunner';

type MissionSelectScreenProps = {
  missions: MissionSelectItem[];
  onStartMission: (missionId: string) => void;
  syncStatus: MissionSyncStatus;
};

type MissionResultsScreenProps = {
  onContinue: () => void;
  onRetry: () => void;
  result: MissionResult;
  syncStatus: MissionSyncStatus;
};

export function MissionSelectScreen({
  missions,
  onStartMission,
  syncStatus,
}: MissionSelectScreenProps) {
  const completedCount = missions.filter((item) => item.status === 'complete').length;

  return (
    <Html fullscreen prepend className="solo-screen-shell">
      <section className="solo-screen solo-mission-select" aria-labelledby="mission-select-title">
        <header className="solo-screen-header">
          <div>
            <span>Solo operations</span>
            <h2 id="mission-select-title">Mission select</h2>
          </div>
          <strong>
            {completedCount}/{missions.length} clear
          </strong>
        </header>

        <div className="mission-card-grid">
          {missions.map(({ actionLabel, mission, status }) => (
            <article key={mission.id} className={`mission-card mission-card-${status}`}>
              <div>
                <span>Mission {mission.sequence}</span>
                <h3>{mission.title}</h3>
              </div>
              <p>{mission.objective}</p>
              <dl>
                <div>
                  <dt>Tier</dt>
                  <dd>{mission.tier}</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd>{mission.targetIntegrity}%</dd>
                </div>
              </dl>
              <button
                className={status === 'locked' ? 'secondary-action' : 'primary-action'}
                type="button"
                disabled={status === 'locked'}
                onClick={() => onStartMission(mission.id)}
              >
                {actionLabel}
              </button>
            </article>
          ))}
        </div>

        <footer>
          <span>{syncStatusLabel(syncStatus)}</span>
        </footer>
      </section>
    </Html>
  );
}

export function MissionResultsScreen({
  onContinue,
  onRetry,
  result,
  syncStatus,
}: MissionResultsScreenProps) {
  const campaignComplete = result.outcome === 'campaign-complete';

  return (
    <Html fullscreen prepend className="solo-screen-shell">
      <section className="solo-screen solo-results" aria-labelledby="mission-results-title">
        <header className="solo-screen-header">
          <div>
            <span>{campaignComplete ? 'Campaign secured' : 'Mission secured'}</span>
            <h2 id="mission-results-title">{result.title}</h2>
          </div>
          <strong>{campaignComplete ? 'Complete' : 'Victory'}</strong>
        </header>

        <div className="results-grid">
          <ResultMetric label="Damage dealt" value={`${result.damageDealt}%`} />
          <ResultMetric label="Enemy integrity" value={`${result.remainingIntegrity}%`} />
          <ResultMetric
            label="Next sortie"
            value={result.nextMissionId ? 'Unlocked' : 'All clear'}
          />
        </div>

        <div className="results-actions">
          <button className="secondary-action" type="button" onClick={onRetry}>
            Retry
          </button>
          <button className="primary-action" type="button" onClick={onContinue}>
            {campaignComplete ? 'Mission select' : 'Continue'}
          </button>
        </div>

        <footer>
          <span>{syncStatusLabel(syncStatus)}</span>
        </footer>
      </section>
    </Html>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="result-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function syncStatusLabel(status: MissionSyncStatus): string {
  switch (status) {
    case 'error':
      return 'Progress will retry on next action';
    case 'loading':
      return 'Loading progress';
    case 'local':
      return 'Local session';
    case 'saved':
      return 'Progress saved';
    case 'saving':
      return 'Saving progress';
  }
}
