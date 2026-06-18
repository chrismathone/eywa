"use client";

import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ClassDetailDrawer, type ClassDetailQuick } from "@/components/class-detail-drawer";
import { useTimetableEdit } from "./edit-context";

// 반이름 헤더 바 색(과목별). 학생 행은 흰 배경 + 상태색이라 헤더만 과목색.
const SUBJECT_COLOR: Record<string, string> = {
  math: "bg-primary-soft text-primary",
  highmath: "bg-primary-soft text-primary",
  english: "bg-blue-soft text-blue",
  korean: "bg-rose-soft text-rose",
  science: "bg-purple-soft text-purple",
  arts: "bg-amber-soft text-amber",
};

function shortTime(t: string) {
  return t.slice(0, 5);
}

/** 학생 행 우측 메타 — 학교 + 학년(있는 것만). ijw식 [이름] … [학교 학년]. */
function metaLabel(school: string | null | undefined, grade: string | null | undefined): string {
  return [school, grade].filter(Boolean).join(" ");
}

/** 학생 행 배경 — 신입(빨강)·전입(초록)·그 외(기본). ijw 시간표의 신입/전학 색 근사. */
function studentRowTone(s: { isNew?: boolean; isTransferredIn?: boolean }): string {
  if (s.isNew) return "bg-danger-soft text-danger";
  if (s.isTransferredIn) return "bg-primary-soft text-primary";
  return "text-text-dim";
}

const ROW_CLASS =
  "flex items-baseline justify-between gap-1.5 px-2 py-[3px] leading-tight whitespace-nowrap";

/**
 * 학생 한 줄(세로 나열) — 편집 모드에서만 마운트되어 draggable.
 * 이동 예정이면 취소선 + 대상 반 마커. (비편집 시엔 StudentRow가 훅 없이 렌더.)
 */
function DraggableStudentRow({
  enrollmentId,
  classId,
  name,
  meta,
  tone,
}: {
  enrollmentId: string;
  classId: string;
  name: string;
  meta: string;
  tone: string;
}) {
  const { pending } = useTimetableEdit();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `student:${enrollmentId}`,
    data: { classId, name },
  });
  const target = pending.get(enrollmentId);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`${ROW_CLASS} cursor-grab active:cursor-grabbing ${tone} ${isDragging ? "opacity-40" : ""} ${target ? "opacity-60" : ""}`}
    >
      <span className={`truncate ${target ? "line-through" : ""}`}>{name}</span>
      {target ? (
        <span className="text-primary shrink-0 font-mono text-[9px]">→{target.toClassName}</span>
      ) : meta ? (
        <span className="shrink-0 font-mono text-[9px] opacity-60">{meta}</span>
      ) : null}
    </div>
  );
}

/** 학생 한 줄(비편집) — 드래그 훅 없이 평범한 div. 대량 셀 DOM/렌더 보호. */
function StudentRow({ name, meta, tone }: { name: string; meta: string; tone: string }) {
  return (
    <div className={`${ROW_CLASS} ${tone}`}>
      <span className="truncate">{name}</span>
      {meta ? <span className="shrink-0 font-mono text-[9px] opacity-60">{meta}</span> : null}
    </div>
  );
}

/**
 * 시간표 셀 — 반이름 헤더 바 + 그 아래 학생 세로 나열(엑셀식 칸 안 행). ijw 시간표 패턴.
 * 헤더 클릭 → ClassDetailDrawer로 전체 명단/레벨변경. 편집 모드면 학생 행 드래그로 반 이동.
 */
export function ClassCell({
  slot,
  roster = "full",
}: {
  slot: ClassDetailQuick;
  /** 셀 안 명단 표시: full=캡8(통합뷰), names=캡15(기본뷰 — 전체 가까이), none=숨김. */
  roster?: "full" | "names" | "none";
}) {
  const [open, setOpen] = useState(false);
  const { editing } = useTimetableEdit();
  const color = SUBJECT_COLOR[slot.subject] ?? "bg-bg-soft text-text-dim";

  const cap = roster === "names" ? 15 : 8;
  const showRoster = roster !== "none" && slot.students.length > 0;
  const visibleStudents = slot.students.slice(0, cap);
  const hiddenCount = slot.students.length - visibleStudents.length;

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `class:${slot.id}`,
    data: { className: slot.className },
  });

  return (
    <>
      <div
        ref={setDroppableRef}
        className={`border-line overflow-hidden rounded-[3px] border transition ${isOver ? "ring-primary ring-2" : ""}`}
      >
        {/* 반이름 헤더 바 — 클릭 시 상세 drawer */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`block w-full px-2 py-1 text-left transition hover:brightness-95 ${color}`}
          aria-label={`${slot.className} 상세 보기`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[11px] font-bold">{slot.className}</span>
            <span className="num shrink-0 font-mono text-[9px] opacity-70">{slot.students.length}</span>
          </div>
          <div className="flex items-center justify-between gap-1 text-[9px] opacity-75">
            <span className="num font-mono">
              {shortTime(slot.startTime)}~{shortTime(slot.endTime)}
            </span>
            {slot.classroomName ? <span className="truncate font-mono">{slot.classroomName}</span> : null}
          </div>
        </button>

        {/* 학생 세로 나열 — 흰 칸에 행마다 구분선(엑셀식). 신입=빨강행·전입=초록행. */}
        {showRoster ? (
          <div className="bg-card divide-line/40 divide-y text-[10px]">
            {visibleStudents.map((s, i) =>
              editing && s.enrollmentId ? (
                <DraggableStudentRow
                  key={s.enrollmentId}
                  enrollmentId={s.enrollmentId}
                  classId={slot.id}
                  name={s.name}
                  meta={metaLabel(s.school, s.grade)}
                  tone={studentRowTone(s)}
                />
              ) : (
                <StudentRow
                  key={s.enrollmentId ?? `s-${i}`}
                  name={s.name}
                  meta={metaLabel(s.school, s.grade)}
                  tone={studentRowTone(s)}
                />
              ),
            )}
            {hiddenCount > 0 ? (
              <div className="text-text-faint px-2 py-[3px] text-[9px]">외 {hiddenCount}명</div>
            ) : null}
          </div>
        ) : null}
      </div>

      <ClassDetailDrawer open={open} onClose={() => setOpen(false)} slot={slot} trigger={null} />
    </>
  );
}
