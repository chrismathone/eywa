"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Check, GripVertical, Loader2, Pencil, X } from "lucide-react";
import { moveEnrollmentsBatch } from "@/features/enrollments/server/actions";
import { compressMoves, type PendingMove } from "@/features/timetable/lib/move-compress";
import {
  TimetableEditContext,
  useTimetableEdit,
  type IncomingStudent,
  type PendingTarget,
} from "./edit-context";

type Queued = PendingMove & { fromClassName: string; toClassName: string; name: string };

/**
 * 시간표 편집 상태 provider — 편집 토글·이동 큐·저장/취소를 소유하고 context로 제공.
 * 편집 컨트롤(TimetableEditControls, 툴바에 인라인)과 드롭영역(TimetableDndArea, 그리드)이
 * 분리돼 같은 상태를 소비한다. (이전 단일 TimetableBoard에서 분리 — 편집 버튼이 툴바로 이동.)
 * - 읽기 전용(기본): 학생 드래그 비활성, 셀 클릭 → drawer.
 * - 편집 모드: 학생을 다른 셀로 드롭 → 델타 버퍼에 누적(DB 미반영). '저장' 시 compressMoves로
 *   A→B→C를 A→C로 압축 후 moveEnrollmentsBatch(단일 RPC)로 커밋.
 */
export function TimetableEditProvider({
  children,
  effectiveDate,
}: {
  children: ReactNode;
  /** 이동 적용일(YYYY-MM-DD) — 미래 주 편집 시 그 주 월요일. 미지정=오늘 즉시. (Phase B 주간 이동) */
  effectiveDate?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  // net 압축 결과(이름·출발반명까지 포함) — 표시용 pending/incoming의 단일 출처.
  // 알고리즘은 compressMoves(저장 커밋용, 단위테스트됨)와 동일: 최초 출발지 유지·마지막 목적지 채택·
  // 원점 복귀(A→B→A) 제거. 둘이 같은 net이라 화면 마커 == 실제 커밋.
  const resolved = useMemo<Queued[]>(() => {
    const net = new Map<string, Queued>();
    const order: string[] = [];
    for (const q of queue) {
      const ex = net.get(q.enrollmentId);
      if (ex) {
        ex.toClassId = q.toClassId; // 출발지는 최초 유지, 목적지만 갱신
        ex.toClassName = q.toClassName;
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

  // 대상 셀 slot.id → 전입 예정 학생들. 도착 셀이 초록 미리보기 행을 그리는 데 사용.
  const incoming = useMemo<Map<string, IncomingStudent[]>>(() => {
    const m = new Map<string, IncomingStudent[]>();
    for (const r of resolved) {
      const arr = m.get(r.toClassId) ?? [];
      arr.push({ enrollmentId: r.enrollmentId, name: r.name, fromClassName: r.fromClassName });
      m.set(r.toClassId, arr);
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
      return;
    }
    setSaving(true);
    setError(null);
    setFailed([]);
    try {
      const res = await moveEnrollmentsBatch(
        compressed.map((m) => ({ enrollmentId: m.enrollmentId, newClassId: m.toClassId })),
        effectiveDate,
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
      }}
    >
      {children}
    </TimetableEditContext.Provider>
  );
}

/** 편집 토글/저장/취소 컨트롤 — 툴바에 인라인 배치(별도 행 차지 안 함). */
export function TimetableEditControls() {
  const { editing, setEditing, pendingCount, save, cancel, saving, error, failed } =
    useTimetableEdit();
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
    const overIdStr = String(over.id);
    if (!activeIdStr.startsWith("student:") || !overIdStr.startsWith("class:")) return;
    const enrollmentId = activeIdStr.slice("student:".length);
    const toClassId = overIdStr.slice("class:".length);
    const data = active.data.current as
      | { classId?: string; fromClassName?: string; name?: string }
      | undefined;
    const fromClassId = data?.classId ?? "";
    if (!fromClassId || fromClassId === toClassId) return;
    const overData = over.data.current as { className?: string } | undefined;
    queueMove({
      enrollmentId,
      fromClassId,
      fromClassName: data?.fromClassName ?? "다른 반",
      toClassId,
      toClassName: overData?.className ?? "다른 반",
      name: data?.name ?? "학생",
    });
  }

  return (
    <DndContext
      id="timetable-dnd"
      sensors={sensors}
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
