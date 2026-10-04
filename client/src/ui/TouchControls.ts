import type { Action, Input } from '../game/Input';
import { h } from './dom';

const STICK_RADIUS = 55;

/**
 * On-screen controls for phones and tablets: a floating joystick on the left half,
 * drag-to-look on the right half, and action buttons. Feeds the same Input as the keyboard.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private readonly input: Input;
  private readonly stickBase = h('div', { class: 'stick-base' });
  private readonly stickKnob = h('div', { class: 'stick-knob' });
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private readonly lookers = new Map<number, { x: number; y: number }>();
  private aimOn = false;
  /** ChikenBomb only: hold to plant / defuse, and the buy menu. */
  private readonly bombButtons: HTMLElement[] = [];

  constructor(container: HTMLElement, input: Input) {
    this.input = input;
    this.stickBase.append(this.stickKnob);
    this.stickBase.hidden = true;

    const hold = (label: string, button: 'fire' | 'jump' | 'use', cls: string) => {
      const el = h('button', { class: `touch-btn ${cls}`, type: 'button' }, label);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        input.setTouchButton(button, true);
        // Dragging from the fire button also aims.
        if (button === 'fire') this.lookers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      });
      const release = (e: PointerEvent) => {
        input.setTouchButton(button, false);
        this.lookers.delete(e.pointerId);
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointermove', (e) => this.lookMove(e));
      return el;
    };
    const tap = (label: string, action: Action | (() => void), cls: string) => {
      const el = h('button', { class: `touch-btn ${cls}`, type: 'button' }, label);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof action === 'function') action();
        else input.pushAction(action);
      });
      return el;
    };
    const aim = tap(
      '◎',
      () => {
        this.aimOn = !this.aimOn;
        input.setTouchButton('aim', this.aimOn);
        aim.classList.toggle('on', this.aimOn);
      },
      'aim',
    );

    // Crouch is a toggle on touch screens (holding a second thumb down while aiming is awkward).
    let crouched = false;
    const crouch = tap(
      '⤓',
      () => {
        crouched = !crouched;
        input.setTouchButton('crouch', crouched);
        crouch.classList.toggle('on', crouched);
      },
      'crouch',
    );

    this.root = h(
      'div',
      { class: 'touch-controls' },
      this.stickBase,
      hold('🔫', 'fire', 'fire'),
      hold('⤒', 'jump', 'jump'),
      aim,
      tap('R', 'reload', 'reload'),
      tap('🥚', 'egg', 'egg'),
      tap('⇄', 'nextWeapon', 'weapon'),
      tap('👁', 'camera', 'camera'),
      tap('💨', 'smoke', 'smoke'),
      tap('⚡', 'flash', 'flash'),
      crouch,
    );
    this.bombButtons.push(hold('💣', 'use', 'use'), tap('🛒', 'build', 'buy'));
    for (const b of this.bombButtons) {
      b.hidden = true;
      this.root.append(b);
    }
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', this.onDown);
    this.root.addEventListener('pointermove', this.onMove);
    this.root.addEventListener('pointerup', this.onUp);
    this.root.addEventListener('pointercancel', this.onUp);
    container.append(this.root);
  }

  /** Shows the plant / defuse and buy buttons in ChikenBomb. */
  setBombMode(on: boolean): void {
    for (const b of this.bombButtons) b.hidden = !on;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    this.input.touchActive = visible;
    if (!visible) this.reset();
  }

  private reset(): void {
    this.stickId = null;
    this.stickBase.hidden = true;
    this.lookers.clear();
    this.input.setTouchAxes(0, 0);
    this.input.setTouchButton('fire', false);
    this.input.setTouchButton('jump', false);
    this.input.setTouchButton('use', false);
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.root.setPointerCapture(e.pointerId);
    if (e.clientX < window.innerWidth * 0.4 && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickBase.hidden = false;
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
    } else {
      this.lookers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.input.setTouchAxes(-dy / STICK_RADIUS, dx / STICK_RADIUS);
      return;
    }
    this.lookMove(e);
  };

  private lookMove(e: PointerEvent): void {
    const last = this.lookers.get(e.pointerId);
    if (!last) return;
    this.input.lookTouch(e.clientX - last.x, e.clientY - last.y);
    last.x = e.clientX;
    last.y = e.clientY;
  }

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickBase.hidden = true;
      this.input.setTouchAxes(0, 0);
    }
    this.lookers.delete(e.pointerId);
  };
}

export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}
