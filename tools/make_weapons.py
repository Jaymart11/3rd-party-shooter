"""
Blender script: builds the rifle + pistol models and exports them as .glb.

Run (from the project folder):
  "C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe" -b -P tools/make_weapons.py

Convention: Blender +Y = weapon forward (becomes -Z in glTF / three.js), +Z = up.
Origin sits at the top of the pistol grip (where the right hand holds it).
An empty called "Muzzle" marks where tracers / muzzle flash start.
"""
import bpy, math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets", "models")
os.makedirs(OUT, exist_ok=True)


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def mat(name, color, metallic, rough):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    return m


def finish(obj, material, bevel=0.004, segs=2):
    obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segs
        mod.limit_method = "ANGLE"
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def box(name, size, loc, material, rot=(0, 0, 0), bevel=0.004):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=[math.radians(a) for a in rot])
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, material, bevel)


def cyl(name, r, length, loc, material, axis="Y", verts=24, bevel=0.002):
    rot = {"Y": (math.radians(90), 0, 0), "X": (0, math.radians(90), 0), "Z": (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=length, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    return finish(o, material, bevel, 1)


def muzzle(loc):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=loc)
    e = bpy.context.active_object
    e.name = "Muzzle"
    e.empty_display_size = 0.03
    return e


def merge_by_material():
    """Join all parts that share a material so each gun is only a few draw calls."""
    groups = {}
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
        groups.setdefault(o.data.materials[0].name, []).append(o)
    for mat_name, objs in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        bpy.context.active_object.name = mat_name


def export(name):
    merge_by_material()
    bpy.ops.object.select_all(action="SELECT")
    path = os.path.join(OUT, name)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    print("exported", path)


def build_rifle():
    gun = mat("Gunmetal", (0.03, 0.031, 0.034), 0.6, 0.42)
    poly = mat("Polymer", (0.035, 0.034, 0.032), 0.0, 0.65)
    tan = mat("FDE", (0.2, 0.16, 0.105), 0.0, 0.75)
    glass = mat("Lens", (0.05, 0.15, 0.12), 0.3, 0.05)

    box("Receiver", (0.058, 0.36, 0.085), (0, 0.06, 0.02), gun)
    box("LowerReceiver", (0.052, 0.22, 0.05), (0, 0.03, -0.035), poly)
    box("Rail", (0.032, 0.42, 0.014), (0, 0.12, 0.07), gun, bevel=0.002)
    for i in range(14):  # picatinny teeth
        box(f"RailTooth{i}", (0.036, 0.008, 0.008), (0, -0.07 + i * 0.03, 0.08), gun, bevel=0)
    box("Handguard", (0.066, 0.3, 0.072), (0, 0.38, 0.022), tan, bevel=0.008)
    for i in range(5):  # vent slots
        box(f"Vent{i}", (0.068, 0.03, 0.012), (0, 0.27 + i * 0.05, 0.03), poly, bevel=0)
    cyl("Barrel", 0.011, 0.24, (0, 0.62, 0.032), gun)
    cyl("GasBlock", 0.019, 0.03, (0, 0.555, 0.04), gun)
    cyl("MuzzleBrake", 0.019, 0.07, (0, 0.765, 0.032), gun, verts=6)
    box("Magazine", (0.032, 0.075, 0.18), (0, 0.13, -0.1), poly, rot=(-14, 0, 0), bevel=0.006)
    box("MagWell", (0.045, 0.09, 0.04), (0, 0.13, -0.035), gun)
    box("Grip", (0.034, 0.045, 0.115), (0, -0.035, -0.07), poly, rot=(18, 0, 0), bevel=0.008)
    box("TriggerGuard", (0.008, 0.08, 0.006), (0, 0.025, -0.075), gun, bevel=0)
    box("Trigger", (0.006, 0.006, 0.025), (0, 0.035, -0.06), gun, bevel=0)
    box("BufferTube", (0.03, 0.14, 0.03), (0, -0.19, 0.03), gun)
    box("Stock", (0.045, 0.2, 0.06), (0, -0.28, 0.005), tan, bevel=0.01)
    box("ButtPad", (0.05, 0.03, 0.13), (0, -0.39, -0.015), poly, bevel=0.01)
    box("ChargingHandle", (0.05, 0.02, 0.012), (0, -0.1, 0.065), gun, bevel=0)
    # red-dot sight
    box("SightMount", (0.03, 0.06, 0.02), (0, 0.03, 0.09), gun)
    cyl("SightBody", 0.024, 0.09, (0, 0.03, 0.118), gun)
    cyl("SightLens", 0.02, 0.092, (0, 0.03, 0.118), glass, bevel=0)
    # foregrip
    box("Foregrip", (0.028, 0.035, 0.08), (0, 0.42, -0.04), poly, bevel=0.008)
    muzzle((0, 0.81, 0.032))
    export("rifle.glb")


def build_pistol():
    gun = mat("Gunmetal", (0.03, 0.031, 0.034), 0.6, 0.42)
    poly = mat("Polymer", (0.035, 0.034, 0.032), 0.0, 0.65)
    box("Slide", (0.028, 0.19, 0.034), (0, 0.06, 0.03), gun, bevel=0.004)
    for i in range(6):
        box(f"Serration{i}", (0.03, 0.004, 0.028), (0, -0.02 + i * 0.008, 0.032), poly, bevel=0)
    box("Frame", (0.026, 0.17, 0.022), (0, 0.055, 0.003), poly)
    box("Grip", (0.03, 0.05, 0.11), (0, -0.015, -0.055), poly, rot=(16, 0, 0), bevel=0.006)
    box("TriggerGuard", (0.008, 0.05, 0.006), (0, 0.045, -0.03), poly, bevel=0)
    box("FrontSight", (0.004, 0.006, 0.008), (0, 0.145, 0.05), gun, bevel=0)
    box("RearSight", (0.02, 0.008, 0.008), (0, -0.025, 0.05), gun, bevel=0)
    cyl("BarrelTip", 0.007, 0.01, (0, 0.155, 0.033), gun)
    muzzle((0, 0.16, 0.033))
    export("pistol.glb")


def prism(name, profile_yz, thickness, loc, material):
    """Flat extruded shape (e.g. a knife blade): profile is a list of (y, z) points."""
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    left = [bm.verts.new((-thickness / 2, y, z)) for y, z in profile_yz]
    right = [bm.verts.new((thickness / 2, y, z)) for y, z in profile_yz]
    bm.faces.new(left[::-1])
    bm.faces.new(right)
    n = len(profile_yz)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((left[i], left[j], right[j], right[i]))
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = loc
    bpy.context.view_layer.objects.active = o
    o.data.materials.append(material)
    return o


def build_sniper():
    gun = mat("Gunmetal", (0.03, 0.031, 0.034), 0.6, 0.42)
    poly = mat("Polymer", (0.035, 0.034, 0.032), 0.0, 0.65)
    od = mat("OD", (0.11, 0.12, 0.075), 0.0, 0.7)
    glass = mat("Lens", (0.05, 0.15, 0.12), 0.3, 0.05)
    box("Receiver", (0.06, 0.42, 0.075), (0, 0.05, 0.02), gun)
    box("Chassis", (0.064, 0.32, 0.062), (0, 0.38, -0.002), od, bevel=0.008)
    for i in range(6):
        box(f"Slot{i}", (0.066, 0.025, 0.014), (0, 0.27 + i * 0.045, 0.0), poly, bevel=0)
    cyl("Barrel", 0.013, 0.66, (0, 0.58, 0.032), gun)
    cyl("Brake", 0.022, 0.09, (0, 0.93, 0.032), gun, verts=6)
    box("Mag", (0.042, 0.09, 0.1), (0, 0.11, -0.07), poly, bevel=0.005)
    box("Grip", (0.034, 0.045, 0.115), (0, -0.04, -0.07), poly, rot=(18, 0, 0), bevel=0.008)
    box("TriggerGuard", (0.008, 0.08, 0.006), (0, 0.02, -0.075), gun, bevel=0)
    box("Stock", (0.05, 0.34, 0.085), (0, -0.33, -0.005), od, bevel=0.012)
    box("Cheek", (0.045, 0.17, 0.03), (0, -0.3, 0.055), od, bevel=0.01)
    box("ButtPad", (0.056, 0.03, 0.15), (0, -0.51, -0.02), poly, bevel=0.012)
    cyl("BoltArm", 0.006, 0.07, (0.04, -0.06, 0.04), gun, axis="X")
    cyl("BoltKnob", 0.013, 0.025, (0.08, -0.06, 0.04), gun, axis="X")
    # scope
    cyl("ScopeTube", 0.021, 0.34, (0, 0.06, 0.125), gun)
    cyl("ScopeBell", 0.033, 0.09, (0, 0.27, 0.125), gun)
    cyl("ScopeEye", 0.027, 0.07, (0, -0.14, 0.125), gun)
    cyl("LensFront", 0.029, 0.092, (0, 0.27, 0.125), glass, bevel=0)
    cyl("TurretTop", 0.012, 0.04, (0, 0.06, 0.155), gun, axis="Z")
    cyl("TurretSide", 0.012, 0.04, (0.032, 0.06, 0.125), gun, axis="X")
    box("RingA", (0.05, 0.02, 0.05), (0, -0.03, 0.098), gun)
    box("RingB", (0.05, 0.02, 0.05), (0, 0.15, 0.098), gun)
    # folded bipod
    box("BipodL", (0.008, 0.19, 0.008), (0.022, 0.62, -0.04), gun, bevel=0)
    box("BipodR", (0.008, 0.19, 0.008), (-0.022, 0.62, -0.04), gun, bevel=0)
    muzzle((0, 0.98, 0.032))
    export("sniper.glb")


def build_knife():
    steel = mat("Steel", (0.55, 0.56, 0.58), 0.9, 0.22)
    poly = mat("Polymer", (0.035, 0.034, 0.032), 0.0, 0.65)
    gun = mat("Gunmetal", (0.03, 0.031, 0.034), 0.6, 0.42)
    prism("Blade", [(0.035, -0.014), (0.18, -0.014), (0.235, 0.004), (0.205, 0.016), (0.035, 0.016)], 0.005, (0, 0, 0), steel)
    box("Guard", (0.02, 0.012, 0.055), (0, 0.03, 0.001), gun, bevel=0.002)
    box("Handle", (0.024, 0.105, 0.03), (0, -0.025, 0), poly, bevel=0.008)
    for i in range(4):
        box(f"Ridge{i}", (0.026, 0.006, 0.032), (0, -0.06 + i * 0.025, 0), gun, bevel=0)
    box("Pommel", (0.026, 0.016, 0.032), (0, -0.085, 0), gun, bevel=0.004)
    muzzle((0, 0.235, 0.004))
    export("knife.glb")


def build_grenade():
    olive = mat("Olive", (0.13, 0.15, 0.07), 0.1, 0.6)
    gun = mat("Gunmetal", (0.03, 0.031, 0.034), 0.6, 0.42)
    steel = mat("Steel", (0.55, 0.56, 0.58), 0.9, 0.22)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.034, location=(0, 0, 0))
    body = bpy.context.active_object
    body.name = "Body"
    body.scale = (1, 1, 1.22)
    bpy.ops.object.transform_apply(scale=True)
    finish(body, olive, bevel=0)
    for i in range(3):  # segmented grip bands
        cyl(f"Band{i}", 0.0345, 0.004, (0, 0, -0.02 + i * 0.02), olive, axis="Z", verts=20, bevel=0)
    cyl("Fuse", 0.012, 0.022, (0, 0, 0.047), gun, axis="Z", verts=16)
    box("Spoon", (0.012, 0.006, 0.075), (0, 0.022, 0.02), gun, rot=(-12, 0, 0), bevel=0.001)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.011, minor_radius=0.0018, location=(0.016, 0, 0.05), rotation=(0, 1.5708, 0))
    ring = bpy.context.active_object
    ring.name = "PinRing"
    finish(ring, steel, bevel=0)
    muzzle((0, 0, 0))
    export("grenade.glb")


clear()
build_rifle()
clear()
build_pistol()
clear()
build_sniper()
clear()
build_knife()
clear()
build_grenade()
