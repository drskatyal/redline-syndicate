import * as THREE from "three";

export class CameraRig {
  public trauma = 0;
  private smoothX = 0;
  private smoothY = 1.2;
  private smoothFov = 62;
  private orbitTheta = 0.58;

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  public reset(x: number, y: number): void {
    this.smoothX = x;
    this.smoothY = y;
    this.trauma = 0;
    this.smoothFov = 62;
  }

  public updateHangar(
    camera: THREE.PerspectiveCamera,
    targetPos: THREE.Vector3,
    dt: number,
    dragDeltaX = 0,
    shiftLeft = false
  ): void {
    this.orbitTheta += dt * 0.22 + dragDeltaX * 0.008;
    const radius = 3.55;
    camera.position.set(
      targetPos.x + Math.sin(this.orbitTheta) * radius,
      targetPos.y + 1.42,
      targetPos.z + Math.cos(this.orbitTheta) * radius
    );
    camera.fov = 42;
    camera.updateProjectionMatrix();
    const camOffset = shiftLeft ? 0.56 : -0.48;
    camera.lookAt(targetPos.x + camOffset, targetPos.y + 0.86, targetPos.z + 0.05);
  }

  public updateRace(
    camera: THREE.PerspectiveCamera,
    dt: number,
    playerX: number,
    playerY: number,
    playerZ: number,
    lookAheadX: number,
    lookAheadY: number,
    speedNorm: number,
    nitroActive: boolean,
    leanRad: number,
    mode: number, // 0=Dynamic Chase (GTA/Ride5), 1=Close Brawler, 2=Helmet Visor POV
    elapsed: number
  ): void {
    this.trauma = Math.max(0, this.trauma - dt * 2.1);
    const shake = this.trauma * this.trauma;

    const lerpRate = 1 - Math.exp(-13 * dt);
    this.smoothX += (playerX - this.smoothX) * lerpRate;
    this.smoothY += (playerY - this.smoothY) * lerpRate;

    const targetFov = (mode === 2 ? 78 : 62) + speedNorm * 16 + (nitroActive ? 7 : 0);
    this.smoothFov += (targetFov - this.smoothFov) * (1 - Math.exp(-9 * dt));
    camera.fov = this.smoothFov;
    camera.updateProjectionMatrix();

    let offsetDist = 3.15;
    let offsetHeight = 1.24;
    let lookZ = 18;
    let lookY = 0.88;

    if (mode === 1) {
      offsetDist = 2.35;
      offsetHeight = 1.06;
      lookZ = 16;
      lookY = 0.84;
    } else if (mode === 2) {
      offsetDist = -0.2;
      offsetHeight = 1.15;
      lookZ = 28;
      lookY = 1.02;
    }

    const sx = shake * 0.38 * Math.sin(elapsed * 43);
    const sy = shake * 0.28 * Math.cos(elapsed * 51);
    const roadVib = speedNorm * 0.012 * Math.sin(elapsed * 68);

    camera.position.set(
      (mode === 2 ? playerX : this.smoothX) + sx,
      (mode === 2 ? playerY : this.smoothY) + offsetHeight + sy + roadVib,
      playerZ - offsetDist
    );

    camera.lookAt(
      playerX * 0.55 + lookAheadX * 0.45,
      playerY * 0.45 + lookAheadY * 0.55 + lookY,
      playerZ + lookZ
    );

    camera.rotation.z += -leanRad * (mode === 2 ? 0.36 : 0.14) + shake * 0.055 * Math.sin(elapsed * 37);
  }
}
