import * as THREE from 'three';
import type { ZombieKind } from '@game/shared';
import type { AudioEngine, SoundName } from './Audio';
import { setBloodMoonEyes } from './models/Chicken';
import type { RemotePlayers } from './RemotePlayers';

/** Zombie sounds are heard this far (the fog hides them sooner: you hear them first). */
const GROAN_RANGE = 42;
const STEP_RANGE = 20;
/** A zombie screeches when it first gets this close (it has seen you). */
const SPOT_RANGE = 18;
/** Never two screeches or groans on top of each other (no sudden loud stacks). */
const SCREECH_GAP = 2.5;
const GROAN_GAP = 0.6;

/**
 * How each kind sounds, so you can tell what is coming in the dark: walkers moan and shuffle,
 * sprinters hiss and skitter, runners pant and patter, brutes roar and stomp, bosses rumble.
 */
const VOICES: Record<ZombieKind, { call: SoundName; callVolume: number; every: number; spot: SoundName; spotVolume: number; step: SoundName; stepVolume: number; stepEvery: number }> = {
  walker: { call: 'groan', callVolume: 0.6, every: 3.5, spot: 'screech', spotVolume: 0.6, step: 'zstep', stepVolume: 0.45, stepEvery: 0.5 },
  sprinter: { call: 'hiss', callVolume: 0.55, every: 3, spot: 'screech', spotVolume: 0.75, step: 'zstepLight', stepVolume: 0.5, stepEvery: 0.24 },
  runner: { call: 'pant', callVolume: 0.6, every: 2.5, spot: 'screech', spotVolume: 0.65, step: 'zstepLight', stepVolume: 0.45, stepEvery: 0.2 },
  exploder: { call: 'gurgle', callVolume: 0.6, every: 2.5, spot: 'gurgle', spotVolume: 0.8, step: 'zstep', stepVolume: 0.5, stepEvery: 0.36 },
  brute: { call: 'roar', callVolume: 0.8, every: 4.5, spot: 'roar', spotVolume: 1, step: 'zstepHeavy', stepVolume: 0.7, stepEvery: 0.6 },
  boss: { call: 'bossRoar', callVolume: 0.9, every: 5, spot: 'bossRoar', spotVolume: 1.1, step: 'zstepHeavy', stepVolume: 0.9, stepEvery: 0.55 },
};

interface Heard {
  nextGroan: number;
  nextStep: number;
  screeched: boolean;
  last: THREE.Vector3;
}

/**
 * The Zombie Apocalypse night, on this computer only: your flashlight (T), and the sounds of
 * the dark: groans that get louder as zombies come closer, their footsteps, a screech when one
 * spots you, wind, distant clucks and creaking wood. All of it is quiet next to the guns.
 */
export class ZombieNight {
  private readonly light = new THREE.SpotLight(0xfff1d6, 0, 34, 0.46, 0.55, 1.5);
  private on = true;
  private time = 0;
  private readonly heard = new Map<number, Heard>();
  private lastScreech = -Infinity;
  private lastGroan = -Infinity;
  private nextWind = 0;
  private nextCluck = 6;
  private nextCreak = 4;
  private readonly ahead = new THREE.Vector3();

  /** Blood Moon: where it's heading (0/1), how far it has got, and the moon itself. */
  private bloodTarget = 0;
  private blood = 0;
  private readonly moon: THREE.Mesh;
  private readonly moonTexture: THREE.Texture;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly audio: AudioEngine,
    private readonly tint?: (amount: number) => void,
  ) {
    // A big red moon low in the east, always just inside the view distance (it moves with you).
    // A blood-red disc with dark craters, inside a soft red glow (all one canvas texture).
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const halo = g.createRadialGradient(128, 128, 40, 128, 128, 128);
    halo.addColorStop(0, 'rgba(255, 60, 40, 0.55)');
    halo.addColorStop(1, 'rgba(255, 30, 20, 0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, 256, 256);
    const disc = g.createRadialGradient(112, 108, 6, 128, 128, 58);
    disc.addColorStop(0, '#ff7a55');
    disc.addColorStop(0.7, '#c8261a');
    disc.addColorStop(1, '#7a0e0a');
    g.fillStyle = disc;
    g.beginPath();
    g.arc(128, 128, 58, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(70, 5, 5, 0.35)';
    for (const [x, y, r] of [[108, 112, 13], [146, 138, 9], [132, 96, 7], [104, 150, 6], [156, 110, 5]] as const) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.moonTexture = texture;
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshBasicMaterial({ map: texture, fog: false, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.moon.renderOrder = -0.4;
    this.moon.visible = false;
    scene.add(this.moon);
    // The light is always in the scene (switching it off only dims it), so turning it on and
    // off never makes the graphics card rebuild its shaders.
    scene.add(this.light, this.light.target);
  }

  /** The server says a Blood Moon wave is on (or coming): the night slowly turns red. */
  setBloodMoon(on: boolean): void {
    const target = on ? 1 : 0;
    if (target === this.bloodTarget) return;
    this.bloodTarget = target;
    setBloodMoonEyes(on);
    if (on) this.audio.play('bloodMoon', undefined, 0.9);
  }

  get flashlightOn(): boolean {
    return this.on;
  }

  toggleFlashlight(): void {
    this.on = !this.on;
    this.audio.play('click', undefined, 0.5);
  }

  update(dt: number, remotes: RemotePlayers): void {
    this.time += dt;
    const cam = this.camera;
    // The flashlight: at your eyes, a little to the right, pointing where you look.
    this.ahead.set(0.25, -0.2, 0).applyQuaternion(cam.quaternion);
    this.light.position.copy(cam.position).add(this.ahead);
    cam.getWorldDirection(this.ahead);
    this.light.target.position.copy(cam.position).addScaledVector(this.ahead, 10);
    this.light.intensity = THREE.MathUtils.damp(this.light.intensity, this.on ? 22 : 0, 18, dt);

    // The Blood Moon rises (and sets) over about 3 seconds.
    if (this.blood !== this.bloodTarget) {
      this.blood = THREE.MathUtils.clamp(this.blood + Math.sign(this.bloodTarget - this.blood) * dt / 3, 0, 1);
      this.tint?.(this.blood);
    }
    this.moon.visible = this.blood > 0;
    if (this.moon.visible) {
      (this.moon.material as THREE.MeshBasicMaterial).opacity = this.blood;
      this.moon.position.set(cam.position.x + 30, cam.position.y + 22, cam.position.z - 12);
      this.moon.lookAt(cam.position);
    }

    this.zombieSounds(remotes);
    this.ambience();
  }

  private zombieSounds(remotes: RemotePlayers): void {
    const t = this.time;
    const ear = this.camera.position;
    for (const [pid, r] of remotes.players) {
      const kind = r.info.undead;
      if (!kind) continue;
      let h = this.heard.get(pid);
      if (!h) this.heard.set(pid, (h = { nextGroan: t + Math.random() * 3, nextStep: 0, screeched: false, last: r.position.clone() }));
      if (!r.alive || r.culled) {
        h.screeched = false;
        continue;
      }
      const at = r.position;
      const dist = at.distanceTo(ear);
      const moved = Math.hypot(at.x - h.last.x, at.z - h.last.z);
      h.last.copy(at);
      const voice = VOICES[kind];
      if (dist < SPOT_RANGE && !h.screeched) {
        h.screeched = true;
        if (t - this.lastScreech > SCREECH_GAP) {
          this.lastScreech = t;
          this.audio.play(voice.spot, at, voice.spotVolume);
        }
      } else if (dist > SPOT_RANGE * 1.8) h.screeched = false;
      if (dist < GROAN_RANGE && t >= h.nextGroan && t - this.lastGroan > GROAN_GAP) {
        h.nextGroan = t + voice.every + Math.random() * voice.every;
        this.lastGroan = t;
        this.audio.play(voice.call, at, voice.callVolume);
      }
      if (dist < STEP_RANGE && moved > 0.01 && t >= h.nextStep) {
        h.nextStep = t + voice.stepEvery;
        this.audio.play(voice.step, at, voice.stepVolume);
      }
    }
    for (const pid of this.heard.keys()) if (!remotes.players.has(pid)) this.heard.delete(pid);
  }

  /** Wind all the time; now and then a cluck far away or wood creaking somewhere near. */
  private ambience(): void {
    const t = this.time;
    const ear = this.camera.position;
    const around = (min: number, max: number) => {
      const a = Math.random() * Math.PI * 2;
      const d = min + Math.random() * (max - min);
      return { x: ear.x + Math.cos(a) * d, y: 1, z: ear.z + Math.sin(a) * d };
    };
    if (t >= this.nextWind) {
      this.nextWind = t + 3 + Math.random() * 1.5;
      this.audio.play('wind', undefined, 0.22);
    }
    if (t >= this.nextCluck) {
      this.nextCluck = t + 10 + Math.random() * 14;
      this.audio.play('cluck', around(35, 55), 0.9);
    }
    if (t >= this.nextCreak) {
      this.nextCreak = t + 7 + Math.random() * 10;
      this.audio.play('creak', around(12, 28), 0.8);
    }
  }

  dispose(): void {
    this.scene.remove(this.light, this.light.target, this.moon);
    this.light.dispose();
    this.moon.geometry.dispose();
    (this.moon.material as THREE.Material).dispose();
    this.moonTexture.dispose();
    setBloodMoonEyes(false);
    this.tint?.(0);
  }
}
