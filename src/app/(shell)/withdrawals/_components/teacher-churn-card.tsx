"use client";

import { useState } from "react";
import { SeriesChart } from "@/components/analytics/charts";
import { palette } from "@/components/analytics/chart-math";
import { HrefSelect } from "@/components/href-select";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { saveWithdrawalTrendPrefs } from "@/features/withdrawals/server/trend-prefs-actions";
import {
  HEAT_CAP, SMALL_BASE, comparePair, sortTeachers, subjectsTaught, taughtIn, yyMm, type ChurnSort, type TeacherChurnData,
} from "@/features/withdrawals/teacher-churn";
import { AFTER_RESIGN_BG, BEFORE_HIRE_BG, TeacherChurnTable } from "./teacher-churn-table";

const SEG = "text-xs px-2 py-0.5 transition";
const ON = "bg-primary text-primary-foreground font-semibold";
const OFF = "bg-card text-text-dim hover:text-foreground";
const SORTS: readonly { key: ChurnSort; label: string }[] = [{ key: "recent", label: "퇴원율 높은 순" }, { key: "name", label: "이름순" }];
/** 처음 보이는 기간 — 받은 달 중 최근 12개월. */
const DEFAULT_SPAN = 12;
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
 * 과목·기간은 카드 안에서 바로 거른다(받은 달 안 · 퇴원관리의 다른 필터처럼 저장하지 않는다 — 새로 열면 전체 과목 · 최근 12개월).
 * 정렬은 누르는 순간 계정에 저장(`ui_prefs.withdrawals.churn_sort`).
 */
export function TeacherChurnCard({ data, initialSort }: { data: TeacherChurnData; initialSort: ChurnSort }) {
  const subjectMaps = useSubjectMaps();
  const all = data.months;
  const [sort, setSort] = useState(initialSort);
  const [picked, setPicked] = useState<string[]>([]);
  const [subject, setSubject] = useState("all");
  const [from, setFrom] = useState(all[Math.max(0, all.length - DEFAULT_SPAN)]?.month ?? "");
  const [to, setTo] = useState(all.at(-1)?.month ?? "");

  const months = all.filter((m) => m.month >= from && m.month <= to);
  // 가르친 과목 = 학원 설정 차례 · 고른 기간에 가르친 강사가 있는 과목만(퇴원율은 과목별 값이 아니라 그 강사의 값 — `taughtIn`).
  const taught = subjectsTaught(data.teachers, months);
  const subjectOptions = [{ value: "all", label: "전체" }, ...subjectMaps.options.filter((o) => taught.has(o.value) || o.value === subject)];
  // 고른 과목을 그 기간에 가르친 강사 · 보이는 달에 칸이 하나라도 있는 강사만(재직 밖 달뿐인 줄은 세우지 않는다).
  const teachers = data.teachers.filter((t) => taughtIn(t, months, subject) && months.some((m) => t.cells[m.month]));
  const pair = comparePair(months);
  const rows = sortTeachers(teachers, pair, sort);
  const pickedRows = picked.map((id) => teachers.find((t) => t.id === id)).filter((t) => t !== undefined);
  const colorOf = (id: string) => {
    const i = pickedRows.findIndex((t) => t.id === id);
    return i < 0 ? null : LINE_COLORS[i]!;
  };
  const pick = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev.filter((x) => teachers.some((t) => t.id === x)), id].slice(-MAX_PICK)));
  const choose = (next: ChurnSort) => {
    if (next === sort) return;
    setSort(next);
    saveSort(next);
  };
  // 차트 = 마감한 달만(진행 중인 달은 월초에 늘 낮아 선이 꺾여 보인다) · 그 강사의 그 달이 마감 전이면 점을 찍지 않는다.
  const points = months.filter((m) => !m.partial).map((m) => ({
    label: yyMm(m.month),
    values: pickedRows.map((t) => {
      const c = t.cells[m.month];
      return c && c.closed && c.state === "ok" ? c.rate : null;
    }),
  }));
  const monthOption = (m: { month: string }) => ({ value: m.month, label: yyMm(m.month) });

  return (
    <section className="bg-card shadow-card rounded-2xl p-5" aria-label="강사별 퇴원율 추이">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-foreground text-base font-bold">강사별 퇴원율 추이</h2>
          {/* 세는 기준을 숫자 옆에 — 위 퇴원 수·필터와 다른 잣대라 같은 화면에서 숫자가 갈려 보일 수 있다. */}
          <p className="text-text-faint mt-0.5 text-xs">
            강사평가 퇴원율 · 지난달 절반 이상 맡은 학생 중 그 달 그만둔 비율 · 입사 다음 달부터 퇴사한 달까지 · 위 필터·퇴원 수와 따로 셉니다
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HrefSelect axisLabel="가르친 과목" ariaLabel="가르친 과목 선택" value={subject} onSelect={setSubject} options={subjectOptions} />
          <HrefSelect axisLabel="시작" ariaLabel="시작 달" value={from} onSelect={setFrom}
            options={all.filter((m) => m.month <= to).map(monthOption)} />
          <HrefSelect axisLabel="끝" ariaLabel="끝 달" value={to} onSelect={setTo}
            options={all.filter((m) => m.month >= from).map(monthOption)} />
          <div role="group" aria-label="강사 정렬" className="border-border inline-flex shrink-0 overflow-hidden rounded-md border">
            {SORTS.map((s, i) => (
              <button key={s.key} type="button" aria-pressed={sort === s.key} onClick={() => choose(s.key)}
                className={`${SEG} ${i > 0 ? "border-border border-l" : ""} ${sort === s.key ? ON : OFF}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {rows.length ? (
        <TeacherChurnTable rows={rows} months={months} pair={pair} picked={pickedRows.map((t) => t.id)} colorOf={colorOf} onPick={pick} />
      ) : (
        <p className="bg-bg-soft rounded-lg px-4 py-3 text-sm" role="status">고른 과목·기간에 퇴원율이 있는 강사가 없습니다.</p>
      )}

      <div className="text-text-faint mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          0%
          <i aria-hidden className="border-line inline-block h-2.5 w-20 rounded-full border"
            style={{ background: "linear-gradient(to right, var(--card), color-mix(in srgb, var(--gold-bright) 80%, var(--card)))" }} />
          {HEAT_CAP}% 이상 (마감한 값만 색칠)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden className="border-line inline-block size-3 rounded-sm border" style={{ background: BEFORE_HIRE_BG }} />입사 전
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden className="border-line inline-block size-3 rounded-sm border" style={{ background: AFTER_RESIGN_BG }} />퇴사 뒤
        </span>
        <span>＊ 담당 {SMALL_BASE}명 미만 — 한 명이 그만둬도 10%p 넘게 오릅니다</span>
        <span>칸 = 퇴원율 · 그만둔 학생/지난달 담당</span>
      </div>

      {pickedRows.length ? (
        <div className="mt-4">
          <SeriesChart points={points} unit="%" series={pickedRows.map((t, i) => ({ label: seriesLabel(pickedRows, i), color: LINE_COLORS[i]! }))} />
        </div>
      ) : null}
    </section>
  );
}
