import * as THREE from "three";

export interface HighwayTextureSet {
  albedoMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  puddleMaskMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

function hash2d(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2d(ix, iy);
  const b = hash2d(ix + 1, iy);
  const c = hash2d(ix, iy + 1);
  const d = hash2d(ix + 1, iy + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export function createHighwayTextures(anisotropy: number): HighwayTextureSet {
  const size = 1024;

  // 1. Albedo Canvas
  const albedoCanvas = document.createElement("canvas");
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const actx = albedoCanvas.getContext("2d")!;

  actx.fillStyle = "#191c24";
  actx.fillRect(0, 0, size, size);

  // Subtle shoulder tint outside playable lanes
  const shoulderW = Math.round(size * 0.08);
  actx.fillStyle = "#12151d";
  actx.fillRect(0, 0, shoulderW, size);
  actx.fillRect(size - shoulderW, 0, shoulderW, size);

  // Aggregate mineral grain + tire wear tracks
  const img = actx.getImageData(0, 0, size, size);
  const data = img.data;
  const puddleCanvas = document.createElement("canvas");
  puddleCanvas.width = 512;
  puddleCanvas.height = 512;
  const pctx = puddleCanvas.getContext("2d")!;
  const pImg = pctx.createImageData(512, 512);

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = 512;
  roughCanvas.height = 512;
  const rctx = roughCanvas.getContext("2d")!;
  const rImg = rctx.createImageData(512, 512);

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = 512;
  bumpCanvas.height = 512;
  const bctx = bumpCanvas.getContext("2d")!;
  const bImg = bctx.createImageData(512, 512);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = x / size;
      // Tire wear grooves around 4 lane centers (0.20, 0.38, 0.62, 0.80)
      const groove =
        Math.exp(-Math.pow((nx - 0.21) * 16, 2)) +
        Math.exp(-Math.pow((nx - 0.39) * 16, 2)) +
        Math.exp(-Math.pow((nx - 0.61) * 16, 2)) +
        Math.exp(-Math.pow((nx - 0.79) * 16, 2));

      const grain = (hash2d(x * 0.9, y * 0.9) - 0.5) * 18;
      const patch = (smoothNoise(x * 0.015, y * 0.015) - 0.5) * 14;
      const baseDelta = grain + patch - groove * 7;

      data[idx] = Math.max(0, Math.min(255, data[idx] + baseDelta));
      data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + baseDelta));
      data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + baseDelta + 1));
    }
  }
  actx.putImageData(img, 0, 0);

  // Seamless periodic puddle + roughness + bump generation (512x512)
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const idx = (y * 512 + x) * 4;
      const nx = x / 512;
      const ny = y / 512;
      // Seamless blend across V
      const macro =
        0.6 * smoothNoise(Math.sin(nx * Math.PI * 2) * 2.2 + nx * 3, Math.cos(ny * Math.PI * 2) * 2.2 + 5) +
        0.4 * smoothNoise(nx * 9.0, (Math.sin(ny * Math.PI * 2) + 2) * 3.0);
      const puddleVal = Math.max(0, Math.min(255, ((macro - 0.42) / 0.32) * 255));
      pImg.data[idx] = puddleVal;
      pImg.data[idx + 1] = puddleVal;
      pImg.data[idx + 2] = puddleVal;
      pImg.data[idx + 3] = 255;

      const dryRough = 215 - (hash2d(x, y) * 32);
      rImg.data[idx] = dryRough;
      rImg.data[idx + 1] = dryRough;
      rImg.data[idx + 2] = dryRough;
      rImg.data[idx + 3] = 255;

      const bVal = 128 + (hash2d(x * 1.3, y * 1.3) - 0.5) * 65 - puddleVal * 0.2;
      bImg.data[idx] = bVal;
      bImg.data[idx + 1] = bVal;
      bImg.data[idx + 2] = bVal;
      bImg.data[idx + 3] = 255;
    }
  }
  pctx.putImageData(pImg, 0, 0);
  rctx.putImageData(rImg, 0, 0);
  bctx.putImageData(bImg, 0, 0);

  // Crisp 4-lane markings & rumble strips on Albedo
  // Left & Right rumble strips
  const stripSegments = 16;
  const segH = size / stripSegments;
  for (let i = 0; i < stripSegments; i++) {
    actx.fillStyle = i % 2 === 0 ? "#dc2626" : "#e2e8f0";
    actx.fillRect(shoulderW - 14, i * segH, 12, segH);
    actx.fillRect(size - shoulderW + 2, i * segH, 12, segH);
  }

  // Solid outer edge lines
  actx.fillStyle = "#e2e8f0";
  actx.fillRect(shoulderW + 4, 0, 10, size);
  actx.fillRect(size - shoulderW - 14, 0, 10, size);

  // Double amber center divider
  const mid = size / 2;
  actx.fillStyle = "#f59e0b";
  actx.fillRect(mid - 11, 0, 7, size);
  actx.fillRect(mid + 4, 0, 7, size);

  // Dashed inner lane dividers (at 0.29 and 0.71)
  const leftLaneLine = Math.round(size * 0.29);
  const rightLaneLine = Math.round(size * 0.71);
  actx.fillStyle = "rgba(226, 232, 240, 0.85)";
  const dashCount = 6;
  const dashStep = size / dashCount;
  for (let i = 0; i < dashCount; i++) {
    const dy = i * dashStep + 22;
    actx.fillRect(leftLaneLine - 4, dy, 8, dashStep * 0.48);
    actx.fillRect(rightLaneLine - 4, dy, 8, dashStep * 0.48);
  }

  const configure = (canvas: HTMLCanvasElement, isSrgb: boolean) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 24);
    tex.anisotropy = anisotropy;
    tex.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    albedoMap: configure(albedoCanvas, true),
    roughnessMap: configure(roughCanvas, false),
    puddleMaskMap: configure(puddleCanvas, false),
    bumpMap: configure(bumpCanvas, false),
  };
}

export function createSkyscraperTexture(anisotropy: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 1024;
  const ctx = c.getContext("2d")!;

  ctx.fillStyle = "#0b0f1c";
  ctx.fillRect(0, 0, 512, 1024);

  const cols = 16;
  const rows = 44;
  const cw = 512 / cols;
  const rh = 1024 / rows;

  for (let r = 0; r < rows; r++) {
    const floorLitBias = hash2d(r * 0.37, 9.1);
    for (let col = 0; col < cols; col++) {
      const rnd = hash2d(col * 1.7 + 3, r * 2.3 + 7);
      if (rnd + floorLitBias * 0.35 > 0.68) {
        const tint = hash2d(col, r * 5.1);
        if (tint < 0.45) ctx.fillStyle = "#fde68a";
        else if (tint < 0.78) ctx.fillStyle = "#67e8f9";
        else if (tint < 0.92) ctx.fillStyle = "#f472b6";
        else ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = 0.55 + hash2d(col * 3, r) * 0.45;
        ctx.fillRect(col * cw + 5, r * rh + 4, cw - 10, rh - 9);
      } else {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#162038";
        ctx.fillRect(col * cw + 5, r * rh + 4, cw - 10, rh - 9);
      }
    }
  }
  ctx.globalAlpha = 1;

  // Vertical glass mullions
  ctx.fillStyle = "#05070e";
  for (let col = 0; col <= cols; col++) {
    ctx.fillRect(col * cw - 2, 0, 4, 1024);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, "rgba(0,0,0,0.82)");
  g.addColorStop(0.5, "rgba(0,0,0,0.38)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGlowSpriteTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.28, "rgba(255,255,255,0.7)");
  g.addColorStop(0.65, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createChevronRampTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0b1120";
  ctx.fillRect(0, 0, 256, 512);

  for (let y = 0; y < 512; y += 64) {
    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(28, y + 52);
    ctx.lineTo(128, y + 12);
    ctx.lineTo(228, y + 52);
    ctx.stroke();
  }
  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(0, 0, 14, 512);
  ctx.fillRect(242, 0, 14, 512);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
