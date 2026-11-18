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
HDR_DIR = os.path.join(ROOT, "public", "hdr")
AUDIO_DIR = os.path.join(ROOT, "public", "audio")

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) RedlineAssetBuilder/1.0"}

LOWPOLY_FILES = [
    "soldier.glb",
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
    print("[2/5] Downloading rigged PBR human riders, vehicles, contact AO, and freight GLBs...")
    download_file(
        "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/readyplayer.me.glb",
        os.path.join(MODELS_DIR, "human-rider.glb"),
    )
    download_file(
        "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/ferrari_ao.png",
        os.path.join(MODELS_DIR, "ferrari_ao.png"),
    )
    download_file(
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb",
        os.path.join(MODELS_DIR, "milk-truck.glb"),
    )
    download_file(
        "https://raw.githubusercontent.com/ahnuchen/auto-atlas/HEAD/public/models/tesla_2018_model_3.glb",
        os.path.join(MODELS_DIR, "tesla-sedan.glb"),
    )
    download_file(
        "https://raw.githubusercontent.com/ahnuchen/auto-atlas/HEAD/public/models/free_bmw_m3_e30.glb",
        os.path.join(MODELS_DIR, "bmw-coupe.glb"),
    )


def fetch_polyhaven_textures() -> None:
    print("[3/5] Downloading Poly Haven CC0 scanned 1k PBR surface & foliage textures + daytime coastal HDR...")
    os.makedirs(PBR_DIR, exist_ok=True)
    os.makedirs(HDR_DIR, exist_ok=True)
    specs = [
        ("asphalt_02", "asphalt"),
        ("brushed_concrete", "concrete"),
        ("coast_sand_01", "sand"),
    ]
    for asset_id, prefix in specs:
        meta = fetch_json(f"https://api.polyhaven.com/files/{asset_id}")
        download_file(meta["Diffuse"]["1k"]["jpg"]["url"], os.path.join(PBR_DIR, f"{prefix}_diff.jpg"))
        download_file(meta["nor_gl"]["1k"]["jpg"]["url"], os.path.join(PBR_DIR, f"{prefix}_nor.jpg"))
        download_file(meta["Rough"]["1k"]["jpg"]["url"], os.path.join(PBR_DIR, f"{prefix}_rough.jpg"))

    palm_meta = fetch_json("https://api.polyhaven.com/files/island_tree_01")
    palm_inc = palm_meta["gltf"]["1k"]["gltf"]["include"]
    if "textures/island_tree_01_diff_1k.jpg" in palm_inc:
        download_file(
            palm_inc["textures/island_tree_01_diff_1k.jpg"]["url"],
            os.path.join(PBR_DIR, "palm_bark_diff.jpg"),
        )
    if "textures/island_tree_01_leaves_diff_1k.jpg" in palm_inc:
        download_file(
            palm_inc["textures/island_tree_01_leaves_diff_1k.jpg"]["url"],
            os.path.join(PBR_DIR, "palm_leaf_diff.jpg"),
        )

    day_hdr_meta = fetch_json("https://api.polyhaven.com/files/kloofendal_48d_partly_cloudy_puresky")
    download_file(day_hdr_meta["hdri"]["1k"]["hdr"]["url"], os.path.join(HDR_DIR, "day.hdr"))


def fetch_polyhaven_gltf(asset_id: str, subdir: str) -> None:
    meta = fetch_json(f"https://api.polyhaven.com/files/{asset_id}")
    gltf_entry = meta["gltf"]["1k"]["gltf"]
    base_dir = os.path.join(MODELS_DIR, subdir)
    os.makedirs(base_dir, exist_ok=True)
    gltf_filename = f"{asset_id}_1k.gltf"
    download_file(gltf_entry["url"], os.path.join(base_dir, gltf_filename))
    has_lod_bin = any(f.endswith("_lod.bin") for f in os.listdir(base_dir))
    for rel_path, info in gltf_entry.get("include", {}).items():
        # Security/sanity normalize relative path inside base_dir
        clean_rel = os.path.normpath(rel_path).lstrip("\\/")
        if clean_rel.endswith(".bin") and has_lod_bin:
            print(f"  [skip]   {subdir}/{clean_rel} (already decimated *_lod.bin present)")
            continue
        download_file(info["url"], os.path.join(base_dir, clean_rel))


def fetch_studio_audio() -> None:
    print("[5/5] Downloading real studio soundtrack tracks & recorded vehicle/crash SFX...")
    os.makedirs(AUDIO_DIR, exist_ok=True)
    tracks = [
        ("racer_drive.mp3", "https://raw.githubusercontent.com/jakesgordon/javascript-racer/master/music/racer.mp3"),
        ("night_synth.mp3", "https://raw.githubusercontent.com/moizahmad418/aventador-3d-configurator/HEAD/src/static/assets/audio_track.mp3"),
        ("hyper_grid.ogg", "https://raw.githubusercontent.com/BKcore/HexGL/master/audio/bg.ogg"),
        ("sunset_outlaw.mp3", "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/sounds/358232_j_s_song.mp3"),
        ("engine_loop.ogg", "https://raw.githubusercontent.com/HarryMofoka/Racing-Game/HEAD/audio/engine.ogg"),
        ("wind_loop.ogg", "https://raw.githubusercontent.com/BKcore/HexGL/master/audio/wind.ogg"),
        ("skid_loop.ogg", "https://raw.githubusercontent.com/HarryMofoka/Racing-Game/HEAD/audio/skid.ogg"),
        ("boost_whoosh.ogg", "https://raw.githubusercontent.com/BKcore/HexGL/master/audio/boost.ogg"),
        ("impact_crash.ogg", "https://raw.githubusercontent.com/HarryMofoka/Racing-Game/HEAD/audio/impact.ogg"),
        ("wreck_shatter.ogg", "https://raw.githubusercontent.com/BKcore/HexGL/master/audio/destroyed.ogg"),
    ]
    for fname, url in tracks:
        download_file(url, os.path.join(AUDIO_DIR, fname))


def main() -> None:
    purge_lowpoly()
    fetch_github_models()
    fetch_polyhaven_textures()
    print("[4/5] Downloading Poly Haven CC0 glTF highway props (barrier, street lamp, tree, boulder)...")
    fetch_polyhaven_gltf("concrete_road_barrier", "road_barrier")
    fetch_polyhaven_gltf("street_lamp_01", "street_lamp")
    fetch_polyhaven_gltf("quiver_tree_02", "tree")
    fetch_polyhaven_gltf("shrub_03", "shrub")
    fetch_polyhaven_gltf("boulder_01", "boulder")
    fetch_studio_audio()
    print("DONE: Realistic PBR assets & studio audio staged.")


if __name__ == "__main__":
    main()
