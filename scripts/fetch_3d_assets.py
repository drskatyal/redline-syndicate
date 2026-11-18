#!/usr/bin/env python3
"""Download real CC0/MIT/Open-Source 3D .glb vehicles, buildings, helicopter,
barriers, 32-bit .hdr skyboxes, and smoke/flame VFX textures from GitHub into
public/, plus copy the Three.js Draco WASM decoder locally into public/draco/.
"""

import shutil
import urllib.request
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = PROJECT_DIR / "public"
DRACO_SRC = PROJECT_DIR / "node_modules" / "three" / "examples" / "jsm" / "libs" / "draco" / "gltf"

ASSETS = {
    # Motorcycles
    "models/hero-motorcycle.glb": "https://raw.githubusercontent.com/NikLever/threejs-cookbook/main/assets/motorcycle.glb",
    "models/rival-motorcycle.glb": "https://raw.githubusercontent.com/egolens/egolens/main/public/models/motorcycle.glb",
    "models/street-bike.glb": "https://raw.githubusercontent.com/DavidRibeiro00/ContraMao/main/assets/Motorcycle.glb",
    # Cars, Trucks & Police
    "models/ferrari.glb": "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/ferrari.glb",
    "models/police-car.glb": "https://raw.githubusercontent.com/DavidRibeiro00/ContraMao/main/assets/Police-Car.glb",
    "models/sports-car.glb": "https://raw.githubusercontent.com/DavidRibeiro00/ContraMao/main/assets/Sports-Car.glb",
    "models/pickup-truck.glb": "https://raw.githubusercontent.com/DavidRibeiro00/ContraMao/main/assets/Pickup-Truck.glb",
    "models/semi-truck.glb": "https://raw.githubusercontent.com/DavidRibeiro00/ContraMao/main/assets/Truck.glb",
    # Aircraft & Road Props
    "models/helicopter.glb": "https://raw.githubusercontent.com/officeshinyujun/heli-pj/main/public/bell_huey_helicopter.glb",
    "models/barrier.glb": "https://raw.githubusercontent.com/egolens/egolens/main/public/models/barrier.glb",
    # Real Kenney City Skyscrapers & Towers
    "models/skyscraper-a.glb": "https://raw.githubusercontent.com/Harif1920/Oficina-virtual-3D/main/modelos/ciudad/building-skyscraper-a.glb",
    "models/skyscraper-b.glb": "https://raw.githubusercontent.com/Harif1920/Oficina-virtual-3D/main/modelos/ciudad/building-skyscraper-b.glb",
    "models/skyscraper-c.glb": "https://raw.githubusercontent.com/Harif1920/Oficina-virtual-3D/main/modelos/ciudad/building-skyscraper-c.glb",
    "models/skyscraper-d.glb": "https://raw.githubusercontent.com/Harif1920/Oficina-virtual-3D/main/modelos/ciudad/building-skyscraper-d.glb",
    "models/building-l.glb": "https://raw.githubusercontent.com/Harif1920/Oficina-virtual-3D/main/modelos/ciudad/building-l.glb",
    "models/building-n.glb": "https://raw.githubusercontent.com/Harif1920/Oficina-virtual-3D/main/modelos/ciudad/building-n.glb",
    "models/Textures/colormap.png": "https://raw.githubusercontent.com/Harif1920/Oficina-virtual-3D/main/modelos/ciudad/Textures/colormap.png",
    "models/colormap.png": "https://raw.githubusercontent.com/Harif1920/Oficina-virtual-3D/main/modelos/ciudad/Textures/colormap.png",
    # Equirectangular 32-bit HDR Skyboxes
    "hdr/sunset.hdr": "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr",
    "hdr/sunrise.hdr": "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/blouberg_sunrise_2_1k.hdr",
    "hdr/night.hdr": "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/moonless_golf_1k.hdr",
    # VFX Sprites
    "fx/smoke.png": "https://raw.githubusercontent.com/NikLever/threejs-cookbook/main/assets/smoke_01.png",
    "fx/flame.png": "https://raw.githubusercontent.com/NikLever/threejs-cookbook/main/assets/flame.png",
}

UA = {"User-Agent": "Mozilla/5.0"}


def download(rel_path: str, url: str) -> None:
    dest = PUBLIC_DIR / rel_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        print(f"  [cached] {rel_path} ({dest.stat().st_size:,} B)")
        return
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    dest.write_bytes(data)
    print(f"  [fetched] {rel_path} ({len(data):,} B)")


def main() -> int:
    print("Fetching real 3D .glb models, .hdr skies, and VFX textures from GitHub...")
    for rel_path, url in ASSETS.items():
        download(rel_path, url)

    draco_dst = PUBLIC_DIR / "draco"
    draco_dst.mkdir(parents=True, exist_ok=True)
    for fname in ("draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"):
        src = DRACO_SRC / fname
        if not src.exists():
            raise FileNotFoundError(f"Missing Draco file: {src}")
        shutil.copy2(src, draco_dst / fname)
        print(f"  [draco] copied {fname} ({src.stat().st_size:,} B)")

    print("All 3D assets ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
