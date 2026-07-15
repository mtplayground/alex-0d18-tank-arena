import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { authRedirectUrl, fetchCurrentSession } from '../api/client';
import { AuthContext } from './context';
import type { AuthContextValue, AuthState } from './types';

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const loadSession = useCallback(async (signal?: AbortSignal) => {
    setState({ status: 'loading' });

    try {
      const session = await fetchCurrentSession(signal);

      if (!session) {
        setState({ status: 'unauthenticated' });
        return;
      }

      setState({
        status: 'authenticated',
        user: session.user,
        message: session.message,
        registered: session.registered,
      });
    } catch (error: unknown) {
      if (signal?.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unable to check session';
      setState({ status: 'error', message });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void loadSession(controller.signal);

    return () => controller.abort();
  }, [loadSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      loginUrl: authRedirectUrl('login'),
      registerUrl: authRedirectUrl('register'),
      refresh: () => loadSession(),
    }),
    [loadSession, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
