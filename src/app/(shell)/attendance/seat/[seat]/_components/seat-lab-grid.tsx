"use client";

import { schoolGradeLabel } from "@/lib/format/school-grade";
import { fitSeatName, SEAT_CHIP_NAME_LADDER } from "@/features/attendance/seat/name-fit";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import type { SeatStatus } from "@/features/attendance/seat/server/actions";
import { SEAT_LABEL, SEAT_TONE } from "./seat-status";

/** 랩실 출석부 — 이름 카드에 출결만. JJ 전용 칸은 여기에 넣지 않는다. */
export function SeatLabGrid({
  rosters,
  statusOf,
  onSave,
  onFillClass,
  readOnly,
  pending,
}: {
  rosters: SeatClassRoster[];
  statusOf: (classId: string, student: SeatClassRoster["students"][number]) => SeatStatus | null;
  onSave: (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => void;
  onFillClass: (classId: string) => void;
  readOnly: boolean;
  pending: boolean;
}) {
  return (
    <>
      {rosters.map((r) => {
        const left = r.students.filter((s) => statusOf(r.classId, s) === null).length;
        return (
          <section key={r.classId} className="border-line overflow-hidden rounded-2xl border">
            <header className="bg-bg-soft border-line flex items-center gap-2 border-b px-3 py-1.5 text-[13px]">
              <span className="font-bold">{r.className}</span>
              <span className="text-text-faint text-[11px] tabular-nums">{r.students.length}명</span>
              <span className="text-text-faint text-[11px] tabular-nums">~{r.end}</span>
              {!readOnly && left > 0 ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onFillClass(r.classId)}
                  className="border-line bg-card text-primary ml-auto rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold disabled:opacity-50"
                >
                  이 반 출석
                </button>
              ) : null}
            </header>
            <ul className="grid gap-2 p-3 [grid-template-columns:repeat(auto-fill,minmax(148px,1fr))]">
              {r.students.map((s) => {
                const cur = statusOf(r.classId, s);
                // 긴 이름(동명이인 알파벳 접미사)은 잘라내지 않고 그 칩만 글씨를 줄인다.
                const fit = fitSeatName(s.name, SEAT_CHIP_NAME_LADDER);
                return (
                  <li key={s.id} className="relative">
                    <button
                      type="button"
                      disabled={readOnly || pending}
                      onClick={() => onSave(r.classId, s.id, cur === "present" ? null : "present", cur)}
                      className={`border-line flex min-h-[54px] w-full flex-col items-start rounded-xl border px-2.5 py-2 text-left transition disabled:cursor-default ${
                        cur ? SEAT_TONE[cur] : "bg-card border-dashed"
                      }`}
                    >
                      {/* `pr-5` = 오른쪽 위 상태 배지·'결' 버튼 자리를 비워 둔다(안 비우면 긴 이름이
                          배지 밑으로 들어간다). `leading-5`로 줄 높이를 고정해 단계가 내려가도 칩 높이는
                          그대로. 하한(12px)에서도 넘칠 때만 말줄임 + 전체 이름 툴팁. */}
                      <span
                        className={`w-full truncate pr-5 leading-5 font-bold ${fit.className}`}
                        title={fit.clipped ? s.name : undefined}
                      >
                        {s.name}
                      </span>
                      <span className="text-[11.5px] opacity-80">
                        {schoolGradeLabel(s.school, s.grade) || " "}
                      </span>
                    </button>
                    {cur ? (
                      <span className="pointer-events-none absolute top-1.5 right-2 text-[10px] font-extrabold">
                        {SEAT_LABEL[cur]}
                      </span>
                    ) : null}
                    {!readOnly && cur !== "absent" ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onSave(r.classId, s.id, "absent", cur)}
                        aria-label={`${s.name} 결석`}
                        className="border-line bg-card text-text-faint hover:text-att-absent-ink absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full border text-[10px] font-bold"
                      >
                        결
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
