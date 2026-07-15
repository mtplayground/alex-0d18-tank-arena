import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  cancelMatchmakingQueue,
  fetchMatchmakingStatus,
  fetchMatchResults,
  finalizeMatchResults,
  joinMatchmakingQueue,
  matchWebSocketUrl,
} from '../api/client';
import type {
  MatchmakingArenaSize,
  MatchmakingMatch,
  MatchmakingQueueResponse,
  MatchResultEntry,
  MatchResultOutcome,
  MatchResultsFinalizePayload,
  MatchResultsFinalizeResponse,
  MatchResultsSummary,
  UserProfile,
} from '../../../shared/protocol';
import { terrainHeight } from '../terrain/battlefield';

type MultiplayerDuelPanelProps = {
  user: UserProfile;
};

type SocketStatus = 'closed' | 'connected' | 'connecting' | 'error';

type MatchSocketEvent = {
  kind: string;
  payload?: {
    players?: LivePlayerState[];
    result?: ShotResolution;
    sequence?: number;
  };
  server_time: string;
  user_sub: string;
};

type LivePlayerState = {
  health: number;
  position: [number, number, number];
  speed: number;
  user_sub: string;
};

type ShotResolution = {
  damage?: {
    final_damage: number;
  } | null;
  hit: boolean;
  shooter_sub: string;
  target_sub?: string | null;
};

type LocalStats = {
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  shotsHit: number;
};

const EMPTY_STATS: LocalStats = {
  damageDealt: 0,
  damageTaken: 0,
  shotsFired: 0,
  shotsHit: 0,
};

export function MultiplayerDuelPanel({ user }: MultiplayerDuelPanelProps) {
  const [arenaSize, setArenaSize] = useState<MatchmakingArenaSize>('duel');
  const [queue, setQueue] = useState<MatchmakingQueueResponse | null>(null);
  const [history, setHistory] = useState<MatchResultEntry[]>([]);
  const [summary, setSummary] = useState<MatchResultsSummary | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('closed');
  const [events, setEvents] = useState<MatchSocketEvent[]>([]);
  const [players, setPlayers] = useState<LivePlayerState[]>([]);
  const [localStats, setLocalStats] = useState<LocalStats>(EMPTY_STATS);
  const [finalized, setFinalized] = useState<MatchResultsFinalizeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const activeMatch = queue?.match_session ?? null;
  const displayName = user.name ?? user.email;

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    const response = await fetchMatchmakingStatus(signal);

    if (response) {
      setQueue(response);
    }
  }, []);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    const response = await fetchMatchResults(signal);

    if (response) {
      setHistory(response.results);
      setSummary(response.summary);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([loadStatus(controller.signal), loadHistory(controller.signal)]).catch(
      (caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(caught, 'Unable to load multiplayer data'));
        }
      },
    );

    return () => controller.abort();
  }, [loadHistory, loadStatus]);

  useEffect(() => {
    if (queue?.status !== 'queued') {
      return;
    }

    const interval = window.setInterval(() => {
      loadStatus().catch((caught: unknown) => {
        setError(errorMessage(caught, 'Unable to refresh matchmaking'));
      });
    }, 2500);

    return () => window.clearInterval(interval);
  }, [loadStatus, queue?.status]);

  useEffect(() => {
    if (!activeMatch || finalized) {
      socketRef.current?.close();
      socketRef.current = null;
      setSocketStatus('closed');
      return;
    }

    const socket = new WebSocket(matchWebSocketUrl(activeMatch.websocket_path));
    socketRef.current = socket;
    setSocketStatus('connecting');

    socket.addEventListener('open', () => {
      setSocketStatus('connected');
      sendPlayerState(socket, activeMatch, user.sub);
    });

    socket.addEventListener('message', (message) => {
      const event = parseSocketEvent(message.data);

      if (!event) {
        return;
      }

      setEvents((current) => [event, ...current].slice(0, 6));

      if (event.payload?.players) {
        setPlayers(event.payload.players);
      }

      if (event.kind === 'shot_resolved' && event.payload?.result) {
        applyShotResult(event.payload.result, user.sub, setLocalStats);
      }
    });

    socket.addEventListener('close', () => {
      if (socketRef.current === socket) {
        setSocketStatus('closed');
      }
    });

    socket.addEventListener('error', () => {
      setSocketStatus('error');
    });

    return () => {
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [activeMatch, finalized, user.sub]);

  const joinQueue = useCallback(async () => {
    setBusy(true);
    setError(null);
    setFinalized(null);
    setEvents([]);
    setPlayers([]);
    setLocalStats(EMPTY_STATS);

    try {
      const response = await joinMatchmakingQueue(arenaSize);
      if (response) {
        setQueue(response);
      }
    } catch (caught: unknown) {
      setError(errorMessage(caught, 'Unable to join queue'));
    } finally {
      setBusy(false);
    }
  }, [arenaSize]);

  const cancelQueue = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const response = await cancelMatchmakingQueue();
      if (response) {
        setQueue(response);
      }
    } catch (caught: unknown) {
      setError(errorMessage(caught, 'Unable to cancel queue'));
    } finally {
      setBusy(false);
    }
  }, []);

  const fire = useCallback(() => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN || !activeMatch) {
      return;
    }

    sendPlayerState(socket, activeMatch, user.sub);
    socket.send(JSON.stringify({ shot_id: crypto.randomUUID(), type: 'fire' }));
    setLocalStats((current) => ({
      ...current,
      shotsFired: current.shotsFired + 1,
    }));
  }, [activeMatch, user.sub]);

  const finalize = useCallback(
    async (outcome: MatchResultOutcome) => {
      if (!activeMatch) {
        return;
      }

      setBusy(true);
      setError(null);

      try {
        const payload = buildFinalizePayload(activeMatch, user.sub, localStats, outcome);
        const response = await finalizeMatchResults(activeMatch.match_id, payload);

        if (response) {
          setFinalized(response);
          setHistory((current) => mergeHistory(response.results, current, user.sub));
          setSummary(response.summary);
        }
      } catch (caught: unknown) {
        setError(errorMessage(caught, 'Unable to record result'));
      } finally {
        setBusy(false);
      }
    },
    [activeMatch, localStats, user.sub],
  );

  const resetMatch = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setQueue(null);
    setFinalized(null);
    setEvents([]);
    setPlayers([]);
    setLocalStats(EMPTY_STATS);
    setSocketStatus('closed');
  }, []);

  const opponent = useMemo(
    () => activeMatch?.participants.find((participant) => participant.user_sub !== user.sub),
    [activeMatch, user.sub],
  );

  return (
    <section className="duel-panel" aria-labelledby="duel-title">
      <header className="duel-header">
        <div>
          <p className="eyebrow">Multiplayer</p>
          <h2 id="duel-title">Duel station</h2>
        </div>
        <strong>{queueStatusLabel(queue)}</strong>
      </header>

      {finalized ? (
        <DuelResultsScreen finalized={finalized} onDone={resetMatch} userSub={user.sub} />
      ) : activeMatch ? (
        <LiveMatchView
          busy={busy}
          events={events}
          match={activeMatch}
          opponentLabel={opponent?.side ?? 'opponent'}
          onAbandon={() => void finalize('abandoned')}
          onDraw={() => void finalize('draw')}
          onFire={fire}
          onLoss={() => void finalize('loss')}
          onWin={() => void finalize('win')}
          players={players}
          socketStatus={socketStatus}
          stats={localStats}
          userSub={user.sub}
        />
      ) : (
        <MatchmakingScreen
          arenaSize={arenaSize}
          busy={busy}
          onArenaSize={setArenaSize}
          onCancel={cancelQueue}
          onJoin={joinQueue}
          queue={queue}
        />
      )}

      <MatchHistory history={history} summary={summary} userLabel={displayName} />

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

function MatchmakingScreen({
  arenaSize,
  busy,
  onArenaSize,
  onCancel,
  onJoin,
  queue,
}: {
  arenaSize: MatchmakingArenaSize;
  busy: boolean;
  onArenaSize: (value: MatchmakingArenaSize) => void;
  onCancel: () => void;
  onJoin: () => void;
  queue: MatchmakingQueueResponse | null;
}) {
  const queued = queue?.status === 'queued';

  return (
    <section className="duel-section">
      <div className="segmented-control" aria-label="Arena size">
        <button
          className={arenaSize === 'duel' ? 'selected' : ''}
          type="button"
          onClick={() => onArenaSize('duel')}
        >
          1v1
        </button>
        <button
          className={arenaSize === 'small_arena' ? 'selected' : ''}
          type="button"
          onClick={() => onArenaSize('small_arena')}
        >
          Small arena
        </button>
      </div>

      <div className="queue-status-card">
        <span>Queue</span>
        <strong>{queued ? `Position ${queue.queue_position ?? 1}` : 'Ready'}</strong>
      </div>

      <div className="duel-actions">
        {queued ? (
          <button className="secondary-action" type="button" disabled={busy} onClick={onCancel}>
            Cancel queue
          </button>
        ) : (
          <button className="primary-action" type="button" disabled={busy} onClick={onJoin}>
            Find match
          </button>
        )}
      </div>
    </section>
  );
}

function LiveMatchView({
  busy,
  events,
  match,
  opponentLabel,
  onAbandon,
  onDraw,
  onFire,
  onLoss,
  onWin,
  players,
  socketStatus,
  stats,
  userSub,
}: {
  busy: boolean;
  events: MatchSocketEvent[];
  match: MatchmakingMatch;
  opponentLabel: string;
  onAbandon: () => void;
  onDraw: () => void;
  onFire: () => void;
  onLoss: () => void;
  onWin: () => void;
  players: LivePlayerState[];
  socketStatus: SocketStatus;
  stats: LocalStats;
  userSub: string;
}) {
  return (
    <section className="duel-section live-match">
      <div className="live-match-meta">
        <StatusTile label="Match" value={shortId(match.match_id)} />
        <StatusTile label="Socket" value={socketStatus} />
        <StatusTile label="Rival" value={opponentLabel} />
      </div>

      <div className="live-player-grid">
        {match.participants.map((participant) => {
          const player = players.find((item) => item.user_sub === participant.user_sub);
          const label = participant.user_sub === userSub ? 'You' : participant.side;

          return (
            <article key={participant.user_sub} className="live-player-card">
              <span>{label}</span>
              <strong>{player ? `${player.health}%` : 'Awaiting state'}</strong>
              <small>{shortId(participant.user_sub)}</small>
            </article>
          );
        })}
      </div>

      <div className="live-stat-grid">
        <StatusTile label="Shots" value={`${stats.shotsHit}/${stats.shotsFired}`} />
        <StatusTile label="Damage dealt" value={`${stats.damageDealt}`} />
        <StatusTile label="Damage taken" value={`${stats.damageTaken}`} />
      </div>

      <div className="duel-actions">
        <button
          className="primary-action"
          type="button"
          disabled={socketStatus !== 'connected'}
          onClick={onFire}
        >
          Fire
        </button>
        <button className="secondary-action" type="button" disabled={busy} onClick={onWin}>
          Record win
        </button>
        <button className="secondary-action" type="button" disabled={busy} onClick={onLoss}>
          Record loss
        </button>
        <button className="secondary-action" type="button" disabled={busy} onClick={onDraw}>
          Draw
        </button>
        <button className="secondary-action" type="button" disabled={busy} onClick={onAbandon}>
          Abandon
        </button>
      </div>

      <ol className="event-log" aria-label="Match events">
        {events.map((event) => (
          <li key={`${event.server_time}-${event.kind}-${event.user_sub}`}>
            <span>{event.kind.replace(/_/g, ' ')}</span>
            <strong>{shortId(event.user_sub)}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DuelResultsScreen({
  finalized,
  onDone,
  userSub,
}: {
  finalized: MatchResultsFinalizeResponse;
  onDone: () => void;
  userSub: string;
}) {
  const userResult = finalized.results.find((result) => result.user_sub === userSub);

  return (
    <section className="duel-section duel-results-screen">
      <header>
        <span>Result</span>
        <strong>{formatOutcome(userResult?.result ?? 'draw')}</strong>
      </header>
      <div className="results-grid">
        <StatusTile label="Score" value={`${userResult?.score ?? 0}`} />
        <StatusTile label="Damage" value={`${userResult?.damage_dealt ?? 0}`} />
        <StatusTile
          label="Record"
          value={`${finalized.summary.wins}-${finalized.summary.losses}`}
        />
      </div>
      <button className="primary-action" type="button" onClick={onDone}>
        New duel
      </button>
    </section>
  );
}

function MatchHistory({
  history,
  summary,
  userLabel,
}: {
  history: MatchResultEntry[];
  summary: MatchResultsSummary | null;
  userLabel: string;
}) {
  return (
    <section className="match-history" aria-label="Match history">
      <header>
        <span>{userLabel}</span>
        <strong>{summary ? `${summary.wins}-${summary.losses}-${summary.draws}` : '0-0-0'}</strong>
      </header>
      <div className="history-list">
        {history.slice(0, 4).map((result) => (
          <article key={`${result.match_id}-${result.user_sub}`}>
            <span>{formatOutcome(result.result)}</span>
            <strong>{result.score} pts</strong>
            <small>{result.map_key ?? result.mode}</small>
          </article>
        ))}
        {history.length === 0 ? <p>No recorded duels</p> : null}
      </div>
    </section>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="duel-status-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function sendPlayerState(socket: WebSocket, match: MatchmakingMatch, userSub: string) {
  const participantIndex = Math.max(
    0,
    match.participants.findIndex((participant) => participant.user_sub === userSub),
  );
  const x = participantIndex === 0 ? -1.7 : 1.7;
  const z = participantIndex === 0 ? 2.15 : -2.15;
  const heading = participantIndex === 0 ? -0.7 : 2.44;

  socket.send(
    JSON.stringify({
      heading,
      position: [x, terrainHeight(x, z) + 0.72, z],
      speed: 0,
      turret_heading: heading,
      type: 'player_state',
    }),
  );
}

function applyShotResult(
  result: ShotResolution,
  userSub: string,
  setLocalStats: (updater: (current: LocalStats) => LocalStats) => void,
) {
  setLocalStats((current) => {
    const damage = result.damage?.final_damage ?? 0;

    if (result.shooter_sub === userSub) {
      return {
        ...current,
        damageDealt: current.damageDealt + damage,
        shotsHit: result.hit ? current.shotsHit + 1 : current.shotsHit,
      };
    }

    if (result.target_sub === userSub) {
      return {
        ...current,
        damageTaken: current.damageTaken + damage,
      };
    }

    return current;
  });
}

function buildFinalizePayload(
  match: MatchmakingMatch,
  userSub: string,
  stats: LocalStats,
  outcome: MatchResultOutcome,
): MatchResultsFinalizePayload {
  const winnerSub =
    outcome === 'loss'
      ? match.participants.find((participant) => participant.user_sub !== userSub)?.user_sub
      : userSub;

  return {
    participants: match.participants.map((participant) => {
      const isUser = participant.user_sub === userSub;
      const result = resultForParticipant(outcome, isUser, participant.user_sub === winnerSub);
      const userStats = isUser ? stats : opponentStats(stats, result);

      return {
        damage_dealt: userStats.damageDealt,
        damage_taken: userStats.damageTaken,
        result,
        score: scoreForResult(result, userStats),
        shots_fired: userStats.shotsFired,
        shots_hit: userStats.shotsHit,
        stats: { side: participant.side },
        survived: result !== 'loss' && result !== 'abandoned',
        user_sub: participant.user_sub,
      };
    }),
  };
}

function resultForParticipant(
  outcome: MatchResultOutcome,
  isUser: boolean,
  isWinner: boolean,
): MatchResultOutcome {
  if (outcome === 'draw' || outcome === 'abandoned') {
    return outcome;
  }

  if (outcome === 'win') {
    return isUser ? 'win' : 'loss';
  }

  return isWinner ? 'win' : 'loss';
}

function opponentStats(stats: LocalStats, result: MatchResultOutcome): LocalStats {
  return {
    damageDealt: stats.damageTaken,
    damageTaken: stats.damageDealt,
    shotsFired: Math.max(stats.shotsHit, result === 'win' ? 1 : 0),
    shotsHit: Math.max(stats.damageTaken > 0 ? 1 : 0, result === 'win' ? 1 : 0),
  };
}

function scoreForResult(result: MatchResultOutcome, stats: LocalStats): number {
  const resultBonus = result === 'win' ? 500 : result === 'draw' ? 200 : 50;

  return resultBonus + stats.damageDealt * 4 + stats.shotsHit * 25;
}

function parseSocketEvent(data: unknown): MatchSocketEvent | null {
  if (typeof data !== 'string') {
    return null;
  }

  try {
    return JSON.parse(data) as MatchSocketEvent;
  } catch {
    return null;
  }
}

function mergeHistory(
  results: MatchResultEntry[],
  current: MatchResultEntry[],
  userSub: string,
): MatchResultEntry[] {
  const ownResult = results.find((result) => result.user_sub === userSub);

  if (!ownResult) {
    return current;
  }

  return [ownResult, ...current.filter((result) => result.match_id !== ownResult.match_id)];
}

function queueStatusLabel(queue: MatchmakingQueueResponse | null): string {
  if (!queue) {
    return 'Idle';
  }

  switch (queue.status) {
    case 'idle':
      return 'Idle';
    case 'matched':
      return 'Matched';
    case 'queued':
      return 'Queued';
  }
}

function formatOutcome(outcome: MatchResultOutcome): string {
  switch (outcome) {
    case 'abandoned':
      return 'Abandoned';
    case 'draw':
      return 'Draw';
    case 'loss':
      return 'Loss';
    case 'win':
      return 'Win';
  }
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
