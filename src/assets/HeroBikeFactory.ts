import * as THREE from "three";
import { MaterialKit } from "./MaterialLibrary";

export interface HyperbikeVisual {
  root: THREE.Group;
  leanGroup: THREE.Group;
  frontWheel: THREE.Group;
  rearWheel: THREE.Group;
  brakeMat: THREE.MeshStandardMaterial;
  nitroLeft: THREE.Mesh;
  nitroRight: THREE.Mesh;
  underglowMesh: THREE.Mesh;
  underglowMat: THREE.MeshBasicMaterial;
  paintMat: THREE.MeshPhysicalMaterial;
  accentMat: THREE.MeshStandardMaterial;
  strobeRed?: THREE.Mesh;
  strobeBlue?: THREE.Mesh;
  setColors: (primaryHex: number, accentHex: number) => void;
}

// Cached shared geometries to keep GPU geometry count flat across restarts & races
let gShadowPlane: THREE.PlaneGeometry | null = null;
let gUnderglowPlane: THREE.PlaneGeometry | null = null;
let gTireFront: THREE.TorusGeometry | null = null;
let gTireRear: THREE.TorusGeometry | null = null;
let gRimFront: THREE.CylinderGeometry | null = null;
let gRimRear: THREE.CylinderGeometry | null = null;
let gStripeFront: THREE.TorusGeometry | null = null;
let gStripeRear: THREE.TorusGeometry | null = null;
let gDiscFront: THREE.CylinderGeometry | null = null;
let gDiscRear: THREE.CylinderGeometry | null = null;
let sharedFairingGeo: THREE.ExtrudeGeometry | null = null;
let gEngineBlock: THREE.BoxGeometry | null = null;
let gBellyPan: THREE.CylinderGeometry | null = null;
let gFork: THREE.CylinderGeometry | null = null;
let gTank: THREE.SphereGeometry | null = null;
let gWindscreen: THREE.SphereGeometry | null = null;
let gWing: THREE.BoxGeometry | null = null;
let gSeat: THREE.CylinderGeometry | null = null;
let gTailHorn: THREE.ConeGeometry | null = null;
let gBar: THREE.CylinderGeometry | null = null;
let gHl: THREE.BoxGeometry | null = null;
let gTailStrip: THREE.BoxGeometry | null = null;
let gPipe: THREE.CylinderGeometry | null = null;
let gFlame: THREE.ConeGeometry | null = null;

function createWheel(kit: MaterialKit, isRear: boolean, accentMat: THREE.Material, castShadow: boolean): THREE.Group {
  const radius = isRear ? 0.36 : 0.34;
  const width = isRear ? 0.28 : 0.2;
  const wg = new THREE.Group();

  const tireGeo = isRear
    ? (gTireRear ??= new THREE.TorusGeometry(radius, width * 0.45, 10, 22))
    : (gTireFront ??= new THREE.TorusGeometry(radius, width * 0.45, 10, 22));
  const tire = new THREE.Mesh(tireGeo, kit.tireRubberMat);
  tire.rotation.y = Math.PI / 2;
  tire.castShadow = castShadow;
  wg.add(tire);

  const rimGeo = isRear
    ? (gRimRear ??= new THREE.CylinderGeometry(radius * 0.68, radius * 0.68, width * 0.42, 14))
    : (gRimFront ??= new THREE.CylinderGeometry(radius * 0.68, radius * 0.68, width * 0.42, 14));
  const rimBarrel = new THREE.Mesh(rimGeo, kit.darkAlloyMat);
  rimBarrel.rotation.z = Math.PI / 2;
  wg.add(rimBarrel);

  const stripeGeo = isRear
    ? (gStripeRear ??= new THREE.TorusGeometry(radius * 0.7, 0.012, 6, 22))
    : (gStripeFront ??= new THREE.TorusGeometry(radius * 0.7, 0.012, 6, 22));
  if (castShadow) {
    const stripeL = new THREE.Mesh(stripeGeo, accentMat);
    stripeL.rotation.y = Math.PI / 2;
    stripeL.position.x = -width * 0.24;
    const stripeR = stripeL.clone();
    stripeR.position.x = width * 0.24;
    wg.add(stripeL, stripeR);

    const discGeo = isRear
      ? (gDiscRear ??= new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, 0.022, 14))
      : (gDiscFront ??= new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, 0.022, 14));
    const disc = new THREE.Mesh(discGeo, kit.chromeMat);
    disc.rotation.z = Math.PI / 2;
    disc.position.x = width * 0.28;
    wg.add(disc);
  }

  return wg;
}

function createAerodynamicFairingGeo(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  // Sleek tapered side silhouette: Z forward to the right
  s.moveTo(-0.46, 0.34);
  s.lineTo(0.32, 0.34);
  s.quadraticCurveTo(0.86, 0.48, 1.06, 0.72);
  s.quadraticCurveTo(0.84, 0.92, 0.42, 0.88);
  s.lineTo(0.05, 0.82);
  s.lineTo(-0.38, 0.56);
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.26,
    bevelEnabled: true,
    bevelThickness: 0.055,
    bevelSize: 0.045,
    bevelSegments: 3,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate(0.13, 0, 0);
  return geo;
}

export function buildHyperbikeModel(
  kit: MaterialKit,
  primaryHex: number,
  secondaryHex: number,
  accentHex: number,
  isInterceptor = false,
  isHeroShadowCaster = false
): HyperbikeVisual {
  const root = new THREE.Group();
  const leanGroup = new THREE.Group();
  root.add(leanGroup);

  const paintMat = kit.makePaintMaterial(primaryHex);
  const secondaryMat = kit.makePaintMaterial(secondaryHex);
  const accentMat = kit.makeNeonMaterial(accentHex, 1.65);
  const brakeMat = kit.tailLightMat.clone();

  const shadow = new THREE.Mesh((gShadowPlane ??= new THREE.PlaneGeometry(1.35, 2.75)), kit.contactShadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.022;
  root.add(shadow);

  const underglowMat = new THREE.MeshBasicMaterial({
    map: kit.glowSpriteTex,
    color: accentHex,
    transparent: true,
    opacity: 0.16,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });
  const underglowMesh = new THREE.Mesh((gUnderglowPlane ??= new THREE.PlaneGeometry(1.25, 2.3)), underglowMat);
  underglowMesh.rotation.x = -Math.PI / 2;
  underglowMesh.position.y = 0.026;
  underglowMesh.visible = isHeroShadowCaster;
  root.add(underglowMesh);

  const rearWheel = createWheel(kit, true, accentMat, isHeroShadowCaster);
  rearWheel.position.set(0, 0.36, -0.78);
  leanGroup.add(rearWheel);

  const frontWheel = createWheel(kit, false, accentMat, isHeroShadowCaster);
  frontWheel.position.set(0, 0.34, 0.88);
  leanGroup.add(frontWheel);

  if (isHeroShadowCaster) {
    const engineBlock = new THREE.Mesh((gEngineBlock ??= new THREE.BoxGeometry(0.32, 0.36, 0.68)), kit.darkAlloyMat);
    engineBlock.position.set(0, 0.48, 0.06);
    engineBlock.castShadow = true;
    leanGroup.add(engineBlock);

    const bellyPan = new THREE.Mesh((gBellyPan ??= new THREE.CylinderGeometry(0.16, 0.2, 0.82, 8)), kit.carbonMat);
    bellyPan.rotation.x = Math.PI / 2;
    bellyPan.scale.set(1.05, 1, 0.55);
    bellyPan.position.set(0, 0.28, 0.12);
    leanGroup.add(bellyPan);

    const forkGeo = (gFork ??= new THREE.CylinderGeometry(0.03, 0.026, 0.58, 8));
    const goldMat = kit.makePaintMaterial(isInterceptor ? 0xd97706 : 0xd4af37);
    const forkL = new THREE.Mesh(forkGeo, goldMat);
    forkL.position.set(-0.11, 0.54, 0.74);
    forkL.rotation.x = -0.38;
    const forkR = forkL.clone();
    forkR.position.x = 0.11;
    leanGroup.add(forkL, forkR);

    const tank = new THREE.Mesh((gTank ??= new THREE.SphereGeometry(0.24, 12, 8)), paintMat);
    tank.scale.set(0.9, 0.65, 1.55);
    tank.position.set(0, 0.86, 0.2);
    leanGroup.add(tank);

    const wingGeo = (gWing ??= new THREE.BoxGeometry(0.28, 0.025, 0.16));
    const wingL = new THREE.Mesh(wingGeo, kit.carbonMat);
    wingL.position.set(-0.26, 0.68, 0.72);
    wingL.rotation.set(0.08, -0.28, -0.1);
    const wingR = new THREE.Mesh(wingGeo, kit.carbonMat);
    wingR.position.set(0.26, 0.68, 0.72);
    wingR.rotation.set(0.08, 0.28, 0.1);
    leanGroup.add(wingL, wingR);

    const bar = new THREE.Mesh((gBar ??= new THREE.CylinderGeometry(0.02, 0.02, 0.72, 8)), kit.chromeMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0.96, 0.46);
    leanGroup.add(bar);
  }

  const bodyShell = new THREE.Mesh((sharedFairingGeo ??= createAerodynamicFairingGeo()), paintMat);
  bodyShell.castShadow = isHeroShadowCaster;
  leanGroup.add(bodyShell);

  if (isHeroShadowCaster) {
    const windscreen = new THREE.Mesh(
      (gWindscreen ??= new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI, 0, Math.PI * 0.52)),
      kit.carbonMat
    );
    windscreen.rotation.set(-0.7, 0, 0);
    windscreen.scale.set(0.82, 0.78, 1.42);
    windscreen.position.set(0, 0.87, 0.67);
    leanGroup.add(windscreen);

    const seat = new THREE.Mesh((gSeat ??= new THREE.CylinderGeometry(0.14, 0.16, 0.5, 8)), kit.carbonMat);
    seat.rotation.x = Math.PI / 2 - 0.08;
    seat.scale.set(1.05, 1, 0.45);
    seat.position.set(0, 0.83, -0.32);
    leanGroup.add(seat);
  }

  const tailHorn = new THREE.Mesh((gTailHorn ??= new THREE.ConeGeometry(0.17, 0.72, 6)), secondaryMat);
  tailHorn.rotation.x = -Math.PI / 2 + 0.34;
  tailHorn.scale.set(1.05, 1, 0.55);
  tailHorn.position.set(0, 0.94, -0.74);
  leanGroup.add(tailHorn);

  const hlGeo = (gHl ??= new THREE.BoxGeometry(0.13, 0.04, 0.06));
  if (isHeroShadowCaster) {
    const hlL = new THREE.Mesh(hlGeo, kit.headLightMat);
    hlL.position.set(-0.1, 0.73, 1.07);
    hlL.rotation.set(0, -0.25, 0.25);
    const hlR = hlL.clone();
    hlR.position.x = 0.1;
    hlR.rotation.set(0, 0.25, -0.25);
    leanGroup.add(hlL, hlR);
  }

  const tailStrip = new THREE.Mesh((gTailStrip ??= new THREE.BoxGeometry(0.24, 0.055, 0.06)), brakeMat);
  tailStrip.position.set(0, 1.02, -1.03);
  leanGroup.add(tailStrip);

  if (isHeroShadowCaster) {
    const pipeGeo = (gPipe ??= new THREE.CylinderGeometry(0.048, 0.06, 0.62, 8));
    const pipeL = new THREE.Mesh(pipeGeo, kit.chromeMat);
    pipeL.rotation.x = Math.PI / 2 + 0.24;
    pipeL.position.set(-0.15, 0.62, -0.82);
    const pipeR = pipeL.clone();
    pipeR.position.x = 0.15;
    leanGroup.add(pipeL, pipeR);
  }

  const flameGeo = (gFlame ??= (() => {
    const f = new THREE.ConeGeometry(0.08, 0.85, 8);
    f.rotateX(-Math.PI / 2);
    return f;
  })());
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const nitroLeft = new THREE.Mesh(flameGeo, flameMat);
  nitroLeft.position.set(-0.15, 0.7, -1.48);
  nitroLeft.visible = false;
  const nitroRight = nitroLeft.clone();
  nitroRight.position.x = 0.15;
  leanGroup.add(nitroLeft, nitroRight);

  let strobeRed: THREE.Mesh | undefined;
  let strobeBlue: THREE.Mesh | undefined;
  if (isInterceptor) {
    strobeRed = new THREE.Mesh(hlGeo, kit.policeRedMat);
    strobeRed.position.set(-0.18, 0.84, 0.76);
    strobeBlue = new THREE.Mesh(hlGeo, kit.policeBlueMat);
    strobeBlue.position.set(0.18, 0.84, 0.76);
    leanGroup.add(strobeRed, strobeBlue);
  }

  return {
    root,
    leanGroup,
    frontWheel,
    rearWheel,
    brakeMat,
    nitroLeft,
    nitroRight,
    underglowMesh,
    underglowMat,
    paintMat,
    accentMat,
    strobeRed,
    strobeBlue,
    setColors(pHex: number, aHex: number) {
      paintMat.color.setHex(pHex);
      accentMat.color.setHex(aHex);
      accentMat.emissive.setHex(aHex);
      underglowMat.color.setHex(aHex);
    },
  };
}
