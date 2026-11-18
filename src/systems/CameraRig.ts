import * as THREE from "three";

export class CameraRig {
  public trauma = 0;
  private smoothY = 0;
  private smoothYaw = 0;
  private smoothSideLag = 0;
  private smoothPitchOffset = 0;
  private smoothFov = 60;
  private orbitTheta = 0.58;

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  public reset(yaw: number, y: number): void {
    this.smoothYaw = yaw;
    this.smoothY = y;
    this.smoothSideLag = 0;
    this.smoothPitchOffset = 0;
    this.trauma = 0;
    this.smoothFov = 60;
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
    camera.lookAt(targetPos.x + camOffset, targetPos.y + 0.88, targetPos.z + 0.05);
  }

  /**
   * Tangent-aligned Third-Person Street Chase (mode 0), Close Brawler (mode 1), and Handlebar POV (mode 2).
   * Keeps camera aligned behind the highway & bike heading vector (-Forward(yaw)) so curves stay centered
   * and sits above the rider's helmet for unobstructed forward visibility over oncoming lanes.
   */
  public updateRace(
    camera: THREE.PerspectiveCamera,
    dt: number,
    playerWorldX: number,
    playerWorldY: number,
    playerWorldZ: number,
    roadYaw: number,
    bikeLatVel: number,
    lookAheadWorldX: number,
    lookAheadWorldY: number,
    lookAheadWorldZ: number,
    speedNorm: number,
    nitroActive: boolean,
    braking: boolean,
    leanRad: number,
    mode: number,
    elapsed: number
  ): void {
    this.trauma = Math.max(0, this.trauma - dt * 2.1);
    const shake = this.trauma * this.trauma;

    // Normalize shortest angular difference to prevent wraparound snapping
    const steerYawOffset = -Math.atan2(bikeLatVel, 28) * (mode === 2 ? 0.18 : 0.24);
    const targetYaw = roadYaw + steerYawOffset;
    let dYaw = targetYaw - this.smoothYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;

    const yawRate = 1 - Math.exp(-(mode === 2 ? 18 : 10) * dt);
    this.smoothYaw += dYaw * yawRate;
    this.smoothY += (playerWorldY - this.smoothY) * (1 - Math.exp(-12 * dt));

    const targetSideLag = mode === 2 ? 0 : THREE.MathUtils.clamp(-bikeLatVel * 0.042, -0.52, 0.52);
    this.smoothSideLag += (targetSideLag - this.smoothSideLag) * (1 - Math.exp(-8 * dt));

    const targetPitchOff = braking ? -0.08 : nitroActive ? 0.06 : 0;
    this.smoothPitchOffset += (targetPitchOff - this.smoothPitchOffset) * (1 - Math.exp(-9 * dt));

    const targetFov = (mode === 2 ? 74 : mode === 1 ? 62 : 58) + speedNorm * 13 + (nitroActive ? 5 : 0);
    this.smoothFov += (targetFov - this.smoothFov) * (1 - Math.exp(-8 * dt));
    camera.fov = this.smoothFov;
    camera.updateProjectionMatrix();

    // Forward & Orthogonal-Right unit vectors from smoothYaw (+Z forward, -X Screen Right)
    const fwdX = Math.sin(this.smoothYaw);
    const fwdZ = Math.cos(this.smoothYaw);
    const rgtX = -Math.cos(this.smoothYaw);
    const rgtZ = Math.sin(this.smoothYaw);

    let offsetDist = 4.35;
    let offsetHeight = 1.78;
    let lookHeight = 1.02;

    if (mode === 1) {
      offsetDist = 3.05;
      offsetHeight = 1.48;
      lookHeight = 0.96;
    } else if (mode === 2) {
      offsetDist = -0.22;
      offsetHeight = 1.24;
      lookHeight = 1.12;
    }

    const sx = shake * 0.34 * Math.sin(elapsed * 43);
    const sy = shake * 0.25 * Math.cos(elapsed * 51);
    const roadVib = speedNorm * 0.008 * Math.sin(elapsed * 64);

    const baseX = playerWorldX - fwdX * offsetDist + rgtX * this.smoothSideLag;
    const baseY = (mode === 2 ? playerWorldY : this.smoothY) + offsetHeight + this.smoothPitchOffset;
    const baseZ = playerWorldZ - fwdZ * offsetDist + rgtZ * this.smoothSideLag;

    camera.position.set(baseX + rgtX * sx, baseY + sy + roadVib, baseZ + rgtZ * sx);

    camera.lookAt(
      lookAheadWorldX,
      (mode === 2 ? playerWorldY : this.smoothY) * 0.35 + lookAheadWorldY * 0.65 + lookHeight,
      lookAheadWorldZ
    );

    // Apply local camera-axis roll AFTER lookAt (avoids Euler Y-pi inversion bugs on curves!)
    // Right turn (leanRad > 0) rolls camera slightly clockwise (+Z from camera looking at -Z? In Three camera local -Z is forward, so +Z roll tilts horizon!)
    const rollAngle = -leanRad * (mode === 2 ? 0.36 : 0.085) + shake * 0.045 * Math.sin(elapsed * 37);
    camera.rotateZ(rollAngle);
  }
}
