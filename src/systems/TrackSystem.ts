import * as THREE from "three";
import { LoadedAssets } from "../assets/AssetLoader";
import { MaterialKit } from "../assets/MaterialLibrary";
import {
  createCoastalPalmTemplate,
  createSkyscraperTemplates,
  extractPropTemplate,
  PropTemplate,
} from "../assets/RealisticModels";
import { StageSpec } from "../data/stages";

export const ROAD_WIDTH = 16.8;
export const PLAYABLE_HALF_WIDTH = 7.1; // rightOffset spans [-7.1 Left .. +7.1 Right]
export const SHOULDER_LIMIT = 8.15;

export interface TrackSample {
  x: number;
  y: number;
  dxDs: number;
  d2xDs2: number;
  dyDs: number;
}

export interface TrackWorldPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  rightX: number;
  rightZ: number;
  pt: TrackSample;
}

export interface RampItem {
  s: number;
  laneX: number;
  width: number;
  length: number;
  height: number;
}

const SEGMENTS_VISIBLE = 76;
const SEG_LEN = 6; // 456m visible ribbon

// 8-column crowned cross-section [-0.5 .. +0.5] across highway width
const ROAD_COLS = [-0.5, -0.46, -0.25, -0.04, 0.04, 0.25, 0.46, 0.5];
const ROAD_COL_Y = [0.12, 0.0, 0.03, 0.05, 0.05, 0.03, 0.0, 0.12];

export class TrackSystem {
  public readonly group = new THREE.Group();
  private stage!: StageSpec;
  private kit: MaterialKit;

  private roadGeo: THREE.BufferGeometry;
  private roadMesh: THREE.Mesh;
  private shoulderGeo: THREE.BufferGeometry;
  private shoulderMesh: THREE.Mesh;
  private oceanGeo: THREE.BufferGeometry;
  private oceanMesh: THREE.Mesh;

  // Instanced Poly Haven PBR prop meshes + Coastal Palms
  private barrierInsts: THREE.InstancedMesh[] = [];
  private lampInsts: THREE.InstancedMesh[] = [];
  private treeInsts: THREE.InstancedMesh[] = [];
  private palmInsts: THREE.InstancedMesh[] = [];
  private shrubInsts: THREE.InstancedMesh[] = [];
  private boulderInsts: THREE.InstancedMesh[] = [];

  // Instanced highway infrastructure
  private gantryPostInst: THREE.InstancedMesh;
  private gantryBeamInst: THREE.InstancedMesh;
  private gantrySignInst: THREE.InstancedMesh;
  private bridgeDeckInst: THREE.InstancedMesh;
  private bridgePierInst: THREE.InstancedMesh;
  private towerInsts: THREE.InstancedMesh[] = [];
  private rampInst: THREE.InstancedMesh;
  private finishArch: THREE.Group;

  public ramps: RampItem[] = [];

  private tmpDummy = new THREE.Object3D();

  constructor(kit: MaterialKit, assets: LoadedAssets) {
    this.kit = kit;

    // 1. Dynamic 8-column Crowned Scanned Asphalt Highway
    const cols = ROAD_COLS.length;
    const vCount = (SEGMENTS_VISIBLE + 1) * cols;
    const roadPos = new Float32Array(vCount * 3);
    const roadNorm = new Float32Array(vCount * 3);
    const roadUv = new Float32Array(vCount * 2);
    const rIndices: number[] = [];
    for (let row = 0; row < SEGMENTS_VISIBLE; row++) {
      for (let col = 0; col < cols - 1; col++) {
        const a = row * cols + col;
        const b = a + 1;
        const c = (row + 1) * cols + col;
        const d = c + 1;
        // a->b = +Right (-X), a->c = +Forward (+Z) -> Right x Forward = +Y UP!
        rIndices.push(a, b, c, b, d, c);
      }
    }

    this.roadGeo = new THREE.BufferGeometry();
    this.roadGeo.setAttribute("position", new THREE.BufferAttribute(roadPos, 3));
    this.roadGeo.setAttribute("normal", new THREE.BufferAttribute(roadNorm, 3));
    this.roadGeo.setAttribute("uv", new THREE.BufferAttribute(roadUv, 2));
    this.roadGeo.setIndex(rIndices);
    this.roadMesh = new THREE.Mesh(this.roadGeo, kit.wetAsphaltMat);
    this.roadMesh.receiveShadow = true;
    this.roadMesh.frustumCulled = false;
    this.group.add(this.roadMesh);

    // 2. Wide Outer Sidewalk / Beach Sand Skirt (6 columns from Left -160m across Right +160m)
    const shCols = 6;
    const shVCount = (SEGMENTS_VISIBLE + 1) * shCols;
    const shPos = new Float32Array(shVCount * 3);
    const shNorm = new Float32Array(shVCount * 3);
    const shUv = new Float32Array(shVCount * 2);
    const shIndices: number[] = [];
    for (let row = 0; row < SEGMENTS_VISIBLE; row++) {
      for (let col = 0; col < shCols - 1; col++) {
        const a = row * shCols + col;
        const b = a + 1;
        const c = (row + 1) * shCols + col;
        const d = c + 1;
        shIndices.push(a, b, c, b, d, c);
      }
    }
    this.shoulderGeo = new THREE.BufferGeometry();
    this.shoulderGeo.setAttribute("position", new THREE.BufferAttribute(shPos, 3));
    this.shoulderGeo.setAttribute("normal", new THREE.BufferAttribute(shNorm, 3));
    this.shoulderGeo.setAttribute("uv", new THREE.BufferAttribute(shUv, 2));
    this.shoulderGeo.setIndex(shIndices);
    this.shoulderMesh = new THREE.Mesh(this.shoulderGeo, kit.shoulderGroundMat);
    this.shoulderMesh.receiveShadow = true;
    this.shoulderMesh.frustumCulled = false;
    this.group.add(this.shoulderMesh);

    // 3. Sunlit Coastal Pacific Ocean Ribbon (visible on beach stage to the right side of highway)
    const ocVCount = (SEGMENTS_VISIBLE + 1) * 2;
    const ocPos = new Float32Array(ocVCount * 3);
    const ocNorm = new Float32Array(ocVCount * 3);
    const ocUv = new Float32Array(ocVCount * 2);
    const ocIndices: number[] = [];
    for (let row = 0; row < SEGMENTS_VISIBLE; row++) {
      const a = row * 2;
      const b = a + 1;
      const c = (row + 1) * 2;
      const d = c + 1;
      ocIndices.push(a, b, c, b, d, c);
    }
    this.oceanGeo = new THREE.BufferGeometry();
    this.oceanGeo.setAttribute("position", new THREE.BufferAttribute(ocPos, 3));
    this.oceanGeo.setAttribute("normal", new THREE.BufferAttribute(ocNorm, 3));
    this.oceanGeo.setAttribute("uv", new THREE.BufferAttribute(ocUv, 2));
    this.oceanGeo.setIndex(ocIndices);
    this.oceanMesh = new THREE.Mesh(this.oceanGeo, kit.oceanWaterMat);
    this.oceanMesh.receiveShadow = true;
    this.oceanMesh.frustumCulled = false;
    this.oceanMesh.visible = false;
    this.group.add(this.oceanMesh);

    const buildInstList = (tpl: PropTemplate, maxCount: number, castShadow: boolean): THREE.InstancedMesh[] => {
      return tpl.parts.map((part) => {
        const im = new THREE.InstancedMesh(part.geometry, part.material, maxCount);
        im.count = 0;
        im.castShadow = castShadow;
        im.receiveShadow = true;
        im.frustumCulled = false;
        this.group.add(im);
        return im;
      });
    };

    // 4. Poly Haven Scanned PBR Highway Props & Coastal Palm Trees
    const barrierTpl = extractPropTemplate(assets.models.roadBarrier, 0.92, true);
    const lampTpl = extractPropTemplate(assets.models.streetLamp, 7.2, false);
    const treeTpl = extractPropTemplate(assets.models.tree, 6.8, false);
    const palmTpl = createCoastalPalmTemplate(assets);
    const shrubTpl = extractPropTemplate(assets.models.shrub, 1.35, false);
    const boulderTpl = extractPropTemplate(assets.models.boulder, 3.8, false);

    this.barrierInsts = buildInstList(barrierTpl, 96, false);
    this.lampInsts = buildInstList(lampTpl, 26, false);
    this.treeInsts = buildInstList(treeTpl, 28, false);
    this.palmInsts = buildInstList(palmTpl, 36, false);
    this.shrubInsts = buildInstList(shrubTpl, 32, false);
    this.boulderInsts = buildInstList(boulderTpl, 24, false);

    // 5. Overhead DOT Steel Highway Sign Gantries + Concrete Overpasses with Anchored Piers
    this.gantryPostInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.22, 6.8, 8), kit.darkAlloyMat, 16);
    this.gantryBeamInst = new THREE.InstancedMesh(new THREE.BoxGeometry(ROAD_WIDTH + 2.4, 0.42, 0.42), kit.darkAlloyMat, 8);
    this.gantrySignInst = new THREE.InstancedMesh(new THREE.BoxGeometry(8.6, 2.2, 0.16), kit.highwaySignMat, 8);
    this.bridgeDeckInst = new THREE.InstancedMesh(new THREE.BoxGeometry(46, 1.8, 9.5), kit.concreteMat, 6);
    this.bridgePierInst = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 12.0, 9.0), kit.concreteMat, 12);

    // 6. Curtain-Wall High-Rise Buildings (3 archetypes)
    const skyTpls = createSkyscraperTemplates();
    for (const geo of skyTpls.geometries) {
      const im = new THREE.InstancedMesh(geo, kit.skyscraperDayMat, 24);
      im.count = 0;
      im.castShadow = false;
      im.receiveShadow = true;
      im.frustumCulled = false;
      this.towerInsts.push(im);
      this.group.add(im);
    }

    // 7. Asphalt Construction / Bridge Grade Ramps
    this.rampInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.4, 1), kit.rampMat, 10);

    for (const im of [
      this.gantryPostInst,
      this.gantryBeamInst,
      this.gantrySignInst,
      this.bridgeDeckInst,
      this.bridgePierInst,
      this.rampInst,
    ]) {
      im.count = 0;
      im.frustumCulled = false;
      im.receiveShadow = true;
      this.group.add(im);
    }
    this.bridgeDeckInst.castShadow = true;
    this.gantryBeamInst.castShadow = true;

    // 8. Overhead Steel Start/Finish Timing Truss
    this.finishArch = new THREE.Group();
    const archPillarL = new THREE.Mesh(new THREE.BoxGeometry(1.1, 10.5, 1.1), kit.concreteMat);
    archPillarL.position.set(ROAD_WIDTH * 0.56, 5.25, 0);
    const archPillarR = archPillarL.clone();
    archPillarR.position.set(-ROAD_WIDTH * 0.56, 5.25, 0);
    const archBeam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH * 1.18, 1.9, 1.2), kit.darkAlloyMat);
    archBeam.position.set(0, 9.6, 0);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(11.5, 1.75, 0.2), kit.highwaySignMat);
    banner.position.set(0, 9.6, -0.68);
    this.finishArch.add(archPillarL, archPillarR, archBeam, banner);
    this.group.add(this.finishArch);
  }

  public configureStage(stage: StageSpec): void {
    this.stage = stage;
    this.kit.wetAsphaltUniforms.uWetness.value = stage.wetness;

    const isBeach = stage.biome === "vice";
    this.oceanMesh.visible = isBeach;
    this.shoulderMesh.material = isBeach ? this.kit.beachSandMat : this.kit.shoulderGroundMat;

    if (!isBeach) {
      this.kit.shoulderGroundMat.color.setHex(
        stage.biome === "dubai"
          ? 0x9b7148
          : stage.biome === "alpine"
            ? 0x768594
            : 0x3b4048
      );
    }

    const towerMat = stage.isNight ? this.kit.skyscraperNightMat : this.kit.skyscraperDayMat;
    for (const ti of this.towerInsts) {
      ti.material = towerMat;
    }

    this.ramps = [];
    const usable = stage.lengthMeters - 500;
    const step = usable / (stage.rampCount + 1);
    for (let i = 1; i <= stage.rampCount; i++) {
      const s = 420 + i * step + (i % 2) * 30;
      const laneChoices = [-4.2, 0, 4.2];
      this.ramps.push({
        s,
        laneX: laneChoices[i % laneChoices.length],
        width: 3.6,
        length: 13,
        height: 2.1,
      });
    }
  }

  public sample(s: number): TrackSample {
    const cs = this.stage ? this.stage.curveScale : 1.0;
    const hs = this.stage ? this.stage.hillScale : 1.0;
    const f1 = 0.0052;
    const f2 = 0.0115;
    const h1 = 0.0095;
    const h2 = 0.021;

    const env = Math.min(1, Math.max(0, (s - 60) / 140));
    const x = env * cs * (36 * Math.sin(s * f1) + 14 * Math.sin(s * f2 + 1.1));
    const dxDs = env * cs * (36 * f1 * Math.cos(s * f1) + 14 * f2 * Math.cos(s * f2 + 1.1));
    const d2xDs2 = -env * cs * (36 * f1 * f1 * Math.sin(s * f1) + 14 * f2 * f2 * Math.sin(s * f2 + 1.1));

    const y = env * hs * (11.5 * Math.sin(s * h1) + 4.8 * Math.cos(s * h2));
    const dyDs = env * hs * (11.5 * h1 * Math.cos(s * h1) - 4.8 * h2 * Math.sin(s * h2));

    return { x, y, dxDs, d2xDs2, dyDs };
  }

  /**
   * Converts track arc position `s` and driver-centric lateral offset `rightOffset`
   * (- = Left, + = Right relative to +Z travel direction) into world coordinates & heading.
   */
  public toWorld(s: number, rightOffset = 0): TrackWorldPoint {
    const pt = this.sample(s);
    const yaw = Math.atan2(pt.dxDs, 1);
    const pitch = -Math.atan2(pt.dyDs, 1);
    const rightX = -Math.cos(yaw);
    const rightZ = Math.sin(yaw);
    return {
      x: pt.x + rightX * rightOffset,
      y: pt.y,
      z: s + rightZ * rightOffset,
      yaw,
      pitch,
      rightX,
      rightZ,
      pt,
    };
  }

  public getRampHeightAt(s: number, lateralRight: number): number {
    for (const r of this.ramps) {
      if (s >= r.s && s <= r.s + r.length && Math.abs(lateralRight - r.laneX) <= r.width * 0.56) {
        return ((s - r.s) / r.length) * r.height;
      }
    }
    return 0;
  }

  public update(cameraS: number, time: number): void {
    const isBeach = this.stage?.biome === "vice";
    if (isBeach) {
      this.kit.oceanWaterMat.normalMap?.offset.set(time * 0.015, time * 0.028);
    }

    const startS = Math.floor((cameraS - 36) / SEG_LEN) * SEG_LEN;
    const rPos = this.roadGeo.attributes.position as THREE.BufferAttribute;
    const rNorm = this.roadGeo.attributes.normal as THREE.BufferAttribute;
    const rUv = this.roadGeo.attributes.uv as THREE.BufferAttribute;
    const sPos = this.shoulderGeo.attributes.position as THREE.BufferAttribute;
    const sNorm = this.shoulderGeo.attributes.normal as THREE.BufferAttribute;
    const sUv = this.shoulderGeo.attributes.uv as THREE.BufferAttribute;
    const oPos = this.oceanGeo.attributes.position as THREE.BufferAttribute;
    const oNorm = this.oceanGeo.attributes.normal as THREE.BufferAttribute;
    const oUv = this.oceanGeo.attributes.uv as THREE.BufferAttribute;

    const cols = ROAD_COLS.length;
    for (let i = 0; i <= SEGMENTS_VISIBLE; i++) {
      const s = startS + i * SEG_LEN;
      const pt = this.sample(s);
      const yaw = Math.atan2(pt.dxDs, 1);
      const rightX = -Math.cos(yaw);
      const rightZ = Math.sin(yaw);

      const len = Math.hypot(1, pt.dyDs);
      const ny = 1 / len;
      const nz = -pt.dyDs / len;
      const vCoord = s / 16.8;

      for (let c = 0; c < cols; c++) {
        const idx = i * cols + c;
        const frac = ROAD_COLS[c];
        const off = frac * ROAD_WIDTH;
        rPos.setXYZ(idx, pt.x + rightX * off, pt.y + ROAD_COL_Y[c], s + rightZ * off);
        rNorm.setXYZ(idx, 0, ny, nz);
        rUv.setXY(idx, frac + 0.5, vCoord);
      }

      // Shoulder / Beach sand columns [- = Left .. + = Right]
      const shBase = i * 6;
      const outerHL = this.stage?.biome === "alpine" ? 18 : -0.35;
      const outerHR = isBeach ? -1.45 : outerHL;
      const shOffsets = [-160, -42, -ROAD_WIDTH * 0.5, ROAD_WIDTH * 0.5, isBeach ? 23 : 36, 160];
      const shHeights = [outerHL, -0.1, -0.08, -0.08, isBeach ? -0.58 : -0.12, outerHR];
      for (let k = 0; k < 6; k++) {
        const off = shOffsets[k];
        sPos.setXYZ(shBase + k, pt.x + rightX * off, pt.y + shHeights[k], s + rightZ * off);
        sNorm.setXYZ(shBase + k, 0, ny, nz);
        sUv.setXY(shBase + k, k * 2.5, vCoord);
      }

      if (isBeach) {
        const oBase = i * 2;
        const shoreStart = 19;
        const seaEnd = 260;
        oPos.setXYZ(oBase, pt.x + rightX * shoreStart, pt.y - 0.52, s + rightZ * shoreStart);
        oPos.setXYZ(oBase + 1, pt.x + rightX * seaEnd, pt.y - 0.52, s + rightZ * seaEnd);
        oNorm.setXYZ(oBase, 0, 1, 0);
        oNorm.setXYZ(oBase + 1, 0, 1, 0);
        oUv.setXY(oBase, 0, vCoord * 0.6);
        oUv.setXY(oBase + 1, 6, vCoord * 0.6);
      }
    }

    rPos.needsUpdate = true;
    rNorm.needsUpdate = true;
    rUv.needsUpdate = true;
    sPos.needsUpdate = true;
    sNorm.needsUpdate = true;
    sUv.needsUpdate = true;
    if (isBeach) {
      oPos.needsUpdate = true;
      oNorm.needsUpdate = true;
      oUv.needsUpdate = true;
    }

    // 1. Concrete Jersey Barriers along both sides every 5.4m
    let barrierIdx = 0;
    const barrierStep = 5.4;
    const firstBarrierS = Math.floor((cameraS - 18) / barrierStep) * barrierStep;
    for (let k = 0; k < 46; k++) {
      const s = firstBarrierS + k * barrierStep;
      const wCenter = this.toWorld(s, 0);
      for (const side of [-1, 1]) {
        if (barrierIdx >= 96) break;
        const off = side * (ROAD_WIDTH * 0.5 + 0.42);
        this.tmpDummy.position.set(
          wCenter.x + wCenter.rightX * off,
          wCenter.y - 0.02,
          wCenter.z + wCenter.rightZ * off
        );
        this.tmpDummy.rotation.set(wCenter.pitch, wCenter.yaw, 0);
        this.tmpDummy.scale.set(1, 1, 2.45);
        this.tmpDummy.updateMatrix();
        for (const im of this.barrierInsts) im.setMatrixAt(barrierIdx, this.tmpDummy.matrix);
        barrierIdx++;
      }
    }
    for (const im of this.barrierInsts) {
      im.count = barrierIdx;
      im.instanceMatrix.needsUpdate = true;
    }

    // 2. Scanned Street Lamps every 36m
    let lampIdx = 0;
    const lampStep = 36;
    const firstLampS = Math.floor((cameraS - 18) / lampStep) * lampStep;
    for (let k = 0; k < 12; k++) {
      const s = firstLampS + k * lampStep;
      const wCenter = this.toWorld(s, 0);
      for (const side of [-1, 1]) {
        if (lampIdx >= 26) break;
        const off = side * (ROAD_WIDTH * 0.5 + 1.15);
        this.tmpDummy.position.set(
          wCenter.x + wCenter.rightX * off,
          wCenter.y - 0.05,
          wCenter.z + wCenter.rightZ * off
        );
        this.tmpDummy.rotation.set(0, wCenter.yaw + (side < 0 ? -Math.PI * 0.5 : Math.PI * 0.5), 0);
        this.tmpDummy.scale.set(1, 1, 1);
        this.tmpDummy.updateMatrix();
        for (const im of this.lampInsts) im.setMatrixAt(lampIdx, this.tmpDummy.matrix);
        lampIdx++;
      }
    }
    for (const im of this.lampInsts) {
      im.count = lampIdx;
      im.instanceMatrix.needsUpdate = true;
    }

    // 3. Overhead DOT Sign Gantries every 96m & Concrete Highway Overpasses every 180m
    let postIdx = 0;
    let beamIdx = 0;
    let bridgeIdx = 0;
    const gantryStep = 96;
    const firstGantryS = Math.floor((cameraS - 10) / gantryStep) * gantryStep;
    for (let k = 0; k < 6; k++) {
      const s = firstGantryS + k * gantryStep;
      const wc = this.toWorld(s, 0);
      if (beamIdx < 8) {
        this.tmpDummy.position.set(wc.x, wc.y + 6.5, wc.z);
        this.tmpDummy.rotation.set(0, wc.yaw, 0);
        this.tmpDummy.scale.set(1, 1, 1);
        this.tmpDummy.updateMatrix();
        this.gantryBeamInst.setMatrixAt(beamIdx, this.tmpDummy.matrix);

        const fwdX = Math.sin(wc.yaw);
        const fwdZ = Math.cos(wc.yaw);
        this.tmpDummy.position.set(wc.x - fwdX * 0.32, wc.y + 6.5, wc.z - fwdZ * 0.32);
        this.tmpDummy.updateMatrix();
        this.gantrySignInst.setMatrixAt(beamIdx, this.tmpDummy.matrix);
        beamIdx++;

        for (const side of [-1, 1]) {
          if (postIdx < 16) {
            const off = side * (ROAD_WIDTH * 0.5 + 0.9);
            this.tmpDummy.position.set(wc.x + wc.rightX * off, wc.y + 3.4, wc.z + wc.rightZ * off);
            this.tmpDummy.rotation.set(0, wc.yaw, 0);
            this.tmpDummy.updateMatrix();
            this.gantryPostInst.setMatrixAt(postIdx++, this.tmpDummy.matrix);
          }
        }
      }
    }

    let bridgePierIdx = 0;
    const bridgeStep = 180;
    const firstBridgeS = Math.floor((cameraS - 10) / bridgeStep) * bridgeStep;
    for (let k = 0; k < 4; k++) {
      const s = firstBridgeS + k * bridgeStep;
      if (s < 100 || bridgeIdx >= 6) continue;
      const wc = this.toWorld(s, 0);
      this.tmpDummy.position.set(wc.x, wc.y + 8.6, wc.z);
      this.tmpDummy.rotation.set(0, wc.yaw * 0.45, 0);
      this.tmpDummy.scale.set(1, 1, 1);
      this.tmpDummy.updateMatrix();
      this.bridgeDeckInst.setMatrixAt(bridgeIdx++, this.tmpDummy.matrix);

      for (const side of [-1, 1]) {
        if (bridgePierIdx < 12) {
          const off = side * 12.2;
          this.tmpDummy.position.set(wc.x + wc.rightX * off, wc.y + 3.2, wc.z + wc.rightZ * off);
          this.tmpDummy.rotation.set(0, wc.yaw * 0.45, 0);
          this.tmpDummy.scale.set(1, 1, 1);
          this.tmpDummy.updateMatrix();
          this.bridgePierInst.setMatrixAt(bridgePierIdx++, this.tmpDummy.matrix);
        }
      }
    }

    // 4. City Buildings / Beachfront Hotels & Palms / Cliffs
    const towerCounts = [0, 0, 0];
    const showTowers = this.stage?.biome === "vice" || this.stage?.biome === "kowloon" || this.stage?.biome === "sanverona";
    if (showTowers) {
      const towerStep = isBeach ? 46 : 34;
      const firstTower = Math.floor((cameraS - 34) / towerStep) * towerStep;
      for (let k = 0; k < 18; k++) {
        const s = firstTower + k * towerStep;
        const slot = Math.round(s / towerStep);
        const wc = this.toWorld(s, 0);
        // On coastal beach route, place condos/hotels on inland Left side (-1) only so Right stays open beach & sea!
        const sides = isBeach ? [-1] : [-1, 1];
        for (const side of sides) {
          const arch = Math.abs(slot * 5 + (side > 0 ? 1 : 2)) % 3;
          if (towerCounts[arch] >= 24) continue;
          const dist = ROAD_WIDTH * 0.5 + (isBeach ? 18 : 14) + (Math.abs(slot * 13 + side * 7) % 18);
          const h = (isBeach ? 20 : 32) + (Math.abs(slot * 29 + side * 11) % (isBeach ? 26 : 42));
          const w = 13 + (Math.abs(slot * 17) % 9);
          const off = side * dist;

          this.tmpDummy.position.set(wc.x + wc.rightX * off, wc.y - 2.0, wc.z + wc.rightZ * off);
          this.tmpDummy.rotation.set(0, ((slot % 4) * 0.14) * side, 0);
          this.tmpDummy.scale.set(w, h, w);
          this.tmpDummy.updateMatrix();
          this.towerInsts[arch].setMatrixAt(towerCounts[arch]++, this.tmpDummy.matrix);
        }
      }
    }
    for (let a = 0; a < 3; a++) {
      this.towerInsts[a].count = towerCounts[a];
      this.towerInsts[a].instanceMatrix.needsUpdate = true;
    }

    let palmIdx = 0;
    let treeIdx = 0;
    let shrubIdx = 0;
    let boulderIdx = 0;
    const propStep = isBeach ? 22 : 26;
    const firstProp = Math.floor((cameraS - 20) / propStep) * propStep;
    for (let k = 0; k < 18; k++) {
      const s = firstProp + k * propStep;
      const slot = Math.round(s / propStep);
      const wc = this.toWorld(s, 0);
      for (const side of [-1, 1]) {
        const dist = ROAD_WIDTH * 0.5 + 3.0 + (Math.abs(slot * 7 + side * 3) % 7);
        if (isBeach && palmIdx < 36) {
          const palmOff = side * (ROAD_WIDTH * 0.5 + 2.4 + (Math.abs(slot * 3) % 3));
          const sc = 0.85 + (Math.abs(slot * 5) % 3) * 0.18;
          this.tmpDummy.position.set(
            wc.x + wc.rightX * palmOff,
            wc.y - (side > 0 ? 0.35 : 0.12),
            wc.z + wc.rightZ * palmOff
          );
          this.tmpDummy.rotation.set(0, slot * 0.95 + (side < 0 ? Math.PI : 0), 0);
          this.tmpDummy.scale.setScalar(sc);
          this.tmpDummy.updateMatrix();
          for (const im of this.palmInsts) im.setMatrixAt(palmIdx, this.tmpDummy.matrix);
          palmIdx++;
        }
        if ((this.stage?.biome === "alpine" || this.stage?.biome === "dubai") && boulderIdx < 24 && (slot + side) % 2 === 0) {
          const sc = 1.1 + (Math.abs(slot * 3) % 4) * 0.45;
          const off = side * (dist + 2.5);
          this.tmpDummy.position.set(wc.x + wc.rightX * off, wc.y - 0.6, wc.z + wc.rightZ * off);
          this.tmpDummy.rotation.set(0, slot * 1.1, 0);
          this.tmpDummy.scale.set(sc * 1.3, sc, sc * 1.2);
          this.tmpDummy.updateMatrix();
          for (const im of this.boulderInsts) im.setMatrixAt(boulderIdx, this.tmpDummy.matrix);
          boulderIdx++;
        }
        if (!isBeach && this.stage?.biome !== "alpine" && treeIdx < 28 && (slot + side) % 2 === 1) {
          const sc = 0.9 + (Math.abs(slot * 5) % 3) * 0.28;
          const off = side * dist;
          this.tmpDummy.position.set(wc.x + wc.rightX * off, wc.y - 0.25, wc.z + wc.rightZ * off);
          this.tmpDummy.rotation.set(0, slot * 0.85, 0);
          this.tmpDummy.scale.setScalar(sc);
          this.tmpDummy.updateMatrix();
          for (const im of this.treeInsts) im.setMatrixAt(treeIdx, this.tmpDummy.matrix);
          treeIdx++;
        }
        if (!isBeach && shrubIdx < 32) {
          const sc = 0.85 + (Math.abs(slot * 9) % 3) * 0.3;
          const off = side * (ROAD_WIDTH * 0.5 + 2.1);
          this.tmpDummy.position.set(wc.x + wc.rightX * off, wc.y - 0.1, wc.z + wc.rightZ * off + 6);
          this.tmpDummy.rotation.set(0, slot * 1.4, 0);
          this.tmpDummy.scale.setScalar(sc);
          this.tmpDummy.updateMatrix();
          for (const im of this.shrubInsts) im.setMatrixAt(shrubIdx, this.tmpDummy.matrix);
          shrubIdx++;
        }
      }
    }

    for (const im of this.palmInsts) { im.count = palmIdx; im.instanceMatrix.needsUpdate = true; }
    for (const im of this.treeInsts) { im.count = treeIdx; im.instanceMatrix.needsUpdate = true; }
    for (const im of this.shrubInsts) { im.count = shrubIdx; im.instanceMatrix.needsUpdate = true; }
    for (const im of this.boulderInsts) { im.count = boulderIdx; im.instanceMatrix.needsUpdate = true; }

    // 5. Concrete Grade Ramps (subtle, positioned perpendicularly along road tangent)
    let rampIdx = 0;
    for (const r of this.ramps) {
      if (r.s > cameraS - 20 && r.s < cameraS + 390 && rampIdx < 10) {
        const wr = this.toWorld(r.s + r.length * 0.5, r.laneX);
        const slopeAngle = Math.atan2(r.height, r.length);
        this.tmpDummy.position.set(wr.x, wr.y + r.height * 0.45, wr.z);
        this.tmpDummy.rotation.set(-slopeAngle, wr.yaw, 0);
        this.tmpDummy.scale.set(r.width, 1, r.length);
        this.tmpDummy.updateMatrix();
        this.rampInst.setMatrixAt(rampIdx++, this.tmpDummy.matrix);
      }
    }

    this.gantryPostInst.count = postIdx;
    this.gantryBeamInst.count = beamIdx;
    this.gantrySignInst.count = beamIdx;
    this.bridgeDeckInst.count = bridgeIdx;
    this.bridgePierInst.count = bridgePierIdx;
    this.rampInst.count = rampIdx;

    for (const im of [
      this.gantryPostInst,
      this.gantryBeamInst,
      this.gantrySignInst,
      this.bridgeDeckInst,
      this.bridgePierInst,
      this.rampInst,
    ]) {
      im.instanceMatrix.needsUpdate = true;
    }

    if (this.stage) {
      const fPt = this.toWorld(this.stage.lengthMeters, 0);
      this.finishArch.position.set(fPt.x, fPt.y, fPt.z);
      this.finishArch.rotation.y = fPt.yaw * 0.7;
    }
  }
}
