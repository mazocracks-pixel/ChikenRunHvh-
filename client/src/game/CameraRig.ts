import * as THREE from 'three';
import { PLAYER, damp, makeRay, raycastWorld, type CollisionWorld } from '@game/shared';
import { getSettings } from '../settings';
import { storage } from '../ui/dom';

const DISTANCE = 4.2;
const HEAD_HEIGHT = 1.5;
const SHOULDER_OFFSET = 0.6;
const MIN_DISTANCE = 0.4;
const WALL_PADDING = 0.3;
const MIN_CAMERA_Y = 0.25;
const DRIVE_DISTANCE = 6.5;

/** The field of view (degrees, vertical) when not zoomed in, from Settings. */
export function baseFov(): number {
  return getSettings().fov;
}

/**
 * How much slower the view should turn at `zoom`, so the crosshair moves across the
 * scene at the same on-screen speed as when not zoomed.
 */
export function zoomLookScale(zoom: number): number {
  return 1 / Math.max(1, zoom);
}

export type CameraMode = 'third' | 'first';

const CAMERA_KEY = 'chikengun:camera';
let preferredMode: CameraMode = storage.get(CAMERA_KEY) === 'third' ? 'third' : 'first';

/** The player's chosen view, remembered between matches and visits. */
export function getCameraMode(): CameraMode {
  return preferredMode;
}

export function setCameraMode(mode: CameraMode): void {
  preferredMode = mode;
  storage.set(CAMERA_KEY, mode);
}

/**
 * Over-the-shoulder third-person camera (pulls in when something is between it and the
 * player), first-person view, scope zoom, screen shake and the death camera.
 */
export class CameraRig {
  hvhThirdPerson = false;
  hvhFov = 0;
  hvhNoShake = false;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: CollisionWorld;
  private readonly focus = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private distance = DISTANCE;
  private zoom = 1;
  private shakeAmount = 0;
  private shakeTime = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private deathAngle = 0;

  constructor(camera: THREE.PerspectiveCamera, world: CollisionWorld) {
    this.camera = camera;
    this.world = world;
  }

  /** Driving always uses the chase camera (the roll cage would fill a first-person view). */
  driving = false;

  get firstPerson(): boolean {
    return preferredMode === 'first' && !this.driving && !this.hvhThirdPerson;
  }

  /** V key: switch between third and first person. Returns the new mode. */
  toggle(): CameraMode {
    setCameraMode(preferredMode === 'third' ? 'first' : 'third');
    return preferredMode;
  }

  addShake(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0 || this.reducedMotion.matches || this.hvhNoShake) return;
    this.shakeAmount = Math.min(1, this.shakeAmount + amount);
  }

  /** Follow the player. `forceFirst` is used while scoped in with a sniper. */
  /** @param bodyScale 1 standing, smaller while crouched (lowers the eyes and the shoulder camera). */
  follow(target: THREE.Vector3, yaw: number, pitch: number, zoom: number, dt: number, forceFirst = false, driving = false, bodyScale = 1): void {
    const cosPitch = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cosPitch;
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * cosPitch;

    this.driving = driving;
    if ((preferredMode === 'first' && !driving && !this.hvhThirdPerson) || (forceFirst && !this.hvhThirdPerson)) {
      this.camera.position.set(target.x + fx * 0.3, target.y + PLAYER.eyeHeight * bodyScale + 0.05, target.z + fz * 0.3);
    } else {
      this.back.set(-fx, -fy, -fz);
      // Focus sits above the head and slightly to the right, so the player doesn't block the crosshair.
      // Further back and centred while driving, so you can see the whole buggy.
      const shoulder = driving ? 0 : SHOULDER_OFFSET;
      const maxDistance = driving ? DRIVE_DISTANCE : DISTANCE;
      this.focus.set(target.x + Math.cos(yaw) * shoulder, target.y + (driving ? 1.6 : HEAD_HEIGHT * (0.4 + 0.6 * bodyScale)), target.z - Math.sin(yaw) * shoulder);
      let wanted = maxDistance;
      const hit = raycastWorld(makeRay(this.focus, this.back), this.world, maxDistance);
      if (hit) wanted = Math.max(MIN_DISTANCE, hit.t - WALL_PADDING);
      // Snap in immediately (never show the inside of a wall), ease back out smoothly.
      this.distance = wanted < this.distance ? wanted : damp(this.distance, wanted, 6, dt);
      this.camera.position.copy(this.focus).addScaledVector(this.back, this.distance);
      this.camera.position.y = Math.max(this.camera.position.y, MIN_CAMERA_Y);
    }
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    this.applyZoomAndShake(zoom, dt);
  }

  /** Slowly circles the spot where the player died. */
  orbit(centre: THREE.Vector3, dt: number): void {
    this.deathAngle += dt * 0.4;
    const r = 6;
    const pos = new THREE.Vector3(centre.x + Math.sin(this.deathAngle) * r, centre.y + 3.5, centre.z + Math.cos(this.deathAngle) * r);
    const hit = raycastWorld(makeRay(centre, new THREE.Vector3().subVectors(pos, centre).normalize()), this.world, r + 1);
    if (hit) pos.lerpVectors(centre, pos, Math.max(0.2, (hit.t - 0.3) / (r + 1)));
    this.camera.position.copy(pos);
    this.camera.lookAt(centre.x, centre.y + 0.5, centre.z);
    this.applyZoomAndShake(1, dt);
  }

  /** Free-floating overview (results screen, waiting for respawn without a body). */
  overview(dt: number, halfSize: number): void {
    this.deathAngle += dt * 0.08;
    const r = halfSize * 1.15;
    this.camera.position.set(Math.cos(this.deathAngle) * r, halfSize * 0.55, Math.sin(this.deathAngle) * r);
    this.camera.lookAt(0, 1, 0);
    this.applyZoomAndShake(1, dt);
  }

  private applyZoomAndShake(zoom: number, dt: number): void {
    this.shakeTime += dt;
    this.zoom = damp(this.zoom, zoom, 14, dt);
    const base = this.hvhFov > 0 ? Math.max(30,this.hvhFov) : baseFov();
    const fov = 360 / Math.PI * Math.atan(Math.tan(base * Math.PI / 360) / this.zoom);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.reducedMotion.matches || this.hvhNoShake) this.shakeAmount = 0;
    if (this.shakeAmount <= 0.001) return;
    // Continuous vibration feels like an impact instead of changing direction randomly each frame.
    // Translation only: no extra aim kick, and less displacement through a magnified scope.
    const amplitude = this.shakeAmount ** 1.6 * 0.11 / Math.sqrt(this.zoom);
    const t = this.shakeTime;
    this.camera.position.x += (Math.sin(t * 61) + Math.sin(t * 97) * 0.35) * amplitude;
    this.camera.position.y += (Math.sin(t * 73 + 1.2) + Math.sin(t * 113) * 0.3) * amplitude * 0.7;
    this.camera.position.z += Math.sin(t * 53 + 0.7) * amplitude * 0.4;
    this.shakeAmount = damp(this.shakeAmount, 0, 7.5, dt);
  }
}
