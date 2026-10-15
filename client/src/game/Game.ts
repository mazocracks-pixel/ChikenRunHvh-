import type { MapZone } from '@game/shared';
import * as THREE from 'three';
import { nativeOn } from '../dev/skeet/visualValues';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { MAPS, type Appearance, type JoinSuccess, type MapId, type WeaponId } from '@game/shared';
import type { Network } from '../net/Network';
import { watchSettings, type Quality } from '../settings';
import { Hud } from '../ui/Hud';
import { AudioEngine } from './Audio';
import { Effects } from './Effects';
import { baseFov } from './CameraRig';
import { GameSession, type DevHooks } from './GameSession';
import { Input } from './Input';
import { Chicken } from './models/Chicken';
import { defaultLook, desertLook, nightLook, type WorldLook, bloodMoonLook } from './look';
import { SUN_DIRECTION, Sky } from './Sky';
import { World } from './World';

/** Clamp long frames (tab switches, breakpoints) so the simulation doesn't try to catch up for seconds. */
/** How far the camera draws: everything by day; at night only a little past the fog. */
const DAY_VIEW = 400;
const NIGHT_VIEW = 48;
const MAX_FRAME_DT = 0.25;
const PREVIEW_SPOT = new THREE.Vector3(31.25, 5.9, 5.9375);
const DEFAULT_LOOK_KEY = JSON.stringify(defaultLook());

const SHOWCASE_MAP: MapId = 'mirage';

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
  private readonly camera = new THREE.PerspectiveCamera(baseFov(), 1, 0.1, DAY_VIEW);
  private readonly sky: Sky;
  private environment: THREE.Texture;
  private environmentTarget: THREE.WebGLRenderTarget;
  private envScene: THREE.Scene;
  /** What the developer World tab set (white tints = unchanged), and what the map looks like by itself. */
  private userLook: WorldLook = defaultLook();
  private baseLook: WorldLook = SHOWCASE_MAP === 'mirage' ? desertLook() : defaultLook();
  /** Zombie Apocalypse Blood Moon: 0 (normal night) to 1 (crimson). */
  private bloodMoon = 0;
  /** Inside a story event level: its own light (null: the map's). */
  private zoneLook: MapZone['look'] | null = null;
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
  private showcaseWeapon: WeaponId = 'rifle';
  private showcase: {
    chicken: Chicken;
    clock: number;
  } | null = null;
  private fpsFrames = 0;
  private fpsWindowStart = 0;
  private readonly shadowFocus = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, hudContainer: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.info.autoReset = false;
    const gl = this.renderer.getContext();
    const gpu = gl.getExtension('WEBGL_debug_renderer_info');
    if (gpu) canvas.dataset.gpu = String(gl.getParameter(gpu.UNMASKED_RENDERER_WEBGL));
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

    this.world = new World(this.scene, MAPS[SHOWCASE_MAP], this.renderer.capabilities.getMaxAnisotropy());
    // The app displays map errors after the account handshake.
    void this.world.ready.catch(() => undefined);
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

  get ready(): Promise<void> {
    return this.world.ready;
  }

  startSession(net: Network, join: JoinSuccess, callbacks: SessionCallbacks): Promise<void> {
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
      setZoneLook: (look) => {
        this.zoneLook = look;
        this.applyLook();
      },
      setBloodMoon: (amount) => {
        if (Math.abs(amount - this.bloodMoon) < 0.004 && amount !== 0) return;
        this.bloodMoon = amount;
        this.applyLook();
      },
      ...callbacks,
    });
    return this.world.ready;
  }

  endSession(): void {
    if (this.bloodMoon > 0 || this.zoneLook) {
      this.bloodMoon = 0;
      this.zoneLook = null;
      this.applyLook();
    }
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
      this.endShowcase();
      this.useMap(SHOWCASE_MAP);
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
    this.applyQuality(this.quality);
    // Some maps have their own light (the Graveyard is a night).
    const night = id === 'night';
    this.baseLook = night ? nightLook() : id === 'mirage' ? desertLook() : defaultLook();
    // The night: nothing is drawn past the fog (it hides it anyway), and the gun in your hands
    // is lit like the world around it.
    this.camera.far = night ? NIGHT_VIEW : DAY_VIEW;
    this.camera.updateProjectionMatrix();
    this.sky.setReach(this.camera.far);
    this.overlayHemi.intensity = night ? 0.3 : 0.9;
    this.overlaySun.intensity = night ? 0.6 : 2.2;
    this.lookKey = '';
    this.applyLook();
  }

  /** The chicken and equipped weapon shown in the lobby; null for a plain fly-over. */
  setMenuChicken(appearance: Appearance | null, weapon: WeaponId = 'rifle'): void {
    this.showcaseAppearance = appearance;
    this.showcaseWeapon = weapon;
    if (this.showcase) {
      this.showcase.chicken.setAppearance(this.showcaseLook(appearance));
      this.showcase.chicken.setWeapon(weapon);
    }
  }

  private showcaseLook(appearance: Appearance | null): Appearance {
    return appearance ?? { skin: 'white', hat: 'none', beak: 'orange', shoes: 'none' };
  }

  private endShowcase(): void {
    if (!this.showcase) return;
    this.showcase.chicken.dispose();
    this.showcase = null;
  }

  private updateShowcase(dt: number): void {
    if (!this.showcase) {
      const chicken = new Chicken(this.showcaseLook(this.showcaseAppearance));
      chicken.setWeapon(this.showcaseWeapon);
      chicken.headBob = true;
      this.scene.add(chicken.root);
      this.useMap(SHOWCASE_MAP);
      this.showcase = { chicken, clock: 0 };
    }
    const s = this.showcase;
    s.clock += dt;

    s.chicken.root.position.copy(PREVIEW_SPOT);
    s.chicken.animate(dt, 0, true);
    s.chicken.menuEmote(s.clock);
    s.chicken.root.rotation.y = Math.PI + 0.3 + Math.sin(s.clock * 0.35) * 0.035;
    const fov = this.camera.aspect < 1 ? 50 : 40;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // Far enough back that the whole chicken stands in the lobby, like a CS agent.
    this.camera.position.set(PREVIEW_SPOT.x, PREVIEW_SPOT.y + 1, PREVIEW_SPOT.z + 4.6);
    this.camera.lookAt(PREVIEW_SPOT.x, PREVIEW_SPOT.y + 0.75, PREVIEW_SPOT.z);
  }

  /** Developer World tab: surface colours, sky, fog and light. Kept across map changes. */
  setLook(user: WorldLook): void {
    this.userLook = { ...user };
    this.applyLook();
  }

  private applyLook(): void {
    // An untouched World tab means "the map's own look".
    const own = JSON.stringify(this.userLook) === DEFAULT_LOOK_KEY ? this.baseLook : this.userLook;
    const tinted = this.bloodMoon > 0 ? bloodMoonLook(own, this.bloodMoon) : own;
    const look = this.zoneLook ? { ...tinted, ...this.zoneLook } : tinted;
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio, this.world.map.mesh ? 1 : 2));
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
    const bloom = preset.bloom && !this.world.map.mesh;
    if (bloom && !this.composer) this.composer = this.createComposer();
    if (!bloom && this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.resize();
  }

  private applyWorldQuality(): void {
    this.world.setShadows({ mapSize: this.quality.shadowMap, extent: this.quality.shadowExtent });
    // The night map is big and foggy: a third of the grass looks the same and draws much faster.
    this.world.setDetail(this.quality.foliage * (this.world.map.id === 'night' ? 0.35 : 1));
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
    this.renderer.info.reset();
    const frameStart = performance.now();

    if (this.session) this.session.update(dt, this.fps);
    else if (this.preview) this.updatePreview(dt);
    else if (this.showcaseAppearance) this.updateShowcase(dt);
    else this.updateIdleCamera(dt);
    const updateMs = performance.now() - frameStart;

    this.sky.update(this.camera, dt);
    this.world.update(dt, this.camera.position);
    this.world.updateShadows(this.session ? this.focusAhead() : this.preview?.root.position ?? this.showcase?.chicken.root.position ?? null);
    if (this.composer && !nativeOn(this.session?.hvhVisuals??null,'Visuals.Effects.disablePostProcessing')) this.composer.render(dt);
    else {
      this.renderer.render(this.scene, this.camera);
      this.renderOverlay();
    }
    this.renderer.domElement.dataset.updateMs = updateMs.toFixed(1);
    this.renderer.domElement.dataset.frameMs = (performance.now() - frameStart).toFixed(1);
    this.countFrame(time);
  };

  /** The first-person gun on top of the world, lit like the world. */
  private readonly overlayHemi = new THREE.HemisphereLight(0xcfe8ff, 0x4f6b32, 0.9);
  private readonly overlaySun = new THREE.DirectionalLight(0xfff0d8, 2.2);

  private setupOverlay(): void {
    this.overlay.add(this.overlayHemi);
    const sun = this.overlaySun;
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
    this.camera.position.set(PREVIEW_SPOT.x - shift, PREVIEW_SPOT.y + 1.2, PREVIEW_SPOT.z + dist);
    this.camera.lookAt(PREVIEW_SPOT.x - shift, PREVIEW_SPOT.y + 0.85, PREVIEW_SPOT.z);
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
      this.renderer.domElement.dataset.drawCalls = String(this.renderer.info.render.calls);
      this.renderer.domElement.dataset.triangles = String(this.renderer.info.render.triangles);
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
