import { clamp, wrapAngle, type InputFrame } from '@game/shared';
import { enterPlayFullscreen } from '../fullscreen';
import { MOUSE_BASE, TOUCH_BASE, watchSettings } from '../settings';

const PITCH_MIN = -1.25;
const PITCH_MAX = 1.1;
/** Ignore mouse movement for this long after the pointer gets locked. */
const LOCK_SETTLE_MS = 250;
/** A single mousemove larger than this (px) is a browser glitch, not a flick. */
const MAX_MOUSE_DELTA = 250;

export type Action =
  | 'reload'
  | 'egg'
  | 'smoke'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'slot4'
  | 'slot5'
  | 'slot6'
  | 'slot7'
  | 'slot8'
  | 'slot9'
  | 'nextWeapon'
  | 'prevWeapon'
  | 'camera'
  | 'chat'
  | 'use'
  | 'build'
  | 'nextBlock'
  | 'inspect';

const KEY_ACTIONS: Record<string, Action> = {
  KeyR: 'reload',
  KeyG: 'egg',
  KeyQ: 'smoke',
  Digit1: 'slot1',
  Digit2: 'slot2',
  Digit3: 'slot3',
  Digit4: 'slot4',
  Digit5: 'slot5',
  Digit6: 'slot6',
  Digit7: 'slot7',
  Digit8: 'slot8',
  Digit9: 'slot9',
  KeyV: 'camera',
  KeyT: 'chat',
  Enter: 'chat',
  KeyE: 'use',
  KeyB: 'build',
  KeyX: 'nextBlock',
  KeyF: 'inspect',
};

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
/**
 * Crouch: either Ctrl, or C. While Ctrl is held every blockable browser shortcut is blocked
 * (Ctrl+R reload, Ctrl+1-4 switch tab, Ctrl+S, Ctrl+scroll zoom); Ctrl+W / T / N only reach
 * the game in full screen with Keyboard Lock (see fullscreen.ts).
 */
const CROUCH = ['ControlLeft', 'ControlRight', 'KeyC'];
/** Keys whose default browser action (scrolling, focus change) we suppress while playing. */
const GAME_KEYS = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...CROUCH, 'Space', 'Tab']);

/**
 * Keyboard + pointer-locked mouse, plus a touch mode fed by the on-screen controls.
 * Game input only counts while "active" (pointer locked, or touch mode), so typing in menus
 * never moves the chicken.
 */
export class Input {
  /** Look direction in radians. Yaw 0 faces -Z; positive pitch looks up. */
  yaw = 0;
  pitch = -0.15;
  /** Turned off while typing in chat. */
  enabled = true;
  /** App menus suspend play without disturbing the chat input state. */
  suspended = false;
  /** A panel may request normal ADS; this cannot remove recoil or movement spread. */
  assistedAds = false;
  /** On touch devices there's no pointer lock: input is active whenever a match is shown. */
  touchMode = false;
  touchActive = false;
  /** Mouse look speed in radians per pixel (from Settings). */
  sensitivity = MOUSE_BASE;
  /** Drag-to-look speed in radians per pixel (from Settings). */
  touchSensitivity = TOUCH_BASE;
  invertY = false;
  /** Go full screen (with Keyboard Lock where supported) when the game takes the mouse. */
  fullscreen = false;
  /**
   * Extra look multiplier while zoomed in, set every frame by the game: 1 / zoom × the zoom
   * sensitivity setting, so the scope doesn't feel twitchy.
   */
  zoomScale = 1;
  onLockChange: ((locked: boolean) => void) | null = null;

  private readonly target: HTMLElement;
  private readonly keys = new Set<string>();
  /** Mouse buttons held while pointer-locked (0 left, 1 middle, 2 right, 3/4 side buttons). */
  private readonly buttons = new Set<number>();
  private readonly queue: Action[] = [];
  private locked = false;
  private lockedAt = 0;
  private fireHeld = false;
  private aimHeld = false;
  private touchAxes = { forward: 0, right: 0 };
  private touchButtons = { fire: false, aim: false, jump: false, crouch: false, use: false };

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    // Not passive: Ctrl+scroll (crouch + switch weapon) must not zoom the page.
    document.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    watchSettings((s) => {
      this.sensitivity = s.mouseSensitivity * MOUSE_BASE;
      this.touchSensitivity = s.touchSensitivity * TOUCH_BASE;
      this.invertY = s.invertY;
      this.fullscreen = s.fullscreen;
    });
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** Whether gameplay input is being read right now. */
  get active(): boolean {
    return this.enabled && !this.suspended && (this.locked || (this.touchMode && this.touchActive));
  }

  get firing(): boolean {
    return this.active && (this.fireHeld || this.touchButtons.fire);
  }

  get aiming(): boolean {
    return this.active && (this.aimHeld || this.touchButtons.aim || this.assistedAds);
  }

  get scoreboardHeld(): boolean {
    return this.keys.has('Tab');
  }

  /** Must be called from a user gesture (click / submit). Failure just leaves the game paused. */
  async requestLock(): Promise<void> {
    if (this.touchMode) return;
    try {
      // Raw, un-accelerated mouse movement where supported (Chromium).
      await this.target.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await this.target.requestPointerLock();
      } catch {
        // Denied (e.g. re-locking too soon after Esc). The pause overlay stays up.
        return;
      }
    }
    // After the lock: going full screen uses up the click, and the lock needs it too.
    if (this.fullscreen) await enterPlayFullscreen();
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** One-shot actions pressed since the last call. */
  consumeActions(): Action[] {
    return this.queue.splice(0);
  }

  sample(seq: number): InputFrame {
    const axis = (plus: string[], minus: string[]) => (this.anyDown(plus) ? 1 : 0) - (this.anyDown(minus) ? 1 : 0);
    const active = this.active;
    return {
      seq,
      forward: active ? clamp(axis(FORWARD, BACK) + this.touchAxes.forward, -1, 1) : 0,
      right: active ? clamp(axis(RIGHT, LEFT) + this.touchAxes.right, -1, 1) : 0,
      jump: active && (this.keys.has('Space') || this.touchButtons.jump),
      crouch: active && (this.anyDown(CROUCH) || this.touchButtons.crouch),
      use: active && (this.keys.has('KeyE') || this.touchButtons.use),
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }

  /** Camera kick from recoil. */
  kick(pitch: number, yaw: number): void {
    this.pitch = clamp(this.pitch + pitch, PITCH_MIN, PITCH_MAX);
    this.yaw = wrapAngle(this.yaw + yaw);
  }

  /** Turns the view by a mouse / finger movement in pixels, at `radiansPerPixel`. */
  private look(dx: number, dy: number, radiansPerPixel: number): void {
    const k = radiansPerPixel * this.zoomScale;
    this.yaw = wrapAngle(this.yaw - dx * k);
    this.pitch = clamp(this.pitch - dy * k * (this.invertY ? -1 : 1), PITCH_MIN, PITCH_MAX);
  }

  // ---- touch controls feed these ----

  lookTouch(dx: number, dy: number): void {
    this.look(dx, dy, this.touchSensitivity);
  }

  /**
   * Whether a bindable key is held: a KeyboardEvent.code ("KeyF", "ShiftLeft") or a mouse
   * button as "Mouse0"…"Mouse4". Only counts while game input is active.
   */
  isDown(code: string): boolean {
    if (!this.active) return false;
    if (code.startsWith('Mouse')) return this.buttons.has(Number(code.slice(5)));
    return this.keys.has(code);
  }

  setTouchAxes(forward: number, right: number): void {
    this.touchAxes = { forward, right };
  }

  setTouchButton(button: 'fire' | 'aim' | 'jump' | 'crouch' | 'use', down: boolean): void {
    this.touchButtons[button] = down;
  }

  pushAction(action: Action): void {
    if (this.active || action === 'chat') this.queue.push(action);
  }

  // ---- DOM events ----

  private anyDown(codes: string[]): boolean {
    return codes.some((code) => this.keys.has(code));
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (e.code === 'Tab' && this.active) e.preventDefault();
    if (!this.active) return;
    if (GAME_KEYS.has(e.code) || e.code in KEY_ACTIONS || e.ctrlKey) e.preventDefault();
    if (!e.repeat) {
      const action = KEY_ACTIONS[e.code];
      if (action) this.queue.push(action);
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.buttons.clear();
    this.fireHeld = false;
    this.aimHeld = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked || !this.enabled) return;
    // Browsers report bogus movement while the cursor is being captured, and Chromium
    // occasionally emits huge spikes; neither should spin the camera around.
    if (performance.now() - this.lockedAt < LOCK_SETTLE_MS) return;
    if (Math.abs(e.movementX) > MAX_MOUSE_DELTA || Math.abs(e.movementY) > MAX_MOUSE_DELTA) return;
    this.look(e.movementX, e.movementY, this.sensitivity);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.buttons.add(e.button);
    if (e.button === 0) this.fireHeld = true;
    if (e.button === 2) this.aimHeld = true;
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.buttons.delete(e.button);
    if (e.button === 0) this.fireHeld = false;
    if (e.button === 2) this.aimHeld = false;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.active) return;
    if (e.ctrlKey) e.preventDefault();
    if (e.deltaY === 0) return;
    this.queue.push(e.deltaY > 0 ? 'nextWeapon' : 'prevWeapon');
  };

  private onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.target;
    this.lockedAt = performance.now();
    if (!this.locked) {
      this.keys.clear();
      this.buttons.clear();
      this.fireHeld = false;
      this.aimHeld = false;
    }
    this.onLockChange?.(this.locked);
  };
}
