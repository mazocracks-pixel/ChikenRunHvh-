import { WEAPONS, WEAPON_SWITCH_MS, HVH, HvhExploitClock, defaultHvhLoadout, fireIntervalFor, magazineSize, shotUsesAmmo, type DevMods, type PlayerState, type WeaponDef, type WeaponId } from '@game/shared';

/** After firing, trust our own ammo count over (older) snapshots for this long. */
const AMMO_TRUST_MS = 400;

/**
 * Client-side weapon state: which gun is out, predicted ammo, reload and fire-rate timers.
 * The server enforces the same rules; this just keeps the game responsive.
 */
export class WeaponController {
  loadout: WeaponId[];
  slot = 0;
  shotSeq = 0;
  private readonly mags = new Map<WeaponId, number>();
  private reloadEndsAt = 0;
  private reloadStartedAt = 0;
  private switchReadyAt = 0;
  private lastFireAt = -Infinity;
  private triggerWasDown = false;
  /** Developer modifiers confirmed by the server (null = normal rules). */
  mods: DevMods | null = null;
  /** Developer option: semi-automatic weapons keep firing while the trigger is held. */
  forceAutomatic = false;
  hvh = defaultHvhLoadout();
  private readonly exploit = new HvhExploitClock();

  constructor(loadout: WeaponId[]) {
    this.loadout = loadout.length > 0 ? loadout : ['pistol'];
    this.refill();
  }

  get weapon(): WeaponId {
    return this.loadout[this.slot] ?? this.loadout[0]!;
  }

  get def(): WeaponDef {
    return WEAPONS[this.weapon];
  }

  get mag(): number {
    return this.mags.get(this.weapon) ?? 0;
  }

  magazineSize(id: WeaponId = this.weapon): number {
    return magazineSize(WEAPONS[id].magazine, this.mods);
  }

  /** Time between shots, including developer modifiers (fire rate, no rocket cooldown). */
  get fireInterval(): number {
    return this.hvh.exploit === 'off' ? fireIntervalFor(this.def, this.mods) : this.exploit.interval(this.def, this.hvh.exploit, performance.now());
  }

  get reloading(): boolean {
    return this.reloadEndsAt > 0;
  }

  /** 0..1 progress of the current reload. */
  reloadProgress(now: number): number {
    if (!this.reloading) return 0;
    return Math.min(1, (now - this.reloadStartedAt) / (this.reloadEndsAt - this.reloadStartedAt));
  }

  refill(): void {
    this.exploit.reset(performance.now());
    for (const id of this.loadout) this.mags.set(id, this.magazineSize(id));
    this.reloadEndsAt = 0;
    this.switchReadyAt = 0;
  }

  /** Returns true if the slot changed (the caller tells the server). */
  switchTo(slot: number, now: number): boolean {
    if (slot < 0 || slot >= this.loadout.length || slot === this.slot) return false;
    this.slot = slot;
    this.reloadEndsAt = 0;
    this.switchReadyAt = now + WEAPON_SWITCH_MS;
    return true;
  }

  cycle(direction: 1 | -1, now: number): boolean {
    const n = this.loadout.length;
    return this.switchTo((this.slot + direction + n) % n, now);
  }

  /** Returns true if a reload started (the caller tells the server). */
  reload(now: number): boolean {
    if (this.reloading || this.mag >= this.magazineSize()) return false;
    this.reloadStartedAt = now;
    this.reloadEndsAt = now + (this.mods?.instantReload ? 1 : this.def.reloadTime);
    return true;
  }

  update(now: number): void {
    if (this.reloading && now >= this.reloadEndsAt) {
      this.mags.set(this.weapon, this.magazineSize());
      this.reloadEndsAt = 0;
    }
  }

  /**
   * Decides whether the trigger produces a shot this frame (semi-auto needs a fresh press,
   * automatic weapons repeat at their fire rate). Returns 'fire', 'empty' (click) or null.
   */
  trigger(down: boolean, now: number): 'fire' | 'empty' | null {
    const fresh = down && !this.triggerWasDown;
    this.triggerWasDown = down;
    if (!down || (!this.def.automatic && !this.forceAutomatic && !fresh)) return null;
    if (now < this.switchReadyAt || this.reloading) return null;
    const interval = this.hvh.exploit === 'off' ? fireIntervalFor(this.def, this.mods) : this.exploit.interval(this.def, this.hvh.exploit, now);
    if (now - this.lastFireAt < interval) return null;
    if (this.mag <= 0) return fresh ? 'empty' : null;
    this.lastFireAt = now;
    this.exploit.fired(this.def, this.hvh.exploit, now);
    if (shotUsesAmmo(this.def, this.mods)) this.mags.set(this.weapon, this.mag - 1);
    this.shotSeq++;
    return 'fire';
  }

  /** The server changed our loadout (developer tools): keep the same gun out if we still have it. */
  setLoadout(loadout: WeaponId[]): void {
    if (loadout.length === 0 || loadout.join() === this.loadout.join()) return;
    const current = this.weapon;
    this.loadout = [...loadout];
    const slot = this.loadout.indexOf(current);
    this.slot = slot >= 0 ? slot : 0;
    for (const id of this.loadout) if (!this.mags.has(id)) this.mags.set(id, this.magazineSize(id));
  }

  /** Adopt the server's numbers when we haven't just changed them ourselves. */
  sync(server: PlayerState, now: number): void {
    if (now - this.lastFireAt > AMMO_TRUST_MS && server.hvhCharge !== undefined) this.exploit.readyAt = now + (1 - server.hvhCharge) * HVH.doubleTapRecharge;
    if (server.weapon !== this.weapon) {
      const slot = this.loadout.indexOf(server.weapon);
      if (slot >= 0 && now > this.switchReadyAt + 500) this.slot = slot;
    }
    if (server.weapon === this.weapon && !this.reloading && !server.reloading && now - this.lastFireAt > AMMO_TRUST_MS) {
      this.mags.set(this.weapon, server.mag);
    }
  }
}
