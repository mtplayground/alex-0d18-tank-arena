import { useEffect, useMemo, useState } from 'react';
import {
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from 'three';
import type { Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { BoxSilhouette, DodecahedronSilhouette } from './Silhouette';
import {
  RIDGE_MARKERS,
  createRubblePieces,
  createStructures,
  createTerrainGeometry,
  type RidgeMarker,
  type RubblePiece,
  type StructurePiece,
} from './battlefield';
import {
  DEFAULT_SIGHT_END,
  DEFAULT_SIGHT_START,
  evaluateProjectilePath,
  type LineOfSightResult,
} from './occlusion';
import { useAssetManifest } from './useAssetManifest';
import { TACTICAL_COLORS } from './visualStyle';

type TerrainAssetUrls = {
  terrainModelUrl?: string;
  terrainTextureUrl?: string;
};

export function TerrainRenderer() {
  const manifest = useAssetManifest();
  const urls = useMemo<TerrainAssetUrls>(() => {
    if (manifest.status !== 'ready') {
      return {};
    }

    return {
      terrainModelUrl: manifest.manifest.assets.find(
        (asset) => asset.category === 'terrain' && asset.id === 'training-grounds',
      )?.url,
      terrainTextureUrl: manifest.manifest.assets.find(
        (asset) => asset.category === 'textures' && asset.id === 'terrain-albedo',
      )?.url,
    };
  }, [manifest]);
  const terrainModel = useStoredTerrainModel(urls.terrainModelUrl);
  const terrainTexture = useStoredTerrainTexture(urls.terrainTextureUrl);
  const fallbackGeometry = useMemo(() => createTerrainGeometry(), []);
  const rubblePieces = useMemo(createRubblePieces, []);
  const structures = useMemo(createStructures, []);
  const sightResult = useMemo(
    () => evaluateProjectilePath(DEFAULT_SIGHT_START, DEFAULT_SIGHT_END, 0.08),
    [],
  );

  return (
    <group>
      <mesh receiveShadow geometry={fallbackGeometry}>
        <meshStandardMaterial
          color={terrainTexture ? TACTICAL_COLORS.groundLight : TACTICAL_COLORS.ground}
          map={terrainTexture ?? undefined}
          flatShading
          roughness={0.92}
          metalness={0.02}
        />
      </mesh>

      {terrainModel ? <primitive object={terrainModel} position={[0, 0.04, 0]} /> : null}

      <RidgeMarkers markers={RIDGE_MARKERS} />
      <RubbleField pieces={rubblePieces} />
      <Structures pieces={structures} />
      <LineOfSightProbe result={sightResult} />
    </group>
  );
}

function RidgeMarkers({ markers }: { markers: RidgeMarker[] }) {
  return (
    <group>
      {markers.map((marker) => (
        <group key={marker.id}>
          <BoxSilhouette
            args={[1, 1, 1]}
            expansion={1.035}
            position={marker.position}
            rotation={marker.rotation}
            scale={marker.scale}
          />
          <mesh
            position={marker.position}
            rotation={marker.rotation}
            scale={marker.scale}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={marker.color} flatShading roughness={0.95} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function RubbleField({ pieces }: { pieces: RubblePiece[] }) {
  return (
    <group>
      {pieces.map((piece, index) => (
        <group key={`${piece.position.join(':')}-${index}`}>
          <DodecahedronSilhouette
            position={piece.position}
            rotation={piece.rotation}
            scale={piece.scale}
          />
          <mesh
            position={piece.position}
            rotation={piece.rotation}
            scale={piece.scale}
            castShadow
            receiveShadow
          >
            <dodecahedronGeometry args={[0.18, 0]} />
            <meshStandardMaterial
              color={index % 2 === 0 ? TACTICAL_COLORS.rubble : TACTICAL_COLORS.rubbleCool}
              flatShading
              roughness={0.88}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function LineOfSightProbe({ result }: { result: LineOfSightResult }) {
  const lineGeometry = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setFromPoints([
      new Vector3(result.start[0], result.start[1], result.start[2]),
      new Vector3(result.end[0], result.end[1], result.end[2]),
    ]);
    return geometry;
  }, [result]);

  useEffect(() => () => lineGeometry.dispose(), [lineGeometry]);

  const material = useMemo(
    () =>
      new LineBasicMaterial({
        color: result.clear ? TACTICAL_COLORS.sightClear : TACTICAL_COLORS.sightBlocked,
        linewidth: 2,
        transparent: true,
        opacity: 1,
      }),
    [result.clear],
  );

  useEffect(() => () => material.dispose(), [material]);

  const lineObject = useMemo(() => new Line(lineGeometry, material), [lineGeometry, material]);

  return (
    <group>
      <primitive object={lineObject} />
      <mesh position={result.start}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color={TACTICAL_COLORS.sightCore}
          emissive={TACTICAL_COLORS.sightClear}
          emissiveIntensity={0.45}
        />
      </mesh>
      <mesh position={result.end}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color={TACTICAL_COLORS.sightCore}
          emissive={TACTICAL_COLORS.sightClear}
          emissiveIntensity={0.45}
        />
      </mesh>
      {result.hit ? (
        <mesh position={result.hit.point}>
          <sphereGeometry args={[0.16, 18, 18]} />
          <meshStandardMaterial
            color={TACTICAL_COLORS.sightBlocked}
            emissive={TACTICAL_COLORS.sightBlocked}
            emissiveIntensity={0.5}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function Structures({ pieces }: { pieces: StructurePiece[] }) {
  return (
    <group>
      {pieces.map((piece, index) => (
        <group key={`${piece.position.join(':')}-${index}`}>
          <BoxSilhouette args={[1, 1, 1]} position={piece.position} scale={piece.scale} />
          <mesh position={piece.position} scale={piece.scale} castShadow receiveShadow>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial
              color={index % 2 === 0 ? TACTICAL_COLORS.concrete : TACTICAL_COLORS.concreteDark}
              flatShading
              roughness={0.72}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function useStoredTerrainModel(url?: string): Group | null {
  const [model, setModel] = useState<Group | null>(null);

  useEffect(() => {
    if (!url) {
      setModel(null);
      return undefined;
    }

    let cancelled = false;
    let loadedModel: Group | null = null;
    const loader = new GLTFLoader();

    loader.load(
      url,
      (gltf) => {
        if (cancelled) {
          disposeObject(gltf.scene);
          return;
        }

        gltf.scene.traverse((child) => {
          if (child instanceof Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        gltf.scene.scale.setScalar(1);
        loadedModel = gltf.scene;
        setModel(gltf.scene);
      },
      undefined,
      () => {
        if (!cancelled) {
          setModel(null);
        }
      },
    );

    return () => {
      cancelled = true;
      if (loadedModel) {
        disposeObject(loadedModel);
      }
      setModel(null);
    };
  }, [url]);

  return model;
}

function useStoredTerrainTexture(url?: string): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    if (!url) {
      setTexture(null);
      return undefined;
    }

    let cancelled = false;
    let loadedTexture: Texture | null = null;
    const loader = new TextureLoader();

    loader.load(
      url,
      (nextTexture) => {
        if (cancelled) {
          nextTexture.dispose();
          return;
        }

        nextTexture.colorSpace = SRGBColorSpace;
        nextTexture.wrapS = RepeatWrapping;
        nextTexture.wrapT = RepeatWrapping;
        nextTexture.repeat.set(3, 3);
        loadedTexture = nextTexture;
        setTexture(nextTexture);
      },
      undefined,
      () => {
        if (!cancelled) {
          setTexture(null);
        }
      },
    );

    return () => {
      cancelled = true;
      if (loadedTexture) {
        loadedTexture.dispose();
      }
      setTexture(null);
    };
  }, [url]);

  return texture;
}

function disposeObject(object: Object3D) {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    child.geometry?.dispose();
    disposeMaterial(child.material);
  });
}

function disposeMaterial(material: Material | Material[]) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }

  material.dispose();
}
