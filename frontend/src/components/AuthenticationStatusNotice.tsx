import type { AuthSessionFailureKind } from '../api/client';

type AuthenticationStatusNoticeProps = {
  failureKind?: AuthSessionFailureKind;
  loginUrl: string;
  onRetry: () => void;
  status: 'error' | 'unauthenticated';
};

export function AuthenticationStatusNotice({
  failureKind,
  loginUrl,
  onRetry,
  status,
}: AuthenticationStatusNoticeProps) {
  const content = statusContent(status, failureKind);

  return (
    <section className="auth-status-notice" role="alert" aria-live="assertive">
      <div>
        <p className="eyebrow">{content.eyebrow}</p>
        <p>{content.message}</p>
      </div>
      <div className="auth-status-actions">
        {status === 'error' ? (
          <button className="secondary-action" type="button" onClick={onRetry}>
            Retry session check
          </button>
        ) : null}
        <a className="secondary-action" href={loginUrl}>
          Sign in again
        </a>
      </div>
    </section>
  );
}

function statusContent(status: 'error' | 'unauthenticated', failureKind?: AuthSessionFailureKind) {
  if (status === 'unauthenticated') {
    return {
      eyebrow: 'Sign in required',
      message:
        'You are not signed in, or your session has ended. Sign in again to open your dashboard.',
    };
  }

  if (failureKind === 'server') {
    return {
      eyebrow: 'Sign-in service unavailable',
      message: 'The service could not verify your session. Retry now or sign in again shortly.',
    };
  }

  return {
    eyebrow: 'Connection problem',
    message:
      'We could not reach the sign-in service. Check your connection, then retry or sign in again.',
  };
}
