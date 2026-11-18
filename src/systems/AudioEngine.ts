export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private timeFilter: BiquadFilterNode | null = null;

  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private nitroGain: GainNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenOsc: OscillatorNode | null = null;

  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicPlaying = false;
  private stageRootHz = 73.42;
  private stageBpm = 142;

  private musicVol = 0.55;
  private sfxVol = 0.85;
  private muted = false;

  public unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
      this.initContinuousSynths();
      this.applyVolumes();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
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

  private initContinuousSynths(): void {
    if (!this.ctx || !this.sfxGain) return;

    // Dual-oscillator superbike inline-4 engine
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 460;

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = "sawtooth";
    this.engineOsc1.frequency.value = 65;

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = "square";
    this.engineOsc2.frequency.value = 130.5;

    this.engineOsc1.connect(engineFilter);
    this.engineOsc2.connect(engineFilter);
    engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxGain);
    this.engineOsc1.start();
    this.engineOsc2.start();

    // Nitro turbine shimmer
    this.nitroGain = this.ctx.createGain();
    this.nitroGain.gain.value = 0;
    if (this.noiseBuf) {
      const nSrc = this.ctx.createBufferSource();
      nSrc.buffer = this.noiseBuf;
      nSrc.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800;
      bp.Q.value = 2.4;
      nSrc.connect(bp);
      bp.connect(this.nitroGain);
      this.nitroGain.connect(this.sfxGain);
      nSrc.start();
    }

    // Interceptor Police Siren
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = "triangle";
    this.sirenOsc.frequency.value = 640;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.sfxGain);
    this.sirenOsc.start();
  }

  public setVolumes(music: number, sfx: number, muted: boolean): void {
    this.musicVol = music;
    this.sfxVol = sfx;
    this.muted = muted;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.masterGain || !this.musicGain || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.03);
    this.musicGain.gain.setTargetAtTime(this.musicVol * 0.42, t, 0.04);
    this.sfxGain.gain.setTargetAtTime(this.sfxVol * 0.65, t, 0.04);
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
      this.timeFilter.frequency.setTargetAtTime(Math.max(950, cutoff), t, 0.05);
    }

    if (this.engineGain && this.engineOsc1 && this.engineOsc2) {
      if (!active) {
        this.engineGain.gain.setTargetAtTime(0, t, 0.08);
      } else {
        // 6-speed gearbox sawtooth pitch curve
        const gearSpan = 42;
        const speedInGear = (speedMph % gearSpan) / gearSpan;
        const baseHz = 54 + speedInGear * 112 + (isNitro ? 34 : 0) - bulletTime * 35;
        this.engineOsc1.frequency.setTargetAtTime(baseHz, t, 0.03);
        this.engineOsc2.frequency.setTargetAtTime(baseHz * 2.01, t, 0.03);
        this.engineGain.gain.setTargetAtTime(0.065 + Math.min(0.08, speedMph * 0.0004), t, 0.04);
      }
    }

    if (this.nitroGain) {
      this.nitroGain.gain.setTargetAtTime(active && isNitro ? 0.14 : 0, t, 0.04);
    }

    if (this.sirenGain && this.sirenOsc) {
      const warble = 620 + Math.sin(t * 7.5) * 210;
      this.sirenOsc.frequency.setTargetAtTime(warble, t, 0.02);
      this.sirenGain.gain.setTargetAtTime(active ? sirenStrength * 0.08 : 0, t, 0.08);
    }
  }

  public startMusic(rootHz: number, bpm: number): void {
    this.stageRootHz = rootHz;
    this.stageBpm = bpm;
    if (this.musicPlaying) return;
    this.musicPlaying = true;
    this.musicStep = 0;

    const tick = () => {
      if (!this.musicPlaying) return;
      this.playMusicStep();
      const stepMs = (60 / this.stageBpm / 4) * 1000;
      this.musicTimer = window.setTimeout(tick, stepMs);
    };
    tick();
  }

  public stopMusic(): void {
    this.musicPlaying = false;
    if (this.musicTimer !== null) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private playMusicStep(): void {
    if (!this.ctx || this.ctx.state !== "running" || !this.musicGain) return;
    const t = this.ctx.currentTime;
    const step = this.musicStep % 16;
    const bar = Math.floor(this.musicStep / 16) % 4;
    this.musicStep++;

    // Kick on 0, 4, 8, 12 (+ push on 14)
    if (step % 4 === 0 || step === 14) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(145, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.11);
      g.gain.setValueAtTime(0.45, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g);
      g.connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.15);
    }

    // Crisp industrial snare on 4 and 12
    if (step === 4 || step === 12) {
      this.triggerNoiseHit(0.11, 2200, 0.25, this.musicGain);
    } else if (step % 2 === 1) {
      // 16th hi-hat drive
      this.triggerNoiseHit(0.03, 7500, 0.08, this.musicGain);
    }

    // Dark cyberpunk octave bassline
    const chordOffsets = [0, 3, -2, -4];
    const semi = chordOffsets[bar];
    const noteHz = this.stageRootHz * Math.pow(2, semi / 12) * (step % 2 === 1 ? 2 : 1);
    const bass = this.ctx.createOscillator();
    const bassF = this.ctx.createBiquadFilter();
    const bassG = this.ctx.createGain();
    bass.type = "sawtooth";
    bass.frequency.setValueAtTime(noteHz, t);
    bassF.type = "lowpass";
    bassF.frequency.setValueAtTime(720, t);
    bassF.frequency.exponentialRampToValueAtTime(190, t + 0.1);
    bassG.gain.setValueAtTime(0.22, t);
    bassG.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    bass.connect(bassF);
    bassF.connect(bassG);
    bassG.connect(this.musicGain);
    bass.start(t);
    bass.stop(t + 0.12);

    // Acid synth stab accents
    if (step === 0 || step === 6 || step === 10 || step === 15) {
      const leadPattern = [0, 7, 10, 12];
      const lSemi = semi + leadPattern[step % leadPattern.length];
      const leadHz = this.stageRootHz * 4 * Math.pow(2, lSemi / 12);
      const lOsc = this.ctx.createOscillator();
      const lG = this.ctx.createGain();
      lOsc.type = "square";
      lOsc.frequency.setValueAtTime(leadHz, t);
      lG.gain.setValueAtTime(0.09, t);
      lG.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      lOsc.connect(lG);
      lG.connect(this.musicGain);
      lOsc.start(t);
      lOsc.stop(t + 0.19);
    }
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
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(620, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.55);
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + 0.62);
    this.triggerNoiseHit(0.28, 2800, 0.35, this.sfxGain);
  }

  public playCrash(): void {
    if (!this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
    this.triggerNoiseHit(0.55, 220, 0.75, this.sfxGain);
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.45);
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + 0.5);
  }

  public playNearMiss(): void {
    if (!this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.16);
    g.gain.setValueAtTime(0.22, t);
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
