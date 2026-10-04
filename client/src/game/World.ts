import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCollisionWorld, mulberry32, type BoxKind, type CollisionWorld, type MapBox, type MapDef } from '@game/shared';
import { Foliage } from './Foliage';
import { SURFACES, type Surface, type WorldLook } from './look';
import { box, cylinder, part, solid } from './models/materials';
import { HORIZON_COLOR, SUN_DIRECTION } from './Sky';
import { asphaltTexture, bombSiteTexture, boxTexture, grassTexture, gridTexture, pavementTexture, sandTexture, tiledBoxGeometry } from './textures';

/** Much larger than the fog distance, so the ground's edge is never visible. */
const GROUND_SIZE = 1000;
const WOOD_COLOR = 0xa0703f;
/** How far the shadow-casting light sits from what it lights. */
const SUN_DISTANCE = 90;
/** Hemisphere light strength with and without the sky environment map. */
const HEMI_WITH_ENV = 0.55;
const HEMI_ALONE = 1.8;
const FOG_NEAR = 60;
const FOG_FAR = 175;
const WINDOW = { width: 1.0, height: 0.95, sill: 1.3, spacing: 2.6, frame: 0.07 };

export interface ShadowOptions {
  /** Shadow map resolution; 0 turns shadows off. */
  mapSize: number;
  /** Half-width (m) of the sharp-shadow area around the focus point. */
  extent: number;
}

/**
 * The static level: lighting, ground, fence, scenery and the solid boxes from the shared map.
 * The boxes come from the same map definition the server collides against, so what you see
 * is exactly what you bump into. Everything lives under `root` so a map can be swapped out.
 */
export class World {
  readonly map: MapDef;
  readonly root = new THREE.Group();
  /** Shared collision data, used for prediction, aiming and the camera. */
  readonly collision: CollisionWorld;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly maxAnisotropy: number;
  private readonly sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
  private readonly hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4f6b32, HEMI_WITH_ENV);
  private readonly scene: THREE.Scene;
  /** Materials per surface, for the developer World tab (colour tints, wireframe). */
  private readonly surfaces = new Map<Surface, THREE.MeshStandardMaterial[]>();
  private envLight = true;
  private ambientScale = 1;
  private shadowExtent = 0;
  private foliage: Foliage | null = null;
  private foliageDetail = -1;

  constructor(scene: THREE.Scene, map: MapDef, maxAnisotropy: number) {
    this.map = map;
    this.maxAnisotropy = maxAnisotropy;
    this.collision = createCollisionWorld(map);
    this.scene = scene;
    scene.background = new THREE.Color(HORIZON_COLOR);
    scene.fog = new THREE.Fog(HORIZON_COLOR, FOG_NEAR, FOG_FAR);

    this.addLights();
    this.addGround();
    this.addBoxes();
    // The desert town has its own walls, and no pine forest.
    if (this.map.ground !== 'sand') {
      this.addFence();
      this.addTrees();
    }
    scene.add(this.root);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.foliage?.dispose();
    this.sun.shadow.map?.dispose();
    for (const d of this.disposables) d.dispose();
  }

  /** Grass, flowers and rocks; 0 removes them. Rebuilt only when the amount changes. */
  setDetail(detail: number): void {
    if (detail === this.foliageDetail) return;
    this.foliageDetail = detail;
    this.foliage?.dispose();
    // No grass and flowers in the desert.
    this.foliage = detail > 0 && this.map.ground !== 'sand' ? new Foliage(this.map, this.collision, detail) : null;
    if (this.foliage) this.root.add(this.foliage.root);
  }

  setShadows(options: ShadowOptions): void {
    const enabled = options.mapSize > 0;
    this.sun.castShadow = enabled;
    if (this.sun.shadow.mapSize.x !== options.mapSize && enabled) {
      this.sun.shadow.mapSize.set(options.mapSize, options.mapSize);
      // Make three.js allocate a new shadow map at the new size.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.shadowExtent = options.extent;
  }

  /**
   * Keeps crisp shadows around `focus` (the area in front of the camera). The light moves in
   * whole shadow-map texels so the edges don't shimmer as you walk. `null` covers the whole map.
   */
  updateShadows(focus: THREE.Vector3 | null): void {
    if (!this.sun.castShadow) return;
    const extent = focus ? this.shadowExtent : this.map.halfSize + 10;
    const cam = this.sun.shadow.camera;
    if (cam.right !== extent) {
      Object.assign(cam, { left: -extent, right: extent, top: extent, bottom: -extent });
      cam.updateProjectionMatrix();
    }
    const centre = focus ?? new THREE.Vector3();
    const texel = (2 * extent) / this.sun.shadow.mapSize.x;
    // Light-space axes, matching how the shadow camera looks at its target.
    const right = new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, SUN_DIRECTION).normalize();
    const up = new THREE.Vector3().crossVectors(SUN_DIRECTION, right);
    const a = Math.round(centre.dot(right) / texel) * texel;
    const b = Math.round(centre.dot(up) / texel) * texel;
    const c = centre.dot(SUN_DIRECTION);
    const snapped = right.multiplyScalar(a).addScaledVector(up, b).addScaledVector(SUN_DIRECTION, c);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(SUN_DIRECTION, SUN_DISTANCE);
    this.sun.target.updateMatrixWorld();
  }

  /** With the sky's environment lighting off (low quality), the hemisphere light makes up for it. */
  setAmbient(environmentLight: boolean): void {
    this.envLight = environmentLight;
    this.hemi.intensity = (environmentLight ? HEMI_WITH_ENV : HEMI_ALONE) * this.ambientScale;
  }

  /** Applies the developer World look: surface tints, sun, ambient light, fog and wireframe. */
  setLook(look: WorldLook): void {
    for (const surface of SURFACES) {
      const tint = new THREE.Color(look[surface]);
      for (const m of this.surfaces.get(surface) ?? []) {
        m.color.copy(m.userData.baseColor as THREE.Color).multiply(tint);
        if (m.wireframe !== look.wireframe) m.wireframe = look.wireframe;
      }
    }
    this.sun.color.set(look.sunColor);
    this.sun.intensity = look.sunIntensity;
    this.ambientScale = look.ambient;
    this.setAmbient(this.envLight);
    const horizon = new THREE.Color(look.horizon);
    (this.scene.background as THREE.Color).copy(horizon);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(horizon);
    fog.near = FOG_NEAR * look.fog;
    fog.far = FOG_FAR * look.fog;
  }

  private surface<T extends THREE.MeshStandardMaterial>(kind: Surface, m: T): T {
    m.userData.baseColor = m.color.clone();
    const list = this.surfaces.get(kind) ?? [];
    list.push(m);
    this.surfaces.set(kind, list);
    return m;
  }

  update(dt: number): void {
    this.foliage?.update(dt);
  }

  private track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  private texture(t: THREE.Texture, repeat = 1): THREE.Texture {
    t.anisotropy = this.maxAnisotropy;
    t.repeat.set(repeat, repeat);
    return this.track(t);
  }

  private addLights(): void {
    // Most ambient light comes from the sky's environment map (set up by Game); this adds a
    // touch of blue from above and green bounce from below.
    this.root.add(this.hemi);
    const sun = this.sun;
    sun.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE);
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = SUN_DISTANCE * 2.2;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 2;
    this.root.add(sun, sun.target);
  }

  private plane(size: number, material: THREE.Material, y: number): THREE.Mesh {
    const mesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(size, size)), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  private decal(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    // Lies flat on the ground; polygon offset avoids z-fighting at a distance.
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    return this.track(material);
  }

  private addGround(): void {
    // The desert map is sand to the horizon; everything else stands in a grass field.
    const desert = this.map.ground === 'sand';
    const outer = desert
      ? this.surface('ground', this.track(new THREE.MeshStandardMaterial({ map: this.texture(sandTexture(), GROUND_SIZE / 6), roughness: 1 })))
      : this.surface('grass', this.track(new THREE.MeshStandardMaterial({ map: this.texture(grassTexture(), GROUND_SIZE / 4), roughness: 1, vertexColors: true })));
    const ground = new THREE.Mesh(this.track(groundGeometry()), outer);
    ground.receiveShadow = true;
    this.root.add(ground);
    const size = this.map.halfSize * 2;

    // ChikenBomb sites: a red ring and letter on the ground.
    for (const site of this.map.bombSites ?? []) {
      const mark = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(site.radius * 2, site.radius * 2)),
        this.decal(new THREE.MeshStandardMaterial({ map: this.texture(bombSiteTexture(site.id)), transparent: true, roughness: 0.9, depthWrite: false })),
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(site.x, 0.012, site.z);
      mark.receiveShadow = true;
      this.root.add(mark);
    }

    if (this.map.ground === 'flat') {
      const grid = this.surface('ground', this.decal(new THREE.MeshStandardMaterial({ map: this.texture(gridTexture(), size / 1.2), roughness: 1 })));
      this.plane(size, grid, 0.002);
    }

    if (this.map.ground === 'town') {
      this.plane(size, this.surface('ground', this.decal(new THREE.MeshStandardMaterial({ map: this.texture(pavementTexture(), size / 2), roughness: 0.95 }))), 0.002);
      const asphalt = this.surface('road', this.decal(new THREE.MeshStandardMaterial({ map: this.texture(asphaltTexture(), 1), roughness: 0.85 })));
      asphalt.polygonOffsetFactor = -2;
      const lines = this.decal(new THREE.MeshStandardMaterial({ color: 0xf5f0d0, roughness: 0.8 }));
      lines.polygonOffsetFactor = -3;
      const roadWidth = 8;
      for (const alongX of [true, false]) {
        const w = alongX ? size : roadWidth;
        const d = alongX ? roadWidth : size;
        const geometry = this.track(new THREE.PlaneGeometry(w, d));
        // Tile the asphalt every 4 m along both axes of each road.
        const uv = geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 4, (uv.getY(i) * d) / 4);
        const road = new THREE.Mesh(geometry, asphalt);
        road.rotation.x = -Math.PI / 2;
        road.position.y = 0.004;
        road.receiveShadow = true;
        this.root.add(road);
        for (let t = -this.map.halfSize + 1; t < this.map.halfSize; t += 3) {
          if (Math.abs(t) < roadWidth / 2 + 1) continue;
          const dash = new THREE.Mesh(this.track(new THREE.PlaneGeometry(alongX ? 1.4 : 0.15, alongX ? 0.15 : 1.4)), lines);
          dash.rotation.x = -Math.PI / 2;
          dash.position.set(alongX ? t : 0, 0.006, alongX ? 0 : t);
          this.root.add(dash);
        }
      }
    }
  }

  private addBoxes(): void {
    // Merge every box of a kind into one mesh: dozens of walls become a single draw call.
    const byKind = new Map<BoxKind, THREE.BufferGeometry[]>();
    const frames: THREE.BufferGeometry[] = [];
    const glass: THREE.BufferGeometry[] = [];
    for (const b of this.map.boxes) {
      if (b.kind === 'car') {
        this.addCar(b);
        continue;
      }
      if (b.kind === 'brick') addWindows(b, frames, glass);
      const { tile } = boxTexture(b.kind);
      const geometry = tile === null ? new THREE.BoxGeometry(b.w, b.h, b.d) : tiledBoxGeometry(b.w, b.h, b.d, tile);
      geometry.translate(b.x, (b.y ?? 0) + b.h / 2, b.z);
      const list = byKind.get(b.kind) ?? [];
      list.push(geometry);
      byKind.set(b.kind, list);
    }
    for (const [kind, geometries] of byKind) {
      const merged = this.track(mergeGeometries(geometries)!);
      for (const g of geometries) g.dispose();
      const { texture } = boxTexture(kind);
      const material = this.surface(kind as Surface, this.track(new THREE.MeshStandardMaterial({ map: this.texture(texture), roughness: kind === 'metal' ? 0.45 : 0.9, metalness: kind === 'metal' ? 0.3 : 0 })));
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    for (const [parts, material] of [
      [frames, new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 })],
      [glass, new THREE.MeshStandardMaterial({ color: 0x2d4f6e, roughness: 0.08, metalness: 0.4, envMapIntensity: 1.6 })],
    ] as const) {
      if (parts.length === 0) continue;
      const mesh = new THREE.Mesh(this.track(mergeGeometries(parts)!), this.track(material));
      for (const g of parts) g.dispose();
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  /** Parked cars are solid boxes in the map; draw them as little cars. */
  private addCar(b: MapBox): void {
    const g = new THREE.Group();
    const alongZ = b.d > b.w;
    const length = alongZ ? b.d : b.w;
    const width = alongZ ? b.w : b.d;
    const paint = solid(b.color ?? 0xd84343, { roughness: 0.3, flat: false });
    g.add(part(box(width, 0.7, length), paint, 0, 0.55, 0));
    g.add(part(box(width * 0.9, 0.55, length * 0.5), solid(0x263238, { roughness: 0.1, metal: true }), 0, 1.1, length * 0.05));
    for (const sz of [-1, 1]) {
      // Headlights at the front, tail lights at the back.
      for (const sx of [-1, 1]) g.add(part(box(0.3, 0.14, 0.04), solid(sz < 0 ? 0xfff6c8 : 0xc62828, { roughness: 0.2 }), sx * (width / 2 - 0.3), 0.7, sz * (length / 2 + 0.01)));
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wheel = part(cylinder(0.33, 0.33, 0.25, 14), solid(0x212121, { roughness: 0.9 }), sx * (width / 2 - 0.05), 0.33, sz * length * 0.32);
        wheel.rotation.z = Math.PI / 2;
        g.add(wheel);
      }
    }
    if (!alongZ) g.rotation.y = Math.PI / 2;
    g.position.set(b.x, b.y ?? 0, b.z);
    g.traverse((o) => (o.receiveShadow = true));
    this.root.add(g);
  }

  private addFence(): void {
    const material = this.surface('fence', this.track(new THREE.MeshStandardMaterial({ color: WOOD_COLOR, roughness: 0.9 })));
    const size = this.map.halfSize;
    const spacing = 2.5;
    const postsPerSide = Math.round((size * 2) / spacing);
    const posts = new THREE.InstancedMesh(this.track(new THREE.BoxGeometry(0.16, 1.1, 0.16)), material, postsPerSide * 4);
    const matrix = new THREE.Matrix4();
    let i = 0;
    for (let n = 0; n < postsPerSide; n++) {
      const t = -size + n * spacing;
      for (const [x, z] of [
        [t, -size],
        [size, t],
        [-t, size],
        [-size, -t],
      ] as const) {
        posts.setMatrixAt(i++, matrix.makeTranslation(x, 0.55, z));
      }
    }
    posts.castShadow = true;
    this.root.add(posts);

    const rail = this.track(new THREE.BoxGeometry(size * 2, 0.1, 0.06));
    for (const y of [0.4, 0.85]) {
      for (let side = 0; side < 4; side++) {
        const mesh = new THREE.Mesh(rail, material);
        const angle = (side * Math.PI) / 2;
        mesh.position.set(Math.sin(angle) * size, y, Math.cos(angle) * size);
        mesh.rotation.y = angle;
        mesh.castShadow = true;
        this.root.add(mesh);
      }
    }
  }

  /** Scenery outside the fence so the horizon isn't empty. Purely visual, no collision. */
  private addTrees(): void {
    const count = 160;
    const rand = mulberry32(7);
    const trunks = new THREE.InstancedMesh(
      this.track(new THREE.CylinderGeometry(0.22, 0.34, 2, 7)),
      this.surface('trees', this.track(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 1 }))),
      count,
    );
    // Two stacked cones read as a fuller pine than one.
    const crownGeometry = this.track(mergeGeometries([new THREE.ConeGeometry(1.7, 3.2, 8).translate(0, -0.6, 0), new THREE.ConeGeometry(1.25, 2.6, 8).translate(0, 0.9, 0)])!);
    const leaves = new THREE.InstancedMesh(crownGeometry, this.surface('trees', this.track(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }))), count);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const distance = this.map.halfSize + 8 + rand() * 80;
      const s = 0.8 + rand() * 0.9;
      let x = Math.cos(angle) * distance;
      let z = Math.sin(angle) * distance;
      // The play area is a square: push trees that landed in its corners out past the fence.
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const min = this.map.halfSize + 6;
      if (edge < min) {
        x *= min / edge;
        z *= min / edge;
      }
      rotation.setFromAxisAngle(up, rand() * Math.PI * 2);
      scale.setScalar(s);
      trunks.setMatrixAt(i, matrix.compose(position.set(x, 1 * s, z), rotation, scale));
      leaves.setMatrixAt(i, matrix.compose(position.set(x, 3.8 * s, z), rotation, scale));
      leaves.setColorAt(i, color.setHSL(0.27 + rand() * 0.08, 0.45, 0.22 + rand() * 0.12));
    }
    trunks.castShadow = leaves.castShadow = true;
    leaves.receiveShadow = true;
    this.root.add(trunks, leaves);
  }
}

/**
 * The big grass plane, with large soft patches of lighter, darker and drier grass baked into
 * vertex colours so the repeating texture doesn't look like wallpaper.
 */
function groundGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 160, 160);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const rand = mulberry32(5);
  const blobs = Array.from({ length: 6 }, () => ({ fx: 0.02 + rand() * 0.06, fz: 0.02 + rand() * 0.06, phase: rand() * 10 }));
  const lush = new THREE.Color(0.86, 1, 0.84);
  const dry = new THREE.Color(1.12, 1.06, 0.78);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let n = 0;
    for (const b of blobs) n += Math.sin(x * b.fx + b.phase) * Math.cos(z * b.fz - b.phase);
    n /= blobs.length;
    const shade = 0.92 + n * 0.35;
    c.copy(lush).lerp(dry, Math.max(0, Math.min(1, 0.4 + n * 1.8))).multiplyScalar(shade);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Windows along the long sides of a tall brick wall: a light frame with a cross bar and a
 * dark, reflective pane. They go through the wall, so they show from inside the house too.
 */
function addWindows(b: MapBox, frames: THREE.BufferGeometry[], glass: THREE.BufferGeometry[]): void {
  if (b.h < 2.6) return;
  const alongX = b.w >= b.d;
  const length = alongX ? b.w : b.d;
  const depth = alongX ? b.d : b.w;
  const count = Math.floor((length - 0.8) / WINDOW.spacing);
  if (count < 1) return;
  const { width: ww, height: wh, frame: f } = WINDOW;
  const baseY = (b.y ?? 0) + WINDOW.sill;
  const step = length / count;
  for (let i = 0; i < count; i++) {
    const along = -length / 2 + step * (i + 0.5);
    const add = (list: THREE.BufferGeometry[], w: number, h: number, d: number, u: number, y: number) => {
      const g = alongX ? new THREE.BoxGeometry(w, h, d) : new THREE.BoxGeometry(d, h, w);
      g.translate(alongX ? b.x + along + u : b.x, y, alongX ? b.z : b.z + along + u);
      list.push(g);
    };
    const cy = baseY + wh / 2;
    add(glass, ww, wh, depth + 0.04, 0, cy);
    const fd = depth + 0.1;
    add(frames, ww + f * 2, f, fd, 0, baseY + wh + f / 2);
    add(frames, ww + f * 4, f * 1.4, fd + 0.08, 0, baseY - f * 0.7);
    add(frames, f, wh, fd, -ww / 2 - f / 2, cy);
    add(frames, f, wh, fd, ww / 2 + f / 2, cy);
    add(frames, f * 0.6, wh, fd - 0.02, 0, cy);
    add(frames, ww, f * 0.6, fd - 0.02, 0, cy);
  }
}
