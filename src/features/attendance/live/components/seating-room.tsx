"use client";

/**
 * 반 한 장 — 강의실 4열 중 한 칸. 학생은 3열로 쌓여 2~3행이 된다.
 * 색은 `seating-tone.ts` 단일 소스(지금·예정·지남/미입력·지남/완료).
 */
import type { SeatingClass } from "../seating";
import {
  pendingCountOf,
  seatingCardClass,
  seatingHeaderClass,
  seatingToneNote,
  seatingToneOf,
} from "../seating-tone";
import { SeatingCell } from "./seating-cell";

export function SeatingRoom({
  date,
  klass,
  /** 학생 검색에 걸린 id — 그 칸만 테두리로 짚는다(카드 명단은 줄이지 않는다, seating-chart 주석). */
  highlight,
}: {
  date: string;
  klass: SeatingClass;
  highlight?: ReadonlySet<string>;
}) {
  const time =
    klass.firstEnd && klass.firstEnd !== klass.firstStart
      ? `${klass.firstStart}~${klass.firstEnd}`
      : klass.firstStart;
  const pending = pendingCountOf(klass);
  const tone = seatingToneOf(klass.band, pending);
  const note = seatingToneNote(tone, pending);

  return (
    <article
      className={`bg-card flex min-w-0 flex-col overflow-hidden rounded-2xl ${seatingCardClass(tone)}`}
    >
      <header className={`px-2 py-2 text-center text-sm font-bold ${seatingHeaderClass(tone)}`}>
        <h4>{klass.className}</h4>
        {klass.seatLabel ? null : (
          <p className="mt-0.5">
            {time}
            {klass.teacherName ? ` · ${klass.teacherName}` : ""}
          </p>
        )}
        {note && <p className="num mt-0.5 text-[11px]">{note}</p>}
      </header>
      <div className="bg-bg-soft px-2 py-2">
        <div className="grid grid-cols-3 gap-1">
          {klass.students.map((s) => (
            <SeatingCell
              key={s.studentId}
              date={date}
              klass={klass}
              student={s}
              found={highlight?.has(s.studentId) ?? false}
            />
          ))}
        </div>
      </div>
    </article>
  );
}
