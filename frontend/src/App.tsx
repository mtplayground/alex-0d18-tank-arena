import { useMemo } from 'react';

import { useAuth } from './auth/useAuth';
import { ScenePreview } from './components/ScenePreview';

type AuthMode = 'login' | 'register';

export function App() {
  const auth = useAuth();
  const route = useMemo(() => window.location.pathname, []);
  const requestedMode: AuthMode = route === '/register' ? 'register' : 'login';

  if (auth.status === 'loading') {
    return <LoadingScreen />;
  }

  if (auth.status === 'authenticated') {
    return <AuthenticatedHome />;
  }

  if (auth.status === 'error') {
    return <AuthShell mode={requestedMode} error={auth.message} />;
  }

  return <AuthShell mode={requestedMode} />;
}

function LoadingScreen() {
  return (
    <main className="app-shell auth-loading" aria-live="polite">
      <div className="loader" aria-hidden="true" />
      <p>Checking session</p>
    </main>
  );
}

function AuthShell({ mode, error }: { mode: AuthMode; error?: string }) {
  return (
    <main className="app-shell">
      <section className="auth-layout">
        <div className="scene-panel auth-scene" aria-label="3D arena preview">
          <ScenePreview />
        </div>

        <AuthForm mode={mode} error={error} />
      </section>
    </main>
  );
}

function AuthForm({ mode, error }: { mode: AuthMode; error?: string }) {
  const auth = useAuth();
  const isRegister = mode === 'register';
  const action = isRegister ? auth.registerUrl : auth.loginUrl;

  return (
    <section className="auth-panel" aria-labelledby="auth-title">
      <p className="eyebrow">{isRegister ? 'Create access' : 'Secure access'}</p>
      <h1 id="auth-title">{isRegister ? 'Register for battle' : 'Enter the arena'}</h1>
      <p className="summary">
        {isRegister
          ? 'Create your player profile, then return here with a verified platform session.'
          : 'Sign in to continue into your player dashboard and mission workspace.'}
      </p>

      <form className="auth-form" action={action} method="post">
        <label>
          <span>Email</span>
          <input
            autoComplete="email"
            inputMode="email"
            name="email"
            placeholder="pilot@example.com"
            type="email"
          />
        </label>

        <button className="primary-action" type="submit">
          {isRegister ? 'Continue registration' : 'Continue sign in'}
        </button>
      </form>

      <nav className="auth-switch" aria-label="Authentication options">
        {isRegister ? (
          <a href="/login">I already have access</a>
        ) : (
          <a href="/register">Create a new profile</a>
        )}
      </nav>

      {error ? <p className="error-text">{error}</p> : null}
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
        <div className="scene-panel dashboard-scene" aria-label="3D arena preview">
          <ScenePreview />
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
        </section>
      </section>
    </main>
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
