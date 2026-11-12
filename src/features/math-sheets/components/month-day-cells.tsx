"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { CELL_STATE_LABEL, type MathCellState } from "../lib/cell-state";
import { TEST_KIND_LABEL, TEST_KIND_TITLE, testCountLabel, testScoresOf } from "../lib/test-score";
import type { MathSheetMonthData, MathStudentRow } from "../server/month-queries";

/**
 * 진도표의 **오른쪽 칸들** — 수업일 머리 · 학생 × 수업일 칸(바닥 합계 행은 없다 — 툴바 칩이 같은 수). 왼쪽 고정열은
 * [`StudentHeadCell`](./student-head-cell.tsx)이고 표 껍데기는 [`MonthGrid`](./month-grid.tsx)다.
 *
 * 🔴 칸이 비는 이유 셋을 **다른 무늬**로 그린다(`cell-state.ts` 참조) — 왔는데 안 적힌 칸(빗금)과
 *    출결조차 없는 칸(회색)과 결석(연회색 라벨)을 한 색으로 뭉치면 "미작성 969건" 같은 거짓말이 된다.
 * 🔴 목표 밖 교재 칸은 **네 변 테두리 + `목표 밖` 칩**(원장 2026-09-02 *"다른진도 테두리 더 확실하게"*).
 *    border-collapse 표라 border를 굵히면 이웃과 선을 나눠 갖고 행이 밀리므로 outline으로 칸 안에 그린다.
 * 🔴 시험 점수는 `일일 13/22`(맞은 개수/전체)만 — 원장 2026-09-02 *"%는 제외하고 정답 개수/전체 개수만"*.
 *    종류·순서·옛 합본 폴백은 test-score.ts 단일 소스(학부모 카드와 같은 우선순위). 원문은 툴팁에.
 */
const CELL_TONE: Record<MathCellState, string> = {
  written: "",
  unwritten:
    "bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,color-mix(in_srgb,var(--danger)_7%,transparent)_5px,color-mix(in_srgb,var(--danger)_7%,transparent)_10px)]",
  absent: "bg-bg-soft/60",
  // 🔴 **지난 칸의 무기록**만 회색으로 채운다 — 아직 안 지난 칸은 **빈 칸**이다(원장 2026-09-01:
  //    9월을 열면 전 칸이 회색 "출결도 기록도 없음"이라 아무도 잘못 안 했는데 다 틀린 것처럼 보였다).
  //    색은 휴일과 **같은 회색**(원장 2026-09-02 *"기록 없는 셀과 휴강 셀 색상 통일 (공휴일 기준)"*) —
  //    둘을 가르는 건 색이 아니라 칸 안의 문구(공휴일명 / "기록 없음")다.
  untracked: "bg-att-weekend",
  upcoming: "",
  // 🔴 휴일 회색은 월별 출석부와 **같은 토큰**(`--att-weekend`) — 새 색을 만들지 않는다(의미색 캐논).
  holiday: "bg-att-weekend",
  "off-roster": "bg-muted/40",
};

/**
 * 칸 안에 적는 문구 — 이름은 [`CELL_STATE_LABEL`](../lib/cell-state) 단일 소스에서 가져온다.
 * ⚠️ 아직 안 지난 날만 **아무 말도 하지 않는다**(빈 칸이 곧 "아직"이고, 30칸에 같은 문장을 반복하면
 *    그게 소음이다 — 무엇인지는 칸 툴팁이 말한다).
 */
function cellNote(state: MathCellState, holidayName?: string | null): string {
  if (state === "upcoming") return "";
  // 휴일은 **이름이 곧 사유**라 "학원 휴일"보다 "추석"이 낫다(라벨은 이름이 없을 때의 폴백).
  if (state === "holiday") return holidayName || CELL_STATE_LABEL.holiday;
  return CELL_STATE_LABEL[state];
}

export function DayHeadCells({ data }: { data: MathSheetMonthData }) {
  return (
    <>
      {data.days.map((day) => {
        const warn = (data.offGoalByDate[day.date] ?? 0) > 0;
        // 🔴 휴일 열은 **지우지 않는다** — 그날 실제로 한 수업 기록이 여기 그대로 서야 한다
        //    (원장 2026-09-01 *"입력은 가능하도록"*). 목표 밖 경고가 있으면 그쪽이 이긴다.
        const holiday = data.holidays[day.date] ?? null;
        return (
          <th
            key={day.date}
            title={holiday ? `${day.date} · ${holiday} — 학원 휴일` : undefined}
            // 휴일 글자 = 출석부 휴일 잉크(`text-att-holiday-ink`) — 공용 `text-danger`는 휴일 회색(`--att-weekend`)
            // 위에서 대비 3.75로 WCAG 4.5를 깼다(2026-09-14, 월별 출석부 머리와 같은 잉크).
            className={`border-line-faint num border p-2 text-center text-xs font-extrabold whitespace-nowrap ${
              warn
                ? "bg-amber-soft text-amber"
                : holiday
                  ? "bg-att-weekend text-att-holiday-ink"
                  : "bg-bg-soft text-text-dim"
            }`}
          >
            {Number(day.date.slice(5, 7))}/{Number(day.date.slice(8, 10))}
            {/* 휴일이면 요일 자리에 공휴일명 — "이 열이 왜 회색인가"의 답이 요일보다 유용하다.
                🔴 회색 휴일 머리에선 흐리게(opacity-70) 하지 않는다 — 휴일 잉크를 70%로 섞으면 대비가 4.16으로
                   다시 4.5 아래다(2026-09-14 실측). 경고(앰버)·평일 머리는 종전 그대로. */}
            <span className={`ml-1 font-semibold ${holiday && !warn ? "" : "opacity-70"}`}>
              {holiday ?? "일월화수목금토"[new Date(`${day.date}T00:00:00Z`).getUTCDay()]}
            </span>
          </th>
        );
      })}
    </>
  );
}

export function DayCells({ stu, data }: { stu: MathStudentRow; data: MathSheetMonthData }) {
  return (
    <>
      {data.days.map((day) => {
        const state = stu.cells[day.date] ?? "untracked";
        const rec = stu.records[day.date];
        const stalled = stu.stalledDates.includes(day.date);
        const tests = rec ? testScoresOf(rec) : [];
        return (
          <td
            key={day.date}
            // 상태 이름을 그대로 노출하지 않는다 — 한글 문구는 cellNote 단일 소스.
            title={
              state === "upcoming"
                ? `${day.date} · ${CELL_STATE_LABEL.upcoming}`
                : state === "holiday"
                  ? `${day.date} · ${data.holidays[day.date] ?? CELL_STATE_LABEL.holiday} — 학원 휴일이라 기록 의무가 없습니다`
                  : undefined
            }
            // 배경은 한 축에서 하나만 — 목표 밖이면 그 색이 상태 색을 대신한다(둘을 같이 적으면 승자는 CSS 순서, [[#116]]).
            className={`border-line-faint min-w-[178px] border p-2 align-top ${
              rec?.offGoal ? "bg-amber-soft/40 outline-amber outline-2 -outline-offset-2" : CELL_TONE[state]
            }`}
          >
            {rec ? (
              <>
                {/* 글씨는 칸 크기에 맞춰 키웠다(원장 2026-09-02 *"전체적으로 공간 많으므로 가독성"*) —
                    행 높이는 고정열의 목표 칸이 정하므로 본문이 커져도 표가 길어지지 않는다. */}
                {rec.textbook ? (
                  <div
                    className={`mb-1 flex items-center gap-1.5 text-sm leading-tight font-bold ${
                      rec.offGoal ? "text-amber" : "text-primary"
                    }`}
                  >
                    <span className="min-w-0">{rec.textbook}</span>
                    {rec.offGoal ? (
                      <span
                        title="이 달 목표에 적은 교재와 다릅니다"
                        className="bg-amber shrink-0 rounded px-1.5 text-xs leading-[18px] font-extrabold text-white"
                      >
                        목표 밖
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <div className="text-foreground text-base leading-snug whitespace-pre-line">{rec.progress ?? "—"}</div>
                {tests.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm leading-tight">
                    {tests.map((t) => (
                      <span key={t.kind} title={`${TEST_KIND_TITLE[t.kind]} ${t.raw}`} className="num">
                        <span className="text-text-dim font-semibold">{TEST_KIND_LABEL[t.kind]} </span>
                        <b className="text-foreground font-extrabold">{testCountLabel(t)}</b>
                      </span>
                    ))}
                  </div>
                ) : null}
                {stalled ? (
                  <div className="text-amber mt-1.5 flex items-center gap-1 text-xs font-bold">
                    <EyIcon name="alert" size={12} />
                    같은 진도 반복
                  </div>
                ) : null}
              </>
            ) : (
              <div className="text-text-faint text-xs font-bold">{cellNote(state, data.holidays[day.date])}</div>
            )}
          </td>
        );
      })}
    </>
  );
}
