export interface RadioStationSpec {
  id: string;
  name: string;
  url: string;
}

export const RADIO_STATIONS: RadioStationSpec[] = [
  { id: "vice", name: "VICE FM // OUTRUN DRIVE", url: "./audio/racer_drive.mp3" },
  { id: "apex", name: "APEX FM // TURBO SYNTH", url: "./audio/night_synth.mp3" },
  { id: "pulse", name: "PULSE FM // HYPER GRID", url: "./audio/hyper_grid.ogg" },
  { id: "coast", name: "COAST FM // SUNSET HIGHWAY", url: "./audio/sunset_outlaw.mp3" },
];

export interface AudioDiagnostics {
  unlocked: boolean;
  state: AudioContextState | "uninitialized";
  stationName: string;
  stationIndex: number;
  musicPlaying: boolean;
  buffersLoaded: number;
}

type SfxBufferKey = "engine" | "wind" | "skid" | "boost" | "impact" | "wreck";

const SFX_URLS: Record<SfxBufferKey, string> = {
  engine: "./audio/engine_loop.ogg",
  wind: "./audio/wind_loop.ogg",
  skid: "./audio/skid_loop.ogg",
  boost: "./audio/boost_whoosh.ogg",
  impact: "./audio/impact_crash.ogg",
  wreck: "./audio/wreck_shatter.ogg",
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private timeFilter: BiquadFilterNode | null = null;

  private radioEl: HTMLAudioElement | null = null;
  private radioSourceConnected = false;
  private stationIndex = 0;
  private userLockedStation = false;

  private engineSubOsc: OscillatorNode | null = null;
  private engineSubGain: GainNode | null = null;
  private engineLoopSrc: AudioBufferSourceNode | null = null;
  private engineLoopGain: GainNode | null = null;
  private windLoopSrc: AudioBufferSourceNode | null = null;
  private windLoopGain: GainNode | null = null;
  private skidLoopSrc: AudioBufferSourceNode | null = null;
  private skidLoopGain: GainNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenOsc1: OscillatorNode | null = null;
  private sirenOsc2: OscillatorNode | null = null;

  private sfxBuffers: Partial<Record<SfxBufferKey, AudioBuffer>> = {};
  private preloadPromise: Promise<void> | null = null;
  private decodeStarted = false;
  private buffersLoaded = 0;
  private noiseBuf: AudioBuffer | null = null;
  private musicPlaying = false;
  private lastNitroActive = false;
  private externalSkidIntensity = 0;

  private musicVol = 0.55;
  private sfxVol = 0.85;
  private muted = false;

  public unlock(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.timeFilter = this.ctx.createBiquadFilter();
      this.timeFilter.type = "lowpass";
      this.timeFilter.frequency.value = 18000;
      this.timeFilter.Q.value = 0.8;

      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();

      this.musicGain.connect(this.timeFilter);
      this.sfxGain.connect(this.timeFilter);
      this.timeFilter.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.buildNoiseBuffer();
      this.initContinuousNodes();
      this.ensureRadioElement();
      this.applyVolumes();
      this.attachPreloadedBuffers();
    } else if (this.ctx && !this.decodeStarted) {
      this.attachPreloadedBuffers();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    if (this.musicPlaying && this.radioEl && this.radioEl.paused) {
      this.radioEl.play().catch(() => {});
    }
  }

  private buildNoiseBuffer(): void {
    if (!this.ctx) return;
    const len = this.ctx.sampleRate * 1.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  private ensureRadioElement(): void {
    if (!this.radioEl) {
      const el = document.createElement("audio");
      el.loop = true;
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      el.src = RADIO_STATIONS[this.stationIndex].url;
      this.radioEl = el;
    }
    if (this.ctx && this.musicGain && this.radioEl && !this.radioSourceConnected) {
      try {
        const srcNode = this.ctx.createMediaElementSource(this.radioEl);
        srcNode.connect(this.musicGain);
        this.radioSourceConnected = true;
      } catch {
        this.radioSourceConnected = false;
      }
    }
  }

  private initContinuousNodes(): void {
    if (!this.ctx || !this.sfxGain) return;

    // Warm sub-octave growl reinforcing the sampled engine loop
    this.engineSubGain = this.ctx.createGain();
    this.engineSubGain.gain.value = 0;
    const subFilter = this.ctx.createBiquadFilter();
    subFilter.type = "lowpass";
    subFilter.frequency.value = 260;
    this.engineSubOsc = this.ctx.createOscillator();
    this.engineSubOsc.type = "sawtooth";
    this.engineSubOsc.frequency.value = 55;
    this.engineSubOsc.connect(subFilter);
    subFilter.connect(this.engineSubGain);
    this.engineSubGain.connect(this.sfxGain);
    this.engineSubOsc.start();

    this.engineLoopGain = this.ctx.createGain();
    this.engineLoopGain.gain.value = 0;
    this.engineLoopGain.connect(this.sfxGain);

    this.windLoopGain = this.ctx.createGain();
    this.windLoopGain.gain.value = 0;
    this.windLoopGain.connect(this.sfxGain);

    this.skidLoopGain = this.ctx.createGain();
    this.skidLoopGain.gain.value = 0;
    this.skidLoopGain.connect(this.sfxGain);

    // Dual-harmonic European/US Interceptor Police Siren
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc1 = this.ctx.createOscillator();
    this.sirenOsc2 = this.ctx.createOscillator();
    this.sirenOsc1.type = "triangle";
    this.sirenOsc2.type = "sine";
    this.sirenOsc1.frequency.value = 660;
    this.sirenOsc2.frequency.value = 792;
    this.sirenOsc1.connect(this.sirenGain);
    this.sirenOsc2.connect(this.sirenGain);
    this.sirenGain.connect(this.sfxGain);
    this.sirenOsc1.start();
    this.sirenOsc2.start();
  }

  public preload(): Promise<void> {
    if (this.preloadPromise) return this.preloadPromise;
    this.preloadPromise = (async () => {
      const OAC =
        window.OfflineAudioContext ||
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
      const decoderCtx: BaseAudioContext | null = this.ctx || (OAC ? new OAC(2, 44100, 44100) : null);
      if (!decoderCtx) return;

      await Promise.all(
        (Object.keys(SFX_URLS) as SfxBufferKey[]).map(async (key) => {
          try {
            const res = await fetch(SFX_URLS[key]);
            if (!res.ok) return;
            const arr = await res.arrayBuffer();
            const decoded = await decoderCtx.decodeAudioData(arr.slice(0));
            if (!this.sfxBuffers[key]) {
              this.sfxBuffers[key] = decoded;
              this.buffersLoaded++;
            }
            if (this.ctx) {
              this.attachContinuousBuffer(key, decoded);
            }
          } catch {
            // Ignore network/decode issues cleanly
          }
        })
      );
    })();
    return this.preloadPromise;
  }

  private attachPreloadedBuffers(): void {
    this.preload();
    if (!this.ctx || this.decodeStarted) return;
    this.decodeStarted = true;
    (Object.keys(this.sfxBuffers) as SfxBufferKey[]).forEach((key) => {
      const buf = this.sfxBuffers[key];
      if (buf) this.attachContinuousBuffer(key, buf);
    });
  }

  private attachContinuousBuffer(key: SfxBufferKey, buffer: AudioBuffer): void {
    if (!this.ctx) return;
    if (key === "engine" && this.engineLoopGain && !this.engineLoopSrc) {
      const s = this.ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.connect(this.engineLoopGain);
      s.start();
      this.engineLoopSrc = s;
    } else if (key === "wind" && this.windLoopGain && !this.windLoopSrc) {
      const s = this.ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.connect(this.windLoopGain);
      s.start();
      this.windLoopSrc = s;
    } else if (key === "skid" && this.skidLoopGain && !this.skidLoopSrc) {
      const s = this.ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.connect(this.skidLoopGain);
      s.start();
      this.skidLoopSrc = s;
    }
  }

  private playOneShotBuffer(key: SfxBufferKey, gainVal: number, rate = 1.0): boolean {
    const buf = this.sfxBuffers[key];
    if (!this.ctx || this.ctx.state !== "running" || !this.sfxGain || !buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gainVal;
    src.connect(g);
    g.connect(this.sfxGain);
    src.start();
    return true;
  }

  public setVolumes(music: number, sfx: number, muted: boolean): void {
    this.musicVol = music;
    this.sfxVol = sfx;
    this.muted = muted;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (this.radioEl) {
      if (this.radioSourceConnected) {
        this.radioEl.volume = 1.0;
      } else {
        this.radioEl.volume = this.muted ? 0 : Math.min(1, this.musicVol * 0.55);
      }
    }
    if (!this.ctx || !this.masterGain || !this.musicGain || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.03);
    this.musicGain.gain.setTargetAtTime(this.musicVol * 0.44, t, 0.05);
    this.sfxGain.gain.setTargetAtTime(this.sfxVol * 0.72, t, 0.04);
  }

  public setSkidIntensity(intensity: number): void {
    this.externalSkidIntensity = Math.max(this.externalSkidIntensity, Math.min(1, intensity));
  }

  public updateTelemetry(
    active: boolean,
    speedMph: number,
    isNitro: boolean,
    sirenStrength: number,
    bulletTime: number
  ): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;

    if (this.timeFilter) {
      const cutoff = 18000 * (1 - bulletTime * 0.88);
      this.timeFilter.frequency.setTargetAtTime(Math.max(920, cutoff), t, 0.05);
    }

    // 6-speed gearbox curve with upshift rev dip
    const gearSpan = 34;
    const gearNum = Math.min(5, Math.floor(speedMph / gearSpan));
    const speedInGear = (speedMph % gearSpan) / gearSpan;
    const rate = 0.78 + gearNum * 0.14 + speedInGear * 0.58 + (isNitro ? 0.25 : 0) - bulletTime * 0.35;

    if (this.engineLoopSrc && this.engineLoopGain) {
      if (!active) {
        this.engineLoopGain.gain.setTargetAtTime(0, t, 0.08);
      } else {
        this.engineLoopSrc.playbackRate.setTargetAtTime(Math.max(0.5, rate), t, 0.035);
        this.engineLoopGain.gain.setTargetAtTime(0.18 + Math.min(0.22, speedMph * 0.0014), t, 0.05);
      }
    }

    if (this.engineSubGain && this.engineSubOsc) {
      if (!active) {
        this.engineSubGain.gain.setTargetAtTime(0, t, 0.08);
      } else {
        const baseHz = 46 + speedInGear * 84 + gearNum * 12 + (isNitro ? 24 : 0) - bulletTime * 24;
        this.engineSubOsc.frequency.setTargetAtTime(baseHz, t, 0.03);
        const subLevel = this.engineLoopSrc ? 0.028 : 0.075;
        this.engineSubGain.gain.setTargetAtTime(subLevel + Math.min(0.05, speedMph * 0.00025), t, 0.05);
      }
    }

    // Aerodynamic wind rush scaling steeply past 65 MPH
    if (this.windLoopGain && this.windLoopSrc) {
      const windLevel = active ? Math.max(0, Math.min(0.24, (speedMph - 55) * 0.0018)) : 0;
      this.windLoopSrc.playbackRate.setTargetAtTime(0.85 + Math.min(0.65, speedMph * 0.003), t, 0.06);
      this.windLoopGain.gain.setTargetAtTime(windLevel, t, 0.07);
    }

    // Trigger real recorded turbo/nitro ignition burst on engagement edge
    if (active && isNitro && !this.lastNitroActive) {
      this.playOneShotBuffer("boost", 0.38, 1.05);
    }
    this.lastNitroActive = active && isNitro;

    // Tire skid loop decays naturally unless driven by braking / car collision lockups
    if (this.skidLoopGain) {
      const targetSkid = active ? this.externalSkidIntensity * 0.28 : 0;
      this.skidLoopGain.gain.setTargetAtTime(targetSkid, t, 0.04);
    }
    this.externalSkidIntensity = Math.max(0, this.externalSkidIntensity - 0.08);

    // Realistic Wail / Yelp Interceptor Siren
    if (this.sirenGain && this.sirenOsc1 && this.sirenOsc2) {
      const wail = 650 + Math.sin(t * 7.2) * 230;
      this.sirenOsc1.frequency.setTargetAtTime(wail, t, 0.02);
      this.sirenOsc2.frequency.setTargetAtTime(wail * 1.24, t, 0.02);
      this.sirenGain.gain.setTargetAtTime(active ? sirenStrength * 0.065 : 0, t, 0.08);
    }
  }

  public startMusic(_rootHz?: number, _bpm?: number, biome?: string): void {
    this.musicPlaying = true;
    this.unlock();
    if (!this.userLockedStation && biome) {
      if (biome === "vice") this.stationIndex = 0;
      else if (biome === "kowloon") this.stationIndex = 1;
      else if (biome === "dubai") this.stationIndex = 2;
      else this.stationIndex = 3;
    }
    this.ensureRadioElement();
    if (this.radioEl) {
      const targetUrl = new URL(RADIO_STATIONS[this.stationIndex].url, window.location.href).href;
      if (this.radioEl.src !== targetUrl) {
        this.radioEl.src = RADIO_STATIONS[this.stationIndex].url;
        this.radioEl.currentTime = 0;
      }
      this.radioEl.play().catch(() => {});
    }
  }

  public stopMusic(): void {
    this.musicPlaying = false;
    if (this.radioEl) {
      this.radioEl.pause();
    }
  }

  public cycleRadioStation(): string {
    this.userLockedStation = true;
    this.stationIndex = (this.stationIndex + 1) % RADIO_STATIONS.length;
    this.unlock();
    this.ensureRadioElement();
    if (this.radioEl) {
      this.radioEl.src = RADIO_STATIONS[this.stationIndex].url;
      this.radioEl.currentTime = 0;
      if (this.musicPlaying) {
        this.radioEl.play().catch(() => {});
      }
    }
    return RADIO_STATIONS[this.stationIndex].name;
  }

  public getStationName(): string {
    return RADIO_STATIONS[this.stationIndex].name;
  }

  public getDiagnostics(): AudioDiagnostics {
    return {
      unlocked: Boolean(this.ctx),
      state: this.ctx ? this.ctx.state : "uninitialized",
      stationName: RADIO_STATIONS[this.stationIndex].name,
      stationIndex: this.stationIndex,
      musicPlaying: this.musicPlaying,
      buffersLoaded: this.buffersLoaded,
    };
  }

  private triggerNoiseHit(dur: number, hpFreq: number, gain: number, dest: AudioNode): void {
    if (!this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hpFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + dur);
  }

  public playStrike(heavy = false): void {
    if (!this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
    if (this.playOneShotBuffer("impact", heavy ? 0.58 : 0.36, heavy ? 0.92 : 1.15)) {
      return;
    }
    const t = this.ctx.currentTime;
    this.triggerNoiseHit(0.09, heavy ? 600 : 1200, heavy ? 0.5 : 0.35, this.sfxGain);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(heavy ? 240 : 340, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    g.gain.setValueAtTime(heavy ? 0.5 : 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + 0.15);
  }

  public playEmpBlast(): void {
    if (!this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
    this.playOneShotBuffer("boost", 0.55, 0.72);
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.55);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + 0.62);
  }

  public playCrash(heavy = true): void {
    if (!this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
    const playedWreck = heavy && this.playOneShotBuffer("wreck", 0.68, 0.95);
    const playedImpact = this.playOneShotBuffer("impact", 0.72, 0.85);
    if (!playedWreck && !playedImpact) {
      this.triggerNoiseHit(0.55, 220, 0.75, this.sfxGain);
    }
    // Deep chassis sub-thump underneath recorded sheet-metal crunch
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.42);
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + 0.48);
  }

  public playCarHorn(dopplerPitch = 1.0): void {
    if (!this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    for (const freq of [392, 494]) {
      const o = this.ctx.createOscillator();
      const f = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(freq * dopplerPitch, t);
      o.frequency.exponentialRampToValueAtTime(freq * dopplerPitch * 0.88, t + 0.36);
      f.type = "bandpass";
      f.frequency.value = 1150;
      f.Q.value = 1.4;
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      o.connect(f);
      f.connect(g);
      g.connect(this.sfxGain);
      o.start(t);
      o.stop(t + 0.4);
    }
  }

  public playNearMiss(): void {
    if (!this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
    this.playOneShotBuffer("wind", 0.24, 1.55);
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(480, t);
    o.frequency.exponentialRampToValueAtTime(210, t + 0.16);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + 0.19);
  }

  public playTone(freq: number, dur = 0.12, gainVal = 0.25): void {
    if (!this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
