import { useEffect, useMemo, useState } from 'react';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import type { Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { useAssetManifest } from './useAssetManifest';

type TerrainAssetUrls = {
  terrainModelUrl?: string;
  terrainTextureUrl?: string;
};

type RubblePiece = {
  position: [number, number, number];
  scale: [number, number, number];
  rotation: [number, number, number];
};

type StructurePiece = {
  position: [number, number, number];
  scale: [number, number, number];
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

  return (
    <group>
      <mesh receiveShadow geometry={fallbackGeometry}>
        <meshStandardMaterial
          color={terrainTexture ? '#ffffff' : '#718565'}
          map={terrainTexture ?? undefined}
          roughness={0.92}
          metalness={0.02}
        />
      </mesh>

      {terrainModel ? <primitive object={terrainModel} position={[0, 0.04, 0]} /> : null}

      <RidgeMarkers />
      <RubbleField pieces={rubblePieces} />
      <Structures pieces={structures} />
    </group>
  );
}

function RidgeMarkers() {
  return (
    <group>
      <mesh position={[-2.8, 0.42, -1.6]} rotation={[0.18, -0.45, -0.08]} castShadow receiveShadow>
        <boxGeometry args={[4.7, 0.42, 0.72]} />
        <meshStandardMaterial color="#687259" roughness={0.95} />
      </mesh>
      <mesh position={[2.4, 0.36, 1.4]} rotation={[-0.08, 0.68, 0.05]} castShadow receiveShadow>
        <boxGeometry args={[4.2, 0.36, 0.62]} />
        <meshStandardMaterial color="#596d62" roughness={0.95} />
      </mesh>
    </group>
  );
}

function RubbleField({ pieces }: { pieces: RubblePiece[] }) {
  return (
    <group>
      {pieces.map((piece, index) => (
        <mesh
          key={`${piece.position.join(':')}-${index}`}
          position={piece.position}
          rotation={piece.rotation}
          scale={piece.scale}
          castShadow
          receiveShadow
        >
          <dodecahedronGeometry args={[0.18, 0]} />
          <meshStandardMaterial color={index % 2 === 0 ? '#6e675f' : '#4f5960'} roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

function Structures({ pieces }: { pieces: StructurePiece[] }) {
  return (
    <group>
      {pieces.map((piece, index) => (
        <mesh
          key={`${piece.position.join(':')}-${index}`}
          position={piece.position}
          scale={piece.scale}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={index % 2 === 0 ? '#78828b' : '#5c6871'} roughness={0.72} />
        </mesh>
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

function createTerrainGeometry(): BufferGeometry {
  const segments = 56;
  const size = 12;
  const half = size / 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
    const z = (zIndex / segments) * size - half;

    for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
      const x = (xIndex / segments) * size - half;
      const y = terrainHeight(x, z);

      positions.push(x, y, z);
      uvs.push(xIndex / segments, zIndex / segments);
    }
  }

  for (let zIndex = 0; zIndex < segments; zIndex += 1) {
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const a = zIndex * (segments + 1) + xIndex;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;

      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

function terrainHeight(x: number, z: number): number {
  const ridgeA = Math.exp(-Math.abs(z + 1.6 + Math.sin(x * 0.7) * 0.5)) * 0.48;
  const ridgeB = Math.exp(-Math.abs(z - 1.4 - Math.cos(x * 0.55) * 0.6)) * 0.38;
  const brokenGround = Math.sin(x * 1.7) * Math.cos(z * 1.35) * 0.08;
  const crater = Math.exp(-(Math.pow(x + 1.2, 2) + Math.pow(z - 0.6, 2)) / 1.4) * -0.42;

  return ridgeA + ridgeB + brokenGround + crater - 0.1;
}

function createRubblePieces(): RubblePiece[] {
  return [
    [-3.8, -0.7, 0.7, 0.8, 0.5, 1.2, 0.1],
    [-3.2, -0.1, 1.1, 0.5, 0.8, 0.7, 0.6],
    [-2.5, 0.4, 0.8, 0.7, 0.7, 0.5, 1.1],
    [1.8, -0.6, 0.9, 0.9, 0.45, 0.6, 0.3],
    [2.5, 0.15, 1.4, 0.55, 0.7, 0.9, 0.9],
    [3.1, 0.8, 0.8, 0.7, 0.5, 0.6, 1.5],
    [0.4, 2.9, 0.7, 0.8, 0.45, 0.8, 0.2],
    [-0.5, 3.4, 1.0, 0.5, 0.6, 0.7, 1.3],
  ].map(([x, z, sx, sy, sz, ry, rz]) => ({
    position: [x, terrainHeight(x, z) + 0.18, z],
    scale: [sx, sy, sz],
    rotation: [0.4, ry, rz],
  }));
}

function createStructures(): StructurePiece[] {
  return [
    { position: [-4.6, terrainHeight(-4.6, 2.6) + 0.28, 2.6], scale: [1.7, 0.55, 0.42] },
    { position: [-3.7, terrainHeight(-3.7, 3.05) + 0.5, 3.05], scale: [0.46, 1, 0.46] },
    { position: [4.15, terrainHeight(4.15, -2.8) + 0.26, -2.8], scale: [1.45, 0.5, 0.5] },
    { position: [3.3, terrainHeight(3.3, -3.1) + 0.44, -3.1], scale: [0.4, 0.88, 0.4] },
  ];
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
