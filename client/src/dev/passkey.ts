import type { DevResult } from '@game/shared';
import { h } from '../ui/dom';
import type { DevConfig } from './config';

/** Applies the menu's theme, accent colour, scale, opacity and animation speed to an element. */
export function applyTheme(el: HTMLElement, s: DevConfig['settings']): void {
  el.dataset.theme = s.theme;
  el.style.setProperty('--dev-accent', s.accent);
  el.style.setProperty('--dev-anim', String(s.animSpeed));
  el.style.setProperty('--dev-opacity', String(s.opacity));
  el.style.setProperty('--dev-scale', String(s.scale));
  el.classList.toggle('dev-no-anim', s.animSpeed === 0);
}

/** How many dots the display shows at most (the code itself is never shown). */
const MAX_DOTS = 12;

/**
 * The dev code entry: a keypad with a masked display. Type on the keyboard (letters work too)
 * or tap the keys. The code goes to the server, the only place it is known; resolves true once
 * the server accepts it, false if cancelled.
 */
export function showPasskeyPrompt(unlock: (passkey: string) => Promise<DevResult>, settings: DevConfig['settings']): Promise<boolean> {
  return new Promise((resolve) => {
    // The real field: hidden off-screen, so the keyboard and password managers still work.
    const input = h('input', { type: 'password', class: 'pk-field', autocomplete: 'off', maxlength: 32, 'aria-label': 'Dev code', spellcheck: 'false' });
    const dots = h('span', { class: 'pk-dots', 'aria-hidden': 'true' });
    const message = h('div', { class: 'pk-msg', role: 'status', 'aria-live': 'polite' }, 'Enter the code');
    const screen = h('div', { class: 'pk-screen' }, h('span', { class: 'pk-prompt', 'aria-hidden': 'true' }, '>'), dots);
    const ok = h('button', { type: 'submit', class: 'pk-key pk-ok', 'aria-label': 'Enter' }, 'OK');
    const keys = h('div', { class: 'pk-keys' });
    const card = h(
      'form',
      { class: 'pk', autocomplete: 'off' },
      h('div', { class: 'pk-head' }, h('h2', null, 'Dev code'), h('button', { type: 'button', class: 'pk-cancel', 'aria-label': 'Cancel', onclick: () => finish(false) }, 'Esc')),
      screen,
      message,
      keys,
      input,
      // Letters: phones get their keyboard from here.
      h('button', { type: 'button', class: 'pk-type', onclick: () => input.focus() }, 'Type letters'),
    );
    const show = () => {
      const n = input.value.length;
      dots.textContent = '●'.repeat(Math.min(n, MAX_DOTS)) + (n > MAX_DOTS ? '+' : '');
      screen.classList.toggle('empty', n === 0);
    };
    const press = (key: string) => {
      if (busy) return;
      if (key === 'del') input.value = input.value.slice(0, -1);
      else if (input.value.length < 32) input.value += key;
      show();
    };
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0']) {
      keys.append(h('button', { type: 'button', class: `pk-key${k === 'del' ? ' pk-del' : ''}`, 'aria-label': k === 'del' ? 'Delete' : k, onclick: () => press(k) }, k === 'del' ? 'Del' : k));
    }
    keys.append(ok);
    const backdrop = h('div', { class: 'pk-backdrop' }, card);
    applyTheme(backdrop, settings);
    document.body.append(backdrop);
    show();
    // Desktop: type straight away. Touch: the keypad first, so no keyboard pops up.
    if (!matchMedia('(pointer: coarse)').matches) input.focus();
    input.addEventListener('input', show);

    let done = false;
    let busy = false;
    function finish(accepted: boolean): void {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      backdrop.classList.add('closing');
      window.setTimeout(() => backdrop.remove(), 180 * settings.animSpeed);
      resolve(accepted);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      } else if (document.activeElement !== input && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Typing while a key button has focus still types, and Enter enters (not "press that key again").
        if (e.key === 'Enter') { e.preventDefault(); card.requestSubmit(); }
        else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
        else if (e.key.length === 1) { e.preventDefault(); press(e.key); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    card.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = input.value;
      if (!key || busy) return;
      busy = true;
      ok.disabled = true;
      message.className = 'pk-msg';
      message.textContent = 'Checking…';
      void unlock(key).then((res) => {
        busy = false;
        ok.disabled = false;
        input.value = '';
        show();
        if (res.ok) {
          message.className = 'pk-msg good';
          message.textContent = 'Access granted';
          input.blur();
          card.classList.add('granted');
          window.setTimeout(() => finish(true), 650 * settings.animSpeed);
          return;
        }
        message.className = 'pk-msg bad';
        message.textContent = res.error ?? 'Wrong code.';
        card.classList.remove('shake');
        void card.offsetWidth; // restart the animation
        card.classList.add('shake');
        if (!matchMedia('(pointer: coarse)').matches) input.focus();
      });
    });
  });
}
