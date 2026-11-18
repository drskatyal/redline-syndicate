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
const SHOT_DIR =
  "C:\\Users\\Suneel\\.gemini\\antigravity\\brain\\bdab3ba0-07e3-4df0-9027-c01ac4190567\\scratch\\asset_studio";
const PROFILE_DIR = path.join(PROJECT_DIR, ".tmp-studio-profile");
const PORT = 8786;
const CDP_PORT = 9228;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, timeoutMs = 20000) {
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
  onEvent(fn) {
    this.events.push(fn);
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const viteProc = spawn(
    process.platform === "win32" ? "cmd.exe" : "npx",
    process.platform === "win32"
      ? ["/c", "npx", "vite", "--port", String(PORT), "--host", "127.0.0.1"]
      : ["vite", "--port", String(PORT), "--host", "127.0.0.1"],
    { cwd: PROJECT_DIR, stdio: ["ignore", "pipe", "pipe"] }
  );

  let chromeProc = null;
  let cdp = null;

  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/?studio=1`, 25000);

    chromeProc = spawn(
      CHROME_PATH,
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE_DIR}`,
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--disable-gpu-sandbox",
        "--window-size=1440,900",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

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
        errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Runtime error");
      } else if (method === "Log.entryAdded" && params.entry?.level === "error") {
        errors.push(`[Log.error] ${params.entry.text}`);
      }
    });

    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/?studio=1` });

    const deadline = Date.now() + 25000;
    let ready = false;
    while (Date.now() < deadline) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "Boolean(window.__ASSET_STUDIO__ && window.__ASSET_STUDIO__.ready)",
        returnByValue: true,
      });
      if (r.result?.value) {
        ready = true;
        break;
      }
      await sleep(300);
    }
    if (!ready) throw new Error("AssetStudio timed out waiting for assets to load");

    const plates = [
      { idx: 0, file: "01_bike_and_rider.png", hdr: "sunset" },
      { idx: 1, file: "02_police_and_exotics.png", hdr: "sunset" },
      { idx: 2, file: "03_heavy_truck_and_chopper.png", hdr: "sunrise" },
      { idx: 3, file: "04_pbr_highway_props.png", hdr: "sunrise" },
      { idx: 4, file: "05_photoreal_skyscrapers.png", hdr: "night" },
    ];

    for (const pl of plates) {
      const evalRes = await cdp.send("Runtime.evaluate", {
        expression: `window.__ASSET_STUDIO__.showPlate(${pl.idx}, '${pl.hdr}')`,
        awaitPromise: true,
        returnByValue: true,
      });
      await sleep(350);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const outPath = path.join(SHOT_DIR, pl.file);
      fs.writeFileSync(outPath, Buffer.from(shot.data, "base64"));
      console.log(`Saved ${pl.file}`, JSON.stringify(evalRes.result?.value));
    }

    console.log("STUDIO_ERRORS:", errors.length ? errors.join(" | ") : "(none)");
    return errors.length ? 1 : 0;
  } finally {
    if (cdp) cdp.close();
    if (chromeProc) chromeProc.kill("SIGKILL");
    if (viteProc) viteProc.kill("SIGKILL");
    await sleep(400);
    try {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
