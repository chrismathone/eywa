"use client";

/**
 * 반 한 장 — 강의실 4열 중 한 칸. 학생은 3열로 쌓여 2~3행이 된다.
 */
import { seatingHeaderClass, type SeatingClass } from "../seating";
import { SeatingCell } from "./seating-cell";

export function SeatingRoom({ date, klass }: { date: string; klass: SeatingClass }) {
  const time =
    klass.firstEnd && klass.firstEnd !== klass.firstStart
      ? `${klass.firstStart}~${klass.firstEnd}`
      : klass.firstStart;

  return (
    <article className="bg-card shadow-card flex min-w-0 flex-col overflow-hidden rounded-2xl">
      <header className={`px-2 py-2 text-center text-sm font-bold ${seatingHeaderClass(klass.phase)}`}>
        <h4>{klass.className}</h4>
        {klass.seatLabel ? null : (
          <p className="mt-0.5">
            {time}
            {klass.teacherName ? ` · ${klass.teacherName}` : ""}
          </p>
        )}
      </header>
      <div className="bg-bg-soft px-2 py-2">
        <div className="grid grid-cols-3 gap-1">
          {klass.students.map((s) => (
            <SeatingCell key={s.studentId} date={date} klass={klass} student={s} />
          ))}
        </div>
      </div>
    </article>
  );
}
