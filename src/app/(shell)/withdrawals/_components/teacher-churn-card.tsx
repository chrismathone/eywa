"use client";

import { useState } from "react";
import { SeriesChart } from "@/components/analytics/charts";
import { HrefSelect } from "@/components/href-select";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { saveWithdrawalTrendPrefs } from "@/features/withdrawals/server/trend-prefs-actions";
import {
  HEAT_CAP, SMALL_BASE, comparePair, sortTeachers, subjectsTaught, visibleTeachers, yyMm, type ChurnSort, type TeacherChurnData,
} from "@/features/withdrawals/teacher-churn";
import { chartCeil, chartMonths, dupName, type ChurnView } from "@/features/withdrawals/teacher-churn-view";
import { TeacherChurnChart } from "./teacher-churn-chart";
import { CONTEXT_COLOR, LINE_COLORS } from "./teacher-churn-colors";
import { AFTER_RESIGN_BG, BEFORE_HIRE_BG, TeacherChurnTable } from "./teacher-churn-table";

const SEG = "text-xs px-2 py-0.5 transition";
const ON = "bg-primary text-primary-foreground font-semibold";
const OFF = "bg-card text-text-dim hover:text-foreground";
const SORTS: readonly { key: ChurnSort; label: string }[] = [{ key: "recent", label: "퇴원율 높은 순" }, { key: "name", label: "이름순" }];
const VIEWS: readonly { key: ChurnView; label: string }[] = [{ key: "table", label: "표" }, { key: "chart", label: "차트" }];
/** 처음 보이는 기간 — 받은 달 중 최근 12개월. */
const DEFAULT_SPAN = 12;
/** 고를 수 있는 강사 수 — 계기판 색(차콜·노랑·회색) 셋까지. 넷째를 고르면 가장 먼저 고른 강사가 빠진다. */
const MAX_PICK = 3;
/** 정렬·보기 저장은 누른 차례대로 — 빠르게 두 번 바꿔도 앞 요청이 늦게 끝나 옛 값으로 덮지 않게. 표시 취향이라 실패는 화면만 그대로. */
let saving: Promise<unknown> = Promise.resolve();
const savePrefs = (p: { churnSort?: ChurnSort; churnView?: ChurnView }) => {
  saving = saving.then(() => saveWithdrawalTrendPrefs(p)).catch(() => undefined);
};

/**
 * 퇴원관리 **강사별 퇴원율 추이** 카드(원장 2026-11-11) — 모든 강사를 달마다 한 표(히트맵)로 견주고, 이름을 누른 강사(셋까지)는
 * 아래 차트에서 선으로 견준다. **차트 보기**(같은 날 *"차트로 전환도 가능하게 표/차트"*) = 모든 강사를 한 차트에(`TeacherChurnChart` ·
 * 원장 2026-11-12 *"전체 선생님을 하나의 차트에"* — 강사별 작은 차트 격자를 뒤집음) — 고른 강사는 두 보기가 같은 값·같은 색이다.
 * 과목·기간·퇴사자 숨김·정렬은 두 보기가 같은 줄(`rows`)을 쓴다. 값은 강사평가가 저장한 퇴원율 그대로(`teacher-churn.ts`) ·
 * 권한 '강사별 퇴원율'이 열린 사람만(서버가 문을 지난 뒤에만 그린다).
 * 과목·기간은 카드 안에서 바로 거른다(받은 달 안 · 퇴원관리의 다른 필터처럼 저장하지 않는다 — 새로 열면 전체 과목 · 최근 12개월).
 * 정렬·보기는 누르는 순간 계정에 저장(`ui_prefs.withdrawals.churn_sort` · `churn_view`).
 */
export function TeacherChurnCard({ data, initialSort, initialView }: { data: TeacherChurnData; initialSort: ChurnSort; initialView: ChurnView }) {
  const subjectMaps = useSubjectMaps();
  const all = data.months;
  const [sort, setSort] = useState(initialSort);
  const [view, setView] = useState(initialView);
  const [picked, setPicked] = useState<string[]>([]);
  const [subject, setSubject] = useState("all");
  const [hideResigned, setHideResigned] = useState(false);
  const [from, setFrom] = useState(all[Math.max(0, all.length - DEFAULT_SPAN)]?.month ?? "");
  const [to, setTo] = useState(all.at(-1)?.month ?? "");

  const months = all.filter((m) => m.month >= from && m.month <= to);
  // 가르친 과목 = 학원 설정 차례 · 고른 기간에 가르친 강사가 있는 과목만(퇴원율은 과목별 값이 아니라 그 강사의 값 — `taughtIn`).
  const taught = subjectsTaught(data.teachers, months);
  const subjectOptions = [{ value: "all", label: "전체" }, ...subjectMaps.options.filter((o) => taught.has(o.value) || o.value === subject)];
  // 고른 과목을 그 기간에 가르치고 그 기간에 근무한 강사만 — 기간 전체가 퇴사 뒤인 퇴사자는 저절로 빠진다 · 토글은 퇴사자를 모두 뺀다.
  const resignedInView = visibleTeachers(data.teachers, months, subject, false).filter((t) => t.resigned).length;
  const teachers = visibleTeachers(data.teachers, months, subject, hideResigned);
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
    savePrefs({ churnSort: next });
  };
  const chooseView = (next: ChurnView) => {
    if (next === view) return;
    setView(next);
    savePrefs({ churnView: next });
  };
  // 차트 보기의 공통 세로 눈금 — 보이는 강사·마감한 달의 최댓값(범례와 칸이 같은 값).
  const chartAxis = chartMonths(months);
  const ceil = chartCeil(rows, chartAxis);
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
          {/* 세는 기준을 숫자 옆에 — 퇴원 수·필터와 다른 잣대라 같은 화면에서 숫자가 갈려 보일 수 있다.
              카드는 필터 툴바 위에 있다(page.tsx) — 방향('위 필터')을 적지 말 것. */}
          <p className="text-text-faint mt-0.5 text-xs">
            강사평가 퇴원율 · 지난달 절반 이상 맡은 학생 중 그 달 그만둔 비율 · 입사 다음 달부터 퇴사한 달까지 · 필터·퇴원 수와 따로 셉니다
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HrefSelect axisLabel="가르친 과목" ariaLabel="가르친 과목 선택" value={subject} onSelect={setSubject} options={subjectOptions} />
          <HrefSelect axisLabel="시작" ariaLabel="시작 달" value={from} onSelect={setFrom}
            options={all.filter((m) => m.month <= to).map(monthOption)} />
          <HrefSelect axisLabel="끝" ariaLabel="끝 달" value={to} onSelect={setTo}
            options={all.filter((m) => m.month >= from).map(monthOption)} />
          {/* 퇴사자 숨김 — 퇴원관리의 다른 필터처럼 저장하지 않는다(새로 열면 꺼짐 · 고른 기간에 근무한 퇴사자는 그대로 선다). */}
          <button type="button" aria-pressed={hideResigned} onClick={() => setHideResigned((v) => !v)}
            className={`${SEG} border-border shrink-0 rounded-md border ${hideResigned ? ON : OFF}`}>
            퇴사자 숨김{resignedInView ? ` · ${resignedInView}명` : ""}
          </button>
          <Segments label="강사 정렬" items={SORTS} value={sort} onChoose={choose} />
          <Segments label="보기" items={VIEWS} value={view} onChoose={chooseView} />
        </div>
      </header>

      {!rows.length ? (
        <p className="bg-bg-soft rounded-lg px-4 py-3 text-sm" role="status">고른 과목·기간에 퇴원율이 있는 강사가 없습니다.</p>
      ) : view === "chart" ? (
        <TeacherChurnChart rows={rows} months={months} ceil={ceil} picked={pickedRows.map((t) => t.id)} onPick={pick}
          onClearPicks={() => setPicked([])} portfolioLink={data.portfolioLink} />
      ) : (
        <TeacherChurnTable rows={rows} months={months} pair={pair} picked={pickedRows.map((t) => t.id)} colorOf={colorOf} onPick={pick} portfolioLink={data.portfolioLink} />
      )}

      <div className="text-text-faint mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {view === "chart" ? (
          // 마감한 달이 없는 기간이면 눈금·점 범례는 뜻이 없다(차트 자리가 그 사실을 말한다).
          chartAxis.length ? (
            <>
              <span>세로 0~{ceil}% · 마감한 달만</span>
              <span className="inline-flex items-center gap-1.5">
                <i aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: CONTEXT_COLOR }} />나머지 강사
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i aria-hidden className="bg-card inline-block size-2.5 rounded-full border-2" style={{ borderColor: LINE_COLORS[0] }} />담당 {SMALL_BASE}명 미만(＊)
              </span>
              <span>입사 전·퇴사 뒤·값 없는 달은 선을 끊습니다</span>
            </>
          ) : null
        ) : (
          <span className="inline-flex items-center gap-1.5">
            0%
            <i aria-hidden className="border-line inline-block h-2.5 w-20 rounded-full border"
              style={{ background: "linear-gradient(to right, var(--card), color-mix(in srgb, var(--gold-bright) 80%, var(--card)))" }} />
            {HEAT_CAP}% 이상 (마감한 값만 색칠)
          </span>
        )}
        {view === "table" ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="border-line inline-block size-3 rounded-sm border" style={{ background: BEFORE_HIRE_BG }} />입사 전
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="border-line inline-block size-3 rounded-sm border" style={{ background: AFTER_RESIGN_BG }} />퇴사 뒤
            </span>
            <span>＊ 담당 {SMALL_BASE}명 미만 — 한 명이 그만둬도 10%p 넘게 오릅니다</span>
            <span>칸 = 퇴원율 · 그만둔 학생/지난달 담당</span>
          </>
        ) : null}
      </div>

      {/* 이름을 눌러 고른 강사의 선 비교는 표 보기에만 — 차트 보기는 한 차트에서 고른 강사를 강조한다. */}
      {view === "table" && pickedRows.length ? (
        <div className="mt-4">
          <SeriesChart points={points} unit="%" series={pickedRows.map((t, i) => ({ label: dupName(pickedRows, i), color: LINE_COLORS[i]! }))} />
        </div>
      ) : null}
    </section>
  );
}

/** 정렬·보기 단추 묶음 — 같은 모양 한 벌(누른 것만 진하게). */
function Segments<K extends string>({ label, items, value, onChoose }: {
  label: string; items: readonly { key: K; label: string }[]; value: K; onChoose: (key: K) => void;
}) {
  return (
    <div role="group" aria-label={label} className="border-border inline-flex shrink-0 overflow-hidden rounded-md border">
      {items.map((s, i) => (
        <button key={s.key} type="button" aria-pressed={value === s.key} onClick={() => onChoose(s.key)}
          className={`${SEG} ${i > 0 ? "border-border border-l" : ""} ${value === s.key ? ON : OFF}`}>
          {s.label}
        </button>
      ))}
    </div>
  );
}
