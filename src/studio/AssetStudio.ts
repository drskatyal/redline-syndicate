import * as THREE from "three";
import { BIKES } from "../data/bikes";
import { loadAllGameAssets, LoadedAssets } from "../assets/AssetLoader";
import { createMaterialKit, MaterialKit } from "../assets/MaterialLibrary";
import {
  createArmoredRiderInstance,
  createCoastalPalmTemplate,
  createPursuitHelicopterInstance,
  createSkyscraperTemplates,
  createSuperbikeInstance,
  createTrafficVehicleInstance,
  extractPropTemplate,
  HelicopterVisual,
  SuperbikeVisual,
  TrafficVisual,
} from "../assets/RealisticModels";

declare global {
  interface Window {
    __ASSET_STUDIO__?: {
      ready: boolean;
      plateCount: number;
      showPlate: (idx: number, hdrKey?: "day" | "sunset" | "sunrise" | "night") => Promise<Record<string, unknown>>;
    };
  }
}

export async function startAssetStudio(canvas: HTMLCanvasElement): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 450);

  const label = document.createElement("div");
  label.style.cssText =
    "position:fixed;top:14px;left:14px;z-index:99;padding:10px 14px;background:rgba(8,11,20,0.86);color:#f8fafc;font:600 13px/1.4 monospace;border:1px solid #00f0ff;border-radius:6px;";
  label.textContent = "ASSET STUDIO // Loading HDR & PBR assets...";
  document.body.appendChild(label);

  const assets: LoadedAssets = await loadAllGameAssets(renderer, (pct, msg) => {
    label.textContent = `ASSET STUDIO // ${pct}% - ${msg}`;
  });
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const kit: MaterialKit = createMaterialKit(assets, maxAniso);

  const hemi = new THREE.HemisphereLight(0xcbe4ff, 0x1e2433, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1e0, 2.4);
  sun.position.set(16, 28, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const rim = new THREE.DirectionalLight(0x38bdf8, 0.95);
  rim.position.set(-14, 10, -18);
  scene.add(rim);

  // Scanned wet highway roadbed test slab (16.4m wide x 48m long)
  const slabGeo = new THREE.PlaneGeometry(16.4, 48, 1, 8);
  slabGeo.rotateX(-Math.PI * 0.5);
  const uvAttr = slabGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setY(i, uvAttr.getY(i) * 3.0);
  }
  kit.wetAsphaltUniforms.uWetness.value = 0.72;
  const slabMesh = new THREE.Mesh(slabGeo, kit.wetAsphaltMat);
  slabMesh.receiveShadow = true;
  scene.add(slabMesh);

  // Wide outer brushed concrete apron
  const apronGeo = new THREE.PlaneGeometry(180, 180);
  apronGeo.rotateX(-Math.PI * 0.5);
  const apronMesh = new THREE.Mesh(apronGeo, kit.shoulderGroundMat);
  apronMesh.position.y = -0.04;
  apronMesh.receiveShadow = true;
  scene.add(apronMesh);

  // Subtle +Z Forward direction indicator arrows painted beyond test subject
  const fwdArrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.1, 4),
    new THREE.MeshBasicMaterial({ color: 0x00f0ff })
  );
  fwdArrow.rotation.x = Math.PI * 0.5;
  fwdArrow.position.set(0, 0.03, 7.5);
  scene.add(fwdArrow);

  const stageGroup = new THREE.Group();
  scene.add(stageGroup);

  const clearStage = () => {
    while (stageGroup.children.length) stageGroup.remove(stageGroup.children[0]);
  };

  let activeUpdater: ((t: number) => void) | null = null;

  const setHdr = (key: "day" | "sunset" | "sunrise" | "night") => {
    const h = assets.hdr[key];
    scene.background = h.equirect;
    scene.backgroundBlurriness = 0.04;
    scene.environment = h.pmrem;
    scene.environmentIntensity = key === "night" ? 1.15 : 1.0;
    sun.intensity = key === "night" ? 1.65 : key === "day" ? 2.65 : key === "sunrise" ? 2.8 : 2.35;
    sun.color.setHex(key === "night" ? 0x93c5fd : key === "day" ? 0xfff5e4 : key === "sunrise" ? 0xffe4b5 : 0xffcfa3);
  };

  setHdr("day");

  const buildPlate = (idx: number, hdrKey?: "day" | "sunset" | "sunrise" | "night"): Record<string, unknown> => {
    clearStage();
    activeUpdater = null;
    if (hdrKey) setHdr(hdrKey);
    else setHdr(idx === 4 ? "night" : idx === 3 ? "day" : idx === 0 ? "day" : "sunset");

    const info: Record<string, unknown> = { plate: idx };

    if (idx === 0) {
      // Plate 0: Superbike + Human Street Rider (Front 3/4 + Rear Chase + Wheel Spin + Alloy Bat Strike)
      const leftBike: SuperbikeVisual = createSuperbikeInstance(assets, kit, BIKES[0], 0xe11d48, 0xf59e0b);
      const leftRider = createArmoredRiderInstance(assets, 0x161b26, 0x1f2937, "katana");
      leftBike.chassisPivot.add(leftRider.root);
      leftBike.root.position.set(-1.35, 0, 0);
      leftBike.root.rotation.y = 0.52;
      leftRider.updatePose(0.28, 0.85, 0, 0, "melee", 0.5);
      leftBike.setEffects(42, 0.035, true, false);
      stageGroup.add(leftBike.root);

      const rightBike: SuperbikeVisual = createSuperbikeInstance(assets, kit, BIKES[2], 0x0284c7, 0xf59e0b);
      const rightRider = createArmoredRiderInstance(assets, 0x7f1d1d, 0xf59e0b, "katana");
      rightBike.chassisPivot.add(rightRider.root);
      rightBike.root.position.set(1.35, 0, -0.4);
      rightBike.root.rotation.y = Math.PI + 0.35; // Rear 3/4 chase inspection!
      rightRider.updatePose(0.35, 0.9, 0.45, 1, "melee", 0.5);
      rightBike.setEffects(58, 0.035, true, true);
      stageGroup.add(rightBike.root);

      stageGroup.updateMatrixWorld(true);
      const bL = new THREE.Box3().setFromObject(leftBike.root);
      info.bikeBoundsY = [Number(bL.min.y.toFixed(3)), Number(bL.max.y.toFixed(3))];
      info.bikeLengthZ = Number(bL.getSize(new THREE.Vector3()).z.toFixed(3));
      camera.position.set(0.0, 1.55, 4.35);
      camera.lookAt(0.0, 0.84, -0.1);
      label.textContent = `PLATE 1: Superbike + Human Street Rider (Front 3/4 & Rear Chase + Bat Strike) | minY=${info.bikeBoundsY}`;
    } else if (idx === 1) {
      // Plate 1: Police Ferrari Interceptor + Exotic Supercars
      const cop: TrafficVisual = createTrafficVehicleInstance(assets, kit, "police", 0);
      cop.root.position.set(-2.7, 0, 0.6);
      cop.root.rotation.y = 0.36;
      cop.spinWheels(2.0);
      cop.setStrobe(0.12, true);

      const ferrariRed = createTrafficVehicleInstance(assets, kit, "exotic", 0);
      ferrariRed.root.position.set(0.0, 0, -0.4);
      ferrariRed.root.rotation.y = Math.PI - 0.32; // Rear 3/4 taillight view!

      const ferrariSilver = createTrafficVehicleInstance(assets, kit, "exotic", 2);
      ferrariSilver.root.position.set(2.8, 0, 0.5);
      ferrariSilver.root.rotation.y = -0.34;

      stageGroup.add(cop.root, ferrariRed.root, ferrariSilver.root);
      stageGroup.updateMatrixWorld(true);
      const bc = new THREE.Box3().setFromObject(cop.root);
      info.copMinY = Number(bc.min.y.toFixed(3));
      info.copSize = bc.getSize(new THREE.Vector3()).toArray().map((n) => Number(n.toFixed(2)));
      camera.position.set(0.0, 2.15, 7.6);
      camera.lookAt(0.0, 0.65, 0.1);
      label.textContent = `PLATE 2: Apex Police Interceptor + Exotic Supercars (+Z Forward) | minY=${info.copMinY}`;
    } else if (idx === 2) {
      // Plate 2: Commercial Freight Transport + Bell Huey Helicopter
      const truck = createTrafficVehicleInstance(assets, kit, "truck", 0);
      truck.root.position.set(-2.6, 0, 0);
      truck.root.rotation.y = 0.55;

      const heli: HelicopterVisual = createPursuitHelicopterInstance(assets);
      heli.root.position.set(3.2, 2.2, -1.2);
      heli.root.rotation.y = -0.45;
      activeUpdater = (t) => heli.update(0.016, t, 0);

      stageGroup.add(truck.root, heli.root);
      stageGroup.updateMatrixWorld(true);
      const bt = new THREE.Box3().setFromObject(truck.root);
      info.truckMinY = Number(bt.min.y.toFixed(3));
      camera.position.set(0.2, 3.6, 12.8);
      camera.lookAt(0.4, 1.8, -0.4);
      label.textContent = `PLATE 3: Brushed-Metal Freight Truck + Bell Huey Helicopter`;
    } else if (idx === 3) {
      // Plate 3: Poly Haven Scanned Barriers, Street Lamps, Trees, Shrubs, Boulders + DOT Sign Gantry
      const barrierTpl = extractPropTemplate(assets.models.roadBarrier, 0.95, true);
      const lampTpl = extractPropTemplate(assets.models.streetLamp, 6.8, false);
      const treeTpl = extractPropTemplate(assets.models.tree, 6.4, false);
      const palmTpl = createCoastalPalmTemplate(assets);
      const shrubTpl = extractPropTemplate(assets.models.shrub, 1.4, false);
      const boulderTpl = extractPropTemplate(assets.models.boulder, 2.2, false);

      const addTpl = (parts: typeof barrierTpl.parts, x: number, y: number, z: number, ry = 0) => {
        const g = new THREE.Group();
        for (const p of parts) {
          const m = new THREE.Mesh(p.geometry, p.material);
          m.castShadow = true;
          m.receiveShadow = true;
          g.add(m);
        }
        g.position.set(x, y, z);
        g.rotation.y = ry;
        stageGroup.add(g);
      };

      addTpl(barrierTpl.parts, -5.2, 0, 0, 0);
      addTpl(barrierTpl.parts, -5.2, 0, 3.1, 0);
      addTpl(lampTpl.parts, -3.2, 0, -1.5, Math.PI * 0.5);
      addTpl(palmTpl.parts, 2.6, 0, -1.2, 0.2);
      addTpl(treeTpl.parts, -0.4, 0, -2.5, 0.4);
      addTpl(shrubTpl.parts, 0.8, 0, 1.6, 0);
      addTpl(boulderTpl.parts, 4.8, 0, -2.5, 0.8);

      // Steel truss overhead highway sign gantry using generated DOT signs on the camera-facing side
      const signGantry = new THREE.Group();
      const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 5.2, 10), kit.darkAlloyMat);
      postL.position.set(-4.8, 2.6, 4.2);
      const postR = postL.clone();
      postR.position.set(4.8, 2.6, 4.2);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.34, 0.34), kit.darkAlloyMat);
      beam.position.set(0, 4.7, 4.15);
      const signBoard = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.0, 0.14), kit.highwaySignMat);
      signBoard.position.set(0, 4.7, 4.46);
      signGantry.add(postL, postR, beam, signBoard);
      stageGroup.add(signGantry);

      camera.position.set(0.0, 2.8, 12.6);
      camera.lookAt(0.0, 2.6, 1.0);
      label.textContent = `PLATE 4: Poly Haven Scanned Barriers, Lamps, Flora, Cliffs + DOT Sign Gantry`;
    } else {
      // Plate 4: Multi-Tier Glass Curtain-Wall Skyscrapers with HDR Reflections
      const skyTpls = createSkyscraperTemplates();
      const placements = [
        { x: -13, z: -8, w: 12, h: 38, mat: kit.skyscraperNightMat, v: 0 },
        { x: 12, z: -12, w: 14, h: 48, mat: kit.skyscraperNightMat, v: 1 },
        { x: -15, z: 12, w: 11, h: 30, mat: kit.skyscraperDayMat, v: 2 },
        { x: 14, z: 10, w: 12, h: 34, mat: kit.skyscraperDayMat, v: 0 },
      ];
      for (const p of placements) {
        const mesh = new THREE.Mesh(skyTpls.geometries[p.v], p.mat);
        mesh.scale.set(p.w, p.h, p.w);
        mesh.position.set(p.x, 0, p.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        stageGroup.add(mesh);
      }
      camera.position.set(0.0, 4.5, 28.0);
      camera.lookAt(0.0, 12.0, -4.0);
      label.textContent = `PLATE 5: Stepped Glass Curtain-Wall Skyscrapers + Wet Asphalt HDR Reflections`;
    }

    renderer.info.reset();
    renderer.render(scene, camera);
    info.calls = renderer.info.render.calls;
    info.triangles = renderer.info.render.triangles;
    return info;
  };

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // Expose interactive control for verify_assets.mjs + manual browsing (keys 1-5)
  buildPlate(0, "sunset");
  window.__ASSET_STUDIO__ = {
    ready: true,
    plateCount: 5,
    showPlate: async (idx: number, hdrKey?: "day" | "sunset" | "sunrise" | "night") => {
      const res = buildPlate(idx, hdrKey);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return res;
    },
  };

  window.addEventListener("keydown", (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= 5) buildPlate(n - 1);
  });

  const t0 = performance.now();
  const loop = (now: number) => {
    const t = (now - t0) / 1000;
    if (activeUpdater) activeUpdater(t);
    renderer.info.reset();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
