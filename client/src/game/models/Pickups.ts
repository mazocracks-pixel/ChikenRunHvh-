import * as THREE from 'three';
import { LOOT, PICKUP_INFO, type PickupKind } from '@game/shared';
import { mysteryBoxTexture } from '../textures';
import { box, cylinder, part, solid, sphere } from './materials';

let mysteryMaterial: THREE.MeshStandardMaterial | null = null;

export function buildMysteryBox(): THREE.Mesh {
  mysteryMaterial ??= new THREE.MeshStandardMaterial({ map: mysteryBoxTexture(), roughness: 0.4, emissive: 0x332200 });
  const s = LOOT.boxSize;
  const mesh = new THREE.Mesh(box(s, s, s), mysteryMaterial);
  mesh.castShadow = true;
  return mesh;
}

/** The item a broken box leaves behind, centred on the origin. */
export function buildPickup(kind: PickupKind): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'medkit': {
      const white = solid(0xf5f5f5);
      const red = solid(PICKUP_INFO.medkit.color);
      g.add(part(box(0.5, 0.32, 0.32), white));
      g.add(part(box(0.26, 0.08, 0.02), red, 0, 0, -0.17), part(box(0.08, 0.26, 0.02), red, 0, 0, -0.17));
      g.add(part(box(0.26, 0.08, 0.02), red, 0, 0, 0.17), part(box(0.08, 0.26, 0.02), red, 0, 0, 0.17));
      g.add(part(box(0.16, 0.05, 0.05), solid(0x9e9e9e), 0, 0.19, 0));
      break;
    }
    case 'armor': {
      const blue = solid(PICKUP_INFO.armor.color);
      g.add(part(box(0.44, 0.5, 0.16), blue));
      g.add(part(box(0.1, 0.16, 0.17), solid(0x1565c0), -0.12, 0.3, 0), part(box(0.1, 0.16, 0.17), solid(0x1565c0), 0.12, 0.3, 0));
      g.add(part(box(0.46, 0.06, 0.18), solid(0x0d47a1), 0, -0.1, 0));
      break;
    }
    case 'fuel': {
      g.add(part(cylinder(0.14, 0.14, 0.42, 12), solid(PICKUP_INFO.fuel.color)));
      g.add(part(cylinder(0.05, 0.05, 0.08, 8), solid(0x424242, { metal: true }), 0, 0.25, 0));
      g.add(part(box(0.3, 0.06, 0.29), solid(0xe65100), 0, 0, 0));
      break;
    }
    case 'eggs': {
      const shell = solid(PICKUP_INFO.eggs.color, { flat: false, roughness: 0.4 });
      for (const [x, z] of [
        [-0.1, 0],
        [0.1, 0.03],
        [0, -0.12],
      ] as const) {
        const egg = part(sphere(0.11, 12, 10), shell, x, 0, z);
        egg.scale.set(1, 1.3, 1);
        g.add(egg);
      }
      break;
    }
  }
  return g;
}
