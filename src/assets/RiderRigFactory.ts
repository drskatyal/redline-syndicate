import * as THREE from "three";
import { WeaponId, WEAPONS } from "../data/weapons";
import { MaterialKit } from "./MaterialLibrary";

export interface RiderRigVisual {
  root: THREE.Group;
  pelvis: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightShoulder: THREE.Group;
  rightElbow: THREE.Group;
  leftHip: THREE.Group;
  rightHip: THREE.Group;
  weaponPivot: THREE.Group;
  weaponMesh: THREE.Mesh;
  weaponMat: THREE.MeshStandardMaterial;
  slashTrail: THREE.Mesh;
  slashMat: THREE.MeshBasicMaterial;
  updatePose: (params: {
    leanRad: number;
    tuckNorm: number;
    attackSide: -1 | 0 | 1;
    attackType: "melee" | "kick";
    attackProgress: number; // 0..1
    weapon: WeaponId;
    crashed: boolean;
    crashTime: number;
    crashDir: number;
  }) => void;
}

let rHipsGeo: THREE.BoxGeometry | null = null;
let rChestGeo: THREE.BoxGeometry | null = null;
let rSpineGeo: THREE.BoxGeometry | null = null;
let rHelmetGeo: THREE.SphereGeometry | null = null;
let rVisorGeo: THREE.BoxGeometry | null = null;
let rPadGeo: THREE.SphereGeometry | null = null;
let rUpperGeo: THREE.CylinderGeometry | null = null;
let rForeGeo: THREE.CylinderGeometry | null = null;
let rGloveGeo: THREE.BoxGeometry | null = null;
let rWeaponGeo: THREE.BoxGeometry | null = null;
let rSlashGeo: THREE.RingGeometry | null = null;
let rThighGeo: THREE.CylinderGeometry | null = null;
let rShinGeo: THREE.CylinderGeometry | null = null;
let rBootGeo: THREE.BoxGeometry | null = null;

export function buildArmoredRiderRig(
  kit: MaterialKit,
  jacketHex: number,
  helmetHex: number,
  visorAccentHex: number,
  castShadow = false
): RiderRigVisual {
  const root = new THREE.Group();
  const pelvis = new THREE.Group();
  pelvis.position.set(0, 0.88, -0.26);
  root.add(pelvis);

  const jacketMat = kit.makePaintMaterial(jacketHex);
  const armorMat = kit.carbonMat;
  const helmetMat = kit.makePaintMaterial(helmetHex);
  const visorMat = kit.makeNeonMaterial(visorAccentHex, 2.2);

  if (castShadow) {
    const hipsMesh = new THREE.Mesh((rHipsGeo ??= new THREE.BoxGeometry(0.32, 0.18, 0.24)), armorMat);
    pelvis.add(hipsMesh);
  }

  const torso = new THREE.Group();
  torso.position.set(0, 0.12, 0.02);
  torso.rotation.x = 0.48;
  pelvis.add(torso);

  const chest = new THREE.Mesh((rChestGeo ??= new THREE.BoxGeometry(0.38, 0.42, 0.26)), jacketMat);
  chest.position.set(0, 0.22, 0);
  chest.castShadow = castShadow;
  torso.add(chest);

  if (castShadow) {
    const spineHump = new THREE.Mesh((rSpineGeo ??= new THREE.BoxGeometry(0.18, 0.36, 0.14)), armorMat);
    spineHump.position.set(0, 0.24, -0.14);
    torso.add(spineHump);
  }

  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.04);
  torso.add(head);

  const helmet = new THREE.Mesh((rHelmetGeo ??= new THREE.SphereGeometry(0.155, 12, 10)), helmetMat);
  helmet.scale.set(0.95, 1.04, 1.18);
  helmet.castShadow = castShadow;
  head.add(helmet);

  if (castShadow) {
    const visor = new THREE.Mesh((rVisorGeo ??= new THREE.BoxGeometry(0.24, 0.085, 0.16)), visorMat);
    visor.position.set(0, 0.01, 0.12);
    head.add(visor);
  }

  const makeArm = (side: -1 | 1) => {
    const sh = new THREE.Group();
    sh.position.set(side * 0.23, 0.38, 0.02);
    if (castShadow) {
      const pad = new THREE.Mesh((rPadGeo ??= new THREE.SphereGeometry(0.085, 8, 6)), armorMat);
      sh.add(pad);
    }

    const upper = new THREE.Mesh((rUpperGeo ??= new THREE.CylinderGeometry(0.058, 0.05, 0.28, 6)), jacketMat);
    upper.position.set(0, -0.14, 0);
    sh.add(upper);

    const elb = new THREE.Group();
    elb.position.set(0, -0.27, 0);
    sh.add(elb);

    const fore = new THREE.Mesh((rForeGeo ??= new THREE.CylinderGeometry(0.048, 0.042, 0.27, 6)), armorMat);
    fore.position.set(0, -0.13, 0);
    elb.add(fore);

    if (castShadow) {
      const glove = new THREE.Mesh((rGloveGeo ??= new THREE.BoxGeometry(0.085, 0.09, 0.095)), armorMat);
      glove.position.set(0, -0.28, 0.02);
      elb.add(glove);
    }
    torso.add(sh);
    return { sh, elb };
  };

  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0, -0.29, 0.04);
  rightArm.elb.add(weaponPivot);

  const weaponMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    emissive: 0x00f0ff,
    emissiveIntensity: 1.8,
    metalness: 0.75,
    roughness: 0.25,
  });
  const weaponMesh = new THREE.Mesh((rWeaponGeo ??= new THREE.BoxGeometry(0.045, 0.65, 0.055)), weaponMat);
  weaponMesh.position.set(0, -0.25, 0.22);
  weaponMesh.rotation.x = Math.PI * 0.4;
  weaponPivot.add(weaponMesh);

  const slashMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const slashTrail = new THREE.Mesh((rSlashGeo ??= new THREE.RingGeometry(0.42, 0.92, 12, 1, -0.8, 1.6)), slashMat);
  slashTrail.rotation.x = Math.PI / 2;
  slashTrail.position.set(0, 0.25, 0.25);
  slashTrail.visible = false;
  torso.add(slashTrail);

  const makeLeg = (side: -1 | 1) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.16, -0.02, 0.02);
    const thigh = new THREE.Mesh((rThighGeo ??= new THREE.CylinderGeometry(0.075, 0.06, 0.36, 6)), armorMat);
    thigh.rotation.x = 1.05;
    thigh.position.set(side * 0.04, -0.1, 0.16);
    const shin = new THREE.Mesh((rShinGeo ??= new THREE.CylinderGeometry(0.058, 0.048, 0.38, 6)), jacketMat);
    shin.rotation.x = -0.35;
    shin.position.set(side * 0.06, -0.3, 0.22);
    hip.add(thigh, shin);
    if (castShadow) {
      const boot = new THREE.Mesh((rBootGeo ??= new THREE.BoxGeometry(0.11, 0.12, 0.22)), armorMat);
      boot.position.set(side * 0.07, -0.46, 0.14);
      hip.add(boot);
    }
    pelvis.add(hip);
    return hip;
  };
  const leftHip = makeLeg(-1);
  const rightHip = makeLeg(1);

  return {
    root,
    pelvis,
    torso,
    head,
    leftShoulder: leftArm.sh,
    leftElbow: leftArm.elb,
    rightShoulder: rightArm.sh,
    rightElbow: rightArm.elb,
    leftHip,
    rightHip,
    weaponPivot,
    weaponMesh,
    weaponMat,
    slashTrail,
    slashMat,
    updatePose({ leanRad, tuckNorm, attackSide, attackType, attackProgress, weapon, crashed, crashTime, crashDir }) {
      if (crashed) {
        // Dramatic ejection ragdoll tumble
        pelvis.position.set(crashDir * Math.min(4.2, crashTime * 3.8), 0.88 + Math.max(0, Math.sin(Math.min(Math.PI, crashTime * 2.8)) * 2.1), -0.26 + crashTime * 1.4);
        pelvis.rotation.set(crashTime * 6.5, crashTime * 4.2 * crashDir, crashTime * 5.0 * crashDir);
        torso.rotation.set(0.3, 0, 0);
        leftArm.sh.rotation.set(-1.5, 0, -0.8);
        rightArm.sh.rotation.set(-1.5, 0, 0.8);
        leftHip.rotation.set(-0.5, 0, -0.4);
        rightHip.rotation.set(-0.5, 0, 0.4);
        slashMat.opacity = 0;
        weaponMesh.visible = false;
        return;
      }

      pelvis.position.set(leanRad * 0.18, 0.88 - tuckNorm * 0.06, -0.26);
      pelvis.rotation.set(0, 0, -leanRad * 0.22);

      // Sport tuck angle
      torso.rotation.set(0.46 + tuckNorm * 0.34, 0, -leanRad * 0.18);
      head.rotation.set(-0.36 - tuckNorm * 0.25, leanRad * 0.25, 0);

      // Default handlebar grip poses
      leftArm.sh.rotation.set(-0.78 - tuckNorm * 0.2, 0.15, 0.22);
      leftArm.elb.rotation.set(-0.62, 0, 0);
      rightArm.sh.rotation.set(-0.78 - tuckNorm * 0.2, -0.15, -0.22);
      rightArm.elb.rotation.set(-0.62, 0, 0);
      leftHip.rotation.set(0, 0, -Math.max(0, -leanRad) * 0.45);
      rightHip.rotation.set(0, 0, Math.max(0, leanRad) * 0.45);

      const wSpec = WEAPONS[weapon];
      weaponMesh.visible = weapon !== "knuckle";
      weaponMat.color.setHex(wSpec.colorHex);
      weaponMat.emissive.setHex(wSpec.emissiveHex);

      if (attackSide !== 0 && attackProgress > 0) {
        const swingArc = Math.sin(attackProgress * Math.PI);
        if (attackType === "kick") {
          const hip = attackSide < 0 ? leftHip : rightHip;
          hip.rotation.set(-0.25, 0, attackSide * swingArc * 1.45);
          torso.rotation.z = -attackSide * swingArc * 0.25;
          slashMat.opacity = 0;
        } else {
          const sh = attackSide < 0 ? leftArm.sh : rightArm.sh;
          const elb = attackSide < 0 ? leftArm.elb : rightArm.elb;
          if (weaponPivot.parent !== elb) {
            elb.add(weaponPivot);
          }
          sh.rotation.set(-0.2 - swingArc * 1.25, 0, attackSide * (0.5 + swingArc * 1.15));
          elb.rotation.set(-0.15, 0, 0);
          torso.rotation.y = attackSide * swingArc * 0.42;

          slashTrail.visible = true;
          slashMat.color.setHex(wSpec.emissiveHex);
          slashMat.opacity = swingArc * 0.72;
          slashTrail.scale.setScalar(0.85 + swingArc * 0.35);
          slashTrail.rotation.y = attackSide > 0 ? 0 : Math.PI;
          slashTrail.rotation.z = (attackProgress - 0.5) * 1.6 * attackSide;
        }
      } else {
        slashTrail.visible = false;
        slashMat.opacity = 0;
        if (weaponPivot.parent !== rightArm.elb) {
          rightArm.elb.add(weaponPivot);
        }
      }
    },
  };
}
