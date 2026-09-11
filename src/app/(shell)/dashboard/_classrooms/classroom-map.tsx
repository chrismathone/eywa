"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { buildSceneLayout, FLOOR_HALL_WIDTH, MAP_COLORS, roomMapState, type SceneLayout } from "@/features/dashboard/classroom-preview/scene-layout";
import type { Classroom } from "@/features/dashboard/classroom-preview/model";
import type { RoomSeating } from "@/features/dashboard/classroom-preview/seating";
import { roomGroupOf } from "@/features/timetable/lib/room-groups";
import type { SceneController } from "./three-scene";
import s from "./classroom-map.module.css";

type Props = {
  rooms: Classroom[]; minute: number | null; selectedId: string | null; view: "2d" | "3d";
  allRooms: Classroom[]; focusedFloor: string | null;
  seating: Record<string, RoomSeating>;
  showPeople: boolean;
  onChoose: (room: Classroom) => void; onFloor: (key: string) => void; onFallback: () => void;
};

export function ClassroomMap(props: Props) {
  const signature = JSON.stringify((props.view === "3d" ? props.allRooms : props.rooms).map(({ id, name }) => ({ id, name })));
  const isStacked = props.view === "3d";
  const layout = useMemo(() => buildSceneLayout(JSON.parse(signature), isStacked), [signature, isStacked]);
  if (!props.rooms.length) return <p className={s.empty}>표시할 교실이 없습니다. 검색어나 선택한 층을 확인해 주세요.</p>;
  return <MapSurface key={`${props.view}:${signature}`} {...props} layout={layout} />;
}

function MapSurface({ rooms, allRooms, focusedFloor, minute, selectedId, view, seating, showPeople, onChoose, onFloor, onFallback, layout }: Props & { layout: SceneLayout }) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const floorLabels = useRef(new Map<string, HTMLButtonElement>());
  const controller = useRef<SceneController | null>(null);
  const callbacks = useRef({ onChoose, onFloor, onFallback, rooms: allRooms });
  const [ready, setReady] = useState(view === "2d");
  const [flatView, setFlatView] = useState({ zoom: 1, x: 0, z: 0 });
  const [size, setSize] = useState({ width: 1, height: 1 });
  const readings = (view === "3d" ? allRooms : rooms).map((room) => ({ ...roomMapState(room, minute), room }));
  const readingSignature = JSON.stringify(readings.map(({ room, color, mapStatus }) => ({ id: room.id, color, seats: (seating[room.id]?.seats ?? []).map((status) => showPeople ? status : null), layoutCount: seating[room.id]?.layoutCount ?? 0, idle: mapStatus === "idle" || mapStatus === "next" })));
  const visibleSignature = JSON.stringify(rooms.map((room) => room.id));
  const latest = useRef({ readingSignature, selectedId, focusedFloor, visibleSignature });

  useEffect(() => { callbacks.current = { onChoose, onFloor, onFallback, rooms: allRooms }; }, [onChoose, onFloor, onFallback, allRooms]);
  useEffect(() => {
    latest.current = { readingSignature, selectedId, focusedFloor, visibleSignature };
    controller.current?.update(JSON.parse(readingSignature), selectedId);
    controller.current?.focusFloor(focusedFloor, JSON.parse(visibleSignature));
  }, [readingSignature, selectedId, focusedFloor, visibleSignature]);

  useEffect(() => {
    if (view !== "3d" || !host.current) return;
    const abort = new AbortController();
    const element = host.current;
    let scene: SceneController | undefined;
    void import("./three-scene").then(({ createRoomScene }) => {
      if (abort.signal.aborted) return;
      return createRoomScene({ host: element, layout, labels: labels.current, floorLabels: floorLabels.current,
        signal: abort.signal,
        onPick: (id) => {
          const room = callbacks.current.rooms.find((room) => room.id === id);
          if (room) {
            callbacks.current.onChoose(room);
            controller.current?.fit(room.id);
          }
        },
        onPickFloor: (key) => callbacks.current.onFloor(key),
        onFailure: () => callbacks.current.onFallback(),
      });
    }).then((created) => {
      if (!created) return;
      if (abort.signal.aborted) { created.dispose(); return; }
      scene = created; controller.current = created;
      created.update(JSON.parse(latest.current.readingSignature), latest.current.selectedId);
      created.focusFloor(latest.current.focusedFloor, JSON.parse(latest.current.visibleSignature));
      if (latest.current.selectedId) created.fit(latest.current.selectedId);
      setReady(true);
    }).catch(() => { if (!abort.signal.aborted) callbacks.current.onFallback(); });
    return () => { abort.abort(); scene?.dispose(); controller.current = null; };
  }, [view, layout]);

  useEffect(() => {
    if (view !== "2d" || !host.current) return;
    const element = host.current;
    const observer = new ResizeObserver(() => setSize({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [view]);

  // The same x/z coordinates position both the plan and the WebGL objects.
  const scale = Math.min(size.width / (layout.width + 4), size.height / (layout.depth + 5)) * flatView.zoom;
  const point = (x: number, z: number) => ({ x: (x - flatView.x) * scale + size.width / 2, y: (z - flatView.z) * scale + size.height / 2 });
  const flatStyle = (x: number, z: number, labelWidth?: number): CSSProperties => {
    const p = point(x, z);
    return { transform: `translate(${p.x}px,${p.y}px) translate(-50%,-50%)`, ...(labelWidth ? { "--label-width": `${Math.min(190, Math.max(30, labelWidth))}px` } : {}) } as CSSProperties;
  };
  const zoom = (factor: number) => view === "3d" ? controller.current?.zoom(factor) : setFlatView((v) => ({ ...v, zoom: Math.max(.65, Math.min(5, v.zoom * factor)) }));
  const fit = (id?: string) => {
    if (view === "3d") { controller.current?.fit(id); return; }
    const room = layout.rooms.find((room) => room.id === id);
    setFlatView(room ? { zoom: Math.min(4, (layout.width + 4) / 12), x: room.x, z: room.z } : { zoom: 1, x: 0, z: 0 });
  };
  const placedById = new Map(layout.rooms.map((room) => [room.id, room]));
  const drag = useRef<{ id: number; x: number; y: number; originX: number; originZ: number } | null>(null);

  return <div className={s.map} data-view={view} data-ready={ready}>
    <div className={s.legend} aria-label="교실 상태 범례">
      <span><i style={{ background: MAP_COLORS.ongoing }} />수업 중</span>
      <span><i style={{ background: MAP_COLORS.next }} />다음 수업 대기</span>
      <span><i style={{ background: MAP_COLORS.idle }} />남은 수업 없음</span>
      {view === "3d" && focusedFloor && <button className={s.stackToggle} onClick={() => onFloor("all")}>← 건물 전체 보기</button>}
    </div>
    <div ref={host} className={s.scene} onPointerDown={view === "2d" ? (event) => {
      if ((event.target as HTMLElement).closest("button") || event.button !== 0) return;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, originX: flatView.x, originZ: flatView.z };
      event.currentTarget.setPointerCapture(event.pointerId);
    } : undefined} onPointerMove={view === "2d" ? (event) => {
      const start = drag.current;
      if (!start || event.pointerId !== start.id) return;
      setFlatView((v) => ({ ...v, x: start.originX - (event.clientX - start.x) / scale, z: start.originZ - (event.clientY - start.y) / scale }));
    } : undefined} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {view === "2d" && <svg className={s.plan} width="100%" height="100%" aria-hidden>
        {layout.floors.map((floor) => {
          const p = point(floor.x, floor.z);
          return <g key={floor.key}>
            <rect x={p.x} y={p.y} width={floor.width * scale} height={floor.depth * scale} rx={7} fill="#e1e9f0" stroke="#b7c6d3" />
            <rect x={p.x + (floor.width - FLOOR_HALL_WIDTH) / 2 * scale} y={p.y + .2 * scale} width={FLOOR_HALL_WIDTH * scale} height={(floor.depth - .4) * scale} fill="#e8e1d4" />
            <line x1={p.x + floor.width / 2 * scale} x2={p.x + floor.width / 2 * scale} y1={p.y + 2.2 * scale} y2={p.y + (floor.depth - 1.2) * scale} stroke="#f9f7f1" strokeDasharray="4 4" />
            <text x={p.x + floor.width / 2 * scale} y={p.y + (floor.depth - 1) * scale} textAnchor="middle" fill="#827762" fontSize={10}>복도</text>
          </g>;
        })}
        {readings.map(({ room, color }) => {
          const placed = placedById.get(room.id)!;
          const p = point(placed.x - placed.width / 2, placed.z - placed.depth / 2);
          return <g key={room.id}>
            <rect x={p.x} y={p.y} width={placed.width * scale} height={placed.depth * scale} rx={4} fill="white" stroke={room.id === selectedId ? "#173e76" : "#b7c6d3"} strokeWidth={room.id === selectedId ? 2.5 : 1} />
            <rect x={p.x + 1} y={p.y + 1} width={placed.width * scale - 2} height={Math.max(3, .28 * scale)} rx={2} fill={color} />
          </g>;
        })}
      </svg>}
      <div className={s.labels} style={{ visibility: ready ? "visible" : "hidden" }}>
        {layout.floors.map((floor) => <button key={floor.key} ref={(element) => { if (element) floorLabels.current.set(floor.key, element); else floorLabels.current.delete(floor.key); }}
          className={s.floorLabel} data-floor={floor.label} style={view === "2d" ? flatStyle(floor.x + floor.width / 2, floor.z - .9) : undefined}
          aria-label={`${floor.label} 교실 확대`} onClick={() => focusedFloor === floor.key ? fit() : onFloor(floor.key)}>{floor.label.match(/\d+층$/)?.[0] ?? floor.label}<span aria-hidden>↗</span></button>)}
        {readings.map(({ room, active, next, mapStatus, color }) => {
          const placed = placedById.get(room.id)!;
          const lead = active[0] ?? next;
          const chairs = seating[room.id];
          const occupied = chairs?.seats.filter(Boolean).length ?? 0;
          const seatingLabel = chairs?.rosterAvailable ? `책상 ${chairs.seats.length}개${chairs.attendanceAvailable ? ` · 출석 확인 ${occupied}명` : ""}` : "수강 명단 확인 중";
          const status = mapStatus === "ongoing" ? `${active.length}개 반 수업 중` : mapStatus === "next" ? `다음 ${next?.startTime.slice(0, 5)}` : mapStatus === "unknown" ? "시간표 확인 필요" : "남은 수업 없음";
          return <button key={room.id} ref={(element) => { if (element) labels.current.set(room.id, element); else labels.current.delete(room.id); }}
            className={s.roomLabel} data-room-id={room.id} data-status={mapStatus} data-detailed={view === "2d" ? placed.depth * scale >= 110 : undefined} data-tiny={view === "2d" ? placed.depth * scale < 60 : undefined}
            data-desks={chairs?.seats.length ?? 0} data-present={occupied}
            aria-pressed={room.id === selectedId} aria-label={`${room.name}, ${status}${lead ? `, ${lead.className}, ${lead.teacherName ?? "담당 미입력"}, 수강 ${lead.studentCount}명` : ""}, ${seatingLabel}, 시간표 보기`}
            title={`${room.name} · ${status}${lead ? ` · ${lead.className}` : ""} · ${seatingLabel}`}
            style={{ ...(view === "2d" ? flatStyle(placed.x, placed.z, placed.width * scale - 8) : {}), "--status-color": color } as CSSProperties}
            onClick={() => { onChoose(room); if (view === "3d") controller.current?.fit(room.id); }}>
            <strong><span className={s.fullName}>{room.name}{placed.lab ? " 랩실" : ""}</span><span className={s.shortName}>{room.name.replace(roomGroupOf(room.name).building, "") || room.name}{placed.lab ? " LAB" : ""}</span></strong>
            <span className={s.compactStatus}><i /><span>{mapStatus === "ongoing" ? active.length > 1 ? `${active.length}개 반` : `수강 ${lead?.studentCount}명` : mapStatus === "next" ? `${next?.startTime.slice(0, 5)} 예정` : mapStatus === "unknown" ? "확인 필요" : "수업 없음"}</span></span>
            {lead && <span className={s.roomDetail}><b>{lead.className}{active.length > 1 ? ` 외 ${active.length - 1}개 반` : ""}</b><span>{lead.teacherName ?? "담당 미입력"} · {lead.studentCount}명</span>{active.length > 0 && <span>{seatingLabel}</span>}</span>}
          </button>;
        })}
      </div>
      {!ready && <div className={s.loading} role="status">3D 교실을 불러오는 중…</div>}
    </div>
    <div className={s.mapTools}>
      <span>{view === "3d" ? "드래그 회전 · 휠 확대" : "드래그 이동"}</span>
      <div role="group" aria-label="배치 조작">
        {view === "3d" && <><button disabled={!ready} aria-label="왼쪽 회전" title="왼쪽 회전" onClick={() => controller.current?.rotate(-.3)}><EyIcon name="undo" size={16} /></button><button disabled={!ready} aria-label="오른쪽 회전" title="오른쪽 회전" onClick={() => controller.current?.rotate(.3)}><EyIcon name="sync" size={16} /></button></>}
        <button disabled={!ready} aria-label="축소" title="축소" onClick={() => zoom(1 / 1.25)}><EyIcon name="minus" size={16} /></button>
        <button disabled={!ready} aria-label="확대" title="확대" onClick={() => zoom(1.25)}><EyIcon name="plus" size={16} /></button>
        <button disabled={!ready || !selectedId} aria-label="선택 교실 확대" title="선택 교실 확대" onClick={() => fit(selectedId ?? undefined)}><EyIcon name="target" size={16} /></button>
        <button disabled={!ready} aria-label="전체 배치 맞춤" title="전체 배치 맞춤" onClick={() => fit()}><EyIcon name="layoutGrid" size={16} /></button>
      </div>
    </div>
  </div>;
}
