import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { LoadedAssets } from "../assets/AssetLoader";
import { QualityPreset } from "../core/SaveState";
import { StageSpec } from "../data/stages";

const CinematicFinisherShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeedNorm: { value: 0 },
    uBulletTime: { value: 0 },
    uDamageFlash: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSpeedNorm;
    uniform float uBulletTime;
    uniform float uDamageFlash;
    varying vec2 vUv;

    void main() {
      vec2 offset = vUv - vec2(0.5);
      float dist = length(offset);
      vec2 dir = dist > 0.0001 ? offset / dist : vec2(0.0);

      float caAmt = (0.0005 + uSpeedNorm * 0.0032 + uBulletTime * 0.0028) * smoothstep(0.28, 0.76, dist);
      float r = texture2D(tDiffuse, vUv + dir * caAmt).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * caAmt).b;
      vec3 col = vec3(r, g, b);

      if (uBulletTime > 0.01) {
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 tinted = mix(col, vec3(luma * 0.7, luma * 1.15, luma * 1.42), 0.36 * uBulletTime);
        col = mix(tinted, col, smoothstep(0.65, 0.15, dist) * 0.3);
      }

      if (uDamageFlash > 0.01) {
        float edgeMask = smoothstep(0.28, 0.78, dist);
        col = mix(col, vec3(0.95, 0.12, 0.15), uDamageFlash * (0.22 + 0.42 * edgeMask));
      }

      float vig = smoothstep(0.95, 0.42, dist);
      col *= mix(0.74, 1.0, vig);
      if (!(col.r >= 0.0 && col.g >= 0.0 && col.b >= 0.0)) col = vec3(0.0);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class RenderPipeline {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly sunLight: THREE.DirectionalLight;
  public readonly ambientLight: THREE.HemisphereLight;
  public readonly rimLight: THREE.DirectionalLight;

  private assets: LoadedAssets | null = null;
  private composer: EffectComposer | null = null;
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private finisherPass: ShaderPass | null = null;
  private quality: QualityPreset = "ultra";
  private isSoftwareGl = false;
  private width = 1280;
  private height = 720;

  constructor(canvas: HTMLCanvasElement, initialQuality: QualityPreset) {
    this.quality = initialQuality;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const gl = this.renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const glRenderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || "");
    this.isSoftwareGl = /swiftshader|llvmpipe|softpipe/i.test(glRenderer);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b101b);
    this.scene.fog = new THREE.FogExp2(0x162030, 0.00095);

    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.2, 900);

    this.ambientLight = new THREE.HemisphereLight(0xcbe4ff, 0x1e2433, 0.9);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffe6cc, 2.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 120;
    const d = 18;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
    this.rimLight.position.set(-18, 12, -20);
    this.scene.add(this.rimLight);

    this.rebuildComposer();
  }

  public setAssets(assets: LoadedAssets): void {
    this.assets = assets;
  }

  public getMaxAnisotropy(): number {
    return Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
  }

  public getTargetDpr(): number {
    if (this.isSoftwareGl) return 1.0;
    const native = window.devicePixelRatio || 1;
    if (this.quality === "ultra") return Math.min(native * 1.25, 2.0);
    if (this.quality === "high") return Math.min(native, 1.5);
    return Math.min(native, 1.0);
  }

  public setQuality(preset: QualityPreset): void {
    if (this.quality === preset && this.composer) return;
    this.quality = preset;
    this.rebuildComposer();
    this.resize(this.width, this.height);
  }

  public getQuality(): QualityPreset {
    return this.quality;
  }

  private rebuildComposer(): void {
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
    this.composer = null;
    this.bloomPass = null;
    this.finisherPass = null;

    if (this.quality === "perf") {
      return;
    }

    const dpr = this.getTargetDpr();
    const w = Math.max(1, Math.floor(this.width * dpr));
    const h = Math.max(1, Math.floor(this.height * dpr));

    this.renderTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: this.isSoftwareGl ? 0 : 4,
    });
    this.composer = new EffectComposer(this.renderer, this.renderTarget);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(this.width, this.height);

    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // High threshold keeps daylight asphalt & metallic clearcoat razor crisp while blooming headlights/strobes
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      this.quality === "ultra" ? 0.30 : 0.24,
      0.40,
      1.18
    );
    this.composer.addPass(this.bloomPass);

    this.finisherPass = new ShaderPass(CinematicFinisherShader);
    this.composer.addPass(this.finisherPass);

    this.composer.addPass(new OutputPass());
  }

  public resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const dpr = this.getTargetDpr();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(this.width, this.height);
      if (this.bloomPass) {
        this.bloomPass.setSize(this.width, this.height);
      }
    }
  }

  public applyStageAtmosphere(stage: StageSpec): void {
    const hdrKey =
      stage.biome === "vice" ? "sunset" : stage.biome === "dubai" || stage.biome === "alpine" ? "sunrise" : "night";

    if (this.assets) {
      const hdr = this.assets.hdr[hdrKey];
      this.scene.background = hdr.equirect;
      this.scene.backgroundBlurriness = 0.025;
      this.scene.environment = hdr.pmrem;
      this.scene.environmentIntensity = stage.isNight ? 1.15 : 1.05;
    }

    const fogHex =
      stage.biome === "vice"
        ? 0x2a1f2d
        : stage.biome === "kowloon"
          ? 0x0b1726
          : stage.biome === "dubai"
            ? 0xa48066
            : stage.biome === "alpine"
              ? 0x7a99b5
              : 0x090b16;
    const fogDens = stage.biome === "dubai" ? 0.00075 : stage.biome === "vice" ? 0.00095 : 0.00105;

    this.scene.fog = new THREE.FogExp2(fogHex, fogDens);
    this.sunLight.color.setHex(stage.biome === "dubai" ? 0xffe4b5 : stage.isNight ? 0x9ec5ff : 0xffd5ad);
    this.sunLight.intensity = stage.biome === "vice" ? 1.25 : stage.isNight ? 1.45 : 2.6;
    this.ambientLight.color.setHex(stage.isNight ? 0x8fb8ff : 0xfce7cf);
    this.ambientLight.groundColor.setHex(stage.groundHex);
    this.ambientLight.intensity = stage.isNight ? 0.78 : 1.05;
    this.rimLight.color.setHex(stage.accentNeonHex);
    this.rimLight.intensity = stage.isNight ? 0.9 : 0.45;
    this.renderer.toneMappingExposure = stage.biome === "dubai" ? 0.92 : stage.biome === "vice" ? 0.95 : stage.isNight ? 1.04 : 1.0;
  }

  public applyHangarAtmosphere(): void {
    if (this.assets) {
      const hdr = this.assets.hdr.sunset;
      this.scene.background = hdr.equirect;
      this.scene.backgroundBlurriness = 0.045;
      this.scene.environment = hdr.pmrem;
      this.scene.environmentIntensity = 1.2;
    }
    this.scene.fog = new THREE.FogExp2(0x141924, 0.008);
    this.sunLight.color.setHex(0xffe6cc);
    this.sunLight.intensity = 2.1;
    this.sunLight.position.set(8, 12, 10);
    this.sunLight.target.position.set(0, 0.5, 0);
    this.sunLight.target.updateMatrixWorld();

    this.ambientLight.color.setHex(0xcbe4ff);
    this.ambientLight.groundColor.setHex(0x111827);
    this.ambientLight.intensity = 0.95;
    this.rimLight.color.setHex(0x38bdf8);
    this.rimLight.intensity = 1.1;
    this.renderer.toneMappingExposure = 1.02;
  }

  public updatePostFX(speedNorm: number, bulletTime: number, damageFlash: number): void {
    if (this.finisherPass) {
      this.finisherPass.uniforms.uSpeedNorm.value = speedNorm;
      this.finisherPass.uniforms.uBulletTime.value = bulletTime;
      this.finisherPass.uniforms.uDamageFlash.value = damageFlash;
    }
  }

  public syncFollowRig(focusX: number, focusY: number, focusZ: number): void {
    this.sunLight.position.set(focusX + 20, focusY + 34, focusZ + 14);
    this.sunLight.target.position.set(focusX, focusY, focusZ + 16);
    this.sunLight.target.updateMatrixWorld();
  }

  public render(): void {
    this.renderer.info.reset();
    if (this.composer && this.quality !== "perf") {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
