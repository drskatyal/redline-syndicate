import { BIKES, getBikeById, NEON_SWATCHES, PAINT_SWATCHES, UPGRADES } from "../data/bikes";
import { STAGES } from "../data/stages";
import { WEAPONS } from "../data/weapons";
import { GameEngine, UiSnapshot } from "../game/GameEngine";

export class HudController {
  private engine: GameEngine;
  private hangarTab: "bikes" | "tuning" | "livery" = "bikes";
  private lastScreen = "";

  private menuTopBar = document.getElementById("menuTopBar")!;
  private topCash = document.getElementById("topCash")!;
  private topRep = document.getElementById("topRep")!;
  private topKo = document.getElementById("topKo")!;
  private qualitySelect = document.getElementById("qualitySelect") as HTMLSelectElement;
  private muteBtn = document.getElementById("muteBtn")!;

  private hubScreen = document.getElementById("hubScreen")!;
  private activeContractCard = document.getElementById("activeContractCard")!;
  private districtsScreen = document.getElementById("districtsScreen")!;
  private districtsGrid = document.getElementById("districtsGrid")!;
  private hangarScreen = document.getElementById("hangarScreen")!;
  private hangarContent = document.getElementById("hangarContent")!;

  private raceHud = document.getElementById("raceHud")!;
  private radarCanvas = document.getElementById("radarCanvas") as HTMLCanvasElement;
  private radarCtx = this.radarCanvas.getContext("2d")!;
  private hudRank = document.getElementById("hudRank")!;
  private hudProgressBar = document.getElementById("hudProgressBar")!;
  private hudDistPct = document.getElementById("hudDistPct")!;
  private commsToast = document.getElementById("commsToast")!;
  private commsPortrait = document.getElementById("commsPortrait") as HTMLImageElement;
  private commsName = document.getElementById("commsName")!;
  private commsText = document.getElementById("commsText")!;
  private hudBanner = document.getElementById("hudBanner")!;
  private hudHeatStars = document.getElementById("hudHeatStars")!;
  private hudMulti = document.getElementById("hudMulti")!;
  private hudCash = document.getElementById("hudCash")!;
  private countdownOverlay = document.getElementById("countdownOverlay")!;

  private barStamina = document.getElementById("barStamina")!;
  private barArmor = document.getElementById("barArmor")!;
  private barNitro = document.getElementById("barNitro")!;
  private barFocus = document.getElementById("barFocus")!;
  private barEmp = document.getElementById("barEmp")!;
  private hudWeapon = document.getElementById("hudWeapon")!;
  private hudGear = document.getElementById("hudGear")!;
  private hudSpeed = document.getElementById("hudSpeed")!;
  private hudRpm = document.getElementById("hudRpm")!;
  private touchLayer = document.getElementById("touchLayer")!;

  private pauseModal = document.getElementById("pauseModal")!;
  private modalQuality = document.getElementById("modalQuality") as HTMLSelectElement;
  private musicRange = document.getElementById("musicRange") as HTMLInputElement;
  private sfxRange = document.getElementById("sfxRange") as HTMLInputElement;

  private resultsScreen = document.getElementById("resultsScreen")!;
  private resEyebrow = document.getElementById("resEyebrow")!;
  private resTitle = document.getElementById("resTitle")!;
  private resBossImg = document.getElementById("resBossImg") as HTMLImageElement;
  private resBossName = document.getElementById("resBossName")!;
  private resBossQuote = document.getElementById("resBossQuote")!;
  private resStatsGrid = document.getElementById("resStatsGrid")!;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.wireEvents();
  }

  private wireEvents(): void {
    document.getElementById("btnDeploy")!.addEventListener("click", () => this.engine.startRace());
    document.getElementById("btnDistricts")!.addEventListener("click", () => this.engine.setScreen("districts"));
    document.getElementById("btnHangar")!.addEventListener("click", () => {
      this.renderHangarPanel();
      this.engine.setScreen("hangar");
    });
    document.getElementById("btnSettings")!.addEventListener("click", () => {
      this.pauseModal.hidden = false;
    });

    document.getElementById("btnDistrictsBack")!.addEventListener("click", () => this.engine.setScreen("hub"));
    document.getElementById("btnHangarBack")!.addEventListener("click", () => this.engine.setScreen("hub"));

    this.qualitySelect.addEventListener("change", () => {
      this.engine.setQualityPreset(this.qualitySelect.value as never);
    });
    this.modalQuality.addEventListener("change", () => {
      this.engine.setQualityPreset(this.modalQuality.value as never);
    });
    this.muteBtn.addEventListener("click", () => {
      const s = this.engine.save.settings;
      this.engine.updateAudioSettings(s.musicVolume, s.sfxVolume, !s.muted);
    });
    this.musicRange.addEventListener("input", () => {
      const s = this.engine.save.settings;
      this.engine.updateAudioSettings(Number(this.musicRange.value), s.sfxVolume, s.muted);
    });
    this.sfxRange.addEventListener("input", () => {
      const s = this.engine.save.settings;
      this.engine.updateAudioSettings(s.musicVolume, Number(this.sfxRange.value), s.muted);
    });

    document.getElementById("hudCamBtn")!.addEventListener("click", () => {
      this.engine.save.settings.cameraMode = (this.engine.save.settings.cameraMode + 1) % 3;
    });
    document.getElementById("hudPauseBtn")!.addEventListener("click", () => this.engine.togglePause());
    document.getElementById("btnResume")!.addEventListener("click", () => {
      this.pauseModal.hidden = true;
      this.engine.resumeRace();
    });
    document.getElementById("btnRestart")!.addEventListener("click", () => {
      this.pauseModal.hidden = true;
      this.engine.startRace();
    });
    document.getElementById("btnQuitHub")!.addEventListener("click", () => {
      this.pauseModal.hidden = true;
      this.engine.setScreen("hub");
    });

    document.getElementById("btnResNext")!.addEventListener("click", () => this.engine.startRace());
    document.getElementById("btnResHangar")!.addEventListener("click", () => {
      this.renderHangarPanel();
      this.engine.setScreen("hangar");
    });
    document.getElementById("btnResHub")!.addEventListener("click", () => this.engine.setScreen("hub"));

    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.hangarTab = (btn as HTMLElement).dataset.tab as "bikes" | "tuning" | "livery";
        this.renderHangarPanel();
      });
    });

    // Orbit drag in Hangar
    let dragging = false;
    let lastX = 0;
    const canvas = document.getElementById("gameCanvas")!;
    canvas.addEventListener("pointerdown", (e) => {
      if (this.engine.screen === "hangar" || this.engine.screen === "hub") {
        dragging = true;
        lastX = e.clientX;
      }
      this.engine.audio.unlock();
    });
    window.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      this.engine.orbitHangar(e.clientX - lastX);
      lastX = e.clientX;
    });
    window.addEventListener("pointerup", () => {
      dragging = false;
    });

    // Touch Controls
    const unlock = () => this.engine.audio.unlock();
    this.engine.input.bindTouchButton(document.getElementById("tLeft"), "left", unlock);
    this.engine.input.bindTouchButton(document.getElementById("tRight"), "right", unlock);
    this.engine.input.bindTouchButton(document.getElementById("tGas"), "throttle", unlock);
    this.engine.input.bindTouchButton(document.getElementById("tBrake"), "brake", unlock);
    this.engine.input.bindTouchButton(document.getElementById("tNitro"), "nitro", unlock);
    this.engine.input.bindTouchButton(document.getElementById("tFocus"), "bulletTime", unlock);
    this.engine.input.bindTouchButton(document.getElementById("tStrike"), "strike", unlock);
    this.engine.input.bindTouchButton(document.getElementById("tKick"), "kick", unlock);
    this.engine.input.bindTouchButton(document.getElementById("tEmp"), "emp", unlock);
  }

  public render(snap: UiSnapshot): void {
    const { save, stage } = snap;
    const showMenuBar = snap.screen === "hub" || snap.screen === "districts" || snap.screen === "hangar";
    this.menuTopBar.hidden = !showMenuBar;
    this.hubScreen.hidden = snap.screen !== "hub";
    this.districtsScreen.hidden = snap.screen !== "districts";
    this.hangarScreen.hidden = snap.screen !== "hangar";
    this.raceHud.hidden = snap.screen !== "racing" && snap.screen !== "paused";
    if (snap.screen !== "hub") {
      this.pauseModal.hidden = snap.screen !== "paused";
    }
    this.resultsScreen.hidden = snap.screen !== "results";

    this.topCash.textContent = `$${save.cash.toLocaleString()}`;
    this.topRep.textContent = save.rep.toLocaleString();
    this.topKo.textContent = String(save.totalKnockouts);
    this.qualitySelect.value = save.settings.quality;
    this.modalQuality.value = save.settings.quality;
    this.muteBtn.textContent = save.settings.muted ? "🔇" : "🔊";
    this.musicRange.value = String(save.settings.musicVolume);
    this.sfxRange.value = String(save.settings.sfxVolume);

    if (snap.screen !== this.lastScreen) {
      this.lastScreen = snap.screen;
      if (snap.screen === "districts") this.renderDistrictsGrid();
      if (snap.screen === "hangar") this.renderHangarPanel();
    }

    if (snap.screen === "hub") {
      const bike = getBikeById(save.selectedBikeId);
      this.activeContractCard.innerHTML = `
        <img src="${stage.bannerImg}" alt="" />
        <div>
          <div style="font-size:0.75rem;color:#00f0ff;font-weight:700;letter-spacing:0.12em;">ACTIVE CONTRACT // ${stage.subtitle}</div>
          <div style="font-family:var(--font-display);font-size:1.3rem;letter-spacing:0.06em;">${stage.name} &mdash; <span style="color:#ffb703;">1ST: $${stage.prizes[0].toLocaleString()}</span></div>
          <div style="font-size:0.82rem;color:#94a3b8;">GARAGE: ${bike.name} (${bike.topSpeedMph} MPH BASE)</div>
        </div>
      `;
    }

    if (snap.screen === "racing" || snap.screen === "paused") {
      this.hudRank.innerHTML = `${String(snap.rank).padStart(2, "0")}<span>/${snap.totalRacers}</span>`;
      const pct = Math.round(snap.progress * 100);
      this.hudProgressBar.style.width = `${pct}%`;
      this.hudDistPct.textContent = `${pct}%`;

      this.hudHeatStars.textContent =
        "★".repeat(snap.wantedHeat) + "☆".repeat(Math.max(0, 5 - snap.wantedHeat));
      this.hudMulti.textContent = `x${snap.multiplier.toFixed(1)}`;
      this.hudCash.textContent = `+$${snap.raceCashEarned.toLocaleString()}`;

      this.barStamina.style.width = `${Math.round(snap.staminaNorm * 100)}%`;
      this.barArmor.style.width = `${Math.round(snap.armorNorm * 100)}%`;
      this.barNitro.style.width = `${Math.round(snap.nitroNorm * 100)}%`;
      this.barFocus.style.width = `${Math.round(snap.focusNorm * 100)}%`;
      this.barEmp.style.width = `${Math.round(snap.empNorm * 100)}%`;
      this.hudWeapon.textContent = WEAPONS[snap.weapon].name.toUpperCase();

      this.hudGear.textContent = `G${snap.gear}`;
      this.hudSpeed.textContent = String(Math.round(snap.speedMph));
      this.hudRpm.style.width = `${Math.round(snap.rpmNorm * 100)}%`;

      this.countdownOverlay.hidden = !snap.countdownText;
      if (snap.countdownText) this.countdownOverlay.textContent = snap.countdownText;

      this.hudBanner.hidden = !snap.bannerText;
      if (snap.bannerText) this.hudBanner.textContent = snap.bannerText;

      if (snap.comms) {
        this.commsToast.hidden = false;
        this.commsPortrait.src = snap.comms.portraitUrl;
        this.commsName.textContent = snap.comms.name;
        this.commsText.textContent = snap.comms.text;
      } else {
        this.commsToast.hidden = true;
      }

      const isCoarse = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 820;
      this.touchLayer.hidden = !(
        save.settings.touchControls === "on" ||
        (save.settings.touchControls === "auto" && isCoarse)
      );

      this.drawRadar(snap.radarDots);
    }

    if (snap.screen === "results" && snap.results) {
      const r = snap.results;
      this.resEyebrow.textContent = r.outcome === "finished" ? "DISTRICT COMPLETE" : r.outcome === "busted" ? "APEX INTERCEPTION" : "WIPEOUT REPORT";
      this.resTitle.textContent =
        r.outcome === "busted" ? "BUSTED // KEYS SEIZED" : r.outcome === "wrecked" ? "CHASSIS TOTALED" : r.rank <= 3 ? `RANK #${r.rank} PODIUM` : `FINISHED #${r.rank}`;
      this.resBossImg.src = r.bossPortrait;
      this.resBossName.textContent = r.bossName;
      this.resBossQuote.textContent = `"${r.bossQuote}"`;
      this.resStatsGrid.innerHTML = `
        <div class="debrief-cell"><span>FINAL POSITION</span><span>#${r.rank} / ${r.totalRacers}</span></div>
        <div class="debrief-cell"><span>RUN TIME</span><span>${r.raceTimeSec.toFixed(1)}s</span></div>
        <div class="debrief-cell"><span>PURSE PAYOUT</span><span class="gold">$${r.stagePrize.toLocaleString()}</span></div>
        <div class="debrief-cell"><span>TAKEDOWNS (${r.takedowns})</span><span class="cyan">+$${r.takedownBonus.toLocaleString()}</span></div>
        <div class="debrief-cell"><span>NEAR MISSES</span><span>${r.nearMisses}</span></div>
        <div class="debrief-cell"><span>TOTAL EARNED</span><span class="gold">+$${r.totalCash.toLocaleString()}</span></div>
      `;
    }
  }

  private drawRadar(dots: UiSnapshot["radarDots"]): void {
    const ctx = this.radarCtx;
    const w = this.radarCanvas.width;
    const h = this.radarCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // Subtle highway grid
    ctx.strokeStyle = "rgba(0,240,255,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.25, 0); ctx.lineTo(w * 0.25, h);
    ctx.moveTo(w * 0.75, 0); ctx.lineTo(w * 0.75, h);
    ctx.moveTo(0, h * 0.65); ctx.lineTo(w, h * 0.65);
    ctx.stroke();

    // Player chevron
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.65 - 6);
    ctx.lineTo(w * 0.5 - 4, h * 0.65 + 4);
    ctx.lineTo(w * 0.5 + 4, h * 0.65 + 4);
    ctx.closePath();
    ctx.fill();

    for (const d of dots) {
      const rx = w * 0.5 + (d.dx / 10) * (w * 0.42);
      const ry = h * 0.65 - (d.dz / 85) * (h * 0.6);
      if (ry < 2 || ry > h - 2) continue;
      ctx.fillStyle = d.kind === "cop" ? "#00f0ff" : d.kind === "rival" ? "#ff2a55" : "#94a3b8";
      ctx.fillRect(rx - 2.5, ry - 2.5, 5, 5);
    }
  }

  private renderDistrictsGrid(): void {
    const save = this.engine.save;
    this.districtsGrid.innerHTML = "";
    for (const st of STAGES) {
      const best = save.bestRanks[st.id];
      const card = document.createElement("div");
      card.className = `district-card ${save.selectedStageId === st.id ? "selected" : ""}`;
      card.innerHTML = `
        <img src="${st.bannerImg}" alt="${st.name}" />
        <div class="district-card-body">
          <div class="district-meta-row">
            <span>${st.subtitle}</span>
            <span>${st.hasRain ? "WET 90%" : st.biome === "alpine" ? "ICE" : "DRY"} &bull; ${"★".repeat(st.difficulty)}</span>
          </div>
          <div class="district-title">${st.name}</div>
          <p class="district-desc">${st.description}</p>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
            <span style="font-weight:700;color:var(--gold);">1ST: $${st.prizes[0].toLocaleString()} ${best ? `(BEST #${best})` : ""}</span>
            <button class="slant-btn small primary">RACE</button>
          </div>
        </div>
      `;
      card.addEventListener("click", (e) => {
        this.engine.selectStage(st.id);
        if ((e.target as HTMLElement).tagName === "BUTTON") {
          this.engine.startRace(st.id);
        } else {
          this.renderDistrictsGrid();
        }
      });
      this.districtsGrid.appendChild(card);
    }
  }

  private renderHangarPanel(): void {
    const save = this.engine.save;
    this.hangarContent.innerHTML = "";

    if (this.hangarTab === "bikes") {
      for (const b of BIKES) {
        const owned = save.ownedBikes.includes(b.id);
        const active = save.selectedBikeId === b.id;
        const el = document.createElement("div");
        el.className = `bike-item ${active ? "active" : ""}`;
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${b.name} <span style="font-size:0.75rem;color:var(--cyan);">[${b.bikeClass}]</span></strong>
            <span style="color:var(--gold);font-weight:700;">${active ? "EQUIPPED" : owned ? "OWNED" : `$${b.price.toLocaleString()}`}</span>
          </div>
          <div style="font-size:0.8rem;color:var(--muted);">${b.tagline}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.8rem;">
            <span>TOP: <b>${b.topSpeedMph} MPH</b> &bull; ARMOR: <b>${b.armor}</b></span>
            <button class="slant-btn small ${active ? "" : "primary"}">${active ? "ACTIVE" : owned ? "EQUIP" : "PURCHASE"}</button>
          </div>
        `;
        el.querySelector("button")!.addEventListener("click", () => {
          this.engine.buyOrSelectBike(b.id);
          this.renderHangarPanel();
        });
        this.hangarContent.appendChild(el);
      }
    } else if (this.hangarTab === "tuning") {
      for (const u of UPGRADES) {
        const tier = save.upgrades[u.key] || 0;
        const cost = tier < 4 ? u.costs[tier] : 0;
        const el = document.createElement("div");
        el.className = "upgrade-item";
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;">
            <strong>${u.label}</strong>
            <span class="cyan">STAGE ${tier}/4</span>
          </div>
          <div style="font-size:0.8rem;color:var(--muted);">${u.desc}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>${tier >= 4 ? "MAXED OUT" : `COST: $${cost.toLocaleString()}`}</span>
            <button class="slant-btn small primary" ${tier >= 4 ? "disabled" : ""}>${tier >= 4 ? "MAX" : "INSTALL"}</button>
          </div>
        `;
        el.querySelector("button")!.addEventListener("click", () => {
          if (tier < 4 && this.engine.buyUpgrade(u.key, cost)) {
            this.renderHangarPanel();
          }
        });
        this.hangarContent.appendChild(el);
      }
    } else {
      const pWrap = document.createElement("div");
      pWrap.className = "upgrade-item";
      pWrap.innerHTML = `<strong>PRIMARY CLEARCOAT METALLIC</strong><div class="swatch-grid"></div>`;
      const pGrid = pWrap.querySelector(".swatch-grid")!;
      for (const sw of PAINT_SWATCHES) {
        const b = document.createElement("button");
        b.className = `swatch-btn ${save.customPrimaryHex === sw.hex ? "active" : ""}`;
        b.style.background = `#${sw.hex.toString(16).padStart(6, "0")}`;
        b.title = sw.name;
        b.addEventListener("click", () => {
          this.engine.setPaintColors(sw.hex, save.customAccentHex);
          this.renderHangarPanel();
        });
        pGrid.appendChild(b);
      }
      this.hangarContent.appendChild(pWrap);

      const nWrap = document.createElement("div");
      nWrap.className = "upgrade-item";
      nWrap.innerHTML = `<strong>UNDERGLOW &amp; RIM NEON TRIM</strong><div class="swatch-grid"></div>`;
      const nGrid = nWrap.querySelector(".swatch-grid")!;
      for (const sw of NEON_SWATCHES) {
        const b = document.createElement("button");
        b.className = `swatch-btn ${save.customAccentHex === sw.hex ? "active" : ""}`;
        b.style.background = `#${sw.hex.toString(16).padStart(6, "0")}`;
        b.title = sw.name;
        b.addEventListener("click", () => {
          this.engine.setPaintColors(save.customPrimaryHex, sw.hex);
          this.renderHangarPanel();
        });
        nGrid.appendChild(b);
      }
      this.hangarContent.appendChild(nWrap);
    }
  }
}
