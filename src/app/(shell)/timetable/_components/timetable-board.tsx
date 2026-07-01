"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Check, GripVertical, Loader2, Pencil, X } from "lucide-react";
import { moveEnrollmentsBatch } from "@/features/enrollments/server/actions";
import { compressMoves, type PendingMove } from "@/features/timetable/lib/move-compress";
import { zoneAttendanceDays } from "@/features/timetable/lib/split-attendance";
import {
  TimetableEditContext,
  useTimetableEdit,
  type IncomingStudent,
  type PendingTarget,
} from "./edit-context";

type Queued = PendingMove & { fromClassName: string; toClassName: string; name: string };

/** 도착 셀 slot.id → 반 id 매핑용 드롭 대상 data(요일 존/공통 존 공통). */
type DropData = { className?: string; classId?: string; slotId?: string; day?: string };

/**
 * 시간표 편집 상태 provider — 편집 토글·이동 큐·저장/취소·적용일을 소유하고 context로 제공.
 * 편집 컨트롤(TimetableEditControls, 툴바에 인라인)과 드롭영역(TimetableDndArea, 그리드)이
 * 분리돼 같은 상태를 소비한다.
 * - 읽기 전용(기본): 학생 드래그 비활성, 셀 클릭 → drawer.
 * - 편집 모드: 학생을 다른 반의 요일 존/공통 존으로 드롭 → 델타 버퍼에 누적(DB 미반영). 요일 존=그 요일만
 *   등원(분리등원), 공통 존=전 요일. '저장' 시 compressMoves 후 moveEnrollmentsBatch(단일 RPC)로 커밋.
 */
export function TimetableEditProvider({
  children,
  effectiveDate,
  today,
}: {
  children: ReactNode;
  /** 이동 적용일(YYYY-MM-DD) — 미래 주 편집 시 그 주 월요일. 미지정=오늘 즉시. (Phase B 주간 이동) */
  effectiveDate?: string;
  /** 오늘(KST, YYYY-MM-DD) — 적용일 입력 기본·최소값. */
  today: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  // 사용자가 편집 바에서 정한 적용일(예정일). null이면 기본(조회 주 기준 effectiveDate ?? 오늘).
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const dateFloor = effectiveDate ?? today;

  // net 압축 결과(이름·출발반명·목적지 셀/요일까지 포함) — 표시용 pending/incoming의 단일 출처.
  const resolved = useMemo<Queued[]>(() => {
    const net = new Map<string, Queued>();
    const order: string[] = [];
    for (const q of queue) {
      const ex = net.get(q.enrollmentId);
      if (ex) {
        ex.toClassId = q.toClassId; // 출발지는 최초 유지, 목적지만 갱신
        ex.toClassName = q.toClassName;
        ex.toSlotId = q.toSlotId;
        ex.toDays = q.toDays;
      } else {
        net.set(q.enrollmentId, { ...q });
        order.push(q.enrollmentId);
      }
    }
    return order.map((id) => net.get(id)!).filter((m) => m.fromClassId !== m.toClassId);
  }, [queue]);

  // enrollmentId → 최종 이동 대상. 출발 셀이 취소선+→대상 마커를 그리는 데 사용.
  const pending = useMemo<Map<string, PendingTarget>>(() => {
    const m = new Map<string, PendingTarget>();
    for (const r of resolved) m.set(r.enrollmentId, { toClassId: r.toClassId, toClassName: r.toClassName });
    return m;
  }, [resolved]);

  // 도착 셀 slot.id(=toSlotId) → 전입 예정 학생들. 도착 셀이 초록 미리보기 행을 그리는 데 사용.
  // 마커는 "그 셀"에 붙어야 하므로 반 id가 아니라 셀 slot.id로 키잉(한 반이 여러 셀에 걸쳐도 드롭한 셀만).
  const incoming = useMemo<Map<string, IncomingStudent[]>>(() => {
    const m = new Map<string, IncomingStudent[]>();
    for (const r of resolved) {
      const key = r.toSlotId ?? r.toClassId;
      const arr = m.get(key) ?? [];
      arr.push({
        enrollmentId: r.enrollmentId,
        name: r.name,
        fromClassName: r.fromClassName,
        attendanceDays: r.toDays, // 도착 요일 존의 등원 요일([목] 등) — 미리보기 라벨용
      });
      m.set(key, arr);
    }
    return m;
  }, [resolved]);

  function queueMove(move: {
    enrollmentId: string;
    fromClassId: string;
    fromClassName: string;
    toClassId: string;
    toClassName: string;
    name: string;
    toSlotId?: string;
    toDays?: string[];
  }) {
    setError(null);
    setFailed([]);
    setQueue((prev) => [...prev, move]);
  }

  const compressed = compressMoves(queue);

  async function save() {
    if (compressed.length === 0) {
      setEditing(false);
      setQueue([]);
      setScheduledDate(null);
      return;
    }
    setSaving(true);
    setError(null);
    setFailed([]);
    try {
      const res = await moveEnrollmentsBatch(
        compressed.map((m) => ({
          enrollmentId: m.enrollmentId,
          newClassId: m.toClassId,
          attendanceDays: m.toDays ?? [],
        })),
        scheduledDate ?? effectiveDate,
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      const fails = (res.results ?? []).filter((r) => !r.ok);
      if (fails.length > 0) {
        setFailed(fails.map((f) => f.error ?? f.enrollmentId));
      }
      setQueue([]);
      setScheduledDate(null);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setQueue([]);
    setScheduledDate(null);
    setEditing(false);
    setError(null);
    setFailed([]);
  }

  return (
    <TimetableEditContext.Provider
      value={{
        editing,
        setEditing,
        pending,
        incoming,
        queueMove,
        pendingCount: compressed.length,
        save,
        cancel,
        saving,
        error,
        failed,
        scheduledDate,
        setScheduledDate,
        dateFloor,
      }}
    >
      {children}
    </TimetableEditContext.Provider>
  );
}

/** 편집 토글/저장/취소/적용일 컨트롤 — 툴바에 인라인 배치(별도 행 차지 안 함). */
export function TimetableEditControls() {
  const {
    editing,
    setEditing,
    pendingCount,
    save,
    cancel,
    saving,
    error,
    failed,
    scheduledDate,
    setScheduledDate,
    dateFloor,
  } = useTimetableEdit();
  return (
    <div className="print:hidden flex flex-wrap items-center gap-2 text-xs">
      {!editing ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 transition"
        >
          <Pencil className="size-3" />
          편집
        </button>
      ) : (
        <>
          <span className="text-primary inline-flex items-center gap-1.5 font-medium">
            <Pencil className="size-3" />
            편집 중
          </span>
          <span className="text-text-faint font-mono">{pendingCount}건 이동 대기</span>
          {/* 적용일(즉시=오늘/조회 주, 예정일=날짜 지정). 이동은 이 날짜에 반영(옛 반은 그날 전까지 유지). */}
          <label className="text-text-dim inline-flex items-center gap-1">
            적용일
            <input
              type="date"
              aria-label="이동 적용일"
              min={dateFloor}
              value={scheduledDate ?? dateFloor}
              onChange={(e) => setScheduledDate(e.target.value || null)}
              disabled={saving}
              className="border-line rounded-md border px-1.5 py-0.5 text-xs disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            저장
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 transition disabled:opacity-50"
          >
            <X className="size-3" />
            취소
          </button>
        </>
      )}
      {error ? <span className="text-chart-4">{error}</span> : null}
      {failed.length > 0 ? (
        <span className="text-amber">{failed.length}건 실패(시간겹침 등) — 나머지는 저장됨</span>
      ) : null}
    </div>
  );
}

/**
 * 드롭 대상 우선순위 — 요일 존(class:slotId:day, 콜론 3조각)이 셀(class:slotId, 2조각)과 겹치면 요일 존을 택한다.
 * 그래야 "목 칸에 드롭 = 목만 등원"이 셀 전체 드롭(=전 요일)보다 우선한다. slotId는 UUID라 콜론이 없어 조각 수로 구분.
 */
const preferDayZone: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const dayZone = hits.find((h) => String(h.id).split(":").length >= 3);
  if (dayZone) return [dayZone];
  return hits.length > 0 ? hits : rectIntersection(args);
};

/** DnD 드롭영역 — 시간표 그리드를 감싼다. 편집 모드에서만 이동을 큐에 누적.
 * DragOverlay로 잡은 학생 이름 칩이 커서를 따라다녀 "끌고 있다"는 느낌을 준다. */
export function TimetableDndArea({ children }: { children: ReactNode }) {
  const { editing, queueMove } = useTimetableEdit();
  const [dragName, setDragName] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as { name?: string } | undefined;
    setDragName(data?.name ?? "학생");
  }

  function onDragEnd(e: DragEndEvent) {
    setDragName(null);
    if (!editing) return;
    const { active, over } = e;
    if (!over) return;
    const activeIdStr = String(active.id);
    if (!activeIdStr.startsWith("student:")) return;
    // 도착 정보는 드롭존 data에서 읽는다(id 파싱 금지) — classId=실제 반 id, slotId=셀 id, day=요일 존이면 요일.
    const overData = over.data.current as DropData | undefined;
    const toClassId = overData?.classId;
    if (!toClassId) return;
    const data = active.data.current as
      | { classId?: string; fromClassName?: string; name?: string; enrollmentId?: string }
      | undefined;
    // 분리등원 요일 칸에서 온 드래그는 id가 `student:{id}:{day}`로 유니크 → id 파싱 대신 data.enrollmentId 우선.
    const enrollmentId = data?.enrollmentId ?? activeIdStr.slice("student:".length);
    const fromClassId = data?.classId ?? ""; // 출발 반 id(실제 반 id)
    if (!fromClassId || fromClassId === toClassId) return; // 같은 반은 v1 미지원(교차 반 이동만)
    queueMove({
      enrollmentId,
      fromClassId,
      fromClassName: data?.fromClassName ?? "다른 반",
      toClassId,
      toClassName: overData?.className ?? "다른 반",
      name: data?.name ?? "학생",
      toSlotId: overData?.slotId,
      toDays: zoneAttendanceDays(overData?.day), // 요일 존=[그 요일], 공통 존=[]
    });
  }

  return (
    <DndContext
      id="timetable-dnd"
      sensors={sensors}
      collisionDetection={preferDayZone}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragName(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {dragName ? (
          <div className="border-primary bg-card text-foreground pointer-events-none inline-flex cursor-grabbing items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] font-medium shadow-lg">
            <GripVertical className="text-primary size-3.5" />
            {dragName}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
