"""Blender 5.2: dashboard accent. Exports a static transparent PNG, never a runtime scene.
Run from repository root: blender -b --python scripts/design/render-dashboard-study.py
Then convert the output with sharp to study.webp.
"""
from pathlib import Path
import math
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/previews/dashboard"
OUT.mkdir(parents=True, exist_ok=True)
AUDIT = ROOT / "logs/design-audit"
AUDIT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

def material(name, color):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1)
    shader = next((node for node in value.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if shader is None:
        shader = value.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        output = value.node_tree.nodes.new("ShaderNodeOutputMaterial")
        value.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = .38
    return value

navy = material("EYWA navy", (.035, .115, .27))
yellow = material("Sticker yellow", (1, .64, .075))
paper = material("Warm paper", (.95, .95, .89))
mint = material("Attendance green", (.10, .57, .40))
white = material("White", (1, 1, 1))

def box(name, location, scale, mat, bevel=.06, rotation=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    obj.rotation_euler.z = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    mod = obj.modifiers.new("Soft corners", "BEVEL")
    mod.width = bevel
    mod.segments = 4
    obj.modifiers.new("Normals", "WEIGHTED_NORMAL")
    return obj

def book(name, z, mat, angle):
    parent = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(parent)
    for obj in [box("pages", (0,0,z+.16), (2.35,1.58,.25),paper,.025),
                box("bottom cover", (0,0,z), (2.5,1.7,.10),mat),
                box("top cover", (0,0,z+.32), (2.5,1.7,.10),mat),
                box("spine", (-1.20,0,z+.16), (.13,1.7,.32),mat)]:
        obj.parent = parent
    parent.rotation_euler.z = angle
    for idx in range(3):
        line = box("page line", (.06,-.797,z+.095+idx*.065), (2.05,.008,.008),navy,.001)
        line.parent = parent

book("Navy workbook", .1, navy, -.15)
book("Yellow workbook", .53, yellow, .12)
# A check token gives the still image an operational meaning, without rendered text.
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=.53, depth=.18, location=(.78,-.8,1.29), rotation=(math.pi/2,0,0))
coin = bpy.context.object
coin.data.materials.append(mint)
bevel = coin.modifiers.new("Round rim", "BEVEL")
bevel.width = .07
bevel.segments = 4
coin.modifiers.new("Normals", "WEIGHTED_NORMAL")
short = box("Check short", (.62,-.915,1.23), (.11,.065,.30),white,.04)
short.rotation_euler.y = -.65
long = box("Check long", (.88,-.92,1.31), (.11,.065,.49),white,.04)
long.rotation_euler.y = .65

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.threads_mode = "FIXED"
scene.render.threads = 4
scene.render.resolution_x = 720
scene.render.resolution_y = 600
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = str(OUT / "study.png")
scene.world.color = (.25,.25,.25)
scene.view_settings.view_transform = "AgX"
for location, power, size in [((-3,-4,7),700,5),((4,2,5),900,4)]:
    bpy.ops.object.light_add(type="AREA", location=location)
    obj=bpy.context.object
    obj.data.energy=power
    obj.data.shape="DISK"
    obj.data.size=size
    obj.rotation_euler=(Vector((0,0,.6))-obj.location).to_track_quat("-Z","Y").to_euler()
bpy.ops.object.camera_add(location=(3,-5,3.6))
camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,.85))-camera.location).to_track_quat("-Z","Y").to_euler()
camera.data.type="ORTHO"
camera.data.ortho_scale=3.8
scene.camera=camera
bpy.ops.wm.save_as_mainfile(filepath=str(AUDIT / "dashboard-study.blend"))
bpy.ops.render.render(write_still=True)
