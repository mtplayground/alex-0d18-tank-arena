import { expect, test, type Page } from '@playwright/test';

type MissionProgressSave = {
  missionKey: string;
  payload: {
    attempts?: number;
    best_score: number | null;
    current_step: number;
    progress: Record<string, unknown>;
    status: string;
  };
};

const USER = {
  created_at: '2026-07-15T00:00:00.000Z',
  email: 'solo-pilot@example.com',
  email_verified: true,
  has_password: false,
  last_seen_at: '2026-07-15T00:00:00.000Z',
  name: 'Solo Pilot',
  picture_url: null,
  sub: 'user_solo_pilot',
  updated_at: '2026-07-15T00:00:00.000Z',
};

test('solo mission flow logs in, completes an AI engagement, and saves progress', async ({
  page,
}) => {
  const saves: MissionProgressSave[] = [];
  let signedIn = false;

  await installApiRoutes(page, {
    isSignedIn: () => signedIn,
    onLogin: () => {
      signedIn = true;
    },
    saves,
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Enter the arena' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('Welcome back, Solo Pilot!')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mission select' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();

  await page.getByRole('button', { name: 'Start' }).click();

  await expect(page.getByLabel('Mission sequence')).toContainText('Range Gate');
  await expect(page.getByLabel('Combat status')).toContainText('Target Integrity');
  await expect.poll(() => saves.some((save) => save.payload.status === 'in_progress')).toBe(true);

  for (let shot = 0; shot < 8; shot += 1) {
    if (
      await page
        .getByRole('heading', { name: 'Range Gate' })
        .isVisible()
        .catch(() => false)
    ) {
      break;
    }

    await page.getByRole('button', { name: 'Fire' }).click();
    await page.waitForTimeout(650);
  }

  await expect(page.getByRole('heading', { name: 'Range Gate' })).toBeVisible();
  await expect(page.getByText('Mission secured')).toBeVisible();
  await expect(page.getByText('Progress saved')).toBeVisible();

  const completedSave = saves.find(
    (save) => save.missionKey === 'range-gate' && save.payload.status === 'completed',
  );

  expect(completedSave).toBeTruthy();
  expect(completedSave?.payload.best_score).toBe(100);
  expect(completedSave?.payload.progress).toMatchObject({
    targetIntegrity: 0,
  });

  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Mission select' })).toBeVisible();
  await expect(page.getByText('1/5 clear')).toBeVisible();
});

async function installApiRoutes(
  page: Page,
  options: {
    isSignedIn: () => boolean;
    onLogin: () => void;
    saves: MissionProgressSave[];
  },
) {
  await page.route('**/api/auth/me', async (route) => {
    if (!options.isSignedIn()) {
      await route.fulfill({ body: '', status: 401 });
      return;
    }

    await route.fulfill({
      contentType: 'application/json',
      json: {
        message: 'Welcome back, Solo Pilot!',
        registered: false,
        user: USER,
      },
      status: 200,
    });
  });

  await page.route('**/api/auth/login', async (route) => {
    options.onLogin();
    await route.fulfill({
      body: '',
      headers: {
        Location: '/',
        'Set-Cookie': 'mctai_session=e2e-session; Path=/; SameSite=Lax',
      },
      status: 302,
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
      json: {
        missions: [
          {
            attempts: 1,
            best_score: null,
            completed_at: null,
            current_step: 0,
            mission_key: 'range-gate',
            progress: {
              targetIntegrity: 1,
            },
            status: 'in_progress',
            updated_at: '2026-07-15T00:00:00.000Z',
          },
        ],
      },
      status: 200,
    });
  });

  await page.route('**/api/mission-progress/*', async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as MissionProgressSave['payload'];
    const missionKey = new URL(request.url()).pathname.split('/').pop() ?? 'unknown';

    options.saves.push({ missionKey, payload });

    await route.fulfill({
      contentType: 'application/json',
      json: {
        mission: {
          attempts: payload.attempts ?? 1,
          best_score: payload.best_score,
          completed_at: payload.status === 'completed' ? '2026-07-15T00:00:10.000Z' : null,
          current_step: payload.current_step,
          mission_key: missionKey,
          progress: payload.progress,
          status: payload.status,
          updated_at: '2026-07-15T00:00:10.000Z',
        },
      },
      status: 200,
    });
  });

  await page.route('**/api/matchmaking/queue', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        arena_size: null,
        match_session: null,
        queue_position: null,
        status: 'idle',
      },
      status: 200,
    }),
  );

  await page.route('**/api/matches/results', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
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
      },
      status: 200,
    }),
  );
}
