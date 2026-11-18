import { UpgradeKey } from "../data/bikes";
import { StageId } from "../data/stages";

const STORAGE_KEY = "redline_syndicate_save_v1";

export type QualityPreset = "ultra" | "high" | "perf";

export interface SaveData {
  cash: number;
  rep: number;
  ownedBikes: string[];
  selectedBikeId: string;
  selectedStageId: StageId;
  customPrimaryHex: number | null;
  customAccentHex: number | null;
  upgrades: Record<UpgradeKey, number>;
  bestRanks: Partial<Record<StageId, number>>;
  totalKnockouts: number;
  totalWins: number;
  settings: {
    musicVolume: number;
    sfxVolume: number;
    muted: boolean;
    quality: QualityPreset;
    cameraMode: number;
    touchControls: "auto" | "on" | "off";
  };
}

export function createDefaultSave(): SaveData {
  return {
    cash: 2500,
    rep: 0,
    ownedBikes: ["vx_450"],
    selectedBikeId: "vx_450",
    selectedStageId: "vice",
    customPrimaryHex: null,
    customAccentHex: null,
    upgrades: { turbine: 0, grip: 0, chassis: 0, capacitor: 0 },
    bestRanks: {},
    totalKnockouts: 0,
    totalWins: 0,
    settings: {
      musicVolume: 0.55,
      sfxVolume: 0.85,
      muted: false,
      quality: "ultra",
      cameraMode: 0,
      touchControls: "auto",
    },
  };
}

export function loadSave(): SaveData {
  const def = createDefaultSave();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      ...def,
      ...parsed,
      ownedBikes: Array.isArray(parsed.ownedBikes) && parsed.ownedBikes.length ? parsed.ownedBikes : def.ownedBikes,
      upgrades: { ...def.upgrades, ...(parsed.upgrades || {}) },
      bestRanks: { ...def.bestRanks, ...(parsed.bestRanks || {}) },
      settings: { ...def.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return def;
  }
}

export function persistSave(data: SaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
}
