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
import { TimetableEditContext, type PendingTarget } from "./edit-context";

type Queued = PendingMove & { toClassName: string; name: string };

/**
 * 시간표 DnD wrapper + 편집 모드.
 * - 읽기 전용(기본): 학생 pill 드래그 비활성, 셀 클릭 → drawer.
 * - 편집 모드: 학생 pill을 다른 셀로 드롭 → 델타 버퍼에 누적(DB 미반영). '저장' 시
 *   compressMoves로 A→B→C를 A→C로 압축 후 moveEnrollmentsBatch(단일 RPC, per-move 결과)로 커밋.
 */
export function TimetableBoard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [editing, setEditing] = useState(false);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  // enrollmentId → 최종 이동 대상(압축 결과). 셀이 pending 마커를 그리는 데 사용.
  const pending = useMemo<Map<string, PendingTarget>>(() => {
    const m = new Map<string, PendingTarget>();
    // 같은 enrollment의 마지막 큐 항목이 최종 대상.
    for (const q of queue) {
      if (q.fromClassId === q.toClassId) {
        m.delete(q.enrollmentId);
      } else {
        m.set(q.enrollmentId, { toClassId: q.toClassId, toClassName: q.toClassName });
      }
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
    <TimetableEditContext.Provider value={{ editing, pending, queueMove }}>
      {/* 편집 컨트롤 바 */}
      <div className="print:hidden flex shrink-0 items-center gap-2 text-xs">
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
            <span className="text-text-faint font-mono">
              {compressed.length}건 이동 대기
            </span>
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
          <span className="text-amber">
            {failed.length}건 실패(시간겹침 등) — 나머지는 저장됨
          </span>
        ) : null}
      </div>

      <DndContext id="timetable-dnd" sensors={sensors} onDragEnd={onDragEnd}>
        {children}
      </DndContext>
    </TimetableEditContext.Provider>
  );
}
