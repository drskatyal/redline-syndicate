export type BikeClass = "STREET" | "SPEC-R" | "HYPER";

export interface BikeSpec {
  id: string;
  name: string;
  bikeClass: BikeClass;
  price: number;
  topSpeedMph: number;
  accel: number;
  handling: number;
  armor: number;
  nitroCapacity: number;
  primaryHex: number;
  secondaryHex: number;
  accentHex: number;
  tagline: string;
}

export const BIKES: BikeSpec[] = [
  {
    id: "vx_450",
    name: "Kurokawa VX-450",
    bikeClass: "STREET",
    price: 0,
    topSpeedMph: 168,
    accel: 22.5,
    handling: 1.12,
    armor: 105,
    nitroCapacity: 100,
    primaryHex: 0xe11d48,
    secondaryHex: 0x141824,
    accentHex: 0xf59e0b,
    tagline: "Stripped twin-spar streetfighter engineered for tight urban lane-splits and close-quarters strikes.",
  },
  {
    id: "goliath_800",
    name: "Goliath Enforcer 800",
    bikeClass: "STREET",
    price: 3200,
    topSpeedMph: 184,
    accel: 25.5,
    handling: 1.06,
    armor: 145,
    nitroCapacity: 115,
    primaryHex: 0x1d4ed8,
    secondaryHex: 0x111827,
    accentHex: 0x38bdf8,
    tagline: "Heavy ballistic-cowl muscle bike built to punt SWAT cruisers and syndicate brutes off the deck.",
  },
  {
    id: "shinobi_900",
    name: "Shinobi R-900 Track",
    bikeClass: "SPEC-R",
    price: 7200,
    topSpeedMph: 204,
    accel: 29.0,
    handling: 1.24,
    armor: 130,
    nitroCapacity: 130,
    primaryHex: 0xf59e0b,
    secondaryHex: 0x18181b,
    accentHex: 0xff2a85,
    tagline: "Carbon winglets and active damper geometry tuned for 200 MPH knee-down switchbacks.",
  },
  {
    id: "valkyrie_tt",
    name: "Valkyrie Twin-Turbo",
    bikeClass: "SPEC-R",
    price: 12500,
    topSpeedMph: 222,
    accel: 33.5,
    handling: 1.28,
    armor: 140,
    nitroCapacity: 148,
    primaryHex: 0x10b981,
    secondaryHex: 0x0f172a,
    accentHex: 0xa3e635,
    tagline: "Boosted titanium exhausts spit blue afterburner shockwaves whenever the slipstream opens.",
  },
  {
    id: "spectre_m1",
    name: "Spectre M1-Carbon",
    bikeClass: "HYPER",
    price: 19500,
    topSpeedMph: 242,
    accel: 37.5,
    handling: 1.34,
    armor: 160,
    nitroCapacity: 165,
    primaryHex: 0x991b1b,
    secondaryHex: 0x090b10,
    accentHex: 0xfacc15,
    tagline: "Clearcoat crimson weave atop a monocoque super-chassis built for San Verona lockdowns.",
  },
  {
    id: "zero_x",
    name: "Aethelgard ZERO-X",
    bikeClass: "HYPER",
    price: 30000,
    topSpeedMph: 266,
    accel: 42.0,
    handling: 1.4,
    armor: 180,
    nitroCapacity: 190,
    primaryHex: 0x1e293b,
    secondaryHex: 0x05070c,
    accentHex: 0x00f0ff,
    tagline: "Supercharged 1000cc inline-four built for 260 MPH coastal freeway runs.",
  },
];

export type UpgradeKey = "turbine" | "grip" | "chassis" | "capacitor";

export interface UpgradeDef {
  key: UpgradeKey;
  label: string;
  desc: string;
  costs: [number, number, number, number];
}

export const UPGRADES: UpgradeDef[] = [
  { key: "turbine", label: "ECU Tune & Titanium Exhaust", desc: "+7% top speed & mid-range pull per stage", costs: [1100, 2600, 5200, 9200] },
  { key: "grip", label: "Pirelli Diablo Sport Tires", desc: "+9% lean grip & wet pavement traction per stage", costs: [950, 2200, 4400, 7800] },
  { key: "chassis", label: "Reinforced Frame Sliders", desc: "+16 crash durability & side-swipe stability per stage", costs: [1000, 2400, 4700, 8200] },
  { key: "capacitor", label: "Dual-Stage N2O Bottle", desc: "+22% Nitro & Reflex capacity + faster refill", costs: [1200, 2800, 5600, 9600] },
];

export const PAINT_SWATCHES = [
  { name: "Crimson Gloss", hex: 0xe11d48 },
  { name: "Obsidian Matte", hex: 0x1e293b },
  { name: "Cobalt Metallic", hex: 0x1d4ed8 },
  { name: "Solar Gold", hex: 0xf59e0b },
  { name: "Venom Emerald", hex: 0x10b981 },
  { name: "Glacier White", hex: 0xe2e8f0 },
  { name: "Ultraviolet", hex: 0x7c3aed },
];

export const NEON_SWATCHES = [
  { name: "Cyber Cyan", hex: 0x00f0ff },
  { name: "Hot Magenta", hex: 0xff2a85 },
  { name: "Amber Blaze", hex: 0xffaa00 },
  { name: "Volt Lime", hex: 0xa3e635 },
  { name: "Inferno Red", hex: 0xff3b30 },
];

export function getBikeById(id: string): BikeSpec {
  return BIKES.find((b) => b.id === id) || BIKES[0];
}
