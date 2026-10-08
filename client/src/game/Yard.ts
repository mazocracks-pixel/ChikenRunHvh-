import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOBBY_LAP, isSpaceFree, mulberry32, type CollisionWorld } from '@game/shared';

/**
 * The title screen's yard (the Courtyard map only): a worn dirt track along the chicken's lap,
 * painted grass tufts, and painted clouds drifting at a few distances. Everything is painted in
 * code, in the same soft hand-painted style as the chicken, and sits on the ground or in the sky:
 * nothing is drawn on the chicken.
 */

function paint(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  draw(ctx);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A band of packed dirt, ragged at both edges, with two faint ruts. u runs along the track. */
function trackTexture(): THREE.CanvasTexture {
  const rand = mulberry32(41);
  const t = paint(256, 128, (ctx) => {
    // The body of the band: overlapping blobs, so the edges come out uneven.
    for (let i = 0; i < 260; i++) {
      const x = rand() * 256;
      const y = 26 + rand() * 76;
      ctx.fillStyle = rand() < 0.5 ? 'rgba(150, 112, 70, 0.55)' : 'rgba(166, 128, 84, 0.55)';
      ctx.beginPath();
      ctx.ellipse(x, y, 10 + rand() * 18, 6 + rand() * 10, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Two ruts worn by running feet.
    ctx.strokeStyle = 'rgba(110, 80, 48, 0.32)';
    for (const y of [50, 78]) {
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x / 40) * 3);
      ctx.stroke();
    }
    // Pebbles kicked about.
    for (let i = 0; i < 70; i++) {
      const x = rand() * 256;
      const y = 34 + rand() * 60;
      ctx.fillStyle = rand() < 0.5 ? 'rgba(232, 214, 180, 0.8)' : 'rgba(118, 96, 70, 0.8)';
      ctx.beginPath();
      ctx.ellipse(x, y, 1.5 + rand() * 2.5, 1 + rand() * 1.8, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** One tuft: a fan of painted blades, darker at the base. */
function tuftTexture(): THREE.CanvasTexture {
  const rand = mulberry32(7);
  return paint(128, 128, (ctx) => {
    const greens = ['#7ea24a', '#8db255', '#6f9640', '#9dbd62'];
    for (let i = 0; i < 10; i++) {
      const lean = (rand() - 0.5) * 70;
      const height = 70 + rand() * 50;
      const base = 64 + (rand() - 0.5) * 30;
      ctx.fillStyle = greens[i % greens.length]!;
      ctx.beginPath();
      ctx.moveTo(base - 5, 128);
      ctx.quadraticCurveTo(base + lean * 0.3, 128 - height * 0.5, base + lean, 128 - height);
      ctx.quadraticCurveTo(base + lean * 0.3 + 3, 128 - height * 0.45, base + 5, 128);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(70, 92, 40, 0.35)';
    ctx.fillRect(34, 118, 60, 10);
  });
}

/** A puffy cloud: overlapping round puffs, a flat bottom, a cool shade underneath. */
function cloudTexture(seed: number): THREE.CanvasTexture {
  const rand = mulberry32(seed);
  return paint(256, 128, (ctx) => {
    const puffs: [number, number, number][] = [];
    const count = 6 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const x = 46 + (i / (count - 1)) * 164 + (rand() - 0.5) * 16;
      const r = 20 + rand() * 22 + (1 - Math.abs(i / (count - 1) - 0.5) * 2) * 16;
      puffs.push([x, 96 - r * 0.75, r]);
    }
    const shape = () => {
      ctx.beginPath();
      for (const [x, y, r] of puffs) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
      ctx.rect(40, 70, 176, 26);
    };
    ctx.fillStyle = '#fffaf0';
    shape();
    ctx.fill();
    // Paint the underside in a cool grey, only inside the cloud.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(176, 196, 214, 0.55)';
    ctx.fillRect(0, 78, 256, 50);
    ctx.fillStyle = 'rgba(200, 214, 226, 0.45)';
    for (const [x, y, r] of puffs) { ctx.beginPath(); ctx.arc(x + r * 0.15, y + r * 0.55, r * 0.8, 0, Math.PI * 2); ctx.fill(); }
    // A brushed highlight along the tops.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    for (const [x, y, r] of puffs) { ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.25, r * 0.55, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
  });
}

/** How far (in metres, roughly) a point is from the chicken's lap. */
function fromLap(x: number, z: number): number {
  const { a, b } = LOBBY_LAP;
  const k = Math.hypot((x - LOBBY_LAP.x) / a, (z - LOBBY_LAP.z) / b);
  return Math.abs(k - 1) * Math.min(a, b);
}

interface Cloud {
  sprite: THREE.Sprite;
  speed: number;
}

export class Yard {
  readonly root = new THREE.Group();
  private readonly clouds: Cloud[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly still = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(collision: CollisionWorld, halfSize: number) {
    this.root.name = 'yard';
    this.addTrack();
    this.addTufts(collision, halfSize);
    this.addClouds();
  }

  /** Clouds drift sideways, nearer ones faster (parallax); reduced motion stops them. */
  update(dt: number): void {
    if (this.still.matches) return;
    for (const c of this.clouds) {
      c.sprite.position.x += c.speed * dt;
      if (c.sprite.position.x > 220) c.sprite.position.x -= 440;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }

  private keep<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  /** A ring of worn dirt under the lap, its edges wobbling a little in width. */
  private addTrack(): void {
    const { x: cx, z: cz, a, b } = LOBBY_LAP;
    const segments = 220;
    const rand = mulberry32(5);
    const wobble = Array.from({ length: 6 }, () => ({ f: 2 + Math.floor(rand() * 7), p: rand() * Math.PI * 2 }));
    const positions: number[] = [];
    const uvs: number[] = [];
    let along = 0;
    let last: [number, number] | null = null;
    for (let i = 0; i <= segments; i++) {
      const phi = (i / segments) * Math.PI * 2;
      const px = cx + a * Math.cos(phi);
      const pz = cz + b * Math.sin(phi);
      if (last) along += Math.hypot(px - last[0], pz - last[1]);
      last = [px, pz];
      let n = Math.hypot(Math.cos(phi) / a, Math.sin(phi) / b);
      const nx = Math.cos(phi) / a / n;
      const nz = Math.sin(phi) / b / n;
      n = 1.35;
      for (const w of wobble) n += Math.sin(phi * w.f + w.p) * 0.06;
      positions.push(px - nx * n, 0, pz - nz * n, px + nx * n, 0, pz + nz * n);
      uvs.push(along / 5, 0, along / 5, 1);
    }
    const index: number[] = [];
    for (let i = 0; i < segments; i++) {
      const k = i * 2;
      index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    const geometry = this.keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const material = this.keep(new THREE.MeshStandardMaterial({ map: this.keep(trackTexture()), transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.006;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  /** Painted tufts scattered over the yard, off the track and out of the buildings. One draw call. */
  private addTufts(collision: CollisionWorld, halfSize: number): void {
    const plane = new THREE.PlaneGeometry(0.62, 0.5).translate(0, 0.25, 0);
    const geometry = this.keep(mergeGeometries([plane.clone(), plane.clone().rotateY(Math.PI / 2)])!);
    plane.dispose();
    const material = this.keep(new THREE.MeshStandardMaterial({ map: this.keep(tuftTexture()), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }));
    const count = 240;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const rand = mulberry32(19);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tint = new THREE.Color();
    let placed = 0;
    for (let tries = 0; tries < count * 12 && placed < count; tries++) {
      const x = (rand() * 2 - 1) * (halfSize - 2);
      const z = (rand() * 2 - 1) * (halfSize - 2);
      if (fromLap(x, z) < 2.2 || !isSpaceFree(x, 0, z, collision)) continue;
      const s = 0.6 + rand() * 0.5;
      m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI), new THREE.Vector3(s, s * (0.8 + rand() * 0.4), s));
      mesh.setMatrixAt(placed, m);
      mesh.setColorAt(placed, tint.setHSL(0.24 + rand() * 0.05, 0.35, 0.78 + rand() * 0.22));
      placed++;
    }
    mesh.count = placed;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  /** A dozen clouds at three distances: far ones small and slow, near ones bigger and quicker. */
  private addClouds(): void {
    const textures = [3, 11, 29].map((seed) => this.keep(cloudTexture(seed)));
    const rand = mulberry32(23);
    for (let i = 0; i < 12; i++) {
      const layer = i % 3;
      const distance = 110 + layer * 45 + rand() * 20;
      const angle = rand() * Math.PI * 2;
      const material = this.keep(new THREE.SpriteMaterial({ map: textures[i % 3]!, fog: false, depthWrite: false, transparent: true }));
      const sprite = new THREE.Sprite(material);
      const width = (34 - layer * 6) * (0.75 + rand() * 0.5) * (distance / 110);
      sprite.scale.set(width, width / 2, 1);
      sprite.position.set(Math.cos(angle) * distance, distance * (0.11 + rand() * 0.16), Math.sin(angle) * distance);
      sprite.renderOrder = -0.5;
      this.root.add(sprite);
      this.clouds.push({ sprite, speed: (1.6 - layer * 0.45) * (0.8 + rand() * 0.4) });
    }
  }
}
