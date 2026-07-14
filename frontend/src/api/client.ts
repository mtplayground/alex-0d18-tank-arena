import type { HealthResponse } from '../../../shared/protocol';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/health`, { signal });

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
}
