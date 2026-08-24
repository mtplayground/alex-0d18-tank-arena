import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { expect, test, type Page, type Request, type Response } from '@playwright/test';

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

  await installUnauthenticatedRoutes(page, missionProgressRequests);

  await page.goto('/');

  const loginForm = page.locator('form.auth-form');
  await expect(loginForm).toHaveAttribute('action', '/api/auth/login');
  await expect(loginForm).toHaveAttribute('method', 'get');
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create a new profile' })).toHaveAttribute(
    'href',
    '/register',
  );

  await page.goto('/register');

  await expect(page.locator('form.auth-form')).toHaveAttribute('action', '/api/auth/register');
  await expect(page.locator('form.auth-form')).toHaveAttribute('method', 'get');
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'I already have access' })).toHaveAttribute(
    'href',
    '/login',
  );
  expect(missionProgressRequests).toEqual([]);
});

for (const entry of [
  {
    authEntryPath: '/api/auth/login',
    name: 'Continue with Google',
    open: async (page: Page) => page.goto('/'),
  },
  {
    authEntryPath: '/api/auth/register',
    name: 'Create a new profile',
    open: async (page: Page) => {
      await page.goto('/');
      await page.getByRole('link', { name: 'Create a new profile' }).click();
      await page.waitForURL((url) => url.pathname === '/register');
    },
  },
]) {
  test(`${entry.name} follows a GET-only platform authentication redirect chain`, async ({
    page,
  }) => {
    const missionProgressRequests: string[] = [];
    const redirectChain = await installAuthenticationRedirectChain(page, entry.authEntryPath);

    try {
      await installUnauthenticatedRoutes(page, missionProgressRequests);
      await entry.open(page);
      await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

      await page.getByRole('button', { name: 'Continue with Google' }).click();
      await page.waitForURL(
        (url) => url.pathname === '/' && url.searchParams.get('auth_complete') === '1',
      );
      await expect.poll(() => redirectChain.responses.length).toBe(4);

      expect(redirectChain.requests.map((request) => request.method())).toEqual([
        'GET',
        'GET',
        'GET',
        'GET',
      ]);
      expect(redirectChain.requests.map((request) => new URL(request.url()).pathname)).toEqual([
        entry.authEntryPath,
        '/.ideavibes/auth/login',
        '/.ideavibes/auth/authorize',
        '/',
      ]);
      expect(redirectChain.responses.map((response) => response.status())).toEqual([
        302, 302, 302, 200,
      ]);
      expect(redirectChain.responses.some((response) => response.status() === 405)).toBe(false);
      expect(missionProgressRequests).toEqual([]);
    } finally {
      await redirectChain.close();
    }
  });
}

async function installAuthenticationRedirectChain(page: Page, authEntryPath: string) {
  const requests: Request[] = [];
  const responses: Response[] = [];
  const platform = await startPlatformAuthenticationServer();

  const isChainRequest = (url: string) => {
    const parsedUrl = new URL(url);

    return (
      parsedUrl.pathname === authEntryPath ||
      (parsedUrl.origin === platform.origin &&
        (parsedUrl.pathname === '/.ideavibes/auth/login' ||
          parsedUrl.pathname === '/.ideavibes/auth/authorize')) ||
      (parsedUrl.pathname === '/' && parsedUrl.searchParams.get('auth_complete') === '1')
    );
  };

  page.on('request', (request) => {
    if (isChainRequest(request.url())) {
      requests.push(request);
    }
  });
  page.on('response', (response) => {
    if (isChainRequest(response.url())) {
      responses.push(response);
    }
  });

  await page.route(
    (url) => url.pathname === authEntryPath,
    (route) =>
      route.fulfill({
        body: '',
        headers: { Location: `${platform.origin}/.ideavibes/auth/login?return_to=%2F` },
        status: 302,
      }),
  );

  return { close: platform.close, requests, responses };
}

async function startPlatformAuthenticationServer() {
  const server = createServer(
    (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => {
      const url = new URL(request.url ?? '/', 'http://platform-auth.test');

      if (url.pathname === '/.ideavibes/auth/login') {
        response.writeHead(302, { Location: '/.ideavibes/auth/authorize?state=e2e' });
        response.end();
        return;
      }

      if (url.pathname === '/.ideavibes/auth/authorize') {
        response.writeHead(302, { Location: 'http://127.0.0.1:4173/?auth_complete=1' });
        response.end();
        return;
      }

      response.writeHead(404);
      response.end();
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    throw new Error('platform authentication test server did not bind a TCP port');
  }

  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    origin: `http://127.0.0.1:${address.port}`,
  };
}

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
