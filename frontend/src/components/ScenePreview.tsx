import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';

import { TerrainRenderer } from '../terrain/TerrainRenderer';

function Marker() {
  return (
    <group position={[0, 0.45, 0]}>
      <mesh castShadow>
        <boxGeometry args={[1.2, 0.45, 1.8]} />
        <meshStandardMaterial color="#465468" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[0.7, 0.35, 0.85]} />
        <meshStandardMaterial color="#59697d" roughness={0.45} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.42, -0.9]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 1.2, 16]} />
        <meshStandardMaterial color="#2f3744" roughness={0.4} metalness={0.4} />
      </mesh>
    </group>
  );
}

export function ScenePreview() {
  return (
    <Canvas shadows className="scene-preview">
      <PerspectiveCamera makeDefault position={[5.6, 4.6, 6.4]} fov={46} />
      <color attach="background" args={['#dce5e7']} />
      <fog attach="fog" args={['#dce5e7', 9, 18]} />
      <ambientLight intensity={0.48} />
      <directionalLight
        castShadow
        intensity={2}
        position={[4.5, 7, 3.5]}
        shadow-mapSize-height={1024}
        shadow-mapSize-width={1024}
      />
      <TerrainRenderer />
      <Marker />
      <OrbitControls
        enablePan={false}
        maxDistance={10}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={4.5}
        target={[0, 0.2, 0]}
      />
    </Canvas>
  );
}
