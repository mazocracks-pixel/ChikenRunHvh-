import type { JumpscareStyle } from '@game/shared';
import type { AudioEngine, SoundName } from '../game/Audio';

/**
 * A demon chicken: ragged feathers, veined skin, slit-pupil eyes that pulse, and a jaw full of
 * teeth that snaps open. Parts with a `js-` class are animated in style.css.
 */
const CHICKEN = `
<svg viewBox="0 0 400 420" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="js-skin" cx="50%" cy="40%" r="62%">
      <stop offset="0" stop-color="#f4efe2"/><stop offset="0.6" stop-color="#c2b79e"/><stop offset="1" stop-color="#4a4034"/>
    </radialGradient>
    <radialGradient id="js-iris" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff3b0"/><stop offset="0.3" stop-color="#ff3a12"/><stop offset="0.75" stop-color="#8a0000"/><stop offset="1" stop-color="#1a0000"/>
    </radialGradient>
    <filter id="js-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <path d="M60 215 L32 172 L68 160 L48 112 L94 120 L92 70 L136 94 L150 48 L180 84 L200 36 L220 84 L250 48 L264 94 L308 70 L306 120 L352 112 L332 160 L368 172 L340 215 Z" fill="#7d7262"/>
  <path d="M132 72 C118 18 168 10 172 56 C176 4 228 2 224 56 C238 10 292 22 270 82 Z" fill="#8e0a0a"/>
  <ellipse cx="200" cy="210" rx="150" ry="165" fill="url(#js-skin)"/>
  <g stroke="#a3161a" stroke-width="2.4" fill="none" opacity="0.75">
    <path d="M78 150 Q95 160 92 182 Q100 196 88 214"/><path d="M322 150 Q305 162 310 184 Q300 198 312 216"/>
    <path d="M110 238 Q120 250 112 268"/><path d="M290 238 Q280 252 290 270"/><path d="M170 120 Q182 104 176 88"/>
  </g>
  <g class="js-eyes">
    <circle cx="135" cy="180" r="52" fill="#000"/><circle cx="265" cy="180" r="52" fill="#000"/>
    <circle cx="135" cy="182" r="30" fill="#ff1a0a" filter="url(#js-glow)"/><circle cx="265" cy="182" r="30" fill="#ff1a0a" filter="url(#js-glow)"/>
    <circle class="js-iris" cx="135" cy="182" r="22" fill="url(#js-iris)"/><circle class="js-iris" cx="265" cy="182" r="22" fill="url(#js-iris)"/>
    <ellipse class="js-pupil" cx="135" cy="182" rx="4" ry="15" fill="#000"/><ellipse class="js-pupil" cx="265" cy="182" rx="4" ry="15" fill="#000"/>
  </g>
  <path d="M90 118 L172 152 M310 118 L228 152" stroke="#2c241a" stroke-width="14" stroke-linecap="round"/>
  <path d="M148 252 L252 252 L242 366 Q200 392 158 366 Z" fill="#160303"/>
  <path d="M176 300 Q200 318 224 300" stroke="#5a0a0a" stroke-width="6" fill="none"/>
  <g class="js-jaw">
    <path d="M160 352 L170 322 L180 354 L191 318 L202 356 L213 318 L224 354 L234 322 L242 352 Z" fill="#e6dcbf"/>
    <path d="M150 352 Q200 400 250 352 L256 370 Q200 424 144 370 Z" fill="#c06f14"/>
    <path d="M186 380 Q192 410 188 418 M214 382 Q208 404 212 414" stroke="#d8e4e0" stroke-width="3" opacity="0.7" fill="none"/>
  </g>
  <path d="M118 236 L200 208 L282 236 L252 262 L148 262 Z" fill="#d6831a"/>
  <path d="M152 260 L162 292 L174 260 L186 296 L198 260 L210 296 L222 260 L234 292 L246 260 Z" fill="#f3ecd6"/>
</svg>`;

/** A pale ghost: long dark hair, hollow eyes with pinprick pupils and a mouth that stretches open. */
const GHOST = `
<svg viewBox="0 0 400 420" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="js-ghost" cx="50%" cy="38%" r="62%">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#c3cad3"/><stop offset="1" stop-color="#2c3139"/>
    </radialGradient>
  </defs>
  <path d="M200 20 C330 20 352 150 344 236 C336 336 290 410 200 410 C110 410 64 336 56 236 C48 150 70 20 200 20 Z" fill="url(#js-ghost)"/>
  <path d="M200 14 C110 10 50 70 40 170 L30 420 L80 420 L92 160 C110 90 150 70 200 66 C250 70 290 90 308 160 L320 420 L370 420 L360 170 C350 70 290 10 200 14 Z" fill="#07080b"/>
  <path d="M100 90 Q88 170 98 260 M300 90 Q312 170 302 260" stroke="#07080b" stroke-width="8" fill="none"/>
  <ellipse cx="146" cy="186" rx="34" ry="54" transform="rotate(-10 146 186)" fill="#030405"/>
  <ellipse cx="254" cy="186" rx="34" ry="54" transform="rotate(10 254 186)" fill="#030405"/>
  <circle class="js-pupil" cx="150" cy="194" r="4" fill="#e8f0ff"/><circle class="js-pupil" cx="250" cy="194" r="4" fill="#e8f0ff"/>
  <path d="M118 250 Q140 270 136 300 M282 250 Q260 270 264 300" stroke="#7d858f" stroke-width="5" fill="none" opacity="0.7"/>
  <ellipse class="js-mouth" cx="200" cy="320" rx="40" ry="70" fill="#030405"/>
</svg>`;

interface Plan {
  /** How long it stays on screen. */
  ms: number;
  /** Sounds and when to play them. */
  sounds: [SoundName, number, number][];
  /** When the chicken pecks the glass (cracks appear), if it does. */
  crackAt?: number;
  blood: boolean;
  shake: number;
}

const PLANS: Record<JumpscareStyle, Plan> = {
  chicken: { ms: 2300, sounds: [['scareHit', 0, 1.4], ['scream', 0, 1.6], ['glassCrack', 170, 1.3], ['heartbeat', 1450, 1.3]], crackAt: 170, blood: true, shake: 700 },
  ghost: { ms: 2300, sounds: [['scareHit', 0, 1.4], ['wail', 0, 1.6], ['heartbeat', 1450, 1.3]], blood: true, shake: 600 },
  glitch: { ms: 2100, sounds: [['scareHit', 0, 1.2], ['static', 0, 1.6], ['heartbeat', 1350, 1.3]], blood: false, shake: 900 },
  flash: { ms: 2600, sounds: [['flashbang', 0, 1.4], ['ring', 0, 1]], blood: false, shake: 250 },
};

let noise: string | null = null;
/** A tile of grey TV static (made once). */
function noiseTile(): string {
  if (noise) return noise;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noise = c.toDataURL();
  return noise;
}

/** Cracked glass around where the chicken pecked: jagged rays and two broken rings. */
function cracks(): string {
  const cx = 40 + Math.random() * 20;
  const cy = 45 + Math.random() * 15;
  let paths = '';
  const rays = 13;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + Math.random() * 0.3;
    let x = cx;
    let y = cy;
    let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    const length = 30 + Math.random() * 45;
    for (let r = 0; r < length; r += 6 + Math.random() * 6) {
      const wobble = a + (Math.random() - 0.5) * 0.5;
      x = cx + Math.cos(wobble) * r;
      y = cy + Math.sin(wobble) * r * 0.62;
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    paths += `<path d="${d}"/>`;
  }
  for (const ring of [6, 15]) {
    let d = '';
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = ring * (0.8 + Math.random() * 0.4);
      d += `${i ? ' L' : 'M'}${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r * 0.62).toFixed(1)}`;
    }
    paths += `<path d="${d}"/>`;
  }
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g class="js-crack-shadow">${paths}</g><g class="js-crack-line">${paths}</g></svg>`;
}

/** Blood running down from the top of the screen. */
function blood(): string {
  let drips = '';
  for (let i = 0; i < 16; i++) {
    const x = (i + Math.random() * 0.8) * 6.4;
    const w = 1 + Math.random() * 2.4;
    const len = 18 + Math.random() * 55;
    const delay = Math.round(Math.random() * 500);
    drips += `<path class="js-drip" style="animation-delay:${delay}ms" d="M${x} 0 L${x + w} 0 L${x + w} ${len} Q${x + w / 2} ${len + w * 1.6} ${x} ${len} Z"/>`;
  }
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M0 0 L100 0 L100 3 Q75 5 50 3 Q25 6 0 3 Z"/>${drips}</svg>`;
}

let current: { el: HTMLElement; timers: number[] } | null = null;

function layer(className: string, html = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = html;
  return el;
}

/**
 * Shows a jumpscare over everything (sent by a developer from mega?dev): one white flash, a face
 * that bursts out of it with a scream, cracks / blood, the game shaking, and a heartbeat to end.
 * It flashes once only (never strobes) and can't be clicked, so it never gets in the way.
 * `flash` is just the white-out with ringing ears, like a flashbang.
 */
export function showJumpscare(style: JumpscareStyle, audio: AudioEngine): void {
  if (current) {
    current.el.remove();
    for (const t of current.timers) window.clearTimeout(t);
  }
  const plan = PLANS[style];
  const el = document.createElement('div');
  el.className = `jumpscare jumpscare-${style}`;
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--js-ms', `${plan.ms}ms`);
  const timers: number[] = [];
  const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

  if (style !== 'flash') {
    if (style === 'glitch') el.style.setProperty('--js-noise', `url(${noiseTile()})`);
    const face = layer('jumpscare-face', style === 'ghost' ? GHOST : CHICKEN);
    el.append(face);
    if (style === 'glitch') {
      // Two offset copies tinted red and cyan: the picture tearing apart.
      for (const tint of ['r', 'c']) {
        const copy = face.cloneNode(true) as HTMLElement;
        copy.classList.add(`jumpscare-split-${tint}`);
        el.append(copy);
      }
    }
    if (plan.blood) el.append(layer('jumpscare-blood', blood()));
    el.append(layer('jumpscare-vignette'));
  }
  if (plan.crackAt !== undefined) {
    const glass = layer('jumpscare-cracks', cracks());
    glass.hidden = true;
    el.append(glass);
    at(plan.crackAt, () => (glass.hidden = false));
  }
  el.append(layer('jumpscare-whiteout'));
  document.body.append(el);

  for (const [name, delay, volume] of plan.sounds) {
    if (delay === 0) audio.play(name, undefined, volume);
    else at(delay, () => audio.play(name, undefined, volume));
  }
  shakeGame(plan.shake);
  at(plan.ms, () => {
    el.remove();
    if (current?.el === el) current = null;
  });
  current = { el, timers };
}

/** Shakes the game view itself, hard at first and settling down. */
function shakeGame(ms: number): void {
  const canvas = document.querySelector('canvas');
  if (!canvas?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 12; i++) {
    const k = (1 - i / 12) * 18;
    frames.push({ transform: i === 12 ? 'none' : `translate(${((Math.random() - 0.5) * 2 * k).toFixed(1)}px, ${((Math.random() - 0.5) * 2 * k).toFixed(1)}px) rotate(${((Math.random() - 0.5) * k * 0.12).toFixed(2)}deg)` });
  }
  canvas.animate(frames, { duration: ms, easing: 'linear' });
}
