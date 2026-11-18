import * as THREE from "three";
import { LoadedAssets } from "./AssetLoader";

export interface FacadePbrMaps {
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

export interface MaterialKit {
  wetAsphaltUniforms: {
    uWetness: { value: number };
    uRoadHalfWidth: { value: number };
  };
  wetAsphaltMat: THREE.MeshStandardMaterial;
  concreteMat: THREE.MeshStandardMaterial;
  shoulderGroundMat: THREE.MeshStandardMaterial;
  beachSandMat: THREE.MeshStandardMaterial;
  oceanWaterMat: THREE.MeshPhysicalMaterial;
  darkAlloyMat: THREE.MeshStandardMaterial;
  skyscraperNightMat: THREE.MeshStandardMaterial;
  skyscraperDayMat: THREE.MeshStandardMaterial;
  highwaySignMat: THREE.MeshStandardMaterial;
  rampMat: THREE.MeshStandardMaterial;
  ferrariAoMat: THREE.MeshBasicMaterial;
  jetFlameTex: THREE.CanvasTexture;
  headlightPoolTex: THREE.CanvasTexture;
  fireballTex: THREE.CanvasTexture;
  makeNeonMaterial: (colorHex: number, emissiveIntensity?: number) => THREE.MeshStandardMaterial;
}

/**
 * Generates roughness, tangent normal, and selective window-glow maps from a building facade image
 * so glass windows mirror HDR skies cleanly while mullions & spandrels stay matte with physical depth.
 */
function buildFacadePbrMaps(imageTex: THREE.Texture, isNight: boolean, maxAniso: number): FacadePbrMaps {
  const img = imageTex.image as HTMLImageElement | HTMLCanvasElement | undefined;
  const size = 512;
  const rCanvas = document.createElement("canvas");
  const nCanvas = document.createElement("canvas");
  const eCanvas = document.createElement("canvas");
  rCanvas.width = nCanvas.width = eCanvas.width = size;
  rCanvas.height = nCanvas.height = eCanvas.height = size;

  const rCtx = rCanvas.getContext("2d")!;
  const nCtx = nCanvas.getContext("2d")!;
  const eCtx = eCanvas.getContext("2d")!;

  if (img) {
    rCtx.drawImage(img, 0, 0, size, size);
    const src = rCtx.getImageData(0, 0, size, size);
    const rData = rCtx.createImageData(size, size);
    const nData = nCtx.createImageData(size, size);
    const eData = eCtx.createImageData(size, size);

    const luma = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const p = i * 4;
      const r = src.data[p] / 255;
      const g = src.data[p + 1] / 255;
      const b = src.data[p + 2] / 255;
      luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    for (let y = 0; y < size; y++) {
      const ym = Math.max(0, y - 1);
      const yp = Math.min(size - 1, y + 1);
      for (let x = 0; x < size; x++) {
        const xm = Math.max(0, x - 1);
        const xp = Math.min(size - 1, x + 1);
        const idx = y * size + x;
        const p = idx * 4;
        const r = src.data[p];
        const g = src.data[p + 1];
        const b = src.data[p + 2];
        const l = luma[idx];

        const dx = (luma[y * size + xp] - luma[y * size + xm]) * 2.4;
        const dy = (luma[yp * size + x] - luma[ym * size + x]) * 2.4;
        const edge = Math.min(1, Math.hypot(dx, dy) * 2.2);
        const glassRough = isNight ? 0.14 : 0.10;
        const frameRough = 0.78;
        const roughByte = Math.round(
          Math.min(255, Math.max(20, (glassRough + edge * (frameRough - glassRough)) * 255))
        );

        rData.data[p] = roughByte;
        rData.data[p + 1] = roughByte;
        rData.data[p + 2] = roughByte;
        rData.data[p + 3] = 255;

        let nx = -dx;
        let ny = -dy;
        let nz = 0.45;
        const inv = 1 / Math.hypot(nx, ny, nz);
        nx *= inv;
        ny *= inv;
        nz *= inv;
        nData.data[p] = Math.round((nx * 0.5 + 0.5) * 255);
        nData.data[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        nData.data[p + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        nData.data[p + 3] = 255;

        const warmBias = (r - b) / 255;
        const winGlow = isNight ? Math.max(0, Math.min(1, (l - 0.34) * 1.9 + warmBias * 0.35)) : 0;
        eData.data[p] = Math.round(r * winGlow);
        eData.data[p + 1] = Math.round(g * winGlow * 0.94);
        eData.data[p + 2] = Math.round(b * winGlow * 0.85);
        eData.data[p + 3] = 255;
      }
    }

    rCtx.putImageData(rData, 0, 0);
    nCtx.putImageData(nData, 0, 0);
    eCtx.putImageData(eData, 0, 0);
  }

  const mkTex = (canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = maxAniso;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    roughnessMap: mkTex(rCanvas, false),
    normalMap: mkTex(nCanvas, false),
    emissiveMap: mkTex(eCanvas, true),
  };
}

/**
 * Teardrop exhaust afterburner sprite fading cleanly to alpha=0 on all 4 edges.
 */
function buildJetFlameTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    // v=0 at top (nozzle tip), v=1 at bottom tail
    const v = y / (size - 1);
    const widthProfile = Math.sin(Math.pow(v, 0.55) * Math.PI) * 0.42;
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1) - 0.5;
      const radial = Math.min(1, Math.abs(u) / Math.max(0.02, widthProfile));
      const axialFade = Math.sin(v * Math.PI) * Math.pow(1 - v, 0.45);
      const intensity = Math.max(0, (1 - radial * radial) * axialFade * 1.45);
      const core = Math.pow(Math.max(0, 1 - radial * 1.4), 2) * Math.max(0, 1 - v * 1.3);

      const p = (y * size + x) * 4;
      img.data[p] = Math.round(Math.min(255, (0.92 + core * 0.08) * 255));
      img.data[p + 1] = Math.round(Math.min(255, (0.58 + core * 0.40) * 255));
      img.data[p + 2] = Math.round(Math.min(255, (0.18 + core * 0.72) * 255));
      img.data[p + 3] = Math.round(Math.min(255, intensity * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Soft radial headlight road pool decal fading cleanly to zero at all edges.
 */
function buildHeadlightPoolTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size * 0.5, size * 0.58, 4, size * 0.5, size * 0.5, size * 0.48);
  g.addColorStop(0, "rgba(235, 246, 255, 0.95)");
  g.addColorStop(0.42, "rgba(186, 230, 253, 0.45)");
  g.addColorStop(0.85, "rgba(147, 197, 253, 0.08)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Combines flame noise texture with smooth radial alpha envelope so fireballs have zero square edges.
 */
function buildFireballTexture(flameTex: THREE.Texture): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const imgEl = flameTex.image as HTMLImageElement | HTMLCanvasElement | undefined;
  if (imgEl) {
    ctx.drawImage(imgEl, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      const ny = (y / (size - 1)) * 2 - 1;
      for (let x = 0; x < size; x++) {
        const nx = (x / (size - 1)) * 2 - 1;
        const r = Math.hypot(nx, ny);
        const alpha = Math.max(0, Math.pow(Math.max(0, 1 - r), 1.35));
        const p = (y * size + x) * 4;
        // Remap fiery orange/amber gradient from texture luminance
        const lum = Math.min(1, (d.data[p] * 0.45 + d.data[p + 1] * 0.45 + d.data[p + 2] * 0.1) / 255);
        d.data[p] = Math.round(Math.min(255, 255 * (0.75 + lum * 0.25)));
        d.data[p + 1] = Math.round(Math.min(255, 255 * (0.28 + lum * 0.58)));
        d.data[p + 2] = Math.round(Math.min(255, 255 * (0.04 + lum * 0.25)));
        d.data[p + 3] = Math.round(alpha * (0.55 + lum * 0.45) * 255);
      }
    }
    ctx.putImageData(d, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createMaterialKit(assets: LoadedAssets, maxAniso: number): MaterialKit {
  const { textures } = assets;

  for (const t of [textures.asphaltDiff, textures.asphaltNor, textures.asphaltRough]) {
    t.repeat.set(4, 4);
  }
  for (const t of [textures.concreteDiff, textures.concreteNor, textures.concreteRough]) {
    t.repeat.set(6, 4);
  }
  for (const t of [textures.sandDiff, textures.sandNor, textures.sandRough]) {
    t.repeat.set(8, 6);
  }

  // Crop vertical dark border around DOT highway signs
  textures.highwaySigns.wrapS = THREE.ClampToEdgeWrapping;
  textures.highwaySigns.wrapT = THREE.ClampToEdgeWrapping;
  textures.highwaySigns.offset.set(0.02, 0.22);
  textures.highwaySigns.repeat.set(0.96, 0.56);
  textures.highwaySigns.needsUpdate = true;

  const wetAsphaltUniforms = {
    uWetness: { value: 0.85 },
    uRoadHalfWidth: { value: 8.4 },
  };

  const wetAsphaltMat = new THREE.MeshStandardMaterial({
    map: textures.asphaltDiff,
    normalMap: textures.asphaltNor,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: textures.asphaltRough,
    roughness: 0.82,
    metalness: 0.04,
    envMapIntensity: 1.35,
  });

  wetAsphaltMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWetness = wetAsphaltUniforms.uWetness;
    shader.uniforms.uRoadHalfWidth = wetAsphaltUniforms.uRoadHalfWidth;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vRoadWorldPos;
        varying vec2 vRoadUv;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vRoadWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRoadUv = uv;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uWetness;
        uniform float uRoadHalfWidth;
        varying vec3 vRoadWorldPos;
        varying vec2 vRoadUv;

        float roadHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float roadNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(roadHash(i), roadHash(i + vec2(1.0, 0.0)), u.x),
            mix(roadHash(i + vec2(0.0, 1.0)), roadHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          float rutL = exp(-pow(abs(vRoadUv.x - 0.19) * 16.0, 2.0)) + exp(-pow(abs(vRoadUv.x - 0.39) * 16.0, 2.0));
          float rutR = exp(-pow(abs(vRoadUv.x - 0.61) * 16.0, 2.0)) + exp(-pow(abs(vRoadUv.x - 0.81) * 16.0, 2.0));
          diffuseColor.rgb *= mix(1.0, 0.78, clamp(rutL + rutR, 0.0, 1.0));

          float doubleYellow = smoothstep(0.0045, 0.001, abs(abs(vRoadUv.x - 0.5) - 0.011));
          float shoulderLines = smoothstep(0.006, 0.0015, min(abs(vRoadUv.x - 0.065), abs(vRoadUv.x - 0.935)));
          float dashMask = smoothstep(0.04, 0.14, abs(fract(vRoadWorldPos.z * 0.065) - 0.5));
          float laneLines = smoothstep(0.0045, 0.0012, min(abs(vRoadUv.x - 0.285), abs(vRoadUv.x - 0.715))) * dashMask;

          float grainWear = 0.82 + 0.18 * smoothstep(0.25, 0.7, roadNoise(vRoadWorldPos.xz * 2.5));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.63, 0.12), doubleYellow * 0.92 * grainWear);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.89, 0.91), (shoulderLines + laneLines) * 0.85 * grainWear);
        }`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        if (uWetness > 0.02) {
          float n1 = roadNoise(vRoadWorldPos.xz * vec2(0.16, 0.045));
          float n2 = roadNoise(vRoadWorldPos.xz * vec2(0.48, 0.14) + vec2(3.1, 7.4));
          float puddle = smoothstep(0.54 - uWetness * 0.28, 0.80 - uWetness * 0.18, n1 * 0.68 + n2 * 0.32);
          float damp = clamp(uWetness * 0.48 + puddle * 0.52 * uWetness, 0.0, 1.0);
          diffuseColor.rgb *= mix(1.0, 0.44, damp * 0.72);
          roughnessFactor = mix(roughnessFactor, 0.042, damp * 0.95);
        }`
      );
  };

  const concreteMat = new THREE.MeshStandardMaterial({
    map: textures.concreteDiff,
    normalMap: textures.concreteNor,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: textures.concreteRough,
    roughness: 0.88,
    metalness: 0.05,
    envMapIntensity: 0.75,
  });

  const shoulderGroundMat = new THREE.MeshStandardMaterial({
    color: 0x3b4048,
    map: textures.concreteDiff,
    normalMap: textures.concreteNor,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: textures.concreteRough,
    roughness: 0.92,
    metalness: 0.02,
    envMapIntensity: 0.5,
  });

  const beachSandMat = new THREE.MeshStandardMaterial({
    color: 0xf2dfc2,
    map: textures.sandDiff,
    normalMap: textures.sandNor,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughnessMap: textures.sandRough,
    roughness: 0.94,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });

  const oceanWaterMat = new THREE.MeshPhysicalMaterial({
    color: 0x055b84,
    normalMap: textures.sandNor,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughness: 0.24,
    metalness: 0.05,
    clearcoat: 0.45,
    clearcoatRoughness: 0.16,
    envMapIntensity: 0.85,
  });

  const darkAlloyMat = new THREE.MeshStandardMaterial({
    color: 0x222831,
    roughness: 0.42,
    metalness: 0.78,
    envMapIntensity: 1.0,
  });

  const nightMaps = buildFacadePbrMaps(textures.facadeNight, true, maxAniso);
  const skyscraperNightMat = new THREE.MeshStandardMaterial({
    map: textures.facadeNight,
    normalMap: nightMaps.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: nightMaps.roughnessMap,
    roughness: 0.85,
    metalness: 0.28,
    emissive: 0xffffff,
    emissiveMap: nightMaps.emissiveMap,
    emissiveIntensity: 1.35,
    envMapIntensity: 1.35,
  });

  const dayMaps = buildFacadePbrMaps(textures.facadeDay, false, maxAniso);
  const skyscraperDayMat = new THREE.MeshStandardMaterial({
    map: textures.facadeDay,
    normalMap: dayMaps.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: dayMaps.roughnessMap,
    roughness: 0.85,
    metalness: 0.35,
    envMapIntensity: 1.45,
  });

  const highwaySignMat = new THREE.MeshStandardMaterial({
    map: textures.highwaySigns,
    roughness: 0.36,
    metalness: 0.14,
    emissive: 0xffffff,
    emissiveMap: textures.highwaySigns,
    emissiveIntensity: 0.22,
    envMapIntensity: 0.9,
  });

  const rampMat = new THREE.MeshStandardMaterial({
    map: textures.concreteDiff,
    normalMap: textures.concreteNor,
    roughnessMap: textures.concreteRough,
    color: 0x6b7280,
    roughness: 0.78,
    metalness: 0.12,
  });

  // Clean pure-white outer border Multiply AO texture (eliminates faint square edges on sunlit concrete/sand)
  const aoCanvas = document.createElement("canvas");
  aoCanvas.width = aoCanvas.height = 128;
  const aoCtx = aoCanvas.getContext("2d")!;
  aoCtx.fillStyle = "#ffffff";
  aoCtx.fillRect(0, 0, 128, 128);
  const aoGrad = aoCtx.createRadialGradient(64, 64, 14, 64, 64, 58);
  aoGrad.addColorStop(0, "rgba(18, 20, 26, 0.72)");
  aoGrad.addColorStop(0.55, "rgba(32, 36, 44, 0.28)");
  aoGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
  aoCtx.fillStyle = aoGrad;
  aoCtx.fillRect(0, 0, 128, 128);
  const cleanAoTex = new THREE.CanvasTexture(aoCanvas);
  cleanAoTex.colorSpace = THREE.SRGBColorSpace;
  cleanAoTex.needsUpdate = true;

  // White background + MultiplyBlending produces soft grounded shadows with zero rectangular box edge
  const ferrariAoMat = new THREE.MeshBasicMaterial({
    map: cleanAoTex,
    color: 0xffffff,
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
    transparent: true,
    opacity: 0.88,
    toneMapped: false,
    depthWrite: false,
  });

  const jetFlameTex = buildJetFlameTexture();
  const headlightPoolTex = buildHeadlightPoolTexture();
  const fireballTex = buildFireballTexture(textures.flame);

  const makeNeonMaterial = (colorHex: number, emissiveIntensity = 1.6) =>
    new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity,
      roughness: 0.25,
      metalness: 0.1,
    });

  return {
    wetAsphaltUniforms,
    wetAsphaltMat,
    concreteMat,
    shoulderGroundMat,
    beachSandMat,
    oceanWaterMat,
    darkAlloyMat,
    skyscraperNightMat,
    skyscraperDayMat,
    highwaySignMat,
    rampMat,
    ferrariAoMat,
    jetFlameTex,
    headlightPoolTex,
    fireballTex,
    makeNeonMaterial,
  };
}
