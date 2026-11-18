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
  laneX: number;
  yOffset: number;
  vy: number;
  vx: number;
  speed: number;
  lean: number;
  stamina: number;
  maxStamina: number;
  armor: number;
  maxArmor: number;
  weapon: WeaponId;
  attackCooldown: number;
  attackTimer: number;
  attackSide: -1 | 0 | 1;
  attackType: "melee" | "kick";
  attackHitDone: boolean;
  crashed: boolean;
  crashTimer: number;
  crashDir: number;
  empStunTimer: number;
  finished: boolean;
  finishTime: number;
  visual: SuperbikeVisual;
  rider: ArmoredRiderVisual;
  targetLaneX: number;
  laneTimer: number;
}

interface TrafficSim {
  id: number;
  kind: TrafficKind;
  halfWidth: number;
  halfLength: number;
  s: number;
  distRolled: number;
  laneX: number;
  speed: number;
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
  private empCharge = 100;
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

    this.raceGroup.add(this.track.group);
    this.raceGroup.add(this.vfx.group);

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

    const ringBorder = new THREE.Mesh(new THREE.RingGeometry(6.15, 6.26, 48), this.kit.makeNeonMaterial(0x00f0ff, 1.4));
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
    this.hangarRider = createArmoredRiderInstance(this.assets, 0x181c26, aHex, "katana");
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
    const pRider = createArmoredRiderInstance(this.assets, 0x161b26, accent, "knuckle");
    pBike.chassisPivot.add(pRider.root);
    this.raceGroup.add(pBike.root);

    this.player = {
      id: "player",
      name: "YOU",
      isPlayer: true,
      isCop: false,
      s: 12,
      laneX: 0,
      yOffset: 0,
      vy: 0,
      vx: 0,
      speed: 0,
      lean: 0,
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
      empStunTimer: 0,
      finished: false,
      finishTime: 0,
      visual: pBike,
      rider: pRider,
      targetLaneX: 0,
      laneTimer: 0,
    };
    this.racers.push(this.player);

    // 7 High-Poly Rival Superbikes in tight combat pack ahead
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
        empStunTimer: 0,
        finished: false,
        finishTime: 0,
        visual: rBike,
        rider: rRider,
        targetLaneX: lane,
        laneTimer: 1 + idx * 0.25,
      });
    });

    // High-Poly Supercar & Freight Traffic Pool
    const kinds: TrafficKind[] = ["exotic", "sedan", "muscle", "truck", "exotic"];
    const poolCount = Math.min(7, this.activeStage.trafficDensity);
    for (let i = 0; i < poolCount; i++) {
      const kind = kinds[i % kinds.length];
      const vis = createTrafficVehicleInstance(this.assets, this.kit, kind, i);
      this.raceGroup.add(vis.root);
      const oncoming = i % 2 === 1;
      const laneX = oncoming ? (i % 4 === 1 ? -4.9 : -1.9) : i % 4 === 0 ? 1.9 : 4.9;
      this.traffic.push({
        id: i,
        kind,
        halfWidth: kind === "truck" ? 1.15 : 1.02,
        halfLength: kind === "truck" ? 3.1 : 2.28,
        s: 110 + i * 48,
        distRolled: 0,
        laneX,
        speed: oncoming ? -(22 + (i % 3) * 4) : 24 + (i % 4) * 3,
        oncoming,
        roadblock: false,
        nearMissed: false,
        hp: 100,
        disabledTimer: 0,
        visual: vis,
      });
    }

    // Active Bell Huey Pursuit Helicopter
    this.helicopter = createPursuitHelicopterInstance(this.assets);
    this.helicopter.root.visible = this.activeStage.hasHelicopter;
    this.raceGroup.add(this.helicopter.root);

    this.maxNitro = bikeSpec.nitroCapacity * capMul;
    this.nitro = this.maxNitro;
    this.maxFocus = 100 * capMul;
    this.focus = this.maxFocus;
    this.empCharge = 100;
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
    this.nextRoadblockS = 950;
    this.nextInterceptorCheckS = 600;
    this.results = null;
    this.bannerText = this.activeStage.name;
    this.bannerTimer = 2.2;
    this.input.clearFocus();

    const boss = BOSS_BIOS[this.activeStage.bossId];
    this.pushComms(boss.name, boss.title, boss.portraitUrl, boss.quote);

    const startPt = this.track.sample(this.player.s);
    const aheadPt = this.track.sample(this.player.s + 22);
    this.cameraRig.reset(startPt.x, startPt.y);
    this.track.update(this.player.s, 0);
    this.syncVisuals(0.016, false, false);
    this.vfx.update(0.016, startPt.x, startPt.y, this.player.s, 0, this.activeStage.hasRain);
    this.pipeline.syncFollowRig(startPt.x, startPt.y, this.player.s);
    this.cameraRig.updateRace(
      this.pipeline.camera,
      0.016,
      startPt.x,
      startPt.y,
      this.player.s,
      aheadPt.x,
      aheadPt.y,
      0,
      false,
      0,
      this.save.settings.cameraMode,
      0
    );

    this.screen = "racing";
    this.audio.startMusic(this.activeStage.musicRootHz, this.activeStage.musicBpm);
    this.emitSnapshot();
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
    this.traffic.push({
      id: 9000 + Math.round(aheadS),
      kind: "police",
      halfWidth: 1.04,
      halfLength: 2.32,
      s: Math.max(20, this.player.s + aheadS),
      distRolled: 0,
      laneX: this.player.laneX > 0 ? -3.4 : 3.4,
      speed: Math.max(46, this.player.speed * 0.96),
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
      name: `APEX-0${existingCops + 1}`,
      isPlayer: false,
      isCop: true,
      s: Math.max(20, this.player.s + aheadS),
      laneX: lane,
      yOffset: 0,
      vy: 0,
      vx: 0,
      speed: Math.max(48, this.player.speed * 0.92),
      lean: 0,
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
      empStunTimer: 0,
      finished: false,
      finishTime: 0,
      visual: bike,
      rider,
      targetLaneX: lane,
      laneTimer: 0.7,
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
        speed: 0,
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
        speed: 0,
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
    this.pushComms(cross.name, cross.title, cross.portraitUrl, "Interceptor barricade deployed ahead! Box that runner in!");
  }

  public triggerEmp(): void {
    if (this.screen !== "racing" || !this.player || this.empCharge < 99.5) return;
    this.empCharge = 0;
    const pPt = this.track.sample(this.player.s);
    this.vfx.triggerEmp(pPt.x + this.player.laneX, pPt.y + this.player.yOffset, this.player.s);
    this.cameraRig.addTrauma(0.55);
    this.audio.playEmpBlast();
    this.wantedHeat = Math.min(5, this.wantedHeat + 1);

    let hits = 0;
    for (const r of this.racers) {
      if (r.isPlayer || r.crashed || r.finished) continue;
      if (Math.hypot(r.s - this.player.s, r.laneX - this.player.laneX) <= 24) {
        r.empStunTimer = 3.2;
        r.stamina = Math.max(0, r.stamina - 52);
        r.vx += Math.sign(r.laneX - this.player.laneX || 1) * 7.5;
        hits++;
        if (r.stamina <= 0) {
          this.knockoutRacer(r, Math.sign(r.laneX - this.player.laneX || 1));
        }
      }
    }

    for (const t of this.traffic) {
      if ((t.roadblock || t.kind === "police") && Math.abs(t.s - this.player.s) <= 26) {
        const pt = this.track.sample(t.s);
        this.vfx.spawnExplosion(pt.x + t.laneX, pt.y + 0.6, t.s, 1.4);
        t.disabledTimer = 8;
        t.s -= 80;
        hits++;
      }
    }

    if (hits > 0) {
      const empBonus = hits * 350;
      this.raceCashEarned += empBonus;
      this.showBanner(`EMP SHOCKWAVE! x${hits} +$${empBonus}`, 2.0);
    } else {
      this.showBanner("EMP PULSE DISCHARGED!", 1.4);
    }
  }

  private knockoutRacer(target: BikerSim, dir: number): void {
    target.crashed = true;
    target.crashTimer = target.isCop ? 4.5 : 3.0;
    target.crashDir = dir || 1;
    target.speed *= 0.25;
    target.stamina = target.maxStamina;
    this.knockoutCount++;
    const bonus = target.isCop ? 750 : 450;
    this.raceCashEarned += bonus;
    this.multiplier = Math.min(10, Number((this.multiplier + 0.5).toFixed(1)));
    this.multiplierTimer = 5.0;
    this.empCharge = Math.min(100, this.empCharge + 28);
    this.wantedHeat = Math.min(5, Math.max(this.wantedHeat, target.isCop ? 4 : 2));
    this.hitstopTimer = 0.05;
    this.takedownSlowMo = 0.38;
    this.cameraRig.addTrauma(0.7);

    const pt = this.track.sample(target.s);
    this.vfx.spawnExplosion(pt.x + target.laneX, pt.y + 0.5, target.s, 1.15);
    this.audio.playCrash();

    if (target.profile) {
      this.player.weapon = target.weapon;
      this.showBanner(`TAKEDOWN: ${target.profile.name.toUpperCase()}! +$${bonus}`, 2.1);
      this.pushComms(target.profile.name.toUpperCase(), target.profile.role, target.profile.portraitUrl, target.profile.taunt);
    } else {
      this.showBanner(`INTERCEPTOR NEUTRALIZED! +$${bonus}`, 2.1);
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
        const labels = ["CAMERA: DYNAMIC CHASE", "CAMERA: BRAWLER CLOSE", "CAMERA: HELMET VISOR POV"];
        this.showBanner(labels[this.save.settings.cameraMode], 1.1);
      }

      const focusActive = intent.bulletTime && this.focus > 4 && this.countdownTimer <= 0 && !this.player.crashed;
      if (focusActive) {
        this.focus = Math.max(0, this.focus - rawDt * 24);
        if (this.focus <= 0) this.input.clearFocus();
      } else {
        const capMul = 1 + (this.save.upgrades.capacitor || 0) * 0.22;
        this.focus = Math.min(this.maxFocus, this.focus + rawDt * 7 * capMul);
      }

      if (this.hitstopTimer > 0) {
        this.hitstopTimer = Math.max(0, this.hitstopTimer - rawDt);
        this.pipeline.render();
        return;
      }

      const simScale = focusActive ? 0.42 : this.takedownSlowMo > 0 ? 0.38 : 1.0;
      const simDt = rawDt * simScale;
      this.stepRace(simDt, rawDt, wallDt, intent, focusActive);
    }

    const speedMph = this.player ? this.player.speed * MPS_TO_MPH : 0;
    const isFocus = this.screen === "racing" && this.input.sample().bulletTime && this.focus > 4;
    this.pipeline.updatePostFX(Math.min(1, speedMph / 245), isFocus ? 1.0 : 0.0, this.damageFlash);
    this.pipeline.render();

    this.diagnostics.update(rawDt, this.pipeline.renderer, {
      title: "REDLINE SYNDICATE",
      state: this.screen,
      quality: this.save.settings.quality,
      stageId: this.activeStage.id,
      speedMph: Math.round(speedMph),
      distanceMeters: Math.round(this.player ? this.player.s : 0),
      rank: this.computePlayerRank(),
      wantedHeat: this.wantedHeat,
      stamina: Math.round(this.player ? this.player.stamina : 100),
      armor: Math.round(this.player ? this.player.armor : 100),
      cash: this.save.cash,
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
        this.showBanner("REDLINE! BURN THE DECK!", 1.4);
      }
      const pPt = this.track.sample(this.player.s);
      const aheadPt = this.track.sample(this.player.s + 22);
      this.track.update(this.player.s, this.totalElapsed);
      this.syncVisuals(rawDt, false, false);
      this.vfx.update(rawDt, pPt.x + this.player.laneX, pPt.y + this.player.yOffset, this.player.s, 0, this.activeStage.hasRain);
      this.pipeline.syncFollowRig(pPt.x + this.player.laneX, pPt.y, this.player.s);
      this.cameraRig.updateRace(
        this.pipeline.camera,
        rawDt,
        pPt.x + this.player.laneX,
        pPt.y + this.player.yOffset,
        this.player.s,
        aheadPt.x,
        aheadPt.y,
        0,
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

    const p = this.player;
    const baseMaxMps = bikeSpec.topSpeedMph * turbineMul * 0.44704;
    const nitroActive = intent.nitro && this.nitro > 1 && !p.crashed && (intent.throttle || p.speed > 20);
    if (nitroActive) {
      this.nitro = Math.max(0, this.nitro - rawDt * 22);
    } else {
      this.nitro = Math.min(this.maxNitro, this.nitro + rawDt * 5.5 * capMul);
    }

    if (intent.empPressed) {
      this.triggerEmp();
    }

    const trackPt = this.track.sample(p.s);
    const maxSpeed = nitroActive ? baseMaxMps * 1.26 : baseMaxMps;
    if (p.crashed) {
      p.crashTimer -= rawDt;
      p.speed = Math.max(0, p.speed - 38 * rawDt);
      p.laneX = Math.max(-PLAYABLE_HALF_WIDTH, Math.min(PLAYABLE_HALF_WIDTH, p.laneX + p.vx * dt));
      p.vx *= Math.exp(-3.5 * dt);
      if (p.speed > 10 && Math.random() < 0.45) {
        this.vfx.spawnSmoke(trackPt.x + p.laneX, trackPt.y + 0.25, p.s, 2, 1.1);
      }
      if (p.crashTimer <= 0) {
        p.crashed = false;
        p.stamina = p.maxStamina;
        p.speed = 24;
        p.vx = 0;
        p.laneX = Math.max(-5.5, Math.min(5.5, p.laneX));
        this.showBanner("BACK ON THE THROTTLE!", 1.2);
      }
    } else {
      const accelPush = nitroActive
        ? bikeSpec.accel * turbineMul * 1.8
        : intent.throttle
          ? bikeSpec.accel * turbineMul
          : 0;
      const brakePull = intent.brake ? 52 : 0;
      const drag = p.speed * p.speed * (accelPush > 0 ? 0.0022 : 0.0046);
      const offroadPenalty = Math.abs(p.laneX) > PLAYABLE_HALF_WIDTH ? 0.72 : 1.0;

      p.speed = Math.max(0, Math.min(maxSpeed * offroadPenalty, p.speed + (accelPush - brakePull - drag * 0.55) * dt));
      if (p.speed < maxSpeed * 0.5 && accelPush > 0) {
        p.speed += accelPush * 0.4 * dt;
      }

      const steerStep = (focusActive ? rawDt : dt) * 14.2 * bikeSpec.handling * gripMul * (0.45 + 0.55 * Math.min(1, p.speed / 45));
      p.laneX += intent.steer * steerStep + p.vx * dt;
      p.vx *= Math.exp(-5.0 * dt);

      const targetLean = intent.steer * 0.68 * (0.35 + 0.65 * Math.min(1, p.speed / 55));
      p.lean += (targetLean - p.lean) * (1 - Math.exp(-11 * rawDt));

      if (Math.abs(p.laneX) > SHOULDER_LIMIT) {
        p.laneX = Math.sign(p.laneX) * SHOULDER_LIMIT;
        p.vx = -Math.sign(p.laneX) * 5.2;
        if (p.speed > 38) {
          this.vfx.spawnBurst(trackPt.x + p.laneX, trackPt.y + 0.5, p.s, 0xffaa00, 12, 8, 0.9);
          this.vfx.spawnSmoke(trackPt.x + p.laneX, trackPt.y + 0.3, p.s, 2, 0.9);
          this.cameraRig.addTrauma(0.24);
          p.speed *= 0.88;
        }
      }

      // Hard corner / heavy brake tire smoke plume
      if ((Math.abs(p.lean) > 0.46 || intent.brake) && p.speed > 32 && Math.random() < 0.35) {
        this.vfx.spawnSmoke(trackPt.x + p.laneX, trackPt.y + 0.12, p.s - 0.7, 1, 0.75);
      }

      for (const r of this.racers) {
        if (!r.isPlayer && r.s > p.s && r.s - p.s < 16 && Math.abs(r.laneX - p.laneX) < 1.8) {
          p.speed += 6.5 * dt;
          this.nitro = Math.min(this.maxNitro, this.nitro + 10 * dt);
        }
      }

      for (const pad of this.track.pads) {
        if (Math.abs(p.s - pad.s) < 2.6 && Math.abs(p.laneX - pad.laneX) < 1.9) {
          if (pad.kind === "nitro" && this.nitro < this.maxNitro) {
            this.nitro = Math.min(this.maxNitro, this.nitro + 36);
            p.speed = Math.min(baseMaxMps * 1.3, p.speed + 16);
            this.audio.playTone(920, 0.14, 0.25);
          } else if (pad.kind === "emp" && this.empCharge < 100) {
            this.empCharge = Math.min(100, this.empCharge + 45);
            this.audio.playTone(740, 0.14, 0.25);
          }
        }
      }
    }

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

    // Spawn Biker Cops, Police Ferrari Interceptors, and Roadblocks
    if (p.s > this.activeStage.copThresholdMeters && this.wantedHeat < 2) {
      this.wantedHeat = 2;
      this.spawnCopUnit(18);
      this.spawnPoliceInterceptor(28);
      this.pushComms(BOSS_BIOS.cross.name, BOSS_BIOS.cross.title, BOSS_BIOS.cross.portraitUrl, "Apex Interceptor Supercars dispatched! Box that runner in!");
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
          if (a.isPlayer || b.isPlayer) {
            const pt = this.track.sample(p.s);
            this.vfx.spawnBurst(pt.x + p.laneX, pt.y + 0.7, p.s, 0xffaa00, 6, 6, 0.8);
          }
        }
      }
    }

    // Traffic & Active Police Ferrari Pursuit AI
    for (const t of this.traffic) {
      if (t.disabledTimer > 0) t.disabledTimer = Math.max(0, t.disabledTimer - dt);
      if (t.kind === "police" && !t.roadblock) {
        if (t.disabledTimer <= 0) {
          // Police Ferrari actively matches player speed & sideswipes nearby
          const targetSpd = Math.min(72, Math.max(40, p.speed + (p.s - t.s) * 0.65));
          t.speed += (targetSpd - t.speed) * (1 - Math.exp(-3.2 * dt));
          t.s += t.speed * dt;
          t.distRolled += t.speed * dt;
          const desiredX = Math.abs(t.s - p.s) < 16 ? p.laneX + (p.laneX > 0 ? -2.3 : 2.3) : Math.sin(this.totalElapsed + t.id) * 3.5;
          t.laneX += Math.max(-1, Math.min(1, desiredX - t.laneX)) * 5.2 * dt;

          // Heavy Kick or Melee into Police Interceptor can slam & destroy it!
          if (!p.crashed && p.attackTimer > 0 && Math.abs(p.s - t.s) < 3.2 && Math.abs(p.laneX - t.laneX) < 3.0) {
            t.hp -= 55;
            const pt = this.track.sample(t.s);
            this.vfx.spawnBurst(pt.x + t.laneX, pt.y + 0.6, t.s, 0x00f0ff, 22, 12, 1.2);
            if (t.hp <= 0) {
              t.disabledTimer = 10;
              t.s -= 80;
              this.knockoutCount++;
              this.raceCashEarned += 750;
              this.takedownSlowMo = 0.42;
              this.cameraRig.addTrauma(0.75);
              this.vfx.spawnExplosion(pt.x + t.laneX, pt.y + 0.7, t.s + 80, 1.45);
              this.audio.playCrash();
              this.showBanner("INTERCEPTOR SUPERCAR WRECKED! +$750", 2.1);
            }
          }
        }
      } else if (!t.roadblock) {
        t.s += t.speed * dt;
        t.distRolled += t.speed * dt;
        if (t.s < p.s - 35) {
          t.s = p.s + 260 + Math.random() * 140;
          t.nearMissed = false;
        } else if (t.s > p.s + 420) {
          t.s = p.s + 240 + Math.random() * 140;
          t.nearMissed = false;
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
          this.empCharge = Math.min(100, this.empCharge + 10);
          this.audio.playNearMiss();
          this.showBanner(`NEAR MISS! x${this.multiplier.toFixed(1)} +$${bonus}`, 1.1);
        }
      }

      if (!p.crashed && p.yOffset < 1.35 && Math.abs(p.s - t.s) < t.halfLength + 0.85) {
        if (Math.abs(p.laneX - t.laneX) < t.halfWidth + 0.42) {
          this.triggerPlayerCrash(Math.sign(p.laneX - t.laneX || 1), 24);
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

    const pPt = this.track.sample(p.s);
    const aheadPt = this.track.sample(p.s + 22);
    this.vfx.update(rawDt, pPt.x + p.laneX, pPt.y + p.yOffset, p.s, p.speed, this.activeStage.hasRain);
    this.pipeline.syncFollowRig(pPt.x + p.laneX, pPt.y, p.s);
    this.cameraRig.updateRace(
      this.pipeline.camera,
      rawDt,
      pPt.x + p.laneX,
      pPt.y + p.yOffset,
      p.s,
      aheadPt.x,
      aheadPt.y,
      Math.min(1, p.speed / (bikeSpec.topSpeedMph * 0.44704)),
      nitroActive,
      p.lean,
      this.save.settings.cameraMode,
      this.totalElapsed
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
          const pt = this.track.sample(r.s);
          this.vfx.spawnBurst(pt.x + r.laneX, pt.y + 0.2, r.s, 0xffaa00, 12, 7, 1.0);
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

    if (r.empStunTimer > 0) {
      r.empStunTimer -= dt;
      r.speed *= Math.exp(-1.5 * dt);
      r.s += r.speed * dt;
      return;
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
      r.laneTimer = 0.6 + Math.random() * 0.8;
      if (r.isCop && Math.abs(r.s - this.player.s) < 18) {
        r.targetLaneX = this.player.laneX + (this.player.laneX > 0 ? -1.4 : 1.4);
      } else {
        r.targetLaneX = Math.max(-5.5, Math.min(5.5, r.laneX + (Math.random() - 0.5) * 4.5));
      }
    }

    for (const t of this.traffic) {
      if (t.s > r.s && t.s - r.s < 32 && Math.abs(t.laneX - r.laneX) < t.halfWidth + 1.0) {
        r.targetLaneX = t.laneX > 0 ? Math.max(-5.5, t.laneX - 3.2) : Math.min(5.5, t.laneX + 3.2);
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

        const pt = this.track.sample(target.s);
        this.vfx.spawnBurst(pt.x + target.laneX, pt.y + 0.9, target.s, 0x00f0ff, 16, 10, 1.0);

        if (target.isPlayer) {
          this.damageFlash = 0.7;
          this.cameraRig.addTrauma(0.38);
          this.audio.playStrike(true);
          if (target.stamina <= 0) {
            this.triggerPlayerCrash(attacker.attackSide, 18);
          }
        } else {
          this.cameraRig.addTrauma(0.32);
          this.hitstopTimer = 0.03;
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

  private triggerPlayerCrash(dir: number, armorDamage: number): void {
    const p = this.player;
    p.crashed = true;
    p.crashTimer = 2.0;
    p.crashDir = dir;
    p.vx = dir * 4.5;
    p.speed *= 0.25;
    p.armor = Math.max(0, p.armor - armorDamage);
    this.multiplier = 1.0;
    this.damageFlash = 1.0;
    this.hitstopTimer = 0.05;
    this.cameraRig.addTrauma(0.85);
    this.audio.playCrash();

    const pt = this.track.sample(p.s);
    this.vfx.spawnExplosion(pt.x + p.laneX, pt.y + 0.5, p.s, 1.25);
    this.showBanner(p.armor <= 0 ? "CHASSIS TOTALED!" : "WIPEOUT! HOLD LINE!", 1.8);
  }

  private finishRace(outcome: "finished" | "wrecked" | "busted"): void {
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
      const visible = r.isPlayer || (r.s > this.player.s - 16 && r.s < this.player.s + 155);
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
      const pt = this.track.sample(r.s);
      r.visual.root.position.set(pt.x + r.laneX, pt.y + r.yOffset, r.s);
      const yaw = Math.atan2(pt.dxDs, 1);
      const pitch = -Math.atan2(pt.dyDs, 1);
      r.visual.root.rotation.set(pitch, yaw, 0);

      if (r.crashed) {
        r.visual.chassisPivot.rotation.z = -r.crashDir * 1.15;
        r.visual.chassisPivot.position.y = 0.25;
      } else {
        r.visual.chassisPivot.rotation.z = -r.lean;
        r.visual.chassisPivot.position.y = 0;
      }

      const showFlame = r.isPlayer ? playerNitro : r.speed > 62;
      r.visual.setEffects(r.speed, dt, showFlame && !r.crashed, r.isPlayer ? playerBraking : false);

      const dur = r.attackType === "kick" ? 0.24 : WEAPONS[r.weapon].swingDuration;
      const prog = r.attackTimer > 0 ? 1 - r.attackTimer / dur : 0;
      r.rider.updatePose(
        r.lean / 0.68,
        Math.min(1, r.speed / 85),
        prog,
        r.attackSide,
        r.attackType,
        this.totalElapsed
      );
    }

    for (const t of this.traffic) {
      const visible = t.disabledTimer <= 0 && t.s > this.player.s - 16 && t.s < this.player.s + 165;
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
      const pt = this.track.sample(t.s);
      t.visual.root.position.set(pt.x + t.laneX, pt.y, t.s);
      const yaw = Math.atan2(pt.dxDs, 1) + (t.oncoming ? Math.PI : t.roadblock ? Math.PI / 2 : 0);
      t.visual.root.rotation.set(0, yaw, 0);
      t.visual.spinWheels(t.distRolled);
      if (t.kind === "police") {
        t.visual.setStrobe(this.totalElapsed, true);
      }
    }

    if (this.helicopter && this.helicopter.root.visible) {
      const hS = this.player.s + 24;
      const pt = this.track.sample(hS);
      const hoverX = pt.x + Math.sin(this.totalElapsed * 1.1) * 5.5;
      const hoverY = pt.y + 18 + Math.sin(this.totalElapsed * 1.9) * 1.0;
      this.helicopter.root.position.set(hoverX, hoverY, hS);
      this.helicopter.root.rotation.set(0.16, Math.PI, Math.sin(this.totalElapsed * 1.1) * 0.14);
      this.helicopter.update(dt, this.totalElapsed, pt.y);
    }
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
          const pt = this.track.sample(r.s);
          this.tmpProj.set(pt.x + r.laneX, pt.y + r.yOffset + 1.55, r.s);
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
      empNorm: this.empCharge / 100,
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
      triggerEmp: () => this.triggerEmp(),
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
    };
  }
}
