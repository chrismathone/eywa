"use client";

import { useState } from "react";
import { SeriesChart } from "@/components/analytics/charts";
import { palette } from "@/components/analytics/chart-math";
import { saveWithdrawalTrendPrefs } from "@/features/withdrawals/server/trend-prefs-actions";
import {
  HEAT_CAP, SMALL_BASE, comparePair, deltaSummary, shortMonthLabel, sortTeachers,
  type ChurnSort, type TeacherChurnData,
} from "@/features/withdrawals/teacher-churn";
import { TeacherChurnTable } from "./teacher-churn-table";

const SEG = "text-xs px-2 py-0.5 transition";
const ON = "bg-primary text-primary-foreground font-semibold";
const OFF = "bg-card text-text-dim hover:text-foreground";
const SORTS: readonly { key: ChurnSort; label: string }[] = [{ key: "recent", label: "퇴원율 높은 순" }, { key: "name", label: "이름순" }];
/** 차트에 함께 그릴 강사 수 — 계기판 색(차콜·노랑·회색) 셋까지. 넷째를 고르면 가장 먼저 고른 강사가 빠진다. */
const MAX_PICK = 3;
const LINE_COLORS = [palette[0]!, palette[1]!, palette[2]!];
/** 정렬 저장은 누른 차례대로 — 빠르게 두 번 바꿔도 앞 요청이 늦게 끝나 옛 값으로 덮지 않게. 표시 취향이라 실패는 화면만 그대로. */
let saving: Promise<unknown> = Promise.resolve();
const saveSort = (next: ChurnSort) => {
  saving = saving.then(() => saveWithdrawalTrendPrefs({ churnSort: next })).catch(() => undefined);
};

/** 선 이름 — 같은 이름의 강사를 함께 고르면 차트의 범례·선 열쇠가 겹치니 뒤 사람에 번호를 붙인다. */
function seriesLabel(rows: readonly { name: string }[], i: number): string {
  const same = rows.slice(0, i).filter((r) => r.name === rows[i]!.name).length;
  return same ? `${rows[i]!.name} (${same + 1})` : rows[i]!.name;
}

/**
 * 퇴원관리 **강사별 퇴원율 추이** 카드(원장 2026-11-11) — 모든 강사를 달마다 한 표(히트맵)로 견주고, 이름을 누른 강사(셋까지)는
 * 아래 차트에서 선으로 견준다. 값은 강사평가가 저장한 퇴원율 그대로(`teacher-churn.ts`) · 원장 역할만(서버가 문을 지난 뒤에만 그린다).
 * 정렬은 누르는 순간 계정에 저장(`ui_prefs.withdrawals.churn_sort`). 고른 강사는 저장하지 않는다(그때그때 견주는 동작).
 */
export function TeacherChurnCard({ data, initialSort }: { data: TeacherChurnData; initialSort: ChurnSort }) {
  const [sort, setSort] = useState(initialSort);
  const [picked, setPicked] = useState<string[]>([]);
  const pair = comparePair(data.months);
  const rows = sortTeachers(data.teachers, pair, sort);
  const sum = deltaSummary(data.teachers, pair);
  const colorOf = (id: string) => {
    const i = picked.indexOf(id);
    return i < 0 ? null : LINE_COLORS[i]!;
  };
  const pick = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-MAX_PICK)));
  const choose = (next: ChurnSort) => {
    if (next === sort) return;
    setSort(next);
    saveSort(next);
  };
  // 차트 = 마감한 달만(진행 중인 달은 월초에 늘 낮아 선이 꺾여 보인다) · 그 강사의 그 달이 마감 전이면 점을 찍지 않는다.
  const closedMonths = data.months.filter((m) => !m.partial);
  const pickedRows = picked.map((id) => data.teachers.find((t) => t.id === id)).filter((t) => t !== undefined);
  const points = closedMonths.map((m, i) => ({
    label: shortMonthLabel(m.month, closedMonths[i - 1]?.month ?? null),
    values: pickedRows.map((t) => {
      const c = t.cells[m.month];
      return c && c.closed && c.state === "ok" ? c.rate : null;
    }),
  }));

  return (
    <section className="bg-card shadow-card rounded-2xl p-5" aria-label="강사별 퇴원율 추이">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-foreground text-base font-bold">강사별 퇴원율 추이</h2>
          {/* 세는 기준을 숫자 옆에 — 위 퇴원 수·필터와 다른 잣대라 같은 화면에서 숫자가 갈려 보일 수 있다. */}
          <p className="text-text-faint mt-0.5 text-xs leading-relaxed">
            강사평가 퇴원율 그대로 · 지난달 그 강사가 절반 이상 맡은 학생 중 그 달 그 강사의 반·가르친 과목을 그만둔 학생의 비율 · 실제 그만둔
            날 기준. 수강종료를 셀지와 빼는 사유(이사·졸업 등)는 강사평가 설정을 따르고, 반 이동·같은 과목 다른 반을 계속 다니는 경우는 늘 빠집니다(마감한
            달은 그때 설정으로 굳은 값). 위 필터를 따르지 않고, 위 퇴원 수(수강료를 낸 마지막 달 기준)와는 따로 셉니다.
          </p>
        </div>
        <div role="group" aria-label="강사 정렬" className="border-border inline-flex shrink-0 overflow-hidden rounded-md border">
          {SORTS.map((s, i) => (
            <button key={s.key} type="button" aria-pressed={sort === s.key} onClick={() => choose(s.key)}
              className={`${SEG} ${i > 0 ? "border-border border-l" : ""} ${sort === s.key ? ON : OFF}`}>
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {pair ? (
        <p className="mb-2 text-sm">
          <b>{Number(pair[0].slice(5, 7))}월 → {Number(pair[1].slice(5, 7))}월</b>{" "}
          오른 강사 <b className="num">{sum.up}</b>명 · 내린 강사 <b className="num">{sum.down}</b>명 · 같은 강사 <b className="num">{sum.same}</b>명
          <span className="text-text-faint text-xs"> (두 달 모두 마감하고 퇴원율이 있는 강사만{sort === "recent" ? ` · 정렬은 ${Number(pair[1].slice(5, 7))}월 퇴원율` : ""})</span>
        </p>
      ) : null}

      <TeacherChurnTable rows={rows} months={data.months} pair={pair} picked={picked} colorOf={colorOf} onPick={pick} />

      <div className="text-text-faint mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          0%
          <i aria-hidden className="border-line inline-block h-2.5 w-20 rounded-full border"
            style={{ background: "linear-gradient(to right, var(--card), color-mix(in srgb, var(--gold-bright) 80%, var(--card)))" }} />
          {HEAT_CAP}% 이상 (마감한 값만 색칠)
        </span>
        <span>＊ 담당 {SMALL_BASE}명 미만 — 한 명이 그만둬도 10%p 넘게 오릅니다</span>
        <span>칸 = 퇴원율 · 그만둔 학생/지난달 담당</span>
      </div>

      <div className="mt-4">
        {pickedRows.length ? (
          <SeriesChart points={points} unit="%" series={pickedRows.map((t, i) => ({ label: seriesLabel(pickedRows, i), color: LINE_COLORS[i]! }))} />
        ) : (
          <p className="bg-bg-soft rounded-lg px-4 py-3 text-sm">
            강사 이름을 누르면 여기서 달마다 선으로 견줍니다(최대 {MAX_PICK}명 · 마감한 달만).
          </p>
        )}
      </div>
    </section>
  );
}
