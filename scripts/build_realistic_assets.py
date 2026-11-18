#!/usr/bin/env python3
"""
Step 1 of REDLINE SYNDICATE Assets-First Pipeline:
1. Purge all low-poly / cartoon placeholder GLBs and PNGs from public/models/
2. Download photorealistic PBR GLBs (soldier.glb, milk-truck.glb, ferrari_ao.png)
3. Download Poly Haven CC0 scanned PBR texture sets (asphalt_02, brushed_concrete) into public/pbr/
4. Download Poly Haven CC0 glTF 3D props (concrete_road_barrier, street_lamp_01, jacaranda_tree)
   complete with their .bin and textures/ includes.
"""

import json
import os
import shutil
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(ROOT, "public", "models")
PBR_DIR = os.path.join(ROOT, "public", "pbr")

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) RedlineAssetBuilder/1.0"}

LOWPOLY_FILES = [
    "police-car.glb",
    "sports-car.glb",
    "pickup-truck.glb",
    "semi-truck.glb",
    "rival-motorcycle.glb",
    "street-bike.glb",
    "skyscraper-a.glb",
    "skyscraper-b.glb",
    "skyscraper-c.glb",
    "skyscraper-d.glb",
    "building-l.glb",
    "building-n.glb",
    "barrier.glb",
    "colormap.png",
]


def download_file(url: str, dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 512:
        print(f"  [cached] {os.path.relpath(dest, ROOT)} ({os.path.getsize(dest):,} B)")
        return
    print(f"  [fetch]  {os.path.relpath(dest, ROOT)} <- {url}")
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=45) as resp:
        data = resp.read()
    with open(dest, "wb") as f:
        f.write(data)
    print(f"           saved {len(data):,} B")


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def purge_lowpoly() -> None:
    print("[1/4] Purging cartoon / low-poly placeholder assets...")
    for fname in LOWPOLY_FILES:
        p = os.path.join(MODELS_DIR, fname)
        if os.path.exists(p):
            os.remove(p)
            print(f"  [removed] public/models/{fname}")
    tex_dir = os.path.join(MODELS_DIR, "Textures")
    if os.path.isdir(tex_dir):
        shutil.rmtree(tex_dir)
        print("  [removed] public/models/Textures/")


def fetch_github_models() -> None:
    print("[2/4] Downloading rigged PBR rider, contact AO, and freight transport GLB...")
    download_file(
        "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb",
        os.path.join(MODELS_DIR, "soldier.glb"),
    )
    download_file(
        "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/ferrari_ao.png",
        os.path.join(MODELS_DIR, "ferrari_ao.png"),
    )
    download_file(
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb",
        os.path.join(MODELS_DIR, "milk-truck.glb"),
    )


def fetch_polyhaven_textures() -> None:
    print("[3/4] Downloading Poly Haven CC0 scanned 1k PBR surface textures...")
    os.makedirs(PBR_DIR, exist_ok=True)
    specs = [
        ("asphalt_02", "asphalt"),
        ("brushed_concrete", "concrete"),
    ]
    for asset_id, prefix in specs:
        meta = fetch_json(f"https://api.polyhaven.com/files/{asset_id}")
        download_file(meta["Diffuse"]["1k"]["jpg"]["url"], os.path.join(PBR_DIR, f"{prefix}_diff.jpg"))
        download_file(meta["nor_gl"]["1k"]["jpg"]["url"], os.path.join(PBR_DIR, f"{prefix}_nor.jpg"))
        download_file(meta["Rough"]["1k"]["jpg"]["url"], os.path.join(PBR_DIR, f"{prefix}_rough.jpg"))


def fetch_polyhaven_gltf(asset_id: str, subdir: str) -> None:
    meta = fetch_json(f"https://api.polyhaven.com/files/{asset_id}")
    gltf_entry = meta["gltf"]["1k"]["gltf"]
    base_dir = os.path.join(MODELS_DIR, subdir)
    os.makedirs(base_dir, exist_ok=True)
    gltf_filename = f"{asset_id}_1k.gltf"
    download_file(gltf_entry["url"], os.path.join(base_dir, gltf_filename))
    for rel_path, info in gltf_entry.get("include", {}).items():
        # Security/sanity normalize relative path inside base_dir
        clean_rel = os.path.normpath(rel_path).lstrip("\\/")
        download_file(info["url"], os.path.join(base_dir, clean_rel))


def main() -> None:
    purge_lowpoly()
    fetch_github_models()
    fetch_polyhaven_textures()
    print("[4/4] Downloading Poly Haven CC0 glTF highway props (barrier, street lamp, tree, boulder)...")
    fetch_polyhaven_gltf("concrete_road_barrier", "road_barrier")
    fetch_polyhaven_gltf("street_lamp_01", "street_lamp")
    fetch_polyhaven_gltf("quiver_tree_02", "tree")
    fetch_polyhaven_gltf("shrub_03", "shrub")
    fetch_polyhaven_gltf("boulder_01", "boulder")
    print("DONE: Realistic PBR assets staged.")


if __name__ == "__main__":
    main()
