"""Render a reusable classroom illustration with Blender (no student/room data).

blender --background --threads 4 --python scripts/design/render-classroom.py
Output: public/previews/classroom/*.png, editable scene in logs/design-audit/.
Desk positions are illustrative, not a floor plan or an attendance visualization.
"""
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "previews" / "classroom"
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    bsdf = next((node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        output = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
        mat.node_tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = 0.68
    return mat


white = material("Porcelain", (0.88, 0.92, 0.97))
floor = material("Floor", (0.72, 0.79, 0.86))
wood = material("Birch", (0.68, 0.48, 0.28))
metal = material("Desk legs", (0.29, 0.37, 0.45))
blue = material("Eywa blue", (0.045, 0.19, 0.39))
window = material("Window glass", (0.44, 0.72, 0.85))
chalk = material("Chalk", (0.72, 0.86, 0.93))


def box(name, location, size, mat, bevel=0.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("Soft edges", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


box("Foundation", (0, 0, -0.18), (6.3, 5.4, 0.36), white, 0.12)
box("Floor", (0, 0, 0.025), (6.05, 5.15, 0.09), floor)
box("Back wall", (0, 2.58, 1.3), (6.25, 0.16, 2.65), white)
box("Left wall", (-3.04, 0, 1.3), (0.16, 5.15, 2.65), white)
box("Blue skirting back", (0, 2.45, 0.19), (6.0, 0.07, 0.23), blue)
box("Blue skirting left", (-2.94, 0, 0.19), (0.07, 5.0, 0.23), blue)
box("Whiteboard frame", (0.35, 2.43, 1.65), (3.6, 0.14, 1.38), metal)
box("Board", (0.35, 2.33, 1.65), (3.42, 0.055, 1.22), blue)
for index, width in enumerate((1.2, 1.65, 0.85)):
    box("Board writing", (-0.35 + width / 2, 2.285, 1.95 - index * 0.23), (width, 0.012, 0.026), chalk, 0.006)
box("Window frame", (-2.91, -0.05, 1.65), (0.10, 2.5, 1.35), metal)
box("Window", (-2.83, -0.05, 1.65), (0.06, 2.3, 1.17), window)
box("Window vertical divider", (-2.78, -0.05, 1.65), (0.05, 0.045, 1.18), white, 0.006)
box("Window horizontal divider", (-2.78, -0.05, 1.65), (0.05, 2.3, 0.045), white, 0.006)

for x in (-1.65, 0, 1.65):
    for y in (-1.72, -0.3, 1.12):
        box("Desk top", (x, y, 0.86), (1.04, 0.61, 0.12), wood, 0.065)
        for dx in (-0.4, 0.4):
            for dy in (-0.20, 0.20):
                box("Desk leg", (x + dx, y + dy, 0.44), (0.045, 0.045, 0.77), metal, 0.008)
        box("Chair seat", (x, y - 0.55, 0.46), (0.61, 0.5, 0.10), blue, 0.06)
        box("Chair back", (x, y - 0.77, 0.76), (0.61, 0.10, 0.56), blue, 0.07)
        for dx in (-0.23, 0.23):
            box("Chair legs", (x + dx, y - 0.55, 0.25), (0.045, 0.4, 0.42), metal, 0.012)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.threads_mode = "FIXED"
scene.render.threads = 4
scene.render.resolution_x = 720
scene.render.resolution_y = 540
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.world.color = (0.45, 0.45, 0.45)
scene.view_settings.view_transform = "AgX"

bpy.ops.object.light_add(type="AREA", location=(1, -4, 9))
bpy.context.object.data.energy = 1100
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = 8
bpy.ops.object.light_add(type="AREA", location=(-4, -1, 5))
bpy.context.object.data.energy = 450
bpy.context.object.data.size = 5
bpy.ops.object.camera_add(location=(9, -12, 10))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 0.65)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 10.4
scene.camera = camera

scene_dir = ROOT / "logs" / "design-audit"
scene_dir.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(scene_dir / "classroom-preview.blend"))
scene.render.filepath = str(OUT / "classroom.png")
bpy.ops.render.render(write_still=True)
