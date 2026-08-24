import type { UserProfile } from '../../../shared/protocol';
import type { AuthSessionFailureKind } from '../api/client';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | {
      status: 'authenticated';
      user: UserProfile;
      message: string;
      registered: boolean;
    }
  | { status: 'error'; failureKind: AuthSessionFailureKind; message: string };

export type AuthContextValue = AuthState & {
  loginUrl: string;
  registerUrl: string;
  refresh: () => Promise<void>;
};
