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
    name: "PACIFIC COAST BEACH HWY",
    region: "MALIBU OCEANFRONT // PACIFIC",
    subtitle: "ROUTE 01 // SUNLIT COASTAL BEACH",
    description: "Four-lane oceanside asphalt carving past palm-lined sandy beaches, rolling surf, and sunny beachfront condos.",
    lengthMeters: 4400,
    difficulty: 1,
    prizes: [2200, 1300, 750],
    trafficDensity: 9,
    copThresholdMeters: 1200,
    wetness: 0.05,
    hasRain: false,
    hasHelicopter: false,
    skyTopHex: 0x3b82f6,
    skyHorizonHex: 0xbae6fd,
    fogHex: 0xaad4f0,
    fogDensity: 0.00055,
    sunHex: 0xfff5e0,
    sunIntensity: 2.6,
    ambientHex: 0xdbeafe,
    ambientIntensity: 1.15,
    groundHex: 0xe6d3b3,
    shoulderHex: 0xdcc5a0,
    accentNeonHex: 0xf59e0b,
    isNight: false,
    curveScale: 1.05,
    hillScale: 0.75,
    rampCount: 2,
    biome: "vice",
    bossId: "vance",
    bannerImg: "./art/district-vice.jpg",
    musicRootHz: 73.42, // D2
    musicBpm: 142,
  },
  {
    id: "kowloon",
    order: 2,
    name: "BAYFRONT METRO EXPRESSWAY",
    region: "DOWNTOWN FINANCIAL DISTRICT",
    subtitle: "ROUTE 02 // CITY RUSH HOUR",
    description: "Sunlit elevated freeway threading downtown glass towers, highway overpasses, and dense commuter traffic.",
    lengthMeters: 5200,
    difficulty: 2,
    prizes: [3800, 2200, 1200],
    trafficDensity: 11,
    copThresholdMeters: 1050,
    wetness: 0.08,
    hasRain: false,
    hasHelicopter: true,
    skyTopHex: 0x2563eb,
    skyHorizonHex: 0xbfdbfe,
    fogHex: 0x9fc2de,
    fogDensity: 0.00068,
    sunHex: 0xfff2dc,
    sunIntensity: 2.55,
    ambientHex: 0xdbeafe,
    ambientIntensity: 1.12,
    groundHex: 0x282d36,
    shoulderHex: 0x3f4654,
    accentNeonHex: 0x38bdf8,
    isNight: false,
    curveScale: 1.25,
    hillScale: 0.85,
    rampCount: 2,
    biome: "kowloon",
    bossId: "kira",
    bannerImg: "./art/district-kowloon.jpg",
    musicRootHz: 82.41, // E2
    musicBpm: 145,
  },
  {
    id: "dubai",
    order: 3,
    name: "RED ROCK CANYON INTERSTATE",
    region: "COASTAL CLIFFS & DESERT",
    subtitle: "ROUTE 03 // GOLDEN SUNSET",
    description: "Warm golden-hour asphalt sweeping past terracotta desert bluffs, highway viaducts, and 220 MPH slipstreams.",
    lengthMeters: 6000,
    difficulty: 3,
    prizes: [5800, 3400, 1900],
    trafficDensity: 12,
    copThresholdMeters: 950,
    wetness: 0.04,
    hasRain: false,
    hasHelicopter: false,
    skyTopHex: 0x1d2b57,
    skyHorizonHex: 0xff7a2f,
    fogHex: 0xb95f3c,
    fogDensity: 0.0008,
    sunHex: 0xffbf70,
    sunIntensity: 2.95,
    ambientHex: 0xf7b98f,
    ambientIntensity: 1.15,
    groundHex: 0x875436,
    shoulderHex: 0xb3744b,
    accentNeonHex: 0xf59e0b,
    isNight: false,
    curveScale: 1.35,
    hillScale: 1.05,
    rampCount: 3,
    biome: "dubai",
    bossId: "vance",
    bannerImg: "./art/district-dubai.jpg",
    musicRootHz: 65.41, // C2
    musicBpm: 146,
  },
  {
    id: "alpine",
    order: 4,
    name: "SIERRA SUMMIT VIADUCT",
    region: "HIGH MOUNTAIN PASS // ALPINE",
    subtitle: "ROUTE 04 // ALPINE SWITCHBACKS",
    description: "Crisp morning bridges winding through granite ridges with high-speed crests and tight braking hairpins.",
    lengthMeters: 6600,
    difficulty: 4,
    prizes: [8200, 4900, 2700],
    trafficDensity: 13,
    copThresholdMeters: 850,
    wetness: 0.22,
    hasRain: false,
    hasHelicopter: true,
    skyTopHex: 0x0e2a5c,
    skyHorizonHex: 0x99d6ff,
    fogHex: 0x769bbd,
    fogDensity: 0.00085,
    sunHex: 0xeaf6ff,
    sunIntensity: 2.75,
    ambientHex: 0xb4dcff,
    ambientIntensity: 1.15,
    groundHex: 0x8ea0b2,
    shoulderHex: 0x5c6b7a,
    accentNeonHex: 0x38bdf8,
    isNight: false,
    curveScale: 1.5,
    hillScale: 1.65,
    rampCount: 3,
    biome: "alpine",
    bossId: "rostova",
    bannerImg: "./art/district-alpine.jpg",
    musicRootHz: 87.31, // F2
    musicBpm: 148,
  },
  {
    id: "sanverona",
    order: 5,
    name: "HARBOR NIGHT FREEWAY",
    region: "METRO INTERSTATE NIGHT // FINALE",
    subtitle: "ROUTE 05 // CHOPPER PURSUIT",
    description: "Rain-slicked midnight interstate lit by sodium streetlamps, squad car lightbars, and the police chopper spotlight.",
    lengthMeters: 7600,
    difficulty: 5,
    prizes: [14000, 8000, 4400],
    trafficDensity: 14,
    copThresholdMeters: 500,
    wetness: 0.78,
    hasRain: true,
    hasHelicopter: true,
    skyTopHex: 0x050814,
    skyHorizonHex: 0x1e293b,
    fogHex: 0x0c1322,
    fogDensity: 0.0011,
    sunHex: 0xa5b4fc,
    sunIntensity: 1.65,
    ambientHex: 0x64748b,
    ambientIntensity: 0.9,
    groundHex: 0x11131e,
    shoulderHex: 0x1e2030,
    accentNeonHex: 0xef4444,
    isNight: true,
    curveScale: 1.6,
    hillScale: 1.25,
    rampCount: 3,
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
