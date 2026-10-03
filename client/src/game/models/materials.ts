import * as THREE from 'three';

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Shared flat-shaded materials, cached by colour so hundreds of parts reuse a handful of materials. */
export function solid(color: number, options: { metal?: boolean; flat?: boolean; roughness?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}:${options.metal ? 1 : 0}:${options.flat === false ? 0 : 1}:${options.roughness ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: options.flat !== false,
      roughness: options.roughness ?? (options.metal ? 0.3 : 0.75),
      metalness: options.metal ? 0.75 : 0.05,
    });
    cache.set(key, m);
  }
  return m;
}

export function part(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

const boxCache = new Map<string, THREE.BoxGeometry>();
export function box(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `${w}:${h}:${d}`;
  let g = boxCache.get(key);
  if (!g) boxCache.set(key, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}

const cylCache = new Map<string, THREE.CylinderGeometry>();
export function cylinder(rTop: number, rBottom: number, h: number, segments = 10): THREE.CylinderGeometry {
  const key = `${rTop}:${rBottom}:${h}:${segments}`;
  let g = cylCache.get(key);
  if (!g) cylCache.set(key, (g = new THREE.CylinderGeometry(rTop, rBottom, h, segments)));
  return g;
}

const sphereCache = new Map<string, THREE.SphereGeometry>();
export function sphere(r: number, w = 10, h = 8): THREE.SphereGeometry {
  const key = `${r}:${w}:${h}`;
  let g = sphereCache.get(key);
  if (!g) sphereCache.set(key, (g = new THREE.SphereGeometry(r, w, h)));
  return g;
}

const coneCache = new Map<string, THREE.ConeGeometry>();
export function cone(r: number, h: number, segments = 8): THREE.ConeGeometry {
  const key = `${r}:${h}:${segments}`;
  let g = coneCache.get(key);
  if (!g) coneCache.set(key, (g = new THREE.ConeGeometry(r, h, segments)));
  return g;
}
