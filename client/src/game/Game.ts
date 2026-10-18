import type { MapZone } from '@game/shared';
import * as THREE from 'three';
import { nativeOn } from '../dev/skeet/visualValues';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { MAPS, damp, wrapAngle, type Appearance, type JoinSuccess, type MapId, type WeaponId } from '@game/shared';
import type { Network } from '../net/Network';
import { watchSettings, type Quality } from '../settings';
import { Hud } from '../ui/Hud';
import { AudioEngine, MENU_CLUCK_FILE } from './Audio';
import { Effects } from './Effects';
import { baseFov } from './CameraRig';
import { GameSession, type DevHooks } from './GameSession';
import { Input } from './Input';
import { Chicken } from './models/Chicken';
import { defaultLook, desertLook, menuLook, nightLook, type WorldLook, bloodMoonLook } from './look';
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
/** Title screen and shop: the chickens are drawn on their own layer, sharp, over a soft half-size background. */
const MENU_LAYER = 1;
const MENU_BG_SCALE = 0.5;
/** Frame cap outside a match (the fly-over before an account loads gets half of it). */
const MENU_FPS = 60;
/** Where party members stand, from the camera's view: right (x) and back (z) of your chicken, and a head start in the idle loop (t). */
const PARTY_SLOTS = [
  { x: 0.85, z: -0.9, yaw: 0.15, t: 3.1 },
  { x: -0.8, z: -0.9, yaw: 0.45, t: 6.7 },
  { x: 1.55, z: -1.9, yaw: 0.05, t: 9.9 },
  { x: -1.45, z: -1.9, yaw: 0.55, t: 12.3 },
] as const;

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
  /** Title-screen framing: distance, camera and target heights, and how far right of the chicken the camera sits (share of the half-width). */
  readonly menuShot = { dist: 4.6, height: 1, look: 0.75, side: 0.2, yaw: 0 };
  /** Set by the app: something covers the whole menu (a dialog, the News page), so nothing needs drawing. */
  menuCovered: () => boolean = () => false;
  /** Title screen: where your chicken's feet are on screen (0..1 of the width and height), for the name plate under it. */
  onMenuAnchor: ((x: number, y: number) => void) | null = null;
  private menuFx: { target: THREE.WebGLRenderTarget; material: THREE.ShaderMaterial; scene: THREE.Scene; camera: THREE.OrthographicCamera } | null = null;
  private menuLightsFor: World | null = null;
  /** Map pieces left out of the menu background (Mirage's wall lamps draw as a dark blob beside the chicken). */
  private menuHidden: THREE.Object3D[] = [];
  private menuYaw = 0;
  private menuDragAt = -Infinity;
  private worldLoaded = false;
  private party: Chicken[] = [];
  private partyLooks: Appearance[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly anchor = new THREE.Vector3();
  private readonly bufferSize = new THREE.Vector2();
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
    this.watchWorld();
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
    // A match uses the map's own light (or the developer World tab); the menus their warm one.
    this.applyLook();
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
    this.applyLook();
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
    this.watchWorld();
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

  /** The menu waits for the map before drawing it (the app displays map errors itself). */
  private watchWorld(): void {
    const world = this.world;
    this.worldLoaded = false;
    void world.ready.then(() => {
      if (world === this.world) this.worldLoaded = true;
    }, () => undefined);
  }

  /** Title screen: your party members (not you) stand next to your chicken, up to four. */
  setMenuParty(looks: readonly Appearance[]): void {
    this.partyLooks = looks.slice(0, PARTY_SLOTS.length);
    if (!this.showcase) return;
    while (this.party.length > this.partyLooks.length) this.party.pop()!.dispose();
    this.partyLooks.forEach((look, i) => {
      let c = this.party[i];
      if (!c) {
        c = new Chicken(look);
        c.setWeapon('rifle');
        c.headBob = true;
        this.scene.add(c.root);
        this.party.push(c);
      }
      c.setAppearance(look);
    });
  }

  /** Title screen: dragging turns your chicken (it turns back by itself a moment after). */
  turnMenuChicken(dx: number): void {
    this.menuYaw = wrapAngle(this.menuYaw + dx * 0.012);
    this.menuDragAt = performance.now();
  }

  /** Title screen: a click on your chicken makes it cluck and flap. Returns whether it was hit. */
  pokeMenuChicken(clientX: number, clientY: number): boolean {
    const s = this.showcase;
    if (!s || this.session) return false;
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.layers.set(MENU_LAYER);
    if (this.raycaster.intersectObject(s.chicken.root, true).length === 0) return false;
    s.chicken.react(s.clock);
    // Your own cluck recording; the built-in cluck if it can't load.
    void this.audio.playFile(MENU_CLUCK_FILE, 0.9).then((played) => {
      if (!played) this.audio.play('cluck', undefined, 0.9);
    });
    return true;
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
    for (const c of this.party) c.dispose();
    this.party = [];
  }

  private updateShowcase(dt: number): void {
    if (!this.showcase) {
      const chicken = new Chicken(this.showcaseLook(this.showcaseAppearance));
      chicken.setWeapon(this.showcaseWeapon);
      chicken.headBob = true;
      this.scene.add(chicken.root);
      this.useMap(SHOWCASE_MAP);
      this.showcase = { chicken, clock: 0 };
      this.setMenuParty(this.partyLooks);
    }
    const s = this.showcase;
    s.clock += dt;
    // Let go of a drag and the chicken slowly turns back to face you.
    if (performance.now() - this.menuDragAt > 2500) this.menuYaw = damp(this.menuYaw, 0, 1.6, dt);

    s.chicken.root.position.copy(PREVIEW_SPOT);
    s.chicken.animate(dt, 0, true);
    s.chicken.menuEmote(s.clock);
    s.chicken.root.rotation.y = Math.PI + 0.3 + Math.sin(s.clock * 0.35) * 0.035 + this.menuYaw;
    const fov = this.camera.aspect < 1 ? 50 : 40;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // Far enough back that the whole chicken stands in the lobby, like a CS agent; on wide
    // screens the camera sits a little to the right, so the chicken stands left of centre.
    const shot = this.menuShot;
    const halfWidth = Math.tan((fov * Math.PI) / 360) * this.camera.aspect * shot.dist;
    const side = this.camera.aspect < 1 ? 0 : shot.side * halfWidth;
    const fx = Math.sin(shot.yaw), fz = Math.cos(shot.yaw);
    const rx = fz, rz = -fx;
    this.camera.position.set(PREVIEW_SPOT.x + fx * shot.dist + rx * side, PREVIEW_SPOT.y + shot.height, PREVIEW_SPOT.z + fz * shot.dist + rz * side);
    this.camera.lookAt(PREVIEW_SPOT.x + rx * side, PREVIEW_SPOT.y + shot.look, PREVIEW_SPOT.z + rz * side);
    this.party.forEach((c, i) => {
      const slot = PARTY_SLOTS[i]!;
      c.root.position.set(PREVIEW_SPOT.x + rx * slot.x + fx * slot.z, PREVIEW_SPOT.y, PREVIEW_SPOT.z + rz * slot.x + fz * slot.z);
      c.animate(dt, 0, true);
      c.menuEmote(s.clock + slot.t);
      c.root.rotation.y = Math.PI + shot.yaw + slot.yaw;
    });
    if (this.onMenuAnchor) {
      this.camera.updateMatrixWorld();
      const p = this.anchor.copy(PREVIEW_SPOT).project(this.camera);
      this.onMenuAnchor((p.x + 1) / 2, (1 - p.y) / 2);
    }
  }

  /** Developer World tab: surface colours, sky, fog and light. Kept across map changes. */
  setLook(user: WorldLook): void {
    this.userLook = { ...user };
    this.applyLook();
  }

  private applyLook(): void {
    // An untouched World tab means "the map's own look". The menus always use their own warm
    // look: World tab colours (saved in this browser) are for matches only.
    const own = !this.session ? (this.world.map.id === SHOWCASE_MAP ? menuLook() : this.baseLook) : JSON.stringify(this.userLook) === DEFAULT_LOOK_KEY ? this.baseLook : this.userLook;
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
    // Nothing to draw: a hidden tab, or a menu covered by a dialog or the News page.
    if (document.hidden || (!this.session && this.menuCovered())) { this.lastFrameTime = null; this.fpsFrames = this.fpsWindowStart = 0; return; }
    // The menus need fewer draws (the fly-over before an account loads fewer still); a match keeps the display's refresh rate.
    const cap = this.session ? 0 : this.preview || this.showcaseAppearance ? MENU_FPS : MENU_FPS / 2;
    if (cap && this.lastFrameTime !== null && time - this.lastFrameTime < 1000 / cap - 0.5) return;
    // The menu shows before Mirage has loaded; it draws once the map is there.
    if (!this.session && !this.worldLoaded) return;
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
    if (!this.session && (this.preview || this.showcase)) this.renderMenu();
    else if (this.composer && !nativeOn(this.session?.hvhVisuals??null,'Visuals.Effects.disablePostProcessing')) this.composer.render(dt);
    else {
      this.renderer.render(this.scene, this.camera);
      this.renderOverlay();
    }
    this.renderer.domElement.dataset.updateMs = updateMs.toFixed(1);
    this.renderer.domElement.dataset.frameMs = (performance.now() - frameStart).toFixed(1);
    this.countFrame(time);
  };

  /**
   * Title screen and shop: the world at half size, softly blurred (depth of field) and warmly
   * graded, then the chickens sharp on top. Lighter than drawing the full-size world, and the
   * low-res map textures don't show.
   */
  private renderMenu(): void {
    const r = this.renderer;
    const fx = (this.menuFx ??= this.createMenuFx());
    const size = r.getDrawingBufferSize(this.bufferSize);
    const w = Math.max(1, Math.round(size.x * MENU_BG_SCALE));
    const hgt = Math.max(1, Math.round(size.y * MENU_BG_SCALE));
    if (fx.target.width !== w || fx.target.height !== hgt) fx.target.setSize(w, hgt);
    (fx.material.uniforms.texel!.value as THREE.Vector2).set(1 / w, 1 / hgt);
    const chickens = [...this.party, this.showcase?.chicken, this.preview].filter((c): c is Chicken => !!c);
    // Their own layer (re-applied: a new hat or gun adds meshes), still lit by the world's lights and casting its shadows.
    for (const c of chickens) c.root.traverse((o) => o.layers.set(MENU_LAYER));
    if (this.menuLightsFor !== this.world) {
      this.menuLightsFor = this.world;
      this.menuHidden = [];
      this.scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (mat && !Array.isArray(mat) && /lamp[\\/]lamp_diffuse/i.test(mat.name)) this.menuHidden.push(o);
        const light = o as THREE.DirectionalLight;
        if (!light.isLight) return;
        light.layers.enable(MENU_LAYER);
        light.shadow?.camera.layers.enable(MENU_LAYER);
      });
    }
    for (const o of this.menuHidden) o.visible = false;
    r.setRenderTarget(fx.target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    for (const o of this.menuHidden) o.visible = true;
    r.render(fx.scene, fx.camera);
    // The shadow maps from the world pass are reused.
    const shadows = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    // (A colour background would clear the screen even with autoClear off.)
    const background = this.scene.background;
    this.scene.background = null;
    this.camera.layers.set(MENU_LAYER);
    r.autoClear = false;
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.autoClear = true;
    this.scene.background = background;
    this.camera.layers.set(0);
    r.shadowMap.autoUpdate = shadows;
  }

  private createMenuFx(): NonNullable<Game['menuFx']> {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: target.texture }, texel: { value: new THREE.Vector2(1, 1) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform vec2 texel;
        varying vec2 vUv;
        void main() {
          // A soft disc blur of the half-size world.
          vec3 c = vec3(0.0);
          float total = 0.0;
          for (int x = -2; x <= 2; x++) {
            for (int y = -2; y <= 2; y++) {
              float w = 1.0 / (1.0 + float(x * x + y * y));
              c += texture2D(map, vUv + vec2(float(x), float(y)) * texel * 1.4).rgb * w;
              total += w;
            }
          }
          c /= total;
          // Warm grade and a light vignette.
          c *= vec3(1.06, 1.0, 0.9);
          c *= 1.0 - smoothstep(0.38, 0.9, length((vUv - 0.5) * vec2(1.0, 0.8))) * 0.3;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    return { target, material, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }

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
