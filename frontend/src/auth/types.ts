import type { UserProfile } from '../../../shared/protocol';

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
  | { status: 'error'; message: string };

export type AuthContextValue = AuthState & {
  loginUrl: string;
  registerUrl: string;
  refresh: () => Promise<void>;
};
