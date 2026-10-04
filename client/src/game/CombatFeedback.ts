/** Presentation-only combat state. Every hit and elimination comes from the server. */
export class CombatFeedback {
  streak = 0;
  bestStreak = 0;
  chain = 0;
  damage = 0;
  headshot = false;
  private lastKill: number | null = null;
  private lastDamage: number | null = null;

  hit(amount: number, headshot: boolean, now: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return this.damage;
    if (this.lastDamage === null || now - this.lastDamage > 450) {
      this.damage = 0;
      this.headshot = false;
    }
    this.damage += amount;
    this.headshot ||= headshot;
    this.lastDamage = now;
    return Math.ceil(this.damage);
  }

  eliminate(now: number): string {
    this.chain = this.lastKill !== null && now - this.lastKill <= 4500 ? this.chain + 1 : 1;
    this.lastKill = now;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    return this.chain === 2 ? 'DOUBLE PLUCK' : this.chain === 3 ? 'TRIPLE PLUCK' : this.chain === 4 ? 'QUAD PLUCK' : this.chain > 4 ? `${this.chain}× MULTI PLUCK` : 'PLUCKED';
  }

  died(): void {
    this.streak = 0;
    this.chain = 0;
    this.lastKill = null;
    this.damage = 0;
    this.headshot = false;
    this.lastDamage = null;
  }

  reset(): void {
    this.died();
    this.bestStreak = 0;
  }
}
