import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
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

      // Speed-scaled subtle radial chromatic aberration only near screen edges
      float caAmt = (0.0008 + uSpeedNorm * 0.0038 + uBulletTime * 0.003) * smoothstep(0.22, 0.72, dist);
      float r = texture2D(tDiffuse, vUv + dir * caAmt).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * caAmt).b;
      vec3 col = vec3(r, g, b);

      // Reflex Bullet-Time cool cyan edge tint
      if (uBulletTime > 0.01) {
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 tinted = mix(col, vec3(luma * 0.65, luma * 1.15, luma * 1.45), 0.42 * uBulletTime);
        col = mix(tinted, col, smoothstep(0.65, 0.15, dist) * 0.25);
      }

      // Impact red pulse on damage/wreck
      if (uDamageFlash > 0.01) {
        float edgeMask = smoothstep(0.25, 0.75, dist);
        col = mix(col, vec3(1.0, 0.12, 0.16), uDamageFlash * (0.28 + 0.45 * edgeMask));
      }

      // Clean Rockstar-style edge vignette (leaves road center clear)
      float vig = smoothstep(0.92, 0.38, dist);
      col *= mix(0.68, 1.0, vig);

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

  private composer: EffectComposer | null = null;
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private finisherPass: ShaderPass | null = null;
  private skyMesh: THREE.Mesh;
  private skyUniforms: {
    uTop: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uSunColor: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
  };
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
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const gl = this.renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const glRenderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || "");
    this.isSoftwareGl = /swiftshader|llvmpipe|softpipe/i.test(glRenderer);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x162040, 0.0017);

    // Bake IBL environment once for crisp clearcoat / metal / wet puddle reflections
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.62;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.25, 950);

    // 3-point exterior lighting stack
    this.ambientLight = new THREE.HemisphereLight(0x9ec5ff, 0x1a1e2e, 0.85);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffb58a, 1.85);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 140;
    const d = 28;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 0.9);
    this.rimLight.position.set(18, 14, -22);
    this.scene.add(this.rimLight);

    // Custom atmospheric gradient SkyDome + Sun Disc
    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x0b102b) },
      uHorizon: { value: new THREE.Color(0xf43f7d) },
      uSunColor: { value: new THREE.Color(0xff9966) },
      uSunDir: { value: new THREE.Vector3(0.25, 0.24, 0.94).normalize() },
    };
    this.skyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(520, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.skyUniforms,
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vDir;
          uniform vec3 uTop, uHorizon, uSunColor, uSunDir;
          void main() {
            vec3 dir = normalize(vDir);
            float h = clamp(dir.y * 1.15 + 0.08, 0.0, 1.0);
            vec3 col = mix(uHorizon, uTop, pow(h, 0.62));
            float sunDot = clamp(dot(dir, normalize(uSunDir)), 0.0, 1.0);
            col += uSunColor * (pow(sunDot, 520.0) * 1.45 + pow(sunDot, 10.0) * 0.34);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      })
    );
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);

    this.rebuildComposer();
  }

  public getMaxAnisotropy(): number {
    return Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
  }

  public getTargetDpr(): number {
    if (this.isSoftwareGl) return 1.0;
    const native = window.devicePixelRatio || 1;
    if (this.quality === "ultra") return Math.min(native * 1.35, 2.5);
    if (this.quality === "high") return Math.min(native, 2.0);
    return Math.min(native, 1.25);
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

    // MSAA HalfFloat target keeps 4K/HDR speculars crisp without losing antialiasing
    this.renderTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: this.isSoftwareGl ? 0 : 4,
    });
    this.composer = new EffectComposer(this.renderer, this.renderTarget);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(this.width, this.height);

    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      this.quality === "ultra" ? 0.26 : 0.22,
      0.22,
      1.08
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
    this.skyUniforms.uTop.value.setHex(stage.skyTopHex);
    this.skyUniforms.uHorizon.value.setHex(stage.skyHorizonHex);
    this.skyUniforms.uSunColor.value.setHex(stage.sunHex);
    this.skyUniforms.uSunDir.value
      .set(stage.isNight ? -0.35 : 0.28, stage.isNight ? 0.34 : 0.22, 0.88)
      .normalize();

    this.scene.fog = new THREE.FogExp2(stage.fogHex, stage.fogDensity);
    this.sunLight.color.setHex(stage.sunHex);
    this.sunLight.intensity = stage.sunIntensity;
    this.ambientLight.color.setHex(stage.ambientHex);
    this.ambientLight.groundColor.setHex(stage.groundHex);
    this.ambientLight.intensity = stage.ambientIntensity;
    this.rimLight.color.setHex(stage.accentNeonHex);
    this.renderer.toneMappingExposure = stage.isNight ? 0.96 : 0.92;
  }

  public applyHangarAtmosphere(): void {
    this.skyUniforms.uTop.value.setHex(0x050711);
    this.skyUniforms.uHorizon.value.setHex(0x18132b);
    this.skyUniforms.uSunColor.value.setHex(0x00f0ff);
    this.skyUniforms.uSunDir.value.set(-0.4, 0.35, 0.8).normalize();
    this.scene.fog = new THREE.FogExp2(0x070914, 0.025);
    this.sunLight.color.setHex(0xe2e8f0);
    this.sunLight.intensity = 1.65;
    this.ambientLight.color.setHex(0x94a3b8);
    this.ambientLight.groundColor.setHex(0x090d16);
    this.ambientLight.intensity = 0.85;
    this.rimLight.color.setHex(0x00f0ff);
    this.rimLight.intensity = 1.45;
    this.renderer.toneMappingExposure = 0.98;
  }

  public updatePostFX(speedNorm: number, bulletTime: number, damageFlash: number): void {
    if (this.finisherPass) {
      this.finisherPass.uniforms.uSpeedNorm.value = speedNorm;
      this.finisherPass.uniforms.uBulletTime.value = bulletTime;
      this.finisherPass.uniforms.uDamageFlash.value = damageFlash;
    }
  }

  public syncFollowRig(focusX: number, focusY: number, focusZ: number): void {
    this.skyMesh.position.set(focusX, focusY, focusZ);
    this.sunLight.position.set(focusX + 24, focusY + 42, focusZ + 18);
    this.sunLight.target.position.set(focusX, focusY, focusZ + 22);
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
