import * as THREE from 'three';
import { hex } from '../../ui/dom';

const FONT = '600 44px system-ui, -apple-system, "Segoe UI", sans-serif';
const CANVAS_HEIGHT = 64;
const PAD_X = 22;
const WORLD_HEIGHT = 0.28;
/** Rainbow names are redrawn this often (a tiny canvas, and only for developer accounts). */
const RAINBOW_FPS = 20;
/** Seconds for the colours to go once around the wheel. */
const RAINBOW_PERIOD = 3;

/**
 * A camera-facing label drawn onto a canvas. Developer accounts get a flowing, glowing rainbow
 * (call `animate` every frame). Call `dispose` when the player leaves.
 */
export class NameTag {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastDraw = -Infinity;

  constructor(
    private readonly text: string,
    private readonly color = 0xffffff,
    private readonly rainbow = false,
  ) {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    ctx.font = FONT;
    this.canvas.width = Math.ceil(ctx.measureText(text).width) + PAD_X * 2;
    this.canvas.height = CANVAS_HEIGHT;
    this.draw(0);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false }));
    this.sprite.scale.set((WORLD_HEIGHT * this.canvas.width) / this.canvas.height, WORLD_HEIGHT, 1);
    this.sprite.position.y = 2.0;
  }

  /** Moves the rainbow along. `time` in seconds. Does nothing for normal names. */
  animate(time: number): void {
    if (!this.rainbow || !this.sprite.visible || time - this.lastDraw < 1 / RAINBOW_FPS) return;
    this.lastDraw = time;
    this.draw((time / RAINBOW_PERIOD) % 1);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
  }

  /** @param phase 0..1, how far the rainbow has shifted. */
  private draw(phase: number): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Resizing the canvas resets its state, so set everything each time.
    ctx.font = FONT;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, canvas.height / 2);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = canvas.width / 2;
    const y = canvas.height / 2 + 2;
    if (!this.rainbow) {
      ctx.fillStyle = hex(this.color);
      ctx.fillText(this.text, x, y);
      return;
    }
    const gradient = ctx.createLinearGradient(PAD_X, 0, canvas.width - PAD_X, 0);
    for (let i = 0; i <= 6; i++) gradient.addColorStop(i / 6, `hsl(${(i / 6 + phase) * 360}, 100%, 62%)`);
    ctx.fillStyle = gradient;
    // Glow: the text drawn blurred in a colour that cycles too, then sharp on top.
    ctx.shadowColor = `hsl(${phase * 360}, 100%, 60%)`;
    ctx.shadowBlur = 14;
    ctx.fillText(this.text, x, y);
    ctx.shadowBlur = 0;
    ctx.fillText(this.text, x, y);
  }
}
