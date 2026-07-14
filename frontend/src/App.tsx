import { useEffect, useState } from 'react';

import { fetchHealth } from './api/client';
import { ScenePreview } from './components/ScenePreview';
import type { HealthResponse } from '../../shared/protocol';

type ApiState =
  | { status: 'loading' }
  | { status: 'ready'; health: HealthResponse }
  | { status: 'error'; message: string };

export function App() {
  const [apiState, setApiState] = useState<ApiState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetchHealth(controller.signal)
      .then((health) => setApiState({ status: 'ready', health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Unable to reach API';
        setApiState({ status: 'error', message });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="scene-panel" aria-label="3D rendering preview">
          <ScenePreview />
        </div>

        <aside className="status-panel">
          <p className="eyebrow">Issue #1 scaffold</p>
          <h1>React, Three.js, and Axum workspace</h1>
          <p className="summary">
            Frontend routing, a React Three Fiber scene, shared protocol types, and a Rust API shell
            are wired for upcoming feature work.
          </p>

          <div className="status-list" aria-live="polite">
            <StatusItem label="Frontend" value="Vite + React" state="ready" />
            <StatusItem label="3D renderer" value="React Three Fiber" state="ready" />
            <StatusItem
              label="Backend"
              value={apiState.status === 'ready' ? apiState.health.version : apiState.status}
              state={apiState.status === 'error' ? 'error' : 'ready'}
            />
          </div>

          {apiState.status === 'error' ? <p className="error-text">{apiState.message}</p> : null}
        </aside>
      </section>
    </main>
  );
}

function StatusItem({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: 'ready' | 'error';
}) {
  return (
    <div className="status-item">
      <span className={`status-dot ${state}`} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
