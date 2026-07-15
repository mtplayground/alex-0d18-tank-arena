import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

type MatchmakingState = 'idle' | 'matched';

type MatchResultsSave = {
  matchId: string;
  payload: {
    participants: Array<{
      damage_dealt: number;
      damage_taken: number;
      result: string;
      score: number;
      shots_fired: number;
      shots_hit: number;
      survived: boolean;
      user_sub: string;
    }>;
  };
};

const USER_SUB = 'user_multiplayer_pilot';
const OPPONENT_SUB = 'user_rival_tanker';
const MATCH_ID = 'match-e2e-duel';
const MATCH_SESSION = {
  arena_size: 'duel',
  match_id: MATCH_ID,
  participants: [
    { side: 'alpha', user_sub: USER_SUB },
    { side: 'bravo', user_sub: OPPONENT_SUB },
  ],
  websocket_path: `/api/ws/matches/${MATCH_ID}`,
};

const USER = {
  created_at: '2026-07-15T00:00:00.000Z',
  email: 'duelist@example.com',
  email_verified: true,
  has_password: false,
  last_seen_at: '2026-07-15T00:00:00.000Z',
  name: 'Duelist',
  picture_url: null,
  sub: USER_SUB,
  updated_at: '2026-07-15T00:00:00.000Z',
};

test('multiplayer duel flow matchmakes, reconnects, and records results', async ({ page }) => {
  const resultSaves: MatchResultsSave[] = [];
  const socketConnections: WebSocketRoute[] = [];
  const clientMessages: unknown[] = [];
  let matchmakingState: MatchmakingState = 'idle';

  await installApiRoutes(page, {
    getMatchmakingState: () => matchmakingState,
    onJoinQueue: () => {
      matchmakingState = 'matched';
    },
    resultSaves,
  });

  await page.routeWebSocket(`**/api/ws/matches/${MATCH_ID}`, (socket) => {
    socketConnections.push(socket);
    sendStateSnapshot(socket);

    socket.onMessage((message) => {
      const parsed = parseSocketMessage(message);
      clientMessages.push(parsed);

      if (isFireCommand(parsed)) {
        socket.send(
          JSON.stringify({
            kind: 'shot_resolved',
            payload: {
              result: {
                damage: { final_damage: 42 },
                hit: true,
                shooter_sub: USER_SUB,
                target_sub: OPPONENT_SUB,
              },
              sequence: clientMessages.length,
            },
            server_time: '2026-07-15T00:00:05.000Z',
            user_sub: USER_SUB,
          }),
        );
      }
    });
  });

  await page.goto('/');

  await expect(page.getByText('Welcome back, Duelist!')).toBeVisible();
  const duelStation = page.getByLabel('Duel station');

  await expect(page.getByRole('heading', { name: 'Duel station' })).toBeVisible();
  await expect(duelStation.getByText('Ready')).toBeVisible();

  await duelStation.getByRole('button', { name: 'Find match' }).click();

  await expect(duelStation.getByText('Matched')).toBeVisible();
  await expect(duelStation.getByText('connected')).toBeVisible();
  await expect(page.locator('.live-player-grid').getByText('100%').first()).toBeVisible();
  await expect.poll(() => socketConnections.length).toBe(1);

  await duelStation.getByRole('button', { name: 'Fire' }).click();

  await expect(duelStation.getByText('shot resolved')).toBeVisible();
  await expect(duelStation.getByText('1/1')).toBeVisible();
  await expect(duelStation.getByText('42')).toBeVisible();
  expect(clientMessages.some(isFireCommand)).toBe(true);

  await socketConnections[0].close({ code: 1001, reason: 'network drop' });
  await expect(duelStation.getByText('closed')).toBeVisible();

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Duel station' })).toBeVisible();
  await expect(duelStation.getByText('connected')).toBeVisible();
  await expect.poll(() => socketConnections.length).toBe(2);

  await duelStation.getByRole('button', { name: 'Record win' }).click();

  const resultsScreen = duelStation.locator('.duel-results-screen');

  await expect(resultsScreen.getByText('Result')).toBeVisible();
  await expect(resultsScreen.getByText('Win')).toBeVisible();
  await expect(resultsScreen.getByText('Record')).toBeVisible();
  await expect(resultsScreen.getByText('1-0')).toBeVisible();

  expect(resultSaves).toHaveLength(1);
  expect(resultSaves[0].matchId).toBe(MATCH_ID);

  const playerResult = resultSaves[0].payload.participants.find(
    (participant) => participant.user_sub === USER_SUB,
  );
  const opponentResult = resultSaves[0].payload.participants.find(
    (participant) => participant.user_sub === OPPONENT_SUB,
  );

  expect(playerResult).toMatchObject({
    result: 'win',
    shots_fired: 0,
    shots_hit: 0,
    survived: true,
  });
  expect(opponentResult).toMatchObject({
    result: 'loss',
    survived: false,
  });
});

async function installApiRoutes(
  page: Page,
  options: {
    getMatchmakingState: () => MatchmakingState;
    onJoinQueue: () => void;
    resultSaves: MatchResultsSave[];
  },
) {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        message: 'Welcome back, Duelist!',
        registered: false,
        user: USER,
      },
      status: 200,
    });
  });

  await page.route('**/api/assets/manifest', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        assets: [],
        expires_in_seconds: 3600,
      },
      status: 200,
    });
  });

  await page.route('**/api/mission-progress', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { missions: [] },
      status: 200,
    });
  });

  await page.route('**/api/matchmaking/queue', async (route) => {
    if (route.request().method() === 'POST') {
      options.onJoinQueue();
    }

    await route.fulfill({
      contentType: 'application/json',
      json: matchmakingResponse(options.getMatchmakingState()),
      status: 200,
    });
  });

  await page.route('**/api/matches/results', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: emptyResultsResponse(),
      status: 200,
    });
  });

  await page.route(`**/api/matches/${MATCH_ID}/results`, async (route) => {
    const payload = route.request().postDataJSON() as MatchResultsSave['payload'];
    options.resultSaves.push({ matchId: MATCH_ID, payload });

    await route.fulfill({
      contentType: 'application/json',
      json: finalizedResultsResponse(payload),
      status: 200,
    });
  });
}

function matchmakingResponse(state: MatchmakingState) {
  return state === 'matched'
    ? {
        arena_size: 'duel',
        match_session: MATCH_SESSION,
        queue_position: null,
        status: 'matched',
      }
    : {
        arena_size: null,
        match_session: null,
        queue_position: null,
        status: 'idle',
      };
}

function emptyResultsResponse() {
  return {
    results: [],
    summary: {
      draws: 0,
      losses: 0,
      matches_played: 0,
      total_damage_dealt: 0,
      total_damage_taken: 0,
      total_score: 0,
      total_shots_fired: 0,
      total_shots_hit: 0,
      updated_at: null,
      wins: 0,
    },
  };
}

function finalizedResultsResponse(payload: MatchResultsSave['payload']) {
  const results = payload.participants.map((participant) => ({
    damage_dealt: participant.damage_dealt,
    damage_taken: participant.damage_taken,
    duration_ms: 18_000,
    ended_at: '2026-07-15T00:01:00.000Z',
    map_key: 'duel-yard',
    match_id: MATCH_ID,
    mode: 'duel',
    recorded_at: '2026-07-15T00:01:00.000Z',
    result: participant.result,
    score: participant.score,
    shots_fired: participant.shots_fired,
    shots_hit: participant.shots_hit,
    stats: {},
    survived: participant.survived,
    user_sub: participant.user_sub,
    winner_sub: USER_SUB,
  }));

  return {
    match_id: MATCH_ID,
    results,
    status: 'recorded',
    summary: {
      draws: 0,
      losses: 0,
      matches_played: 1,
      total_damage_dealt: results.find((result) => result.user_sub === USER_SUB)?.damage_dealt ?? 0,
      total_damage_taken: results.find((result) => result.user_sub === USER_SUB)?.damage_taken ?? 0,
      total_score: results.find((result) => result.user_sub === USER_SUB)?.score ?? 0,
      total_shots_fired: results.find((result) => result.user_sub === USER_SUB)?.shots_fired ?? 0,
      total_shots_hit: results.find((result) => result.user_sub === USER_SUB)?.shots_hit ?? 0,
      updated_at: '2026-07-15T00:01:00.000Z',
      wins: 1,
    },
  };
}

function sendStateSnapshot(socket: WebSocketRoute) {
  socket.send(
    JSON.stringify({
      kind: 'state_snapshot',
      payload: {
        players: [
          {
            health: 100,
            position: [-1.7, 0.84, 2.15],
            speed: 0,
            user_sub: USER_SUB,
          },
          {
            health: 100,
            position: [1.7, 0.8, -2.15],
            speed: 0,
            user_sub: OPPONENT_SUB,
          },
        ],
        sequence: 1,
      },
      server_time: '2026-07-15T00:00:01.000Z',
      user_sub: 'server',
    }),
  );
}

function parseSocketMessage(message: string | Buffer): unknown {
  const raw = Buffer.isBuffer(message) ? message.toString('utf8') : message;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function isFireCommand(value: unknown): value is { type: 'fire' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type?: unknown }).type === 'fire'
  );
}
