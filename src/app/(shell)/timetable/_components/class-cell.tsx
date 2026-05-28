"use client";

import { useState } from "react";
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

/**
 * 시간표 셀 — 클릭 시 ClassDetailDrawer를 자체적으로 열어 학생 명단을 즉시 표시.
 * 페이지가 server component이므로 셀만 client로 분리.
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

  return (
    <>
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
          {slot.classroomName ? <span className="font-mono">{slot.classroomName}</span> : <span />}
          <Pill color={pillColor(slot.subject)} className="!text-[9px]">
            {slot.students.length}명
          </Pill>
        </div>
        {!compact && slot.students.length > 0 ? (
          <p className="mt-1 line-clamp-2 text-[10px] opacity-70">
            {slot.students.map((s) => `${s.name}/${s.grade ?? "—"}`).join(", ")}
          </p>
        ) : null}
        {compact && slot.students.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-[10px] opacity-75">
            {slot.students.slice(0, 6).map((s) => (
              <li key={s.name} className="truncate">
                {s.name}
                {s.grade ? <span className="opacity-60"> · {s.grade}</span> : null}
              </li>
            ))}
            {slot.students.length > 6 ? (
              <li className="opacity-60">외 {slot.students.length - 6}명</li>
            ) : null}
          </ul>
        ) : null}
      </button>

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
