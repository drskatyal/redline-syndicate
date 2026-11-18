import * as THREE from "three";
import { LoadedAssets } from "../assets/AssetLoader";
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

interface BillboardParticle {
  active: boolean;
  kind: "smoke" | "fire";
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
}

interface DebrisPiece {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  vrz: number;
  groundY: number;
  scale: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

const MAX_SPARKS = 260;
const MAX_BILLBOARDS = 96;
const MAX_DEBRIS = 56;
const RAIN_COUNT = 180;

export class VfxSystem {
  public readonly group = new THREE.Group();
  private sparkInst: THREE.InstancedMesh;
  private smokeInst: THREE.InstancedMesh;
  private fireInst: THREE.InstancedMesh;
  private debrisInst: THREE.InstancedMesh;
  private rainInst: THREE.InstancedMesh;

  private sparks: Particle[] = [];
  private sparkCursor = 0;

  private billboards: BillboardParticle[] = [];
  private bbCursor = 0;

  private debris: DebrisPiece[] = [];
  private debrisCursor = 0;

  private rainOffsets: Float32Array;
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(kit: MaterialKit, assets: LoadedAssets) {
    const sparkGeo = new THREE.BoxGeometry(0.022, 0.022, 0.16);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.sparkInst.count = 0;
    this.sparkInst.frustumCulled = false;
    this.group.add(this.sparkInst);

    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparks.push({
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

    const bbGeo = new THREE.PlaneGeometry(1, 1);
    const smokeMat = new THREE.MeshBasicMaterial({
      map: assets.textures.smoke,
      color: 0xcbd5e1,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.smokeInst = new THREE.InstancedMesh(bbGeo, smokeMat, MAX_BILLBOARDS);
    this.smokeInst.count = 0;
    this.smokeInst.frustumCulled = false;
    this.group.add(this.smokeInst);

    const fireMat = new THREE.MeshBasicMaterial({
      map: kit.fireballTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fireInst = new THREE.InstancedMesh(bbGeo, fireMat, MAX_BILLBOARDS);
    this.fireInst.count = 0;
    this.fireInst.frustumCulled = false;
    this.group.add(this.fireInst);

    for (let i = 0; i < MAX_BILLBOARDS; i++) {
      this.billboards.push({
        active: false,
        kind: "smoke",
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        startScale: 0.5,
        endScale: 2.0,
      });
    }

    const debrisGeo = new THREE.BoxGeometry(0.10, 0.02, 0.14);
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.22,
      metalness: 0.65,
      envMapIntensity: 1.4,
    });
    this.debrisInst = new THREE.InstancedMesh(debrisGeo, debrisMat, MAX_DEBRIS);
    this.debrisInst.count = 0;
    this.debrisInst.frustumCulled = false;
    this.group.add(this.debrisInst);

    for (let i = 0; i < MAX_DEBRIS; i++) {
      this.debris.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        vrx: 0,
        vry: 0,
        vrz: 0,
        groundY: 0,
        scale: 1,
        life: 0,
        maxLife: 1,
        color: new THREE.Color(0xdbeafe),
      });
    }

    const rainGeo = new THREE.BoxGeometry(0.01, 0.01, 2.6);
    const rainMat = new THREE.MeshBasicMaterial({
      color: 0xcbd5e1,
      transparent: true,
      opacity: 0.22,
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
      this.rainOffsets[i * 3] = (Math.random() - 0.5) * 30;
      this.rainOffsets[i * 3 + 1] = Math.random() * 14 + 0.4;
      this.rainOffsets[i * 3 + 2] = Math.random() * 60 - 8;
    }
  }

  public spawnBurst(x: number, y: number, z: number, colorHex: number, count = 18, speed = 10, scale = 1): void {
    for (let i = 0; i < count; i++) {
      const p = this.sparks[this.sparkCursor];
      this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS;
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = (Math.random() - 0.5) * speed * 1.6;
      p.vy = Math.random() * speed * 0.9 + 1.5;
      p.vz = (Math.random() - 0.5) * speed * 1.2;
      p.maxLife = 0.22 + Math.random() * 0.42;
      p.life = p.maxLife;
      p.scale = scale * (0.7 + Math.random() * 0.8);
      p.color.setHex(colorHex);
    }
  }

  public spawnSmoke(x: number, y: number, z: number, count = 3, scale = 1.0): void {
    for (let i = 0; i < count; i++) {
      const b = this.billboards[this.bbCursor];
      this.bbCursor = (this.bbCursor + 1) % MAX_BILLBOARDS;
      b.active = true;
      b.kind = "smoke";
      b.x = x + (Math.random() - 0.5) * 0.45;
      b.y = y + Math.random() * 0.25;
      b.z = z + (Math.random() - 0.5) * 0.45;
      b.vx = (Math.random() - 0.5) * 2.4;
      b.vy = 1.2 + Math.random() * 1.8;
      b.vz = (Math.random() - 0.5) * 2.0;
      b.maxLife = 0.55 + Math.random() * 0.45;
      b.life = b.maxLife;
      b.startScale = 0.55 * scale;
      b.endScale = 2.6 * scale;
    }
  }

  public spawnExplosion(x: number, y: number, z: number, scale = 1.3): void {
    this.spawnBurst(x, y + 0.6, z, 0xffaa00, 42, 18, 1.45 * scale);
    this.spawnSmoke(x, y + 0.8, z, 8, 1.8 * scale);
    for (let i = 0; i < 6; i++) {
      const b = this.billboards[this.bbCursor];
      this.bbCursor = (this.bbCursor + 1) % MAX_BILLBOARDS;
      b.active = true;
      b.kind = "fire";
      b.x = x + (Math.random() - 0.5) * 1.1;
      b.y = y + 0.5 + Math.random() * 0.9;
      b.z = z + (Math.random() - 0.5) * 1.1;
      b.vx = (Math.random() - 0.5) * 4.5;
      b.vy = 2.5 + Math.random() * 3.5;
      b.vz = (Math.random() - 0.5) * 4.0;
      b.maxLife = 0.42 + Math.random() * 0.28;
      b.life = b.maxLife;
      b.startScale = 1.2 * scale;
      b.endScale = 4.2 * scale;
    }
  }

  public spawnDebrisBurst(
    x: number,
    y: number,
    z: number,
    baseVx: number,
    baseVz: number,
    paintHex: number,
    count = 20,
    groundY = 0
  ): void {
    for (let i = 0; i < count; i++) {
      const d = this.debris[this.debrisCursor];
      this.debrisCursor = (this.debrisCursor + 1) % MAX_DEBRIS;
      d.active = true;
      d.x = x + (Math.random() - 0.5) * 0.9;
      d.y = y + Math.random() * 0.65;
      d.z = z + (Math.random() - 0.5) * 0.9;
      d.vx = baseVx + (Math.random() - 0.5) * 14;
      d.vy = 3.8 + Math.random() * 7.8;
      d.vz = baseVz + (Math.random() - 0.35) * 12;
      d.rx = Math.random() * Math.PI;
      d.ry = Math.random() * Math.PI;
      d.rz = Math.random() * Math.PI;
      d.vrx = (Math.random() - 0.5) * 20;
      d.vry = (Math.random() - 0.5) * 20;
      d.vrz = (Math.random() - 0.5) * 20;
      d.groundY = groundY;
      d.scale = 0.45 + Math.random() * 0.7;
      d.maxLife = 1.4 + Math.random() * 0.65;
      d.life = d.maxLife;
      const roleRoll = i % 5;
      if (roleRoll < 2) d.color.setHex(0xbae6fd); // tempered windshield glass shard
      else if (roleRoll < 4) d.color.setHex(paintHex); // painted car panel
      else d.color.setHex(0x1e293b); // carbon bumper trim
    }
  }

  public update(dt: number, camX: number, camY: number, camZ: number, speedMps: number, hasRain: boolean): void {
    let activeSparks = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const p = this.sparks[i];
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
      const stretch = Math.min(1.6, 0.75 + speedMps * 0.012);
      this.dummy.scale.set(p.scale * t, p.scale * t, p.scale * stretch);
      this.dummy.updateMatrix();
      this.sparkInst.setMatrixAt(activeSparks, this.dummy.matrix);
      this.sparkInst.setColorAt(activeSparks, p.color);
      activeSparks++;
    }
    this.sparkInst.count = activeSparks;
    this.sparkInst.instanceMatrix.needsUpdate = true;
    if (this.sparkInst.instanceColor) this.sparkInst.instanceColor.needsUpdate = true;

    let smokeCount = 0;
    let fireCount = 0;
    for (let i = 0; i < MAX_BILLBOARDS; i++) {
      const b = this.billboards[i];
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      const t = 1 - b.life / b.maxLife;
      const sc = b.startScale + (b.endScale - b.startScale) * t;
      this.dummy.position.set(b.x, b.y, b.z);
      this.dummy.rotation.set(0, 0, t * 1.2 + i);
      this.dummy.scale.setScalar(sc);
      this.dummy.updateMatrix();
      if (b.kind === "smoke") {
        const shade = 0.55 * (1 - t * 0.5);
        this.tmpColor.setRGB(shade, shade, shade);
        this.smokeInst.setMatrixAt(smokeCount, this.dummy.matrix);
        this.smokeInst.setColorAt(smokeCount, this.tmpColor);
        smokeCount++;
      } else {
        const fade = Math.max(0, 1 - t * 0.9);
        this.tmpColor.setRGB(fade * 1.4, fade * 1.1, fade * 0.9);
        this.fireInst.setMatrixAt(fireCount, this.dummy.matrix);
        this.fireInst.setColorAt(fireCount, this.tmpColor);
        fireCount++;
      }
    }
    this.smokeInst.count = smokeCount;
    this.smokeInst.instanceMatrix.needsUpdate = true;
    if (this.smokeInst.instanceColor) this.smokeInst.instanceColor.needsUpdate = true;
    this.fireInst.count = fireCount;
    this.fireInst.instanceMatrix.needsUpdate = true;
    if (this.fireInst.instanceColor) this.fireInst.instanceColor.needsUpdate = true;

    let debrisCount = 0;
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = this.debris[i];
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        continue;
      }
      d.vy -= 24 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.rx += d.vrx * dt;
      d.ry += d.vry * dt;
      d.rz += d.vrz * dt;
      if (d.y <= d.groundY + 0.05) {
        d.y = d.groundY + 0.05;
        if (d.vy < -2.2) {
          d.vy = -d.vy * 0.42;
          d.vx *= 0.68;
          d.vz *= 0.68;
          d.vrx *= 0.72;
          d.vry *= 0.72;
        } else {
          d.vy = 0;
          d.vx *= 0.92;
          d.vz *= 0.92;
        }
      }
      const fadeSc = d.scale * Math.min(1, d.life * 2.5);
      this.dummy.position.set(d.x, d.y, d.z);
      this.dummy.rotation.set(d.rx, d.ry, d.rz);
      this.dummy.scale.setScalar(fadeSc);
      this.dummy.updateMatrix();
      this.debrisInst.setMatrixAt(debrisCount, this.dummy.matrix);
      this.debrisInst.setColorAt(debrisCount, d.color);
      debrisCount++;
    }
    this.debrisInst.count = debrisCount;
    this.debrisInst.instanceMatrix.needsUpdate = true;
    if (this.debrisInst.instanceColor) this.debrisInst.instanceColor.needsUpdate = true;

    const showStreaks = hasRain;
    this.rainInst.visible = showStreaks;
    this.rainInst.count = showStreaks ? RAIN_COUNT : 0;
    if (showStreaks) {
      const streakStretch = hasRain ? 1.0 + speedMps * 0.025 : 0.7 + speedMps * 0.03;
      for (let i = 0; i < RAIN_COUNT; i++) {
        const base = i * 3;
        this.rainOffsets[base + 1] -= (hasRain ? 22 : 4) * dt;
        this.rainOffsets[base + 2] -= (26 + speedMps * 0.75) * dt;
        if (this.rainOffsets[base + 2] < -8 || this.rainOffsets[base + 1] < -2) {
          this.rainOffsets[base] = (Math.random() - 0.5) * 30;
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
