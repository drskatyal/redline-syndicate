import * as THREE from "three";

import { AudioDiagnostics } from "./AudioEngine";

export interface GameDiagnosticsSnapshot {
  title: string;
  state: string;
  fps: number;
  quality: string;
  stageId: string;
  speedMph: number;
  distanceMeters: number;
  laneOffset: number;
  playerScreenXPct: number;
  rank: number;
  wantedHeat: number;
  stamina: number;
  armor: number;
  cash: number;
  ragdollActive?: boolean;
  overlappingTrafficPairs?: number;
  bannerText?: string;
  activeTrafficKinds?: string[];
  audioDiagnostics?: AudioDiagnostics;
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    pixelRatio: number;
  };
}

declare global {
  interface Window {
    __THREE_GAME_DIAGNOSTICS__?: GameDiagnosticsSnapshot;
    __GAME_DEBUG__?: {
      startRace: (stageId?: string, skipCountdown?: boolean) => void;
      openGarage: () => void;
      openDistricts: () => void;
      setQuality: (q: "ultra" | "high" | "perf") => void;
      setBotInput: (intent: Record<string, unknown> | null) => void;
      setPlayerTrackS: (s: number, laneOffset?: number, speedMph?: number) => void;
      triggerHeliView: () => void;
      addCash: (amount: number) => void;
      setCameraMode?: (mode: number) => void;
      cycleRadioStation?: () => string;
      forceCarCrashTest?: () => void;
    };
  }
}

export class QualityDiagnostics {
  private frames = 0;
  private accum = 0;
  private currentFps = 60;

  public update(
    dtRaw: number,
    renderer: THREE.WebGLRenderer,
    fields: Omit<GameDiagnosticsSnapshot, "fps" | "renderer">
  ): void {
    this.frames++;
    this.accum += dtRaw;
    if (this.accum >= 0.5) {
      this.currentFps = Math.round(this.frames / this.accum);
      this.frames = 0;
      this.accum = 0;
    }

    window.__THREE_GAME_DIAGNOSTICS__ = {
      ...fields,
      fps: this.currentFps,
      renderer: {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        pixelRatio: renderer.getPixelRatio(),
      },
    };
  }
}
