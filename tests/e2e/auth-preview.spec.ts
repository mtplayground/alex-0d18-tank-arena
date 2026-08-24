import { expect, test, type Page, type Request } from '@playwright/test';

test('unauthenticated preview excludes game controls, input handlers, and mission progress requests', async ({
  page,
}) => {
  const missionProgressRequests: string[] = [];

  await installUnauthenticatedRoutes(page, missionProgressRequests);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Enter the arena' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mission select' })).toHaveCount(0);
  await expect(page.getByLabel('Mission sequence')).toHaveCount(0);
  await expect(page.getByLabel('Combat status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fire' })).toHaveCount(0);

  for (const readout of ['Hull', 'Turret', 'Damage', 'Mitigation']) {
    await expect(page.getByText(new RegExp(`^${readout}\\b`, 'i'))).toHaveCount(0);
  }

  const gameKeysPrevented = await page.evaluate(() =>
    [
      ['KeyW', 'w'],
      ['Space', ' '],
    ].map(([code, key]) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code, key });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  );

  expect(gameKeysPrevented).toEqual([false, false]);
  await page.waitForTimeout(150);
  expect(missionProgressRequests).toEqual([]);
});

test('authentication pages use the Google CTA and configured platform redirect', async ({
  page,
}) => {
  const missionProgressRequests: string[] = [];
  const loginRequests: Request[] = [];

  await installUnauthenticatedRoutes(page, missionProgressRequests);
  await page.route('**/api/auth/login', async (route) => {
    loginRequests.push(route.request());
    await route.fulfill({ body: '', headers: { Location: '/' }, status: 302 });
  });

  await page.goto('/');

  const loginForm = page.locator('form.auth-form');
  await expect(loginForm).toHaveAttribute('action', '/api/auth/login');
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create a new profile' })).toHaveAttribute(
    'href',
    '/register',
  );

  const loginRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/auth/login',
  );
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  expect((await loginRequest).method()).toBe('POST');
  expect(loginRequests).toHaveLength(1);

  await page.goto('/register');

  await expect(page.locator('form.auth-form')).toHaveAttribute('action', '/api/auth/login');
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'I already have access' })).toHaveAttribute(
    'href',
    '/login',
  );
  expect(missionProgressRequests).toEqual([]);
});

async function installUnauthenticatedRoutes(page: Page, missionProgressRequests: string[]) {
  await page.route('**/api/auth/me', (route) => route.fulfill({ body: '', status: 401 }));
  await page.route('**/api/assets/manifest', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: { assets: [], expires_in_seconds: 3600 },
      status: 200,
    }),
  );
  await page.route('**/api/mission-progress**', async (route) => {
    missionProgressRequests.push(route.request().method());
    await route.fulfill({ contentType: 'application/json', json: { missions: [] }, status: 200 });
  });
}
