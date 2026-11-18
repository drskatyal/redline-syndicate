import * as THREE from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { BikeSpec } from "../data/bikes";
import { WeaponId } from "../data/weapons";
import { LoadedAssets } from "./AssetLoader";
import { MaterialKit } from "./MaterialLibrary";

export type TrafficKind = "exotic" | "sedan" | "muscle" | "truck" | "police";

export interface SuperbikeVisual {
  root: THREE.Group;
  chassisPivot: THREE.Group;
  frontWheelPivot: THREE.Group;
  rearWheelPivot: THREE.Group;
  exhaustFlames: THREE.Mesh[];
  paintMat: THREE.MeshPhysicalMaterial;
  accentMat: THREE.MeshPhysicalMaterial;
  tailMat: THREE.MeshStandardMaterial;
  wheelRadius: number;
  setPaintColors: (primaryHex: number, accentHex: number) => void;
  setEffects: (speedMps: number, dt: number, nitro: boolean, braking: boolean) => void;
}

export interface ArmoredRiderVisual {
  root: THREE.Group;
  updatePose: (
    leanNorm: number,
    speedNorm: number,
    attackPhase: number,
    attackSide: -1 | 0 | 1,
    attackType: "melee" | "kick",
    elapsed: number
  ) => void;
  setRagdollPose: (elapsed: number, seed: number) => void;
}

export interface TrafficVisual {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  wheels: THREE.Object3D[];
  bodyMat: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
  redStrobeMat?: THREE.MeshStandardMaterial;
  blueStrobeMat?: THREE.MeshStandardMaterial;
  spinWheels: (distanceMeters: number) => void;
  setStrobe: (time: number, active: boolean) => void;
  setHazard: (time: number, active: boolean) => void;
}

export interface HelicopterVisual {
  root: THREE.Group;
  topRotor: THREE.Object3D | null;
  backRotor: THREE.Object3D | null;
  searchBeam: THREE.Mesh;
  spotPool: THREE.Mesh;
  redStrobeMat: THREE.MeshStandardMaterial;
  blueStrobeMat: THREE.MeshStandardMaterial;
  update: (dt: number, elapsed: number, groundY: number) => void;
}

export interface PropTemplate {
  parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>;
}

export interface SkyscraperTemplates {
  geometries: THREE.BufferGeometry[];
}

const SKIP_BIKE_MICRO_NODES = /^(bolt($|_)|weld_|cylinder_|filter_oil|oil$|inside$|text_|arrow$|axis_|spring$|switch$|button_|radiator)/;
const SKIP_FERRARI_INTERIOR = /^(interior_|leather|carpet|steering_|wipers)/;

const FRONT_WHEEL_NODES = new Set([
  "tire_front",
  "rim_front",
  "decal_rim_front",
  "brake_disk_front",
  "disk_ABS_front",
  "bolt_front_whe",
  "bolt_ftont",
  "bolt_brake_front",
]);

const REAR_WHEEL_NODES = new Set([
  "tire_rear",
  "rim_rear",
  "decal_rim_rear",
  "brake_disk_rear",
  "disk_ABS_rear",
  "bolt_rear_wheel",
  "bolt_axis_rear",
  "sproket",
]);

/**
 * Converts any quantized / interleaved glTF BufferGeometry (`Int8`/`Int16`/`Uint16` normalized attributes)
 * into plain mutable Float32 BufferAttributes so matrix transforms & vertex merging never overflow or truncate.
 */
function dequantizeGeometryToFloat32(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const posAttr = src.getAttribute("position");
  if (!posAttr || posAttr.count === 0) return out;

  const count = posAttr.count;
  const v3 = new THREE.Vector3();
  const v2 = new THREE.Vector2();

  const posArr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    v3.fromBufferAttribute(posAttr, i);
    posArr[i * 3] = v3.x;
    posArr[i * 3 + 1] = v3.y;
    posArr[i * 3 + 2] = v3.z;
  }
  out.setAttribute("position", new THREE.BufferAttribute(posArr, 3));

  const normAttr = src.getAttribute("normal");
  if (normAttr && normAttr.count === count) {
    const normArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      v3.fromBufferAttribute(normAttr, i);
      normArr[i * 3] = v3.x;
      normArr[i * 3 + 1] = v3.y;
      normArr[i * 3 + 2] = v3.z;
    }
    out.setAttribute("normal", new THREE.BufferAttribute(normArr, 3));
  }

  const uvAttr = src.getAttribute("uv");
  if (uvAttr && uvAttr.count === count) {
    const uvArr = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      v2.fromBufferAttribute(uvAttr as THREE.BufferAttribute, i);
      uvArr[i * 2] = v2.x;
      uvArr[i * 2 + 1] = v2.y;
    }
    out.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
  }

  const idx = src.getIndex();
  if (idx) {
    const idxArr = count > 65535 ? new Uint32Array(idx.count) : new Uint16Array(idx.count);
    for (let i = 0; i < idx.count; i++) idxArr[i] = idx.getX(i);
    out.setIndex(new THREE.BufferAttribute(idxArr, 1));
  }

  if (!normAttr) out.computeVertexNormals();
  return out;
}

/**
 * Fast O(N) spatial-cell + coarse-normal vertex cluster welder that merges an array of BufferGeometries
 * (already in target local coordinates) and reduces excessive CAD polygons to clean real-time WebGL2 LODs.
 */
function decimateAndMergeBucket(
  geometries: THREE.BufferGeometry[],
  cellSize: number,
  preserveUv = false
): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null;

  const clusterKeyToId = new Map<string, number>();
  const sumPos: number[] = [];
  const sumNorm: number[] = [];
  const sumUv: number[] = [];
  const counts: number[] = [];
  const indices: number[] = [];
  const triSet = new Set<string>();
  const invCell = 1 / Math.max(1e-4, cellSize);
  const tmpPos = new THREE.Vector3();
  const tmpNorm = new THREE.Vector3();
  const tmpUv = new THREE.Vector2();

  const registerVertex = (
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number
  ): number => {
    const qx = Math.floor(px * invCell);
    const qy = Math.floor(py * invCell);
    const qz = Math.floor(pz * invCell);
    // Always bucket by 8 normal-sign octants so front (+N) and back (-N) thin panels never cancel to (0,0,0)
    const oct = (nx >= 0 ? 1 : 0) | (ny >= 0 ? 2 : 0) | (nz >= 0 ? 4 : 0);
    const key = preserveUv
      ? `${qx},${qy},${qz},${oct},${Math.floor(u * 128)},${Math.floor(v * 128)}`
      : `${qx},${qy},${qz},${oct}`;

    let id = clusterKeyToId.get(key);
    if (id === undefined) {
      id = counts.length;
      clusterKeyToId.set(key, id);
      sumPos.push(px, py, pz);
      sumNorm.push(nx, ny, nz);
      sumUv.push(u, v);
      counts.push(1);
    } else {
      const p3 = id * 3;
      const p2 = id * 2;
      sumPos[p3] += px;
      sumPos[p3 + 1] += py;
      sumPos[p3 + 2] += pz;
      sumNorm[p3] += nx;
      sumNorm[p3 + 1] += ny;
      sumNorm[p3 + 2] += nz;
      sumUv[p2] += u;
      sumUv[p2 + 1] += v;
      counts[id]++;
    }
    return id;
  };

  for (const g of geometries) {
    const posAttr = g.getAttribute("position");
    if (!posAttr || posAttr.count === 0) continue;
    let normAttr = g.getAttribute("normal");
    if (!normAttr) {
      g.computeVertexNormals();
      normAttr = g.getAttribute("normal");
    }
    const uvAttr = g.getAttribute("uv");
    const idxAttr = g.getIndex();

    const readV = (idx: number) => {
      tmpPos.fromBufferAttribute(posAttr, idx);
      if (normAttr) tmpNorm.fromBufferAttribute(normAttr, idx);
      else tmpNorm.set(0, 1, 0);
      if (uvAttr) tmpUv.fromBufferAttribute(uvAttr as THREE.BufferAttribute, idx);
      else tmpUv.set(0, 0);
      return registerVertex(tmpPos.x, tmpPos.y, tmpPos.z, tmpNorm.x, tmpNorm.y, tmpNorm.z, tmpUv.x, tmpUv.y);
    };

    const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(posAttr.count / 3);
    for (let t = 0; t < triCount; t++) {
      const i0 = idxAttr ? idxAttr.getX(t * 3) : t * 3;
      const i1 = idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2;

      const v0 = readV(i0);
      const v1 = readV(i1);
      const v2 = readV(i2);

      if (v0 === v1 || v1 === v2 || v0 === v2) continue;
      // Canonical sorted key to drop duplicate triangles
      const a = Math.min(v0, v1, v2);
      const c = Math.max(v0, v1, v2);
      const b = v0 + v1 + v2 - a - c;
      const tk = `${a}_${b}_${c}`;
      if (triSet.has(tk)) continue;
      triSet.add(tk);
      indices.push(v0, v1, v2);
    }
  }

  const nv = counts.length;
  if (nv === 0 || indices.length === 0) return null;

  const finalPos = new Float32Array(nv * 3);
  const finalNorm = new Float32Array(nv * 3);
  const finalUv = new Float32Array(nv * 2);
  for (let i = 0; i < nv; i++) {
    const cnt = counts[i];
    const p3 = i * 3;
    const p2 = i * 2;
    finalPos[p3] = sumPos[p3] / cnt;
    finalPos[p3 + 1] = sumPos[p3 + 1] / cnt;
    finalPos[p3 + 2] = sumPos[p3 + 2] / cnt;

    const nx = sumNorm[p3];
    const ny = sumNorm[p3 + 1];
    const nz = sumNorm[p3 + 2];
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen > 1e-4) {
      finalNorm[p3] = nx / nLen;
      finalNorm[p3 + 1] = ny / nLen;
      finalNorm[p3 + 2] = nz / nLen;
    } else {
      finalNorm[p3] = 0;
      finalNorm[p3 + 1] = 1;
      finalNorm[p3 + 2] = 0;
    }

    finalUv[p2] = sumUv[p2] / cnt;
    finalUv[p2 + 1] = sumUv[p2 + 1] / cnt;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(finalPos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(finalNorm, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(finalUv, 2));
  out.setIndex(indices);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

type BikeBucketName = "paint" | "accent" | "darkTrim" | "chrome" | "rotor" | "tailLed" | "headLed" | "glass" | "tire";

interface CompiledBikeTemplate {
  chassis: Partial<Record<BikeBucketName, THREE.BufferGeometry>>;
  frontWheel: Partial<Record<BikeBucketName, THREE.BufferGeometry>>;
  rearWheel: Partial<Record<BikeBucketName, THREE.BufferGeometry>>;
  frontAxle: THREE.Vector3;
  rearAxle: THREE.Vector3;
  exhaustPos: THREE.Vector3;
  wheelRadius: number;
}

type FerrariBucketName = "paint" | "policeTrim" | "darkTrim" | "chrome" | "smokedGlass" | "tailLed" | "headLed" | "tire";

interface CompiledFerrariTemplate {
  chassis: Partial<Record<FerrariBucketName, THREE.BufferGeometry>>;
  wheels: Array<{
    pos: THREE.Vector3;
    tire: THREE.BufferGeometry | null;
    rim: THREE.BufferGeometry | null;
    brake: THREE.BufferGeometry | null;
  }>;
  size: THREE.Vector3;
}

interface CompiledCarTemplate {
  parts: Array<{
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
    role: "paint" | "glass" | "tail" | "head" | "tire" | "rim" | "static";
  }>;
  wheels: Array<{
    pos: THREE.Vector3;
    parts: Array<{
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      isTire: boolean;
    }>;
  }>;
  size: THREE.Vector3;
}

interface TemplateCache {
  bikeHero?: CompiledBikeTemplate;
  bikeRival?: CompiledBikeTemplate;
  ferrari?: CompiledFerrariTemplate;
  tesla?: CompiledCarTemplate;
  bmw?: CompiledCarTemplate;
}

const ASSETS_CACHE = new WeakMap<LoadedAssets, TemplateCache>();

function getCache(assets: LoadedAssets): TemplateCache {
  let c = ASSETS_CACHE.get(assets);
  if (!c) {
    c = {};
    ASSETS_CACHE.set(assets, c);
  }
  return c;
}

function getCompiledBikeTemplate(assets: LoadedAssets, cellSize: number, isHero: boolean): CompiledBikeTemplate {
  const cache = getCache(assets);
  if (isHero && cache.bikeHero) return cache.bikeHero;
  if (!isHero && cache.bikeRival) return cache.bikeRival;

  const wrap = new THREE.Group();
  const cloned = assets.models.heroBike.scene.clone(true);
  wrap.add(cloned);
  wrap.updateMatrixWorld(true);

  const fTire = cloned.getObjectByName("tire_front");
  const rTire = cloned.getObjectByName("tire_rear");
  if (fTire && rTire) {
    const cf = new THREE.Box3().setFromObject(fTire).getCenter(new THREE.Vector3());
    const cr = new THREE.Box3().setFromObject(rTire).getCenter(new THREE.Vector3());
    wrap.rotation.y = -Math.atan2(cf.x - cr.x, cf.z - cr.z);
  }

  wrap.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(wrap);
  const scale = 2.14 / Math.max(0.001, rawBox.getSize(new THREE.Vector3()).z);
  wrap.scale.setScalar(scale);

  wrap.updateMatrixWorld(true);
  const sBox = new THREE.Box3().setFromObject(wrap);
  const sCenter = sBox.getCenter(new THREE.Vector3());
  wrap.position.set(-sCenter.x, -sBox.min.y, -sCenter.z);
  wrap.updateMatrixWorld(true);

  let wheelRadius = 0.31;
  const frontAxle = new THREE.Vector3(0, 0.31, 0.72);
  const rearAxle = new THREE.Vector3(0, 0.31, -0.71);
  if (fTire) {
    const fb = new THREE.Box3().setFromObject(fTire);
    fb.getCenter(frontAxle);
    wheelRadius = Math.max(0.24, (fb.max.y - fb.min.y) * 0.5);
  }
  if (rTire) {
    const rb = new THREE.Box3().setFromObject(rTire);
    rb.getCenter(rearAxle);
  }

  const muffler = cloned.getObjectByName("muffler_01") || cloned.getObjectByName("muffler01");
  const exhaustPos = new THREE.Vector3(-0.22, 0.46, -0.96);
  if (muffler) {
    const mb = new THREE.Box3().setFromObject(muffler);
    exhaustPos.set((mb.min.x + mb.max.x) * 0.5, (mb.min.y + mb.max.y) * 0.55, mb.min.z - 0.04);
  }

  const makeBucketRecord = (): Record<BikeBucketName, THREE.BufferGeometry[]> => ({
    paint: [],
    accent: [],
    darkTrim: [],
    chrome: [],
    rotor: [],
    tailLed: [],
    headLed: [],
    glass: [],
    tire: [],
  });

  const cBuckets = makeBucketRecord();
  const fBuckets = makeBucketRecord();
  const rBuckets = makeBucketRecord();

  cloned.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    if (SKIP_BIKE_MICRO_NODES.test(m.name)) return;
    const matName = (((Array.isArray(m.material) ? m.material[0] : m.material)?.name) || "").toLowerCase();

    let bName: BikeBucketName = "darkTrim";
    if (matName.includes("carpaint_second") || matName.includes("rim_second")) bName = isHero ? "accent" : "paint";
    else if (matName.includes("carpaint") || matName.includes("red.001")) bName = "paint";
    else if (matName.includes("redglass") || m.name === "LED" || m.name === "glass_red_rear") bName = "tailLed";
    else if (m.name === "lightbulb_HL" || m.name === "reflector_HL") bName = isHero ? "headLed" : "darkTrim";
    else if (matName.includes("tire")) bName = isHero ? "tire" : "darkTrim";
    else if (matName.includes("brakedisk")) bName = isHero ? "rotor" : "darkTrim";
    else if (matName.includes("licplate") || m.name.toLowerCase().includes("licplate")) bName = "darkTrim";
    else if (matName.includes("chrome") || matName.includes("gold") || matName.includes("bronze")) {
      bName = isHero ? "chrome" : "darkTrim";
    } else if (matName.includes("glass")) bName = isHero ? "glass" : "darkTrim";

    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);

    if (FRONT_WHEEL_NODES.has(m.name)) {
      g.translate(-frontAxle.x, -frontAxle.y, -frontAxle.z);
      fBuckets[!isHero ? "tire" : bName].push(g);
    } else if (REAR_WHEEL_NODES.has(m.name)) {
      g.translate(-rearAxle.x, -rearAxle.y, -rearAxle.z);
      rBuckets[!isHero ? "tire" : bName].push(g);
    } else {
      cBuckets[bName].push(g);
    }
  });

  const compileRec = (rec: Record<BikeBucketName, THREE.BufferGeometry[]>, cs: number) => {
    const res: Partial<Record<BikeBucketName, THREE.BufferGeometry>> = {};
    for (const k of Object.keys(rec) as BikeBucketName[]) {
      // Keep tires fine & preserve smooth silhouette; weld internal dark/chrome frames aggressively
      const fineCs = k === "tire" ? Math.min(cs, 0.008) : k === "paint" || k === "accent" ? Math.min(cs, 0.022) : cs;
      const merged = decimateAndMergeBucket(rec[k], fineCs, k !== "tire" && isHero);
      for (const g of rec[k]) g.dispose();
      if (merged) res[k] = merged;
    }
    return res;
  };

  const compiled: CompiledBikeTemplate = {
    chassis: compileRec(cBuckets, cellSize),
    frontWheel: compileRec(fBuckets, cellSize * 0.8),
    rearWheel: compileRec(rBuckets, cellSize * 0.8),
    frontAxle,
    rearAxle,
    exhaustPos,
    wheelRadius,
  };

  if (isHero) cache.bikeHero = compiled;
  else cache.bikeRival = compiled;
  return compiled;
}

function getCompiledFerrariTemplate(assets: LoadedAssets): CompiledFerrariTemplate {
  const cache = getCache(assets);
  if (cache.ferrari) return cache.ferrari;

  const wrap = new THREE.Group();
  const cloned = assets.models.ferrari.scene.clone(true);
  wrap.add(cloned);
  wrap.rotation.y = Math.PI;
  wrap.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(wrap);
  const center = box.getCenter(new THREE.Vector3());
  wrap.position.set(-center.x, -box.min.y, -center.z);
  wrap.updateMatrixWorld(true);

  const finalBox = new THREE.Box3().setFromObject(wrap);
  const size = finalBox.getSize(new THREE.Vector3());

  const cBuckets: Record<FerrariBucketName, THREE.BufferGeometry[]> = {
    paint: [],
    policeTrim: [],
    darkTrim: [],
    chrome: [],
    smokedGlass: [],
    tailLed: [],
    headLed: [],
    tire: [],
  };

  const wheelNames = ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"];
  const wheelObjs = new Set<THREE.Object3D>();
  const wheelDefs: CompiledFerrariTemplate["wheels"] = [];

  for (const wn of wheelNames) {
    const wObj = cloned.getObjectByName(wn);
    if (!wObj) continue;
    const wb = new THREE.Box3().setFromObject(wObj);
    const wc = wb.getCenter(new THREE.Vector3());
    const tireGeos: THREE.BufferGeometry[] = [];
    const rimGeos: THREE.BufferGeometry[] = [];
    const brakeGeos: THREE.BufferGeometry[] = [];

    wObj.traverse((sub) => {
      wheelObjs.add(sub);
      const m = sub as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      g.translate(-wc.x, -wc.y, -wc.z);
      const mn = (((Array.isArray(m.material) ? m.material[0] : m.material)?.name) || "").toLowerCase();
      if (mn.includes("tire") || m.name.includes("tire")) tireGeos.push(g);
      else if (m.name.includes("brake") || mn.includes("metal")) brakeGeos.push(g);
      else rimGeos.push(g);
    });

    wheelDefs.push({
      pos: wc,
      tire: decimateAndMergeBucket(tireGeos, 0.022, false),
      rim: decimateAndMergeBucket(rimGeos, 0.042, false),
      brake: decimateAndMergeBucket(brakeGeos, 0.045, false),
    });
    for (const g of [...tireGeos, ...rimGeos, ...brakeGeos]) g.dispose();
  }

  cloned.traverse((obj) => {
    if (wheelObjs.has(obj)) return;
    const m = obj as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const mn = (((Array.isArray(m.material) ? m.material[0] : m.material)?.name) || "").toLowerCase();
    // Drop hidden high-poly cabin seats/dash behind smoked tint glass
    if (SKIP_FERRARI_INTERIOR.test(m.name) || mn.includes("interior") || mn.includes("leather") || mn.includes("carpet")) return;

    let bk: FerrariBucketName = "darkTrim";
    if (mn.includes("body") || m.name === "body") bk = "paint";
    else if (m.name === "trim" || m.name === "blue") bk = "policeTrim";
    else if (mn.includes("taillight") || m.name === "lights_red") bk = "tailLed";
    else if (m.name === "leds" || m.name === "lights") bk = "headLed";
    else if (mn.includes("glass") || mn.includes("projector")) bk = "smokedGlass";
    else if (mn.includes("chrome")) bk = "darkTrim";

    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    cBuckets[bk].push(g);
  });

  const chassis: Partial<Record<FerrariBucketName, THREE.BufferGeometry>> = {};
  for (const k of Object.keys(cBuckets) as FerrariBucketName[]) {
    const merged = decimateAndMergeBucket(cBuckets[k], 0.052, false);
    for (const g of cBuckets[k]) g.dispose();
    if (merged) chassis[k] = merged;
  }

  const compiled: CompiledFerrariTemplate = { chassis, wheels: wheelDefs, size };
  cache.ferrari = compiled;
  return compiled;
}

function getCompiledSketchfabCarTemplate(assets: LoadedAssets, which: "tesla" | "bmw"): CompiledCarTemplate {
  const cache = getCache(assets);
  if (which === "tesla" && cache.tesla) return cache.tesla;
  if (which === "bmw" && cache.bmw) return cache.bmw;

  const targetLen = which === "tesla" ? 4.69 : 4.36;
  const sourceScene = which === "tesla" ? assets.models.teslaSedan.scene : assets.models.bmwCoupe.scene;
  const wrap = new THREE.Group();
  const cloned = sourceScene.clone(true);
  wrap.add(cloned);

  // Straighten parked front wheel steering & drop micro windshield wipers / interior steering
  cloned.traverse((o) => {
    const nm = (o.name || "").toLowerCase();
    if (/rim|tire|brake|caliper|wheel|hub/.test(nm) && Math.abs(o.rotation.y) > 0.04) {
      o.rotation.y = 0;
    }
    if (/dvor|movsteer|interiorlights/.test(nm)) {
      o.visible = false;
    }
  });
  wrap.updateMatrixWorld(true);

  const classifyRole = (meshName: string, matName: string): CompiledCarTemplate["parts"][0]["role"] => {
    const nm = meshName.toLowerCase();
    const mn = matName.toLowerCase();
    if (mn.includes("paint") || (which === "tesla" && nm.includes("primary_0") && !nm.includes("001") && !nm.includes("002"))) {
      return "paint";
    }
    if (mn.includes("glass") || mn.includes("lens")) return "glass";
    if (mn.includes("taillight") || mn.includes("rear_light") || mn.includes("breaklight") || mn.includes("tembus_red") || mn.includes("satin_red")) {
      return "tail";
    }
    if (mn.includes("headlight") || nm.includes("front_light") || mn.includes("light_pantulan")) return "head";
    if (mn.includes("tire") || nm.includes("tire")) return "tire";
    if (mn.includes("rim") || mn.includes("hub") || mn.includes("wheels.") || mn.includes("brake")) return "rim";
    return "static";
  };

  interface ExtractedGeo {
    geo: THREE.BufferGeometry;
    mat: THREE.Material;
    nm: string;
    mn: string;
    isWheel: boolean;
    role: CompiledCarTemplate["parts"][0]["role"];
  }
  const extracted: ExtractedGeo[] = [];
  const fullBox = new THREE.Box3();
  const tmpCtr = new THREE.Vector3();

  let headZSum = 0;
  let headCount = 0;
  let tailZSum = 0;
  let tailCount = 0;

  cloned.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || !m.geometry || !m.visible) return;
    let cur: THREE.Object3D | null = m;
    while (cur) {
      if (!cur.visible) return;
      cur = cur.parent;
    }

    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    if (!mat) return;
    const mn = (mat.name || "").toLowerCase();
    const nm = (m.name || "").toLowerCase();
    if (/carpet|interior|belt\.0|buttons|lcds/.test(nm + " " + mn)) return;

    // Dequantize Int16/Uint16 normalized attributes into Float32 BEFORE matrix multiplication
    const g = dequantizeGeometryToFloat32(m.geometry);
    if (!g.getAttribute("position")) {
      g.dispose();
      return;
    }
    g.applyMatrix4(m.matrixWorld);
    g.computeBoundingBox();
    if (g.boundingBox) {
      fullBox.union(g.boundingBox);
      g.boundingBox.getCenter(tmpCtr);
      if (/headlight|front_light|head_l/.test(nm + " " + mn)) {
        headZSum += tmpCtr.z;
        headCount++;
      } else if (/taillight|rear_light|breaklight|rear_lights/.test(nm + " " + mn)) {
        tailZSum += tmpCtr.z;
        tailCount++;
      }
    }

    const isWheel = /wheel|hub_|rim|tire|brake_disc|brembo_caliper/.test(nm + " " + mn);
    const role = classifyRole(nm, mn);
    extracted.push({ geo: g, mat, nm, mn, isWheel, role });
  });

  // Align longest axis to +Z, ensure headlights point +Z forward, normalize exact car length, and ground min.y = 0
  const rawSize = fullBox.getSize(new THREE.Vector3());
  const rawCtr = fullBox.getCenter(new THREE.Vector3());
  let yawFix = rawSize.x > rawSize.z ? Math.PI * 0.5 : 0;
  if (which === "bmw") {
    // Verified visually on Plate 1: raw mesh already faces +Z forward (no extra 180 flip)
  } else if (rawSize.x <= rawSize.z) {
    if ((tailCount > 0 && headCount > 0 && tailZSum / tailCount > headZSum / headCount) || (tailCount > 0 && headCount === 0 && tailZSum / tailCount > rawCtr.z)) {
      yawFix += Math.PI;
    }
  }
  const lenAlongZ = Math.max(rawSize.x, rawSize.z, 0.001);
  const scaleFactor = targetLen / lenAlongZ;
  const rotMat = new THREE.Matrix4().makeRotationY(yawFix);
  const scaleMat = new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor);
  const alignMat = new THREE.Matrix4().multiplyMatrices(scaleMat, rotMat);

  const alignedBox = new THREE.Box3();
  for (const item of extracted) {
    item.geo.applyMatrix4(alignMat);
    item.geo.computeBoundingBox();
    if (item.geo.boundingBox) alignedBox.union(item.geo.boundingBox);
  }
  const alignedCtr = alignedBox.getCenter(new THREE.Vector3());
  const shiftX = -alignedCtr.x;
  const shiftY = -alignedBox.min.y;
  const shiftZ = -alignedCtr.z;
  for (const item of extracted) {
    item.geo.translate(shiftX, shiftY, shiftZ);
    item.geo.computeBoundingBox();
  }
  const finalSize = alignedBox.getSize(new THREE.Vector3());

  interface MatGroup {
    material: THREE.Material;
    role: CompiledCarTemplate["parts"][0]["role"];
    geos: THREE.BufferGeometry[];
  }
  const bodyGroups = new Map<string, MatGroup>();
  const wheelQuad: Array<{
    pts: THREE.Vector3[];
    groups: Map<string, { material: THREE.Material; isTire: boolean; geos: THREE.BufferGeometry[] }>;
  }> = [0, 1, 2, 3].map(() => ({ pts: [], groups: new Map() }));

  for (const item of extracted) {
    if (item.isWheel && item.geo.boundingBox) {
      item.geo.boundingBox.getCenter(tmpCtr);
      const qIdx = (tmpCtr.x >= 0 ? 0 : 1) + (tmpCtr.z >= 0 ? 0 : 2);
      const q = wheelQuad[qIdx];
      q.pts.push(tmpCtr.clone());
      const isTire = item.mn.includes("tire") || item.nm.includes("tire") || item.mn.includes("wheels.2") || item.mn.includes("wheels.6");
      const key = isTire ? "tire" : "rim";
      let grp = q.groups.get(key);
      if (!grp) {
        grp = { material: item.mat, isTire, geos: [] };
        q.groups.set(key, grp);
      }
      grp.geos.push(item.geo);
    } else {
      const hasTexMap = Boolean((item.mat as THREE.MeshStandardMaterial).map);
      const key =
        item.role === "paint"
          ? "paint"
          : item.role === "glass" || item.role === "tail" || item.role === "head"
            ? item.role
            : hasTexMap
              ? `${item.mat.uuid}|static`
              : "darkTrimMerged";
      let grp = bodyGroups.get(key);
      if (!grp) {
        grp = { material: item.mat, role: item.role, geos: [] };
        bodyGroups.set(key, grp);
      }
      grp.geos.push(item.geo);
    }
  }

  const parts: CompiledCarTemplate["parts"] = [];
  for (const grp of bodyGroups.values()) {
    const merged = decimateAndMergeBucket(grp.geos, 0.028, true);
    for (const g of grp.geos) g.dispose();
    if (merged) {
      parts.push({ geometry: merged, material: grp.material, role: grp.role });
    }
  }

  const wheels: CompiledCarTemplate["wheels"] = [];
  for (const q of wheelQuad) {
    if (q.pts.length === 0) continue;
    const center = new THREE.Vector3();
    for (const p of q.pts) center.add(p);
    center.divideScalar(q.pts.length);
    const wParts: CompiledCarTemplate["wheels"][0]["parts"] = [];
    for (const grp of q.groups.values()) {
      for (const g of grp.geos) g.translate(-center.x, -center.y, -center.z);
      const merged = decimateAndMergeBucket(grp.geos, 0.02, true);
      for (const g of grp.geos) g.dispose();
      if (merged) {
        wParts.push({ geometry: merged, material: grp.material, isTire: grp.isTire });
      }
    }
    if (wParts.length > 0) wheels.push({ pos: center, parts: wParts });
  }

  const compiled: CompiledCarTemplate = { parts, wheels, size: finalSize };
  if (which === "tesla") cache.tesla = compiled;
  else cache.bmw = compiled;
  return compiled;
}

/**
 * Builds the merged & clustered superbike (`hero-motorcycle.glb`) aligned +Z forward,
 * grounded at y=0, 2.14m long, with axle-centered front/rear wheel pivots (~40K Hero / ~12K Rival tris).
 */
export function createSuperbikeInstance(
  assets: LoadedAssets,
  kit: MaterialKit,
  spec: BikeSpec,
  primaryHexOverride?: number | null,
  accentHexOverride?: number | null,
  isHero = true
): SuperbikeVisual {
  const primaryHex = primaryHexOverride ?? spec.primaryHex;
  const accentHex = accentHexOverride ?? spec.accentHex;
  const tpl = getCompiledBikeTemplate(assets, isHero ? 0.034 : 0.068, isHero);

  const root = new THREE.Group();
  const chassisPivot = new THREE.Group();
  root.add(chassisPivot);

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: primaryHex,
    metalness: 0.68,
    roughness: 0.16,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.5,
  });
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: accentHex,
    metalness: 0.72,
    roughness: 0.22,
    clearcoat: 0.9,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.35,
  });
  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: 0x191d26,
    metalness: 0.48,
    roughness: 0.42,
    envMapIntensity: 1.05,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd4dae3,
    metalness: 0.92,
    roughness: 0.16,
    envMapIntensity: 1.55,
  });
  const rotorMat = new THREE.MeshStandardMaterial({
    color: 0xaab4c0,
    metalness: 0.88,
    roughness: 0.26,
    envMapIntensity: 1.35,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff1e2d,
    emissive: 0xff1122,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xf8fbff,
    emissive: 0xe0f2fe,
    emissiveIntensity: 3.2,
    roughness: 0.1,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1220,
    metalness: 0.25,
    roughness: 0.06,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.72,
    envMapIntensity: 1.8,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x15171c,
    roughness: 0.76,
    metalness: 0.04,
    envMapIntensity: 0.65,
  });

  const bucketMats: Record<BikeBucketName, THREE.Material> = {
    paint: paintMat,
    accent: accentMat,
    darkTrim: darkTrimMat,
    chrome: chromeMat,
    rotor: rotorMat,
    tailLed: tailMat,
    headLed: headMat,
    glass: glassMat,
    tire: tireMat,
  };

  for (const k of Object.keys(tpl.chassis) as BikeBucketName[]) {
    const geo = tpl.chassis[k];
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, bucketMats[k]);
    mesh.castShadow = isHero ? k === "paint" || k === "darkTrim" || k === "accent" : k === "paint";
    mesh.receiveShadow = isHero;
    chassisPivot.add(mesh);
  }

  const frontWheelPivot = new THREE.Group();
  frontWheelPivot.position.copy(tpl.frontAxle);
  for (const k of Object.keys(tpl.frontWheel) as BikeBucketName[]) {
    const geo = tpl.frontWheel[k];
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, bucketMats[k]);
    mesh.castShadow = isHero && k === "tire";
    frontWheelPivot.add(mesh);
  }
  chassisPivot.add(frontWheelPivot);

  const rearWheelPivot = new THREE.Group();
  rearWheelPivot.position.copy(tpl.rearAxle);
  for (const k of Object.keys(tpl.rearWheel) as BikeBucketName[]) {
    const geo = tpl.rearWheel[k];
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, bucketMats[k]);
    mesh.castShadow = isHero && k === "tire";
    rearWheelPivot.add(mesh);
  }
  chassisPivot.add(rearWheelPivot);

  // Soft Multiply-blended contact shadow under tires & frame
  const aoQuad = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.45), kit.ferrariAoMat);
  aoQuad.rotation.x = -Math.PI * 0.5;
  aoQuad.position.y = 0.012;
  chassisPivot.add(aoQuad);

  // Subtle headlight road pool on the asphalt ahead of hero tire only
  if (isHero) {
    const headPoolMat = new THREE.MeshBasicMaterial({
      map: kit.headlightPoolTex,
      color: 0xfef3c7,
      transparent: true,
      opacity: 0.04,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const headPool = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 6.2), headPoolMat);
    headPool.rotation.x = -Math.PI * 0.5;
    headPool.position.set(0, 0.025, 4.0);
    chassisPivot.add(headPool);
  }

  // Crisp teardrop afterburner / backfire plume pointing backward (-Z) from tailpipe
  const exhaustFlames: THREE.Mesh[] = [];
  if (isHero) {
    const fMat = new THREE.MeshBasicMaterial({
      map: kit.jetFlameTex,
      color: 0xffa23a,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const rotZ of [0, Math.PI * 0.5]) {
      const fg = new THREE.PlaneGeometry(0.22, 0.54);
      fg.translate(0, -0.25, 0);
      fg.rotateX(Math.PI * 0.5);
      const fm = new THREE.Mesh(fg, fMat);
      fm.position.copy(tpl.exhaustPos);
      fm.rotation.z = rotZ;
      fm.visible = false;
      chassisPivot.add(fm);
      exhaustFlames.push(fm);
    }
  }

  return {
    root,
    chassisPivot,
    frontWheelPivot,
    rearWheelPivot,
    exhaustFlames,
    paintMat,
    accentMat,
    tailMat,
    wheelRadius: tpl.wheelRadius,
    setPaintColors(pHex: number, aHex: number) {
      paintMat.color.setHex(pHex);
      accentMat.color.setHex(aHex);
    },
    setEffects(speedMps: number, dt: number, nitro: boolean, braking: boolean) {
      const spin = (speedMps / tpl.wheelRadius) * dt;
      frontWheelPivot.rotation.x += spin;
      rearWheelPivot.rotation.x += spin;
      tailMat.emissiveIntensity = braking ? 4.4 : 2.1;
      for (const f of exhaustFlames) {
        f.visible = nitro && speedMps > 8;
        if (f.visible) {
          f.scale.set(0.85 + Math.random() * 0.25, 0.85 + Math.random() * 0.25, 0.8 + Math.random() * 0.55);
        }
      }
    },
  };
}

function createWeaponAttachment(weaponId: WeaponId): THREE.Group {
  const g = new THREE.Group();
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xbec5ce, metalness: 0.88, roughness: 0.26 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x22262e, metalness: 0.72, roughness: 0.42 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.85, metalness: 0.05 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc99c3c, metalness: 0.86, roughness: 0.32 });
  const redSteel = new THREE.MeshStandardMaterial({ color: 0x991b1b, metalness: 0.65, roughness: 0.38 });

  if (weaponId === "katana") {
    // Alloy Baseball Bat
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.017, 0.24, 10), gripMat);
    grip.position.y = 0.1;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.018, 0.56, 12), steelMat);
    barrel.position.y = 0.48;
    const endCap = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), darkMetal);
    endCap.position.y = 0.76;
    g.add(grip, barrel, endCap);
  } else if (weaponId === "whip") {
    // Heavy Steel Lock Chain
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.18, 8), gripMat);
    handle.position.y = 0.08;
    g.add(handle);
    for (let i = 1; i <= 7; i++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, 6, 10), steelMat);
      link.position.set(0, 0.15 + i * 0.052, 0);
      link.rotation.y = i % 2 === 0 ? 0 : Math.PI * 0.5;
      g.add(link);
    }
  } else if (weaponId === "baton") {
    // Police Nightstick / Tonfa
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 10), gripMat);
    handle.position.set(0, 0.06, 0.05);
    handle.rotation.x = Math.PI * 0.5;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.58, 12), darkMetal);
    shaft.position.y = 0.24;
    g.add(handle, shaft);
  } else if (weaponId === "arc") {
    // Forged Steel Crowbar
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.58, 8), redSteel);
    shaft.position.y = 0.28;
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.12, 0.08), steelMat);
    hook.position.set(0, 0.58, 0.035);
    hook.rotation.x = 0.45;
    g.add(shaft, hook);
  } else {
    // Brass Knuckles
    const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.09, 0.042), brassMat);
    knuckle.position.y = 0.035;
    g.add(knuckle);
  }
  return g;
}

/**
 * Clones rigged PBR `human-rider.glb` (ReadyPlayerMe realistic human facing +Z in meters),
 * preserves natural human skin/face/hair textures, tailors leather riding jacket & jeans,
 * adds riding sunglasses, attaches meter-scale weapons, and drives authentic MotoGP corner lean & melee swings.
 */
export function createArmoredRiderInstance(
  assets: LoadedAssets,
  jacketHex: number,
  _accentHex: number,
  weaponId: WeaponId,
  useHeroModel = false
): ArmoredRiderVisual {
  const root = new THREE.Group();
  const charRoot = SkeletonUtils.clone(assets.models.humanRider.scene);
  root.add(charRoot);

  charRoot.rotation.set(0, 0, 0);
  charRoot.scale.setScalar(0.93);
  charRoot.updateMatrixWorld(true);

  charRoot.traverse((obj) => {
    const sm = obj as THREE.SkinnedMesh;
    if (sm.isMesh || sm.isSkinnedMesh) {
      sm.frustumCulled = false;
      sm.castShadow = true;
      sm.receiveShadow = true;
      const mat = sm.material as THREE.MeshStandardMaterial;
      if (mat) {
        const mn = (mat.name || "").toLowerCase();
        const meshN = (sm.name || "").toLowerCase();
        // Hide cartoonish head/face/eyes/teeth/hair completely inside sculpted full-face MotoGP helmet
        if (
          mn.includes("headwear") ||
          meshN.includes("headwear") ||
          meshN.includes("eye") ||
          meshN.includes("teeth") ||
          meshN.includes("beard") ||
          meshN.includes("hair") ||
          mn.includes("head") ||
          meshN.includes("head")
        ) {
          sm.visible = false;
          return;
        }
        const clonedMat = mat.clone();
        if (mn.includes("outfit_top")) {
          clonedMat.color.setHex(jacketHex).multiplyScalar(0.96);
          clonedMat.normalMap = assets.textures.asphaltNor;
          clonedMat.normalScale = new THREE.Vector2(0.16, 0.16);
          clonedMat.roughness = 0.36;
          clonedMat.metalness = 0.12;
        } else if (mn.includes("outfit_bottom")) {
          clonedMat.color.setHex(0x182130);
          clonedMat.roughness = 0.74;
          clonedMat.metalness = 0.04;
        } else if (mn.includes("outfit_footwear")) {
          clonedMat.color.setHex(0x12151b);
          clonedMat.roughness = 0.45;
          clonedMat.metalness = 0.1;
        } else if (mn.includes("skin") || mn.includes("body") || mn.includes("hand")) {
          // Perforated carbon-black armored racing gloves over exposed hands/wrists
          clonedMat.color.setHex(0x14171f);
          clonedMat.map = null;
          clonedMat.roughness = 0.52;
          clonedMat.metalness = 0.14;
        }
        clonedMat.envMapIntensity = 1.05;
        sm.material = clonedMat;
      }
    }
  });

  const bones: Record<string, THREE.Object3D> = {};
  const restQuats: Record<string, THREE.Quaternion> = {};
  charRoot.traverse((o) => {
    if (!o.name) return;
    const norm = o.name.replace(/^mixamorig:?/, "");
    bones[norm] = o;
    restQuats[norm] = o.quaternion.clone();
  });

  // Contoured MotoGP aero speed-hump pad on hero leather race suit
  if (useHeroModel && bones["Spine2"]) {
    const humpMat = new THREE.MeshPhysicalMaterial({
      color: jacketHex,
      roughness: 0.3,
      metalness: 0.2,
      clearcoat: 0.7,
    });
    const speedHump = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), humpMat);
    speedHump.scale.set(0.85, 1.35, 0.58);
    speedHump.position.set(0, 0.06, -0.115);
    speedHump.rotation.x = 0.18;
    bones["Spine2"].add(speedHump);
  }

  // Sculpted Aerodynamic Full-Face MotoGP Helmet + Iridium Mirror Visor + Merged Carbon Trim
  if (bones["Head"]) {
    const helmetGroup = new THREE.Group();
    helmetGroup.position.set(0, 0.095, 0.015);
    helmetGroup.rotation.x = -0.1;

    const shellMat = new THREE.MeshPhysicalMaterial({
      color: useHeroModel ? 0x121620 : jacketHex,
      metalness: 0.58,
      roughness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.65,
    });
    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x0f1218,
      metalness: 0.35,
      roughness: 0.42,
      envMapIntensity: 0.9,
    });
    const visorMat = new THREE.MeshPhysicalMaterial({
      color: useHeroModel ? 0xd97706 : 0x09101c,
      metalness: useHeroModel ? 0.94 : 0.85,
      roughness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      envMapIntensity: 2.1,
    });

    const domeGeo = new THREE.SphereGeometry(0.128, 20, 14);
    domeGeo.scale(0.94, 1.04, 1.18);
    const spoilerGeo = new THREE.BoxGeometry(0.105, 0.02, 0.065);
    spoilerGeo.rotateX(0.32);
    spoilerGeo.translate(0, 0.055, -0.102);
    const shellMerged = decimateAndMergeBucket([domeGeo, spoilerGeo], 0.004, false)!;
    domeGeo.dispose();
    spoilerGeo.dispose();
    const dome = new THREE.Mesh(shellMerged, shellMat);
    dome.castShadow = useHeroModel;

    const chinGeo = new THREE.CylinderGeometry(0.12, 0.104, 0.092, 16, 1, false, -Math.PI * 0.45, Math.PI * 0.9);
    chinGeo.rotateX(0.22);
    chinGeo.translate(0, -0.052, 0.034);
    const neckGeo = new THREE.CylinderGeometry(0.086, 0.096, 0.068, 14);
    neckGeo.translate(0, -0.088, -0.008);
    const trimMerged = decimateAndMergeBucket([chinGeo, neckGeo], 0.004, false)!;
    chinGeo.dispose();
    neckGeo.dispose();
    const trimMesh = new THREE.Mesh(trimMerged, carbonMat);

    const visor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.124, 0.122, 0.072, 20, 1, true, -Math.PI * 0.36, Math.PI * 0.72),
      visorMat
    );
    visor.position.set(0, -0.004, 0.03);

    helmetGroup.add(dome, trimMesh, visor);

    if (useHeroModel) {
      const crestMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 0.35,
        roughness: 0.22,
        metalness: 0.5,
      });
      // Smooth curved sagittal racing stripe that hugs the ellipsoidal dome curvature cleanly
      const crest = new THREE.Mesh(new THREE.TorusGeometry(0.126, 0.007, 6, 16, Math.PI * 0.55), crestMat);
      crest.rotation.y = Math.PI * 0.5;
      crest.rotation.z = Math.PI * 0.22;
      crest.scale.set(1.18, 1.04, 1.0);
      helmetGroup.add(crest);
    }

    bones["Head"].add(helmetGroup);
  }

  const rightHand = bones["RightHand"];
  const leftHand = bones["LeftHand"];
  const weaponGroupR = createWeaponAttachment(weaponId);
  const weaponGroupL = createWeaponAttachment(weaponId);
  if (rightHand) {
    weaponGroupR.scale.setScalar(1.0);
    weaponGroupR.rotation.set(-0.18, 0, 0);
    weaponGroupR.position.set(0, 0.05, 0.02);
    weaponGroupR.visible = false;
    rightHand.add(weaponGroupR);
  }
  if (leftHand) {
    weaponGroupL.scale.setScalar(1.0);
    weaponGroupL.rotation.set(-0.18, 0, 0);
    weaponGroupL.position.set(0, 0.05, 0.02);
    weaponGroupL.visible = false;
    leftHand.add(weaponGroupL);
  }

  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();

  const applyDelta = (name: string, rx: number, ry: number, rz: number) => {
    const b = bones[name];
    const rq = restQuats[name];
    if (!b || !rq) return;
    tmpEuler.set(rx, ry, rz, "XYZ");
    tmpQuat.setFromEuler(tmpEuler);
    b.quaternion.copy(rq).multiply(tmpQuat);
  };

  /**
   * Drives rider posture on bike facing +Z.
   * Polarity: leanNorm < 0 = Left (+X), leanNorm > 0 = Right (-X).
   * attackSide < 0 = Left (+X), attackSide > 0 = Right (-X).
   */
  const applyMotoPose = (
    leanNorm: number,
    speedNorm: number,
    attackPhase: number,
    attackSide: -1 | 0 | 1,
    attackType: "melee" | "kick",
    elapsed: number
  ) => {
    const tuck = 0.18 + speedNorm * 0.22;
    // Shift hips inside corner: leanNorm > 0 (Right) -> -X
    const bodyShiftX = THREE.MathUtils.clamp(-leanNorm * 0.14, -0.16, 0.16);
    charRoot.position.set(bodyShiftX, -0.17, -0.24);

    // Torso leaned forward over tank; positive Z delta tilts spine toward -X (Right)
    applyDelta("Hips", 0.30 + tuck * 0.14, 0, leanNorm * 0.10);
    applyDelta("Spine", 0.22 + tuck * 0.16, 0, leanNorm * 0.14);
    applyDelta("Spine1", 0.20 + tuck * 0.14, 0, leanNorm * 0.10);
    applyDelta("Spine2", 0.14 + tuck * 0.08, -leanNorm * 0.06, 0);

    // Keep head up looking down the highway ahead (+Z) and slightly into apex
    applyDelta("Neck", -0.34 - tuck * 0.18, -leanNorm * 0.12, -leanNorm * 0.06);
    applyDelta("Head", -0.42 - tuck * 0.22, -leanNorm * 0.16, -leanNorm * 0.12);

    // Arms reaching forward/down to clip-on grips (Left=+X, Right=-X)
    let lArmX = 0.10;
    let lArmY = 0;
    let lArmZ = 0.92;
    let lForeX = 0.12;
    let lForeZ = 0.45;

    let rArmX = 0.10;
    let rArmY = 0;
    let rArmZ = -0.92;
    let rForeX = 0.12;
    let rForeZ = -0.45;

    // Knees gripping tank, knee out on inside turn, boots resting on rearsets
    const lKneeOut = leanNorm < -0.15 ? -leanNorm * 0.32 : 0;
    const rKneeOut = leanNorm > 0.15 ? leanNorm * 0.32 : 0;
    let lUpLegX = 1.28;
    let lUpLegZ = 0.28 + lKneeOut;
    let lLegX = -1.90;

    let rUpLegX = 1.28;
    let rUpLegZ = -0.28 - rKneeOut;
    let rLegX = -1.90;

    const striking = attackPhase > 0 && attackPhase < 1;
    weaponGroupR.visible = striking && attackType === "melee" && attackSide > 0;
    weaponGroupL.visible = striking && attackType === "melee" && attackSide < 0;

    if (striking) {
      const swing = Math.sin(attackPhase * Math.PI);
      if (attackType === "melee") {
        if (attackSide >= 0) {
          // Right-hand strike outward to -X
          rArmX = 0.10 - swing * 0.38;
          rArmY = -swing * 0.35;
          rArmZ = -0.92 + swing * 1.38;
          rForeX = 0.05;
          rForeZ = -0.45 * (1 - swing);
        } else {
          // Left-hand strike outward to +X
          lArmX = 0.10 - swing * 0.38;
          lArmY = swing * 0.35;
          lArmZ = 0.92 - swing * 1.38;
          lForeX = 0.05;
          lForeZ = 0.45 * (1 - swing);
        }
      } else {
        if (attackSide >= 0) {
          // Right-leg kick outward to -X
          rUpLegX = 0.65;
          rUpLegZ = -0.28 - swing * 1.05;
          rLegX = -1.90 + swing * 1.55;
        } else {
          // Left-leg kick outward to +X
          lUpLegX = 0.65;
          lUpLegZ = 0.28 + swing * 1.05;
          lLegX = -1.90 + swing * 1.55;
        }
      }
    }

    const breath = Math.sin(elapsed * 4.5) * 0.012;
    applyDelta("LeftShoulder", 0, 0, breath);
    applyDelta("RightShoulder", 0, 0, -breath);

    applyDelta("LeftArm", lArmX, lArmY, lArmZ);
    applyDelta("LeftForeArm", lForeX, 0, lForeZ);

    applyDelta("RightArm", rArmX, rArmY, rArmZ);
    applyDelta("RightForeArm", rForeX, 0, rForeZ);

    applyDelta("LeftUpLeg", lUpLegX, 0.08, lUpLegZ);
    applyDelta("LeftLeg", lLegX, 0, 0);
    applyDelta("LeftFoot", -0.32, 0, 0);

    applyDelta("RightUpLeg", rUpLegX, -0.08, rUpLegZ);
    applyDelta("RightLeg", rLegX, 0, 0);
    applyDelta("RightFoot", -0.32, 0, 0);
  };

  const setRagdollPose = (elapsed: number, seed: number) => {
    weaponGroupR.visible = false;
    weaponGroupL.visible = false;
    charRoot.position.set(0, -0.78, 0);

    const f1 = elapsed * 13.5 + seed * 3.1;
    const f2 = elapsed * 16.2 + seed * 1.7;
    const f3 = elapsed * 10.4 + seed * 2.3;

    applyDelta("Hips", 0.35 + Math.sin(f3) * 0.25, Math.cos(f1) * 0.22, Math.sin(f2) * 0.35);
    applyDelta("Spine", Math.sin(f1) * 0.42, Math.cos(f2) * 0.28, Math.sin(f3) * 0.36);
    applyDelta("Spine1", Math.cos(f2) * 0.38, Math.sin(f3) * 0.24, Math.cos(f1) * 0.32);
    applyDelta("Spine2", Math.sin(f2) * 0.3, 0, Math.cos(f3) * 0.25);
    applyDelta("Neck", Math.cos(f1) * 0.38, Math.sin(f2) * 0.42, Math.sin(f3) * 0.28);
    applyDelta("Head", Math.sin(f2) * 0.35, Math.cos(f1) * 0.4, 0);

    applyDelta("LeftArm", 0.4 + Math.sin(f1) * 1.15, Math.cos(f2) * 0.65, 0.35 + Math.sin(f3) * 0.65);
    applyDelta("LeftForeArm", -0.35 - Math.abs(Math.sin(f2)) * 1.1, 0, 0.2 + Math.cos(f1) * 0.45);
    applyDelta("RightArm", 0.4 + Math.cos(f2) * 1.15, Math.sin(f1) * 0.65, -0.35 - Math.cos(f3) * 0.65);
    applyDelta("RightForeArm", -0.35 - Math.abs(Math.cos(f1)) * 1.1, 0, -0.2 - Math.sin(f2) * 0.45);

    applyDelta("LeftUpLeg", 0.5 + Math.sin(f2) * 0.95, 0.15 + Math.cos(f1) * 0.3, 0.25 + Math.abs(Math.sin(f3)) * 0.45);
    applyDelta("LeftLeg", -0.95 - Math.cos(f1) * 0.75, 0, 0);
    applyDelta("LeftFoot", 0.25 * Math.sin(f2), 0, 0);

    applyDelta("RightUpLeg", 0.5 + Math.cos(f1) * 0.95, -0.15 + Math.sin(f2) * 0.3, -0.25 - Math.abs(Math.cos(f3)) * 0.45);
    applyDelta("RightLeg", -0.95 - Math.sin(f2) * 0.75, 0, 0);
    applyDelta("RightFoot", 0.25 * Math.cos(f1), 0, 0);
  };

  applyMotoPose(0, 0, 0, 0, "melee", 0);

  return {
    root,
    updatePose: applyMotoPose,
    setRagdollPose,
  };
}

const EXOTIC_PAINTS = [0xd4001a, 0x161b24, 0x9ca3af, 0xeab308, 0x1d4ed8, 0xe2e8f0];
const COMMUTER_PAINTS = [0xe5e7eb, 0x9ca3af, 0x1e3a5f, 0x1f2937, 0x7f1d1d, 0x334155];
const TRUCK_PAINTS = [0xe5e7eb, 0xd1d5db, 0x1e3a8a, 0x334155];

/**
 * Creates a merged & decimated high-poly Ferrari / Apex Police Interceptor or metallic Cargo Truck
 * facing +Z forward, grounded at y=0, using Multiply-blended AO shadows and smoked glass.
 */
export function createTrafficVehicleInstance(
  assets: LoadedAssets,
  kit: MaterialKit,
  kind: TrafficKind,
  variantIndex = 0
): TrafficVisual {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const wheels: THREE.Object3D[] = [];

  if (kind === "truck") {
    const modelWrap = new THREE.Group();
    const cloned = assets.models.milkTruck.scene.clone(true);
    modelWrap.add(cloned);
    bodyPivot.add(modelWrap);

    modelWrap.updateMatrixWorld(true);
    const rb = new THREE.Box3().setFromObject(modelWrap);
    const rs = rb.getSize(new THREE.Vector3());
    if (rs.x > rs.z) modelWrap.rotation.y = Math.PI * 0.5;
    else modelWrap.rotation.y = Math.PI;

    modelWrap.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(modelWrap);
    const sc = 6.2 / Math.max(0.001, b2.getSize(new THREE.Vector3()).z);
    modelWrap.scale.setScalar(sc);

    modelWrap.updateMatrixWorld(true);
    const b3 = new THREE.Box3().setFromObject(modelWrap);
    const c3 = b3.getCenter(new THREE.Vector3());
    modelWrap.position.set(-c3.x, -b3.min.y, -c3.z);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: TRUCK_PAINTS[variantIndex % TRUCK_PAINTS.length],
      normalMap: assets.textures.concreteNor,
      normalScale: new THREE.Vector2(0.14, 0.14),
      metalness: 0.42,
      roughness: 0.34,
      envMapIntensity: 1.05,
    });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x070b12,
      metalness: 0.25,
      roughness: 0.06,
      clearcoat: 1.0,
      envMapIntensity: 1.9,
    });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.78, metalness: 0.05 });

    cloned.traverse((obj) => {
      if (obj.name.toLowerCase().includes("wheel")) wheels.push(obj);
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mn = ((m.material as THREE.Material)?.name || "").toLowerCase();
      if (mn.includes("glass")) m.material = glassMat;
      else if (mn.includes("wheel")) m.material = tireMat;
      else m.material = bodyMat;
    });

    const tailLedMat = new THREE.MeshStandardMaterial({ color: 0x6b0009, emissive: 0x990f1a, emissiveIntensity: 0.85, roughness: 0.45 });
    const headLedMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, emissive: 0x93c5fd, emissiveIntensity: 0.9, roughness: 0.35 });
    for (const sx of [-0.95, 0.95]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.08), headLedMat);
      hl.position.set(sx, 0.78, 3.06);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.08), tailLedMat);
      tl.position.set(sx, 0.85, -3.06);
      bodyPivot.add(hl, tl);
    }

    const aoQuad = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 6.8), kit.ferrariAoMat);
    aoQuad.rotation.x = -Math.PI * 0.5;
    aoQuad.position.y = 0.015;
    root.add(aoQuad);

    return {
      root,
      bodyPivot,
      wheels,
      bodyMat,
      spinWheels(dist: number) {
        const r = dist / 0.48;
        for (const w of wheels) w.rotation.y = r;
      },
      setStrobe() {},
      setHazard(time: number, active: boolean) {
        const pulse = active && Math.sin(time * 18) > 0;
        tailLedMat.emissiveIntensity = pulse ? 4.8 : 0.85;
      },
    };
  }

  // Diverse street traffic fleet: Tesla Model 3 ("sedan"), BMW M3 E30 ("muscle"/"police"), Ferrari ("exotic")
  if (kind === "sedan" || kind === "muscle" || kind === "police") {
    const useTesla = kind === "sedan";
    const tpl = getCompiledSketchfabCarTemplate(assets, useTesla ? "tesla" : "bmw");
    const carGroup = new THREE.Group();
    bodyPivot.add(carGroup);

    const paintPalette = useTesla ? COMMUTER_PAINTS : [0xf8fafc, 0xc81e1e, 0x1e3a8a, 0x111827, 0xd97706, 0x64748b];
    const paintHex = kind === "police" ? 0x111622 : paintPalette[variantIndex % paintPalette.length];

    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: paintHex,
      metalness: kind === "police" ? 0.48 : 0.72,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.55,
    });
    const smokedGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x05080f,
      metalness: 0.25,
      roughness: 0.05,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.9,
      envMapIntensity: 2.0,
    });
    const tailGlassMat = new THREE.MeshStandardMaterial({
      color: 0xcc1020,
      emissive: 0xdc2626,
      emissiveIntensity: 1.35,
      roughness: 0.16,
    });
    const headProjMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0xe0f2fe,
      emissiveIntensity: 2.8,
      roughness: 0.1,
    });

    for (const part of tpl.parts) {
      let mat = part.material;
      if (part.role === "paint") {
        mat = bodyMat;
      } else if (part.role === "glass") {
        mat = smokedGlassMat;
      } else if (part.role === "tail") {
        mat = tailGlassMat;
      } else if (part.role === "head") {
        mat = headProjMat;
      } else {
        const cloned = part.material.clone() as THREE.MeshStandardMaterial;
        cloned.envMapIntensity = 1.1;
        if (useTesla && part.role === "static") {
          const mn = (part.material.name || "").toLowerCase();
          if (mn.includes("palettematerial002")) {
            cloned.color.setHex(paintHex);
            cloned.roughness = 0.2;
            cloned.metalness = 0.65;
          }
        }
        mat = cloned;
      }
      const mesh = new THREE.Mesh(part.geometry, mat);
      mesh.castShadow = part.role === "paint" || part.role === "static";
      mesh.receiveShadow = part.role !== "glass";
      carGroup.add(mesh);
    }

    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.88, roughness: 0.2, envMapIntensity: 1.4 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.78, metalness: 0.05 });

    for (const wd of tpl.wheels) {
      const wp = new THREE.Group();
      wp.position.copy(wd.pos);
      for (const p of wd.parts) {
        const m = new THREE.Mesh(p.geometry, p.isTire ? tireMat : rimMat);
        m.castShadow = false;
        wp.add(m);
      }
      bodyPivot.add(wp);
      wheels.push(wp);
    }

    const aoQuad = new THREE.Mesh(new THREE.PlaneGeometry(tpl.size.x * 1.4, tpl.size.z * 1.15), kit.ferrariAoMat);
    aoQuad.rotation.x = -Math.PI * 0.5;
    aoQuad.position.y = 0.014;
    root.add(aoQuad);

    let redStrobeMat: THREE.MeshStandardMaterial | undefined;
    let blueStrobeMat: THREE.MeshStandardMaterial | undefined;

    if (kind === "police") {
      const roofY = tpl.size.y;
      const barHousing = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.09, 0.26), kit.darkAlloyMat);
      barHousing.position.set(0, roofY + 0.02, -0.05);

      redStrobeMat = new THREE.MeshStandardMaterial({
        color: 0xff1e2d,
        emissive: 0xff1e2d,
        emissiveIntensity: 4.5,
        roughness: 0.12,
      });
      blueStrobeMat = new THREE.MeshStandardMaterial({
        color: 0x1e78ff,
        emissive: 0x1e78ff,
        emissiveIntensity: 4.5,
        roughness: 0.12,
      });

      const lensL = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.24), redStrobeMat);
      lensL.position.set(-0.3, roofY + 0.04, -0.05);
      const lensR = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.24), blueStrobeMat);
      lensR.position.set(0.3, roofY + 0.04, -0.05);

      const patrolWhiteMat = new THREE.MeshPhysicalMaterial({ color: 0xf8fafc, metalness: 0.35, roughness: 0.18, clearcoat: 1.0 });
      const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(tpl.size.x * 0.99, 0.30, 1.42), patrolWhiteMat);
      doorPanel.position.set(0, 0.54, -0.05);
      const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(tpl.size.x * 0.64, 0.04, 1.25), patrolWhiteMat);
      roofPanel.position.set(0, roofY - 0.01, -0.14);

      bodyPivot.add(barHousing, lensL, lensR, doorPanel, roofPanel);
    }

    return {
      root,
      bodyPivot,
      wheels,
      bodyMat,
      redStrobeMat,
      blueStrobeMat,
      spinWheels(dist: number) {
        const ang = dist / 0.33;
        for (const w of wheels) w.rotation.x = ang;
      },
      setStrobe(time: number, active: boolean) {
        if (!redStrobeMat || !blueStrobeMat) return;
        const pulse = Math.sin(time * 22);
        redStrobeMat.emissiveIntensity = active ? (pulse > 0 ? 6.5 : 0.4) : 0.4;
        blueStrobeMat.emissiveIntensity = active ? (pulse < 0 ? 6.5 : 0.4) : 0.4;
      },
      setHazard(time: number, active: boolean) {
        const pulse = active && Math.sin(time * 18) > 0;
        tailGlassMat.emissiveIntensity = pulse ? 5.8 : 2.2;
      },
    };
  }

  // Compiled Ferrari Supercar ("exotic")
  const tpl = getCompiledFerrariTemplate(assets);
  const carGroup = new THREE.Group();
  bodyPivot.add(carGroup);

  const paintHex = EXOTIC_PAINTS[variantIndex % EXOTIC_PAINTS.length];
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: paintHex,
    metalness: 0.72,
    roughness: 0.14,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.6,
  });
  const policeTrimMat = new THREE.MeshPhysicalMaterial({
    color: 0x1a1e26,
    metalness: 0.35,
    roughness: 0.22,
    clearcoat: 1.0,
  });
  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: 0x181c24,
    metalness: 0.55,
    roughness: 0.42,
    envMapIntensity: 1.1,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.92,
    roughness: 0.16,
    envMapIntensity: 1.5,
  });
  const smokedGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x05080f,
    metalness: 0.25,
    roughness: 0.05,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.9,
    envMapIntensity: 2.0,
  });
  const tailGlassMat = new THREE.MeshStandardMaterial({
    color: 0xff1e2d,
    emissive: 0xff1122,
    emissiveIntensity: 2.5,
    roughness: 0.15,
  });
  const headProjMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0xe0f2fe,
    emissiveIntensity: 3.2,
    roughness: 0.1,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.78, metalness: 0.04 });

  const mats: Record<FerrariBucketName, THREE.Material> = {
    paint: bodyMat,
    policeTrim: policeTrimMat,
    darkTrim: darkTrimMat,
    chrome: chromeMat,
    smokedGlass: smokedGlassMat,
    tailLed: tailGlassMat,
    headLed: headProjMat,
    tire: tireMat,
  };

  for (const k of Object.keys(tpl.chassis) as FerrariBucketName[]) {
    const geo = tpl.chassis[k];
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mats[k]);
    mesh.castShadow = k === "paint";
    mesh.receiveShadow = k !== "smokedGlass";
    carGroup.add(mesh);
  }

  for (const wd of tpl.wheels) {
    const wp = new THREE.Group();
    wp.position.copy(wd.pos);
    if (wd.tire) {
      const m = new THREE.Mesh(wd.tire, tireMat);
      m.castShadow = false;
      wp.add(m);
    }
    if (wd.rim) wp.add(new THREE.Mesh(wd.rim, chromeMat));
    bodyPivot.add(wp);
    wheels.push(wp);
  }

  const aoQuad = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 5.15), kit.ferrariAoMat);
  aoQuad.rotation.x = -Math.PI * 0.5;
  aoQuad.position.y = 0.014;
  root.add(aoQuad);

  return {
    root,
    bodyPivot,
    wheels,
    bodyMat,
    spinWheels(dist: number) {
      const ang = dist / 0.34;
      for (const w of wheels) w.rotation.x = ang;
    },
    setStrobe() {},
    setHazard(time: number, active: boolean) {
      const pulse = active && Math.sin(time * 18) > 0;
      tailGlassMat.emissiveIntensity = pulse ? 6.2 : 2.5;
    },
  };
}

/**
 * Clones the Bell Huey Helicopter (`helicopter.glb`), normalizes to 11.2m length facing +Z,
 * upgrades matte tactical materials, spinning rotors, belly strobes, and searchlight beam.
 */
export function createPursuitHelicopterInstance(assets: LoadedAssets): HelicopterVisual {
  const root = new THREE.Group();
  const cloned = assets.models.helicopter.scene.clone(true);
  root.add(cloned);

  cloned.updateMatrixWorld(true);
  const rb = new THREE.Box3().setFromObject(cloned);
  const rs = rb.getSize(new THREE.Vector3());
  const scale = 11.2 / Math.max(0.001, Math.max(rs.x, rs.z));
  cloned.scale.setScalar(scale);

  cloned.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(cloned);
  const c2 = b2.getCenter(new THREE.Vector3());
  cloned.position.set(-c2.x, -b2.min.y, -c2.z);

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x181f29,
    metalness: 0.72,
    roughness: 0.38,
    envMapIntensity: 1.25,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x09111c,
    metalness: 0.88,
    roughness: 0.08,
    clearcoat: 1.0,
    envMapIntensity: 1.7,
  });

  cloned.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    const mn = ((m.material as THREE.Material)?.name || "").toLowerCase();
    m.material = mn.includes("glass") ? glassMat : hullMat;
  });

  const topRotor = cloned.getObjectByName("Top_Rotor") || null;
  const backRotor = cloned.getObjectByName("Back_Rotor") || null;

  const redStrobeMat = new THREE.MeshStandardMaterial({ color: 0xff1e2d, emissive: 0xff1e2d, emissiveIntensity: 5.0 });
  const blueStrobeMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 5.0 });
  const diodeL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), redStrobeMat);
  diodeL.position.set(-0.9, 0.8, 1.2);
  const diodeR = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), blueStrobeMat);
  diodeR.position.set(0.9, 0.8, 1.2);
  root.add(diodeL, diodeR);

  const beamGeo = new THREE.ConeGeometry(4.4, 18.5, 24, 1, true);
  beamGeo.translate(0, -9.25, 0);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xe0f2fe,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const searchBeam = new THREE.Mesh(beamGeo, beamMat);
  searchBeam.position.set(0, 0.5, 2.2);
  searchBeam.rotation.x = 0.24;
  root.add(searchBeam);

  const poolGeo = new THREE.CircleGeometry(4.2, 24);
  poolGeo.rotateX(-Math.PI * 0.5);
  const spotPool = new THREE.Mesh(
    poolGeo,
    new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  root.add(spotPool);

  return {
    root,
    topRotor,
    backRotor,
    searchBeam,
    spotPool,
    redStrobeMat,
    blueStrobeMat,
    update(dt: number, elapsed: number, groundY: number) {
      if (topRotor) topRotor.rotation.y += dt * 24;
      if (backRotor) backRotor.rotation.x += dt * 32;
      const flash = Math.sin(elapsed * 20);
      redStrobeMat.emissiveIntensity = flash > 0 ? 6.5 : 0.4;
      blueStrobeMat.emissiveIntensity = flash < 0 ? 6.5 : 0.4;
      spotPool.position.set(0, groundY - root.position.y + 0.06, 6.5);
    },
  };
}

/**
 * Extracts normalized, instancing-ready PBR BufferGeometry + Material pairs from Poly Haven props.
 */
export function prewarmVehicleTemplates(assets: LoadedAssets): void {
  getCompiledBikeTemplate(assets, 0.034, true);
  getCompiledBikeTemplate(assets, 0.068, false);
  getCompiledFerrariTemplate(assets);
  getCompiledSketchfabCarTemplate(assets, "tesla");
  getCompiledSketchfabCarTemplate(assets, "bmw");
}

export function extractPropTemplate(gltf: GLTF, targetHeight: number, alignLengthAxisZ = false): PropTemplate {
  const wrap = new THREE.Group();
  const cloned = gltf.scene.clone(true);
  wrap.add(cloned);
  wrap.updateMatrixWorld(true);

  if (alignLengthAxisZ) {
    const rb = new THREE.Box3().setFromObject(wrap);
    const rs = rb.getSize(new THREE.Vector3());
    if (rs.x > rs.z) wrap.rotation.y = Math.PI * 0.5;
    wrap.updateMatrixWorld(true);
  }

  const b = new THREE.Box3().setFromObject(wrap);
  const s = b.getSize(new THREE.Vector3());
  const scale = targetHeight / Math.max(0.001, s.y);
  wrap.scale.setScalar(scale);

  wrap.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(wrap);
  const c2 = b2.getCenter(new THREE.Vector3());
  wrap.position.set(-c2.x, -b2.min.y, -c2.z);
  wrap.updateMatrixWorld(true);

  const parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = [];
  wrap.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const clonedMat = (mat as THREE.MeshStandardMaterial).clone();
    clonedMat.envMapIntensity = 0.85;
    parts.push({ geometry: g, material: clonedMat });
  });

  return { parts };
}

/**
 * Builds 3 non-box stepped modern architectural high-rise tower geometries normalized in unit [-0.5..0.5] X/Z
 * and [0..1] Y, with proper world-scaled UV coordinates so curtain-wall glass floors never stretch.
 */
export function createSkyscraperTemplates(): SkyscraperTemplates {
  const mkTieredTower = (variant: number): THREE.BufferGeometry => {
    const meshes: THREE.BoxGeometry[] = [];
    const addBox = (w: number, h: number, d: number, yCenter: number) => {
      const box = new THREE.BoxGeometry(w, h, d);
      const uv = box.attributes.uv as THREE.BufferAttribute;
      const nor = box.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        const nx = Math.abs(nor.getX(i));
        const ny = Math.abs(nor.getY(i));
        const spanU = nx > 0.5 ? d * 2.5 : w * 2.5;
        const spanV = ny > 0.5 ? d * 2.0 : h * 3.2;
        uv.setXY(i, uv.getX(i) * spanU, uv.getY(i) * spanV);
      }
      box.translate(0, yCenter, 0);
      meshes.push(box);
    };

    if (variant === 0) {
      addBox(1.0, 0.24, 1.0, 0.12);
      addBox(0.84, 0.48, 0.84, 0.48);
      addBox(0.66, 0.22, 0.66, 0.83);
      addBox(0.32, 0.06, 0.32, 0.97);
    } else if (variant === 1) {
      addBox(1.0, 0.28, 1.0, 0.14);
      addBox(0.9, 0.56, 0.68, 0.56);
      addBox(0.55, 0.16, 0.55, 0.92);
    } else if (variant === 2) {
      addBox(1.0, 0.35, 1.0, 0.175);
      addBox(0.74, 0.45, 0.74, 0.575);
      addBox(0.45, 0.2, 0.45, 0.9);
    } else {
      // Mid-rise wide commercial podium + asymmetrical twin wings
      addBox(1.0, 0.22, 0.96, 0.11);
      addBox(0.42, 0.74, 0.72, 0.58);
      addBox(0.42, 0.56, 0.68, 0.48);
      addBox(0.28, 0.04, 0.28, 0.97);
      const len = meshes.length;
      meshes[len - 3].translate(-0.24, 0, 0);
      meshes[len - 2].translate(0.24, 0, 0.06);
      meshes[len - 1].translate(-0.24, 0, 0);
    }

    const totalVerts = meshes.reduce((s, m) => s + m.attributes.position.count, 0);
    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const indices: number[] = [];
    let vOff = 0;
    for (const m of meshes) {
      positions.set(m.attributes.position.array as Float32Array, vOff * 3);
      normals.set(m.attributes.normal.array as Float32Array, vOff * 3);
      uvs.set(m.attributes.uv.array as Float32Array, vOff * 2);
      const idx = m.getIndex();
      if (idx) {
        for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vOff);
      }
      vOff += m.attributes.position.count;
      m.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    merged.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    merged.setIndex(indices);
    return merged;
  };

  return {
    geometries: [mkTieredTower(0), mkTieredTower(1), mkTieredTower(2), mkTieredTower(3)],
  };
}

/**
 * Builds an instancing-ready coastal palm tree using scanned Poly Haven bark & feathered serrated palm frond alpha blades
 * (zero blocky boxes, lush wind-swept tropical silhouette in just 2 draw calls per InstancedMesh cohort).
 */
export function createCoastalPalmTemplate(assets: LoadedAssets, kit: MaterialKit): PropTemplate {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.28, 3.0, 0.05),
    new THREE.Vector3(0.75, 6.2, 0.0),
    new THREE.Vector3(1.18, 9.1, -0.04),
  ]);
  const radialSegs = 8;
  const tubularSegs = 12;
  const frames = curve.computeFrenetFrames(tubularSegs, false);
  const posArr: number[] = [];
  const uvArr: number[] = [];
  const idxArr: number[] = [];
  for (let i = 0; i <= tubularSegs; i++) {
    const t = i / tubularSegs;
    const c = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = THREE.MathUtils.lerp(0.29, 0.125, t);
    for (let j = 0; j <= radialSegs; j++) {
      const th = (j / radialSegs) * Math.PI * 2;
      const cosT = Math.cos(th);
      const sinT = Math.sin(th);
      const vx = c.x + r * (cosT * N.x + sinT * B.x);
      const vy = c.y + r * (cosT * N.y + sinT * B.y);
      const vz = c.z + r * (cosT * N.z + sinT * B.z);
      posArr.push(vx, vy, vz);
      uvArr.push(j / radialSegs, t * 5);
    }
  }
  const stride = radialSegs + 1;
  for (let i = 0; i < tubularSegs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * stride + j;
      const b = a + stride;
      const c = b + 1;
      const d = a + 1;
      idxArr.push(a, b, d, b, c, d);
    }
  }
  const trunkGeo = new THREE.BufferGeometry();
  trunkGeo.setAttribute("position", new THREE.Float32BufferAttribute(posArr, 3));
  trunkGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvArr, 2));
  trunkGeo.setIndex(idxArr);
  trunkGeo.computeVertexNormals();

  // Arched curved ribbon blades UV-mapped [0..1] to feathered pinnate frond alpha cutout texture
  const crownX = 1.18;
  const crownY = 9.05;
  const crownZ = -0.04;
  const fPos: number[] = [];
  const fUv: number[] = [];
  const fIdx: number[] = [];
  const frondCount = 14;
  const segs = 7;
  for (let f = 0; f < frondCount; f++) {
    const tier = f % 3;
    const az = (f / frondCount) * Math.PI * 2 + tier * 0.21;
    const cosA = Math.cos(az);
    const sinA = Math.sin(az);
    const len = 3.25 + (tier === 1 ? 0.5 : tier === 2 ? -0.2 : 0.15);
    const lift = tier === 2 ? 0.95 : tier === 0 ? 0.52 : 0.12;
    const droop = tier === 1 ? 1.55 : tier === 0 ? 1.05 : 0.65;
    const halfWBase = 0.98;

    const baseV = fPos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const fwd = t * len;
      const yOff = lift * Math.sin(t * Math.PI * 0.65) - droop * t * t;
      const tiltOut = (t * 0.55) * halfWBase;
      const hw = halfWBase * (0.68 + 0.32 * Math.sin(t * Math.PI));

      for (const side of [-1, 1]) {
        const lx = side * hw;
        const ly = yOff - Math.abs(side) * 0.08 * (1 + tiltOut);
        const lz = fwd;
        const wx = crownX + lx * cosA + lz * sinA;
        const wy = crownY + ly;
        const wz = crownZ - lx * sinA + lz * cosA;
        fPos.push(wx, wy, wz);
        fUv.push(side < 0 ? 0 : 1, t);
      }
    }
    for (let s = 0; s < segs; s++) {
      const r0 = baseV + s * 2;
      const r1 = r0 + 2;
      fIdx.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
    }
  }
  const frondGeo = new THREE.BufferGeometry();
  frondGeo.setAttribute("position", new THREE.Float32BufferAttribute(fPos, 3));
  frondGeo.setAttribute("uv", new THREE.Float32BufferAttribute(fUv, 2));
  frondGeo.setIndex(fIdx);
  frondGeo.computeVertexNormals();

  const trunkMat = new THREE.MeshStandardMaterial({
    map: assets.textures.palmBarkDiff,
    normalMap: assets.textures.concreteNor,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });
  const frondMat = new THREE.MeshStandardMaterial({
    map: kit.palmFrondTex,
    alphaTest: 0.36,
    side: THREE.DoubleSide,
    roughness: 0.62,
    metalness: 0.02,
    envMapIntensity: 0.7,
  });

  return {
    parts: [
      { geometry: trunkGeo, material: trunkMat },
      { geometry: frondGeo, material: frondMat },
    ],
  };
}

/** Instancing-ready coastal wooden lifeguard lookout tower (2 draw calls total across beach!). */
export function createLifeguardTowerTemplate(kit: MaterialKit): PropTemplate {
  const whiteWoodGeos: THREE.BufferGeometry[] = [];
  const trimBlueGeos: THREE.BufferGeometry[] = [];

  const addBox = (arr: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, rz = 0, rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    arr.push(g);
  };

  // Stilts + cross braces + shack walls + wrap balcony deck
  for (const sx of [-1.25, 1.25]) {
    for (const sz of [-1.25, 1.25]) {
      addBox(whiteWoodGeos, 0.2, 2.5, 0.2, sx, 1.25, sz);
    }
  }
  addBox(whiteWoodGeos, 3.2, 0.18, 3.3, 0, 2.5, 0);
  addBox(whiteWoodGeos, 2.3, 2.1, 2.2, 0, 3.6, -0.2);
  addBox(trimBlueGeos, 2.9, 0.26, 2.8, 0, 4.78, -0.2);
  addBox(trimBlueGeos, 2.6, 0.92, 0.1, 0, 3.7, 0.92);
  addBox(trimBlueGeos, 3.15, 0.16, 0.16, 0, 3.2, 1.55);
  addBox(trimBlueGeos, 1.9, 0.65, 0.12, 0, 3.85, 0.94);

  const g1 = decimateAndMergeBucket(whiteWoodGeos, 0.02, false)!;
  const g2 = decimateAndMergeBucket(trimBlueGeos, 0.02, false)!;
  for (const g of [...whiteWoodGeos, ...trimBlueGeos]) g.dispose();

  return {
    parts: [
      { geometry: g1, material: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.78, map: kit.concreteMat.map }) },
      { geometry: g2, material: new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.45, metalness: 0.12 }) },
    ],
  };
}

/** Instancing-ready beachfront resort parasol umbrella (2 draw calls across shoreline!). */
export function createBeachUmbrellaTemplate(): PropTemplate {
  const pole = new THREE.CylinderGeometry(0.055, 0.065, 2.85, 8);
  pole.translate(0, 1.425, 0);
  const canopy = new THREE.ConeGeometry(1.72, 0.68, 8);
  canopy.translate(0, 2.72, 0);
  return {
    parts: [
      { geometry: pole, material: new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.8 }) },
      { geometry: canopy, material: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.55, side: THREE.DoubleSide }) },
    ],
  };
}

/** Instancing-ready ocean sailboat silhouette for coastal horizon depth (2 draw calls). */
export function createSailboatTemplate(): PropTemplate {
  const hull = new THREE.BoxGeometry(2.1, 0.85, 7.6);
  hull.translate(0, 0.45, 0);
  const sail = new THREE.ConeGeometry(2.8, 7.8, 3);
  sail.scale(0.18, 1.0, 0.9);
  sail.translate(0, 4.9, 0.2);
  return {
    parts: [
      { geometry: hull, material: new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.35, metalness: 0.08 }) },
      { geometry: sail, material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, emissive: 0x334155, emissiveIntensity: 0.12 }) },
    ],
  };
}

/** Instancing-ready coastal highway monopole billboard (2 draw calls across highway!). */
export function createBillboardTemplate(kit: MaterialKit): PropTemplate {
  const frameGeos: THREE.BufferGeometry[] = [];
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    frameGeos.push(g);
  };
  const post = new THREE.CylinderGeometry(0.32, 0.42, 8.6, 10);
  post.translate(0, 4.3, -0.52);
  frameGeos.push(post);
  addBox(11.6, 5.4, 0.36, 0, 8.8, -0.22);
  const frameGeo = decimateAndMergeBucket(frameGeos, 0.02, false)!;
  for (const g of frameGeos) g.dispose();

  const boardGeo = new THREE.BoxGeometry(11.0, 4.8, 0.14);
  boardGeo.translate(0, 8.8, 0.06);

  return {
    parts: [
      { geometry: frameGeo, material: kit.darkAlloyMat },
      { geometry: boardGeo, material: kit.billboardMat },
    ],
  };
}
