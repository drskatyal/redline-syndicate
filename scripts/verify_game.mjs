#!/usr/bin/env node
"use strict";

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, "..");
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SHOT_DIR = path.join(PROJECT_DIR, ".tmp-verify");
const PROFILE_DIR = path.join(PROJECT_DIR, ".tmp-chrome-profile");
const PORT = Number(process.env.VERIFY_PORT || 8785);
const CDP_PORT = Number(process.env.CDP_PORT || 9225);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener("open", res);
      this.ws.addEventListener("error", (e) => rej(new Error(e.message || "WS error")));
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        for (const fn of this.events) fn(msg.method, msg.params);
      }
    });
  }
  onEvent(fn) { this.events.push(fn); }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const serverProc = spawn("node", ["server.js"], {
    cwd: PROJECT_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let chromeProc = null;
  let cdp = null;

  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Server startup timeout")), 10000);
      serverProc.stdout.on("data", (d) => {
        if (d.toString().includes("listening")) { clearTimeout(t); resolve(); }
      });
      serverProc.stderr.on("data", (d) => console.error("[server]", d.toString()));
    });

    const hz = await fetch(`http://127.0.0.1:${PORT}/healthz`);
    if (!hz.ok) throw new Error(`/healthz HTTP ${hz.status}`);

    chromeProc = spawn(CHROME_PATH, [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-gpu-sandbox",
      "--window-size=1600,900",
      "--device-scale-factor=1.5",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("No Chrome page target");

    cdp = new CDPClient(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");

    const errors = [];
    cdp.onEvent((method, params) => {
      if (method === "Runtime.exceptionThrown") {
        errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Runtime exception");
      } else if (method === "Log.entryAdded" && params.entry?.level === "error") {
        errors.push(`[Log.error] ${params.entry.text}`);
      }
    });

    const snap = async (filename) => {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const outPath = path.join(SHOT_DIR, filename);
      fs.writeFileSync(outPath, Buffer.from(shot.data, "base64"));
      console.log("Saved", outPath);
    };

    const diag = async () => {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "JSON.stringify(window.__THREE_GAME_DIAGNOSTICS__ || null)",
        returnByValue: true,
      });
      return JSON.parse(r.result.value);
    };

    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
    await sleep(1800);
    console.log("Hub diag:", await diag());
    await snap("01_hub_hangar.png");

    await cdp.send("Runtime.evaluate", { expression: "window.__GAME_DEBUG__.openDistricts()" });
    await sleep(700);
    await snap("02_districts_ui.png");

    await cdp.send("Runtime.evaluate", { expression: "window.__GAME_DEBUG__.openGarage()" });
    await sleep(700);
    await snap("03_customizer.png");

    // Stage 1: Vice Bay Rain Race + Nitro + Speed Check
    await cdp.send("Runtime.evaluate", {
      expression: "window.__GAME_DEBUG__.startRace('vice', true); window.__GAME_DEBUG__.setBotInput({ throttle: true, nitro: true, steer: 0.06 });",
    });
    await sleep(2800);
    const viceDiag = await diag();
    console.log("Vice Bay active race diag:", viceDiag);
    await snap("04_vice_rain_race.png");

    if (!viceDiag || viceDiag.speedMph < 80 || viceDiag.distanceMeters < 60) {
      console.log("Errors collected before fail:", errors);
      throw new Error(`Low race progress/speed in Vice Bay: ${JSON.stringify(viceDiag)}`);
    }

    // Stage 5: San Verona Lockdown w/ Pursuit Helicopter + EMP Blast
    await cdp.send("Runtime.evaluate", {
      expression: "window.__GAME_DEBUG__.startRace('sanverona', true); window.__GAME_DEBUG__.setBotInput({ throttle: true, nitro: true, steer: 0 }); window.__GAME_DEBUG__.triggerHeliView();",
    });
    await sleep(2200);
    await cdp.send("Runtime.evaluate", { expression: "window.__GAME_DEBUG__.triggerEmp()" });
    await sleep(180);
    const sanDiag = await diag();
    console.log("San Verona Lockdown diag:", sanDiag);
    await snap("05_sanverona_action.png");

    // Mobile responsive viewport check (390x844 touch simulation)
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await cdp.send("Runtime.evaluate", { expression: "window.dispatchEvent(new Event('resize'))" });
    await sleep(800);
    const mobDiag = await diag();
    console.log("Mobile diag:", mobDiag);
    await snap("06_mobile_hud.png");

    console.log("\n=== ERRORS ===");
    console.log(errors.length ? errors.join("\n") : "(none)");
    if (errors.length > 0) return 1;
    if (viceDiag.renderer.calls <= 5 || viceDiag.renderer.calls > 300 || viceDiag.renderer.triangles > 750000) {
      throw new Error(`Render budget check failed: ${JSON.stringify(viceDiag.renderer)}`);
    }
    return 0;
  } finally {
    if (cdp) cdp.close();
    if (chromeProc) chromeProc.kill("SIGKILL");
    if (serverProc) serverProc.kill("SIGKILL");
    await sleep(500);
    try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); } catch (_) {}
  }
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
