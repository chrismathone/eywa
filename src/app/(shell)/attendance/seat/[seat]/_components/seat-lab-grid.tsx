"use client";

import { schoolGradeLabel } from "@/lib/format/school-grade";
import {
  fitSeatName,
  fluidNameFontSize,
  LAB_CHIP_NAME_FILL,
  NAME_FILL_MAX_PX,
  NAME_FILL_MIN_PX,
  SEAT_CHIP_NAME_LADDER,
} from "@/features/attendance/seat/name-fit";
import { seatNoteTitle } from "@/features/attendance/seat/note-title";
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
            <header className="bg-bg-soft border-line flex items-center gap-2 border-b px-3 py-1.5 text-sm">
              <span className="font-bold">{r.className}</span>
              <span className="text-text-faint text-xs tabular-nums">{r.students.length}명</span>
              <span className="text-text-faint text-xs tabular-nums">~{r.end}</span>
              {!readOnly && left > 0 ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onFillClass(r.classId)}
                  className="border-line bg-card text-primary ml-auto rounded-full border px-2.5 py-0.5 text-xs font-semibold disabled:opacity-50"
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
                // 사유 메모는 카드 전체의 툴팁이다(원장 2026-08-28 "마우스 오버시 결석사유") — 카드 안
                // 어디에 올려도 뜨도록 <li>에 단다. 자기 title을 가진 자식(잘린 이름)만 자기 것을 띄운다.
                const noteTitle = seatNoteTitle(cur, s.note);
                return (
                  <li key={s.id} className="relative" title={noteTitle ?? undefined}>
                    <button
                      type="button"
                      disabled={readOnly || pending}
                      onClick={() => onSave(r.classId, s.id, cur === "present" ? null : "present", cur)}
                      className={`@container border-line flex h-full min-h-[54px] w-full flex-col items-start rounded-xl border px-2.5 py-2 text-left transition disabled:cursor-default ${
                        cur ? SEAT_TONE[cur] : "bg-card border-dashed"
                      }`}
                    >
                      {/* `pr-5` = 오른쪽 위 상태 배지·'결' 버튼 자리를 비워 둔다(안 비우면 긴 이름이
                          배지 밑으로 들어간다). 글자는 칩 폭에 비례(name-fit.ts `fluidNameFontSize`, 원장 2026-09-04
                          "출결에도 이름 꽉 차게") — 배지 자리를 뺀 폭만 쓴다(`LAB_CHIP_NAME_FILL`). 하한에서도 넘칠 때만
                          말줄임 + 전체 이름 툴팁. 버튼은 `h-full` — 격자 한 줄 안에서 이름이 상한(24px)에 닿은 칩과
                          긴 이름이라 작아진 칩의 높이가 갈리지 않게(li가 줄 높이로 늘고 버튼이 그걸 채운다). */}
                      <span
                        className="w-full truncate pr-5 leading-none font-bold"
                        style={{
                          fontSize: fluidNameFontSize(s.name, { minPx: NAME_FILL_MIN_PX.labChip, maxPx: NAME_FILL_MAX_PX, fill: LAB_CHIP_NAME_FILL }),
                        }}
                        // 이름이 잘린 칩에서는 이름 툴팁이 <li>의 사유를 가린다 → 둘을 이어 붙인다.
                        title={
                          fit.clipped ? (noteTitle ? `${s.name} · ${noteTitle}` : s.name) : (noteTitle ?? undefined)
                        }
                      >
                        {s.name}
                      </span>
                      <span className="text-xs opacity-80">
                        {schoolGradeLabel(s.school, s.grade) || " "}
                      </span>
                    </button>
                    {cur ? (
                      <span className="pointer-events-none absolute top-1.5 right-2 text-xs font-extrabold">
                        {SEAT_LABEL[cur]}
                      </span>
                    ) : null}
                    {!readOnly && cur !== "absent" ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onSave(r.classId, s.id, "absent", cur)}
                        aria-label={`${s.name} 결석`}
                        className="border-line bg-card text-text-faint hover:text-att-absent-ink absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full border text-xs font-bold"
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
