import type {
  AssetManifestResponse,
  AuthSessionResponse,
  HealthResponse,
  MissionProgressListResponse,
  MissionProgressUpdatePayload,
  MissionProgressUpdateResponse,
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

export async function fetchMissionProgress(
  signal?: AbortSignal,
): Promise<MissionProgressListResponse | null> {
  const response = await fetch(`${API_BASE_URL}/api/mission-progress`, {
    credentials: 'include',
    signal,
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Mission progress check failed with status ${response.status}`);
  }

  return response.json() as Promise<MissionProgressListResponse>;
}

export async function saveMissionProgress(
  missionKey: string,
  payload: MissionProgressUpdatePayload,
  signal?: AbortSignal,
): Promise<MissionProgressUpdateResponse | null> {
  const response = await fetch(
    `${API_BASE_URL}/api/mission-progress/${encodeURIComponent(missionKey)}`,
    {
      body: JSON.stringify(payload),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
      signal,
    },
  );

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Mission progress save failed with status ${response.status}`);
  }

  return response.json() as Promise<MissionProgressUpdateResponse>;
}

export function authRedirectUrl(mode: 'login' | 'register'): string {
  return `${API_BASE_URL}/api/auth/${mode}`;
}
