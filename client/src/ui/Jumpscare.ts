import { JUMPSCARE, type JumpscareStyle } from '@game/shared';

/** A demon chicken: huge, pale, glowing red eyes and a beak full of teeth. */
const CHICKEN = `
<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="js-skin" cx="50%" cy="42%" r="60%">
      <stop offset="0" stop-color="#f4efe2"/><stop offset="0.7" stop-color="#bdb39c"/><stop offset="1" stop-color="#5c5243"/>
    </radialGradient>
    <radialGradient id="js-eye" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff2c0"/><stop offset="0.25" stop-color="#ff2a10"/><stop offset="0.6" stop-color="#7a0000"/><stop offset="1" stop-color="#000"/>
    </radialGradient>
    <filter id="js-glow"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <path d="M130 70 C120 20 165 15 170 55 C175 10 225 8 222 55 C235 15 285 25 268 80 Z" fill="#9e0b0b"/>
  <ellipse cx="200" cy="200" rx="150" ry="160" fill="url(#js-skin)"/>
  <path d="M95 120 L170 150 M305 120 L230 150" stroke="#3a2f22" stroke-width="12" stroke-linecap="round"/>
  <circle cx="135" cy="175" r="48" fill="#000"/><circle cx="265" cy="175" r="48" fill="#000"/>
  <circle cx="135" cy="178" r="26" fill="#ff1a0a" filter="url(#js-glow)"/><circle cx="265" cy="178" r="26" fill="#ff1a0a" filter="url(#js-glow)"/>
  <circle cx="135" cy="178" r="17" fill="url(#js-eye)"/><circle cx="265" cy="178" r="17" fill="url(#js-eye)"/>
  <path d="M120 230 L200 205 L280 230 L250 255 L150 255 Z" fill="#d9861a"/>
  <path d="M150 255 L250 255 L235 345 Q200 375 165 345 Z" fill="#120404"/>
  <path d="M155 256 L165 282 L176 256 L187 284 L198 256 L210 284 L221 256 L233 282 L245 256 Z" fill="#f3ecd6"/>
  <path d="M168 345 L178 318 L188 348 L200 316 L212 348 L222 318 L232 345 Z" fill="#e8dfc4"/>
  <path d="M160 345 Q200 395 240 345 L245 360 Q200 410 155 360 Z" fill="#c4781a"/>
  <path d="M185 372 Q200 400 190 395 Q200 420 205 380" fill="#a10b0b"/>
</svg>`;

/** A pale ghost face with empty eyes and a long screaming mouth. */
const GHOST = `
<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="js-ghost" cx="50%" cy="38%" r="65%">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#c9cfd6"/><stop offset="1" stop-color="#3b4048" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <path d="M200 25 C320 25 345 140 340 230 C335 330 290 395 200 395 C110 395 65 330 60 230 C55 140 80 25 200 25 Z" fill="url(#js-ghost)"/>
  <ellipse cx="140" cy="165" rx="36" ry="52" transform="rotate(-12 140 165)" fill="#050608"/>
  <ellipse cx="260" cy="165" rx="36" ry="52" transform="rotate(12 260 165)" fill="#050608"/>
  <circle cx="146" cy="172" r="4" fill="#cfd8e3"/><circle cx="254" cy="172" r="4" fill="#cfd8e3"/>
  <ellipse cx="200" cy="300" rx="44" ry="80" fill="#050608"/>
  <path d="M120 120 Q140 100 165 112 M280 120 Q260 100 235 112" stroke="#5a616b" stroke-width="5" fill="none"/>
</svg>`;

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

let current: HTMLElement | null = null;

/**
 * Shows a jumpscare over everything for a moment (sent by a developer from mega?dev). It moves and
 * shakes but never strobes, and it can't be clicked, so it never gets in the way of the game.
 */
export function showJumpscare(style: JumpscareStyle): void {
  current?.remove();
  const el = document.createElement('div');
  el.className = `jumpscare jumpscare-${style}`;
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--js-ms', `${JUMPSCARE.ms}ms`);
  if (style === 'glitch') el.style.setProperty('--js-noise', `url(${noiseTile()})`);
  const face = document.createElement('div');
  face.className = 'jumpscare-face';
  face.innerHTML = style === 'ghost' ? GHOST : CHICKEN;
  el.append(face);
  if (style === 'glitch') {
    // Two offset copies tinted red and cyan: the picture tearing apart.
    for (const tint of ['r', 'c']) {
      const copy = face.cloneNode(true) as HTMLElement;
      copy.classList.add(`jumpscare-split-${tint}`);
      el.append(copy);
    }
  }
  document.body.append(el);
  current = el;
  window.setTimeout(() => {
    el.remove();
    if (current === el) current = null;
  }, JUMPSCARE.ms);
}
