"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Loader2 } from "lucide-react";
import { moveEnrollment } from "@/features/enrollments/server/actions";

/**
 * 시간표 DnD wrapper. 학생 카드를 드래그해서 다른 반(다른 셀)으로 이동.
 * - draggable id: `student:${enrollmentId}`
 * - droppable id: `class:${classId}`
 * 드롭 후 server action moveEnrollment 호출 + router.refresh
 */
export function TimetableBoard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (!activeIdStr.startsWith("student:") || !overIdStr.startsWith("class:")) return;

    const enrollmentId = activeIdStr.slice("student:".length);
    const newClassId = overIdStr.slice("class:".length);
    // active.data.current.classId 로 출발지 확인 (같으면 noop)
    const sourceClassId = (active.data.current as { classId?: string } | undefined)?.classId;
    if (sourceClassId === newClassId) return;

    if (!confirm("학생을 이 반으로 이동하시겠어요?")) return;

    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("enrollmentId", enrollmentId);
      fd.set("newClassId", newClassId);
      const result = await moveEnrollment(undefined, fd);
      if (result?.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <DndContext id="timetable-dnd" sensors={sensors} onDragEnd={onDragEnd}>
      {pending ? (
        <div className="bg-card border-line shadow-card fixed top-20 right-6 z-50 flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
          <Loader2 className="text-primary size-3 animate-spin" />
          학생 이동 중...
        </div>
      ) : null}
      {error ? (
        <div className="bg-chart-4/10 border-chart-4/40 text-chart-4 fixed top-20 right-6 z-50 max-w-sm rounded-md border px-3 py-2 text-xs shadow">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline"
          >
            닫기
          </button>
        </div>
      ) : null}
      {children}
    </DndContext>
  );
}
