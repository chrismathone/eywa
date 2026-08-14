"use client";

/**
 * 반 한 장 — 수업명 배경으로 시작 전/후를 가른다.
 */
import { seatingHeaderClass, type SeatingClass } from "../seating";
import { SeatingCell } from "./seating-cell";

export function SeatingRoom({ date, klass }: { date: string; klass: SeatingClass }) {
  const time =
    klass.firstEnd && klass.firstEnd !== klass.firstStart
      ? `${klass.firstStart}~${klass.firstEnd}`
      : klass.firstStart;

  return (
    <article className="bg-card shadow-card flex flex-col overflow-hidden rounded-2xl">
      <header className={`px-3 py-2 text-center text-sm font-bold ${seatingHeaderClass(klass.phase)}`}>
        <h4>{klass.className}</h4>
        <p className="mt-0.5">
          {time}
          {klass.teacherName ? ` · ${klass.teacherName}` : ""}
        </p>
      </header>
      <div className="bg-bg-soft px-2.5 py-2.5">
        <div className="flex flex-wrap gap-1">
          {klass.students.map((s) => (
            <SeatingCell key={s.studentId} date={date} klass={klass} student={s} />
          ))}
        </div>
      </div>
    </article>
  );
}
