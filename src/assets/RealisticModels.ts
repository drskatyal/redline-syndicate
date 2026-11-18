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
}

export interface TrafficVisual {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  bodyMat: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
  redStrobeMat?: THREE.MeshStandardMaterial;
  blueStrobeMat?: THREE.MeshStandardMaterial;
  spinWheels: (distanceMeters: number) => void;
  setStrobe: (time: number, active: boolean) => void;
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
 * Fast O(N) spatial-cell + coarse-normal vertex cluster welder that merges an array of BufferGeometries
 * (already in target local coordinates) and reduces excessive CAD polygons to clean real-time WebGL2 LODs.
 */
function decimateAndMergeBucket(
  geometries: THREE.BufferGeometry[],
  cellSize: number,
  _splitNormals = true
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
    const key = `${qx},${qy},${qz},${oct}`;

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
    const posAttr = g.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr || posAttr.count === 0) continue;
    let normAttr = g.getAttribute("normal") as THREE.BufferAttribute | undefined;
    if (!normAttr) {
      g.computeVertexNormals();
      normAttr = g.getAttribute("normal") as THREE.BufferAttribute;
    }
    const uvAttr = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
    const idxAttr = g.getIndex();

    const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(posAttr.count / 3);
    for (let t = 0; t < triCount; t++) {
      const i0 = idxAttr ? idxAttr.getX(t * 3) : t * 3;
      const i1 = idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2;

      const v0 = registerVertex(
        posAttr.getX(i0),
        posAttr.getY(i0),
        posAttr.getZ(i0),
        normAttr ? normAttr.getX(i0) : 0,
        normAttr ? normAttr.getY(i0) : 1,
        normAttr ? normAttr.getZ(i0) : 0,
        uvAttr ? uvAttr.getX(i0) : 0,
        uvAttr ? uvAttr.getY(i0) : 0
      );
      const v1 = registerVertex(
        posAttr.getX(i1),
        posAttr.getY(i1),
        posAttr.getZ(i1),
        normAttr ? normAttr.getX(i1) : 0,
        normAttr ? normAttr.getY(i1) : 1,
        normAttr ? normAttr.getZ(i1) : 0,
        uvAttr ? uvAttr.getX(i1) : 0,
        uvAttr ? uvAttr.getY(i1) : 0
      );
      const v2 = registerVertex(
        posAttr.getX(i2),
        posAttr.getY(i2),
        posAttr.getZ(i2),
        normAttr ? normAttr.getX(i2) : 0,
        normAttr ? normAttr.getY(i2) : 1,
        normAttr ? normAttr.getZ(i2) : 0,
        uvAttr ? uvAttr.getX(i2) : 0,
        uvAttr ? uvAttr.getY(i2) : 0
      );

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

interface TemplateCache {
  bikeHero?: CompiledBikeTemplate;
  bikeRival?: CompiledBikeTemplate;
  ferrari?: CompiledFerrariTemplate;
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
    if (matName.includes("carpaint_second") || matName.includes("rim_second")) bName = "accent";
    else if (matName.includes("carpaint") || matName.includes("red.001")) bName = "paint";
    else if (matName.includes("redglass") || m.name === "LED" || m.name === "glass_red_rear") bName = "tailLed";
    else if (m.name === "lightbulb_HL" || m.name === "reflector_HL") bName = "headLed";
    else if (matName.includes("tire")) bName = "tire";
    else if (matName.includes("brakedisk")) bName = isHero ? "rotor" : "darkTrim";
    else if (matName.includes("licplate") || m.name.toLowerCase().includes("licplate")) bName = "darkTrim";
    else if (matName.includes("chrome") || matName.includes("gold") || matName.includes("bronze")) {
      bName = isHero ? "chrome" : "darkTrim";
    } else if (matName.includes("glass")) bName = isHero ? "glass" : "darkTrim";

    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);

    if (FRONT_WHEEL_NODES.has(m.name)) {
      g.translate(-frontAxle.x, -frontAxle.y, -frontAxle.z);
      fBuckets[!isHero && bName === "accent" ? "tire" : bName].push(g);
    } else if (REAR_WHEEL_NODES.has(m.name)) {
      g.translate(-rearAxle.x, -rearAxle.y, -rearAxle.z);
      rBuckets[!isHero && bName === "accent" ? "tire" : bName].push(g);
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

  // Subtle headlight road pool on the asphalt ahead of the tire (suppressed in daytime)
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

  // Crisp teardrop afterburner / backfire plume pointing backward (-Z) from tailpipe
  const exhaustFlames: THREE.Mesh[] = [];
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
    // Top of jetFlameTex is nozzle tip (y=+0.31), tail goes -0.31; rotate so nozzle is at Z=0, tail extends -Z
    fg.translate(0, -0.25, 0);
    fg.rotateX(Math.PI * 0.5);
    const fm = new THREE.Mesh(fg, fMat);
    fm.position.copy(tpl.exhaustPos);
    fm.rotation.z = rotZ;
    fm.visible = false;
    chassisPivot.add(fm);
    exhaustFlames.push(fm);
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
  weaponId: WeaponId
): ArmoredRiderVisual {
  const root = new THREE.Group();
  const charRoot = SkeletonUtils.clone(assets.models.humanRider.scene);
  root.add(charRoot);

  // readyplayer.me.glb natively faces +Z in world meters (~1.86m standing) -> slight scale to 1.72m rider
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
        // Remove fedora headwear and hidden teeth/eye spheres behind wraparound shades to cut draw calls
        if (
          mn.includes("headwear") ||
          meshN.includes("headwear") ||
          meshN.includes("eye") ||
          meshN.includes("teeth")
        ) {
          sm.visible = false;
          return;
        }
        const clonedMat = mat.clone();
        if (mn.includes("outfit_top")) {
          // Tailored leather / textile street motorcycle jacket
          clonedMat.color.setHex(jacketHex).multiplyScalar(0.95);
          clonedMat.roughness = 0.46;
          clonedMat.metalness = 0.08;
        } else if (mn.includes("outfit_bottom")) {
          clonedMat.color.setHex(0x1b2434);
          clonedMat.roughness = 0.78;
          clonedMat.metalness = 0.02;
        } else if (mn.includes("outfit_footwear")) {
          clonedMat.color.setHex(0x14161b);
          clonedMat.roughness = 0.52;
          clonedMat.metalness = 0.06;
        }
        // Leave Wolf3D_Skin, Wolf3D_Eye, Wolf3D_Teeth, Wolf3D_Beard photorealistic skin tones untouched!
        clonedMat.envMapIntensity = 1.0;
        sm.material = clonedMat;
      }
    }
  });

  const bones: Record<string, THREE.Object3D> = {};
  const restQuats: Record<string, THREE.Quaternion> = {};
  charRoot.traverse((o) => {
    if (!o.name) return;
    bones[o.name] = o;
    restQuats[o.name] = o.quaternion.clone();
  });

  // Fitted open-face street motorcycle helmet shell + wraparound dark sunglasses (keeps human face/beard visible!)
  if (bones["Head"]) {
    const helmetShellMat = new THREE.MeshPhysicalMaterial({
      color: 0x151922,
      metalness: 0.45,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.35,
    });
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.118, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.58),
      helmetShellMat
    );
    shell.scale.set(0.96, 1.05, 1.14);
    shell.position.set(0, 0.112, 0.01);
    shell.rotation.x = -0.16;

    const shadeMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b0e14,
      metalness: 0.78,
      roughness: 0.12,
      clearcoat: 1.0,
      envMapIntensity: 1.6,
    });
    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.132, 0.032, 0.022), shadeMat);
    glasses.position.set(0, 0.088, 0.108);
    bones["Head"].add(shell, glasses);
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

  applyMotoPose(0, 0, 0, 0, "melee", 0);

  return {
    root,
    updatePose: applyMotoPose,
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
  const wheels: THREE.Object3D[] = [];

  if (kind === "truck") {
    const modelWrap = new THREE.Group();
    const cloned = assets.models.milkTruck.scene.clone(true);
    modelWrap.add(cloned);
    root.add(modelWrap);

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

    const tailLedMat = new THREE.MeshStandardMaterial({ color: 0x6b0009, emissive: 0x990f1a, emissiveIntensity: 0.75, roughness: 0.45 });
    const headLedMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, emissive: 0x93c5fd, emissiveIntensity: 0.9, roughness: 0.35 });
    for (const sx of [-0.95, 0.95]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.08), headLedMat);
      hl.position.set(sx, 0.78, 3.06);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.08), tailLedMat);
      tl.position.set(sx, 0.85, -3.06);
      root.add(hl, tl);
    }

    const aoQuad = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 6.8), kit.ferrariAoMat);
    aoQuad.rotation.x = -Math.PI * 0.5;
    aoQuad.position.y = 0.015;
    root.add(aoQuad);

    return {
      root,
      wheels,
      bodyMat,
      spinWheels(dist: number) {
        const r = dist / 0.48;
        for (const w of wheels) w.rotation.y = r;
      },
      setStrobe() {},
    };
  }

  // Compiled & welded passenger / exotic / patrol chassis (uniform scaling keeps wheels round!)
  const tpl = getCompiledFerrariTemplate(assets);
  const scaleFactor = kind === "sedan" ? 0.96 : kind === "police" ? 1.04 : 1.0;
  const carGroup = new THREE.Group();
  carGroup.scale.setScalar(scaleFactor);
  root.add(carGroup);

  const paintHex =
    kind === "police"
      ? 0x0d121a
      : kind === "sedan"
        ? COMMUTER_PAINTS[variantIndex % COMMUTER_PAINTS.length]
        : EXOTIC_PAINTS[variantIndex % EXOTIC_PAINTS.length];
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: paintHex,
    metalness: kind === "police" ? 0.54 : 0.72,
    roughness: 0.14,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.6,
  });
  const policeTrimMat = new THREE.MeshPhysicalMaterial({
    color: kind === "police" ? 0xf1f5f9 : 0x1a1e26,
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
    carGroup.add(wp);
    wheels.push(wp);
  }

  const aoQuad = new THREE.Mesh(new THREE.PlaneGeometry(2.7 * scaleFactor, 5.15 * scaleFactor), kit.ferrariAoMat);
  aoQuad.rotation.x = -Math.PI * 0.5;
  aoQuad.position.y = 0.014;
  root.add(aoQuad);

  let redStrobeMat: THREE.MeshStandardMaterial | undefined;
  let blueStrobeMat: THREE.MeshStandardMaterial | undefined;

  if (kind === "police") {
    const roofY = tpl.size.y * scaleFactor;
    const barHousing = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.09, 0.26), kit.darkAlloyMat);
    barHousing.position.set(0, roofY + 0.03, -0.05);

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

    const lensL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.24), redStrobeMat);
    lensL.position.set(-0.3, roofY + 0.05, -0.05);
    const lensR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.24), blueStrobeMat);
    lensR.position.set(0.3, roofY + 0.05, -0.05);

    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.24, 1.32), policeTrimMat);
    doorPanel.position.set(0, 0.54, -0.1);

    root.add(barHousing, lensL, lensR, doorPanel);
  }

  return {
    root,
    wheels,
    bodyMat,
    redStrobeMat,
    blueStrobeMat,
    spinWheels(dist: number) {
      const ang = dist / 0.34;
      for (const w of wheels) w.rotation.x = ang;
    },
    setStrobe(time: number, active: boolean) {
      if (!redStrobeMat || !blueStrobeMat) return;
      const pulse = Math.sin(time * 22);
      redStrobeMat.emissiveIntensity = active ? (pulse > 0 ? 6.5 : 0.4) : 0.4;
      blueStrobeMat.emissiveIntensity = active ? (pulse < 0 ? 6.5 : 0.4) : 0.4;
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
    } else {
      addBox(1.0, 0.35, 1.0, 0.175);
      addBox(0.74, 0.45, 0.74, 0.575);
      addBox(0.45, 0.2, 0.45, 0.9);
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
    geometries: [mkTieredTower(0), mkTieredTower(1), mkTieredTower(2)],
  };
}

/**
 * Builds an instancing-ready coastal palm tree (curved ringed trunk + arched green pinnate fronds)
 * using merged BufferGeometries (2 draw calls per InstancedMesh cohort across the beach highway).
 */
export function createCoastalPalmTemplate(assets: LoadedAssets): PropTemplate {
  // Smooth continuous lofted curved palm trunk (no stepped cylinder ledges)
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
      uvArr.push(j / radialSegs, t * 4);
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

  const crownX = 1.18;
  const crownY = 9.05;
  const frondGeos: THREE.BufferGeometry[] = [];
  const frondCount = 10;
  for (let f = 0; f < frondCount; f++) {
    const az = (f / frondCount) * Math.PI * 2 + (f % 2) * 0.18;
    const pitch = f % 2 === 0 ? 0.18 : -0.14;
    const len = 3.2 + (f % 3) * 0.3;
    const segLen = len / 4;
    for (let s = 0; s < 4; s++) {
      const w = (1 - s * 0.18) * 0.72;
      const g = new THREE.BoxGeometry(w, 0.04, segLen * 1.06);
      const droop = s * s * 0.14 - s * (0.14 + pitch);
      g.rotateX(0.30 * s - pitch * 0.35);
      g.translate(0, -droop, (s + 0.5) * segLen);
      g.rotateY(az);
      g.translate(crownX, crownY, -0.04);
      frondGeos.push(g);
    }
  }

  const frondGeo = decimateAndMergeBucket(frondGeos, 0.04, true)!;
  for (const g of frondGeos) g.dispose();

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x6b5340,
    normalMap: assets.textures.concreteNor,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });
  const frondMat = new THREE.MeshStandardMaterial({
    color: 0x2f6d31,
    roughness: 0.68,
    metalness: 0.02,
    envMapIntensity: 0.65,
  });

  return {
    parts: [
      { geometry: trunkGeo, material: trunkMat },
      { geometry: frondGeo, material: frondMat },
    ],
  };
}
