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
/** Shop and buy-menu pictures: three times the detail, shaded. */
const PICTURE_SCALE = 3;
const PAD = 6;

type Icon = { url: string; width: number; height: number };
const icons = new Map<WeaponId, Icon>();
/** Shaded pictures: gold for the buy menu, light grey for the shop and Training. */
export type PictureTone = 'gold' | 'light';
const pictures = new Map<string, Icon>();
let started = false;

export function gunIcon(id: WeaponId): Icon | null {
  return icons.get(id) ?? null;
}

/** The detailed, shaded picture of a gun (falls back to its silhouette until it's drawn). */
export function gunPicture(id: WeaponId, tone: PictureTone): Icon | null {
  return pictures.get(`${tone}:${id}`) ?? icons.get(id) ?? null;
}

/** Ramps from shadow to highlight, per tone (Counter-Strike's buy menu gold, or a light steel). */
const RAMPS: Record<PictureTone, readonly [readonly number[], readonly number[]]> = {
  gold: [[122, 74, 8], [255, 214, 120]],
  light: [[86, 92, 98], [246, 248, 250]],
};

/** Recolours a lit render by brightness (stretched per gun, so dark guns show their parts too). */
function tint(source: HTMLCanvasElement, tone: PictureTone): string {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 128) { const l = (d[i]! + d[i + 1]! + d[i + 2]!) / 3; lo = Math.min(lo, l); hi = Math.max(hi, l); }
  const span = Math.max(1, hi - lo);
  const [dark, light] = RAMPS[tone];
  const w = canvas.width;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! === 0) continue;
    // Brightness, lifted a little so even the shadows read; a darker rim where the outline is.
    const k = Math.pow((((d[i]! + d[i + 1]! + d[i + 2]!) / 3) - lo) / span, 0.8) * 0.8 + 0.2;
    const p = i / 4, x = p % w;
    const edge = x === 0 || x === w - 1 || d[i - 4 + 3]! < 64 || d[i + 4 + 3]! < 64 || (d[i - w * 4 + 3] ?? 0) < 64 || (d[i + w * 4 + 3] ?? 0) < 64;
    const m = edge ? 0.45 : k;
    for (let c = 0; c < 3; c++) d[i + c] = Math.round(dark[c]! + (light[c]! - dark[c]!) * m);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
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
  const flat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  // The pictures: the gun's own materials, lit from the upper front.
  const lights = [new THREE.HemisphereLight(0xffffff, 0x404040, 1.6), new THREE.DirectionalLight(0xffffff, 2.4)];
  lights[1]!.position.set(3, 4, -2);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  // From the right-hand side: the barrel (which points down -Z) points to the right of the picture.
  camera.position.set(3, 0, 0);
  camera.lookAt(0, 0, 0);
  const todo = [...WEAPON_IDS];

  const step = () => {
    // Two a frame: each also reads back and recolours a large picture.
    for (let n = 0; n < 2 && todo.length > 0; n++) {
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
      scene.overrideMaterial = flat;
      renderer.render(scene, camera);
      icons.set(id, { url: renderer.domElement.toDataURL('image/png'), width: Math.round(width / 2), height: Math.round(height / 2) });
      // Same framing at three times the pixels, shaded.
      scene.overrideMaterial = null;
      scene.add(...lights);
      renderer.setSize(width * PICTURE_SCALE, height * PICTURE_SCALE, false);
      renderer.render(scene, camera);
      for (const tone of ['gold', 'light'] as const) pictures.set(`${tone}:${id}`, { url: tint(renderer.domElement, tone), width: Math.round(width / 2), height: Math.round(height / 2) });
      scene.remove(gun.group, ...lights);
    }
    if (todo.length > 0) requestAnimationFrame(step);
    else {
      flat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
  requestAnimationFrame(step);
}
