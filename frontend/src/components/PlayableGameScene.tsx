import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CameraRig } from '../terrain/CameraRig';
import { TankMovementController } from '../terrain/TankMovementController';
import { createInitialTankPose, type TankPose } from '../terrain/tankState';
import { useAssetManifest } from '../terrain/useAssetManifest';
import { ArenaEnvironment } from './ArenaEnvironment';
import { AssetFallbackNotice } from './AssetFallbackNotice';
import { ErrorBoundary } from './ErrorBoundary';

type SceneStatus = 'failed' | 'loading' | 'ready';

export function PlayableGameScene() {
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('loading');
  const [sceneKey, setSceneKey] = useState(0);
  const [optionalAssetsUnavailable, setOptionalAssetsUnavailable] = useState(false);
  const assetManifest = useAssetManifest();
  const retryScene = useCallback(() => {
    setSceneStatus('loading');
    setSceneKey((current) => current + 1);
  }, []);
  const markReady = useCallback(() => setSceneStatus('ready'), []);
  const markFailed = useCallback(() => setSceneStatus('failed'), []);
  const markOptionalAssetsUnavailable = useCallback(() => setOptionalAssetsUnavailable(true), []);
  const retryAssets = useCallback(() => {
    setOptionalAssetsUnavailable(false);
    assetManifest.retry();
  }, [assetManifest]);
  const assetFallbackMessage =
    assetManifest.status === 'unavailable'
      ? assetManifest.message
      : 'Some optional arena assets could not be loaded. The procedural battlefield is active.';
  const showAssetFallback = assetManifest.status === 'unavailable' || optionalAssetsUnavailable;

  return (
    <div className="playable-scene-shell">
      <ErrorBoundary
        fallback={(resetBoundary) => (
          <SceneFailureFallback
            onRetry={() => {
              retryScene();
              resetBoundary();
            }}
          />
        )}
      >
        {sceneStatus === 'failed' ? (
          <SceneFailureFallback onRetry={retryScene} />
        ) : (
          <>
            {showAssetFallback ? (
              <AssetFallbackNotice message={assetFallbackMessage} onRetry={retryAssets} />
            ) : null}
            {sceneStatus === 'loading' ? <SceneLoadingOverlay /> : null}
            <Canvas
              key={sceneKey}
              shadows
              className="scene-preview"
              camera={{ position: [5.6, 4.6, 6.4], fov: 46 }}
              fallback={<CanvasUnavailable onFailure={markFailed} />}
              onCreated={markReady}
            >
              <PlayableBattlefield
                assetManifest={assetManifest}
                onAssetUnavailable={markOptionalAssetsUnavailable}
              />
            </Canvas>
          </>
        )}
      </ErrorBoundary>
    </div>
  );
}

function CanvasUnavailable({ onFailure }: { onFailure: () => void }) {
  useEffect(() => {
    onFailure();
  }, [onFailure]);

  return null;
}

function SceneLoadingOverlay() {
  return (
    <div className="scene-loading" role="status" aria-live="polite">
      <div className="loader" aria-hidden="true" />
      <p>Preparing the 3D arena</p>
    </div>
  );
}

function SceneFailureFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="scene-recovery" role="alert" aria-live="assertive">
      <p className="eyebrow">Arena unavailable</p>
      <h2>We could not start the 3D arena.</h2>
      <p>Other dashboard controls remain available.</p>
      <button className="secondary-action" type="button" onClick={onRetry}>
        Retry arena
      </button>
    </section>
  );
}

type PlayableBattlefieldProps = {
  assetManifest: ReturnType<typeof useAssetManifest>;
  onAssetUnavailable: () => void;
};

function PlayableBattlefield({ assetManifest, onAssetUnavailable }: PlayableBattlefieldProps) {
  const tankPoseRef = useRef<TankPose>(createInitialTankPose());

  return (
    <>
      <ArenaEnvironment assetManifest={assetManifest} onAssetUnavailable={onAssetUnavailable} />
      <TankMovementController poseRef={tankPoseRef} />
      <CameraRig poseRef={tankPoseRef} />
    </>
  );
}
