import { useCallback, useEffect, useState } from 'react';

import { fetchAssetManifest } from '../api/client';
import type { AssetManifestResponse } from '../../../shared/protocol';

export type AssetManifestState =
  | { status: 'loading'; retry: () => void }
  | { status: 'ready'; manifest: AssetManifestResponse; retry: () => void }
  | { status: 'unavailable'; message: string; retry: () => void };

type AssetManifestStateWithoutRetry =
  | { status: 'loading' }
  | { status: 'ready'; manifest: AssetManifestResponse }
  | { status: 'unavailable'; message: string };

export function useAssetManifest(): AssetManifestState {
  const [requestNumber, setRequestNumber] = useState(0);
  const retry = useCallback(() => setRequestNumber((current) => current + 1), []);
  const [state, setState] = useState<AssetManifestStateWithoutRetry>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    fetchAssetManifest(controller.signal)
      .then((manifest) => {
        if (!controller.signal.aborted) {
          setState({ status: 'ready', manifest });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({ status: 'unavailable', message: assetFailureMessage(error) });
      });

    return () => controller.abort();
  }, [requestNumber]);

  if (state.status === 'ready') {
    return { ...state, retry };
  }

  if (state.status === 'unavailable') {
    return { ...state, retry };
  }

  return { ...state, retry };
}

function assetFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes('timed out')) {
    return 'Optional arena assets took too long to load. The procedural battlefield is active.';
  }

  return 'Optional arena assets are unavailable. The procedural battlefield is active.';
}
