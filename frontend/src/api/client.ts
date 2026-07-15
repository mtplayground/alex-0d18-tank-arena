import type {
  AssetManifestResponse,
  AuthSessionResponse,
  HealthResponse,
} from '../../../shared/protocol';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/health`, { signal });

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
}

export async function fetchCurrentSession(
  signal?: AbortSignal,
): Promise<AuthSessionResponse | null> {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    credentials: 'include',
    signal,
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Session check failed with status ${response.status}`);
  }

  return response.json() as Promise<AuthSessionResponse>;
}

export async function fetchAssetManifest(signal?: AbortSignal): Promise<AssetManifestResponse> {
  const response = await fetch(`${API_BASE_URL}/api/assets/manifest`, { signal });

  if (!response.ok) {
    throw new Error(`Asset manifest failed with status ${response.status}`);
  }

  return response.json() as Promise<AssetManifestResponse>;
}

export function authRedirectUrl(mode: 'login' | 'register'): string {
  return `${API_BASE_URL}/api/auth/${mode}`;
}
