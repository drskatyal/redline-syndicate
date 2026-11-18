import * as THREE from "three";

export class CameraRig {
  public trauma = 0;
  private smoothX = 0;
  private smoothY = 2.6;
  private smoothFov = 68;
  private orbitTheta = 0.68;

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  public reset(x: number, y: number): void {
    this.smoothX = x;
    this.smoothY = y;
    this.trauma = 0;
    this.smoothFov = 68;
  }

  public updateHangar(camera: THREE.PerspectiveCamera, targetPos: THREE.Vector3, dt: number, dragDeltaX = 0, shiftLeft = false): void {
    this.orbitTheta += dt * 0.25 + dragDeltaX * 0.008;
    const radius = 3.65;
    camera.position.set(
      targetPos.x + Math.sin(this.orbitTheta) * radius,
      targetPos.y + 1.42,
      targetPos.z + Math.cos(this.orbitTheta) * radius
    );
    camera.fov = 44;
    camera.updateProjectionMatrix();
    const camRightOffset = shiftLeft ? 0.62 : -0.38;
    camera.lookAt(targetPos.x + camRightOffset, targetPos.y + 0.68, targetPos.z + 0.08);
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
    mode: number, // 0=Chase, 1=Close Brawler, 2=Handlebar POV
    elapsed: number
  ): void {
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const shake = this.trauma * this.trauma;

    const lerpRate = 1 - Math.exp(-12 * dt);
    this.smoothX += (playerX - this.smoothX) * lerpRate;
    this.smoothY += (playerY - this.smoothY) * lerpRate;

    const targetFov =
      (mode === 2 ? 78 : 66) + speedNorm * 16 + (nitroActive ? 8 : 0);
    this.smoothFov += (targetFov - this.smoothFov) * (1 - Math.exp(-8 * dt));
    camera.fov = this.smoothFov;
    camera.updateProjectionMatrix();

    let offsetDist = 5.4;
    let offsetHeight = 2.35;
    let lookZ = 24;
    let lookY = 1.05;

    if (mode === 1) {
      offsetDist = 4.1;
      offsetHeight = 1.9;
      lookZ = 22;
      lookY = 1.0;
    } else if (mode === 2) {
      offsetDist = -0.35;
      offsetHeight = 1.28;
      lookZ = 32;
      lookY = 1.15;
    }

    const sx = shake * 0.42 * Math.sin(elapsed * 43);
    const sy = shake * 0.32 * Math.cos(elapsed * 51);
    const roadVib = speedNorm * 0.015 * Math.sin(elapsed * 72);

    camera.position.set(
      (mode === 2 ? playerX : this.smoothX) + sx,
      (mode === 2 ? playerY : this.smoothY) + offsetHeight + sy + roadVib,
      playerZ - offsetDist
    );

    camera.lookAt(
      playerX * 0.45 + lookAheadX * 0.55,
      playerY * 0.4 + lookAheadY * 0.6 + lookY,
      playerZ + lookZ
    );

    camera.rotation.z += -leanRad * (mode === 2 ? 0.34 : 0.1) + shake * 0.06 * Math.sin(elapsed * 37);
  }
}
