import * as THREE from "three";
import { MaterialKit } from "./MaterialLibrary";

export type TrafficKind = "coupe" | "suv" | "truck" | "swat";

export interface TrafficVisual {
  root: THREE.Group;
  kind: TrafficKind;
  halfWidth: number;
  halfLength: number;
  strobeRed?: THREE.Mesh;
  strobeBlue?: THREE.Mesh;
}

export interface HelicopterVisual {
  root: THREE.Group;
  mainRotor: THREE.Group;
  tailRotor: THREE.Group;
  searchCone: THREE.Mesh;
  spotTargetPos: THREE.Vector3;
  strobeLeft: THREE.Mesh;
  strobeRight: THREE.Mesh;
}

let tcShadow: THREE.PlaneGeometry | null = null;
let tBoxCache: Record<string, THREE.BoxGeometry> = {};
function boxG(w: number, h: number, d: number): THREE.BoxGeometry {
  const k = `${w}_${h}_${d}`;
  return (tBoxCache[k] ??= new THREE.BoxGeometry(w, h, d));
}
let tWheelBig: THREE.CylinderGeometry | null = null;
let tWheelSmall: THREE.CylinderGeometry | null = null;

export function buildTrafficVehicle(kit: MaterialKit, kind: TrafficKind, colorHex: number): TrafficVisual {
  const root = new THREE.Group();
  const bodyMat = kit.makePaintMaterial(colorHex);

  if (kind === "truck") {
    const shadow = new THREE.Mesh((tcShadow ??= new THREE.PlaneGeometry(3.1, 8.2)), kit.contactShadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    root.add(shadow);

    const trailer = new THREE.Mesh(boxG(2.25, 2.55, 5.4), kit.makePaintMaterial(0x64748b));
    trailer.position.set(0, 1.68, -1.05);
    trailer.castShadow = false;
    root.add(trailer);

    const strip = new THREE.Mesh(boxG(2.3, 0.14, 5.0), kit.makeNeonMaterial(0xf59e0b, 1.5));
    strip.position.set(0, 1.38, -1.05);
    root.add(strip);

    const cab = new THREE.Mesh(boxG(2.2, 2.05, 1.95), bodyMat);
    cab.position.set(0, 1.38, 2.65);
    root.add(cab);

    const windshield = new THREE.Mesh(boxG(1.95, 0.8, 0.14), kit.glassTintedMat);
    windshield.position.set(0, 1.8, 3.6);
    root.add(windshield);

    const hlGeo = boxG(0.36, 0.18, 0.08);
    const hlL = new THREE.Mesh(hlGeo, kit.headLightMat);
    hlL.position.set(-0.78, 0.72, 3.66);
    const hlR = hlL.clone();
    hlR.position.x = 0.78;
    const tlL = new THREE.Mesh(hlGeo, kit.tailLightMat);
    tlL.position.set(-0.82, 0.75, -3.76);
    const tlR = tlL.clone();
    tlR.position.x = 0.82;
    root.add(hlL, hlR, tlL, tlR);

    const wGeo = (tWheelBig ??= new THREE.CylinderGeometry(0.45, 0.45, 0.32, 10));
    for (const z of [-2.8, -1.4, 2.55]) {
      for (const x of [-1.08, 1.08]) {
        const w = new THREE.Mesh(wGeo, kit.tireRubberMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(x, 0.45, z);
        root.add(w);
      }
    }
    return { root, kind, halfWidth: 1.18, halfLength: 3.75 };
  }

  const isSwat = kind === "swat";
  const isSuv = kind === "suv" || isSwat;
  const wScale = isSuv ? 2.05 : 1.9;
  const lenScale = isSuv ? 4.6 : 4.3;

  const shadow = new THREE.Mesh(boxG(wScale + 0.5, 0.01, lenScale + 0.6), kit.contactShadowMat);
  shadow.position.y = 0.025;
  root.add(shadow);

  const lower = new THREE.Mesh(
    boxG(wScale, isSuv ? 0.82 : 0.66, lenScale),
    isSwat ? kit.makePaintMaterial(0x0f172a) : bodyMat
  );
  lower.position.y = isSuv ? 0.66 : 0.55;
  root.add(lower);

  const cabin = new THREE.Mesh(
    boxG(wScale * 0.84, isSuv ? 0.72 : 0.52, lenScale * (isSuv ? 0.62 : 0.52)),
    isSwat ? kit.makePaintMaterial(0xf8fafc) : bodyMat
  );
  cabin.position.set(0, isSuv ? 1.38 : 1.1, isSuv ? -0.15 : -0.18);
  root.add(cabin);

  const glass = new THREE.Mesh(
    boxG(wScale * 0.86, isSuv ? 0.52 : 0.38, lenScale * (isSuv ? 0.56 : 0.48)),
    kit.glassTintedMat
  );
  glass.position.copy(cabin.position);
  root.add(glass);

  if (kind === "coupe") {
    const wing = new THREE.Mesh(boxG(wScale * 0.92, 0.06, 0.26), kit.carbonMat);
    wing.position.set(0, 1.06, -lenScale * 0.45);
    root.add(wing);
  }

  const hlGeo = boxG(0.42, 0.13, 0.08);
  const hlL = new THREE.Mesh(hlGeo, kit.headLightMat);
  hlL.position.set(-wScale * 0.32, 0.58, lenScale * 0.5);
  const hlR = hlL.clone();
  hlR.position.x = wScale * 0.32;
  const tailBar = new THREE.Mesh(boxG(wScale * 0.86, 0.11, 0.08), kit.tailLightMat);
  tailBar.position.set(0, isSuv ? 0.8 : 0.72, -lenScale * 0.5);
  root.add(hlL, hlR, tailBar);

  // Axle-width wheel cylinders (2 draws instead of 4 per vehicle)
  const swGeo = (tWheelSmall ??= new THREE.CylinderGeometry(0.36, 0.36, wScale * 1.04, 10));
  for (const z of [-lenScale * 0.31, lenScale * 0.31]) {
    const axle = new THREE.Mesh(swGeo, kit.tireRubberMat);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.36, z);
    root.add(axle);
  }

  let strobeRed: THREE.Mesh | undefined;
  let strobeBlue: THREE.Mesh | undefined;
  if (isSwat) {
    strobeRed = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.16, 0.28), kit.policeRedMat);
    strobeRed.position.set(-0.38, 1.82, -0.1);
    strobeBlue = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.16, 0.28), kit.policeBlueMat);
    strobeBlue.position.set(0.38, 1.82, -0.1);
    root.add(strobeRed, strobeBlue);
  }

  return {
    root,
    kind,
    halfWidth: wScale * 0.5,
    halfLength: lenScale * 0.5,
    strobeRed,
    strobeBlue,
  };
}

export function buildPursuitHelicopter(kit: MaterialKit): HelicopterVisual {
  const root = new THREE.Group();
  const hullMat = kit.makePaintMaterial(0x0f172a);

  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.1, 6.2), hullMat);
  root.add(fuselage);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.35, 12, 10), kit.glassTintedMat);
  canopy.scale.set(0.9, 0.82, 1.25);
  canopy.position.set(0, 0.05, 2.35);
  root.add(canopy);

  const tailBoom = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 6.5), hullMat);
  tailBoom.position.set(0, 0.35, -5.8);
  root.add(tailBoom);

  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.8, 0.9), hullMat);
  tailFin.position.set(0, 1.15, -8.8);
  root.add(tailFin);

  // Landing skids
  for (const sx of [-1.2, 1.2]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5.2, 8), kit.chromeMat);
    skid.rotation.x = Math.PI / 2;
    skid.position.set(sx, -1.45, 0.3);
    root.add(skid);
  }

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 1.45, 0.2);
  const blade1 = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.06, 0.36), kit.carbonMat);
  const blade2 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 11.5), kit.carbonMat);
  mainRotor.add(blade1, blade2);
  root.add(mainRotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.45, 1.2, -8.8);
  const tBlade1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 0.22), kit.carbonMat);
  const tBlade2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 2.2), kit.carbonMat);
  tailRotor.add(tBlade1, tBlade2);
  root.add(tailRotor);

  const strobeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), kit.policeRedMat);
  strobeLeft.position.set(-1.35, -0.4, 0.5);
  const strobeRight = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), kit.policeBlueMat);
  strobeRight.position.set(1.35, -0.4, 0.5);
  root.add(strobeLeft, strobeRight);

  // Volumetric-style Searchlight Cone pointing down to the road
  const coneGeo = new THREE.ConeGeometry(7.2, 34, 24, 1, true);
  coneGeo.translate(0, -17, 0);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xdcf4ff,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const searchCone = new THREE.Mesh(coneGeo, coneMat);
  searchCone.position.set(0, -1.1, 2.4);
  root.add(searchCone);

  return {
    root,
    mainRotor,
    tailRotor,
    searchCone,
    spotTargetPos: new THREE.Vector3(),
    strobeLeft,
    strobeRight,
  };
}
