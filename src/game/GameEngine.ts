import * as THREE from "three";
import { loadAllGameAssets, LoadedAssets } from "../assets/AssetLoader";
import { createMaterialKit, MaterialKit } from "../assets/MaterialLibrary";
import {
  ArmoredRiderVisual,
  createArmoredRiderInstance,
  createPursuitHelicopterInstance,
  createSuperbikeInstance,
  createTrafficVehicleInstance,
  HelicopterVisual,
  prewarmVehicleTemplates,
  SuperbikeVisual,
  TrafficKind,
  TrafficVisual,
} from "../assets/RealisticModels";
import { loadSave, persistSave, QualityPreset, SaveData } from "../core/SaveState";
import { getBikeById, UpgradeKey } from "../data/bikes";
import { BOSS_BIOS, RIVALS, RivalProfile } from "../data/rivals";
import { getStageById, StageId, StageSpec } from "../data/stages";
import { WeaponId, WEAPONS } from "../data/weapons";
import { AudioEngine } from "../systems/AudioEngine";
import { CameraRig } from "../systems/CameraRig";
import { InputController } from "../systems/InputController";
import { QualityDiagnostics } from "../systems/QualityDiagnostics";
import { RenderPipeline } from "../systems/RenderPipeline";
import { PLAYABLE_HALF_WIDTH, SHOULDER_LIMIT, TrackSystem } from "../systems/TrackSystem";
import { VfxSystem } from "../systems/VfxSystem";

export type ScreenState = "hub" | "districts" | "hangar" | "racing" | "paused" | "results";

interface BikerSim {
  id: string;
  name: string;
  isPlayer: boolean;
  isCop: boolean;
  profile?: RivalProfile;
  s: number;
  laneX: number; // driver-centric lateral offset in meters: - = Left, + = Right
  yOffset: number;
  vy: number;
  vx: number; // lateral velocity in driver-centric coords (+ = Rightward)
  speed: number;
  lean: number; // roll angle rad (+ = lean Right, - = lean Left)
  pitchOffset: number; // suspension squat/dive pitch
  stamina: number;
  maxStamina: number;
  armor: number;
  maxArmor: number;
  weapon: WeaponId;
  attackCooldown: number;
  attackTimer: number;
  attackSide: -1 | 0 | 1; // -1 = Left, +1 = Right
  attackType: "melee" | "kick";
  attackHitDone: boolean;
  crashed: boolean;
  crashTimer: number;
  crashDir: number;
  finished: boolean;
  finishTime: number;
  visual: SuperbikeVisual;
  rider: ArmoredRiderVisual;
  targetLaneX: number;
  laneTimer: number;
  lastHitByPlayerTimer: number;
}

const LANE_CENTERS = [-4.8, -1.95, 1.95, 4.8] as const;
const LANE_SPEEDS = [-27, -22, 28, 22] as const;

interface TrafficSim {
  id: number;
  kind: TrafficKind;
  halfWidth: number;
  halfLength: number;
  s: number;
  distRolled: number;
  laneX: number; // - = Left, + = Right
  homeLaneX: number;
  latVel: number;
  yawWobble: number;
  pitchAngle: number;
  rollAngle: number;
  brakeTimer: number;
  hazardTimer: number;
  slammedByPlayer: boolean;
  slammedByPlayerTimer: number;
  speed: number;
  desiredSpeed: number;
  oncoming: boolean;
  roadblock: boolean;
  nearMissed: boolean;
  hp: number;
  disabledTimer: number;
  visual: TrafficVisual;
}

export interface TargetReticle {
  id: string;
  name: string;
  xPct: number;
  yPct: number;
  staminaNorm: number;
  isCop: boolean;
  threatening: boolean;
}

export interface CommsMessage {
  name: string;
  title: string;
  portraitUrl: string;
  text: string;
}

export interface RaceResultSummary {
  outcome: "finished" | "wrecked" | "busted";
  rank: number;
  totalRacers: number;
  raceTimeSec: number;
  stagePrize: number;
  takedowns: number;
  takedownBonus: number;
  nearMisses: number;
  stuntBonus: number;
  totalCash: number;
  bossName: string;
  bossPortrait: string;
  bossQuote: string;
}

export interface UiSnapshot {
  screen: ScreenState;
  save: SaveData;
  stage: StageSpec;
  speedMph: number;
  gear: number;
  rpmNorm: number;
  rank: number;
  totalRacers: number;
  progress: number;
  staminaNorm: number;
  armorNorm: number;
  nitroNorm: number;
  focusNorm: number;
  empNorm: number;
  focusActive: boolean;
  nitroActive: boolean;
  weapon: WeaponId;
  wantedHeat: number;
  multiplier: number;
  nearMissCount: number;
  knockoutCount: number;
  raceCashEarned: number;
  crashed: boolean;
  countdownText: string;
  bannerText: string;
  comms: CommsMessage | null;
  results: RaceResultSummary | null;
  radarDots: Array<{ dx: number; dz: number; kind: "rival" | "cop" | "traffic" }>;
  targetReticles: TargetReticle[];
}

const MPS_TO_MPH = 2.23694;

export class GameEngine {
  public save: SaveData;
  public screen: ScreenState = "hub";

  private readonly pipeline: RenderPipeline;
  private assets!: LoadedAssets;
  private kit!: MaterialKit;
  private track!: TrackSystem;
  private vfx!: VfxSystem;
  private readonly cameraRig: CameraRig;
  public readonly audio: AudioEngine;
  public readonly input: InputController;
  private readonly diagnostics: QualityDiagnostics;

  private hangarGroup = new THREE.Group();
  private hangarBike: SuperbikeVisual | null = null;
  private hangarRider: ArmoredRiderVisual | null = null;
  private hangarDragDelta = 0;

  private raceGroup = new THREE.Group();
  private player!: BikerSim;
  private racers: BikerSim[] = [];
  private traffic: TrafficSim[] = [];
  private helicopter: HelicopterVisual | null = null;
  private activeStage: StageSpec = getStageById("vice");

  private nitro = 100;
  private maxNitro = 100;
  private focus = 100;
  private maxFocus = 100;
  private wantedHeat = 1;
  private multiplier = 1.0;
  private multiplierTimer = 0;
  private nearMissCount = 0;
  private knockoutCount = 0;
  private raceCashEarned = 0;
  private countdownTimer = 0;
  private raceClock = 0;
  private hitstopTimer = 0;
  private takedownSlowMo = 0;
  private damageFlash = 0;
  private lastPlayerScreenXPct = 50;
  private bannerText = "";
  private bannerTimer = 0;
  private comms: CommsMessage | null = null;
  private commsTimer = 0;
  private results: RaceResultSummary | null = null;
  private nextRoadblockS = 950;
  private nextInterceptorCheckS = 600;
  private totalElapsed = 0;
  private lastTimeMs = performance.now();
  private rafId = 0;
  private initialized = false;

  // Catastrophic Ragdoll Ejection & Crash Choreography state
  private ragdollGroup: THREE.Group | null = null;
  private ragdollActive = false;
  private ragdollPos = new THREE.Vector3();
  private ragdollVel = new THREE.Vector3();
  private ragdollSpin = new THREE.Vector3();
  private ragdollElapsed = 0;
  private bikeSpinYaw = 0;
  private bikeSpinRate = 0;
  private postCrashGhostTimer = 0;
  private barWobbleTimer = 0;
  private wreckFocusTimer = 0;
  private crashSeed = 1;
  private lastFocusActive = false;
  private lastOverlapCount = 0;
  private crashBlockedCar: TrafficSim | null = null;

  private tmpProj = new THREE.Vector3();
  private onUiUpdate: (snap: UiSnapshot) => void;

  constructor(canvas: HTMLCanvasElement, onUiUpdate: (snap: UiSnapshot) => void) {
    this.save = loadSave();
    this.onUiUpdate = onUiUpdate;

    this.pipeline = new RenderPipeline(canvas, this.save.settings.quality);
    this.cameraRig = new CameraRig();
    this.audio = new AudioEngine();
    this.audio.setVolumes(this.save.settings.musicVolume, this.save.settings.sfxVolume, this.save.settings.muted);

    this.input = new InputController(() => this.audio.unlock());
    this.diagnostics = new QualityDiagnostics();

    this.pipeline.scene.add(this.hangarGroup);
    this.pipeline.scene.add(this.raceGroup);

    const onResize = () => {
      this.pipeline.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    onResize();
  }

  public async init(): Promise<void> {
    if (this.initialized) return;

    const loadFill = document.getElementById("loadingProgressBar");
    const loadLabel = document.getElementById("loadingLabel");
    const loadOverlay = document.getElementById("loadingOverlay");

    this.assets = await loadAllGameAssets(this.pipeline.renderer, (pct, msg) => {
      if (loadFill) loadFill.style.width = `${pct}%`;
      if (loadLabel) loadLabel.textContent = `${pct}% // ${msg.toUpperCase()}`;
    });

    this.pipeline.setAssets(this.assets);
    this.kit = createMaterialKit(this.assets, this.pipeline.getMaxAnisotropy());
    this.track = new TrackSystem(this.kit, this.assets);
    this.vfx = new VfxSystem(this.kit, this.assets);
    if (loadLabel) loadLabel.textContent = "99% // COMPILING VEHICLE LODS & AUDIO...";
    await new Promise((r) => setTimeout(r, 16));
    prewarmVehicleTemplates(this.assets);
    await this.audio.preload();

    this.raceGroup.add(this.track.group);
    this.raceGroup.add(this.vfx.group);

    // Warm up race GLSL shaders & GPU texture uploads behind the loading overlay so frame 1 of DEPLOY runs at 60 FPS!
    if (loadLabel) loadLabel.textContent = "99% // UPLOADING GPU SHADERS...";
    await new Promise((r) => setTimeout(r, 16));
    const warmupGroup = new THREE.Group();
    const warmupKinds: TrafficKind[] = ["sedan", "muscle", "exotic", "truck", "police"];
    warmupKinds.forEach((k, idx) => {
      const v = createTrafficVehicleInstance(this.assets, this.kit, k, idx);
      v.root.position.set(idx * 4 - 8, 0, 18);
      warmupGroup.add(v.root);
    });
    const warmupHeli = createPursuitHelicopterInstance(this.assets);
    warmupHeli.root.position.set(0, 16, 26);
    warmupGroup.add(warmupHeli.root);
    this.raceGroup.add(warmupGroup);

    this.pipeline.applyStageAtmosphere(this.activeStage);
    this.track.configureStage(this.activeStage);
    this.track.update(20, 0);
    this.raceGroup.visible = true;
    this.hangarGroup.visible = false;
    this.pipeline.renderer.compile(this.pipeline.scene, this.pipeline.camera);
    this.pipeline.render();
    this.raceGroup.remove(warmupGroup);

    this.buildHangarShowroom();
    this.enterHangarScene(this.save.selectedStageId);
    this.registerDebugApi();

    this.initialized = true;
    if (loadOverlay) {
      loadOverlay.classList.add("fade-out");
      setTimeout(() => {
        loadOverlay.hidden = true;
      }, 320);
    }
  }

  private buildHangarShowroom(): void {
    // Photorealistic showroom turntable on wet scanned asphalt + outer brushed concrete pad
    const hubDisk = new THREE.Mesh(new THREE.CircleGeometry(6.2, 48), this.kit.wetAsphaltMat);
    hubDisk.rotation.x = -Math.PI / 2;
    hubDisk.receiveShadow = true;
    this.hangarGroup.add(hubDisk);

    const outerPad = new THREE.Mesh(new THREE.RingGeometry(6.2, 32, 48), this.kit.shoulderGroundMat);
    outerPad.rotation.x = -Math.PI / 2;
    outerPad.position.y = -0.02;
    outerPad.receiveShadow = true;
    this.hangarGroup.add(outerPad);

    const ringBorder = new THREE.Mesh(new THREE.RingGeometry(6.15, 6.26, 48), this.kit.darkAlloyMat);
    ringBorder.rotation.x = -Math.PI / 2;
    ringBorder.position.y = 0.015;
    this.hangarGroup.add(ringBorder);

    this.rebuildHangarBike();
  }

  public rebuildHangarBike(): void {
    if (!this.assets || !this.kit) return;
    if (this.hangarBike) this.hangarGroup.remove(this.hangarBike.root);

    const spec = getBikeById(this.save.selectedBikeId);
    const pHex = this.save.customPrimaryHex ?? spec.primaryHex;
    const aHex = this.save.customAccentHex ?? spec.accentHex;

    this.hangarBike = createSuperbikeInstance(this.assets, this.kit, spec, pHex, aHex, true);
    this.hangarRider = createArmoredRiderInstance(this.assets, 0x181c26, aHex, "katana", true);
    this.hangarRider.updatePose(0, 0.15, 0, 0, "melee", 0);
    this.hangarBike.chassisPivot.add(this.hangarRider.root);
    this.hangarBike.root.position.set(0, 0, 0);
    this.hangarGroup.add(this.hangarBike.root);
  }

  public orbitHangar(dx: number): void {
    this.hangarDragDelta += dx;
  }

  private enterHangarScene(stageId: StageId): void {
    if (!this.initialized && !this.assets) return;
    if (this.ragdollGroup) {
      this.pipeline.scene.remove(this.ragdollGroup);
      this.ragdollGroup = null;
    }
    this.ragdollActive = false;
    this.activeStage = getStageById(stageId);
    this.hangarGroup.visible = true;
    this.raceGroup.visible = false;
    this.pipeline.applyHangarAtmosphere();
    this.kit.wetAsphaltUniforms.uWetness.value = 0.65;
    this.rebuildHangarBike();
    this.audio.stopMusic();
    this.audio.updateTelemetry(false, 0, false, 0, 0);
  }

  public setScreen(next: ScreenState): void {
    this.screen = next;
    if (next === "hub" || next === "districts" || next === "hangar") {
      this.enterHangarScene(this.save.selectedStageId);
    }
    this.emitSnapshot();
  }

  public selectStage(id: StageId): void {
    this.save.selectedStageId = id;
    this.activeStage = getStageById(id);
    persistSave(this.save);
    this.emitSnapshot();
  }

  public setPaintColors(primaryHex: number | null, accentHex: number | null): void {
    this.save.customPrimaryHex = primaryHex;
    this.save.customAccentHex = accentHex;
    persistSave(this.save);
    this.rebuildHangarBike();
    if (this.hangarBike) {
      const spec = getBikeById(this.save.selectedBikeId);
      this.hangarBike.setPaintColors(primaryHex ?? spec.primaryHex, accentHex ?? spec.accentHex);
    }
    this.emitSnapshot();
  }

  public buyOrSelectBike(bikeId: string): boolean {
    const spec = getBikeById(bikeId);
    if (this.save.ownedBikes.includes(bikeId)) {
      this.save.selectedBikeId = bikeId;
      this.save.customPrimaryHex = null;
      this.save.customAccentHex = null;
      persistSave(this.save);
      this.rebuildHangarBike();
      this.audio.playTone(620, 0.14, 0.25);
      this.emitSnapshot();
      return true;
    }
    if (this.save.cash >= spec.price) {
      this.save.cash -= spec.price;
      this.save.ownedBikes.push(bikeId);
      this.save.selectedBikeId = bikeId;
      this.save.customPrimaryHex = null;
      this.save.customAccentHex = null;
      persistSave(this.save);
      this.rebuildHangarBike();
      this.audio.playTone(880, 0.2, 0.3);
      this.emitSnapshot();
      return true;
    }
    this.audio.playTone(180, 0.14, 0.2);
    return false;
  }

  public buyUpgrade(key: UpgradeKey, cost: number): boolean {
    const cur = this.save.upgrades[key] || 0;
    if (cur >= 4 || this.save.cash < cost) {
      this.audio.playTone(180, 0.12, 0.2);
      return false;
    }
    this.save.cash -= cost;
    this.save.upgrades[key] = cur + 1;
    persistSave(this.save);
    this.audio.playTone(760, 0.16, 0.28);
    this.emitSnapshot();
    return true;
  }

  public setQualityPreset(preset: QualityPreset): void {
    this.save.settings.quality = preset;
    persistSave(this.save);
    this.pipeline.setQuality(preset);
    this.emitSnapshot();
  }

  public updateAudioSettings(music: number, sfx: number, muted: boolean): void {
    this.save.settings.musicVolume = music;
    this.save.settings.sfxVolume = sfx;
    this.save.settings.muted = muted;
    persistSave(this.save);
    this.audio.setVolumes(music, sfx, muted);
    this.emitSnapshot();
  }

  public startRace(stageId?: StageId, skipCountdown = false): void {
    if (!this.initialized) return;
    if (stageId) {
      this.save.selectedStageId = stageId;
      persistSave(this.save);
    }
    this.audio.unlock();
    this.activeStage = getStageById(this.save.selectedStageId);
    this.hangarGroup.visible = false;
    this.raceGroup.visible = true;
    this.pipeline.applyStageAtmosphere(this.activeStage);
    this.track.configureStage(this.activeStage);

    if (this.ragdollGroup) {
      this.pipeline.scene.remove(this.ragdollGroup);
      this.ragdollGroup = null;
    }
    this.ragdollActive = false;
    this.bikeSpinYaw = 0;
    this.bikeSpinRate = 0;
    this.postCrashGhostTimer = 0;
    this.barWobbleTimer = 0;
    this.wreckFocusTimer = 0;

    for (const r of this.racers) this.raceGroup.remove(r.visual.root);
    for (const t of this.traffic) this.raceGroup.remove(t.visual.root);
    if (this.helicopter) this.raceGroup.remove(this.helicopter.root);
    this.racers = [];
    this.traffic = [];
    this.helicopter = null;

    const bikeSpec = getBikeById(this.save.selectedBikeId);
    const armorBonus = (this.save.upgrades.chassis || 0) * 16;
    const capMul = 1 + (this.save.upgrades.capacitor || 0) * 0.22;
    const primary = this.save.customPrimaryHex ?? bikeSpec.primaryHex;
    const accent = this.save.customAccentHex ?? bikeSpec.accentHex;

    const pBike = createSuperbikeInstance(this.assets, this.kit, bikeSpec, primary, accent, true);
    const pRider = createArmoredRiderInstance(this.assets, 0x2b3140, accent, "knuckle", true);
    pBike.chassisPivot.add(pRider.root);
    this.raceGroup.add(pBike.root);

    this.player = {
      id: "player",
      name: "YOU",
      isPlayer: true,
      isCop: false,
      s: 12,
      laneX: 2.1,
      yOffset: 0,
      vy: 0,
      vx: 0,
      speed: 0,
      lean: 0,
      pitchOffset: 0,
      stamina: 100,
      maxStamina: 100,
      armor: bikeSpec.armor + armorBonus,
      maxArmor: bikeSpec.armor + armorBonus,
      weapon: "knuckle",
      attackCooldown: 0,
      attackTimer: 0,
      attackSide: 0,
      attackType: "melee",
      attackHitDone: false,
      crashed: false,
      crashTimer: 0,
      crashDir: 1,
      finished: false,
      finishTime: 0,
      visual: pBike,
      rider: pRider,
      targetLaneX: 2.1,
      laneTimer: 0,
      lastHitByPlayerTimer: 0,
    };
    this.racers.push(this.player);

    // 7 Rival Street Riders in combat pack ahead
    RIVALS.slice(0, 7).forEach((profile, idx) => {
      const rBike = createSuperbikeInstance(
        this.assets,
        this.kit,
        bikeSpec,
        profile.bikeColor,
        profile.accentColor,
        false
      );
      const rRider = createArmoredRiderInstance(this.assets, profile.jacketColor, profile.accentColor, profile.weapon);
      rBike.chassisPivot.add(rRider.root);
      this.raceGroup.add(rBike.root);

      const lane = ((idx % 4) - 1.5) * 2.8;
      const startS = 18 + Math.floor(idx / 3) * 7 + (idx % 3) * 2.0;
      this.racers.push({
        id: profile.id,
        name: profile.name,
        isPlayer: false,
        isCop: false,
        profile,
        s: startS,
        laneX: lane,
        yOffset: 0,
        vy: 0,
        vx: 0,
        speed: 0,
        lean: 0,
        pitchOffset: 0,
        stamina: 95 + this.activeStage.difficulty * 8,
        maxStamina: 95 + this.activeStage.difficulty * 8,
        armor: 120,
        maxArmor: 120,
        weapon: profile.weapon,
        attackCooldown: 0.4,
        attackTimer: 0,
        attackSide: 0,
        attackType: "melee",
        attackHitDone: false,
        crashed: false,
        crashTimer: 0,
        crashDir: 1,
        finished: false,
        finishTime: 0,
        visual: rBike,
        rider: rRider,
        targetLaneX: lane,
        laneTimer: 1 + idx * 0.25,
        lastHitByPlayerTimer: 0,
      });
    });

    // Diverse Real Car Traffic Pool distributed across 4 separated highway lanes
    const kinds: TrafficKind[] = ["sedan", "muscle", "exotic", "truck", "sedan", "muscle", "exotic"];
    const poolCount = Math.min(7, Math.max(6, this.activeStage.trafficDensity));
    for (let i = 0; i < poolCount; i++) {
      const kind = kinds[i % kinds.length];
      const vis = createTrafficVehicleInstance(this.assets, this.kit, kind, i);
      this.raceGroup.add(vis.root);
      const laneSlot = i % 4;
      const oncoming = laneSlot < 2;
      const laneX = LANE_CENTERS[laneSlot];
      const desiredSpeed = LANE_SPEEDS[laneSlot] + (oncoming ? -(i % 3) : (i % 3) * 1.5);
      this.traffic.push({
        id: i,
        kind,
        halfWidth: kind === "truck" ? 1.15 : kind === "muscle" ? 0.96 : 1.02,
        halfLength: kind === "truck" ? 3.1 : kind === "muscle" ? 2.18 : 2.34,
        s: 115 + i * 52,
        distRolled: 0,
        laneX,
        homeLaneX: laneX,
        latVel: 0,
        yawWobble: 0,
        pitchAngle: 0,
        rollAngle: 0,
        brakeTimer: 0,
        hazardTimer: 0,
        slammedByPlayer: false,
        slammedByPlayerTimer: 0,
        speed: desiredSpeed,
        desiredSpeed,
        oncoming,
        roadblock: false,
        nearMissed: false,
        hp: 100,
        disabledTimer: 0,
        visual: vis,
      });
    }

    // Active Highway Patrol Pursuit Helicopter
    this.helicopter = createPursuitHelicopterInstance(this.assets);
    this.helicopter.root.visible = this.activeStage.hasHelicopter;
    this.raceGroup.add(this.helicopter.root);

    this.maxNitro = bikeSpec.nitroCapacity * capMul;
    this.nitro = this.maxNitro;
    this.maxFocus = 100 * capMul;
    this.focus = this.maxFocus;
    this.wantedHeat = this.activeStage.id === "sanverona" ? 3 : 1;
    this.multiplier = 1.0;
    this.multiplierTimer = 0;
    this.nearMissCount = 0;
    this.knockoutCount = 0;
    this.raceCashEarned = 0;
    this.countdownTimer = skipCountdown ? 0 : 1.9;
    this.raceClock = 0;
    this.hitstopTimer = 0;
    this.takedownSlowMo = 0;
    this.damageFlash = 0;
    this.lastFocusActive = false;
    this.lastOverlapCount = 0;
    this.crashBlockedCar = null;
    this.nextRoadblockS = 950;
    this.nextInterceptorCheckS = 600;
    this.results = null;
    this.bannerText = this.activeStage.name;
    this.bannerTimer = 2.2;
    this.input.clearFocus();

    const boss = BOSS_BIOS[this.activeStage.bossId];
    this.pushComms(boss.name, boss.title, boss.portraitUrl, boss.quote);

    const pWorld = this.track.toWorld(this.player.s, this.player.laneX);
    const aheadWorld = this.track.toWorld(this.player.s + 24, this.player.laneX);
    this.cameraRig.reset(pWorld.yaw, pWorld.y);
    this.track.update(this.player.s, 0);
    this.syncVisuals(0.016, false, false);
    this.vfx.update(0.016, pWorld.x, pWorld.y, pWorld.z, 0, this.activeStage.hasRain);
    this.pipeline.syncFollowRig(pWorld.x, pWorld.y, pWorld.z);
    this.cameraRig.updateRace(
      this.pipeline.camera,
      0.016,
      pWorld.x,
      pWorld.y,
      pWorld.z,
      pWorld.yaw,
      0,
      aheadWorld.x,
      aheadWorld.y,
      aheadWorld.z,
      0,
      false,
      false,
      0,
      this.save.settings.cameraMode,
      0
    );

    this.screen = "racing";
    this.audio.startMusic(this.activeStage.musicRootHz, this.activeStage.musicBpm, this.activeStage.biome);
    this.emitSnapshot();
  }

  public cycleRadioStation(): string {
    const station = this.audio.cycleRadioStation();
    this.showBanner(`RADIO: ${station}`, 1.6);
    this.audio.playTone(720, 0.08, 0.16);
    return station;
  }

  public resumeRace(): void {
    if (this.screen === "paused") {
      this.screen = "racing";
      this.emitSnapshot();
    }
  }

  public togglePause(): void {
    if (this.screen === "racing") {
      this.screen = "paused";
      this.audio.updateTelemetry(false, 0, false, 0, 0);
      this.emitSnapshot();
    } else if (this.screen === "paused") {
      this.screen = "racing";
      this.emitSnapshot();
    }
  }

  private pushComms(name: string, title: string, portraitUrl: string, text: string): void {
    this.comms = { name, title, portraitUrl, text };
    this.commsTimer = 4.2;
  }

  private showBanner(text: string, dur = 1.8): void {
    this.bannerText = text;
    this.bannerTimer = dur;
  }

  private spawnPoliceInterceptor(aheadS: number): void {
    const activeInterceptors = this.traffic.filter((t) => t.kind === "police" && t.disabledTimer <= 0).length;
    if (activeInterceptors >= 1) return;

    const vis = createTrafficVehicleInstance(this.assets, this.kit, "police", 0);
    this.raceGroup.add(vis.root);
    const outLane = this.player.laneX > 3.0 ? 1.95 : 4.8;
    let spawnS = Math.max(20, this.player.s + aheadS);
    while (this.traffic.some((o) => o.disabledTimer <= 0 && Math.abs(o.s - spawnS) < 16 && Math.abs(o.laneX - outLane) < 2.6)) {
      spawnS += 18;
    }
    const initSpeed = Math.max(46, this.player.speed * 0.96);
    this.traffic.push({
      id: 9000 + Math.round(aheadS),
      kind: "police",
      halfWidth: 1.04,
      halfLength: 2.32,
      s: spawnS,
      distRolled: 0,
      laneX: outLane,
      homeLaneX: outLane,
      latVel: 0,
      yawWobble: 0,
      pitchAngle: 0,
      rollAngle: 0,
      brakeTimer: 0,
      hazardTimer: 0,
      slammedByPlayer: false,
      slammedByPlayerTimer: 0,
      speed: initSpeed,
      desiredSpeed: initSpeed,
      oncoming: false,
      roadblock: false,
      nearMissed: false,
      hp: 100,
      disabledTimer: 0,
      visual: vis,
    });
  }

  private spawnCopUnit(aheadS: number): void {
    const existingCops = this.racers.filter((r) => r.isCop).length;
    if (existingCops >= 2) return;

    const bikeSpec = getBikeById("goliath_800");
    const bike = createSuperbikeInstance(this.assets, this.kit, bikeSpec, 0x0f172a, 0x00a6ff, false);
    const rider = createArmoredRiderInstance(this.assets, 0x0f172a, 0x00a6ff, "baton");
    bike.chassisPivot.add(rider.root);
    this.raceGroup.add(bike.root);

    const lane = existingCops === 0 ? -3.2 : 3.2;
    this.racers.push({
      id: `cop_${Date.now()}_${existingCops}`,
      name: `UNIT-0${existingCops + 1}`,
      isPlayer: false,
      isCop: true,
      s: Math.max(20, this.player.s + aheadS),
      laneX: lane,
      yOffset: 0,
      vy: 0,
      vx: 0,
      speed: Math.max(48, this.player.speed * 0.92),
      lean: 0,
      pitchOffset: 0,
      stamina: 135,
      maxStamina: 135,
      armor: 150,
      maxArmor: 150,
      weapon: "baton",
      attackCooldown: 0.5,
      attackTimer: 0,
      attackSide: 0,
      attackType: "melee",
      attackHitDone: false,
      crashed: false,
      crashTimer: 0,
      crashDir: 1,
      finished: false,
      finishTime: 0,
      visual: bike,
      rider,
      targetLaneX: lane,
      laneTimer: 0.7,
      lastHitByPlayerTimer: 0,
    });
  }

  private spawnSwatRoadblock(sPos: number): void {
    const visL = createTrafficVehicleInstance(this.assets, this.kit, "police", 0);
    const visR = createTrafficVehicleInstance(this.assets, this.kit, "police", 1);
    this.raceGroup.add(visL.root, visR.root);

    const cars: TrafficSim[] = [
      {
        id: 1000 + Math.round(sPos),
        kind: "police",
        halfWidth: 2.2,
        halfLength: 1.05,
        s: sPos,
        distRolled: 0,
        laneX: -4.2,
        homeLaneX: -4.2,
        latVel: 0,
        yawWobble: 0,
        pitchAngle: 0,
        rollAngle: 0,
        brakeTimer: 0,
        hazardTimer: 0,
        slammedByPlayer: false,
        slammedByPlayerTimer: 0,
        speed: 0,
        desiredSpeed: 0,
        oncoming: false,
        roadblock: true,
        nearMissed: false,
        hp: 100,
        disabledTimer: 0,
        visual: visL,
      },
      {
        id: 2000 + Math.round(sPos),
        kind: "police",
        halfWidth: 2.2,
        halfLength: 1.05,
        s: sPos,
        distRolled: 0,
        laneX: 5.1,
        homeLaneX: 5.1,
        latVel: 0,
        yawWobble: 0,
        pitchAngle: 0,
        rollAngle: 0,
        brakeTimer: 0,
        hazardTimer: 0,
        slammedByPlayer: false,
        slammedByPlayerTimer: 0,
        speed: 0,
        desiredSpeed: 0,
        oncoming: false,
        roadblock: true,
        nearMissed: false,
        hp: 100,
        disabledTimer: 0,
        visual: visR,
      },
    ];
    for (const c of cars) this.traffic.push(c);
    const cross = BOSS_BIOS.cross;
    this.pushComms(cross.name, cross.title, cross.portraitUrl, "Patrol barricade deployed ahead! Watch the center gap!");
  }

  private knockoutRacer(target: BikerSim, dir: number): void {
    target.crashed = true;
    target.crashTimer = target.isCop ? 4.5 : 3.0;
    target.crashDir = dir || 1;
    target.speed *= 0.28;
    target.stamina = target.maxStamina;
    this.knockoutCount++;
    const bonus = target.isCop ? 750 : 450;
    this.raceCashEarned += bonus;
    this.multiplier = Math.min(10, Number((this.multiplier + 0.5).toFixed(1)));
    this.multiplierTimer = 5.0;
    this.wantedHeat = Math.min(5, Math.max(this.wantedHeat, target.isCop ? 4 : 2));
    this.hitstopTimer = 0.04;
    this.takedownSlowMo = 0.28;
    this.cameraRig.addTrauma(0.55);

    const wp = this.track.toWorld(target.s, target.laneX);
    this.vfx.spawnBurst(wp.x, wp.y + 0.4, wp.z, 0xffaa00, 26, 12, 1.05);
    this.vfx.spawnSmoke(wp.x, wp.y + 0.4, wp.z, 5, 1.3);
    this.audio.playCrash();

    if (target.profile) {
      this.player.weapon = target.weapon;
      this.showBanner(`TAKEDOWN: ${target.profile.name.toUpperCase()}! +$${bonus}`, 2.1);
      this.pushComms(target.profile.name.toUpperCase(), target.profile.role, target.profile.portraitUrl, target.profile.taunt);
    } else {
      this.showBanner(`PURSUIT UNIT DOWNED! +$${bonus}`, 2.1);
    }
  }

  public start(): void {
    this.lastTimeMs = performance.now();
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      const wallDt = Math.max(0.001, (now - this.lastTimeMs) / 1000);
      const rawDt = Math.min(0.05, wallDt);
      this.lastTimeMs = now;
      this.step(rawDt, wallDt);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  private step(rawDt: number, wallDt = rawDt): void {
    if (!this.initialized) return;
    this.totalElapsed += rawDt;

    if (this.bannerTimer > 0) this.bannerTimer = Math.max(0, this.bannerTimer - rawDt);
    if (this.commsTimer > 0) {
      this.commsTimer = Math.max(0, this.commsTimer - rawDt);
      if (this.commsTimer <= 0) this.comms = null;
    }
    this.damageFlash = Math.max(0, this.damageFlash - rawDt * 2.8);
    if (this.takedownSlowMo > 0) this.takedownSlowMo = Math.max(0, this.takedownSlowMo - rawDt);

    if (this.screen === "hub" || this.screen === "districts" || this.screen === "hangar") {
      const origin = new THREE.Vector3(0, 0, 0);
      this.cameraRig.updateHangar(this.pipeline.camera, origin, rawDt, this.hangarDragDelta, this.screen === "hangar");
      this.hangarDragDelta = 0;
      this.pipeline.updatePostFX(0.12, 0, 0);
      this.pipeline.render();
      this.diagnostics.update(rawDt, this.pipeline.renderer, {
        title: "REDLINE SYNDICATE",
        state: this.screen,
        quality: this.save.settings.quality,
        stageId: this.activeStage.id,
        speedMph: 0,
        distanceMeters: 0,
        laneOffset: 0,
        playerScreenXPct: 50,
        rank: 1,
        wantedHeat: 0,
        stamina: 100,
        armor: 100,
        cash: this.save.cash,
      });
      return;
    }

    if (this.screen === "racing") {
      const intent = this.input.sample();
      if (intent.pausePressed) {
        this.togglePause();
        return;
      }
      if (intent.cameraPressed) {
        this.save.settings.cameraMode = (this.save.settings.cameraMode + 1) % 3;
        persistSave(this.save);
        const labels = ["CAMERA: STREET CHASE", "CAMERA: CLOSE CHASE", "CAMERA: RIDER POV"];
        this.showBanner(labels[this.save.settings.cameraMode], 1.1);
      }
      if (intent.radioPressed) {
        this.cycleRadioStation();
      }

      const focusActive = intent.bulletTime && this.focus > 4 && this.countdownTimer <= 0 && !this.player.crashed;
      this.lastFocusActive = focusActive;
      if (focusActive) {
        this.focus = Math.max(0, this.focus - rawDt * 24);
        if (this.focus <= 0) this.input.clearFocus();
      } else {
        const capMul = 1 + (this.save.upgrades.capacitor || 0) * 0.22;
        this.focus = Math.min(this.maxFocus, this.focus + rawDt * 7 * capMul);
      }

      if (this.hitstopTimer > 0) this.hitstopTimer = 0;

      const simScale = focusActive ? 0.42 : this.takedownSlowMo > 0 ? 0.48 : 1.0;
      const simDt = rawDt * simScale;
      this.stepRace(simDt, rawDt, wallDt, intent, focusActive);

      const pW = this.track.toWorld(this.player.s, this.player.laneX);
      this.tmpProj.set(pW.x, pW.y + 0.65, pW.z).project(this.pipeline.camera);
      this.lastPlayerScreenXPct = Number(((this.tmpProj.x * 0.5 + 0.5) * 100).toFixed(2));
    }

    const speedMph = this.player ? this.player.speed * MPS_TO_MPH : 0;
    const isFocus = this.screen === "racing" && this.lastFocusActive;
    this.pipeline.updatePostFX(Math.min(1, speedMph / 245), isFocus ? 1.0 : 0.0, this.damageFlash);
    this.pipeline.render();

    this.diagnostics.update(rawDt, this.pipeline.renderer, {
      title: "REDLINE SYNDICATE",
      state: this.screen,
      quality: this.save.settings.quality,
      stageId: this.activeStage.id,
      speedMph: Math.round(speedMph),
      distanceMeters: Math.round(this.player ? this.player.s : 0),
      laneOffset: this.player ? Number(this.player.laneX.toFixed(3)) : 0,
      playerScreenXPct: this.lastPlayerScreenXPct,
      rank: this.computePlayerRank(),
      wantedHeat: this.wantedHeat,
      stamina: Math.round(this.player ? this.player.stamina : 100),
      armor: Math.round(this.player ? this.player.armor : 100),
      cash: this.save.cash,
      ragdollActive: this.ragdollActive,
      overlappingTrafficPairs: this.lastOverlapCount,
      bannerText: this.bannerTimer > 0 ? this.bannerText : "",
      activeTrafficKinds: Array.from(new Set(this.traffic.filter((t) => t.disabledTimer <= 0).map((t) => t.kind))),
      audioDiagnostics: this.audio.getDiagnostics(),
    });

    this.emitSnapshot();
  }

  private stepRace(
    dt: number,
    rawDt: number,
    wallDt: number,
    intent: ReturnType<InputController["sample"]>,
    focusActive: boolean
  ): void {
    const prevCount = Math.ceil(this.countdownTimer);
    if (this.countdownTimer > 0) {
      this.countdownTimer = Math.max(0, this.countdownTimer - Math.min(0.4, wallDt));
      const nextCount = Math.ceil(this.countdownTimer);
      if (nextCount !== prevCount && nextCount >= 1) {
        this.audio.playTone(440, 0.14, 0.28);
      } else if (this.countdownTimer <= 0 && prevCount > 0) {
        this.audio.playTone(880, 0.24, 0.35);
        this.showBanner("GO! SPLIT THE LANES!", 1.4);
      }
      const pWorld = this.track.toWorld(this.player.s, this.player.laneX);
      const aheadWorld = this.track.toWorld(this.player.s + 24, this.player.laneX);
      this.track.update(this.player.s, this.totalElapsed);
      this.syncVisuals(rawDt, false, false);
      this.vfx.update(rawDt, pWorld.x, pWorld.y, pWorld.z, 0, this.activeStage.hasRain);
      this.pipeline.syncFollowRig(pWorld.x, pWorld.y, pWorld.z);
      this.cameraRig.updateRace(
        this.pipeline.camera,
        rawDt,
        pWorld.x,
        pWorld.y,
        pWorld.z,
        pWorld.yaw,
        0,
        aheadWorld.x,
        aheadWorld.y,
        aheadWorld.z,
        0,
        false,
        false,
        0,
        this.save.settings.cameraMode,
        this.totalElapsed
      );
      return;
    }

    this.raceClock += dt;

    if (this.multiplierTimer > 0) {
      this.multiplierTimer -= dt;
      if (this.multiplierTimer <= 0) this.multiplier = 1.0;
    }

    const bikeSpec = getBikeById(this.save.selectedBikeId);
    const turbineMul = 1 + (this.save.upgrades.turbine || 0) * 0.07;
    const gripMul = 1 + (this.save.upgrades.grip || 0) * 0.09;
    const capMul = 1 + (this.save.upgrades.capacitor || 0) * 0.22;

    if (this.postCrashGhostTimer > 0) this.postCrashGhostTimer = Math.max(0, this.postCrashGhostTimer - rawDt);
    if (this.barWobbleTimer > 0) this.barWobbleTimer = Math.max(0, this.barWobbleTimer - rawDt);
    if (this.wreckFocusTimer > 0) this.wreckFocusTimer = Math.max(0, this.wreckFocusTimer - rawDt);

    const p = this.player;
    const baseMaxMps = bikeSpec.topSpeedMph * turbineMul * 0.44704;
    const nitroActive = intent.nitro && this.nitro > 1 && !p.crashed && (intent.throttle || p.speed > 18);
    if (nitroActive) {
      this.nitro = Math.max(0, this.nitro - rawDt * 22);
    } else {
      this.nitro = Math.min(this.maxNitro, this.nitro + rawDt * 5.5 * capMul);
    }

    const trackPt = this.track.sample(p.s);
    const maxSpeed = nitroActive ? baseMaxMps * 1.24 : baseMaxMps;
    if (p.crashed) {
      p.crashTimer -= rawDt;
      p.speed = Math.max(0, p.speed - 28 * dt);
      p.laneX = Math.max(-SHOULDER_LIMIT, Math.min(SHOULDER_LIMIT, p.laneX + p.vx * dt));
      p.vx *= Math.exp(-3.0 * dt);
      p.pitchOffset += (0 - p.pitchOffset) * (1 - Math.exp(-8 * rawDt));
      this.bikeSpinYaw += this.bikeSpinRate * dt;
      this.bikeSpinRate *= Math.exp(-1.9 * dt);
      this.audio.setSkidIntensity(p.speed > 12 ? 0.55 : 0);

      if (this.ragdollActive && this.ragdollGroup) {
        this.ragdollElapsed += dt;
        this.ragdollVel.y -= 23.5 * dt;
        this.ragdollPos.addScaledVector(this.ragdollVel, dt);
        const ragGroundY = this.track.sample(p.s + 3.0).y + 0.14;
        if (this.ragdollPos.y <= ragGroundY) {
          this.ragdollPos.y = ragGroundY;
          if (this.ragdollVel.y < -2.4) {
            this.ragdollVel.y = -this.ragdollVel.y * 0.36;
            this.ragdollVel.multiplyScalar(0.72);
            this.vfx.spawnBurst(this.ragdollPos.x, ragGroundY + 0.1, this.ragdollPos.z, 0xfbbf24, 6, 7, 0.7);
          } else {
            this.ragdollVel.y = 0;
            this.ragdollVel.x *= Math.exp(-3.8 * dt);
            this.ragdollVel.z *= Math.exp(-3.8 * dt);
            this.ragdollSpin.multiplyScalar(Math.exp(-2.8 * dt));
          }
        }
        this.ragdollGroup.position.copy(this.ragdollPos);
        this.ragdollGroup.rotation.x += this.ragdollSpin.x * dt;
        this.ragdollGroup.rotation.y += this.ragdollSpin.y * dt;
        this.ragdollGroup.rotation.z += this.ragdollSpin.z * dt;
        p.rider.setRagdollPose(this.ragdollElapsed, this.crashSeed);
      }

      if (p.speed > 7 && Math.random() < 0.72) {
        const wCrash = this.track.toWorld(p.s, p.laneX);
        this.vfx.spawnBurst(wCrash.x, wCrash.y + 0.12, wCrash.z, 0xffaa00, 4, 8, 0.8);
        this.vfx.spawnSmoke(wCrash.x, wCrash.y + 0.25, wCrash.z, 2, 1.15);
      }
      if (p.crashTimer <= 0) {
        p.crashed = false;
        p.stamina = p.maxStamina;
        p.speed = 28;
        p.vx = 0;
        p.lean = 0;
        p.laneX = Math.max(-5.5, Math.min(5.5, p.laneX));
        this.postCrashGhostTimer = 2.2;
        this.bikeSpinYaw = 0;
        this.bikeSpinRate = 0;
        this.wreckFocusTimer = 0;
        this.crashBlockedCar = null;
        if (this.ragdollActive) {
          this.ragdollActive = false;
          p.rider.root.position.set(0, 0, 0);
          p.rider.root.rotation.set(0, 0, 0);
          p.visual.chassisPivot.add(p.rider.root);
          if (this.ragdollGroup) {
            this.pipeline.scene.remove(this.ragdollGroup);
            this.ragdollGroup = null;
          }
        }
        this.showBanner("BACK ON THE GAS!", 1.2);
      }
    } else {
      const lowTorque = p.speed < maxSpeed * 0.55 ? 1.48 : 0.92;
      const accelPush = nitroActive
        ? bikeSpec.accel * turbineMul * 1.72
        : intent.throttle
          ? bikeSpec.accel * turbineMul * lowTorque
          : 0;
      const brakePull = intent.brake ? 54 : 0;
      const engineBrake = !intent.throttle && !intent.brake ? 5.2 + p.speed * 0.14 : 0;
      const aeroDrag = p.speed * p.speed * 0.0018;
      const offroadPenalty = Math.abs(p.laneX) > PLAYABLE_HALF_WIDTH ? 0.8 : 1.0;

      if (intent.brake && p.speed > 20) {
        this.audio.setSkidIntensity(0.45);
      }

      p.speed = Math.max(
        0,
        Math.min(maxSpeed * offroadPenalty, p.speed + (accelPush - brakePull - engineBrake - aeroDrag) * dt)
      );

      // Weight-transfer chassis squat, braking nose-dive, and subtle nitro launch wheelie lift
      const wheelieLift = nitroActive && p.speed > 18 && p.speed < 72 ? -0.14 * (1 - p.speed / 82) : 0;
      const targetPitch = intent.brake ? 0.075 : accelPush > 15 ? -0.055 + wheelieLift : 0;
      p.pitchOffset += (targetPitch - p.pitchOffset) * (1 - Math.exp(-10 * rawDt));

      // Real human steering & centrifugal curve physics (no bot auto-tracking around corners!)
      const steerDt = focusActive ? rawDt : dt;
      const speedFactor = 0.35 + 0.65 * Math.min(1, p.speed / 46);
      const targetLean = intent.steer * 0.58 * speedFactor;
      const leanRate = Math.abs(intent.steer) > 0.05 ? 11.5 : 8.5;
      p.lean += (targetLean - p.lean) * (1 - Math.exp(-leanRate * (focusActive ? rawDt : dt)));

      // Positive d2xDs2 means road bends Left (+X) -> outward centrifugal push is Right (+rightOffset)
      const centrifugalAccel = trackPt.d2xDs2 * p.speed * p.speed * 0.62;
      const carveAccel = (p.lean / 0.58) * 32 * bikeSpec.handling * gripMul + intent.steer * 14 * bikeSpec.handling;
      p.vx += (carveAccel + centrifugalAccel - p.vx * 4.8) * steerDt;
      p.laneX += p.vx * steerDt;

      if (Math.abs(p.laneX) > SHOULDER_LIMIT) {
        const wallSign = Math.sign(p.laneX);
        p.laneX = wallSign * SHOULDER_LIMIT;
        p.vx = -wallSign * 4.2;
        if (p.speed > 32) {
          const wScrape = this.track.toWorld(p.s, p.laneX);
          this.vfx.spawnBurst(wScrape.x, wScrape.y + 0.45, wScrape.z, 0xffaa00, 10, 8, 0.85);
          this.vfx.spawnSmoke(wScrape.x, wScrape.y + 0.25, wScrape.z, 2, 0.85);
          this.cameraRig.addTrauma(0.22);
          p.speed *= 0.90;
        }
      }

      if ((Math.abs(p.lean) > 0.48 || intent.brake) && p.speed > 30 && Math.random() < 0.3) {
        const wTire = this.track.toWorld(p.s - 0.65, p.laneX);
        this.vfx.spawnSmoke(wTire.x, wTire.y + 0.1, wTire.z, 1, 0.72);
      }

      for (const r of this.racers) {
        if (!r.isPlayer && r.s > p.s && r.s - p.s < 16 && Math.abs(r.laneX - p.laneX) < 1.8) {
          p.speed += 6.5 * dt;
          this.nitro = Math.min(this.maxNitro, this.nitro + 10 * dt);
        }
      }
    }

    const prevPlayerS = p.s;
    p.s += p.speed * dt;
    this.stepVerticalJump(p, dt);

    if (p.attackCooldown > 0) p.attackCooldown -= rawDt;
    if (p.attackTimer > 0) {
      p.attackTimer = Math.max(0, p.attackTimer - rawDt);
      if (p.attackTimer <= 0) p.attackSide = 0;
    }

    if (!p.crashed && p.attackCooldown <= 0) {
      if (intent.strikeLeftPressed) {
        this.startAttack(p, -1, "melee");
      } else if (intent.strikeRightPressed) {
        this.startAttack(p, 1, "melee");
      } else if (intent.kickPressed) {
        const nearestSide = this.findNearestSide(p);
        this.startAttack(p, nearestSide, "kick");
      } else if (intent.strikeAutoPressed) {
        const nearestSide = this.findNearestSide(p);
        this.startAttack(p, nearestSide, "melee");
      }
    }

    // Spawn Highway Patrol Motor Units & Squad Cars
    if (p.s > this.activeStage.copThresholdMeters && this.wantedHeat < 2) {
      this.wantedHeat = 2;
      this.spawnCopUnit(18);
      this.spawnPoliceInterceptor(28);
      this.pushComms(BOSS_BIOS.cross.name, BOSS_BIOS.cross.title, BOSS_BIOS.cross.portraitUrl, "Patrol units closing in! Cut the throttle!");
    }
    if (this.wantedHeat >= 2) {
      if (this.racers.filter((r) => r.isCop && !r.crashed).length === 0) {
        this.spawnCopUnit(24);
      }
      if (p.s > this.nextInterceptorCheckS) {
        this.spawnPoliceInterceptor(36);
        this.nextInterceptorCheckS += 520;
      }
    }
    if (this.wantedHeat >= 3 && p.s > this.nextRoadblockS && p.s < this.activeStage.lengthMeters - 400) {
      this.spawnSwatRoadblock(p.s + 240);
      this.nextRoadblockS += 1050;
    }
    if (this.wantedHeat >= 4 || this.activeStage.hasHelicopter) {
      if (this.helicopter) this.helicopter.root.visible = true;
    }

    for (const r of this.racers) {
      if (r.isPlayer) continue;
      if (r.lastHitByPlayerTimer > 0) r.lastHitByPlayerTimer = Math.max(0, r.lastHitByPlayerTimer - rawDt);
      this.stepAiRacer(r, dt);
      this.stepVerticalJump(r, dt);
    }

    for (let i = 0; i < this.racers.length; i++) {
      const a = this.racers[i];
      if (!a.crashed && a.attackTimer > 0 && !a.attackHitDone) {
        const spec = WEAPONS[a.weapon];
        const dur = a.attackType === "kick" ? 0.24 : spec.swingDuration;
        const prog = 1 - a.attackTimer / dur;
        if (prog >= 0.35 && prog <= 0.85) {
          this.resolveAttackHits(a, spec.reach, a.attackType === "kick" ? 28 : spec.damage, a.attackType === "kick" ? 8.5 : spec.knockback);
        }
      }

      for (let j = i + 1; j < this.racers.length; j++) {
        const b = this.racers[j];
        if (a.crashed || b.crashed) continue;
        const ds = Math.abs(a.s - b.s);
        const dx = a.laneX - b.laneX;
        if (ds < 1.85 && Math.abs(dx) < 0.95) {
          const push = Math.sign(dx || (Math.random() > 0.5 ? 1 : -1));
          a.laneX += push * 0.25;
          b.laneX -= push * 0.25;
          a.vx += push * 2.8;
          b.vx -= push * 2.8;
          if (a.isPlayer) b.lastHitByPlayerTimer = 4.0;
          if (b.isPlayer) a.lastHitByPlayerTimer = 4.0;
          if (a.isPlayer || b.isPlayer) {
            const wRub = this.track.toWorld(p.s, p.laneX);
            this.vfx.spawnBurst(wRub.x, wRub.y + 0.7, wRub.z, 0xffaa00, 6, 6, 0.8);
          }
        }
      }
    }

    // 1. Traffic Motion + IDM Headway Braking + Safe De-conflicted Respawns
    const prevCarSMap = new Map<number, number>();
    for (const t of this.traffic) {
      if (t.disabledTimer > 0) t.disabledTimer = Math.max(0, t.disabledTimer - dt);
      if (t.brakeTimer > 0) t.brakeTimer = Math.max(0, t.brakeTimer - dt);
      if (t.hazardTimer > 0) t.hazardTimer = Math.max(0, t.hazardTimer - dt);
      if (t.slammedByPlayerTimer > 0) {
        t.slammedByPlayerTimer = Math.max(0, t.slammedByPlayerTimer - dt);
        if (t.slammedByPlayerTimer <= 0) t.slammedByPlayer = false;
      }
      prevCarSMap.set(t.id, t.s);

      t.laneX = Math.max(-PLAYABLE_HALF_WIDTH, Math.min(PLAYABLE_HALF_WIDTH, t.laneX + t.latVel * dt));
      t.latVel *= Math.exp(-4.2 * dt);
      t.yawWobble *= Math.exp(-5.0 * dt);
      t.pitchAngle *= Math.exp(-5.5 * dt);
      t.rollAngle *= Math.exp(-5.2 * dt);

      if (t.brakeTimer > 0 && !t.roadblock) {
        t.speed *= Math.exp(-1.8 * dt);
      }

      if (t.kind === "police" && !t.roadblock) {
        if (t.disabledTimer <= 0) {
          let targetSpd = Math.min(72, Math.max(40, p.speed + (p.s - t.s) * 0.65));
          for (const other of this.traffic) {
            if (other === t || other.disabledTimer > 0 || other.oncoming || other.roadblock) continue;
            if (Math.abs(other.laneX - t.laneX) < t.halfWidth + other.halfWidth + 0.7) {
              const gap = other.s - other.halfLength - (t.s + t.halfLength);
              if (gap > -1 && gap < 22) {
                targetSpd = Math.min(targetSpd, other.speed);
              }
            }
          }
          t.speed += (targetSpd - t.speed) * (1 - Math.exp(-3.2 * dt));
          t.s += t.speed * dt;
          t.distRolled += t.speed * dt;
          let desiredX = Math.abs(t.s - p.s) < 18 ? p.laneX + (p.laneX > 1.0 ? -2.3 : 2.3) : t.homeLaneX;
          desiredX = Math.max(Math.abs(t.s - p.s) < 18 ? -4.8 : 1.6, Math.min(5.2, desiredX));
          for (const other of this.traffic) {
            if (other === t || other.disabledTimer > 0) continue;
            if (Math.abs(other.s - t.s) < 16 && Math.abs(other.laneX - desiredX) < t.halfWidth + other.halfWidth + 0.9) {
              desiredX = other.laneX > 0 ? Math.max(-4.8, other.laneX - 3.2) : Math.min(5.2, other.laneX + 3.2);
            }
          }
          t.laneX += Math.max(-1, Math.min(1, desiredX - t.laneX)) * 5.2 * dt;

          // Side Kick / Melee PIT slam into cruiser pushes it sideways off the highway!
          if (!p.crashed && p.attackTimer > 0 && Math.abs(p.s - t.s) < 3.2 && Math.abs(p.laneX - t.laneX) < 3.0) {
            const pitSide = Math.sign(t.laneX - p.laneX || p.attackSide || 1);
            t.hp -= 55;
            t.slammedByPlayer = true;
            t.slammedByPlayerTimer = 5.0;
            t.latVel = pitSide * 7.8;
            t.yawWobble = pitSide * 0.34;
            t.rollAngle = -pitSide * 0.16;
            t.hazardTimer = 3.0;
            const wCop = this.track.toWorld(t.s, t.laneX);
            this.vfx.spawnBurst(wCop.x, wCop.y + 0.6, wCop.z, 0xffaa00, 18, 11, 1.0);
            this.vfx.spawnDebrisBurst(wCop.x, wCop.y + 0.6, wCop.z, 0, t.speed * 0.4, 0xf8fafc, 10, wCop.y);
            this.vfx.spawnSmoke(wCop.x, wCop.y + 0.3, wCop.z, 3, 1.0);
            if (t.hp <= 0) {
              t.disabledTimer = 10;
              t.s -= 80;
              this.knockoutCount++;
              this.raceCashEarned += 750;
              this.takedownSlowMo = 0.25;
              this.cameraRig.addTrauma(0.55);
              this.audio.playCrash();
              this.showBanner("PURSUIT CRUISER SPUN OUT! +$750", 2.1);
            }
          }
        }
      } else if (!t.roadblock) {
        // Ahead-car IDM headway braking so same-direction and oncoming cars never overlap linearly
        let targetSpeed = t.desiredSpeed;
        if (!t.oncoming) {
          for (const other of this.traffic) {
            if (other === t || other.disabledTimer > 0 || other.oncoming || other.roadblock) continue;
            if (Math.abs(other.laneX - t.laneX) < t.halfWidth + other.halfWidth + 0.65) {
              const gap = other.s - other.halfLength - (t.s + t.halfLength);
              if (gap > -2 && gap < 28) {
                const cap = gap < 10 ? Math.max(0, other.speed - (10 - gap) * 1.8) : other.speed * 0.94;
                targetSpeed = Math.min(targetSpeed, cap);
              }
            }
          }
        } else {
          for (const other of this.traffic) {
            if (other === t || other.disabledTimer > 0 || !other.oncoming || other.roadblock) continue;
            if (Math.abs(other.laneX - t.laneX) < t.halfWidth + other.halfWidth + 0.65) {
              const gap = t.s - t.halfLength - (other.s + other.halfLength);
              if (gap > -2 && gap < 28) {
                const cap = gap < 10 ? Math.min(0, other.speed + (10 - gap) * 1.8) : other.speed * 0.94;
                targetSpeed = Math.max(targetSpeed, cap);
              }
            }
          }
        }
        if (t.brakeTimer <= 0) {
          t.speed += (targetSpeed - t.speed) * (1 - Math.exp(-3.8 * dt));
        }
        if (t.slammedByPlayerTimer <= 0) {
          t.laneX += (t.homeLaneX - t.laneX) * Math.min(1, 1.4 * dt);
        }

        t.s += t.speed * dt;
        t.distRolled += t.speed * dt;
        if (t.s < p.s - 35 || t.s > p.s + 430) {
          this.findSafeTrafficSpawn(t, p.s);
        }

        // Player Kick/Strike alongside any civilian car shoves it into adjacent lane (enabling chain-reaction Traffic Slams!)
        if (!p.crashed && p.attackTimer > 0 && !t.slammedByPlayer && Math.abs(p.s - t.s) < t.halfLength + 1.1 && Math.abs(p.laneX - t.laneX) < t.halfWidth + 1.85) {
          const slamSide = Math.sign(t.laneX - p.laneX || p.attackSide || 1);
          t.slammedByPlayer = true;
          t.slammedByPlayerTimer = 5.0;
          t.latVel = slamSide * 7.6;
          t.yawWobble = slamSide * 0.24;
          t.rollAngle = -slamSide * 0.18;
          t.brakeTimer = 1.6;
          t.hazardTimer = 3.2;
          const wSlam = this.track.toWorld(t.s, t.laneX);
          this.vfx.spawnBurst(wSlam.x, wSlam.y + 0.65, wSlam.z, 0xffaa00, 14, 9, 0.9);
          this.vfx.spawnDebrisBurst(wSlam.x, wSlam.y + 0.65, wSlam.z, slamSide * 4, t.speed * 0.4, t.visual.bodyMat.color.getHex(), 8, wSlam.y);
          this.audio.playStrike(true);
          this.audio.playCarHorn(0.95);
        }
      }
    }

    // 2. Hard pairwise car-vs-car separation solver (guarantees zero cars passing through each other)
    this.resolveCarVsCarCollisions();

    // Prevent crashed player motorcycle from sliding cleanly through the struck vehicle trunk
    if (p.crashed && this.crashBlockedCar && this.crashBlockedCar.disabledTimer <= 0) {
      const bc = this.crashBlockedCar;
      if (Math.abs(p.laneX - bc.laneX) < bc.halfWidth + 0.48 && Math.abs(p.s - bc.s) < bc.halfLength + 0.9) {
        if (!bc.oncoming) {
          p.s = Math.min(p.s, bc.s - bc.halfLength - 0.95);
          p.speed = Math.min(p.speed, Math.max(0, bc.speed * 0.88));
        } else {
          const pushSide = p.laneX >= bc.laneX ? 1 : -1;
          p.laneX = bc.laneX + pushSide * (bc.halfWidth + 0.68);
        }
      }
    }

    // 3. Vehicle interaction & player-attributed Traffic Slam resolution
    for (const t of this.traffic) {
      const prevCarS = prevCarSMap.get(t.id) ?? t.s;

      // Chain-reaction Rival / Cop slammed into traffic car!
      if (t.disabledTimer <= 0) {
        for (const r of this.racers) {
          if (r.isPlayer || r.crashed || r.yOffset > 1.2) continue;
          if (Math.abs(r.s - t.s) < t.halfLength + 0.9 && Math.abs(r.laneX - t.laneX) < t.halfWidth + 0.48) {
            const cSide = Math.sign(r.laneX - t.laneX || 1);
            t.latVel = -cSide * 5.2;
            t.rollAngle = cSide * 0.16;
            t.brakeTimer = 2.0;
            t.hazardTimer = 3.6;
            const playerCaused =
              (r.lastHitByPlayerTimer > 0 || t.slammedByPlayerTimer > 0) && Math.abs(r.s - p.s) < 48;
            if (playerCaused) {
              const wSlam = this.track.toWorld(t.s, (r.laneX + t.laneX) * 0.5);
              this.vfx.spawnDebrisBurst(wSlam.x, wSlam.y + 0.7, wSlam.z, cSide * 5, t.speed * 0.4, t.visual.bodyMat.color.getHex(), 14, wSlam.y);
              this.knockoutRacer(r, cSide);
              this.raceCashEarned += 200;
              this.showBanner("TRAFFIC SLAM TAKEDOWN! +$650", 2.0);
            } else {
              // Silent background rider crash with zero false popup or slow-mo disruption
              r.crashed = true;
              r.crashTimer = 2.8;
              r.crashDir = cSide || 1;
              r.speed *= 0.28;
              r.stamina = r.maxStamina;
            }
            break;
          }
        }
      }

      if (!t.nearMissed && !p.crashed && Math.abs(p.s - t.s) < t.halfLength + 1.2) {
        const gap = Math.abs(p.laneX - t.laneX) - t.halfWidth;
        if (gap > 0.45 && gap < 1.45 && p.speed * MPS_TO_MPH > 95) {
          t.nearMissed = true;
          this.nearMissCount++;
          this.multiplier = Math.min(10, Number((this.multiplier + 0.2).toFixed(1)));
          this.multiplierTimer = 4.2;
          const bonus = Math.round(75 * this.multiplier);
          this.raceCashEarned += bonus;
          this.nitro = Math.min(this.maxNitro, this.nitro + 12);
          this.focus = Math.min(this.maxFocus, this.focus + 10);
          this.audio.playNearMiss();
          if (t.oncoming) this.audio.playCarHorn(1.16);
          this.showBanner(`NEAR MISS! x${this.multiplier.toFixed(1)} +$${bonus}`, 1.1);
        }
      }

      if (!p.crashed && this.postCrashGhostTimer <= 0 && t.disabledTimer <= 0 && p.yOffset < 1.35 && Math.abs(p.s - t.s) < t.halfLength + 0.85) {
        if (Math.abs(p.laneX - t.laneX) < t.halfWidth + 0.42) {
          const dx = p.laneX - t.laneX;
          const hitSide = Math.sign(dx || (p.laneX > 0 ? -1 : 1));
          const relSpeed = Math.abs(p.speed - t.speed);
          const alongSideEdge = Math.abs(prevPlayerS - prevCarS) < t.halfLength + 0.25 && Math.abs(dx) > t.halfWidth * 0.65;
          const deadBehind = !t.oncoming && prevPlayerS < prevCarS - t.halfLength * 0.55 && Math.abs(dx) < t.halfWidth * 0.55;
          const wHit = this.track.toWorld(p.s, (p.laneX + t.laneX) * 0.5);

          if (alongSideEdge || relSpeed < 10) {
            if (deadBehind) {
              p.s = Math.min(p.s, t.s - t.halfLength - 0.95);
              p.speed = Math.min(p.speed, Math.max(8, t.speed * 0.92));
              p.vx = hitSide * 5.2;
            } else {
              // Glancing door-scrape / side-swipe: bounce cleanly apart, rock car suspension, tank-slapper handlebar wobble
              p.laneX = t.laneX + hitSide * (t.halfWidth + 0.54);
              p.vx = hitSide * 7.2;
              this.barWobbleTimer = 0.52;
              this.showBanner("SIDE-SWIPE! HOLD THE BARS!", 0.95);
            }
            t.slammedByPlayer = true;
            t.slammedByPlayerTimer = 4.0;
            t.latVel = -hitSide * 4.4;
            t.yawWobble = -hitSide * 0.16;
            t.rollAngle = hitSide * 0.14;
            t.hazardTimer = 2.4;
            p.speed *= 0.88;
            p.armor = Math.max(0, p.armor - 5);
            this.damageFlash = Math.max(this.damageFlash, 0.38);
            this.vfx.spawnBurst(wHit.x, wHit.y + 0.65, wHit.z, 0xffaa00, 14, 9, 0.85);
            this.vfx.spawnDebrisBurst(wHit.x, wHit.y + 0.65, wHit.z, hitSide * 4, p.speed * 0.35, t.visual.bodyMat.color.getHex(), 6, wHit.y);
            this.vfx.spawnSmoke(wHit.x, wHit.y + 0.35, wHit.z, 2, 0.9);
            this.cameraRig.addTrauma(0.28);
            this.audio.playStrike(true);
            this.audio.playCarHorn(1.06);
            this.audio.setSkidIntensity(0.45);
          } else {
            // High-speed car impact: clamp bike outside rear trunk, vault ragdoll cleanly forward over hood
            if (!t.oncoming) {
              p.s = Math.min(p.s, t.s - t.halfLength - 0.92);
            }
            if (!t.roadblock) {
              t.speed = Math.max(-22, t.speed + (p.speed - t.speed) * 0.26);
            }
            this.triggerPlayerCrash(hitSide, 22, t);
          }
        }
      }
    }

    for (const c of this.racers) {
      if (!c.isCop || c.crashed) continue;
      if (p.crashed && Math.hypot(c.s - p.s, c.laneX - p.laneX) < 5.2 && p.speed < 10) {
        this.finishRace("busted");
        return;
      }
    }

    if (p.armor <= 0) {
      this.finishRace("wrecked");
      return;
    }
    if (p.s >= this.activeStage.lengthMeters) {
      this.finishRace("finished");
      return;
    }

    const minCopDist = this.racers.reduce((best, r) => (r.isCop && !r.crashed ? Math.min(best, Math.abs(r.s - p.s)) : best), 999);
    const minCarCopDist = this.traffic.reduce(
      (best, t) => (t.kind === "police" && t.disabledTimer <= 0 ? Math.min(best, Math.abs(t.s - p.s)) : best),
      999
    );
    const closestCop = Math.min(minCopDist, minCarCopDist);
    const sirenStrength = closestCop < 55 ? Math.max(0, 1 - closestCop / 55) : 0;
    this.audio.updateTelemetry(true, p.speed * MPS_TO_MPH, nitroActive, sirenStrength, focusActive ? 1 : 0);

    this.track.update(p.s, this.totalElapsed);
    this.syncVisuals(rawDt, nitroActive, intent.brake);

    const pWorld = this.track.toWorld(p.s, p.laneX);
    const aheadWorld = this.track.toWorld(p.s + 24, p.laneX * 0.45);
    this.vfx.update(rawDt, pWorld.x, pWorld.y, pWorld.z, p.speed, this.activeStage.hasRain);
    this.pipeline.syncFollowRig(pWorld.x, pWorld.y, pWorld.z);
    const wreckFocus =
      this.ragdollActive && this.wreckFocusTimer > 0
        ? { x: this.ragdollPos.x, y: this.ragdollPos.y, z: this.ragdollPos.z, blend: Math.min(1, this.wreckFocusTimer / 1.1) }
        : undefined;
    this.cameraRig.updateRace(
      this.pipeline.camera,
      rawDt,
      pWorld.x,
      pWorld.y + p.yOffset,
      pWorld.z,
      pWorld.yaw,
      p.vx,
      aheadWorld.x,
      aheadWorld.y,
      aheadWorld.z,
      Math.min(1, p.speed / (bikeSpec.topSpeedMph * 0.44704)),
      nitroActive,
      intent.brake,
      p.lean,
      this.save.settings.cameraMode,
      this.totalElapsed,
      wreckFocus
    );
  }

  private stepVerticalJump(r: BikerSim, dt: number): void {
    const rampY = this.track.getRampHeightAt(r.s, r.laneX);
    if (r.yOffset <= rampY + 0.02 && r.vy <= 0) {
      const prevRamp = this.track.getRampHeightAt(r.s - Math.max(0.5, r.speed * dt), r.laneX);
      if (rampY > 0.1 && rampY >= prevRamp) {
        r.yOffset = rampY;
        r.vy = r.speed * 0.24;
        if (r.isPlayer && rampY > 1.8) {
          this.showBanner("BIG AIR!", 1.1);
          this.nitro = Math.min(this.maxNitro, this.nitro + 12);
        }
      } else {
        r.yOffset = 0;
        r.vy = 0;
      }
    } else {
      r.vy -= 26 * dt;
      r.yOffset += r.vy * dt;
      if (r.yOffset <= rampY) {
        if (r.isPlayer && r.vy < -5.5) {
          this.cameraRig.addTrauma(0.25);
          const wp = this.track.toWorld(r.s, r.laneX);
          this.vfx.spawnBurst(wp.x, wp.y + 0.2, wp.z, 0xffaa00, 12, 7, 1.0);
        }
        r.yOffset = rampY;
        r.vy = 0;
      }
    }
  }

  private stepAiRacer(r: BikerSim, dt: number): void {
    if (r.attackCooldown > 0) r.attackCooldown -= dt;
    if (r.attackTimer > 0) {
      r.attackTimer = Math.max(0, r.attackTimer - dt);
      if (r.attackTimer <= 0) r.attackSide = 0;
    }

    if (r.crashed) {
      r.crashTimer -= dt;
      r.speed = Math.max(0, r.speed - 32 * dt);
      r.s += r.speed * dt;
      if (r.crashTimer <= 0) {
        r.crashed = false;
        r.stamina = r.maxStamina;
        r.speed = Math.max(38, this.player.speed * 0.85);
      }
      return;
    }

    const baseStageMps = (145 + this.activeStage.difficulty * 14) * 0.44704;
    let desiredSpeed = r.isCop
      ? Math.max(baseStageMps * 1.05, this.player.speed + (this.player.s - r.s) * 0.7)
      : baseStageMps * (r.profile ? r.profile.skill : 0.9);

    if (!r.isCop) {
      const gap = this.player.s - r.s;
      if (gap > 50) desiredSpeed *= 1.22;
      else if (gap < -85) desiredSpeed *= 0.86;
    }

    r.speed += (desiredSpeed - r.speed) * (1 - Math.exp(-2.8 * dt));
    r.s += r.speed * dt;

    r.laneTimer -= dt;
    if (r.laneTimer <= 0) {
      r.laneTimer = 0.55 + Math.random() * 0.7;
      if (r.isCop && Math.abs(r.s - this.player.s) < 18) {
        r.targetLaneX = this.player.laneX + (this.player.laneX > 0 ? -1.4 : 1.4);
      } else {
        // Multi-lane 95m lookahead scorer so AI riders actively avoid hitting cars head-on or rear-ending
        const candLanes = [-5.0, -2.5, 0, 2.5, 5.0];
        let bestLane = r.targetLaneX;
        let bestScore = -1e9;
        for (const cl of candLanes) {
          let score = -Math.abs(cl - r.laneX) * 0.6 + (Math.random() - 0.5) * 0.4;
          for (const t of this.traffic) {
            if (t.disabledTimer > 0) continue;
            const relS = t.s - r.s;
            const lookAhead = t.oncoming ? 115 : 85;
            if (relS > -6 && relS < lookAhead && Math.abs(t.laneX - cl) < t.halfWidth + 1.35) {
              score -= (lookAhead - Math.max(0, relS)) * (t.oncoming ? 3.0 : 2.2);
            }
          }
          if (score > bestScore) {
            bestScore = score;
            bestLane = cl;
          }
        }
        r.targetLaneX = bestLane;
      }
    }

    for (const t of this.traffic) {
      if (t.disabledTimer > 0) continue;
      const lookAhead = t.oncoming ? 72 : 48;
      if (t.s > r.s - 2 && t.s - r.s < lookAhead && Math.abs(t.laneX - r.laneX) < t.halfWidth + 1.15) {
        r.targetLaneX = t.laneX > 0 ? Math.max(-5.4, t.laneX - 3.3) : Math.min(5.4, t.laneX + 3.3);
      }
    }

    const laneDiff = r.targetLaneX - r.laneX;
    const steer = Math.max(-1, Math.min(1, laneDiff * 0.7));
    r.laneX += steer * 8.5 * dt + r.vx * dt;
    r.laneX = Math.max(-PLAYABLE_HALF_WIDTH, Math.min(PLAYABLE_HALF_WIDTH, r.laneX));
    r.vx *= Math.exp(-4.5 * dt);
    r.lean += (steer * 0.5 - r.lean) * (1 - Math.exp(-8 * dt));

    if (!this.player.crashed && r.attackCooldown <= 0 && Math.abs(r.s - this.player.s) < 2.6 && Math.abs(r.laneX - this.player.laneX) < 2.8) {
      const aggro = r.isCop ? 0.9 : (r.profile?.aggression ?? 0.5);
      if (Math.random() < aggro * dt * 2.6) {
        const side: -1 | 1 = this.player.laneX > r.laneX ? 1 : -1;
        this.startAttack(r, side, "melee");
      }
    }
  }

  private findNearestSide(attacker: BikerSim): -1 | 1 {
    let bestSide: -1 | 1 = 1;
    let bestDist = 999;
    for (const r of this.racers) {
      if (r === attacker || r.crashed) continue;
      if (Math.abs(r.s - attacker.s) < 3.6) {
        const dx = r.laneX - attacker.laneX;
        if (Math.abs(dx) < bestDist) {
          bestDist = Math.abs(dx);
          bestSide = dx >= 0 ? 1 : -1;
        }
      }
    }
    return bestSide;
  }

  private startAttack(r: BikerSim, side: -1 | 1, type: "melee" | "kick"): void {
    const spec = WEAPONS[r.weapon];
    r.attackSide = side;
    r.attackType = type;
    r.attackTimer = type === "kick" ? 0.24 : spec.swingDuration;
    r.attackCooldown = type === "kick" ? 0.42 : spec.cooldown;
    r.attackHitDone = false;

    // Subtle magnetic combat snap so close-quarters duels feel crisp
    if (r.isPlayer) {
      for (const t of this.racers) {
        if (!t.isPlayer && !t.crashed && Math.abs(t.s - r.s) < 3.2) {
          const dx = t.laneX - r.laneX;
          if (Math.abs(dx) < 4.2 && Math.sign(dx || side) === side && Math.abs(dx) > 1.35) {
            r.vx += side * 5.2;
            break;
          }
        }
      }
      this.audio.playStrike(type === "kick");
    }
  }

  private resolveAttackHits(attacker: BikerSim, reach: number, damage: number, knockback: number): void {
    for (const target of this.racers) {
      if (target === attacker || target.crashed) continue;
      if (!attacker.isPlayer && !target.isPlayer) continue;

      const ds = Math.abs(target.s - attacker.s);
      const dx = target.laneX - attacker.laneX;
      if (ds <= 3.1 && Math.sign(dx || attacker.attackSide) === attacker.attackSide && Math.abs(dx) <= reach) {
        attacker.attackHitDone = true;
        target.stamina = Math.max(0, target.stamina - damage);
        target.vx += attacker.attackSide * knockback;

        const wHit = this.track.toWorld(target.s, target.laneX);
        this.vfx.spawnBurst(wHit.x, wHit.y + 0.9, wHit.z, 0xffaa00, 14, 10, 0.95);

        if (target.isPlayer) {
          this.damageFlash = 0.7;
          this.cameraRig.addTrauma(0.38);
          this.audio.playStrike(true);
          if (target.stamina <= 0) {
            this.triggerPlayerCrash(attacker.attackSide, 18);
          }
        } else {
          if (attacker.isPlayer) target.lastHitByPlayerTimer = 5.0;
          this.cameraRig.addTrauma(0.3);
          this.hitstopTimer = 0;
          if (target.stamina <= 0) {
            this.knockoutRacer(target, attacker.attackSide);
          } else {
            this.audio.playStrike(true);
            this.raceCashEarned += 95;
            this.showBanner(`SOLID HIT! +$95`, 0.9);
          }
        }
        break;
      }
    }
  }

  private triggerPlayerCrash(dir: number, armorDamage: number, hitCar?: TrafficSim): void {
    const p = this.player;
    const preCrashSpeed = p.speed;
    p.crashed = true;
    p.crashTimer = 2.1;
    p.crashDir = dir || 1;
    p.vx = dir * 4.8;
    p.speed *= 0.34;
    p.armor = Math.max(0, p.armor - armorDamage);
    this.multiplier = 1.0;
    this.damageFlash = 1.0;
    this.hitstopTimer = 0.045;
    this.takedownSlowMo = 0.42;
    this.crashSeed += 1.37;
    this.bikeSpinYaw = 0;
    this.bikeSpinRate = dir * 7.8;
    this.wreckFocusTimer = 1.65;
    this.crashBlockedCar = hitCar ?? null;
    this.cameraRig.addTrauma(0.85);
    this.audio.playCrash(true);

    const wp = this.track.toWorld(p.s, p.laneX);

    // Eject full-body ragdoll rider cleanly off motorcycle saddle in world coordinates
    if (!this.ragdollActive) {
      const worldRiderPos = new THREE.Vector3();
      p.rider.root.getWorldPosition(worldRiderPos);
      this.ragdollGroup = new THREE.Group();
      this.ragdollPos.copy(worldRiderPos);
      this.ragdollPos.y = Math.max(wp.y + 0.95, this.ragdollPos.y);
      this.ragdollGroup.position.copy(this.ragdollPos);
      this.pipeline.scene.add(this.ragdollGroup);
      p.rider.root.position.set(0, 0, 0);
      p.rider.root.rotation.set(0, 0, 0);
      this.ragdollGroup.add(p.rider.root);
      this.ragdollActive = true;
      this.ragdollElapsed = 0;

      const fwdX = Math.sin(wp.yaw);
      const fwdZ = Math.cos(wp.yaw);
      const rel = hitCar ? Math.abs(preCrashSpeed - hitCar.speed) : preCrashSpeed;
      const launchSpeed = Math.max(18, preCrashSpeed * 0.65);
      this.ragdollVel.set(
        fwdX * launchSpeed + wp.rightX * dir * 3.8,
        8.4 + Math.min(6.4, rel * 0.16),
        fwdZ * launchSpeed + wp.rightZ * dir * 3.8
      );
      this.ragdollSpin.set(5.2, 3.2 * dir, 4.1 * dir);
    }

    if (hitCar) {
      hitCar.latVel = -dir * 5.2;
      hitCar.yawWobble = -dir * 0.28;
      hitCar.pitchAngle = 0.12;
      hitCar.rollAngle = dir * 0.18;
      hitCar.brakeTimer = 2.2;
      hitCar.hazardTimer = 4.5;
      this.audio.playCarHorn(0.92);
      this.audio.setSkidIntensity(0.95);
      this.vfx.spawnDebrisBurst(
        wp.x,
        wp.y + 0.72,
        wp.z,
        wp.rightX * dir * 4,
        preCrashSpeed * 0.42,
        hitCar.visual.bodyMat.color.getHex(),
        24,
        wp.y
      );
    }

    this.vfx.spawnBurst(wp.x, wp.y + 0.55, wp.z, 0xffaa00, 32, 14, 1.15);
    this.vfx.spawnSmoke(wp.x, wp.y + 0.45, wp.z, 6, 1.45);
    this.showBanner(p.armor <= 0 ? "BIKE TOTALED!" : hitCar ? "WRECKED! RAGDOLL EJECTION!" : "LOWSIDE! HOLD THE LINE!", 1.9);
  }

  private finishRace(outcome: "finished" | "wrecked" | "busted"): void {
    if (this.ragdollActive && this.player) {
      this.ragdollActive = false;
      this.player.rider.root.position.set(0, 0, 0);
      this.player.rider.root.rotation.set(0, 0, 0);
      this.player.visual.chassisPivot.add(this.player.rider.root);
      if (this.ragdollGroup) {
        this.pipeline.scene.remove(this.ragdollGroup);
        this.ragdollGroup = null;
      }
    }
    this.screen = "results";
    this.audio.updateTelemetry(false, 0, false, 0, 0);
    this.audio.stopMusic();

    const rank = outcome === "finished" ? this.computePlayerRank() : 8;
    const stagePrize =
      outcome === "finished"
        ? rank <= 3
          ? this.activeStage.prizes[rank - 1]
          : Math.max(300, Math.round(this.activeStage.prizes[2] * 0.45))
        : 0;
    const takedownBonus = this.knockoutCount * 450;
    const stuntBonus = this.nearMissCount * 60;
    const totalCash = stagePrize + this.raceCashEarned;

    this.save.cash += totalCash;
    this.save.rep += outcome === "finished" ? (9 - rank) * 140 + this.knockoutCount * 80 : this.knockoutCount * 40;
    this.save.totalKnockouts += this.knockoutCount;
    if (outcome === "finished" && rank === 1) this.save.totalWins++;
    if (outcome === "finished") {
      const prevBest = this.save.bestRanks[this.activeStage.id] ?? 99;
      if (rank < prevBest) this.save.bestRanks[this.activeStage.id] = rank;
    }
    persistSave(this.save);

    const boss = BOSS_BIOS[outcome === "busted" ? "cross" : this.activeStage.bossId];
    this.results = {
      outcome,
      rank,
      totalRacers: 8,
      raceTimeSec: this.raceClock,
      stagePrize,
      takedowns: this.knockoutCount,
      takedownBonus,
      nearMisses: this.nearMissCount,
      stuntBonus,
      totalCash,
      bossName: boss.name,
      bossPortrait: boss.portraitUrl,
      bossQuote:
        outcome === "finished" && rank <= 3
          ? "Top three through the smoke and sirens. Respect earned across the grid."
          : outcome === "busted"
            ? "Keys seized. Bike impounded. Pay your fine or hit the asphalt harder next run."
            : boss.quote,
    };

    if (outcome === "finished" && rank <= 3) {
      this.audio.playTone(880, 0.35, 0.35);
    } else {
      this.audio.playTone(160, 0.4, 0.32);
    }
    this.emitSnapshot();
  }

  private computePlayerRank(): number {
    if (!this.player) return 1;
    let rank = 1;
    for (const r of this.racers) {
      if (!r.isPlayer && !r.isCop && r.s > this.player.s) rank++;
    }
    return rank;
  }

  private syncVisuals(dt: number, playerNitro: boolean, playerBraking: boolean): void {
    for (const r of this.racers) {
      const visible = r.isPlayer || (r.s > this.player.s - 12 && r.s < this.player.s + 115);
      r.visual.root.visible = visible;
      if (!visible) continue;
      // Only player bike casts expensive dynamic PCFSoft shadow; rivals use grounded Multiply AO contact shadows
      const castSh = r.isPlayer;
      if (r.visual.root.userData.castSh !== castSh) {
        r.visual.root.userData.castSh = castSh;
        r.visual.root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.material !== this.kit.ferrariAoMat) m.castShadow = castSh;
        });
      }
      const wp = this.track.toWorld(r.s, r.laneX);
      r.visual.root.position.set(wp.x, wp.y + r.yOffset, wp.z);
      const extraSpinY = r.isPlayer && r.crashed ? this.bikeSpinYaw : 0;
      r.visual.root.rotation.set(wp.pitch, wp.yaw + extraSpinY, 0);

      if (r.crashed) {
        r.visual.chassisPivot.rotation.set(0, 0, r.crashDir * 1.4);
        r.visual.chassisPivot.position.y = 0.22;
      } else {
        // Right-hand rule around +Z tilts top (+Y) toward -X (Screen Right) when rotation.z > 0
        r.visual.chassisPivot.rotation.set(r.pitchOffset, 0, r.lean);
        r.visual.chassisPivot.position.y = 0;
        const barWobble = r.isPlayer && this.barWobbleTimer > 0 ? Math.sin(this.totalElapsed * 56) * (this.barWobbleTimer * 0.48) : 0;
        r.visual.frontWheelPivot.rotation.y = -r.lean * 0.28 + barWobble;
      }

      const showFlame = r.isPlayer ? playerNitro : r.speed > 62;
      r.visual.setEffects(r.speed, dt, showFlame && !r.crashed, r.isPlayer ? playerBraking : false);

      if (!(r.isPlayer && this.ragdollActive)) {
        const dur = r.attackType === "kick" ? 0.24 : WEAPONS[r.weapon].swingDuration;
        const prog = r.attackTimer > 0 ? 1 - r.attackTimer / dur : 0;
        r.rider.updatePose(
          r.lean / 0.58,
          Math.min(1, r.speed / 85),
          prog,
          r.attackSide,
          r.attackType,
          this.totalElapsed
        );
      }
    }

    for (const t of this.traffic) {
      const visible = t.disabledTimer <= 0 && t.s > this.player.s - 12 && t.s < this.player.s + 115;
      t.visual.root.visible = visible;
      if (!visible) continue;
      const castCarSh = t.s - this.player.s > -5 && t.s - this.player.s < 22 && t.kind === "police";
      if (t.visual.root.userData.castSh !== castCarSh) {
        t.visual.root.userData.castSh = castCarSh;
        t.visual.root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.material !== this.kit.ferrariAoMat) m.castShadow = castCarSh;
        });
      }
      const wt = this.track.toWorld(t.s, t.laneX);
      t.visual.root.position.set(wt.x, wt.y, wt.z);
      const baseYaw = wt.yaw + (t.oncoming ? Math.PI : t.roadblock ? Math.PI / 2 : 0);
      t.visual.root.rotation.set(0, baseYaw + t.yawWobble, 0);
      t.visual.bodyPivot.rotation.set(t.pitchAngle, 0, t.rollAngle);
      t.visual.spinWheels(t.distRolled);
      if (t.brakeTimer > 0) {
        this.audio.setSkidIntensity(0.75);
        if (Math.random() < 0.65) {
          this.vfx.spawnSmoke(wt.x, wt.y + 0.16, wt.z - (t.oncoming ? -1.4 : 1.4), 1, 0.9);
        }
      }
      t.visual.setHazard(this.totalElapsed, t.hazardTimer > 0 || t.brakeTimer > 0);
      if (t.kind === "police") {
        t.visual.setStrobe(this.totalElapsed, true);
      }
    }

    if (this.helicopter && this.helicopter.root.visible) {
      const hS = this.player.s + 24;
      const wh = this.track.toWorld(hS, Math.sin(this.totalElapsed * 1.1) * 4.5);
      const hoverY = wh.y + 18 + Math.sin(this.totalElapsed * 1.9) * 1.0;
      this.helicopter.root.position.set(wh.x, hoverY, wh.z);
      this.helicopter.root.rotation.set(0.16, wh.yaw + Math.PI, Math.sin(this.totalElapsed * 1.1) * 0.14);
      this.helicopter.searchBeam.visible = this.activeStage.isNight;
      this.helicopter.spotPool.visible = this.activeStage.isNight;
      this.helicopter.update(dt, this.totalElapsed, wh.y);
    }
  }

  private findSafeTrafficSpawn(t: TrafficSim, playerS: number): void {
    const startIdx = Math.abs(t.id + Math.round(playerS * 0.03)) % LANE_CENTERS.length;
    for (let attempt = 0; attempt < 16; attempt++) {
      const laneSlot = (startIdx + attempt) % LANE_CENTERS.length;
      const candLane = LANE_CENTERS[laneSlot];
      const candS = playerS + 235 + Math.floor(attempt / 4) * 38 + Math.random() * 45;
      const blocked = this.traffic.some(
        (o) =>
          o !== t &&
          o.disabledTimer <= 0 &&
          Math.abs(o.laneX - candLane) < t.halfWidth + o.halfWidth + 0.65 &&
          Math.abs(o.s - candS) < t.halfLength + o.halfLength + 20
      );
      if (!blocked) {
        t.homeLaneX = candLane;
        t.laneX = candLane;
        t.oncoming = laneSlot < 2;
        t.desiredSpeed = LANE_SPEEDS[laneSlot] + (t.oncoming ? -(t.id % 3) : (t.id % 3) * 1.5);
        t.speed = t.desiredSpeed;
        t.s = candS;
        t.nearMissed = false;
        t.latVel = 0;
        t.yawWobble = 0;
        t.pitchAngle = 0;
        t.rollAngle = 0;
        t.brakeTimer = 0;
        t.hazardTimer = 0;
        t.slammedByPlayer = false;
        t.slammedByPlayerTimer = 0;
        return;
      }
    }
    t.s = playerS + 340 + Math.random() * 80;
    t.laneX = t.homeLaneX;
    t.speed = t.desiredSpeed;
    t.nearMissed = false;
    t.slammedByPlayer = false;
    t.slammedByPlayerTimer = 0;
  }

  private resolveCarVsCarCollisions(): void {
    for (let i = 0; i < this.traffic.length; i++) {
      const a = this.traffic[i];
      if (a.disabledTimer > 0) continue;
      for (let j = i + 1; j < this.traffic.length; j++) {
        const b = this.traffic[j];
        if (b.disabledTimer > 0) continue;
        const minLen = a.halfLength + b.halfLength + 0.9;
        const minWid = a.halfWidth + b.halfWidth + 0.35;
        const ds = b.s - a.s;
        const dx = b.laneX - a.laneX;
        const overlapS = minLen - Math.abs(ds);
        const overlapX = minWid - Math.abs(dx);
        if (overlapS <= 0 || overlapX <= 0) continue;

        if (a.roadblock || b.roadblock) {
          const mob = a.roadblock ? b : a;
          const blk = a.roadblock ? a : b;
          const signS = mob.s >= blk.s ? 1 : -1;
          mob.s = blk.s + signS * (blk.halfLength + mob.halfLength + 1.0);
          mob.speed *= -0.15;
          mob.brakeTimer = Math.max(mob.brakeTimer, 1.5);
          continue;
        }

        if (overlapX < overlapS * 0.45 && overlapX < 1.6) {
          const pushX = (Math.sign(dx || (a.id < b.id ? 1 : -1)) * overlapX) * 0.54;
          a.laneX = Math.max(-PLAYABLE_HALF_WIDTH + a.halfWidth, Math.min(PLAYABLE_HALF_WIDTH - a.halfWidth, a.laneX - pushX));
          b.laneX = Math.max(-PLAYABLE_HALF_WIDTH + b.halfWidth, Math.min(PLAYABLE_HALF_WIDTH - b.halfWidth, b.laneX + pushX));
          a.latVel -= Math.sign(pushX) * 2.2;
          b.latVel += Math.sign(pushX) * 2.2;
        } else {
          const signS = ds >= 0 ? 1 : -1;
          const pushS = overlapS * 0.54;
          a.s -= signS * pushS;
          b.s += signS * pushS;
          const avgSpd = (a.speed + b.speed) * 0.5;
          a.speed = signS > 0 ? Math.min(a.speed, avgSpd) : Math.max(a.speed, avgSpd);
          b.speed = signS > 0 ? Math.max(b.speed, avgSpd) : Math.min(b.speed, avgSpd);
        }

        // Guarantee zero residual AABB penetration after lateral clamp
        if (Math.abs(a.s - b.s) < a.halfLength + b.halfLength + 0.3 && Math.abs(a.laneX - b.laneX) < a.halfWidth + b.halfWidth + 0.15) {
          const signS = b.s >= a.s ? 1 : -1;
          const extra = (a.halfLength + b.halfLength + 0.5 - Math.abs(a.s - b.s)) * 0.52;
          a.s -= signS * extra;
          b.s += signS * extra;
        }

        if (a.slammedByPlayerTimer > 0 || b.slammedByPlayerTimer > 0) {
          const slamDir = Math.sign(dx || 1);
          a.slammedByPlayer = true;
          b.slammedByPlayer = true;
          a.slammedByPlayerTimer = 4.0;
          b.slammedByPlayerTimer = 4.0;
          a.rollAngle = slamDir * 0.14;
          b.rollAngle = -slamDir * 0.14;
          a.hazardTimer = 2.6;
          b.hazardTimer = 2.6;
          if (Math.abs(a.s - this.player.s) < 60) {
            this.audio.playCarHorn(0.95);
          }
        }
      }
    }

    let overlaps = 0;
    for (let i = 0; i < this.traffic.length; i++) {
      const a = this.traffic[i];
      if (a.disabledTimer > 0) continue;
      for (let j = i + 1; j < this.traffic.length; j++) {
        const b = this.traffic[j];
        if (b.disabledTimer > 0) continue;
        if (Math.abs(a.s - b.s) < a.halfLength + b.halfLength && Math.abs(a.laneX - b.laneX) < a.halfWidth + b.halfWidth) {
          overlaps++;
        }
      }
    }
    this.lastOverlapCount = overlaps;
  }

  private emitSnapshot(): void {
    const p = this.player;
    const speedMph = p ? p.speed * MPS_TO_MPH : 0;
    const intent = this.screen === "racing" ? this.input.sample() : null;

    const radarDots: UiSnapshot["radarDots"] = [];
    const targetReticles: TargetReticle[] = [];

    if (p) {
      for (const r of this.racers) {
        if (r.isPlayer || r.crashed) continue;
        const dz = r.s - p.s;
        if (Math.abs(dz) < 85) {
          radarDots.push({ dx: r.laneX - p.laneX, dz, kind: r.isCop ? "cop" : "rival" });
        }
        // Project close combat-range rival bikes to screen HUD reticles
        if (this.screen === "racing" && dz > -1.5 && dz < 14 && targetReticles.length < 3) {
          const wp = this.track.toWorld(r.s, r.laneX);
          this.tmpProj.set(wp.x, wp.y + r.yOffset + 1.55, wp.z);
          this.tmpProj.project(this.pipeline.camera);
          if (this.tmpProj.z < 1) {
            const xPct = (this.tmpProj.x * 0.5 + 0.5) * 100;
            const yPct = (-this.tmpProj.y * 0.5 + 0.5) * 100;
            if (xPct > 6 && xPct < 94 && yPct > 8 && yPct < 88) {
              targetReticles.push({
                id: r.id,
                name: r.profile ? r.profile.codename : r.name,
                xPct,
                yPct,
                staminaNorm: r.stamina / r.maxStamina,
                isCop: r.isCop,
                threatening: r.attackTimer > 0 && r.attackSide !== 0,
              });
            }
          }
        }
      }
      for (const t of this.traffic) {
        if (t.disabledTimer > 0) continue;
        const dz = t.s - p.s;
        if (Math.abs(dz) < 85) {
          radarDots.push({ dx: t.laneX - p.laneX, dz, kind: t.kind === "police" ? "cop" : "traffic" });
        }
      }
    }

    const countdownText =
      this.countdownTimer > 1.7 ? "3" : this.countdownTimer > 0.85 ? "2" : this.countdownTimer > 0 ? "1" : "";

    this.onUiUpdate({
      screen: this.screen,
      save: this.save,
      stage: this.activeStage,
      speedMph,
      gear: Math.min(6, Math.max(1, Math.floor(speedMph / 42) + 1)),
      rpmNorm: (speedMph % 42) / 42,
      rank: this.computePlayerRank(),
      totalRacers: 8,
      progress: p ? Math.min(1, Math.max(0, p.s / this.activeStage.lengthMeters)) : 0,
      staminaNorm: p ? p.stamina / p.maxStamina : 1,
      armorNorm: p ? p.armor / p.maxArmor : 1,
      nitroNorm: this.maxNitro > 0 ? this.nitro / this.maxNitro : 1,
      focusNorm: this.maxFocus > 0 ? this.focus / this.maxFocus : 1,
      empNorm: 0,
      focusActive: !!(intent && intent.bulletTime && this.focus > 4 && !p?.crashed),
      nitroActive: !!(intent && intent.nitro && this.nitro > 1 && !p?.crashed && speedMph > 20),
      weapon: p ? p.weapon : "knuckle",
      wantedHeat: this.wantedHeat,
      multiplier: this.multiplier,
      nearMissCount: this.nearMissCount,
      knockoutCount: this.knockoutCount,
      raceCashEarned: this.raceCashEarned,
      crashed: p ? p.crashed : false,
      countdownText,
      bannerText: this.bannerTimer > 0 ? this.bannerText : "",
      comms: this.comms,
      results: this.results,
      radarDots,
      targetReticles,
    });
  }

  private registerDebugApi(): void {
    window.__GAME_DEBUG__ = {
      startRace: (stageId?: string, skipCountdown?: boolean) =>
        this.startRace((stageId as StageId) || this.save.selectedStageId, !!skipCountdown),
      openGarage: () => this.setScreen("hangar"),
      openDistricts: () => this.setScreen("districts"),
      setQuality: (q) => this.setQualityPreset(q),
      setBotInput: (intent) => this.input.setBotIntent(intent as never),
      setPlayerTrackS: (s: number, laneOffset?: number, speedMph?: number) => {
        if (!this.player) return;
        this.player.s = s;
        this.player.crashed = false;
        this.player.crashTimer = 0;
        if (typeof laneOffset === "number") this.player.laneX = laneOffset;
        if (typeof speedMph === "number") this.player.speed = speedMph * 0.44704;
        this.player.vx = 0;
        this.player.lean = 0;
        for (const t of this.traffic) {
          if (Math.abs(t.s - s) < 110) {
            t.s = s + 190 + Math.random() * 140;
          }
        }
        const pW = this.track.toWorld(this.player.s, this.player.laneX);
        this.cameraRig.reset(pW.yaw, pW.y);
      },
      triggerHeliView: () => {
        if (this.player) {
          this.wantedHeat = 5;
          if (this.helicopter) this.helicopter.root.visible = true;
          this.spawnPoliceInterceptor(14);
        }
      },
      addCash: (amount: number) => {
        this.save.cash += amount;
        persistSave(this.save);
        this.emitSnapshot();
      },
      setCameraMode: (mode: number) => {
        this.save.settings.cameraMode = mode % 3;
      },
      cycleRadioStation: () => this.cycleRadioStation(),
      forceCarCrashTest: () => {
        if (!this.player) return;
        this.countdownTimer = 0;
        this.postCrashGhostTimer = 0;
        this.player.crashed = false;
        this.player.crashTimer = 0;
        this.player.speed = 65; // ~145 MPH
        this.player.laneX = 2.0;
        const targetCar = this.traffic.find((t) => t.kind === "exotic" && !t.roadblock) || this.traffic[0];
        if (targetCar) {
          targetCar.disabledTimer = 0;
          targetCar.oncoming = false;
          targetCar.homeLaneX = 1.95;
          targetCar.desiredSpeed = 20;
          targetCar.speed = 20;
          targetCar.s = this.player.s + 10.5;
          targetCar.laneX = this.player.laneX;
          for (const other of this.traffic) {
            if (other !== targetCar && Math.abs(other.s - targetCar.s) < 16) {
              other.s += 36;
            }
          }
        }
        const pW = this.track.toWorld(this.player.s, this.player.laneX);
        this.cameraRig.reset(pW.yaw, pW.y);
      },
    };
  }
}
