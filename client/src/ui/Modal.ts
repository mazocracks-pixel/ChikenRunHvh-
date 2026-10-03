import { h } from './dom';

export interface ModalHandle {
  close(): void;
  body: HTMLElement;
}

let layer: HTMLElement | null = null;
const open: ModalHandle[] = [];

export function setModalLayer(el: HTMLElement): void {
  layer = el;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open.length > 0) open[open.length - 1]!.close();
  });
}

export function anyModalOpen(): boolean {
  return open.length > 0;
}

/** A centred dialog over everything. Closes with ✕, Esc or a click on the backdrop. */
export function openModal(title: string, content: Node, options: { wide?: boolean; onClose?: () => void } = {}): ModalHandle {
  const body = h('div', { class: 'modal-body' }, content);
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close' }, '✕');
  const dialog = h('div', { class: `modal panel${options.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, h('header', null, h('h2', null, title), closeBtn), body);
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog);
  let closed = false;
  const handle: ModalHandle = {
    body,
    close: () => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      open.splice(open.indexOf(handle), 1);
      options.onClose?.();
    },
  };
  closeBtn.addEventListener('click', handle.close);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) handle.close();
  });
  (layer ?? document.body).append(backdrop);
  open.push(handle);
  return handle;
}
