"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Initial, type InitialColor } from "@/components/atoms/initial";
import { Pill, type PillColor } from "@/components/atoms/pill";

const SUBJECT_META: Record<string, { label: string; color: PillColor }> = {
  math: { label: "수학", color: "primary" },
  english: { label: "영어", color: "blue" },
  korean: { label: "국어", color: "rose" },
  science: { label: "과학", color: "purple" },
  arts: { label: "예술", color: "amber" },
};

export type ClassDetailQuick = {
  id: string;
  className: string;
  subject: string;
  classroomName?: string | null;
  teacherName?: string | null;
  startTime: string;
  endTime: string;
  dayOfWeek: string;
  students: {
    name: string;
    grade: string | null;
    school: string | null;
    enrollmentId?: string;
  }[];
};

const DAY_LABEL: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

function colorForGrade(grade?: string | null): InitialColor {
  if (!grade) return "neutral";
  if (grade.startsWith("중1")) return "blue";
  if (grade.startsWith("중2")) return "primary";
  if (grade.startsWith("중3")) return "gold";
  if (grade.startsWith("고1")) return "purple";
  if (grade.startsWith("고2")) return "rose";
  if (grade.startsWith("고3")) return "amber";
  return "neutral";
}

function short(t: string) {
  return t.slice(0, 5);
}

/**
 * 시간표 셀 클릭 시 우측 drawer로 반 상세. props로 학생 명단까지 받아서
 * 별도 fetch 없이 즉시 표시 (시간표 page가 이미 학생 명단 query).
 */
export function ClassDetailDrawer({
  open,
  onClose,
  slot,
  trigger,
}: {
  open: boolean;
  onClose: () => void;
  slot: ClassDetailQuick | null;
  trigger?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !slot) return <>{trigger}</>;

  const subjectMeta = SUBJECT_META[slot.subject] ?? {
    label: slot.subject,
    color: "neutral" as PillColor,
  };

  return (
    <>
      {trigger}
      {/* backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* drawer */}
      <aside
        className="bg-card border-line fixed top-0 right-0 z-50 flex h-full w-full max-w-[420px] flex-col overflow-hidden border-l shadow-modal"
        role="dialog"
        aria-label="반 상세"
      >
        <header className="border-line flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Pill color={subjectMeta.color}>{subjectMeta.label}</Pill>
              <span className="text-text-dim font-mono text-[11px]">
                {DAY_LABEL[slot.dayOfWeek] ?? slot.dayOfWeek}요일
              </span>
            </div>
            <h2 className="text-foreground mt-2 text-[18px] font-extrabold">
              {slot.className}
            </h2>
            <p className="text-text-dim mt-1 text-[12px]">
              <span className="num font-mono">
                {short(slot.startTime)} ~ {short(slot.endTime)}
              </span>
              {slot.classroomName ? (
                <span className="ml-2">· {slot.classroomName}</span>
              ) : null}
              {slot.teacherName ? (
                <span className="ml-2">· {slot.teacherName} 강사</span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground inline-flex size-7 items-center justify-center rounded-sm border"
            aria-label="닫기"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-auto px-5 py-4">
          <header className="flex items-baseline justify-between">
            <p className="micro">학생 명단</p>
            <span className="text-text-faint num font-mono text-[11px]">
              {slot.students.length}명
            </span>
          </header>

          {slot.students.length === 0 ? (
            <p className="text-text-faint mt-3 text-[12px]">등록된 학생이 없습니다.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {slot.students.map((s, i) => (
                <li
                  key={`${s.name}-${i}`}
                  className="bg-bg-soft/40 flex items-center gap-2.5 rounded-sm px-3 py-2"
                >
                  <Initial name={s.name} color={colorForGrade(s.grade)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-[12px] font-bold">{s.name}</p>
                    <p className="text-text-dim text-[10px]">
                      {s.grade ?? "—"}
                      {s.school ? <> · {s.school}</> : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-line bg-bg-soft border-t px-5 py-3">
          <Link
            href={`/classes/${slot.id}`}
            className="bg-primary text-primary-foreground hover:bg-primary-hover flex items-center justify-center gap-1.5 rounded-sm py-2 text-[12px] font-bold transition"
          >
            반 상세로 이동
            <EyIcon name="arrowRight" size={12} />
          </Link>
        </footer>
      </aside>
    </>
  );
}
