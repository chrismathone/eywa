"use client";

import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ClassDetailDrawer, type ClassDetailQuick } from "@/components/class-detail-drawer";
import { Pill, type PillColor } from "@/components/atoms/pill";

const SUBJECT_COLOR: Record<string, string> = {
  math: "bg-primary-soft text-primary",
  english: "bg-blue-soft text-blue",
  korean: "bg-rose-soft text-rose",
  science: "bg-purple-soft text-purple",
  arts: "bg-amber-soft text-amber",
};

function shortTime(t: string) {
  return t.slice(0, 5);
}

/** 학생 한 명 — draggable. */
function DraggableStudent({
  enrollmentId,
  classId,
  children,
}: {
  enrollmentId: string;
  classId: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `student:${enrollmentId}`,
    data: { classId },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cursor-grab active:cursor-grabbing print:cursor-default ${isDragging ? "opacity-40" : ""}`}
    >
      {children}
    </div>
  );
}

/**
 * 시간표 셀 — 클릭 시 ClassDetailDrawer를 자체적으로 열어 학생 명단을 즉시 표시.
 * 페이지가 server component이므로 셀만 client로 분리.
 * Drag-and-drop: 학생 항목은 draggable, 셀 전체는 droppable.
 */
export function ClassCell({
  slot,
  compact = false,
}: {
  slot: ClassDetailQuick;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const color = SUBJECT_COLOR[slot.subject] ?? "bg-bg-soft text-text-dim";

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `class:${slot.id}`,
  });

  return (
    <>
      <div
        ref={setDroppableRef}
        className={`rounded-sm transition ${isOver ? "ring-primary ring-2" : ""}`}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`w-full rounded-sm px-2 py-1.5 text-left transition hover:brightness-95 ${color}`}
          aria-label={`${slot.className} 상세 보기`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-[11px] font-bold">{slot.className}</p>
            <span className="num font-mono text-[10px] opacity-70">
              {shortTime(slot.startTime)}~{shortTime(slot.endTime)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] opacity-80">
            {slot.classroomName ? (
              <span className="font-mono">{slot.classroomName}</span>
            ) : (
              <span />
            )}
            <Pill color={pillColor(slot.subject)} className="!text-[9px]">
              {slot.students.length}명
            </Pill>
          </div>
        </button>

        {/* 학생 명단 — 셀 외부에서 별도 클릭 영역 (드래그용) */}
        {!compact && slot.students.length > 0 ? (
          <div className={`mt-1 flex flex-wrap gap-0.5 px-2 pb-1 text-[10px] opacity-70 ${color}`}>
            {slot.students.slice(0, 8).map((s, i) =>
              s.enrollmentId ? (
                <DraggableStudent
                  key={s.enrollmentId}
                  enrollmentId={s.enrollmentId}
                  classId={slot.id}
                >
                  <span className="rounded-sm px-1 hover:brightness-110">
                    {s.name}/{s.grade ?? "—"}
                  </span>
                </DraggableStudent>
              ) : (
                <span key={`s-${i}`}>{s.name}/{s.grade ?? "—"}</span>
              ),
            )}
            {slot.students.length > 8 ? (
              <span className="opacity-60">외 {slot.students.length - 8}명</span>
            ) : null}
          </div>
        ) : null}
        {compact && slot.students.length > 0 ? (
          <ul className={`mt-1 space-y-0.5 px-2 pb-1 text-[10px] opacity-75 ${color}`}>
            {slot.students.slice(0, 6).map((s) =>
              s.enrollmentId ? (
                <DraggableStudent
                  key={s.enrollmentId}
                  enrollmentId={s.enrollmentId}
                  classId={slot.id}
                >
                  <li className="truncate">
                    {s.name}
                    {s.grade ? <span className="opacity-60"> · {s.grade}</span> : null}
                  </li>
                </DraggableStudent>
              ) : (
                <li key={s.name} className="truncate">
                  {s.name}
                  {s.grade ? <span className="opacity-60"> · {s.grade}</span> : null}
                </li>
              ),
            )}
            {slot.students.length > 6 ? (
              <li className="opacity-60">외 {slot.students.length - 6}명</li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <ClassDetailDrawer
        open={open}
        onClose={() => setOpen(false)}
        slot={slot}
        trigger={null}
      />
    </>
  );
}

function pillColor(subject: string): PillColor {
  if (subject === "math") return "primary";
  if (subject === "english") return "blue";
  if (subject === "korean") return "rose";
  if (subject === "science") return "purple";
  if (subject === "arts") return "amber";
  return "neutral";
}
