import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import * as THREE from 'three';
import { useReducedMotion } from '@/hooks/useReducedMotion';

gsap.registerPlugin(ScrollTrigger);

const NUM_LOGOS = 12;
const RADIUS = 2.5;
// UV coordinates for each logo in the 4x3 atlas
function getUVForIndex(index: number): [number, number, number, number] {
  const col = index % 3;
  const row = Math.floor(index / 3);
  const u0 = col / 3;
  const v0 = 1 - (row + 1) / 4;
  const u1 = (col + 1) / 3;
  const v1 = 1 - row / 4;
  return [u0, v0, u1, v1];
}

function LogoPlane({ index, position, target }: {
  index: number;
  position: [number, number, number];
  target: THREE.Vector3;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const texture = useTexture('./images/client-logos.png');
  const [u0, v0, u1, v1] = useMemo(() => getUVForIndex(index), [index]);

  const material = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }, [texture]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(0.6, 0.24);
    const uvAttr = geo.attributes.uv;
    // Apply atlas UVs
    uvAttr.setXY(0, u0, v1);
    uvAttr.setXY(1, u1, v1);
    uvAttr.setXY(2, u0, v0);
    uvAttr.setXY(3, u1, v0);
    uvAttr.needsUpdate = true;
    return geo;
  }, [u0, v0, u1, v1]);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.lookAt(target);
    }
  });

  return (
    <mesh ref={meshRef} position={position} geometry={geometry} material={material} />
  );
}

function OrbitalRing({ reducedMotion }: { reducedMotion: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const clockRef = useRef(new THREE.Clock());
  const [dragging, setDragging] = useState(false);
  const lastX = useRef(0);
  const dragOffset = useRef(0);
  const rotationOffset = useRef(0);

  const handlePointerDown = useCallback((e: THREE.Event) => {
    setDragging(true);
    lastX.current = (e as any).clientX || 0;
  }, []);

  const handlePointerMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;
    const delta = e.clientX - lastX.current;
    dragOffset.current += delta * 0.005;
    lastX.current = e.clientX;
  }, [dragging]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
    rotationOffset.current += dragOffset.current;
    dragOffset.current = 0;
  }, []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
    }
  }, [dragging, handlePointerMove, handlePointerUp]);

  useFrame(() => {
    if (!groupRef.current) return;
    const time = clockRef.current.getElapsedTime();
    const autoRotation = reducedMotion ? 0 : time * 0.3;
    const totalRotation = autoRotation + rotationOffset.current + dragOffset.current;

    for (let i = 0; i < NUM_LOGOS; i++) {
      const child = groupRef.current.children[i];
      if (!child) continue;
      const angle = (i / NUM_LOGOS) * Math.PI * 2 + totalRotation;
      const bobY = Math.sin(time + i) * 0.15;
      child.position.set(
        Math.cos(angle) * RADIUS,
        bobY,
        Math.sin(angle) * RADIUS
      );
    }
  });

  return (
    <group
      ref={groupRef}
      onPointerDown={handlePointerDown as any}
    >
      {Array.from({ length: NUM_LOGOS }, (_, i) => (
        <LogoPlane
          key={i}
          index={i}
          position={[0, 0, 0]}
          target={new THREE.Vector3(0, 0, 0)}
        />
      ))}
    </group>
  );
}

export default function TrustedBy() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!sectionRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        headingRef.current,
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: headingRef.current,
            start: 'top 80%',
          },
        }
      );

      gsap.fromTo(
        canvasWrapRef.current,
        { scale: 0.8, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 1.2,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: canvasWrapRef.current,
            start: 'top 80%',
          },
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, [reducedMotion]);

  return (
    <section
      ref={sectionRef}
      style={{
        padding: 'clamp(5rem, 10vw, 10rem) clamp(1.5rem, 5vw, 6rem)',
      }}
    >
      <h2
        ref={headingRef}
        className="font-display font-bold uppercase text-[#FAFAFA] text-center"
        style={{
          fontSize: 'clamp(2.5rem, 8vw, 8rem)',
          lineHeight: 0.85,
          letterSpacing: '-0.02em',
          opacity: 0,
        }}
      >
        Trusted By Industry Leaders
      </h2>

      {/* Orbital Logo Canvas */}
      <div
        ref={canvasWrapRef}
        style={{
          width: '100%',
          height: '60vh',
          marginTop: '4rem',
          opacity: 0,
        }}
        aria-label="Client logos displayed in a 3D ring"
      >
        <Canvas
          camera={{ position: [0, 0, 6], fov: 45 }}
          style={{ background: '#09090B' }}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl }) => {
            gl.setClearColor('#09090B');
          }}
        >
          <OrbitalRing reducedMotion={reducedMotion} />
        </Canvas>
      </div>

      <p
        className="text-[#A1A1AA] text-center mx-auto"
        style={{
          fontSize: 'clamp(1.125rem, 1.5vw, 1.5rem)',
          fontWeight: 400,
          lineHeight: 1.5,
          maxWidth: '48ch',
          marginTop: '3rem',
        }}
      >
        From startups to enterprises, we partner with organizations ready to transform.
      </p>
    </section>
  );
}
