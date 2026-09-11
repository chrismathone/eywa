import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { classroomSeats, FLOOR_HALL_WIDTH, FLOOR_HEIGHT, type SceneLayout } from "@/features/dashboard/classroom-preview/scene-layout";
import type { PresenceStatus } from "@/features/dashboard/classroom-preview/presence";

export type SceneReading = { id: string; color: string; seats: (PresenceStatus | null)[]; layoutCount: number; idle: boolean };
export type SceneController = {
  update: (readings: SceneReading[], selected: string | null) => void;
  focusFloor: (key: string | null, visibleIds: string[]) => void;
  zoom: (factor: number) => void;
  rotate: (radians: number) => void;
  fit: (roomId?: string) => void;
  dispose: () => void;
};
type Layer = { group: THREE.Group; materials: Set<THREE.Material>; opacity: number; target: number };
function disposeObjects(...roots: THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  roots.forEach((root) => root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m));
    }
  }));
  materials.forEach((m) => { for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value); });
  textures.forEach((t) => t.dispose()); geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
}

/** Render on interaction/data change only. Transitions stop after 420 ms. */
export async function createRoomScene({ host, layout, labels, floorLabels, signal, onPick, onPickFloor, onFailure }: {
  host: HTMLDivElement; layout: SceneLayout;
  labels: Map<string, HTMLButtonElement>; floorLabels: Map<string, HTMLButtonElement>;
  signal: AbortSignal; onPick: (id: string) => void; onPickFloor: (key: string) => void; onFailure: () => void;
}): Promise<SceneController> {
  const response = await fetch("/previews/classroom/classroom.glb", { signal });
  if (!response.ok) throw new Error("교실 모델을 불러오지 못했습니다.");
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
  if (signal.aborted) { disposeObjects(gltf.scene); throw new DOMException("Aborted", "AbortError"); }
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" }); }
  catch (error) { disposeObjects(gltf.scene); throw error; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.setClearColor("#edf3f8");
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label", "3D 건물. 층을 누르면 내부 보기. 좌우 방향키 회전, 위아래 방향키 확대·축소.");
  canvas.tabIndex = 0; canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline-offset:-3px";
  host.prepend(canvas);
  const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0x9eafbd, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-20, 45, 15); scene.add(sun);
  const camera = new THREE.OrthographicCamera(-30, 30, 20, -20, .1, 500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; controls.minPolarAngle = .12; controls.maxPolarAngle = 1.25;
  controls.minZoom = .65; controls.maxZoom = 5; controls.zoomSpeed = .7; controls.rotateSpeed = .65;
  const interiors = new Map<string, Layer>(), shells = new Map<string, Layer>();
  const allLayers: Layer[] = [];
  function layer(visible: boolean): Layer {
    const group = new THREE.Group(); group.visible = visible; scene.add(group);
    const value = { group, materials: new Set<THREE.Material>(), opacity: Number(visible), target: Number(visible) };
    allLayers.push(value); return value;
  }
  function material(target: Layer, color: string) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: .85 }); target.materials.add(m); return m;
  }
  function box(target: Layer, size: [number, number, number], position: [number, number, number], m: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), m); mesh.position.set(...position); target.group.add(mesh); return mesh;
  }
  const colors = new Map<string, THREE.MeshStandardMaterial[]>(), outlines = new Map<string, THREE.LineSegments>();
  const roomHits: THREE.Mesh[] = [], floorHits: THREE.Mesh[] = [];
  const cutaways: { object: THREE.Object3D; normal: THREE.Vector3 }[] = [];
  for (const plate of layout.floors) {
    const inside = layer(false), outside = layer(true); interiors.set(plate.key, inside); shells.set(plate.key, outside);
    const cx = plate.x + plate.width / 2, cz = plate.z + plate.depth / 2;
    const porcelain = material(inside, "#e1e8ed"), hall = material(inside, "#e4ded1");
    box(inside, [plate.width, .3, plate.depth], [cx, plate.y - .65, cz], porcelain);
    box(inside, [FLOOR_HALL_WIDTH, .12, plate.depth - .4], [cx, plate.y - .28, cz], hall);
    box(inside, [.055, .02, plate.depth - .6], [cx, plate.y - .21, cz], material(inside, "#f8f5ee"));
    const wallMaterial = material(inside, "#cbd7df");
    for (const side of [-1, 1]) {
      const wallX = box(inside, [.18, 3, plate.depth], [cx + side * (plate.width / 2 - .09), plate.y + 1.2, cz], wallMaterial);
      const wallZ = box(inside, [plate.width, 3, .18], [cx, plate.y + 1.2, cz + side * (plate.depth / 2 - .09)], wallMaterial);
      cutaways.push({ object: wallX, normal: new THREE.Vector3(side, 0, 0) }, { object: wallZ, normal: new THREE.Vector3(0, 0, side) });
    }
    // Opaque facade: overview has no interior drawing cost.
    const facade = material(outside, "#dce5ec"), trim = material(outside, "#9daebc");
    const glass = material(outside, "#3f647b"), mullion = material(outside, "#c2cfd9");
    const body = box(outside, [plate.width, FLOOR_HEIGHT - .12, plate.depth], [cx, plate.y + FLOOR_HEIGHT / 2 - .6, cz], facade);
    body.userData.floorKey = plate.key; floorHits.push(body);
    box(outside, [plate.width + .35, .22, plate.depth + .35], [cx, plate.y - .52, cz], trim);
    box(outside, [plate.width + .25, .24, plate.depth + .25], [cx, plate.y + FLOOR_HEIGHT - .6, cz], facade);
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
      const p = (i + .5) / 6;
      for (const axis of ["x", "z"] as const) {
        const span = axis === "x" ? plate.depth : plate.width;
        const pos: [number, number, number] = axis === "x"
          ? [cx + side * (plate.width / 2 + .025), plate.y + 2.1, plate.z + p * plate.depth]
          : [plate.x + p * plate.width, plate.y + 2.1, cz + side * (plate.depth / 2 + .025)];
        box(outside, axis === "x" ? [.05, 2.5, span / 6 - .75] : [span / 6 - .75, 2.5, .05], pos, glass);
        box(outside, axis === "x" ? [.09, 2.55, .055] : [.055, 2.55, .09], pos, mullion);
      }
    }
  }
  const sourceFurniture = gltf.scene.getObjectByName("Furniture"); gltf.scene.updateMatrixWorld(true);
  const idleBoards = new Map<string, THREE.Group>();
  let idleTextureReady = false;
  const idleTexture = new THREE.TextureLoader().load("/previews/classroom/idle-board.png", (texture) => {
    if (disposed) { texture.dispose(); return; }
    idleTextureReady = true;
    for (const board of idleBoards.values()) board.visible = board.userData.idle === true;
    invalidate();
  });
  idleTexture.colorSpace = THREE.SRGBColorSpace;
  const boardGeometry = new THREE.PlaneGeometry(3.42, 1.22);
  const furnitureGroups = new Map<string, {
    group: THREE.Group; meshes: { mesh: THREE.InstancedMesh; transform: THREE.Matrix4 }[];
    capacity: number; layoutCount: number; count: number; positions: { x: number; z: number }[];
  }>();
  for (const placed of layout.rooms) {
    const inside = interiors.get(placed.floorKey)!, model = gltf.scene.clone(true);
    model.getObjectByName("Furniture")?.removeFromParent();
    const tintMaterials: THREE.MeshStandardMaterial[] = [], clones = new Map<THREE.Material, THREE.Material>();
    function cloneMaterial(original: THREE.Material) {
      let m = clones.get(original);
      if (!m) {
        m = original.clone(); clones.set(original, m); inside.materials.add(m);
        if (m instanceof THREE.MeshStandardMaterial && (m.name === "Floor" || m.name === "Eywa blue")) tintMaterials.push(m);
      }
      return m;
    }
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
    });
    // The illustration asset has two walls. Complete the opposite sides for orbiting.
    const newWallMaterial = material(inside, "#dce3e9");
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(.16, 2.65, 5.15), newWallMaterial);
    rightWall.name = "WallRight"; rightWall.position.set(3.04, 1.3, 0); model.add(rightWall);
    const frontWall = new THREE.Group(); frontWall.name = "WallFront";
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.475, 2.65, .16), newWallMaterial);
      panel.position.set(side * 1.8875, 1.3, 2.58); frontWall.add(panel);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.3, .6, .16), newWallMaterial);
    lintel.position.set(0, 2.325, 2.58); frontWall.add(lintel); model.add(frontWall);
    model.position.set(placed.x, placed.y - .2, placed.z); model.rotation.y = placed.rotation; model.scale.set(placed.scaleX, 1, placed.scaleZ); inside.group.add(model);
    for (const [name, normal] of [["WallBack", new THREE.Vector3(0, 0, -1)], ["WallLeft", new THREE.Vector3(-1, 0, 0)], ["WallRight", new THREE.Vector3(1, 0, 0)], ["WallFront", new THREE.Vector3(0, 0, 1)]] as const) {
      const object = model.getObjectByName(name);
      if (object) cutaways.push({ object, normal: normal.applyAxisAngle(new THREE.Vector3(0, 1, 0), placed.rotation) });
    }
    const boardMaterial = new THREE.MeshBasicMaterial({ map: idleTexture, toneMapped: false });
    const background = new THREE.MeshBasicMaterial({ color: "#204f4c", toneMapped: false });
    inside.materials.add(boardMaterial); inside.materials.add(background);
    const board = new THREE.Group();
    board.add(new THREE.Mesh(boardGeometry, background));
    const lettering = new THREE.Mesh(boardGeometry, boardMaterial);
    lettering.scale.x = 1 / placed.scaleX; lettering.position.z = .01; board.add(lettering);
    board.position.set(.35, 1.65, -2.25); board.visible = false;
    model.getObjectByName("WallBack")?.add(board); idleBoards.set(placed.id, board);
    const furniture = new THREE.Group(); furniture.position.copy(model.position); furniture.rotation.y = placed.rotation;
    const capacity = placed.lab ? 24 : 16;
    const meshes: { mesh: THREE.InstancedMesh; transform: THREE.Matrix4 }[] = [];
    sourceFurniture?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const m = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
      const desks = new THREE.InstancedMesh(object.geometry, m, capacity);
      desks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); desks.count = 0;
      furniture.add(desks); meshes.push({ mesh: desks, transform: object.matrixWorld.clone() });
    });
    furniture.visible = false;
    furnitureGroups.set(placed.id, { group: furniture, meshes, capacity, layoutCount: 0, count: 0, positions: [] });
    inside.group.add(furniture); colors.set(placed.id, tintMaterials);
    const footprint = new THREE.BoxGeometry(placed.width - .05, .08, placed.depth - .05);
    const lineMaterial = new THREE.LineBasicMaterial({ color: "#173e76", depthTest: false }); inside.materials.add(lineMaterial);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(footprint), lineMaterial); footprint.dispose();
    outline.position.set(placed.x, placed.y - .08, placed.z); outline.visible = false; outline.renderOrder = 1;
    inside.group.add(outline); outlines.set(placed.id, outline);
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(placed.width, placed.depth), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    hit.rotation.x = -Math.PI / 2; hit.position.set(placed.x, placed.y, placed.z); hit.userData.roomId = placed.id; hit.userData.floorKey = placed.floorKey;
    inside.group.add(hit); roomHits.push(hit);
  }
  const headGeometry = new THREE.SphereGeometry(.21, 8, 6), bodyGeometry = new THREE.CylinderGeometry(.18, .23, .44, 7);
  const peopleResources = new THREE.Group(), resourceMaterial = new THREE.MeshBasicMaterial();
  peopleResources.add(new THREE.Mesh(headGeometry, resourceMaterial), new THREE.Mesh(bodyGeometry, resourceMaterial));
  const peopleGroups = new Map<string, { group: THREE.Group; heads: THREE.InstancedMesh; bodies: THREE.InstancedMesh; capacity: number }>();
  const personMatrix = new THREE.Matrix4(), personColor = new THREE.Color();
  const personColors = { present: "#245e86", late: "#bd8436", makeup: "#87659c" };
  function updateFurniture(reading: SceneReading) {
    const entry = furnitureGroups.get(reading.id), placed = layout.rooms.find((r) => r.id === reading.id);
    if (!entry || !placed) return;
    const count = reading.seats.length, layoutCount = Math.max(placed.lab ? 24 : 16, reading.layoutCount, count);
    if (entry.count === count && entry.layoutCount === layoutCount) return;
    if (layoutCount > entry.capacity) {
      for (const part of entry.meshes) {
        const next = new THREE.InstancedMesh(part.mesh.geometry, part.mesh.material, layoutCount);
        next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        part.mesh.removeFromParent(); part.mesh.dispose(); part.mesh = next; entry.group.add(next);
      }
      entry.capacity = layoutCount;
    }
    entry.positions = classroomSeats(placed, layoutCount);
    entry.layoutCount = layoutCount; entry.count = count; entry.group.visible = count > 0;
    for (const part of entry.meshes) {
      part.mesh.count = count;
      entry.positions.slice(0, count).forEach((seat, i) => part.mesh.setMatrixAt(i, personMatrix.makeTranslation(seat.x, 0, seat.z).multiply(part.transform)));
      part.mesh.instanceMatrix.needsUpdate = true;
      if (count) part.mesh.computeBoundingSphere();
    }
  }
  function updatePeople(id: string, seats: (PresenceStatus | null)[]) {
    const occupied = seats.filter(Boolean).length;
    let entry = peopleGroups.get(id); if (!entry && !occupied) return;
    const placed = layout.rooms.find((r) => r.id === id); if (!placed) return;
    const inside = interiors.get(placed.floorKey)!;
    if (!entry || entry.capacity < occupied) {
      const headMaterial = entry?.heads.material ?? material(inside, "#deb794"), bodyMaterial = entry?.bodies.material ?? material(inside, "#ffffff");
      if (entry) { entry.group.removeFromParent(); entry.heads.dispose(); entry.bodies.dispose(); }
      const capacity = Math.max(24, occupied);
      const heads = new THREE.InstancedMesh(headGeometry, headMaterial, capacity), bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, capacity);
      heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage); bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const group = new THREE.Group(); group.position.set(placed.x, placed.y - .2, placed.z); group.rotation.y = placed.rotation;
      group.add(heads, bodies); inside.group.add(group); entry = { group, heads, bodies, capacity }; peopleGroups.set(id, entry);
    }
    entry.group.visible = occupied > 0; entry.heads.count = entry.bodies.count = occupied;
    const positions = furnitureGroups.get(id)!.positions;
    let person = 0;
    seats.forEach((status, seatIndex) => {
      if (!status) return;
      const seat = positions[seatIndex];
      entry!.heads.setMatrixAt(person, personMatrix.makeTranslation(seat.x, 1.28, seat.z + .55));
      entry!.bodies.setMatrixAt(person, personMatrix.makeTranslation(seat.x, .94, seat.z + .55));
      entry!.bodies.setColorAt(person++, personColor.set(personColors[status]));
    });
    entry.heads.instanceMatrix.needsUpdate = entry.bodies.instanceMatrix.needsUpdate = true;
    if (entry.bodies.instanceColor) entry.bodies.instanceColor.needsUpdate = true;
    if (occupied) { entry.heads.computeBoundingSphere(); entry.bodies.computeBoundingSphere(); }
  }
  let disposed = false, frame = 0, width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
  let focusedFloor: string | null = null, focusedRoom: string | undefined;
  let visibleRooms = new Set(layout.rooms.map((r) => r.id));
  let fade: { start: number; from: number[] } | null = null;
  type CameraMove = { start: number; position: THREE.Vector3; target: THREE.Vector3; size: number; zoom: number; toPosition: THREE.Vector3; toTarget: THREE.Vector3; toSize: number };
  let cameraMove: CameraMove | null = null;
  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 420;
  const projected = new THREE.Vector3(), direction = new THREE.Vector3();
  function placeLabels() {
    for (const placed of layout.rooms) {
      const element = labels.get(placed.id); if (!element) continue;
      projected.set(placed.labelX, placed.y + .4, placed.z).project(camera);
      const x = (projected.x * .5 + .5) * width, y = (-projected.y * .5 + .5) * height;
      element.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
      element.hidden = placed.floorKey !== focusedFloor || !visibleRooms.has(placed.id) || !!cameraMove || projected.z < -1 || projected.z > 1 || x < 0 || x > width || y < 0 || y > height;
      element.style.setProperty("--label-width", placed.lab ? "68px" : "42px");
    }
    for (const plate of layout.floors) {
      const element = floorLabels.get(plate.key); if (!element) continue;
      element.hidden = focusedFloor !== null || !!cameraMove || !plate.roomIds.some((id) => visibleRooms.has(id));
      let right = -Infinity;
      for (const x of [plate.x, plate.x + plate.width]) for (const z of [plate.z, plate.z + plate.depth]) {
        projected.set(x, plate.y + 2, z).project(camera); right = Math.max(right, (projected.x * .5 + .5) * width);
      }
      projected.set(plate.x + plate.width / 2, plate.y + 2, plate.z + plate.depth / 2).project(camera);
      const x = right + 16, y = (-projected.y * .5 + .5) * height;
      element.style.transform = `translate3d(${x}px,${y}px,0) translateY(-50%)`;
      element.hidden ||= x + element.offsetWidth > width || y < 12 || y > height - 12;
    }
  }
  function applyLayers() {
    for (const entry of allLayers) {
      entry.group.visible = entry.opacity > .001;
      for (const m of entry.materials) {
        const transparent = entry.opacity < .999;
        if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
        m.opacity = entry.opacity; m.depthWrite = !transparent;
      }
    }
  }
  function projection(size: number) {
    camera.left = -size * width / height / 2; camera.right = -camera.left; camera.top = size / 2; camera.bottom = -camera.top; camera.updateProjectionMatrix();
  }
  function draw(now: number) {
    frame = 0; if (disposed || document.visibilityState !== "visible") return;
    if (fade) {
      const t = Math.min(1, (now - fade.start) / duration), eased = t * t * (3 - 2 * t);
      allLayers.forEach((entry, i) => { entry.opacity = THREE.MathUtils.lerp(fade!.from[i], entry.target, eased); });
      if (t === 1) fade = null;
    }
    applyLayers();
    if (cameraMove) {
      const t = Math.min(1, (now - cameraMove.start) / duration), eased = t * t * (3 - 2 * t);
      camera.position.lerpVectors(cameraMove.position, cameraMove.toPosition, eased); controls.target.lerpVectors(cameraMove.target, cameraMove.toTarget, eased);
      camera.zoom = THREE.MathUtils.lerp(cameraMove.zoom, 1, eased); projection(THREE.MathUtils.lerp(cameraMove.size, cameraMove.toSize, eased)); camera.lookAt(controls.target);
      if (t === 1) { cameraMove = null; controls.enabled = true; controls.update(); }
    }
    camera.updateMatrixWorld(); camera.getWorldDirection(direction);
    for (const wall of cutaways) wall.object.visible = wall.normal.dot(direction) >= -.015;
    renderer.render(scene, camera); placeLabels();
    canvas.dataset.frames = String(Number(canvas.dataset.frames ?? 0) + 1); canvas.dataset.triangles = String(renderer.info.render.triangles);
    canvas.dataset.focusedFloor = focusedFloor ?? "building";
    canvas.dataset.visibleInteriors = String([...interiors.values()].filter((l) => l.group.visible).length);
    canvas.dataset.visibleShells = String([...shells.values()].filter((l) => l.group.visible).length);
    canvas.dataset.visibleWalls = String(cutaways.filter((w) => w.object.visible).length);
    const visibleIds = layout.rooms.filter((r) => r.floorKey === focusedFloor).map((r) => r.id);
    canvas.dataset.floorDesks = String(visibleIds.reduce((sum, id) => sum + (furnitureGroups.get(id)?.meshes[0]?.mesh.count ?? 0), 0));
    canvas.dataset.floorPeople = String(visibleIds.reduce((sum, id) => sum + (peopleGroups.get(id)?.heads.count ?? 0), 0));
    canvas.dataset.idleBoards = String(visibleIds.filter((id) => idleBoards.get(id)?.visible).length);
    if (fade || cameraMove) invalidate();
  }
  function invalidate() { if (!disposed && !frame) frame = requestAnimationFrame(draw); }
  controls.addEventListener("change", invalidate);
  function fit(roomId?: string, animate = true) {
    focusedRoom = roomId;
    const room = layout.rooms.find((r) => r.id === roomId && r.floorKey === focusedFloor), floor = layout.floors.find((f) => f.key === focusedFloor);
    const target = new THREE.Vector3(room?.x ?? (floor ? floor.x + floor.width / 2 : 0), room ? room.y + .8 : floor ? floor.y + .8 : (layout.height + FLOOR_HEIGHT) / 2 - .5, room?.z ?? (floor ? floor.z + floor.depth / 2 : 0));
    const viewDirection = room ? new THREE.Vector3(.2, 1.05, 1.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), room.rotation)
      : floor ? new THREE.Vector3(.35, 1.2, .8) : new THREE.Vector3(.8, .65, 1.25);
    const position = target.clone().add(viewDirection.normalize().multiplyScalar(90));
    const scratch = camera.clone(); scratch.position.copy(position); scratch.lookAt(target); scratch.updateMatrixWorld();
    const w = room ? room.width + 2 : floor ? floor.width + 1.5 : layout.width + 1;
    const d = room ? room.depth + 2 : floor ? floor.depth + 1.5 : layout.depth + 1;
    const corners: THREE.Vector3[] = [];
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) for (const y of floor ? [floor.y - .9, floor.y + 3] : [-1, layout.height + FLOOR_HEIGHT]) {
      corners.push(new THREE.Vector3(target.x + x, y, target.z + z).applyMatrix4(scratch.matrixWorldInverse));
    }
    const bounds = new THREE.Box3().setFromPoints(corners).getSize(new THREE.Vector3());
    // Screen space reserved for external floor links.
    const labelSpace = floor ? 24 : Math.min(100, width * .2);
    const toSize = Math.max(bounds.y, bounds.x * height / Math.max(1, width - labelSpace * 2)) * 1.06;
    if (animate) {
      cameraMove = { start: performance.now(), position: camera.position.clone(), target: controls.target.clone(), size: camera.top * 2, zoom: camera.zoom, toPosition: position, toTarget: target, toSize }; controls.enabled = false;
    } else {
      cameraMove = null; camera.position.copy(position); controls.target.copy(target); camera.zoom = 1; camera.lookAt(target); projection(toSize); controls.enabled = true; controls.update();
    }
    invalidate();
  }
  renderer.setSize(width, height, false); fit(undefined, false);
  const resize = new ResizeObserver(() => {
    width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight); renderer.setSize(width, height, false); fit(focusedRoom, false);
  }); resize.observe(host);
  const zoom = (factor: number) => {
    cameraMove = null; controls.enabled = true; camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, .65, 5); camera.updateProjectionMatrix(); controls.update(); invalidate();
  };
  const rotate = (radians: number) => {
    cameraMove = null; controls.enabled = true; camera.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), radians).add(controls.target); camera.lookAt(controls.target); controls.update(); invalidate();
  };
  let pointer: { x: number; y: number; id: number } | null = null;
  const onDown = (event: PointerEvent) => { if (pointer) { pointer = null; return; } if (event.button === 0) pointer = { x: event.clientX, y: event.clientY, id: event.pointerId }; };
  const onUp = (event: PointerEvent) => {
    const start = pointer; pointer = null;
    if (!start || cameraMove || start.id !== event.pointerId || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5) return;
    const rect = canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / width * 2 - 1, -(event.clientY - rect.top) / height * 2 + 1), camera);
    const targets = focusedFloor ? roomHits.filter((h) => h.userData.floorKey === focusedFloor && visibleRooms.has(h.userData.roomId)) : floorHits.filter((h) => layout.floors.find((f) => f.key === h.userData.floorKey)?.roomIds.some((id) => visibleRooms.has(id)));
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) { if (focusedFloor) onPick(hit.object.userData.roomId); else onPickFloor(hit.object.userData.floorKey); }
  };
  const onCancel = () => { pointer = null; };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") rotate(-.22); else if (event.key === "ArrowRight") rotate(.22);
    else if (event.key === "ArrowUp" || event.key === "+") zoom(1.2); else if (event.key === "ArrowDown" || event.key === "-") zoom(1 / 1.2);
    else if (event.key === "Home") fit(); else return; event.preventDefault();
  };
  const contextLost = (event: Event) => { event.preventDefault(); if (!disposed) onFailure(); };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("keydown", onKey); canvas.addEventListener("webglcontextlost", contextLost); document.addEventListener("visibilitychange", invalidate);
  return {
    update(readings, selected) {
      canvas.dataset.people = String(readings.reduce((n, r) => n + r.seats.filter(Boolean).length, 0));
      canvas.dataset.desks = String(readings.reduce((n, r) => n + r.seats.length, 0));
      for (const reading of readings) {
        updateFurniture(reading); updatePeople(reading.id, reading.seats);
        const idleBoard = idleBoards.get(reading.id);
        if (idleBoard) { idleBoard.userData.idle = reading.idle; idleBoard.visible = idleTextureReady && reading.idle; }
        for (const m of colors.get(reading.id) ?? []) { m.color.set(reading.color); if (m.name === "Floor") m.color.lerp(new THREE.Color("#ffffff"), .55); }
        const outline = outlines.get(reading.id); if (outline) outline.visible = reading.id === selected;
      }
      invalidate();
    },
    focusFloor(key, visibleIds) {
      visibleRooms = new Set(visibleIds);
      const next = layout.floors.some((f) => f.key === key) ? key : null;
      if (next !== focusedFloor) {
        focusedFloor = next; focusedRoom = undefined;
        for (const [id, l] of interiors) l.target = Number(id === next);
        for (const l of shells.values()) l.target = Number(next === null);
        fade = { start: performance.now(), from: allLayers.map((l) => l.opacity) }; fit();
      }
      invalidate();
    },
    zoom, rotate, fit,
    dispose() {
      disposed = true; cancelAnimationFrame(frame); resize.disconnect(); controls.removeEventListener("change", invalidate); controls.dispose();
      document.removeEventListener("visibilitychange", invalidate);
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("keydown", onKey); canvas.removeEventListener("webglcontextlost", contextLost);
      disposeObjects(scene, gltf.scene, peopleResources); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
