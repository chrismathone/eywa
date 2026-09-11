"""Export the Blender classroom as actual geometry for the dev operations map.

Run render-classroom.py first, then this file with Blender --background --python.
Separate walls and furniture support cutaways and double-size labs.
"""
from pathlib import Path
import bpy
from mathutils import Matrix

root = Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(root / "logs/design-audit/classroom-preview.blend"))
bpy.ops.object.select_all(action="DESELECT")
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
for obj in meshes:
    obj.select_set(True)
    # The small room models do not need three bevel segments per edge.
    for modifier in obj.modifiers:
        if modifier.type == "BEVEL":
            modifier.segments = 1
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.convert(target="MESH")
parts = {"Classroom": [], "WallBack": [], "WallLeft": [], "Furniture": []}
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    if obj.name.startswith(("Back wall", "Blue skirting back", "Whiteboard", "Board")):
        parts["WallBack"].append(obj)
    elif obj.name.startswith(("Left wall", "Blue skirting left", "Window")):
        parts["WallLeft"].append(obj)
    elif obj.name.startswith(("Desk", "Chair")):
        # One complete desk/chair; the live scene places 4x4 or 6x4 instances.
        if obj.location.x < -1 and obj.location.y < -1.4:
            parts["Furniture"].append(obj)
    else:
        parts["Classroom"].append(obj)
joined = []
for name, objects in parts.items():
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    bpy.context.object.name = name
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    if name == "Furniture":
        bpy.context.object.data.transform(Matrix.Translation((1.65, 1.72, 0)))
    joined.append(bpy.context.object)
bpy.ops.object.select_all(action="DESELECT")
for obj in joined:
    obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(root / "public/previews/classroom/classroom.glb"),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
)
