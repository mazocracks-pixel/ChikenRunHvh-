import * as THREE from 'three';

/**
 * The bomb: a small charge with a blinking red light. On the carrier's back while carried,
 * on the ground when dropped, and blinking faster and faster once planted.
 */
export class BombView {
  readonly root = new THREE.Group();
  private readonly light: THREE.Mesh;
  private readonly lightMaterial = new THREE.MeshStandardMaterial({ color: 0x5a0d0d, emissive: 0xff2a1a, emissiveIntensity: 0 });
  private readonly materials: THREE.Material[] = [this.lightMaterial];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(scene: THREE.Scene) {
    const body = this.part(new THREE.BoxGeometry(0.42, 0.18, 0.3), new THREE.MeshStandardMaterial({ color: 0x3d3a32, roughness: 0.7 }), 0, 0.09, 0);
    body.castShadow = true;
    // Charge blocks, a wired keypad and the light.
    for (const x of [-0.12, 0, 0.12]) this.part(new THREE.BoxGeometry(0.1, 0.06, 0.26), new THREE.MeshStandardMaterial({ color: 0xc9b98a, roughness: 0.85 }), x, 0.21, 0);
    this.part(new THREE.BoxGeometry(0.16, 0.02, 0.12), new THREE.MeshStandardMaterial({ color: 0x1b2a1f, emissive: 0x3cff6b, emissiveIntensity: 0.35 }), -0.06, 0.25, 0.04);
    this.light = this.part(new THREE.SphereGeometry(0.035, 10, 8), this.lightMaterial, 0.13, 0.26, 0.09);
    this.root.visible = false;
    scene.add(this.root);
  }

  /**
   * @param at where it is (null hides it); yaw turns it with a carrier
   * @param blinkHz how fast the light blinks (0 = off)
   */
  update(at: THREE.Vector3 | null, yaw: number, blinkHz: number, time: number): void {
    this.root.visible = at !== null;
    if (!at) return;
    this.root.position.copy(at);
    this.root.rotation.y = yaw;
    const on = blinkHz > 0 && (time * blinkHz) % 1 < 0.5;
    this.lightMaterial.emissiveIntensity = on ? 3 : 0.15;
    this.light.scale.setScalar(on ? 1.25 : 1);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
  }

  private part(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    this.root.add(mesh);
    this.geometries.push(geometry);
    if (!this.materials.includes(material)) this.materials.push(material);
    return mesh;
  }
}
