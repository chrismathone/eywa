"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { fitSeatName, SEAT_CELL_NAME_LADDER } from "@/features/attendance/seat/name-fit";
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
  /**
   * 학생 검색에 걸린 칸 — **색이 아니라 테두리**로 짚는다. 칸 색은 출결 상태(SEAT_MARK_TONE)가 쓰는
   * 자리라 여기에 색을 얹으면 "이 학생은 무슨 상태인가"를 덮어 버린다.
   */
  found = false,
}: {
  date: string;
  klass: SeatingClass;
  student: SeatingStudent;
  found?: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<string | null | undefined>(undefined);
  const status = optimistic === undefined ? student.status : optimistic;
  const mark = seatMarkOf(status, klass.phase);
  const canMark = klass.ownedByMe || canDeskMark(status, klass.phase);
  /**
   * 칸은 3열 격자라 폭이 고정이다 — 접미사 붙은 이름(`김하늘A`)이 넘쳐 `김하...`로 잘렸다.
   * 칸을 넓히지 않고 **그 이름만** 한 단계씩 줄인다(하한 11px). 하한에서도 넘치면 말줄임이
   * 남지만, 전체 이름은 이 버튼의 마우스오버(`seatHoverTitle`)에 늘 들어 있다.
   */
  const fit = fitSeatName(student.studentName, SEAT_CELL_NAME_LADDER);

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
    <div className="relative min-w-0">
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
        className={`flex min-h-9 w-full items-center justify-center rounded-lg px-1 py-1 ${SEAT_MARK_TONE[mark]} ${
          canMark ? "hover:ring-primary/40 cursor-pointer hover:ring-2" : "cursor-default"
        } ${found ? "ring-primary ring-2" : ""} disabled:opacity-60`}
      >
        <span className={`truncate leading-tight font-bold ${fit.className}`}>
          {student.studentName}
        </span>
      </button>
      {open && canMark && (
        <div className="bg-card shadow-card absolute top-full left-0 z-30 mt-1 flex gap-0.5 rounded-lg p-1">
          {MARKS.map((m) => (
            <button
              key={m.status}
              type="button"
              onClick={() => save(m.status)}
              className={`rounded-md px-2 py-1 text-[11px] font-bold whitespace-nowrap ${SEAT_MARK_TONE[m.status]}`}
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
