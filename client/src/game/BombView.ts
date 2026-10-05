import * as THREE from 'three';

/** What the bomb is doing (it looks and reads differently for each). */
export type BombMode = 'carried' | 'dropped' | 'planting' | 'planted' | 'defusing' | 'defused';

/** What CS players will recognise on the screen while it's being planted. */
const CODE = '7355608';

/**
 * The bomb: a C4-style charge (taped sticks, wires, a keypad, a little LCD and a red light). On
 * the carrier's back, on the ground in front of whoever is planting it (the code appears digit by
 * digit), then counting down with the light blinking faster; "SAFE" once defused.
 */
export class BombView {
  readonly root = new THREE.Group();
  private readonly lightMaterial = new THREE.MeshStandardMaterial({ color: 0x5a0d0d, emissive: 0xff2a1a, emissiveIntensity: 0 });
  private readonly light: THREE.Mesh;
  private readonly glow: THREE.Sprite;
  private readonly glowMaterial: THREE.SpriteMaterial;
  private readonly lcd: THREE.CanvasTexture;
  private readonly lcdCanvas = document.createElement('canvas');
  private lcdText = '';
  private readonly keys: THREE.MeshStandardMaterial;
  private readonly materials: THREE.Material[] = [this.lightMaterial];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(scene: THREE.Scene) {
    const tan = new THREE.MeshStandardMaterial({ color: 0xc9b98a, roughness: 0.85 });
    const tape = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6 });
    const board = new THREE.MeshStandardMaterial({ color: 0x2f3b2c, roughness: 0.7 });
    // Base board and four sticks of charge, taped together.
    this.part(new THREE.BoxGeometry(0.44, 0.04, 0.3), board, 0, 0.02, 0);
    for (const x of [-0.15, -0.05, 0.05, 0.15]) this.part(new THREE.CylinderGeometry(0.048, 0.048, 0.28, 10).rotateX(Math.PI / 2), tan, x, 0.09, 0);
    for (const z of [-0.09, 0.09]) this.part(new THREE.BoxGeometry(0.42, 0.105, 0.035), tape, 0, 0.09, z);
    // Keypad box on top with an LCD and twelve keys.
    this.part(new THREE.BoxGeometry(0.22, 0.05, 0.17), new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.3 }), -0.03, 0.165, 0);
    this.lcdCanvas.width = 128;
    this.lcdCanvas.height = 40;
    this.lcd = new THREE.CanvasTexture(this.lcdCanvas);
    this.lcd.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.MeshBasicMaterial({ map: this.lcd, toneMapped: false });
    this.part(new THREE.PlaneGeometry(0.16, 0.05).rotateX(-Math.PI / 2), screen, -0.03, 0.191, -0.045);
    this.keys = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, emissive: 0x3cff6b, emissiveIntensity: 0 });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) this.part(new THREE.BoxGeometry(0.026, 0.012, 0.022), this.keys, -0.09 + c * 0.04, 0.196, 0.0 + r * 0.03);
    // Wires (red and blue loops) and the light with a glow that reads from far away.
    const red = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.5 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1565c0, roughness: 0.5 });
    this.part(new THREE.TorusGeometry(0.05, 0.007, 6, 14, Math.PI), red, 0.13, 0.15, 0.04, 0, Math.PI / 2);
    this.part(new THREE.TorusGeometry(0.04, 0.007, 6, 14, Math.PI), blue, 0.13, 0.15, -0.04, 0, Math.PI / 2);
    this.part(new THREE.CylinderGeometry(0.004, 0.004, 0.12), tape, 0.17, 0.22, 0.1);
    this.light = this.part(new THREE.SphereGeometry(0.03, 10, 8), this.lightMaterial, 0.12, 0.2, -0.08);
    this.glowMaterial = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff3020, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.glow = new THREE.Sprite(this.glowMaterial);
    this.glow.scale.setScalar(0.9);
    this.glow.position.set(0.12, 0.22, -0.08);
    this.root.add(this.glow);
    this.materials.push(this.glowMaterial, screen);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.root.visible = false;
    scene.add(this.root);
  }

  /**
   * @param at where it is (null hides it); `yaw` turns it with its carrier or planter
   * @param progress planting / defusing, 0..1
   * @param secondsLeft once planted
   */
  update(at: THREE.Vector3 | null, yaw: number, mode: BombMode, progress: number, secondsLeft: number, blinkHz: number, time: number): void {
    this.root.visible = at !== null;
    if (!at) return;
    this.root.position.copy(at);
    this.root.rotation.y = yaw;
    // Bigger on the ground (easy to spot), its real size on a carrier's back.
    this.root.scale.setScalar(mode === 'carried' ? 1 : 1.35);
    const on = blinkHz > 0 && (time * blinkHz) % 1 < 0.5;
    const steady = mode === 'defusing';
    const safe = mode === 'defused';
    this.lightMaterial.emissive.setHex(safe ? 0x3cff6b : steady ? 0xffc940 : 0xff2a1a);
    this.lightMaterial.emissiveIntensity = safe || steady || on ? 3 : 0.15;
    this.light.scale.setScalar(on ? 1.3 : 1);
    this.glowMaterial.color.setHex(safe ? 0x3cff6b : steady ? 0xffc940 : 0xff3020);
    this.glowMaterial.opacity = mode === 'planted' || mode === 'defusing' || safe ? (on || steady || safe ? 0.9 : 0.25) : 0;
    // Keys flash while the code goes in.
    this.keys.emissiveIntensity = mode === 'planting' ? ((time * 7) % 1 < 0.5 ? 1.2 : 0.1) : 0;
    this.setLcd(
      mode === 'planting'
        ? CODE.slice(0, Math.min(CODE.length, Math.floor(progress * (CODE.length + 1)))).padEnd(CODE.length, '*')
        : mode === 'planted'
          ? `${Math.floor(secondsLeft / 60)}:${String(Math.floor(secondsLeft % 60)).padStart(2, '0')}`
          : mode === 'defusing'
            ? `${(time * 3) % 1 < 0.5 ? 'DEF' : '   '} ${Math.round(progress * 100)}%`
            : safe
              ? 'SAFE'
              : '-------',
      safe ? '#3cff6b' : '#ff4a3a',
    );
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    this.lcd.dispose();
  }

  private setLcd(text: string, color: string): void {
    if (text + color === this.lcdText) return;
    this.lcdText = text + color;
    const ctx = this.lcdCanvas.getContext('2d')!;
    ctx.fillStyle = '#0b1a0e';
    ctx.fillRect(0, 0, 128, 40);
    ctx.fillStyle = color;
    ctx.font = 'bold 26px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 21);
    this.lcd.needsUpdate = true;
  }

  private part(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    this.root.add(mesh);
    this.geometries.push(geometry);
    if (!this.materials.includes(material)) this.materials.push(material);
    return mesh;
  }
}

let glow: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c);
  return glow;
}
