import * as THREE from 'three';
import { WEAPON_IDS, type WeaponId } from '@game/shared';
import { buildGun } from '../game/models/Guns';

/**
 * Kill feed icons made from the guns themselves: each gun is drawn once from the side, muzzle to
 * the right, as a flat white silhouette (like Counter-Strike's kill icons). Every gun gets its own
 * exact shape, and a gun's icon changes by itself when its model does. Drawn a few per frame
 * after a match starts; until a gun's icon is ready the feed uses the hand-drawn one.
 */

/** Pixels per metre of gun (the picture is shown at half size, so it stays sharp). */
const PX_PER_METRE = 230;
const PAD = 6;

const icons = new Map<WeaponId, { url: string; width: number; height: number }>();
let started = false;

export function gunIcon(id: WeaponId): { url: string; width: number; height: number } | null {
  return icons.get(id) ?? null;
}

/** Starts drawing every gun's icon (once; a few per frame, so the game doesn't stutter). */
export function prepareGunIcons(): void {
  if (started) return;
  started = true;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return; // No second WebGL canvas: the hand-drawn icons stay.
  }
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  // From the right-hand side: the barrel (which points down -Z) points to the right of the picture.
  camera.position.set(3, 0, 0);
  camera.lookAt(0, 0, 0);
  const todo = [...WEAPON_IDS];

  const step = () => {
    for (let n = 0; n < 3 && todo.length > 0; n++) {
      const id = todo.shift()!;
      const gun = buildGun(id);
      // A pair (Dual Pistols, Shadow Daggers): the second one sits behind the first from the side.
      if (gun.offhand) gun.offhand.position.x = 0;
      scene.add(gun.group);
      gun.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gun.group);
      const width = Math.ceil((box.max.z - box.min.z) * PX_PER_METRE) + PAD * 2;
      const height = Math.ceil((box.max.y - box.min.y) * PX_PER_METRE) + PAD * 2;
      renderer.setSize(width, height, false);
      const half = { w: width / PX_PER_METRE / 2, h: height / PX_PER_METRE / 2 };
      const centre = box.getCenter(new THREE.Vector3());
      camera.left = -half.w;
      camera.right = half.w;
      camera.top = half.h;
      camera.bottom = -half.h;
      camera.position.set(3, centre.y, centre.z);
      camera.lookAt(0, centre.y, centre.z);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      icons.set(id, { url: renderer.domElement.toDataURL('image/png'), width: Math.round(width / 2), height: Math.round(height / 2) });
      scene.remove(gun.group);
    }
    if (todo.length > 0) requestAnimationFrame(step);
    else {
      (scene.overrideMaterial as THREE.Material).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
  requestAnimationFrame(step);
}
