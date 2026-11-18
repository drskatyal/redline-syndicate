#!/usr/bin/env python3
"""
Fast O(N) spatial + UV chart vertex-clustering decimator for Poly Haven glTF 1k roadside props.
Turns 30K-82K tri raw 8K-mesh bins into crisp 1.5K-4K tri web-ready LOD bins with full PBR textures/normals intact.
"""

import json
import os
import struct
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(ROOT, "public", "models")

TARGETS = [
    # (subdir, gltf_file, grid_divisions_max_axis, min_keep_tris)
    ("road_barrier", "concrete_road_barrier_1k.gltf", 22, 1200),
    ("street_lamp", "street_lamp_01_1k.gltf", 26, 900),
    ("tree", "quiver_tree_02_1k.gltf", 28, 2200),
    ("boulder", "boulder_01_1k.gltf", 18, 900),
]


def read_accessor(gltf: dict, raw_bin: bytes, acc_idx: int) -> np.ndarray:
    acc = gltf["accessors"][acc_idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    offset = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    count = acc["count"]
    ctype = acc["componentType"]
    atype = acc["type"]
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[atype]
    dtype_map = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5122: np.int16}
    dt = dtype_map[ctype]
    stride = bv.get("byteStride")
    if stride and stride != comps * np.dtype(dt).itemsize:
        arr = np.zeros((count, comps), dtype=dt)
        item_sz = comps * np.dtype(dt).itemsize
        for i in range(count):
            pos = offset + i * stride
            arr[i] = np.frombuffer(raw_bin[pos : pos + item_sz], dtype=dt)
        return arr
    n_bytes = count * comps * np.dtype(dt).itemsize
    arr = np.frombuffer(raw_bin[offset : offset + n_bytes], dtype=dt)
    return arr.reshape((count, comps)) if comps > 1 else arr


def cluster_decimate(pos: np.ndarray, norm: np.ndarray, uv: np.ndarray, idx: np.ndarray, grid_div: int):
    pmin = pos.min(axis=0)
    pmax = pos.max(axis=0)
    extent = float(np.max(pmax - pmin))
    cell_sz = max(1e-5, extent / grid_div)

    qpos = np.floor((pos - pmin) / cell_sz).astype(np.int64)
    # Keep UV seam boundaries separate by quantizing UV chart loosely
    quv = np.floor(uv * 18.0).astype(np.int64)

    # Pack 5 integer keys cleanly via dictionary mapping
    keys = [
        (int(qpos[i, 0]), int(qpos[i, 1]), int(qpos[i, 2]), int(quv[i, 0]), int(quv[i, 1]))
        for i in range(len(pos))
    ]
    key_to_new = {}
    old_to_new = np.empty(len(pos), dtype=np.int32)
    groups = []
    for i, k in enumerate(keys):
        nid = key_to_new.get(k)
        if nid is None:
            nid = len(groups)
            key_to_new[k] = nid
            groups.append([i])
        else:
            groups[nid].append(i)
        old_to_new[i] = nid

    nv = len(groups)
    new_pos = np.zeros((nv, 3), dtype=np.float32)
    new_norm = np.zeros((nv, 3), dtype=np.float32)
    new_uv = np.zeros((nv, 2), dtype=np.float32)

    for nid, members in enumerate(groups):
        new_pos[nid] = pos[members].mean(axis=0)
        n_avg = norm[members].mean(axis=0)
        n_len = float(np.linalg.norm(n_avg))
        new_norm[nid] = n_avg / n_len if n_len > 1e-6 else np.array([0, 1, 0], dtype=np.float32)
        new_uv[nid] = uv[members].mean(axis=0)

    tris = old_to_new[idx.reshape(-1, 3)]
    valid = (tris[:, 0] != tris[:, 1]) & (tris[:, 1] != tris[:, 2]) & (tris[:, 2] != tris[:, 0])
    valid_tris = tris[valid]
    # Deduplicate identical vertex triples (any order)
    sorted_t = np.sort(valid_tris, axis=1)
    _, uniq_idx = np.unique(sorted_t, axis=0, return_index=True)
    uniq_tris = valid_tris[np.sort(uniq_idx)]
    new_idx = uniq_tris.reshape(-1).astype(np.uint16)

    # Drop unused vertices
    used_mask = np.zeros(nv, dtype=bool)
    used_mask[new_idx] = True
    remap = np.full(nv, -1, dtype=np.int32)
    remap[used_mask] = np.arange(int(used_mask.sum()), dtype=np.int32)
    return (
        new_pos[used_mask],
        new_norm[used_mask],
        new_uv[used_mask],
        remap[new_idx].astype(np.uint16),
    )


def process_asset(subdir: str, fn: str, grid_div: int, min_keep_tris: int) -> None:
    folder = os.path.join(MODELS_DIR, subdir)
    gltf_path = os.path.join(folder, fn)
    gltf = json.load(open(gltf_path, "r", encoding="utf-8"))
    orig_bin_name = gltf["buffers"][0]["uri"]
    orig_bin_path = os.path.join(folder, orig_bin_name)
    if not os.path.exists(orig_bin_path):
        print(f"Skipping {fn}: missing {orig_bin_name}")
        return
    with open(orig_bin_path, "rb") as f:
        raw_bin = f.read()

    out_chunks = bytearray()
    new_bvs = []
    new_accs = []

    def append_block(data_bytes: bytes, target: int) -> int:
        while len(out_chunks) % 4 != 0:
            out_chunks.append(0)
        off = len(out_chunks)
        out_chunks.extend(data_bytes)
        bv_idx = len(new_bvs)
        new_bvs.append({
            "buffer": 0,
            "byteOffset": off,
            "byteLength": len(data_bytes),
            "target": target,
        })
        return bv_idx

    before_tris = 0
    after_tris = 0
    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            pos = read_accessor(gltf, raw_bin, prim["attributes"]["POSITION"])
            norm = read_accessor(gltf, raw_bin, prim["attributes"]["NORMAL"])
            uv = read_accessor(gltf, raw_bin, prim["attributes"]["TEXCOORD_0"])
            idx = read_accessor(gltf, raw_bin, prim["indices"])
            orig_t = len(idx) // 3
            before_tris += orig_t

            if orig_t > min_keep_tris:
                d_pos, d_norm, d_uv, d_idx = cluster_decimate(pos, norm, uv, idx, grid_div)
            else:
                d_pos, d_norm, d_uv, d_idx = (
                    pos.astype(np.float32),
                    norm.astype(np.float32),
                    uv.astype(np.float32),
                    idx.astype(np.uint16),
                )

            after_tris += len(d_idx) // 3

            bv_pos = append_block(d_pos.tobytes(), 34962)
            acc_pos = len(new_accs)
            new_accs.append({
                "bufferView": bv_pos,
                "componentType": 5126,
                "count": int(len(d_pos)),
                "type": "VEC3",
                "min": [float(v) for v in d_pos.min(axis=0)],
                "max": [float(v) for v in d_pos.max(axis=0)],
            })

            bv_norm = append_block(d_norm.tobytes(), 34962)
            acc_norm = len(new_accs)
            new_accs.append({
                "bufferView": bv_norm,
                "componentType": 5126,
                "count": int(len(d_norm)),
                "type": "VEC3",
            })

            bv_uv = append_block(d_uv.tobytes(), 34962)
            acc_uv = len(new_accs)
            new_accs.append({
                "bufferView": bv_uv,
                "componentType": 5126,
                "count": int(len(d_uv)),
                "type": "VEC2",
            })

            bv_idx = append_block(d_idx.tobytes(), 34963)
            acc_idx = len(new_accs)
            new_accs.append({
                "bufferView": bv_idx,
                "componentType": 5123,
                "count": int(len(d_idx)),
                "type": "SCALAR",
            })

            prim["attributes"] = {
                "POSITION": acc_pos,
                "NORMAL": acc_norm,
                "TEXCOORD_0": acc_uv,
            }
            prim["indices"] = acc_idx

    lod_bin_name = orig_bin_name.replace(".bin", "_lod.bin") if "_lod" not in orig_bin_name else orig_bin_name
    lod_bin_path = os.path.join(folder, lod_bin_name)
    with open(lod_bin_path, "wb") as f:
        f.write(out_chunks)

    gltf["buffers"] = [{"byteLength": len(out_chunks), "uri": lod_bin_name}]
    gltf["bufferViews"] = new_bvs
    gltf["accessors"] = new_accs
    with open(gltf_path, "w", encoding="utf-8") as f:
        json.dump(gltf, f, separators=(",", ":"))

    if lod_bin_path != orig_bin_path and os.path.exists(orig_bin_path):
        os.remove(orig_bin_path)

    print(f"  {fn}: {before_tris:,} -> {after_tris:,} tris | bin {len(raw_bin):,} B -> {len(out_chunks):,} B")


if __name__ == "__main__":
    print("Decimating Poly Haven roadside props to real-time WebGL2 LODs...")
    for sub, fn, gd, mt in TARGETS:
        process_asset(sub, fn, gd, mt)
    print("DONE.")
