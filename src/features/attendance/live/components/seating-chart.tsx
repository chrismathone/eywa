"use client";

/**
 * 데스크 좌석표 — 섹션 = 반(첫 교시 시작시각 순), 칸 = 그 반의 오늘 학생 하나.
 * 색은 출석부 `--att-*`만. 칸 최소 44px.
 */
import { EmptyState } from "@/components/empty-state";
import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import { SEAT_MARK_LABEL, SEAT_MARK_TONE } from "../mark-state";
import { foldSeating, seatingSummary } from "../seating";
import type { LiveBoard } from "../types";
import { SeatingCell } from "./seating-cell";

const LEGEND: Array<keyof typeof SEAT_MARK_LABEL> = [
  "present",
  "absent",
  "late",
  "unmarked",
  "waiting",
];

export function SeatingChart({ board }: { board: LiveBoard }) {
  const slots = board.teachers.flatMap((t) => t.slots);
  const classes = foldSeating(slots);
  if (classes.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="이 날은 수업이 없습니다"
        description="시간표에 열린 수업이 없습니다."
      />
    );
  }
  const sum = seatingSummary(classes);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm font-bold">
          미출결 <span className="num text-att-absent-ink">{sum.unmarked}</span>
          <span className="text-text-faint mx-1.5">·</span>
          결석 <span className="num text-att-absent-ink">{sum.absent}</span>
          <span className="text-text-faint mx-1.5">·</span>
          입력{" "}
          <span className={`num ${sum.recorded >= sum.expected ? "text-primary" : "text-amber-strong"}`}>
            {sum.recorded}/{sum.expected}
          </span>
        </p>
        <ul className="ml-auto flex flex-wrap gap-1.5">
          {LEGEND.map((k) => (
            <li
              key={k}
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${SEAT_MARK_TONE[k]}`}
            >
              {SEAT_MARK_LABEL[k]}
            </li>
          ))}
        </ul>
      </header>

      {classes.map((klass) => (
        <section key={klass.classId} className="space-y-1.5">
          <h2 className="flex flex-wrap items-baseline gap-x-2 text-sm font-bold">
            <span className="num">{klass.firstStart}</span>
            <span>{klass.className}</span>
            {klass.teacherName && (
              <span className="text-text-faint text-xs font-normal">{klass.teacherName}</span>
            )}
          </h2>
          <div className="flex flex-wrap gap-1">
            {klass.students.map((s) => (
              <SeatingCell key={s.studentId} date={board.date} klass={klass} student={s} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
