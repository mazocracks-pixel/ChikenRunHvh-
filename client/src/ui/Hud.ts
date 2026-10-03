import { JETPACK, MODES, PLAYER, TEAM_COLORS, TEAM_NAMES, WEAPONS, type ChatMessage, type KillCause, type MatchState, type ModeDef, type PlayerInfo, type RoomInfo, type Team, type WeaponId } from '@game/shared';
import { watchSettings } from '../settings';
import { CrosshairView } from './Crosshair';
import { clear, formatTime, h, hex } from './dom';

const KILLFEED_MS = 6000;
const CHAT_VISIBLE_MS = 10000;

function causeLabel(cause: KillCause): string {
  if (cause === 'egg') return 'Egg';
  if (cause === 'car') return 'Buggy';
  if (cause === 'world') return 'Fall';
  return WEAPONS[cause as WeaponId]?.name ?? cause;
}

/** A player's name; developer accounts glow rainbow. */
function nameEl(name: string, team: Team, self: boolean, dev = false): HTMLElement {
  return h('span', { class: `name${self ? ' self' : ''}${dev ? ' rainbow' : ''}`, style: team ? `color:${hex(TEAM_COLORS[team])}` : undefined }, name);
}

/** A plain name for tables: rainbow for developers. */
function nameText(info: PlayerInfo): HTMLElement | string {
  return info.dev ? h('span', { class: 'rainbow' }, info.name) : info.name;
}

export interface ScoreLine {
  info: PlayerInfo;
  self: boolean;
}

/** All in-game overlay UI. Pure DOM; text is set via text nodes only. */
export class Hud {
  readonly root: HTMLElement;
  readonly chatInput: HTMLInputElement;
  private readonly timer = h('div', { class: 'match-timer' });
  private readonly teamScores = h('div', { class: 'team-scores' });
  private readonly modeLabel = h('div', { class: 'mode-label' });
  private readonly stats = h('div', { class: 'hud-stats' });
  private readonly roomCode = h('div', { class: 'room-code' });
  private readonly killfeed = h('div', { class: 'killfeed' });
  private readonly crosshair = new CrosshairView();
  private readonly hitmarker = h('div', { class: 'hitmarker' }, h('i'), h('i'), h('i'), h('i'));
  private readonly scope = h('div', { class: 'scope' });
  private readonly indicators = h('div', { class: 'damage-indicators' });
  private readonly vignette = h('div', { class: 'hurt-vignette' });
  private readonly hpFill = h('div', { class: 'fill' });
  private readonly hpText = h('span');
  private readonly armorFill = h('div', { class: 'fill' });
  private readonly armorText = h('span');
  private readonly armorBar = h('div', { class: 'bar armor' }, this.armorFill, this.armorText);
  private readonly fuelFill = h('div', { class: 'fill' });
  private readonly fuelBar = h('div', { class: 'bar fuel' }, this.fuelFill, h('span', null, 'JETPACK'));
  private readonly hopBadge = h('div', { class: 'hop-badge' });
  private readonly weaponName = h('div', { class: 'weapon-name' });
  private readonly ammo = h('div', { class: 'ammo' });
  private readonly reloadBar = h('div', { class: 'reload-bar' }, h('div'));
  private readonly slots = h('div', { class: 'weapon-slots' });
  private readonly grenades = h('div', { class: 'grenades' });
  private readonly banner = h('div', { class: 'banner' });
  private readonly toasts = h('div', { class: 'toasts' });
  private readonly death = h('div', { class: 'death-screen' });
  private readonly deathText = h('div', { class: 'death-title' });
  private readonly deathTimer = h('div', { class: 'death-timer' });
  private readonly scoreboard = h('div', { class: 'scoreboard panel' });
  private readonly results = h('div', { class: 'results panel' });
  private readonly chatLog = h('div', { class: 'chat-log' });
  private readonly hint = h('div', { class: 'hint-bar' });

  private mode: ModeDef = MODES.ffa;
  /** Developer Misc switches. */
  showHitmarker = true;
  showDamageIndicators = true;
  showCrosshair = true;
  private hitmarkerUntil = 0;
  private lastSlotsKey = '';
  private lastGrenades = '';

  constructor(container: HTMLElement) {
    this.chatInput = h('input', { class: 'chat-input', maxlength: 120, placeholder: 'Say something… (Enter to send, Esc to cancel)' });
    this.chatInput.hidden = true;
    this.death.append(this.deathText, this.deathTimer);
    this.death.hidden = true;
    this.scoreboard.hidden = true;
    this.results.hidden = true;
    this.scope.hidden = true;
    this.hint.hidden = true;

    this.root = h(
      'div',
      { id: 'hud', class: 'hud' },
      h('div', { class: 'hud-top-left' }, this.stats, this.roomCode),
      h('div', { class: 'hud-top-center' }, this.modeLabel, this.timer, this.teamScores),
      h('div', { class: 'hud-top-right' }, this.killfeed),
      this.scope,
      this.vignette,
      this.indicators,
      this.crosshair.root,
      this.hitmarker,
      this.banner,
      this.toasts,
      this.death,
      this.hint,
      h('div', { class: 'hud-bottom-left' }, h('div', { class: 'chat' }, this.chatLog, this.chatInput), h('div', { class: 'vitals' }, this.hopBadge, h('div', { class: 'bar hp' }, this.hpFill, this.hpText), this.armorBar, this.fuelBar)),
      h('div', { class: 'hud-bottom-right' }, this.grenades, h('div', { class: 'weapon-panel' }, this.weaponName, this.ammo, this.reloadBar), this.slots),
      this.scoreboard,
      this.results,
    );
    this.root.hidden = true;
    container.append(this.root);
    watchSettings((s) => this.crosshair.apply(s.crosshair));
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  setRoom(room: RoomInfo): void {
    this.mode = MODES[room.mode];
    this.modeLabel.textContent = this.mode.name;
    this.roomCode.textContent = room.private ? `Room code: ${room.code}` : '';
    this.teamScores.hidden = !this.mode.teams;
    clear(this.killfeed);
    clear(this.chatLog);
  }

  setStats(ping: number | null, fps: number, players: number): void {
    this.stats.textContent = `${players} online · ${ping === null ? '–' : `${ping} ms`} · ${fps} fps`;
  }

  // ---------------------------------------------------------------------------
  // Vitals and weapon
  // ---------------------------------------------------------------------------

  setVitals(hp: number, armor: number, fuel: number): void {
    const hpPct = Math.max(0, Math.min(100, (hp / PLAYER.maxHealth) * 100));
    this.hpFill.style.width = `${hpPct}%`;
    this.hpFill.classList.toggle('low', hpPct <= 30);
    this.hpText.textContent = `${Math.ceil(hp)} HP`;
    this.armorBar.hidden = armor <= 0;
    this.armorFill.style.width = `${Math.min(100, (armor / PLAYER.maxArmor) * 100)}%`;
    this.armorText.textContent = `${Math.ceil(armor)} ARMOR`;
    this.fuelBar.hidden = fuel <= 0;
    this.fuelFill.style.width = `${(fuel / JETPACK.maxFuel) * 100}%`;
    this.vignette.style.opacity = String(hpPct < 35 ? (35 - hpPct) / 50 : 0);
  }

  /** Bunny-hop speed bonus (0..max, higher with a melee weapon), shown while it's building. */
  setHop(bonus: number, max: number): void {
    const pct = Math.round(bonus * 100);
    this.hopBadge.hidden = pct < 2;
    this.hopBadge.textContent = `🐇 Bunny hop +${pct}% speed`;
    this.hopBadge.classList.toggle('max', bonus >= max - 0.01);
  }

  setWeapon(weapon: WeaponId, mag: number, reloading: boolean, reloadProgress: number, loadout: WeaponId[], slot: number): void {
    const w = WEAPONS[weapon];
    this.weaponName.textContent = w.name;
    this.ammo.textContent = w.melee ? '∞' : reloading ? 'Reloading…' : `${mag} / ${w.magazine}`;
    this.ammo.classList.toggle('empty', mag === 0 && !reloading && !w.melee);
    this.reloadBar.hidden = !reloading;
    (this.reloadBar.firstChild as HTMLElement).style.width = `${reloadProgress * 100}%`;
    const key = `${loadout.join()}|${slot}`;
    if (key !== this.lastSlotsKey) {
      this.lastSlotsKey = key;
      clear(this.slots);
      loadout.forEach((id, i) => this.slots.append(h('div', { class: `slot${i === slot ? ' active' : ''}` }, h('kbd', null, i + 1), WEAPONS[id].name)));
    }
  }

  setGrenades(eggs: number, smokes: number): void {
    const key = `${eggs}|${smokes}`;
    if (key === this.lastGrenades) return;
    this.lastGrenades = key;
    clear(this.grenades);
    this.grenades.append(h('span', { class: eggs ? '' : 'none' }, h('kbd', null, 'G'), ` 🥚 ×${eggs}`), h('span', { class: smokes ? '' : 'none' }, h('kbd', null, 'Q'), ` 💨 ×${smokes}`));
  }

  setCrosshair(visible: boolean, spreadPx: number, scoped: boolean): void {
    this.crosshair.root.hidden = !visible || scoped || !this.showCrosshair;
    this.scope.hidden = !scoped;
    this.crosshair.setSpread(spreadPx);
  }

  hit(headshot: boolean, killed: boolean): void {
    if (!this.showHitmarker) return;
    this.hitmarker.classList.toggle('kill', killed);
    this.hitmarker.classList.toggle('headshot', headshot);
    this.hitmarker.classList.add('show');
    this.hitmarkerUntil = performance.now() + (killed ? 350 : 140);
  }

  /** Red arc pointing at whoever hurt you. `angle` is relative to where you're facing (0 = in front). */
  damageFrom(angle: number): void {
    if (!this.showDamageIndicators) return;
    const el = h('div', { class: 'indicator', style: `transform: rotate(${angle}rad)` });
    this.indicators.append(el);
    setTimeout(() => el.remove(), 1000);
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    const el = h('div', { class: `toast ${kind}` }, text);
    this.toasts.append(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ---------------------------------------------------------------------------
  // Feed, chat, death
  // ---------------------------------------------------------------------------

  kill(killer: PlayerInfo | undefined, victim: PlayerInfo | undefined, cause: KillCause, headshot: boolean, selfPid: number): void {
    if (!victim) return;
    const involved = killer?.pid === selfPid || victim.pid === selfPid;
    const row = h('div', { class: `kill${involved ? ' mine' : ''}` });
    if (killer && killer.pid !== victim.pid) row.append(nameEl(killer.name, killer.team, killer.pid === selfPid, killer.dev), ' ');
    row.append(h('span', { class: 'cause' }, `[${causeLabel(cause)}${headshot ? ' ⌖' : ''}]`), ' ', nameEl(victim.name, victim.team, victim.pid === selfPid, victim.dev));
    this.killfeed.prepend(row);
    while (this.killfeed.children.length > 5) this.killfeed.lastElementChild?.remove();
    setTimeout(() => row.classList.add('fade'), KILLFEED_MS);
    setTimeout(() => row.remove(), KILLFEED_MS + 600);
  }

  chat(msg: ChatMessage, self: boolean): void {
    const line = msg.pid === 0 ? h('div', { class: 'line system' }, msg.text) : h('div', { class: 'line' }, nameEl(msg.name, msg.team, self, msg.dev), ': ', msg.text);
    this.chatLog.append(line);
    while (this.chatLog.children.length > 8) this.chatLog.firstElementChild?.remove();
    setTimeout(() => line.classList.add('old'), CHAT_VISIBLE_MS);
  }

  setChatOpen(open: boolean): void {
    this.chatInput.hidden = !open;
    this.chatLog.classList.toggle('open', open);
    if (open) {
      this.chatInput.value = '';
      this.chatInput.focus();
    } else {
      this.chatInput.blur();
    }
  }

  showDeath(killer: PlayerInfo | undefined, cause: KillCause, selfPid: number): void {
    clear(this.deathText);
    if (!killer || killer.pid === selfPid) this.deathText.append(cause === 'egg' ? 'Your own egg got you!' : 'You died');
    else this.deathText.append('Plucked by ', nameEl(killer.name, killer.team, false, killer.dev), ` · ${causeLabel(cause)}`);
    this.death.hidden = false;
  }

  setDeathTimer(msLeft: number): void {
    this.deathTimer.textContent = msLeft > 0 ? `Respawning in ${Math.ceil(msLeft / 1000)}…` : 'Respawning…';
  }

  hideDeath(): void {
    this.death.hidden = true;
  }

  /** One line of context help above the weapon bar (driving, building, carrying the flag). */
  setHint(text: string | null): void {
    this.hint.hidden = text === null;
    if (this.hint.textContent !== (text ?? '')) this.hint.textContent = text ?? '';
  }

  // ---------------------------------------------------------------------------
  // Match, scores, results
  // ---------------------------------------------------------------------------

  setMatch(match: MatchState, serverNow: number, players: number): void {
    const left = match.endsAt === null ? null : match.endsAt - serverNow;
    this.timer.textContent = match.phase === 'playing' && left !== null ? formatTime(left) : '';
    this.timer.classList.toggle('urgent', match.phase === 'playing' && left !== null && left < 30_000);
    let banner = '';
    if (match.phase === 'waiting') banner = `Waiting for players · ${players}/${this.mode.minPlayers}`;
    if (match.phase === 'countdown' && left !== null) banner = `Match starts in ${Math.max(1, Math.ceil(left / 1000))}`;
    this.banner.textContent = banner;
    this.banner.hidden = banner === '';
    this.results.hidden = match.phase !== 'ended';
  }

  setTeamScores(scores: [number, number], selfTeam: Team): void {
    if (!this.mode.teams) return;
    clear(this.teamScores);
    for (const team of [1, 2] as const) {
      this.teamScores.append(
        h('div', { class: `team t${team}${team === selfTeam ? ' mine' : ''}` }, h('span', null, TEAM_NAMES[team]), h('b', null, scores[team - 1]), h('small', null, `/ ${this.mode.scoreLimit}`)),
      );
    }
  }

  setScoreboardVisible(visible: boolean): void {
    this.scoreboard.hidden = !visible;
  }

  renderScoreboard(lines: ScoreLine[], teamScores: [number, number], ping: number | null): void {
    clear(this.scoreboard);
    const table = (rows: ScoreLine[], title: string | null, team: Team) => {
      const t = h('table', { class: `scores${team ? ` t${team}` : ''}` });
      if (title) t.append(h('caption', null, title));
      t.append(h('tr', null, h('th', null, 'Chicken'), h('th', null, 'K'), h('th', null, 'D'), h('th', null, 'Score')));
      for (const { info, self } of rows) {
        t.append(
          h('tr', { class: self ? 'self' : '' }, h('td', null, nameText(info), info.bot ? h('small', null, ' bot') : null, self && ping !== null ? h('small', null, ` ${ping}ms`) : null), h('td', null, info.kills), h('td', null, info.deaths), h('td', null, info.score)),
        );
      }
      return t;
    };
    const sorted = [...lines].sort((a, b) => b.info.score - a.info.score || b.info.kills - a.info.kills);
    this.scoreboard.append(h('h3', null, this.mode.name));
    if (this.mode.teams) {
      const wrap = h('div', { class: 'team-tables' });
      for (const team of [1, 2] as const) {
        wrap.append(table(sorted.filter((l) => l.info.team === team), `${TEAM_NAMES[team]} · ${teamScores[team - 1]}`, team));
      }
      this.scoreboard.append(wrap);
    } else {
      this.scoreboard.append(table(sorted, null, 0));
    }
  }

  renderResults(match: MatchState, lines: ScoreLine[], teamScores: [number, number], winner: PlayerInfo | undefined, mvp: PlayerInfo | undefined, selfWon: boolean): void {
    clear(this.results);
    let title: string;
    if (this.mode.teams) title = match.winnerTeam ? `${TEAM_NAMES[match.winnerTeam]} team wins!` : "It's a draw!";
    else title = winner ? `${winner.name} wins!` : 'No winner';
    this.results.append(h('h2', { class: selfWon ? 'won' : '' }, selfWon ? `🏆 ${title}` : title));
    if (this.mode.teams) this.results.append(h('div', { class: 'final-score' }, `${teamScores[0]} : ${teamScores[1]}`));
    if (mvp) this.results.append(h('div', { class: 'mvp' }, 'MVP: ', nameText(mvp), ` · ${mvp.kills} kills`));
    const sorted = [...lines].sort((a, b) => b.info.score - a.info.score);
    const t = h('table', { class: 'scores' }, h('tr', null, h('th', null, '#'), h('th', null, 'Chicken'), h('th', null, 'K'), h('th', null, 'D'), h('th', null, 'Score')));
    sorted.forEach(({ info, self }, i) => {
      t.append(h('tr', { class: self ? 'self' : '', style: info.team ? `color:${hex(TEAM_COLORS[info.team])}` : undefined }, h('td', null, i + 1), h('td', null, nameText(info)), h('td', null, info.kills), h('td', null, info.deaths), h('td', null, info.score)));
    });
    this.results.append(t, h('div', { class: 'reward' }), h('div', { class: 'next-match' }));
  }

  setResultsCountdown(msLeft: number): void {
    const el = this.results.querySelector('.next-match');
    if (el) el.textContent = `Next match in ${Math.max(0, Math.ceil(msLeft / 1000))}s`;
  }

  showReward(coins: number, total: number): void {
    const el = this.results.querySelector('.reward');
    if (el) el.textContent = `+${coins} coins (you have ${total})`;
  }

  update(): void {
    if (this.hitmarkerUntil && performance.now() > this.hitmarkerUntil) {
      this.hitmarker.classList.remove('show');
      this.hitmarkerUntil = 0;
    }
  }
}
