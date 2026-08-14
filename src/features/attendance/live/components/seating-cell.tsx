"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { canDeskMark, seatHoverTitle, seatMarkOf, SEAT_MARK_TONE } from "../mark-state";
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
  const canMark = klass.ownedByMe || canDeskMark(status, klass.phase);

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
        slotStart: student.writeSlot,
        periodStart: klass.firstStart,
        quiet: true,
        source: "live",
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
        title={seatHoverTitle({
          studentName: student.studentName,
          schoolGrade: student.schoolGrade,
          mark,
          note: student.note,
        })}
        className={`flex min-h-11 min-w-[5.5rem] items-center justify-center rounded-lg px-2 py-1.5 ${SEAT_MARK_TONE[mark]} ${
          canMark ? "hover:ring-primary/40 cursor-pointer hover:ring-2" : "cursor-default"
        } disabled:opacity-60`}
      >
        <span className="text-[13px] leading-tight font-bold">{student.studentName}</span>
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
