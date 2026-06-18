"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { moveEnrollmentsBatch } from "@/features/enrollments/server/actions";
import { compressMoves, type PendingMove } from "@/features/timetable/lib/move-compress";
import { TimetableEditContext, useTimetableEdit, type PendingTarget } from "./edit-context";

type Queued = PendingMove & { toClassName: string; name: string };

/**
 * 시간표 편집 상태 provider — 편집 토글·이동 큐·저장/취소를 소유하고 context로 제공.
 * 편집 컨트롤(TimetableEditControls, 툴바에 인라인)과 드롭영역(TimetableDndArea, 그리드)이
 * 분리돼 같은 상태를 소비한다. (이전 단일 TimetableBoard에서 분리 — 편집 버튼이 툴바로 이동.)
 * - 읽기 전용(기본): 학생 드래그 비활성, 셀 클릭 → drawer.
 * - 편집 모드: 학생을 다른 셀로 드롭 → 델타 버퍼에 누적(DB 미반영). '저장' 시 compressMoves로
 *   A→B→C를 A→C로 압축 후 moveEnrollmentsBatch(단일 RPC)로 커밋.
 */
export function TimetableEditProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  // enrollmentId → 최종 이동 대상(압축 결과). 셀이 pending 마커를 그리는 데 사용.
  const pending = useMemo<Map<string, PendingTarget>>(() => {
    const m = new Map<string, PendingTarget>();
    for (const q of queue) {
      if (q.fromClassId === q.toClassId) m.delete(q.enrollmentId);
      else m.set(q.enrollmentId, { toClassId: q.toClassId, toClassName: q.toClassName });
    }
    return m;
  }, [queue]);

  function queueMove(move: {
    enrollmentId: string;
    fromClassId: string;
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

/** DnD 드롭영역 — 시간표 그리드를 감싼다. 편집 모드에서만 이동을 큐에 누적. */
export function TimetableDndArea({ children }: { children: ReactNode }) {
  const { editing, queueMove } = useTimetableEdit();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragEnd(e: DragEndEvent) {
    if (!editing) return;
    const { active, over } = e;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (!activeIdStr.startsWith("student:") || !overIdStr.startsWith("class:")) return;
    const enrollmentId = activeIdStr.slice("student:".length);
    const toClassId = overIdStr.slice("class:".length);
    const data = active.data.current as
      | { classId?: string; toClassName?: string; name?: string }
      | undefined;
    const fromClassId = data?.classId ?? "";
    if (!fromClassId || fromClassId === toClassId) return;
    const overData = over.data.current as { className?: string } | undefined;
    queueMove({
      enrollmentId,
      fromClassId,
      toClassId,
      toClassName: overData?.className ?? "다른 반",
      name: data?.name ?? "학생",
    });
  }

  return (
    <DndContext id="timetable-dnd" sensors={sensors} onDragEnd={onDragEnd}>
      {children}
    </DndContext>
  );
}
