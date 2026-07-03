import { useRef, useMemo, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const NODE_COUNT = 140;
const CONNECT_DIST = 1.9;
const FIELD = { x: 7, y: 4, z: 3 };
const ACCENT = '#DFE104';

interface NetworkData {
  positions: Float32Array;
  linePositions: Float32Array;
}

function buildNetwork(): NetworkData {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    points.push(
      new THREE.Vector3(
        (Math.random() - 0.5) * FIELD.x * 2,
        (Math.random() - 0.5) * FIELD.y * 2,
        (Math.random() - 0.5) * FIELD.z * 2
      )
    );
  }

  const positions = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  });

  const linePts: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (points[i].distanceTo(points[j]) < CONNECT_DIST) {
        linePts.push(points[i].x, points[i].y, points[i].z);
        linePts.push(points[j].x, points[j].y, points[j].z);
      }
    }
  }

  return { positions, linePositions: new Float32Array(linePts) };
}

function Network() {
  const groupRef = useRef<THREE.Group>(null);
  const clockRef = useRef(new THREE.Clock());
  const pointer = useRef({ x: 0, y: 0 });
  const targetRotation = useRef({ x: 0, y: 0 });

  const { positions, linePositions } = useMemo(() => buildNetwork(), []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [handlePointerMove]);

  useFrame(() => {
    if (!groupRef.current) return;
    const time = clockRef.current.getElapsedTime();

    const autoY = time * 0.045;
    targetRotation.current.y = autoY + pointer.current.x * 0.35;
    targetRotation.current.x = pointer.current.y * -0.15;

    groupRef.current.rotation.y += (targetRotation.current.y - groupRef.current.rotation.y) * 0.04;
    groupRef.current.rotation.x += (targetRotation.current.x - groupRef.current.rotation.x) * 0.04;
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={ACCENT}
          size={0.055}
          sizeAttenuation
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color={ACCENT}
          transparent
          opacity={0.14}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

function ResponsiveCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    const persp = camera as THREE.PerspectiveCamera;
    persp.position.z = aspect < 1 ? 9 / aspect : 6.5;
    persp.updateProjectionMatrix();
  }, [size, camera]);
  return null;
}

export default function HeroScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 6.5], fov: 55 }}
      style={{ background: 'transparent' }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 1.5]}
    >
      <ResponsiveCamera />
      <Network />
    </Canvas>
  );
}
