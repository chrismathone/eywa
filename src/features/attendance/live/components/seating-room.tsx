"use client";

/**
 * 강의실 한 장 — 칠판(방·반·시각) + 그 반의 오늘 좌석.
 * 색은 출석불만 `--att-*`. 칸 최소 44px.
 */
import type { SeatingClass } from "../seating";
import { SeatingCell } from "./seating-cell";

function seatColumns(n: number): number {
  if (n <= 4) return Math.max(n, 1);
  if (n <= 8) return 4;
  if (n <= 15) return 5;
  if (n <= 24) return 6;
  return 8;
}

export function SeatingRoom({ date, klass }: { date: string; klass: SeatingClass }) {
  const cols = seatColumns(klass.students.length);
  const time =
    klass.firstEnd && klass.firstEnd !== klass.firstStart
      ? `${klass.firstStart}~${klass.firstEnd}`
      : klass.firstStart;

  return (
    <article className="bg-card shadow-card flex flex-col overflow-hidden rounded-2xl">
      <header className="bg-primary px-3 py-2 text-center text-white">
        <h4 className="text-sm font-bold">{klass.className}</h4>
        <p className="num mt-0.5 text-[11px] opacity-80">
          {time}
          {klass.teacherName ? ` · ${klass.teacherName}` : ""}
        </p>
      </header>
      <div className="bg-bg-soft px-3 pt-2 pb-3">
        <div className="bg-primary/80 mx-auto mb-2 h-1 w-2/3 rounded-full" aria-hidden />
        <div
          className="mx-auto grid justify-items-center gap-1.5"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(44px, 1fr))` }}
        >
          {klass.students.map((s) => (
            <SeatingCell key={s.studentId} date={date} klass={klass} student={s} />
          ))}
        </div>
      </div>
    </article>
  );
}
