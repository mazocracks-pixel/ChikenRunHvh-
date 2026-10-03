/**
 * Full-screen play with Keyboard Lock (Chrome / Edge).
 *
 * Browsers keep Ctrl+W (close tab), Ctrl+T and Ctrl+N for themselves and no page can block them,
 * so crouching (Ctrl) while walking (W) would close the game. A full-screen page may lock keys,
 * though, and then those combinations reach the game instead of the browser.
 */
interface KeyboardLock {
  lock(codes?: string[]): Promise<void>;
  unlock(): void;
}

/** The keys behind the unblockable shortcuts. Escape stays free, so it still pauses and exits. */
const LOCKED_KEYS = ['KeyW', 'KeyT', 'KeyN'];

function keyboard(): KeyboardLock | null {
  const k = (navigator as Navigator & { keyboard?: Partial<KeyboardLock> }).keyboard;
  return typeof k?.lock === 'function' && typeof k.unlock === 'function' ? (k as KeyboardLock) : null;
}

export function keyboardLockSupported(): boolean {
  return keyboard() !== null;
}

/** Whether the current full screen is one we started (so leaving a match ends it). */
let ours = false;

/** Goes full screen and locks the keys. Call from a user gesture; failure just stays windowed. */
export async function enterPlayFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      ours = true;
    }
    await keyboard()?.lock(LOCKED_KEYS);
  } catch {
    // Denied or unsupported. Leaving a match still asks first (see App).
  }
}

/** Unlocks the keys, and leaves full screen if we entered it. */
export function exitPlayFullscreen(): void {
  keyboard()?.unlock();
  if (ours && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  ours = false;
}
