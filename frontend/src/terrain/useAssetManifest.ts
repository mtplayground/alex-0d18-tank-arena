import { useEffect, useState } from 'react';

import { fetchAssetManifest } from '../api/client';
import type { AssetManifestResponse } from '../../../shared/protocol';

type AssetManifestState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: AssetManifestResponse }
  | { status: 'error'; message: string };

export function useAssetManifest(): AssetManifestState {
  const [state, setState] = useState<AssetManifestState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetchAssetManifest(controller.signal)
      .then((manifest) => setState({ status: 'ready', manifest }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Unable to load assets';
        setState({ status: 'error', message });
      });

    return () => controller.abort();
  }, []);

  return state;
}
