import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export interface HdrEnvironmentPack {
  day: { equirect: THREE.DataTexture; pmrem: THREE.Texture };
  sunset: { equirect: THREE.DataTexture; pmrem: THREE.Texture };
  sunrise: { equirect: THREE.DataTexture; pmrem: THREE.Texture };
  night: { equirect: THREE.DataTexture; pmrem: THREE.Texture };
}

export interface LoadedAssets {
  hdr: HdrEnvironmentPack;
  models: {
    heroBike: GLTF;
    humanRider: GLTF;
    ferrari: GLTF;
    teslaSedan: GLTF;
    bmwCoupe: GLTF;
    milkTruck: GLTF;
    helicopter: GLTF;
    roadBarrier: GLTF;
    streetLamp: GLTF;
    tree: GLTF;
    shrub: GLTF;
    boulder: GLTF;
  };
  textures: {
    asphaltDiff: THREE.Texture;
    asphaltNor: THREE.Texture;
    asphaltRough: THREE.Texture;
    concreteDiff: THREE.Texture;
    concreteNor: THREE.Texture;
    concreteRough: THREE.Texture;
    sandDiff: THREE.Texture;
    sandNor: THREE.Texture;
    sandRough: THREE.Texture;
    palmBarkDiff: THREE.Texture;
    palmLeafDiff: THREE.Texture;
    facadeNight: THREE.Texture;
    facadeDay: THREE.Texture;
    facadeCoastal: THREE.Texture;
    facadeBrick: THREE.Texture;
    facadeConcrete: THREE.Texture;
    highwaySigns: THREE.Texture;
    flame: THREE.Texture;
    smoke: THREE.Texture;
    ferrariAo: THREE.Texture;
  };
}

let cachedPromise: Promise<LoadedAssets> | null = null;

export function loadAllGameAssets(
  renderer: THREE.WebGLRenderer,
  onProgress?: (pct: number, label: string) => void
): Promise<LoadedAssets> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = internalLoadAll(renderer, onProgress);
  return cachedPromise;
}

async function internalLoadAll(
  renderer: THREE.WebGLRenderer,
  onProgress?: (pct: number, label: string) => void
): Promise<LoadedAssets> {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("./draco/");
  dracoLoader.preload();
  gltfLoader.setDRACOLoader(dracoLoader);
  await MeshoptDecoder.ready;
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);

  const rgbeLoader = new RGBELoader();
  const texLoader = new THREE.TextureLoader();

  const totalItems = 36;
  let completed = 0;
  const tick = (label: string) => {
    completed++;
    if (onProgress) {
      onProgress(Math.min(99, Math.round((completed / totalItems) * 100)), label);
    }
  };

  const loadGltf = (url: string, label: string): Promise<GLTF> =>
    gltfLoader.loadAsync(url).then((g) => {
      tick(label);
      return g;
    });

  const loadHdr = (url: string, label: string): Promise<THREE.DataTexture> =>
    rgbeLoader.loadAsync(url).then((tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tick(label);
      return tex;
    });

  const loadTex = (
    url: string,
    label: string,
    opts: { srgb?: boolean; repeat?: boolean; aniso?: boolean } = {}
  ): Promise<THREE.Texture> =>
    texLoader.loadAsync(url).then((tex) => {
      tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (opts.repeat) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
      }
      if (opts.aniso) {
        tex.anisotropy = maxAniso;
      }
      tex.needsUpdate = true;
      tick(label);
      return tex;
    });

  if (onProgress) onProgress(3, "STREAMING HDR SKIES & PBR ASSETS...");

  const [
    hdrDay,
    hdrSunset,
    hdrSunrise,
    hdrNight,
    heroBike,
    humanRider,
    ferrari,
    teslaSedan,
    bmwCoupe,
    milkTruck,
    helicopter,
    roadBarrier,
    streetLamp,
    tree,
    shrub,
    boulder,
    asphaltDiff,
    asphaltNor,
    asphaltRough,
    concreteDiff,
    concreteNor,
    concreteRough,
    sandDiff,
    sandNor,
    sandRough,
    palmBarkDiff,
    palmLeafDiff,
    facadeNight,
    facadeDay,
    facadeCoastal,
    facadeBrick,
    facadeConcrete,
    highwaySigns,
    flame,
    smoke,
    ferrariAo,
  ] = await Promise.all([
    loadHdr("./hdr/day.hdr", "HDR Coastal Daylight Sky"),
    loadHdr("./hdr/sunset.hdr", "HDR Sunset Skybox"),
    loadHdr("./hdr/sunrise.hdr", "HDR Mountain Morning"),
    loadHdr("./hdr/night.hdr", "HDR Midnight Skybox"),
    loadGltf("./models/hero-motorcycle.glb", "Brembo Superbike 3D"),
    loadGltf("./models/human-rider.glb", "Armored Street Rider"),
    loadGltf("./models/ferrari.glb", "Exotic Supercar Traffic"),
    loadGltf("./models/tesla-sedan.glb", "Tesla Model 3 Traffic"),
    loadGltf("./models/bmw-coupe.glb", "BMW M3 E30 Traffic"),
    loadGltf("./models/milk-truck.glb", "Commercial Transport Truck"),
    loadGltf("./models/helicopter.glb", "Police Pursuit Helicopter"),
    loadGltf("./models/road_barrier/concrete_road_barrier_1k.gltf", "Jersey Barriers"),
    loadGltf("./models/street_lamp/street_lamp_01_1k.gltf", "Highway Luminaires"),
    loadGltf("./models/tree/quiver_tree_02_1k.gltf", "Roadside Flora"),
    loadGltf("./models/shrub/shrub_03_1k.gltf", "Roadside Foliage"),
    loadGltf("./models/boulder/boulder_01_1k.gltf", "Coastal Cliffs"),
    loadTex("./pbr/asphalt_diff.jpg", "Asphalt Albedo", { srgb: true, repeat: true, aniso: true }),
    loadTex("./pbr/asphalt_nor.jpg", "Asphalt Normal", { srgb: false, repeat: true, aniso: true }),
    loadTex("./pbr/asphalt_rough.jpg", "Asphalt Roughness", { srgb: false, repeat: true, aniso: true }),
    loadTex("./pbr/concrete_diff.jpg", "Concrete Albedo", { srgb: true, repeat: true, aniso: true }),
    loadTex("./pbr/concrete_nor.jpg", "Concrete Normal", { srgb: false, repeat: true, aniso: true }),
    loadTex("./pbr/concrete_rough.jpg", "Concrete Roughness", { srgb: false, repeat: true, aniso: true }),
    loadTex("./pbr/sand_diff.jpg", "Beach Sand Albedo", { srgb: true, repeat: true, aniso: true }),
    loadTex("./pbr/sand_nor.jpg", "Beach Sand Normal", { srgb: false, repeat: true, aniso: true }),
    loadTex("./pbr/sand_rough.jpg", "Beach Sand Roughness", { srgb: false, repeat: true, aniso: true }),
    loadTex("./pbr/palm_bark_diff.jpg", "Palm Bark Texture", { srgb: true, repeat: true, aniso: true }),
    loadTex("./pbr/palm_leaf_diff.jpg", "Palm Frond Foliage", { srgb: true, repeat: false, aniso: true }),
    loadTex("./pbr/facade_glass_night.jpg", "City Tower Night Facade", { srgb: true, repeat: true, aniso: true }),
    loadTex("./pbr/facade_tower_day.jpg", "City Tower Day Facade", { srgb: true, repeat: true, aniso: true }),
    loadTex("./pbr/facade_coastal_hotel.jpg", "Coastal Hotel Facade", { srgb: true, repeat: true, aniso: true }),
    loadTex("./pbr/facade_brick_commercial.jpg", "Urban Brick Loft Facade", { srgb: true, repeat: true, aniso: true }),
    loadTex("./pbr/facade_modern_concrete.jpg", "Architectural Concrete Facade", { srgb: true, repeat: true, aniso: true }),
    loadTex("./pbr/highway_signs.jpg", "DOT Highway Signage", { srgb: true, aniso: true }),
    loadTex("./fx/flame.png", "Combustion FX", { srgb: true }),
    loadTex("./fx/smoke.png", "Tire Smoke FX", { srgb: true }),
    loadTex("./models/ferrari_ao.png", "Contact AO", { srgb: true }),
  ]);

  if (onProgress) onProgress(99, "BAKING HDR ENVIRONMENT REFLECTIONS...");

  // Upgrade anisotropic filtering inside glTF materials
  for (const gltf of [
    heroBike,
    humanRider,
    ferrari,
    teslaSedan,
    bmwCoupe,
    milkTruck,
    helicopter,
    roadBarrier,
    streetLamp,
    tree,
    shrub,
    boulder,
  ]) {
    gltf.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!mat) continue;
        const std = mat as THREE.MeshStandardMaterial;
        if (std.map) std.map.anisotropy = maxAniso;
        if (std.normalMap) std.normalMap.anisotropy = maxAniso;
        if (std.roughnessMap) std.roughnessMap.anisotropy = maxAniso;
      }
    });
  }

  // Bake HDR PMREM reflection maps once per sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const dayPmrem = pmrem.fromEquirectangular(hdrDay).texture;
  const sunsetPmrem = pmrem.fromEquirectangular(hdrSunset).texture;
  const sunrisePmrem = pmrem.fromEquirectangular(hdrSunrise).texture;
  const nightPmrem = pmrem.fromEquirectangular(hdrNight).texture;
  pmrem.dispose();

  if (onProgress) onProgress(100, "READY");

  return {
    hdr: {
      day: { equirect: hdrDay, pmrem: dayPmrem },
      sunset: { equirect: hdrSunset, pmrem: sunsetPmrem },
      sunrise: { equirect: hdrSunrise, pmrem: sunrisePmrem },
      night: { equirect: hdrNight, pmrem: nightPmrem },
    },
    models: {
      heroBike,
      humanRider,
      ferrari,
      teslaSedan,
      bmwCoupe,
      milkTruck,
      helicopter,
      roadBarrier,
      streetLamp,
      tree,
      shrub,
      boulder,
    },
    textures: {
      asphaltDiff,
      asphaltNor,
      asphaltRough,
      concreteDiff,
      concreteNor,
      concreteRough,
      sandDiff,
      sandNor,
      sandRough,
      palmBarkDiff,
      palmLeafDiff,
      facadeNight,
      facadeDay,
      facadeCoastal,
      facadeBrick,
      facadeConcrete,
      highwaySigns,
      flame,
      smoke,
      ferrariAo,
    },
  };
}
