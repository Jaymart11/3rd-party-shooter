"""
Blender script: makes game-ready versions of the Poly Haven props.
The scanned models are far too dense for real-time (the road barrier is ~61k triangles),
so this decimates each one and exports <name>/<name>_game.glb next to the original.
Normal maps keep the surface detail, so the low-poly result looks the same in game.

Run (from the project folder):
  "C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe" -b -P tools/optimize_props.py
"""
import bpy, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets", "models")
# target triangle budget per model
BUDGET = {
    "concrete_road_barrier": 1500,
    "wooden_military_crate": 1800,
    "wooden_crate_02": 1500,
    "barrel_03": 1200,
    "utility_box_01": 1500,
}


def tri_count(objs):
    n = 0
    for o in objs:
        if o.type == "MESH":
            for p in o.data.polygons:
                n += len(p.vertices) - 2
    return n


for name, budget in BUDGET.items():
    src = os.path.join(ROOT, name, f"{name}.gltf")
    if not os.path.exists(src):
        print("skip (missing)", name)
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    before = tri_count(meshes)
    ratio = min(1.0, budget / max(1, before))
    if ratio < 1.0:
        for o in meshes:
            mod = o.modifiers.new("Decimate", "DECIMATE")
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=mod.name)
    after = tri_count(meshes)
    out = os.path.join(ROOT, name, f"{name}_game.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
    print(f"optimized {name}: {before} -> {after} tris -> {out}")
