import { TerrainRenderer } from '../terrain/TerrainRenderer';
import type { AssetManifestState } from '../terrain/useAssetManifest';
import { TACTICAL_COLORS } from '../terrain/visualStyle';

type ArenaEnvironmentProps = {
  assetManifest: AssetManifestState;
  onAssetUnavailable: () => void;
};

export function ArenaEnvironment({ assetManifest, onAssetUnavailable }: ArenaEnvironmentProps) {
  return (
    <>
      <color attach="background" args={[TACTICAL_COLORS.sky]} />
      <fog attach="fog" args={[TACTICAL_COLORS.fog, 9, 18]} />
      <ambientLight intensity={0.58} />
      <directionalLight
        castShadow
        intensity={2.35}
        position={[4.5, 7, 3.5]}
        shadow-mapSize-height={1024}
        shadow-mapSize-width={1024}
      />
      <TerrainRenderer assetManifest={assetManifest} onAssetUnavailable={onAssetUnavailable} />
    </>
  );
}
