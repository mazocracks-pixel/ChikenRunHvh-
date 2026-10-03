import * as THREE from 'three';
import { box, cylinder, part, solid } from './materials';

/** A little farm buggy: open frame, roll cage, chunky wheels. Faces -Z; origin on the ground. */
export class Buggy {
  readonly root = new THREE.Group();
  private readonly wheels: THREE.Object3D[] = [];
  private readonly body = new THREE.Group();
  private spin = 0;

  constructor(color = 0xe53935) {
    const paint = solid(color, { roughness: 0.45 });
    const dark = solid(0x263238);
    const metal = solid(0x9e9e9e, { metal: true });
    this.body.add(
      part(box(1.6, 0.32, 2.9), paint, 0, 0.62, 0),
      part(box(1.5, 0.3, 0.7), paint, 0, 0.88, -1.0),
      part(box(1.7, 0.18, 0.25), dark, 0, 0.58, -1.55),
      part(box(1.7, 0.18, 0.25), dark, 0, 0.58, 1.5),
      part(box(0.6, 0.3, 0.55), dark, 0, 0.9, 0.35),
      part(box(0.6, 0.6, 0.12), dark, 0, 1.15, 0.65),
      part(box(0.18, 0.1, 0.06), solid(0xfff59d), -0.55, 0.78, -1.68),
      part(box(0.18, 0.1, 0.06), solid(0xfff59d), 0.55, 0.78, -1.68),
    );
    // Roll cage.
    for (const x of [-0.7, 0.7]) {
      const bar = part(cylinder(0.04, 0.04, 1.1, 6), metal, x, 1.3, 0.6);
      const front = part(cylinder(0.04, 0.04, 1.25, 6), metal, x, 1.25, -0.15);
      front.rotation.x = 0.55;
      this.body.add(bar, front);
    }
    this.body.add(part(box(1.45, 0.06, 0.06), metal, 0, 1.85, 0.6), part(box(1.45, 0.06, 0.06), metal, 0, 1.78, -0.45));

    for (const [x, z] of [
      [-0.85, -1.05],
      [0.85, -1.05],
      [-0.85, 1.05],
      [0.85, 1.05],
    ] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.42, z);
      const wheel = part(cylinder(0.42, 0.42, 0.32, 14), dark);
      wheel.rotation.z = Math.PI / 2;
      const hub = part(cylinder(0.16, 0.16, 0.34, 8), metal);
      hub.rotation.z = Math.PI / 2;
      pivot.add(wheel, hub);
      this.wheels.push(pivot);
      this.root.add(pivot);
    }
    this.root.add(this.body);
  }

  /** Where the driver sits (local coordinates). */
  static readonly SEAT = new THREE.Vector3(0, 0.35, 0.3);

  animate(dt: number, speed: number): void {
    this.spin += (speed / 0.42) * dt;
    for (const w of this.wheels) w.rotation.x = -this.spin;
    // A little bounce at speed.
    this.body.position.y = Math.sin(this.spin * 0.7) * 0.015 * Math.min(1, Math.abs(speed) / 10);
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
