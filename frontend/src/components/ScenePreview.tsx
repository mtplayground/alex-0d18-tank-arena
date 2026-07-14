import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';

function TerrainPlate() {
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[8, 8, 32, 32]} />
      <meshStandardMaterial color="#6f7f5f" roughness={0.85} metalness={0.05} />
    </mesh>
  );
}

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
      <PerspectiveCamera makeDefault position={[4.5, 4.2, 5.5]} fov={45} />
      <ambientLight intensity={0.55} />
      <directionalLight
        castShadow
        intensity={1.8}
        position={[4, 6, 3]}
        shadow-mapSize-height={1024}
        shadow-mapSize-width={1024}
      />
      <TerrainPlate />
      <Marker />
      <gridHelper args={[8, 8, '#d6d9cf', '#9da792']} position={[0, 0.01, 0]} />
      <OrbitControls enablePan={false} maxPolarAngle={Math.PI / 2.2} minDistance={4} />
    </Canvas>
  );
}
