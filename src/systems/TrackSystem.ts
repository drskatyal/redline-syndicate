import * as THREE from "three";
import { LoadedAssets } from "../assets/AssetLoader";
import { MaterialKit } from "../assets/MaterialLibrary";
import { createSkyscraperTemplates, extractPropTemplate, PropTemplate } from "../assets/RealisticModels";
import { StageSpec } from "../data/stages";

export const ROAD_WIDTH = 16.8;
export const PLAYABLE_HALF_WIDTH = 7.1; // lanes span [-7.1 .. +7.1]
export const SHOULDER_LIMIT = 8.15;

export interface TrackSample {
  x: number;
  y: number;
  dxDs: number;
  dyDs: number;
}

export interface RampItem {
  s: number;
  laneX: number;
  width: number;
  length: number;
  height: number;
}

export interface BoostPadItem {
  s: number;
  laneX: number;
  kind: "nitro" | "emp";
}

const SEGMENTS_VISIBLE = 76;
const SEG_LEN = 6; // 456m visible ribbon

// 8-column crowned cross-section [-0.5 .. +0.5]
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

  // Instanced Poly Haven PBR prop meshes (multi-part support per template)
  private barrierInsts: THREE.InstancedMesh[] = [];
  private lampInsts: THREE.InstancedMesh[] = [];
  private treeInsts: THREE.InstancedMesh[] = [];
  private shrubInsts: THREE.InstancedMesh[] = [];
  private boulderInsts: THREE.InstancedMesh[] = [];

  // Instanced architectural highway infrastructure
  private gantryPostInst: THREE.InstancedMesh;
  private gantryBeamInst: THREE.InstancedMesh;
  private gantrySignInst: THREE.InstancedMesh;
  private bridgeDeckInst: THREE.InstancedMesh;
  private bridgePierInst: THREE.InstancedMesh;
  private towerInsts: THREE.InstancedMesh[] = [];
  private rampInst: THREE.InstancedMesh;
  private padInst: THREE.InstancedMesh;
  private finishArch: THREE.Group;

  public ramps: RampItem[] = [];
  public pads: BoostPadItem[] = [];

  private tmpDummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(kit: MaterialKit, assets: LoadedAssets) {
    this.kit = kit;

    // 1. Dynamic 8-column Crowned Wet/Dry Scanned Asphalt Highway
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
        rIndices.push(a, c, b, b, c, d);
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

    // 2. Wide Outer Brushed Concrete Urban Apron + Terrain Skirt (6 columns -> continuous flat sidewalk out to +-42m, zero gaps under towers)
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
        shIndices.push(a, c, b, b, c, d);
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

    // 3. Poly Haven Scanned PBR Highway Props (Decimated WebGL2 LODs)
    const barrierTpl = extractPropTemplate(assets.models.roadBarrier, 0.92, true);
    const lampTpl = extractPropTemplate(assets.models.streetLamp, 7.2, false);
    const treeTpl = extractPropTemplate(assets.models.tree, 6.8, false);
    const shrubTpl = extractPropTemplate(assets.models.shrub, 1.35, false);
    const boulderTpl = extractPropTemplate(assets.models.boulder, 3.8, false);

    this.barrierInsts = buildInstList(barrierTpl, 96, false);
    this.lampInsts = buildInstList(lampTpl, 26, false);
    this.treeInsts = buildInstList(treeTpl, 28, false);
    this.shrubInsts = buildInstList(shrubTpl, 32, false);
    this.boulderInsts = buildInstList(boulderTpl, 24, false);

    // 4. Overhead DOT Steel Highway Sign Gantries + Concrete Overpasses with Anchored Piers
    this.gantryPostInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.22, 6.8, 8), kit.darkAlloyMat, 16);
    this.gantryBeamInst = new THREE.InstancedMesh(new THREE.BoxGeometry(ROAD_WIDTH + 2.4, 0.42, 0.42), kit.darkAlloyMat, 8);
    this.gantrySignInst = new THREE.InstancedMesh(new THREE.BoxGeometry(8.6, 2.2, 0.16), kit.highwaySignMat, 8);
    this.bridgeDeckInst = new THREE.InstancedMesh(new THREE.BoxGeometry(46, 1.8, 9.5), kit.concreteMat, 6);
    this.bridgePierInst = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 12.0, 9.0), kit.concreteMat, 12);

    // 5. Stepped Curtain-Wall Glass Skyscrapers (3 architectural archetypes)
    const skyTpls = createSkyscraperTemplates();
    for (const geo of skyTpls.geometries) {
      const im = new THREE.InstancedMesh(geo, kit.skyscraperNightMat, 22);
      im.count = 0;
      im.castShadow = false;
      im.receiveShadow = true;
      im.frustumCulled = false;
      this.towerInsts.push(im);
      this.group.add(im);
    }

    // 6. Concrete Stunt Ramps & Road Inductor Strips
    this.rampInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.4, 1), kit.rampMat, 12);
    this.padInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.6, 0.05, 5.2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x00f0ff, emissiveIntensity: 0.9, roughness: 0.25 }),
      20
    );

    for (const im of [
      this.gantryPostInst,
      this.gantryBeamInst,
      this.gantrySignInst,
      this.bridgeDeckInst,
      this.bridgePierInst,
      this.rampInst,
      this.padInst,
    ]) {
      im.count = 0;
      im.frustumCulled = false;
      im.receiveShadow = true;
      this.group.add(im);
    }
    this.bridgeDeckInst.castShadow = true;
    this.gantryBeamInst.castShadow = true;

    // 7. Overhead Steel Start/Finish Timing Truss
    this.finishArch = new THREE.Group();
    const archPillarL = new THREE.Mesh(new THREE.BoxGeometry(1.1, 10.5, 1.1), kit.concreteMat);
    archPillarL.position.set(-ROAD_WIDTH * 0.56, 5.25, 0);
    const archPillarR = archPillarL.clone();
    archPillarR.position.set(ROAD_WIDTH * 0.56, 5.25, 0);
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
    this.kit.shoulderGroundMat.color.setHex(
      stage.biome === "dubai"
        ? 0x9b7148
        : stage.biome === "alpine"
          ? 0x768594
          : 0x282d36
    );

    const towerMat = stage.isNight ? this.kit.skyscraperNightMat : this.kit.skyscraperDayMat;
    for (const ti of this.towerInsts) {
      ti.material = towerMat;
    }

    this.ramps = [];
    const usable = stage.lengthMeters - 450;
    const step = usable / (stage.rampCount + 1);
    for (let i = 1; i <= stage.rampCount; i++) {
      const s = 320 + i * step + (i % 2) * 35;
      const laneChoices = [-4.2, 0, 4.2];
      this.ramps.push({
        s,
        laneX: laneChoices[i % laneChoices.length],
        width: 3.6,
        length: 13,
        height: 2.35,
      });
    }

    this.pads = [];
    for (let s = 260; s < stage.lengthMeters - 200; s += 220) {
      const idx = Math.round(s / 220);
      this.pads.push({
        s,
        laneX: [-4.5, -1.6, 1.6, 4.5][idx % 4],
        kind: idx % 3 === 0 ? "emp" : "nitro",
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

    const y = env * hs * (11.5 * Math.sin(s * h1) + 4.8 * Math.cos(s * h2));
    const dyDs = env * hs * (11.5 * h1 * Math.cos(s * h1) - 4.8 * h2 * Math.sin(s * h2));

    return { x, y, dxDs, dyDs };
  }

  public getRampHeightAt(s: number, lateralX: number): number {
    for (const r of this.ramps) {
      if (s >= r.s && s <= r.s + r.length && Math.abs(lateralX - r.laneX) <= r.width * 0.56) {
        return ((s - r.s) / r.length) * r.height;
      }
    }
    return 0;
  }

  public update(cameraS: number, time: number): void {
    const startS = Math.floor((cameraS - 36) / SEG_LEN) * SEG_LEN;
    const rPos = this.roadGeo.attributes.position as THREE.BufferAttribute;
    const rNorm = this.roadGeo.attributes.normal as THREE.BufferAttribute;
    const rUv = this.roadGeo.attributes.uv as THREE.BufferAttribute;
    const sPos = this.shoulderGeo.attributes.position as THREE.BufferAttribute;
    const sNorm = this.shoulderGeo.attributes.normal as THREE.BufferAttribute;
    const sUv = this.shoulderGeo.attributes.uv as THREE.BufferAttribute;

    const cols = ROAD_COLS.length;
    for (let i = 0; i <= SEGMENTS_VISIBLE; i++) {
      const s = startS + i * SEG_LEN;
      const pt = this.sample(s);
      const len = Math.hypot(1, pt.dyDs);
      const ny = 1 / len;
      const nz = -pt.dyDs / len;
      const vCoord = s / 16.8;

      for (let c = 0; c < cols; c++) {
        const idx = i * cols + c;
        const frac = ROAD_COLS[c];
        rPos.setXYZ(idx, pt.x + frac * ROAD_WIDTH, pt.y + ROAD_COL_Y[c], s);
        rNorm.setXYZ(idx, 0, ny, nz);
        rUv.setXY(idx, frac + 0.5, vCoord);
      }

      const shBase = i * 6;
      const outerH = this.stage?.biome === "alpine" ? 18 : -0.4;
      sPos.setXYZ(shBase, pt.x - 160, pt.y + outerH, s);
      sPos.setXYZ(shBase + 1, pt.x - 42, pt.y - 0.12, s);
      sPos.setXYZ(shBase + 2, pt.x - ROAD_WIDTH * 0.5, pt.y - 0.08, s);
      sPos.setXYZ(shBase + 3, pt.x + ROAD_WIDTH * 0.5, pt.y - 0.08, s);
      sPos.setXYZ(shBase + 4, pt.x + 42, pt.y - 0.12, s);
      sPos.setXYZ(shBase + 5, pt.x + 160, pt.y + outerH, s);
      for (let k = 0; k < 6; k++) {
        sNorm.setXYZ(shBase + k, 0, ny, nz);
        sUv.setXY(shBase + k, k * 2.5, vCoord);
      }
    }

    rPos.needsUpdate = true;
    rNorm.needsUpdate = true;
    rUv.needsUpdate = true;
    sPos.needsUpdate = true;
    sNorm.needsUpdate = true;
    sUv.needsUpdate = true;

    // 1. Concrete Jersey Barriers along both sides (continuous highway walls every 5.4m)
    let barrierIdx = 0;
    const barrierStep = 5.4;
    const firstBarrierS = Math.floor((cameraS - 18) / barrierStep) * barrierStep;
    for (let k = 0; k < 46; k++) {
      const s = firstBarrierS + k * barrierStep;
      const pt = this.sample(s);
      const ptNext = this.sample(s + barrierStep);
      const yaw = Math.atan2(ptNext.x - pt.x, barrierStep);
      const pitch = -Math.atan2(ptNext.y - pt.y, barrierStep);
      for (const side of [-1, 1]) {
        if (barrierIdx >= 96) break;
        this.tmpDummy.position.set(pt.x + side * (ROAD_WIDTH * 0.5 + 0.42), pt.y - 0.02, s);
        this.tmpDummy.rotation.set(pitch, yaw, 0);
        this.tmpDummy.scale.set(1, 1, 1.8);
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
      const pt = this.sample(s);
      for (const side of [-1, 1]) {
        if (lampIdx >= 26) break;
        this.tmpDummy.position.set(pt.x + side * (ROAD_WIDTH * 0.5 + 1.15), pt.y - 0.05, s);
        this.tmpDummy.rotation.set(0, side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5, 0);
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
      const pt = this.sample(s);
      const yaw = Math.atan2(pt.dxDs, 1);
      if (beamIdx < 8) {
        this.tmpDummy.position.set(pt.x, pt.y + 6.5, s);
        this.tmpDummy.rotation.set(0, yaw, 0);
        this.tmpDummy.scale.set(1, 1, 1);
        this.tmpDummy.updateMatrix();
        this.gantryBeamInst.setMatrixAt(beamIdx, this.tmpDummy.matrix);

        // Sign mounted slightly facing incoming camera (-Z) so driver reads it clearly
        this.tmpDummy.position.set(pt.x, pt.y + 6.5, s - 0.32);
        this.tmpDummy.updateMatrix();
        this.gantrySignInst.setMatrixAt(beamIdx, this.tmpDummy.matrix);
        beamIdx++;

        for (const side of [-1, 1]) {
          if (postIdx < 16) {
            this.tmpDummy.position.set(pt.x + side * (ROAD_WIDTH * 0.5 + 0.9), pt.y + 3.4, s);
            this.tmpDummy.rotation.set(0, 0, 0);
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
      const pt = this.sample(s);
      const yaw = Math.atan2(pt.dxDs, 1) * 0.35;
      this.tmpDummy.position.set(pt.x, pt.y + 8.6, s);
      this.tmpDummy.rotation.set(0, yaw, 0);
      this.tmpDummy.scale.set(1, 1, 1);
      this.tmpDummy.updateMatrix();
      this.bridgeDeckInst.setMatrixAt(bridgeIdx++, this.tmpDummy.matrix);

      for (const side of [-1, 1]) {
        if (bridgePierIdx < 12) {
          this.tmpDummy.position.set(pt.x + side * 12.2, pt.y + 3.2, s);
          this.tmpDummy.rotation.set(0, yaw, 0);
          this.tmpDummy.scale.set(1, 1, 1);
          this.tmpDummy.updateMatrix();
          this.bridgePierInst.setMatrixAt(bridgePierIdx++, this.tmpDummy.matrix);
        }
      }
    }

    // 4. Stepped Glass Curtain-Wall Skyscrapers (urban districts) & Poly Haven Flora/Cliffs
    const towerCounts = [0, 0, 0];
    const showTowers = this.stage?.biome !== "alpine";
    if (showTowers) {
      const towerStep = 34;
      const firstTower = Math.floor((cameraS - 34) / towerStep) * towerStep;
      for (let k = 0; k < 18; k++) {
        const s = firstTower + k * towerStep;
        const slot = Math.round(s / towerStep);
        const pt = this.sample(s);
        for (const side of [-1, 1]) {
          const arch = Math.abs(slot * 5 + (side > 0 ? 1 : 2)) % 3;
          if (towerCounts[arch] >= 22) continue;
          const dist = ROAD_WIDTH * 0.5 + 14 + (Math.abs(slot * 13 + side * 7) % 18);
          const h = (this.stage?.biome === "dubai" ? 42 : 30) + (Math.abs(slot * 29 + side * 11) % 44);
          const w = 13 + (Math.abs(slot * 17) % 9);

          this.tmpDummy.position.set(pt.x + side * dist, pt.y - 2.0, s);
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

    let treeIdx = 0;
    let shrubIdx = 0;
    let boulderIdx = 0;
    const propStep = 26;
    const firstProp = Math.floor((cameraS - 20) / propStep) * propStep;
    for (let k = 0; k < 18; k++) {
      const s = firstProp + k * propStep;
      const slot = Math.round(s / propStep);
      const pt = this.sample(s);
      for (const side of [-1, 1]) {
        const dist = ROAD_WIDTH * 0.5 + 3.2 + (Math.abs(slot * 7 + side * 3) % 7);
        if (this.stage?.biome === "alpine" || this.stage?.biome === "dubai") {
          if (boulderIdx < 24 && (slot + side) % 2 === 0) {
            const sc = 1.1 + (Math.abs(slot * 3) % 4) * 0.45;
            this.tmpDummy.position.set(pt.x + side * (dist + 2.5), pt.y - 0.6, s);
            this.tmpDummy.rotation.set(0, slot * 1.1, 0);
            this.tmpDummy.scale.set(sc * 1.3, sc, sc * 1.2);
            this.tmpDummy.updateMatrix();
            for (const im of this.boulderInsts) im.setMatrixAt(boulderIdx, this.tmpDummy.matrix);
            boulderIdx++;
          }
        }
        if (this.stage?.biome !== "alpine" && treeIdx < 28 && (slot + side) % 2 === 1) {
          const sc = 0.9 + (Math.abs(slot * 5) % 3) * 0.28;
          this.tmpDummy.position.set(pt.x + side * dist, pt.y - 0.25, s);
          this.tmpDummy.rotation.set(0, slot * 0.85, 0);
          this.tmpDummy.scale.setScalar(sc);
          this.tmpDummy.updateMatrix();
          for (const im of this.treeInsts) im.setMatrixAt(treeIdx, this.tmpDummy.matrix);
          treeIdx++;
        }
        if (shrubIdx < 32) {
          const sc = 0.85 + (Math.abs(slot * 9) % 3) * 0.3;
          this.tmpDummy.position.set(pt.x + side * (ROAD_WIDTH * 0.5 + 2.1), pt.y - 0.1, s + 6);
          this.tmpDummy.rotation.set(0, slot * 1.4, 0);
          this.tmpDummy.scale.setScalar(sc);
          this.tmpDummy.updateMatrix();
          for (const im of this.shrubInsts) im.setMatrixAt(shrubIdx, this.tmpDummy.matrix);
          shrubIdx++;
        }
      }
    }

    for (const im of this.treeInsts) { im.count = treeIdx; im.instanceMatrix.needsUpdate = true; }
    for (const im of this.shrubInsts) { im.count = shrubIdx; im.instanceMatrix.needsUpdate = true; }
    for (const im of this.boulderInsts) { im.count = boulderIdx; im.instanceMatrix.needsUpdate = true; }

    // 5. Concrete Stunt Ramps & Highway Boost Plates
    let rampIdx = 0;
    for (const r of this.ramps) {
      if (r.s > cameraS - 20 && r.s < cameraS + 390 && rampIdx < 12) {
        const pt = this.sample(r.s + r.length * 0.5);
        const slopeAngle = Math.atan2(r.height, r.length);
        this.tmpDummy.position.set(pt.x + r.laneX, pt.y + r.height * 0.45, r.s + r.length * 0.5);
        this.tmpDummy.rotation.set(-slopeAngle, -pt.dxDs, 0);
        this.tmpDummy.scale.set(r.width, 1, r.length);
        this.tmpDummy.updateMatrix();
        this.rampInst.setMatrixAt(rampIdx++, this.tmpDummy.matrix);
      }
    }

    let padIdx = 0;
    for (const p of this.pads) {
      if (p.s > cameraS - 15 && p.s < cameraS + 380 && padIdx < 20) {
        const pt = this.sample(p.s);
        this.tmpDummy.position.set(pt.x + p.laneX, pt.y + 0.04, p.s);
        this.tmpDummy.rotation.set(-pt.dyDs, Math.atan2(pt.dxDs, 1), 0);
        this.tmpDummy.scale.set(1, 1, 1);
        this.tmpDummy.updateMatrix();
        this.padInst.setMatrixAt(padIdx, this.tmpDummy.matrix);
        const pulse = 0.75 + Math.sin(time * 6 + p.s) * 0.25;
        this.tmpColor.setHex(p.kind === "emp" ? 0xf59e0b : 0x00f0ff).multiplyScalar(pulse);
        this.padInst.setColorAt(padIdx, this.tmpColor);
        padIdx++;
      }
    }

    this.gantryPostInst.count = postIdx;
    this.gantryBeamInst.count = beamIdx;
    this.gantrySignInst.count = beamIdx;
    this.bridgeDeckInst.count = bridgeIdx;
    this.bridgePierInst.count = bridgePierIdx;
    this.rampInst.count = rampIdx;
    this.padInst.count = padIdx;

    for (const im of [
      this.gantryPostInst,
      this.gantryBeamInst,
      this.gantrySignInst,
      this.bridgeDeckInst,
      this.bridgePierInst,
      this.rampInst,
      this.padInst,
    ]) {
      im.instanceMatrix.needsUpdate = true;
    }
    if (this.padInst.instanceColor) this.padInst.instanceColor.needsUpdate = true;

    if (this.stage) {
      const fPt = this.sample(this.stage.lengthMeters);
      this.finishArch.position.set(fPt.x, fPt.y, this.stage.lengthMeters);
      this.finishArch.rotation.y = Math.atan2(fPt.dxDs, 1) * 0.7;
    }
  }
}
