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

/**
 * "Developer Access" dialog. The passkey is sent to the server, which is the only place it is
 * known; resolves true once the server accepts it, false if the dialog is cancelled.
 */
export function showPasskeyPrompt(unlock: (passkey: string) => Promise<DevResult>, settings: DevConfig['settings']): Promise<boolean> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'password', class: 'dev-auth-input', placeholder: '••••', autocomplete: 'off', inputmode: 'numeric', maxlength: 32, 'aria-label': 'Passkey' });
    const message = h('div', { class: 'dev-auth-msg', role: 'status', 'aria-live': 'polite' });
    const submit = h('button', { type: 'submit', class: 'dev-btn primary' }, 'Unlock');
    const cancel = h('button', { type: 'button', class: 'dev-btn' }, 'Cancel');
    const card = h(
      'form',
      { class: 'dev-auth' },
      h('div', { class: 'dev-auth-icon', 'aria-hidden': 'true' }, '◆'),
      h('h2', null, 'Developer Access'),
      h('label', { class: 'dev-auth-label' }, 'Enter Passkey'),
      input,
      message,
      h('div', { class: 'dev-auth-actions' }, cancel, submit),
    );
    const backdrop = h('div', { class: 'dev-root dev-auth-backdrop' }, card);
    applyTheme(backdrop, settings);
    document.body.append(backdrop);
    input.focus();

    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      backdrop.classList.add('closing');
      window.setTimeout(() => backdrop.remove(), 180 * settings.animSpeed);
      resolve(ok);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => finish(false));
    card.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = input.value;
      if (!key) return;
      submit.disabled = true;
      message.className = 'dev-auth-msg';
      message.textContent = 'Checking…';
      void unlock(key).then((res) => {
        submit.disabled = false;
        input.value = '';
        if (res.ok) {
          message.className = 'dev-auth-msg good';
          message.textContent = 'Access Granted';
          // Let the menu key work straight away (keys typed into the field are ignored).
          input.blur();
          card.classList.add('granted');
          window.setTimeout(() => finish(true), 650 * settings.animSpeed);
          return;
        }
        message.className = 'dev-auth-msg bad';
        message.textContent = res.error ?? 'Invalid Passkey';
        card.classList.remove('shake');
        void card.offsetWidth; // restart the animation
        card.classList.add('shake');
        input.focus();
      });
    });
  });
}
