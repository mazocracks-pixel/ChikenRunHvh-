import * as THREE from 'three';
import { nativeOn } from '../dev/skeet/visualValues';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { MAPS, makeRay, raycastWorld, type Appearance, type JoinSuccess, type MapId, type WeaponId } from '@game/shared';
import type { Network } from '../net/Network';
import { watchSettings, type Quality } from '../settings';
import { Hud } from '../ui/Hud';
import { AudioEngine } from './Audio';
import { Effects } from './Effects';
import { baseFov } from './CameraRig';
import { GameSession, type DevHooks } from './GameSession';
import { Input } from './Input';
import { Chicken } from './models/Chicken';
import { defaultLook, nightLook, type WorldLook } from './look';
import { SUN_DIRECTION, Sky } from './Sky';
import { World } from './World';

/** Clamp long frames (tab switches, breakpoints) so the simulation doesn't try to catch up for seconds. */
const MAX_FRAME_DT = 0.25;
const PREVIEW_SPOT = new THREE.Vector3(0, 0, 18);
const DEFAULT_LOOK_KEY = JSON.stringify(defaultLook());

/** The title screen: your chicken runs laps on this map (Sandstown, like the poster). */
const SHOWCASE_MAP: MapId = 'sandstown';
/** The lap: the biggest radius that fits (metres), and running speed in m/s. */
const SHOWCASE_RADIUS = 6.5;
const SHOWCASE_SPEED = 6.5;
/** The camera is this close to the chicken (it rides inside the lap), at this height. */
const SHOWCASE_DISTANCE = 3;
const SHOWCASE_HEIGHT = 0.85;
/** How far the chicken turns from facing the camera towards the way it runs (radians). */
const SHOWCASE_TURN = 0.35;
/** The chicken runs on the right of the screen (negative: left; 0 = centre, 1 = the edge). */
const SHOWCASE_SHIFT = -0.52;

interface QualityPreset {
  /** Upper limit for the device pixel ratio. */
  pixelRatio: number;
  /** Shadow map resolution, 0 = no shadows. */
  shadowMap: number;
  /** Half-width of the sharp-shadow area around the camera, in metres. */
  shadowExtent: number;
  /** Grass and flowers, 0..1. */
  foliage: number;
  bloom: boolean;
  /** Image-based ambient light from the sky (otherwise a plain hemisphere light). */
  envLight: boolean;
  /** Gunfire and explosions light up their surroundings. */
  flashLights: boolean;
}

const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 1, shadowMap: 0, shadowExtent: 0, foliage: 0, bloom: false, envLight: false, flashLights: false },
  medium: { pixelRatio: 1.5, shadowMap: 1024, shadowExtent: 26, foliage: 0.45, bloom: false, envLight: true, flashLights: true },
  high: { pixelRatio: 2, shadowMap: 2048, shadowExtent: 32, foliage: 1, bloom: true, envLight: true, flashLights: true },
};

export interface SessionCallbacks {
  /** Match reward: the new coin and XP totals. */
  onReward: (coins: number, xp: number) => void;
  /** The buy menu opened or closed (it frees the mouse). */
  onOverlay: () => void;
  onClosed: (reason: string) => void;
}

/** Owns the renderer, scene and main loop. Shows a fly-over (or the customize preview) between matches. */
export class Game {
  readonly input: Input;
  readonly audio = new AudioEngine();
  readonly hud: Hud;
  fps = 0;
  /** Developer tools hooked into every match (set by the app). */
  dev: DevHooks | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  /** Drawn after the world with a fresh depth buffer: the first-person gun, so it never clips into walls. */
  private readonly overlay = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(baseFov(), 1, 0.1, 400);
  private readonly sky: Sky;
  private environment: THREE.Texture;
  private environmentTarget: THREE.WebGLRenderTarget;
  private envScene: THREE.Scene;
  /** What the developer World tab set (white tints = unchanged), and what the map looks like by itself. */
  private userLook: WorldLook = defaultLook();
  private baseLook: WorldLook = defaultLook();
  private lookKey = '';
  private skyKey = '';
  private rebakeTimer: number | undefined;
  private world: World;
  private qualityId: Quality | null = null;
  private quality: QualityPreset = QUALITY.high;
  private composer: EffectComposer | null = null;
  private session: GameSession | null = null;
  private preview: Chicken | null = null;
  private lastFrameTime: number | null = null;
  private idleAngle = 0.7;
  /** The player's chicken for the title screen (set by the app); null = just the fly-over. */
  private showcaseAppearance: Appearance | null = null;
  private showcase: {
    chicken: Chicken;
    /** The middle of the lap, its radius, and how far round the chicken is (radians). */
    x: number;
    z: number;
    radius: number;
    lap: number;
    clock: number;
  } | null = null;
  private fpsFrames = 0;
  private fpsWindowStart = 0;
  private readonly shadowFocus = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, hudContainer: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.add(this.camera);

    // The sky lights the scene too: bake it once into an environment map for soft ambient
    // light and reflections on metal, glass and golden skins.
    this.sky = new Sky(this.scene);
    this.envScene = this.sky.environmentScene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environmentTarget = pmrem.fromScene(this.envScene, 0.02);
    this.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 0.9;
    this.setupOverlay();
    pmrem.dispose();

    this.world = new World(this.scene, MAPS.farm, this.renderer.capabilities.getMaxAnisotropy());
    this.input = new Input(canvas);
    this.hud = new Hud(hudContainer);

    window.addEventListener('resize', this.resize);
    watchSettings((s) => {
      if (s.quality === this.qualityId) return;
      this.qualityId = s.quality;
      this.applyQuality(QUALITY[s.quality]);
    });
    this.renderer.setAnimationLoop(this.frame);
  }

  get activeSession(): GameSession | null {
    return this.session;
  }

  startSession(net: Network, join: JoinSuccess, callbacks: SessionCallbacks): void {
    this.endSession();
    this.setPreview(null);
    this.endShowcase();
    this.useMap(join.room.map);
    this.session = new GameSession({
      scene: this.scene,
      overlay: this.overlay,
      camera: this.camera,
      world: this.world,
      input: this.input,
      net,
      audio: this.audio,
      hud: this.hud,
      join,
      dev: this.dev ?? undefined,
      ...callbacks,
    });
  }

  endSession(): void {
    this.session?.dispose();
    this.session = null;
    this.camera.fov = baseFov();
    this.camera.updateProjectionMatrix();
  }

  /** Shows (or hides, with null) a turntable chicken for the customize screen. */
  setPreview(appearance: Appearance | null, weapon: WeaponId | null = null): void {
    if (!appearance) {
      this.preview?.dispose();
      this.preview = null;
      return;
    }
    if (!this.preview) {
      // The preview spot is chosen for the farm; the title screen may have another map up.
      this.endShowcase();
      this.useMap('farm');
      this.preview = new Chicken(appearance);
      this.preview.root.position.copy(PREVIEW_SPOT);
      this.scene.add(this.preview.root);
    }
    this.preview.setAppearance(appearance);
    this.preview.setWeapon(weapon);
  }

  private useMap(id: MapId): void {
    if (this.world.map.id === id) return;
    this.world.dispose();
    this.world = new World(this.scene, MAPS[id], this.renderer.capabilities.getMaxAnisotropy());
    this.applyWorldQuality();
    // Some maps have their own light (the Graveyard is a night).
    this.baseLook = id === 'night' ? nightLook() : defaultLook();
    this.lookKey = '';
    this.applyLook();
  }

  /** The chicken the title screen shows (your own, with a rifle); null for the plain fly-over. */
  setMenuChicken(appearance: Appearance | null): void {
    this.showcaseAppearance = appearance;
    if (this.showcase) {
      this.showcase.chicken.setAppearance(this.showcaseLook(appearance));
    }
  }

  /** The title-screen chicken wears an army helmet when you have no hat on, like the poster. */
  private showcaseLook(appearance: Appearance | null): Appearance {
    const a = appearance ?? { skin: 'white', hat: 'none', beak: 'orange', shoes: 'none' };
    return a.hat === 'none' ? { ...a, hat: 'helmet' } : a;
  }

  private endShowcase(): void {
    if (!this.showcase) return;
    this.showcase.chicken.dispose();
    this.showcase = null;
  }

  /** The roomiest spot on the map: the middle of a lap, and how big a lap fits round it. */
  private lapCentre(): { x: number; z: number; radius: number } {
    const half = this.world.map.halfSize;
    let best = { room: 0, x: 0, z: 0 };
    for (let x = -half + 4; x <= half - 4; x += 3) {
      for (let z = -half + 4; z <= half - 4; z += 3) {
        let room = SHOWCASE_RADIUS + 2;
        for (let i = 0; i < 16 && room > best.room; i++) {
          const a = (i / 16) * Math.PI * 2;
          const hit = raycastWorld(makeRay(new THREE.Vector3(x, 0.5, z), new THREE.Vector3(Math.sin(a), 0, Math.cos(a))), this.world.collision, SHOWCASE_RADIUS + 2);
          if (hit) room = Math.min(room, hit.t);
        }
        if (room > best.room) best = { room, x, z };
      }
    }
    // The lap keeps a little clear of the walls.
    return { x: best.x, z: best.z, radius: Math.max(3, Math.min(SHOWCASE_RADIUS, best.room - 1.3)) };
  }

  private updateShowcase(dt: number): void {
    if (!this.showcase) {
      const chicken = new Chicken(this.showcaseLook(this.showcaseAppearance));
      chicken.setWeapon('rifle');
      chicken.headBob = true;
      this.scene.add(chicken.root);
      this.useMap(SHOWCASE_MAP);
      this.showcase = { chicken, ...this.lapCentre(), lap: 0, clock: 0 };
    }
    const s = this.showcase;
    s.clock += dt;
    // (Round the other way: it runs towards the right.)
    s.lap -= (SHOWCASE_SPEED / s.radius) * dt;

    // The chicken runs round a big circle, turned towards the camera (a little towards where it runs).
    const sin = Math.sin(s.lap);
    const cos = Math.cos(s.lap);
    s.chicken.root.position.set(s.x + sin * s.radius, 0, s.z + cos * s.radius);
    s.chicken.animate(dt, SHOWCASE_SPEED, true);

    // The camera rides inside the lap, always SHOWCASE_DISTANCE in front of the chicken and looking
    // out at it. Camera and target slide sideways together, so the chicken stays on the right.
    this.syncFov();
    const halfWidth = SHOWCASE_DISTANCE * Math.tan(((this.camera.fov / 2) * Math.PI) / 180) * this.camera.aspect;
    const slide = this.camera.aspect > 1.1 ? halfWidth * SHOWCASE_SHIFT : 0;
    const inner = s.radius - SHOWCASE_DISTANCE;
    const rx = -cos * slide;
    const rz = sin * slide;
    this.camera.position.set(s.x + sin * inner + rx, SHOWCASE_HEIGHT + Math.sin(s.clock * 5) * 0.015, s.z + cos * inner + rz);
    // Face the camera (a little towards where it runs).
    const at = s.chicken.root.position;
    s.chicken.root.rotation.y = Math.atan2(at.x - this.camera.position.x, at.z - this.camera.position.z) + SHOWCASE_TURN;
    this.camera.lookAt(s.chicken.root.position.x + rx, 0.55, s.chicken.root.position.z + rz);
  }

  /** Developer World tab: surface colours, sky, fog and light. Kept across map changes. */
  setLook(user: WorldLook): void {
    this.userLook = { ...user };
    this.applyLook();
  }

  private applyLook(): void {
    // An untouched World tab means "the map's own look".
    const look = JSON.stringify(this.userLook) === DEFAULT_LOOK_KEY ? this.baseLook : this.userLook;
    const lookKey = JSON.stringify(look);
    if (lookKey === this.lookKey) return;
    this.lookKey = lookKey;
    this.world.setLook(look);
    this.sky.setColors(look.zenith, look.horizon);
    this.sky.setClouds(look.clouds);
    this.renderer.toneMappingExposure = look.exposure;
    this.scene.environmentIntensity = 0.9 * look.ambient;
    this.overlay.environmentIntensity = this.scene.environmentIntensity;
    // The sky also lights the scene; re-bake that lighting once the colours settle.
    const key = `${look.zenith}|${look.horizon}|${look.clouds}`;
    if (key !== this.skyKey) {
      this.skyKey = key;
      window.clearTimeout(this.rebakeTimer);
      this.rebakeTimer = window.setTimeout(() => this.rebakeEnvironment(), 250);
    }
  }

  private rebakeEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const target = pmrem.fromScene(this.envScene, 0.02);
    pmrem.dispose();
    const wasOn = this.scene.environment === this.environment;
    this.environmentTarget.dispose();
    this.environmentTarget = target;
    this.environment = target.texture;
    if (wasOn) this.scene.environment = this.overlay.environment = this.environment;
  }

  private applyQuality(preset: QualityPreset): void {
    const shadowsChanged = this.renderer.shadowMap.enabled !== preset.shadowMap > 0;
    this.quality = preset;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
    this.renderer.shadowMap.enabled = preset.shadowMap > 0;
    Chicken.blobShadows = preset.shadowMap === 0;
    Effects.flashLights = preset.flashLights;
    this.scene.environment = this.overlay.environment = preset.envLight ? this.environment : null;
    this.applyWorldQuality();
    // Materials compiled with (or without) shadow code need rebuilding.
    if (shadowsChanged) {
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
        else if (m) m.needsUpdate = true;
      });
    }
    if (preset.bloom && !this.composer) this.composer = this.createComposer();
    if (!preset.bloom && this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.resize();
  }

  private applyWorldQuality(): void {
    this.world.setShadows({ mapSize: this.quality.shadowMap, extent: this.quality.shadowExtent });
    this.world.setDetail(this.quality.foliage);
    this.world.setAmbient(this.quality.envLight);
  }

  /** Renders through a bloom pass, so muzzle flashes, explosions and the sun glow. */
  private createComposer(): EffectComposer {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const overlay = new RenderPass(this.overlay, this.camera);
    overlay.clear = false;
    overlay.clearDepth = true;
    composer.addPass(overlay);
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.45, 1.6));
    composer.addPass(new OutputPass());
    return composer;
  }

  private frame = (time: number): void => {
    if (document.hidden) { this.lastFrameTime = null; this.fpsFrames = this.fpsWindowStart = 0; return; }
    // A slowly moving menu background needs fewer draws; active play keeps display refresh rate.
    if (!this.session && !this.preview && !this.showcaseAppearance && this.lastFrameTime !== null && time-this.lastFrameTime < 1000/30 - 0.5) return;
    const dt = this.lastFrameTime === null ? 0 : Math.min((time - this.lastFrameTime) / 1000, MAX_FRAME_DT);
    this.lastFrameTime = time;

    if (this.session) this.session.update(dt, this.fps);
    else if (this.preview) this.updatePreview(dt);
    else if (this.showcaseAppearance) this.updateShowcase(dt);
    else this.updateIdleCamera(dt);

    this.sky.update(this.camera, dt);
    this.world.update(dt);
    this.world.updateShadows(this.session ? this.focusAhead() : null);
    if (this.composer && !nativeOn(this.session?.hvhVisuals??null,'Visuals.Effects.disablePostProcessing')) this.composer.render(dt);
    else {
      this.renderer.render(this.scene, this.camera);
      this.renderOverlay();
    }
    this.countFrame(time);
  };

  /** The first-person gun on top of the world, lit like the world. */
  private setupOverlay(): void {
    this.overlay.add(new THREE.HemisphereLight(0xcfe8ff, 0x4f6b32, 0.9));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(10);
    this.overlay.add(sun, sun.target);
    this.overlay.environment = this.environment;
    this.overlay.environmentIntensity = this.scene.environmentIntensity;
  }

  private renderOverlay(): void {
    if (!this.overlay.children.some((o) => o.visible && !(o as THREE.Light).isLight)) return;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.overlay, this.camera);
    this.renderer.autoClear = true;
  }

  /** A point on the ground a little ahead of the camera: where sharp shadows matter most. */
  private focusAhead(): THREE.Vector3 {
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    return this.shadowFocus.copy(this.camera.position).addScaledVector(this.forward, this.quality.shadowExtent * 0.45).setY(0);
  }

  private updateIdleCamera(dt: number): void {
    this.idleAngle += dt * 0.05;
    const r = this.world.map.halfSize * 1.15;
    this.camera.position.set(Math.cos(this.idleAngle) * r, r * 0.5, Math.sin(this.idleAngle) * r);
    this.camera.lookAt(0, 1, 0);
    this.syncFov();
  }

  private updatePreview(dt: number): void {
    const chicken = this.preview!;
    chicken.root.rotation.y += dt * 0.6;
    chicken.animate(dt, 0, true);
    this.syncFov();
    // Frame the chicken on the right side of wide screens, leaving room for the shop panel.
    const dist = 3.6;
    const aspect = this.camera.aspect;
    const halfFov = Math.atan(Math.tan(((this.camera.fov / 2) * Math.PI) / 180) * aspect);
    const shift = aspect > 1.1 ? dist * Math.tan(halfFov) * 0.42 : 0;
    this.camera.position.set(PREVIEW_SPOT.x - shift, 1.2, PREVIEW_SPOT.z + dist);
    this.camera.lookAt(PREVIEW_SPOT.x - shift, 0.85, PREVIEW_SPOT.z);
  }

  /** Outside a match nothing zooms, so the camera just follows the FOV setting. */
  private syncFov(): void {
    const fov = baseFov();
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  private countFrame(time: number): void {
    this.fpsFrames++;
    if (time - this.fpsWindowStart >= 1000) {
      this.fps = Math.round((this.fpsFrames * 1000) / (time - this.fpsWindowStart));
      this.fpsFrames = 0;
      this.fpsWindowStart = time;
    }
  }

  private resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(width, height);
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };
}
