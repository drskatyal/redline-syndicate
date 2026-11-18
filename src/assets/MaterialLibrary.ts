import * as THREE from "three";
import {
  createChevronRampTexture,
  createContactShadowTexture,
  createGlowSpriteTexture,
  createHighwayTextures,
  createSkyscraperTexture,
  HighwayTextureSet,
} from "./ProceduralTextures";

export interface MaterialKit {
  highwayTextures: HighwayTextureSet;
  wetAsphaltMat: THREE.MeshStandardMaterial;
  wetAsphaltUniforms: {
    uWetness: { value: number };
    uTime: { value: number };
    uAccent: { value: THREE.Color };
  };
  shoulderGroundMat: THREE.MeshStandardMaterial;
  chromeMat: THREE.MeshStandardMaterial;
  darkAlloyMat: THREE.MeshStandardMaterial;
  carbonMat: THREE.MeshPhysicalMaterial;
  tireRubberMat: THREE.MeshStandardMaterial;
  glassTintedMat: THREE.MeshPhysicalMaterial;
  tailLightMat: THREE.MeshStandardMaterial;
  headLightMat: THREE.MeshStandardMaterial;
  policeRedMat: THREE.MeshStandardMaterial;
  policeBlueMat: THREE.MeshStandardMaterial;
  skyscraperMat: THREE.MeshStandardMaterial;
  barrierMetalMat: THREE.MeshStandardMaterial;
  rampMat: THREE.MeshStandardMaterial;
  rampUniforms: { uTime: { value: number }; uColor: { value: THREE.Color } };
  empWaveMat: THREE.MeshBasicMaterial;
  contactShadowMat: THREE.MeshBasicMaterial;
  glowSpriteTex: THREE.CanvasTexture;
  makePaintMaterial: (hex: number, emissiveBoost?: number) => THREE.MeshPhysicalMaterial;
  makeNeonMaterial: (hex: number, intensity?: number) => THREE.MeshStandardMaterial;
}

export function createMaterialKit(anisotropy: number): MaterialKit {
  const highwayTextures = createHighwayTextures(anisotropy);
  const skyTex = createSkyscraperTexture(anisotropy);
  const contactTex = createContactShadowTexture();
  const glowSpriteTex = createGlowSpriteTexture();
  const rampTex = createChevronRampTexture();

  const wetAsphaltUniforms = {
    uWetness: { value: 0.85 },
    uTime: { value: 0 },
    uAccent: { value: new THREE.Color(0x00f0ff) },
  };

  const wetAsphaltMat = new THREE.MeshStandardMaterial({
    map: highwayTextures.albedoMap,
    roughnessMap: highwayTextures.roughnessMap,
    bumpMap: highwayTextures.bumpMap,
    bumpScale: 0.045,
    roughness: 0.88,
    metalness: 0.08,
    envMapIntensity: 0.85,
  });

  wetAsphaltMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWetness = wetAsphaltUniforms.uWetness;
    shader.uniforms.uTime = wetAsphaltUniforms.uTime;
    shader.uniforms.uAccent = wetAsphaltUniforms.uAccent;
    shader.uniforms.uPuddleMask = { value: highwayTextures.puddleMaskMap };

    shader.vertexShader =
      "varying vec2 vRoadUv;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n vRoadUv = uv * vec2(1.0, 24.0);"
      );

    shader.fragmentShader =
      "uniform float uWetness;\nuniform float uTime;\nuniform vec3 uAccent;\nuniform sampler2D uPuddleMask;\nvarying vec2 vRoadUv;\n" +
      shader.fragmentShader
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
           float puddleSample = texture2D(uPuddleMask, vRoadUv).r;
           float wetMask = smoothstep(0.32, 0.78, puddleSample) * clamp(uWetness, 0.0, 1.0);
           diffuseColor.rgb *= mix(1.0, 0.42, wetMask);
          `
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>
           float puddleR = texture2D(uPuddleMask, vRoadUv).r;
           float wetMaskR = smoothstep(0.32, 0.78, puddleR) * clamp(uWetness, 0.0, 1.0);
           roughnessFactor = mix(roughnessFactor, 0.19, wetMaskR);
           roughnessFactor = saturate(roughnessFactor);
          `
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
           float centerStud = step(0.495, vRoadUv.x) * step(vRoadUv.x, 0.505) * step(0.88, fract(vRoadUv.y * 0.5));
           float puddleTint = smoothstep(0.45, 0.85, texture2D(uPuddleMask, vRoadUv).r) * clamp(uWetness, 0.0, 1.0);
           totalEmissiveRadiance += uAccent * (centerStud * 0.95 + puddleTint * 0.07);
          `
        );
  };
  wetAsphaltMat.customProgramCacheKey = () => "redline-wet-highway-v1";

  const shoulderGroundMat = new THREE.MeshStandardMaterial({
    color: 0x1e2230,
    roughness: 0.92,
    metalness: 0.04,
    envMapIntensity: 0.35,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd9e2ec,
    metalness: 0.96,
    roughness: 0.16,
    envMapIntensity: 1.5,
  });

  const darkAlloyMat = new THREE.MeshStandardMaterial({
    color: 0x2a3140,
    metalness: 0.85,
    roughness: 0.36,
    envMapIntensity: 1.15,
  });

  const carbonMat = new THREE.MeshPhysicalMaterial({
    color: 0x151822,
    metalness: 0.15,
    roughness: 0.42,
    clearcoat: 0.7,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1.0,
  });

  const tireRubberMat = new THREE.MeshStandardMaterial({
    color: 0x0b0c10,
    metalness: 0.0,
    roughness: 0.9,
    envMapIntensity: 0.35,
  });

  const glassTintedMat = new THREE.MeshPhysicalMaterial({
    color: 0x8be0ff,
    metalness: 0.05,
    roughness: 0.08,
    transparent: true,
    opacity: 0.36,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.8,
  });

  const tailLightMat = new THREE.MeshStandardMaterial({
    color: 0x200404,
    emissive: 0xff1e38,
    emissiveIntensity: 3.4,
    roughness: 0.2,
  });

  const headLightMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0xdcf4ff,
    emissiveIntensity: 3.8,
    roughness: 0.15,
  });

  const policeRedMat = new THREE.MeshStandardMaterial({
    color: 0x220408,
    emissive: 0xff1e42,
    emissiveIntensity: 4.5,
    roughness: 0.2,
  });

  const policeBlueMat = new THREE.MeshStandardMaterial({
    color: 0x041226,
    emissive: 0x00a6ff,
    emissiveIntensity: 4.5,
    roughness: 0.2,
  });

  const skyscraperMat = new THREE.MeshStandardMaterial({
    color: 0x0d1220,
    map: skyTex,
    emissive: 0xffffff,
    emissiveMap: skyTex,
    emissiveIntensity: 1.35,
    roughness: 0.22,
    metalness: 0.72,
    envMapIntensity: 1.35,
  });

  const barrierMetalMat = new THREE.MeshStandardMaterial({
    color: 0x7b8698,
    metalness: 0.72,
    roughness: 0.38,
    envMapIntensity: 1.0,
  });

  const rampUniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x00f0ff) },
  };
  const rampMat = new THREE.MeshStandardMaterial({
    map: rampTex,
    emissiveMap: rampTex,
    emissive: 0xffffff,
    emissiveIntensity: 1.8,
    roughness: 0.25,
    metalness: 0.5,
  });
  rampMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = rampUniforms.uTime;
    shader.uniforms.uColor = rampUniforms.uColor;
    shader.vertexShader =
      "varying vec2 vRampUv;\n" +
      shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vRampUv = uv;");
    shader.fragmentShader =
      "uniform float uTime;\nuniform vec3 uColor;\nvarying vec2 vRampUv;\n" +
      shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         float wave = smoothstep(0.42, 0.5, fract(vRampUv.y * 3.0 - uTime * 2.2)) * smoothstep(0.58, 0.5, fract(vRampUv.y * 3.0 - uTime * 2.2));
         totalEmissiveRadiance += uColor * wave * 2.8;
        `
      );
  };
  rampMat.customProgramCacheKey = () => "redline-ramp-scroll-v1";

  const empWaveMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: contactTex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  const makePaintMaterial = (hex: number, emissiveBoost = 0) =>
    new THREE.MeshPhysicalMaterial({
      color: hex,
      metalness: 0.32,
      roughness: 0.24,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      emissive: emissiveBoost > 0 ? hex : 0x000000,
      emissiveIntensity: emissiveBoost,
      envMapIntensity: 1.45,
    });

  const makeNeonMaterial = (hex: number, intensity = 3.2) =>
    new THREE.MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity: intensity,
      roughness: 0.2,
    });

  return {
    highwayTextures,
    wetAsphaltMat,
    wetAsphaltUniforms,
    shoulderGroundMat,
    chromeMat,
    darkAlloyMat,
    carbonMat,
    tireRubberMat,
    glassTintedMat,
    tailLightMat,
    headLightMat,
    policeRedMat,
    policeBlueMat,
    skyscraperMat,
    barrierMetalMat,
    rampMat,
    rampUniforms,
    empWaveMat,
    contactShadowMat,
    glowSpriteTex,
    makePaintMaterial,
    makeNeonMaterial,
  };
}
