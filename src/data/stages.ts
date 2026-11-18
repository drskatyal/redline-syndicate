export type StageId = "vice" | "kowloon" | "dubai" | "alpine" | "sanverona";

export interface StageSpec {
  id: StageId;
  order: number;
  name: string;
  region: string;
  subtitle: string;
  description: string;
  lengthMeters: number;
  difficulty: number;
  prizes: [number, number, number];
  trafficDensity: number;
  copThresholdMeters: number;
  wetness: number; // 0..1 mirror puddle factor on asphalt
  hasRain: boolean;
  hasHelicopter: boolean;
  skyTopHex: number;
  skyHorizonHex: number;
  fogHex: number;
  fogDensity: number;
  sunHex: number;
  sunIntensity: number;
  ambientHex: number;
  ambientIntensity: number;
  groundHex: number;
  shoulderHex: number;
  accentNeonHex: number;
  isNight: boolean;
  curveScale: number;
  hillScale: number;
  rampCount: number;
  biome: StageId;
  bossId: "vance" | "kira" | "rostova" | "cross";
  bannerImg: string;
  musicRootHz: number;
  musicBpm: number;
}

export const STAGES: StageSpec[] = [
  {
    id: "vice",
    order: 1,
    name: "VICE BAY INTERSTATE",
    region: "MIAMI COASTAL GRID // USA",
    subtitle: "DISTRICT 01 // NEON MONSOON",
    description: "Mirror-wet waterfront tarmac lit by magenta high-rises, palm avenues, and twin tail-light wakes.",
    lengthMeters: 4400,
    difficulty: 1,
    prizes: [2200, 1300, 750],
    trafficDensity: 10,
    copThresholdMeters: 1200,
    wetness: 0.9,
    hasRain: true,
    hasHelicopter: false,
    skyTopHex: 0x0b102b,
    skyHorizonHex: 0xf43f7d,
    fogHex: 0x3b1d4a,
    fogDensity: 0.0017,
    sunHex: 0xff85c0,
    sunIntensity: 1.45,
    ambientHex: 0x7090e8,
    ambientIntensity: 0.85,
    groundHex: 0x151828,
    shoulderHex: 0x26293d,
    accentNeonHex: 0xff2a85,
    isNight: true,
    curveScale: 1.05,
    hillScale: 0.85,
    rampCount: 5,
    biome: "vice",
    bossId: "vance",
    bannerImg: "./art/district-vice.jpg",
    musicRootHz: 73.42, // D2
    musicBpm: 142,
  },
  {
    id: "kowloon",
    order: 2,
    name: "NEO-KOWLOON SKYDECK",
    region: "UPPER ELEVATED RING // EAST ASIA",
    subtitle: "DISTRICT 02 // VERTICAL MEGACITY",
    description: "Elevated double-deck highway threading illuminated glass canyons, holograms, and overhead laser arches.",
    lengthMeters: 5200,
    difficulty: 2,
    prizes: [3800, 2200, 1200],
    trafficDensity: 12,
    copThresholdMeters: 1050,
    wetness: 0.82,
    hasRain: true,
    hasHelicopter: true,
    skyTopHex: 0x050919,
    skyHorizonHex: 0x164e63,
    fogHex: 0x0d2136,
    fogDensity: 0.002,
    sunHex: 0x38bdf8,
    sunIntensity: 1.35,
    ambientHex: 0x60a5fa,
    ambientIntensity: 0.85,
    groundHex: 0x0f172a,
    shoulderHex: 0x1e293b,
    accentNeonHex: 0x00f0ff,
    isNight: true,
    curveScale: 1.3,
    hillScale: 0.9,
    rampCount: 6,
    biome: "kowloon",
    bossId: "kira",
    bannerImg: "./art/district-kowloon.jpg",
    musicRootHz: 82.41, // E2
    musicBpm: 145,
  },
  {
    id: "dubai",
    order: 3,
    name: "AL-MIRAGE HYPERWAY",
    region: "SOLAR ARCOLOGY CORRIDOR // GULF",
    subtitle: "DISTRICT 03 // GOLDEN HEAT",
    description: "Razor-sharp sunset shadows across six lanes of crimson dunes, glass needles, and 240 MPH slipstreams.",
    lengthMeters: 6000,
    difficulty: 3,
    prizes: [5800, 3400, 1900],
    trafficDensity: 13,
    copThresholdMeters: 950,
    wetness: 0.14,
    hasRain: false,
    hasHelicopter: false,
    skyTopHex: 0x1d2b57,
    skyHorizonHex: 0xff7a2f,
    fogHex: 0xb95f3c,
    fogDensity: 0.00145,
    sunHex: 0xffbf70,
    sunIntensity: 3.15,
    ambientHex: 0xf7b98f,
    ambientIntensity: 1.15,
    groundHex: 0x875436,
    shoulderHex: 0xb3744b,
    accentNeonHex: 0xf59e0b,
    isNight: false,
    curveScale: 1.4,
    hillScale: 1.15,
    rampCount: 8,
    biome: "dubai",
    bossId: "vance",
    bannerImg: "./art/district-dubai.jpg",
    musicRootHz: 65.41, // C2
    musicBpm: 146,
  },
  {
    id: "alpine",
    order: 4,
    name: "KRONOS GLACIER VIADUCT",
    region: "SWISS REACTOR PASS // EUROPE",
    subtitle: "DISTRICT 04 // ZERO KELVIN",
    description: "Sub-zero suspension bridges over snow peaks with blistering jump crests and ice-glaze braking zones.",
    lengthMeters: 6600,
    difficulty: 4,
    prizes: [8200, 4900, 2700],
    trafficDensity: 14,
    copThresholdMeters: 850,
    wetness: 0.5,
    hasRain: false,
    hasHelicopter: true,
    skyTopHex: 0x0e2a5c,
    skyHorizonHex: 0x99d6ff,
    fogHex: 0x628eb8,
    fogDensity: 0.00155,
    sunHex: 0xeaf6ff,
    sunIntensity: 2.9,
    ambientHex: 0xb4dcff,
    ambientIntensity: 1.15,
    groundHex: 0xcbe2f5,
    shoulderHex: 0x5c6b7a,
    accentNeonHex: 0x38bdf8,
    isNight: false,
    curveScale: 1.55,
    hillScale: 1.75,
    rampCount: 10,
    biome: "alpine",
    bossId: "rostova",
    bannerImg: "./art/district-alpine.jpg",
    musicRootHz: 87.31, // F2
    musicBpm: 148,
  },
  {
    id: "sanverona",
    order: 5,
    name: "SAN VERONA LOCKDOWN",
    region: "APEX SECTOR ZERO // FINALE",
    subtitle: "DISTRICT 05 // 5-STAR CHOPPER HUNT",
    description: "Total city blackout under Apex Helicopter searchlights, armored SWAT roadblocks, and rival bosses.",
    lengthMeters: 7600,
    difficulty: 5,
    prizes: [14000, 8000, 4400],
    trafficDensity: 15,
    copThresholdMeters: 500,
    wetness: 0.88,
    hasRain: true,
    hasHelicopter: true,
    skyTopHex: 0x04050f,
    skyHorizonHex: 0x31102f,
    fogHex: 0x100b24,
    fogDensity: 0.0019,
    sunHex: 0xa5b4fc,
    sunIntensity: 1.7,
    ambientHex: 0x6366f1,
    ambientIntensity: 0.95,
    groundHex: 0x11131e,
    shoulderHex: 0x1e2030,
    accentNeonHex: 0xef4444,
    isNight: true,
    curveScale: 1.65,
    hillScale: 1.35,
    rampCount: 9,
    biome: "sanverona",
    bossId: "cross",
    bannerImg: "./art/hero-keyart.jpg",
    musicRootHz: 61.74, // B1
    musicBpm: 152,
  },
];

export function getStageById(id: StageId): StageSpec {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}
