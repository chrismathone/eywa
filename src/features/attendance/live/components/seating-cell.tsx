"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { canDeskMark, seatMarkOf, SEAT_MARK_LABEL, SEAT_MARK_TONE, shortSeatName } from "../mark-state";
import type { SeatingClass, SeatingStudent } from "../seating";

const MARKS = [
  { status: "present" as const, label: "출석" },
  { status: "late" as const, label: "지각" },
  { status: "absent" as const, label: "결석" },
];

export function SeatingCell({
  date,
  klass,
  student,
}: {
  date: string;
  klass: SeatingClass;
  student: SeatingStudent;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<string | null | undefined>(undefined);
  const status = optimistic === undefined ? student.status : optimistic;
  const mark = seatMarkOf(status, klass.phase);
  // 자기 반(owned)은 강사 규칙 — 10분 전에도 찍는다. 남의 반은 데스크 규칙.
  const canMark = klass.ownedByMe || canDeskMark(status, klass.phase);
  const tone = SEAT_MARK_TONE[mark];

  function save(next: "present" | "late" | "absent") {
    setError(null);
    setOptimistic(next);
    setOpen(false);
    startTransition(() => {
      setAttendanceCell({
        studentId: student.studentId,
        classId: klass.classId,
        sessionDate: date,
        status: next,
        // 기존 행이면 그 교시, 없으면 과목 축(수학=null · 영어=첫 교시). 한 클릭이 2행을 만들지 않는다.
        slotStart: student.writeSlot,
        periodStart: klass.firstStart,
        quiet: true,
      })
        .then((res) => {
          if ("error" in res) {
            setOptimistic(undefined);
            setError(res.error);
            return;
          }
          router.refresh();
        })
        .catch(() => {
          setOptimistic(undefined);
          setError("저장하지 못했습니다 — 다시 눌러 주세요");
        });
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy || !canMark}
        onClick={() => canMark && setOpen((v) => !v)}
        title={`${student.studentName}${student.schoolGrade ? ` · ${student.schoolGrade}` : ""} · ${SEAT_MARK_LABEL[mark]}`}
        className={`flex h-11 min-w-[44px] items-center justify-center rounded-lg px-1.5 text-[11px] font-bold whitespace-nowrap ${tone} ${
          canMark ? "hover:ring-primary/40 cursor-pointer hover:ring-2" : "cursor-default opacity-95"
        } disabled:opacity-60`}
      >
        {shortSeatName(student.studentName)}
      </button>
      {open && canMark && (
        <div className="border-line bg-surface absolute top-full left-0 z-20 mt-1 flex gap-0.5 rounded-lg border p-1 shadow-md">
          {MARKS.map((m) => (
            <button
              key={m.status}
              type="button"
              onClick={() => save(m.status)}
              className="hover:bg-bg-soft rounded-md px-2 py-1 text-[11px] font-bold whitespace-nowrap"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="text-danger absolute top-full left-0 z-20 mt-1 w-40 text-[10px]">{error}</p>
      )}
    </div>
  );
}
