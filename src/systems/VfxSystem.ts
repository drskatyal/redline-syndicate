import * as THREE from "three";
import { MaterialKit } from "../assets/MaterialLibrary";

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
}

const MAX_PARTICLES = 300;
const RAIN_COUNT = 220;

export class VfxSystem {
  public readonly group = new THREE.Group();
  private sparkInst: THREE.InstancedMesh;
  private rainInst: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private cursor = 0;

  private empMesh: THREE.Mesh;
  private empTimer = 0;

  private rainOffsets: Float32Array;
  private dummy = new THREE.Object3D();

  constructor(kit: MaterialKit) {
    const sparkGeo = new THREE.BoxGeometry(0.11, 0.11, 0.34);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_PARTICLES);
    this.sparkInst.count = 0;
    this.sparkInst.frustumCulled = false;
    this.group.add(this.sparkInst);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        scale: 1,
        color: new THREE.Color(0xffaa00),
      });
    }

    // Razor-thin Rain / Hyper-speed needles
    const rainGeo = new THREE.BoxGeometry(0.012, 0.012, 2.8);
    const rainMat = new THREE.MeshBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.rainInst = new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT);
    this.rainInst.count = 0;
    this.rainInst.visible = false;
    this.rainInst.frustumCulled = false;
    this.group.add(this.rainInst);

    this.rainOffsets = new Float32Array(RAIN_COUNT * 3);
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainOffsets[i * 3] = (Math.random() - 0.5) * 32;
      this.rainOffsets[i * 3 + 1] = Math.random() * 14 + 0.4;
      this.rainOffsets[i * 3 + 2] = Math.random() * 65 - 10;
    }

    this.empMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), kit.empWaveMat);
    this.empMesh.visible = false;
    this.group.add(this.empMesh);
  }

  public spawnBurst(x: number, y: number, z: number, colorHex: number, count = 18, speed = 10, scale = 1): void {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = (Math.random() - 0.5) * speed * 1.6;
      p.vy = Math.random() * speed * 0.9 + 1.5;
      p.vz = (Math.random() - 0.5) * speed * 1.2;
      p.maxLife = 0.25 + Math.random() * 0.45;
      p.life = p.maxLife;
      p.scale = scale * (0.7 + Math.random() * 0.8);
      p.color.setHex(colorHex);
    }
  }

  public triggerEmp(x: number, y: number, z: number): void {
    this.empMesh.position.set(x, y + 0.8, z);
    this.empMesh.scale.setScalar(0.5);
    this.empMesh.visible = true;
    this.empTimer = 0.65;
    this.spawnBurst(x, y + 0.8, z, 0x00f0ff, 36, 18, 1.5);
  }

  public update(dt: number, camX: number, camY: number, camZ: number, speedMps: number, hasRain: boolean): void {
    let activeCount = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy -= 18 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.life / p.maxLife;

      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.vy * 0.08, p.vx * 0.08, 0);
      this.dummy.scale.set(p.scale * t, p.scale * t, p.scale * (0.8 + speedMps * 0.02));
      this.dummy.updateMatrix();
      this.sparkInst.setMatrixAt(activeCount, this.dummy.matrix);
      this.sparkInst.setColorAt(activeCount, p.color);
      activeCount++;
    }
    this.sparkInst.count = activeCount;
    this.sparkInst.instanceMatrix.needsUpdate = true;
    if (this.sparkInst.instanceColor) this.sparkInst.instanceColor.needsUpdate = true;

    // EMP expanding shell
    if (this.empTimer > 0) {
      this.empTimer -= dt;
      const progress = 1 - Math.max(0, this.empTimer) / 0.65;
      this.empMesh.scale.setScalar(1 + progress * 20);
      (this.empMesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.62;
      if (this.empTimer <= 0) {
        this.empMesh.visible = false;
      }
    }

    // Rain / High-Speed Streaks
    const showStreaks = hasRain || speedMps > 52;
    this.rainInst.visible = showStreaks;
    this.rainInst.count = showStreaks ? RAIN_COUNT : 0;
    if (showStreaks) {
      const streakStretch = hasRain ? 1.0 + speedMps * 0.025 : 0.7 + speedMps * 0.03;
      for (let i = 0; i < RAIN_COUNT; i++) {
        const base = i * 3;
        this.rainOffsets[base + 1] -= (hasRain ? 22 : 4) * dt;
        this.rainOffsets[base + 2] -= (26 + speedMps * 0.75) * dt;
        if (this.rainOffsets[base + 2] < -8 || this.rainOffsets[base + 1] < -2) {
          this.rainOffsets[base] = (Math.random() - 0.5) * 32;
          this.rainOffsets[base + 1] = hasRain ? Math.random() * 14 + 2 : Math.random() * 6 + 0.5;
          this.rainOffsets[base + 2] = 48 + Math.random() * 24;
        }
        this.dummy.position.set(
          camX + this.rainOffsets[base],
          camY + this.rainOffsets[base + 1] - 2.5,
          camZ + this.rainOffsets[base + 2]
        );
        this.dummy.rotation.set(hasRain ? 0.09 : 0.02, 0, 0);
        this.dummy.scale.set(1, 1, streakStretch);
        this.dummy.updateMatrix();
        this.rainInst.setMatrixAt(i, this.dummy.matrix);
      }
      this.rainInst.instanceMatrix.needsUpdate = true;
    }
  }
}
