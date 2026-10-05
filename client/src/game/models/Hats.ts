import * as THREE from 'three';
import { getItem } from '@game/shared';
import { box, cone, cylinder, part, solid, sphere } from './materials';

/** A hat sitting on top of the head; the origin is the top of the skull. Null for "none". */
export function buildHat(key: string): THREE.Group | null {
  const item = getItem('hat', key);
  if (!item || key === 'none') return null;
  const color = item.color ?? 0xffffff;
  const m = solid(color, { metal: item.metal });
  const g = new THREE.Group();

  switch (key) {
    case 'cap': {
      const dome = part(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, -0.06, 0);
      dome.scale.set(1.05, 0.8, 1.05);
      g.add(dome, part(box(0.3, 0.025, 0.2), m, 0, -0.055, -0.22));
      break;
    }
    case 'party': {
      g.add(part(cone(0.12, 0.34, 12), m, 0, 0.12, 0), part(sphere(0.045), solid(0xffeb3b), 0, 0.3, 0));
      g.rotation.z = 0.15;
      break;
    }
    case 'chef': {
      g.add(part(cylinder(0.16, 0.16, 0.16, 14), m, 0, 0.02, 0));
      const puff = part(sphere(0.2, 12, 8), m, 0, 0.17, 0);
      puff.scale.set(1, 0.65, 1);
      g.add(puff);
      break;
    }
    case 'cowboy': {
      g.add(part(cylinder(0.36, 0.36, 0.03, 16), m, 0, -0.03, 0));
      g.add(part(cylinder(0.15, 0.18, 0.2, 12), m, 0, 0.08, 0));
      g.add(part(cylinder(0.185, 0.185, 0.04, 12), solid(0x3e2723), 0, 0.0, 0));
      break;
    }
    case 'helmet': {
      const dome = part(new THREE.SphereGeometry(0.26, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, -0.1, 0);
      g.add(dome, part(cylinder(0.28, 0.28, 0.03, 14), m, 0, -0.1, 0));
      break;
    }
    case 'tophat': {
      g.add(part(cylinder(0.25, 0.25, 0.025, 16), m, 0, -0.03, 0));
      g.add(part(cylinder(0.15, 0.15, 0.32, 14), m, 0, 0.14, 0));
      g.add(part(cylinder(0.153, 0.153, 0.05, 14), solid(0xc62828), 0, 0.02, 0));
      break;
    }
    case 'viking': {
      const dome = part(new THREE.SphereGeometry(0.24, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, -0.08, 0);
      g.add(dome);
      for (const side of [-1, 1]) {
        const horn = part(cone(0.05, 0.22, 8), solid(0xf5f0e1), side * 0.24, 0.05, 0);
        horn.rotation.z = -side * 0.9;
        g.add(horn);
      }
      break;
    }
    case 'beanie': {
      const dome = part(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, -0.05, 0);
      dome.scale.set(1.05, 0.8, 1.05);
      g.add(dome, part(cylinder(0.02, 0.02, 0.07, 6), solid(0xcfd8dc), 0, 0.14, 0));
      for (const r of [0, Math.PI / 2]) {
        const blade = part(box(0.34, 0.012, 0.06), solid(0xff7043), 0, 0.18, 0);
        blade.rotation.y = r + 0.3;
        blade.name = 'propeller';
        g.add(blade);
      }
      break;
    }
    case 'pirate': {
      const brim = part(box(0.5, 0.04, 0.22), m, 0, -0.03, 0);
      brim.rotation.z = 0.0;
      g.add(brim, part(box(0.26, 0.12, 0.2), m, 0, 0.04, 0));
      g.add(part(sphere(0.045), solid(0xf5f5f5), 0, 0.05, -0.11));
      g.add(part(box(0.1, 0.02, 0.01), solid(0xf5f5f5), 0, 0.04, -0.115));
      break;
    }
    case 'sombrero': {
      g.add(part(cylinder(0.42, 0.45, 0.03, 18), m, 0, -0.04, 0));
      g.add(part(cylinder(0.1, 0.16, 0.26, 12), m, 0, 0.1, 0));
      g.add(part(cylinder(0.165, 0.165, 0.04, 12), solid(0xc62828), 0, 0.01, 0));
      break;
    }
    case 'wizard': {
      g.add(part(cylinder(0.3, 0.3, 0.025, 16), m, 0, -0.04, 0));
      const cone1 = part(cone(0.18, 0.5, 14), m, 0, 0.22, 0);
      cone1.rotation.z = 0.12;
      g.add(cone1, part(cylinder(0.185, 0.185, 0.04, 14), solid(0xffd54f), 0, 0.0, 0));
      g.add(part(sphere(0.035), solid(0xffeb3b), 0.04, 0.2, -0.17));
      break;
    }
    case 'devil': {
      g.add(part(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), solid(0x7f0000), 0, -0.08, 0));
      for (const side of [-1, 1]) {
        const horn = part(cone(0.055, 0.2, 8), m, side * 0.11, 0.08, -0.02);
        horn.rotation.z = -side * 0.35;
        g.add(horn);
      }
      break;
    }
    case 'halo': {
      const ring = part(new THREE.TorusGeometry(0.17, 0.025, 8, 24), m, 0, 0.26, 0);
      ring.rotation.x = Math.PI / 2;
      ring.name = 'halo';
      g.add(ring);
      break;
    }
    case 'crown': {
      g.add(part(cylinder(0.17, 0.17, 0.09, 14), m, 0, 0.0, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(part(cone(0.035, 0.11, 6), m, Math.cos(a) * 0.15, 0.09, Math.sin(a) * 0.15));
      }
      g.add(part(sphere(0.03), solid(0xe53935), 0, 0.02, -0.17));
      break;
    }
    default:
      return null;
  }
  return g;
}
