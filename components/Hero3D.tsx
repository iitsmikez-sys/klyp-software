"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const ACCENT = 0x00e5a0;

function buildPlayButton() {
  const group = new THREE.Group();

  // Rounded-triangle play shape
  const shape = new THREE.Shape();
  const r = 1.0;
  const corner = 0.22;
  const pts = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2;
    return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
  });
  pts.forEach((p, i) => {
    const next = pts[(i + 1) % 3];
    const dir = next.clone().sub(p).normalize();
    const start = p.clone().add(dir.clone().multiplyScalar(corner));
    const end = next.clone().sub(dir.clone().multiplyScalar(corner));
    if (i === 0) shape.moveTo(start.x, start.y);
    else shape.quadraticCurveTo(p.x, p.y, start.x, start.y);
    shape.lineTo(end.x, end.y);
  });
  shape.quadraticCurveTo(pts[0].x, pts[0].y, shape.currentPoint.x, shape.currentPoint.y);

  const triGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.35,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 4,
  });
  triGeo.center();
  const triMat = new THREE.MeshStandardMaterial({
    color: ACCENT,
    emissive: ACCENT,
    emissiveIntensity: 0.55,
    metalness: 0.35,
    roughness: 0.25,
  });
  const tri = new THREE.Mesh(triGeo, triMat);
  group.add(tri);

  // Surrounding clip ring
  const ringMat = new THREE.MeshStandardMaterial({
    color: ACCENT,
    emissive: ACCENT,
    emissiveIntensity: 0.3,
    metalness: 0.6,
    roughness: 0.3,
    transparent: true,
    opacity: 0.85,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.07, 16, 80), ringMat);
  group.add(ring);

  // Thin outer accent ring, tilted
  const outer = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.02, 8, 80), ringMat.clone());
  (outer.material as THREE.MeshStandardMaterial).opacity = 0.35;
  outer.rotation.x = Math.PI / 7;
  group.add(outer);

  return { group, triMat, ringMat };
}

function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(0,229,160,0.55)");
  g.addColorStop(0.4, "rgba(0,229,160,0.16)");
  g.addColorStop(1, "rgba(0,229,160,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export default function Hero3D() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isMobile = window.innerWidth < 768;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x060608, 14, 30);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
    camera.position.set(0, 0.4, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    mount.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.PointLight(ACCENT, 60, 30);
    key.position.set(4, 4, 6);
    scene.add(key);
    const fill = new THREE.PointLight(0xffffff, 25, 30);
    fill.position.set(-5, -2, 4);
    scene.add(fill);

    // Play button centerpiece
    const { group: button, triMat, ringMat } = buildPlayButton();
    scene.add(button);

    // Halo sprite behind the button
    const glowTex = makeGlowTexture();
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false })
    );
    halo.scale.setScalar(9);
    halo.position.z = -1.5;
    scene.add(halo);

    // Particle field
    const particleCount = isMobile ? 180 : 650;
    const positions = new Float32Array(particleCount * 3);
    const speeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 26;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 16;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 14 - 3;
      speeds[i] = 0.15 + Math.random() * 0.5;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        color: ACCENT,
        size: 0.045,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    scene.add(particles);

    // Holographic grid floor
    const grid = new THREE.GridHelper(40, 36, ACCENT, ACCENT);
    const gridMat = grid.material as THREE.Material & { opacity: number };
    gridMat.transparent = true;
    gridMat.opacity = 0.08;
    grid.position.y = -4.2;
    scene.add(grid);

    // Pointer / tilt parallax
    const target = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      target.x = THREE.MathUtils.clamp(e.gamma / 30, -1, 1);
      target.y = THREE.MathUtils.clamp((e.beta - 45) / 30, -1, 1);
    };
    window.addEventListener("pointermove", onPointer);
    if (isMobile) window.addEventListener("deviceorientation", onTilt);

    // Size to container
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // Only animate while on screen and tab visible
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(mount);

    let raf = 0;
    const clock = new THREE.Clock();

    const renderFrame = () => {
      const t = clock.getElapsedTime();

      button.rotation.y = t * 0.35;
      button.rotation.x = Math.sin(t * 0.4) * 0.12;
      button.position.y = Math.sin(t * 0.8) * 0.18;

      // Parallax lean toward pointer
      button.rotation.y += target.x * 0.4;
      button.rotation.x += target.y * 0.25;
      camera.position.x += (target.x * 0.6 - camera.position.x) * 0.04;
      camera.position.y += (0.4 - target.y * 0.4 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      // Pulsing glow
      const pulse = 0.55 + Math.sin(t * 2.2) * 0.25;
      triMat.emissiveIntensity = pulse;
      ringMat.emissiveIntensity = pulse * 0.55;
      halo.material.opacity = 0.7 + Math.sin(t * 2.2) * 0.2;
      halo.scale.setScalar(9 + Math.sin(t * 2.2) * 0.5);

      // Drift particles upward, wrap around
      const pos = pGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < particleCount; i++) {
        let y = pos.getY(i) + speeds[i] * 0.008;
        if (y > 8) y = -8;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;

      grid.position.z = (t * 0.6) % (40 / 36);

      renderer.render(scene, camera);
    };

    if (reducedMotion) {
      renderFrame(); // single static frame
    } else {
      const loop = () => {
        raf = requestAnimationFrame(loop);
        if (visible && !document.hidden) renderFrame();
      };
      loop();
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("deviceorientation", onTilt);
      renderer.dispose();
      glowTex.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m.dispose());
        }
      });
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      aria-hidden
      className="absolute inset-0 pointer-events-none"
    />
  );
}
