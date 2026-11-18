import * as THREE from "three";
import { MaterialKit } from "../assets/MaterialLibrary";
import { StageSpec } from "../data/stages";

export const ROAD_WIDTH = 16.4;
export const PLAYABLE_HALF_WIDTH = 6.9; // lanes span [-6.8 .. +6.8]
export const SHOULDER_LIMIT = 9.4;

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

const SEGMENTS_VISIBLE = 74;
const SEG_LEN = 6; // 74 * 6 = 444m visible highway ribbon ahead + behind

export class TrackSystem {
  public readonly group = new THREE.Group();
  private stage!: StageSpec;
  private kit: MaterialKit;

  private roadGeo: THREE.BufferGeometry;
  private roadMesh: THREE.Mesh;
  private shoulderGeo: THREE.BufferGeometry;
  private shoulderMesh: THREE.Mesh;

  // Instanced roadside & highway architectural kits (ultra-low draw calls!)
  private postInst: THREE.InstancedMesh;
  private railInst: THREE.InstancedMesh;
  private gantryInst: THREE.InstancedMesh;
  private gantryNeonInst: THREE.InstancedMesh;
  private towerInst: THREE.InstancedMesh;
  private crownNeonInst: THREE.InstancedMesh;
  private natureInst: THREE.InstancedMesh;
  private rampInst: THREE.InstancedMesh;
  private padInst: THREE.InstancedMesh;
  private finishArch: THREE.Group;

  private padMatNitro: THREE.MeshStandardMaterial;
  private gantryNeonMat: THREE.MeshStandardMaterial;
  private natureMat: THREE.MeshStandardMaterial;

  public ramps: RampItem[] = [];
  public pads: BoostPadItem[] = [];

  private tmpDummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(kit: MaterialKit) {
    this.kit = kit;

    // 1. Dynamic Road Mesh (SEGMENTS_VISIBLE + 1 rows x 2 vertices)
    const vCount = (SEGMENTS_VISIBLE + 1) * 2;
    const roadPos = new Float32Array(vCount * 3);
    const roadNorm = new Float32Array(vCount * 3);
    const roadUv = new Float32Array(vCount * 2);
    const indices: number[] = [];
    for (let i = 0; i < SEGMENTS_VISIBLE; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    this.roadGeo = new THREE.BufferGeometry();
    this.roadGeo.setAttribute("position", new THREE.BufferAttribute(roadPos, 3));
    this.roadGeo.setAttribute("normal", new THREE.BufferAttribute(roadNorm, 3));
    this.roadGeo.setAttribute("uv", new THREE.BufferAttribute(roadUv, 2));
    this.roadGeo.setIndex(indices);
    this.roadMesh = new THREE.Mesh(this.roadGeo, kit.wetAsphaltMat);
    this.roadMesh.receiveShadow = true;
    this.roadMesh.frustumCulled = false;
    this.group.add(this.roadMesh);

    // 2. Wide Outer Terrain / Deck Skirt
    const shPos = new Float32Array(vCount * 3);
    const shNorm = new Float32Array(vCount * 3);
    const shUv = new Float32Array(vCount * 2);
    this.shoulderGeo = new THREE.BufferGeometry();
    this.shoulderGeo.setAttribute("position", new THREE.BufferAttribute(shPos, 3));
    this.shoulderGeo.setAttribute("normal", new THREE.BufferAttribute(shNorm, 3));
    this.shoulderGeo.setAttribute("uv", new THREE.BufferAttribute(shUv, 2));
    this.shoulderGeo.setIndex(indices);
    this.shoulderMesh = new THREE.Mesh(this.shoulderGeo, kit.shoulderGroundMat);
    this.shoulderMesh.receiveShadow = true;
    this.shoulderMesh.frustumCulled = false;
    this.group.add(this.shoulderMesh);

    // 3. Instanced Roadside Props
    this.postInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.95, 0.18), kit.darkAlloyMat, 120);
    this.railInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.24, SEG_LEN * 2.05), kit.barrierMetalMat, 96);
    this.gantryInst = new THREE.InstancedMesh(new THREE.BoxGeometry(ROAD_WIDTH + 3.2, 0.55, 0.7), kit.darkAlloyMat, 18);
    this.gantryNeonMat = kit.makeNeonMaterial(0x00f0ff, 2.8);
    this.gantryNeonInst = new THREE.InstancedMesh(new THREE.BoxGeometry(ROAD_WIDTH + 1.8, 0.14, 0.8), this.gantryNeonMat, 18);

    // Tall skyscrapers / desert arcologies / suspension bridge towers
    this.towerInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), kit.skyscraperMat, 52);
    this.crownNeonInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.65, 1), this.gantryNeonMat, 52);

    // Nature / Cliff / Pine / Palm silhouettes
    this.natureMat = new THREE.MeshStandardMaterial({ color: 0x1e3a2f, roughness: 0.75, metalness: 0.05 });
    this.natureInst = new THREE.InstancedMesh(new THREE.ConeGeometry(1.8, 6.5, 6), this.natureMat, 72);

    // Launch Ramps (tilted wedge boxes)
    this.rampInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.35, 1), kit.rampMat, 12);
    this.padMatNitro = kit.makeNeonMaterial(0x00f0ff, 3.0);
    this.padInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.5, 1.5, 0.08, 6), this.padMatNitro, 20);

    for (const im of [
      this.postInst,
      this.railInst,
      this.gantryInst,
      this.gantryNeonInst,
      this.towerInst,
      this.crownNeonInst,
      this.natureInst,
      this.rampInst,
      this.padInst,
    ]) {
      im.frustumCulled = false;
      this.group.add(im);
    }

    // 4. Finish Checkered Neon Mega-Arch
    this.finishArch = new THREE.Group();
    const archPillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 12, 1.6), kit.carbonMat);
    const pL = archPillar.clone();
    pL.position.set(-ROAD_WIDTH * 0.54, 6, 0);
    const pR = archPillar.clone();
    pR.position.set(ROAD_WIDTH * 0.54, 6, 0);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH * 1.15, 2.1, 1.4), kit.makeNeonMaterial(0xf59e0b, 2.5));
    cross.position.set(0, 11.2, 0);
    this.finishArch.add(pL, pR, cross);
    this.group.add(this.finishArch);
  }

  public configureStage(stage: StageSpec): void {
    this.stage = stage;
    this.kit.wetAsphaltUniforms.uWetness.value = stage.wetness;
    this.kit.wetAsphaltUniforms.uAccent.value.setHex(stage.accentNeonHex);
    this.kit.shoulderGroundMat.color.setHex(stage.groundHex);
    this.gantryNeonMat.color.setHex(stage.accentNeonHex);
    this.gantryNeonMat.emissive.setHex(stage.accentNeonHex);
    this.kit.rampUniforms.uColor.value.setHex(stage.accentNeonHex);

    if (stage.biome === "dubai") {
      this.natureMat.color.setHex(0xb45309);
    } else if (stage.biome === "alpine") {
      this.natureMat.color.setHex(0x164e63);
    } else {
      this.natureMat.color.setHex(0x0f2e26);
    }

    // Deterministic Ramps & Boost/EMP Pads
    this.ramps = [];
    const usable = stage.lengthMeters - 450;
    const step = usable / (stage.rampCount + 1);
    for (let i = 1; i <= stage.rampCount; i++) {
      const s = 320 + i * step + ((i % 2) * 35);
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
    for (let s = 260; s < stage.lengthMeters - 200; s += 210) {
      const idx = Math.round(s / 210);
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

    // Gentle straight start/finish zones for clean grid launch
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
        const t = (s - r.s) / r.length;
        return t * r.height;
      }
    }
    return 0;
  }

  public update(cameraS: number, time: number): void {
    this.kit.wetAsphaltUniforms.uTime.value = time;
    this.kit.rampUniforms.uTime.value = time;

    const startS = Math.floor((cameraS - 36) / SEG_LEN) * SEG_LEN;
    const rPos = this.roadGeo.attributes.position as THREE.BufferAttribute;
    const rNorm = this.roadGeo.attributes.normal as THREE.BufferAttribute;
    const rUv = this.roadGeo.attributes.uv as THREE.BufferAttribute;
    const sPos = this.shoulderGeo.attributes.position as THREE.BufferAttribute;
    const sNorm = this.shoulderGeo.attributes.normal as THREE.BufferAttribute;
    const sUv = this.shoulderGeo.attributes.uv as THREE.BufferAttribute;

    const halfW = ROAD_WIDTH * 0.5;
    const terrainHalfW = 140;

    for (let i = 0; i <= SEGMENTS_VISIBLE; i++) {
      const s = startS + i * SEG_LEN;
      const pt = this.sample(s);
      const len = Math.hypot(1, pt.dyDs);
      const ny = 1 / len;
      const nz = -pt.dyDs / len;
      const vCoord = s / 144;

      const idxL = i * 2;
      const idxR = i * 2 + 1;

      rPos.setXYZ(idxL, pt.x - halfW, pt.y, s);
      rPos.setXYZ(idxR, pt.x + halfW, pt.y, s);
      rNorm.setXYZ(idxL, 0, ny, nz);
      rNorm.setXYZ(idxR, 0, ny, nz);
      rUv.setXY(idxL, 0, vCoord);
      rUv.setXY(idxR, 1, vCoord);

      sPos.setXYZ(idxL, pt.x - terrainHalfW, pt.y - 0.14, s);
      sPos.setXYZ(idxR, pt.x + terrainHalfW, pt.y - 0.14, s);
      sNorm.setXYZ(idxL, 0, ny, nz);
      sNorm.setXYZ(idxR, 0, ny, nz);
      sUv.setXY(idxL, 0, vCoord);
      sUv.setXY(idxR, 1, vCoord);
    }

    rPos.needsUpdate = true;
    rNorm.needsUpdate = true;
    rUv.needsUpdate = true;
    sPos.needsUpdate = true;
    sNorm.needsUpdate = true;
    sUv.needsUpdate = true;

    // Guardrails, Posts & Overhead Gantries snapped to world spacing
    let postIdx = 0;
    let railIdx = 0;
    let gantryIdx = 0;
    let towerIdx = 0;
    let natureIdx = 0;

    const guardrailStep = SEG_LEN * 2;
    const firstRailS = Math.floor((cameraS - 24) / guardrailStep) * guardrailStep;

    for (let k = 0; k < 36; k++) {
      const s = firstRailS + k * guardrailStep;
      const pt = this.sample(s);
      const ptNext = this.sample(s + guardrailStep);
      const yaw = Math.atan2(ptNext.x - pt.x, guardrailStep);
      const pitch = -Math.atan2(ptNext.y - pt.y, guardrailStep);

      for (const side of [-1, 1]) {
        if (postIdx < 120) {
          this.tmpDummy.position.set(pt.x + side * (halfW + 0.4), pt.y + 0.45, s);
          this.tmpDummy.rotation.set(0, yaw, 0);
          this.tmpDummy.scale.set(1, 1, 1);
          this.tmpDummy.updateMatrix();
          this.postInst.setMatrixAt(postIdx++, this.tmpDummy.matrix);
        }
        if (railIdx < 96) {
          this.tmpDummy.position.set((pt.x + ptNext.x) * 0.5 + side * (halfW + 0.35), (pt.y + ptNext.y) * 0.5 + 0.65, s + guardrailStep * 0.5);
          this.tmpDummy.rotation.set(pitch, yaw, 0);
          this.tmpDummy.scale.set(1, 1, 1);
          this.tmpDummy.updateMatrix();
          this.railInst.setMatrixAt(railIdx++, this.tmpDummy.matrix);
        }
      }
    }

    // Overhead Highway Light Gantries every 48m (crucial for high-speed 240 MPH velocity sensation!)
    const gantryStep = 48;
    const firstGantry = Math.floor(cameraS / gantryStep) * gantryStep;
    for (let k = 0; k < 12; k++) {
      const s = firstGantry + k * gantryStep;
      const pt = this.sample(s);
      this.tmpDummy.position.set(pt.x, pt.y + 7.2, s);
      this.tmpDummy.rotation.set(0, -pt.dxDs * 0.6, 0);
      this.tmpDummy.scale.set(1, 1, 1);
      this.tmpDummy.updateMatrix();
      this.gantryInst.setMatrixAt(gantryIdx, this.tmpDummy.matrix);

      this.tmpDummy.position.set(pt.x, pt.y + 6.95, s);
      this.tmpDummy.updateMatrix();
      this.gantryNeonInst.setMatrixAt(gantryIdx, this.tmpDummy.matrix);
      gantryIdx++;
    }

    // Towering Megastructures / Bridge Towers / Arcologies (every 32m alternating sides)
    const towerStep = 32;
    const firstTower = Math.floor((cameraS - 32) / towerStep) * towerStep;
    for (let k = 0; k < 22; k++) {
      const s = firstTower + k * towerStep;
      const slot = Math.round(s / towerStep);
      const pt = this.sample(s);
      const hRand = 22 + ((Math.abs(slot * 37) % 55));
      const wRand = 11 + (Math.abs(slot * 17) % 10);

      for (const side of [-1, 1]) {
        if (towerIdx >= 52) break;
        if (this.stage.biome === "alpine" && side === 1 && slot % 2 === 0) {
          continue; // Keep scenic glacier canyon open on alternating alpine bends
        }
        const offset = halfW + 12 + (Math.abs(slot * 13 + side) % 24);
        const h = this.stage.biome === "dubai" ? hRand * 1.45 : hRand;
        this.tmpDummy.position.set(pt.x + side * offset, pt.y + h * 0.5 - 3, s);
        this.tmpDummy.rotation.set(0, ((slot % 4) * 0.08) * side, 0);
        this.tmpDummy.scale.set(wRand, h, wRand);
        this.tmpDummy.updateMatrix();
        this.towerInst.setMatrixAt(towerIdx, this.tmpDummy.matrix);

        this.tmpDummy.position.set(pt.x + side * offset, pt.y + h - 2.6, s);
        this.tmpDummy.scale.set(wRand * 1.04, 1, wRand * 1.04);
        this.tmpDummy.updateMatrix();
        this.crownNeonInst.setMatrixAt(towerIdx, this.tmpDummy.matrix);
        towerIdx++;
      }
    }

    // Nature / Trees / Peaks along shoulder
    const natureStep = 18;
    const firstNature = Math.floor((cameraS - 18) / natureStep) * natureStep;
    for (let k = 0; k < 34; k++) {
      const s = firstNature + k * natureStep;
      const slot = Math.round(s / natureStep);
      const pt = this.sample(s);
      for (const side of [-1, 1]) {
        if (natureIdx >= 72) break;
        const dist = halfW + 4.5 + (Math.abs(slot * 7 + side * 3) % 10);
        const scaleH = this.stage.biome === "alpine" ? 1.8 + (slot % 3) * 0.5 : 1.0 + (slot % 3) * 0.35;
        this.tmpDummy.position.set(pt.x + side * dist, pt.y + 2.8 * scaleH - 0.5, s);
        this.tmpDummy.rotation.set(0, slot * 0.9, 0);
        this.tmpDummy.scale.set(scaleH * 0.85, scaleH, scaleH * 0.85);
        this.tmpDummy.updateMatrix();
        this.natureInst.setMatrixAt(natureIdx++, this.tmpDummy.matrix);
      }
    }

    // Ramps & Pads inside visible window
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
        this.tmpDummy.position.set(pt.x + p.laneX, pt.y + 0.08, p.s);
        this.tmpDummy.rotation.set(-pt.dyDs, time * 1.4, 0);
        this.tmpDummy.scale.set(1, 1, 1);
        this.tmpDummy.updateMatrix();
        this.padInst.setMatrixAt(padIdx, this.tmpDummy.matrix);
        this.tmpColor.setHex(p.kind === "emp" ? 0xf59e0b : 0x00f0ff);
        this.padInst.setColorAt(padIdx, this.tmpColor);
        padIdx++;
      }
    }

    this.postInst.count = postIdx;
    this.railInst.count = railIdx;
    this.gantryInst.count = gantryIdx;
    this.gantryNeonInst.count = gantryIdx;
    this.towerInst.count = towerIdx;
    this.crownNeonInst.count = towerIdx;
    this.natureInst.count = natureIdx;
    this.rampInst.count = rampIdx;
    this.padInst.count = padIdx;

    for (const im of [
      this.postInst,
      this.railInst,
      this.gantryInst,
      this.gantryNeonInst,
      this.towerInst,
      this.crownNeonInst,
      this.natureInst,
      this.rampInst,
      this.padInst,
    ]) {
      im.instanceMatrix.needsUpdate = true;
    }
    if (this.padInst.instanceColor) this.padInst.instanceColor.needsUpdate = true;

    // Position finish arch
    if (this.stage) {
      const fPt = this.sample(this.stage.lengthMeters);
      this.finishArch.position.set(fPt.x, fPt.y, this.stage.lengthMeters);
      this.finishArch.rotation.y = -fPt.dxDs * 0.7;
    }
  }
}
