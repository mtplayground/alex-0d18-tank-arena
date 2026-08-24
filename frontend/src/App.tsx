import { useMemo } from 'react';

import { useAuth } from './auth/useAuth';
import { AuthenticationStatusNotice } from './components/AuthenticationStatusNotice';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PlayableGameScene } from './components/PlayableGameScene';
import { ScenePreview } from './components/ScenePreview';
import { MultiplayerDuelPanel } from './multiplayer/MultiplayerDuelPanel';

type AuthMode = 'login' | 'register';

export function App() {
  const auth = useAuth();
  const { route, authRedirectFailed } = useMemo(
    () => ({
      route: window.location.pathname,
      authRedirectFailed:
        new URLSearchParams(window.location.search).get('auth_error') === 'unavailable',
    }),
    [],
  );
  const requestedMode: AuthMode = route === '/register' ? 'register' : 'login';

  if (auth.status === 'loading') {
    return <LoadingScreen />;
  }

  if (auth.status === 'authenticated') {
    return <AuthenticatedHomeBoundary />;
  }

  if (auth.status === 'error') {
    return <AuthShell mode={requestedMode} authRedirectFailed={authRedirectFailed} />;
  }

  return <AuthShell mode={requestedMode} authRedirectFailed={authRedirectFailed} />;
}

function AuthenticatedHomeBoundary() {
  return (
    <ErrorBoundary fallback={(retry) => <DashboardRecovery onRetry={retry} />}>
      <AuthenticatedHome />
    </ErrorBoundary>
  );
}

function LoadingScreen() {
  return (
    <main className="app-shell auth-loading" aria-live="polite">
      <div className="loader" aria-hidden="true" />
      <p>Checking session</p>
    </main>
  );
}

function AuthShell({ mode, authRedirectFailed }: { mode: AuthMode; authRedirectFailed: boolean }) {
  return (
    <main className="app-shell">
      <section className="auth-layout">
        <div className="scene-panel auth-scene" aria-label="3D arena preview">
          <ScenePreview />
        </div>

        <AuthForm mode={mode} authRedirectFailed={authRedirectFailed} />
      </section>
    </main>
  );
}

function AuthForm({ mode, authRedirectFailed }: { mode: AuthMode; authRedirectFailed: boolean }) {
  const auth = useAuth();
  const isRegister = mode === 'register';
  const authEntryUrl = isRegister ? '/api/auth/register' : auth.loginUrl;

  return (
    <section className="auth-panel" aria-labelledby="auth-title">
      {auth.status === 'unauthenticated' || auth.status === 'error' ? (
        <AuthenticationStatusNotice
          authRedirectFailed={authRedirectFailed}
          failureKind={auth.status === 'error' ? auth.failureKind : undefined}
          loginUrl={authEntryUrl}
          onRetry={() => void auth.refresh()}
          status={auth.status}
        />
      ) : null}
      <p className="eyebrow">{isRegister ? 'Create access' : 'Secure access'}</p>
      <h1 id="auth-title">{isRegister ? 'Register for battle' : 'Enter the arena'}</h1>
      <p className="summary">
        {isRegister
          ? 'Create your player profile, then return here with a verified platform session.'
          : 'Sign in to continue into your player dashboard and mission workspace.'}
      </p>

      <form className="auth-form" action={authEntryUrl} method="get">
        <button className="primary-action" type="submit">
          Continue with Google
        </button>
      </form>

      <nav className="auth-switch" aria-label="Authentication options">
        {isRegister ? (
          <a href="/login">I already have access</a>
        ) : (
          <a href="/register">Create a new profile</a>
        )}
      </nav>
    </section>
  );
}

function AuthenticatedHome() {
  const auth = useAuth();

  if (auth.status !== 'authenticated') {
    return null;
  }

  const displayName = auth.user.name ?? auth.user.email;

  return (
    <main className="app-shell">
      <section className="dashboard-layout">
        <div className="scene-panel dashboard-scene" aria-label="Playable 3D arena">
          <ErrorBoundary fallback={(retry) => <ArenaRecovery onRetry={retry} />}>
            <PlayableGameScene />
          </ErrorBoundary>
        </div>

        <section className="dashboard-panel" aria-labelledby="dashboard-title">
          <div className="profile-row">
            {auth.user.picture_url ? (
              <img
                className="avatar"
                src={auth.user.picture_url}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="avatar avatar-fallback" aria-hidden="true">
                {displayName.slice(0, 1).toUpperCase()}
              </span>
            )}

            <div>
              <p className="eyebrow">Signed in</p>
              <h1 id="dashboard-title">{displayName}</h1>
            </div>
          </div>

          <p className="summary">{auth.message}</p>

          <div className="dashboard-grid">
            <StatusBlock label="Session" value="Platform cookie verified" />
            <StatusBlock
              label="Profile"
              value={auth.user.email_verified ? 'Email verified' : 'Email pending'}
            />
            <StatusBlock
              label="Password"
              value={auth.user.has_password ? 'Configured' : 'Platform managed'}
            />
          </div>

          <div className="dashboard-actions">
            <button className="secondary-action" type="button" onClick={() => void auth.refresh()}>
              Refresh session
            </button>
          </div>

          <ErrorBoundary fallback={(retry) => <MultiplayerRecovery onRetry={retry} />}>
            <MultiplayerDuelPanel user={auth.user} />
          </ErrorBoundary>
        </section>
      </section>
    </main>
  );
}

function DashboardRecovery({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="app-shell">
      <section className="dashboard-recovery" role="alert" aria-live="assertive">
        <p className="eyebrow">Workspace unavailable</p>
        <h1>We could not load your dashboard.</h1>
        <p className="summary">Your session is still active. Retry to restore the dashboard.</p>
        <button className="primary-action" type="button" onClick={onRetry}>
          Retry dashboard
        </button>
      </section>
    </main>
  );
}

function ArenaRecovery({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="scene-recovery" role="alert" aria-live="assertive">
      <p className="eyebrow">Arena unavailable</p>
      <h2>We could not load the playable arena.</h2>
      <p>Other dashboard controls remain available.</p>
      <button className="secondary-action" type="button" onClick={onRetry}>
        Retry arena
      </button>
    </section>
  );
}

function MultiplayerRecovery({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="multiplayer-recovery" role="alert" aria-live="assertive">
      <p className="eyebrow">Duel station unavailable</p>
      <h2>We could not load multiplayer.</h2>
      <p className="summary">Your profile and the playable arena can still be used.</p>
      <button className="secondary-action" type="button" onClick={onRetry}>
        Retry multiplayer
      </button>
    </section>
  );
}

function StatusBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-block">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
