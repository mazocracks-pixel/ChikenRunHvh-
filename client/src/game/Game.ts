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

/** The title screen shows the player's chicken posing on these maps, one after the other. */
const SHOWCASE_MAPS: readonly MapId[] = ['sandstown', 'harbor', 'town', 'frostbite', 'farm'];
/** Seconds on each map, and the fade to black between two maps. */
const SHOWCASE_SECONDS = 9;
const SHOWCASE_FADE_SECONDS = 0.5;
/** How far the camera stands from the chicken, and how high it is (low and close, like a poster). */
const SHOWCASE_DISTANCE = 2.6;
const SHOWCASE_HEIGHT = 0.75;
/** The chicken stands on the left of the screen, where the title screen has room (0 = centre, 1 = the edge). */
const SHOWCASE_SHIFT = 0.52;

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
    mapIndex: number;
    /** Where the chicken stands, and the direction the camera is in (radians). */
    x: number;
    z: number;
    angle: number;
    clock: number;
    /** 'show' → 'out' (fading to black) → 'in' (fading back) → 'show'. */
    phase: 'show' | 'out' | 'in';
    phaseTime: number;
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
    const canvas = this.renderer.domElement;
    canvas.style.transition = '';
    canvas.style.opacity = '';
  }

  /** Puts the chicken on the current map where the camera has room in front and a view behind. */
  private poseShowcase(): void {
    const s = this.showcase!;
    const map = this.world.map;
    let best = { score: -1, x: 0, z: 0, angle: 0 };
    const spawns = map.spawns.length > 0 ? map.spawns : [{ x: 0, z: 0 }];
    for (let i = 0; i < Math.min(spawns.length, 12); i++) {
      const spawn = spawns[(i * 5 + s.mapIndex * 3) % spawns.length]!;
      for (let step = 0; step < 16; step++) {
        const angle = (step / 16) * Math.PI * 2;
        const toCamera = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
        const eye = new THREE.Vector3(spawn.x, 1, spawn.z);
        // Room for the camera in front of the chicken...
        const front = raycastWorld(makeRay(eye, toCamera), this.world.collision, SHOWCASE_DISTANCE + 1.2);
        if (front) continue;
        // ...and something to look at behind it: not a wall right at its back, not empty void.
        const back = raycastWorld(makeRay(eye, toCamera.clone().multiplyScalar(-1)), this.world.collision, 40);
        const distance = back ? back.t : 40;
        if (distance < 5) continue;
        const score = 100 - Math.abs(distance - 14) + Math.random();
        if (score > best.score) best = { score, x: spawn.x, z: spawn.z, angle };
      }
      if (best.score > 0 && i >= 3) break;
    }
    if (best.score < 0) best = { score: 0, x: spawns[0]!.x, z: spawns[0]!.z, angle: 0.6 };
    s.x = best.x;
    s.z = best.z;
    s.angle = best.angle;
    s.chicken.root.position.set(s.x, 0, s.z);
  }

  private updateShowcase(dt: number): void {
    if (!this.showcase) {
      const chicken = new Chicken(this.showcaseLook(this.showcaseAppearance));
      chicken.setWeapon('rifle');
      this.scene.add(chicken.root);
      this.showcase = { chicken, mapIndex: 0, x: 0, z: 0, angle: 0, clock: 0, phase: 'in', phaseTime: 0 };
      this.useMap(SHOWCASE_MAPS[0]!);
      this.poseShowcase();
      this.renderer.domElement.style.transition = `opacity ${SHOWCASE_FADE_SECONDS}s ease`;
    }
    const s = this.showcase;
    s.clock += dt;
    s.phaseTime += dt;
    const canvas = this.renderer.domElement;
    if (s.phase === 'show' && s.phaseTime >= SHOWCASE_SECONDS) {
      s.phase = 'out';
      s.phaseTime = 0;
      canvas.style.opacity = '0';
    } else if (s.phase === 'out' && s.phaseTime >= SHOWCASE_FADE_SECONDS + 0.05) {
      // Dark: change the map (the pause hides the rebuild), then fade back in.
      s.mapIndex = (s.mapIndex + 1) % SHOWCASE_MAPS.length;
      this.useMap(SHOWCASE_MAPS[s.mapIndex]!);
      this.poseShowcase();
      s.phase = 'in';
      s.phaseTime = 0;
      canvas.style.opacity = '1';
    } else if (s.phase === 'in' && s.phaseTime >= SHOWCASE_FADE_SECONDS) {
      s.phase = 'show';
      s.phaseTime = 0;
    }

    // The chicken stands there, breathing, turned three-quarters toward the camera, like a poster.
    s.chicken.root.rotation.y = s.angle + Math.PI + 0.5 + Math.sin(s.clock * 0.4) * 0.08;
    s.chicken.animate(dt, 0, true);
    // The camera drifts slowly, low and close.
    const angle = s.angle + Math.sin(s.clock * 0.25) * 0.16;
    this.syncFov();
    // Slide the whole view to the right (camera and target together) so the chicken sits on the left.
    const halfWidth = SHOWCASE_DISTANCE * Math.tan(((this.camera.fov / 2) * Math.PI) / 180) * this.camera.aspect;
    const slide = this.camera.aspect > 1.1 ? halfWidth * SHOWCASE_SHIFT : 0;
    const rx = Math.cos(angle) * slide;
    const rz = -Math.sin(angle) * slide;
    this.camera.position.set(s.x + Math.sin(angle) * SHOWCASE_DISTANCE + rx, SHOWCASE_HEIGHT + Math.sin(s.clock * 0.35) * 0.04, s.z + Math.cos(angle) * SHOWCASE_DISTANCE + rz);
    this.camera.lookAt(s.x + rx, 0.5, s.z + rz);
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
