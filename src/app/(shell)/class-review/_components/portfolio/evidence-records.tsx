"use client";

import { dayWeekLabel } from "@/features/teacher-portfolio/evidence-view";
import { metricOf, type Metric, type StoredPeriod } from "@/features/teacher-portfolio/model/types";
import {
  METRIC_COLOR, SHORTFALL_COLOR, fmtScore, followAnchor, groupByWeek, itemColor, pickWeek, weekRange, type WeekGroup,
} from "@/features/teacher-portfolio/view";
import { BarList, DataTable, SectionTitle, StackBar, StatTiles, StatusChip, type TableRow } from "./parts";

/** 수업·학생 관리 쪽 내역 — 보고서(일자별) · 출결·상담(주간, 주를 누르면 그 아래 상세). */
export type EvidenceProps = {
  period: StoredPeriod;
  nameOf: (studentId: string) => string;
  /** 주간 표에서 펼친 주. 비어 있으면 기록이 있는 가장 최근 주. */
  week: Partial<Record<"attendance" | "follow", number>>;
  onWeek: (metric: "attendance" | "follow", index: number) => void;
  onOpenStudents?: () => void;
  /** 학생의 학교·학년(지금 값 · 없으면 빈 글자) · 만족도 관리 창 열기(쓰기 권한 + 그 달 만족도 켜짐일 때만 — 근거 표에서 이어 간다). */
  schoolOf?: (studentId: string) => string; onSatisfaction?: () => void;
  /** 표 제목행을 스크롤 영역 위에 붙인다(내역 카드 안에서만). */
  sticky?: boolean;
};

/** 기록을 시작하기 전인 달 — 기록 표 대신 대상 건수와 기준 달 점수만 보인다. */
export function EstimatedEvidence({ metric }: { metric: Metric }) {
  const e = metric.estimated;
  if (!e) return null;
  const rate = e.unit === "%"; // 새 행은 기준 달의 원래 수치(%), 2026-10-13 전 행은 점수.
  return (
    <>
      <StatTiles items={[
        { label: "대상", value: `${e.targets}건` },
        { label: "적용 점수", value: metric.value === null ? (rate ? "합계에서 제외" : "산출불가") : `${fmtScore(metric.value)} / ${metric.max}점` },
      ]} />
      {e.reference.length ? (
        <>
          <SectionTitle>{rate ? "기준 달 기록률" : "기준 달 점수"}</SectionTitle>
          <BarList rows={e.reference.map((r) => ({ label: `${Number(r.month.slice(5))}월`, value: r.value }))} max={rate ? 100 : metric.max}
            color={itemColor(metric)} format={(n) => (rate ? `${n.toFixed(1)}%` : `${n.toFixed(1)}점`)} />
        </>
      ) : null}
      <p className="mt-4 text-xs leading-relaxed">{metric.reason}</p>
    </>
  );
}

/** 보고서 = 작성/미작성 둘만(원장 2026-10-14 *"대리 이런건 됐고, 오로지 작성/미작성만"*) — 본인이 당일에 쓴 것이 작성, 나머지는 미작성. */
export function ReportEvidence({ period, onOpenStudents, sticky }: EvidenceProps) {
  const m = metricOf(period, "report");
  const written = m.detail.filter((c) => c.state === "own").length;
  return (
    <>
      <StatTiles items={[
        { label: "대상", value: `${m.detail.length}건` },
        { label: "작성", value: `${written}건`, className: "text-primary" },
        { label: "미작성", value: `${m.detail.length - written}건`, className: "text-amber" },
      ]} />
      <div className="mt-5 mb-2.5 flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold">일자별 수업보고서</h4>
        {onOpenStudents ? (
          <button type="button" onClick={onOpenStudents} className="text-primary text-xs font-medium whitespace-nowrap hover:underline">학생별 보기</button>
        ) : null}
      </div>
      {/* 수업이 없는 날(대상 0 · 휴원일)은 줄을 세우지 않는다(원장 2026-10-16 *"일자별 수업보고서에 수업이 없는 날은 제외"*). */}
      <DataTable fixed sticky={sticky} headers={["날짜", "작성 현황", "대상", "작성", "미작성"]} kinds={["text", "bar"]} empty="이 달 보고 대상이 없습니다."
        rows={period.dayStats.filter((s) => s.target > 0 && !s.holiday).map((s) => ({
          key: s.day,
          cells: [dayWeekLabel(s.day), <StackBar key="bar" total={s.target} parts={[
            { color: METRIC_COLOR.report, count: s.own }, { color: SHORTFALL_COLOR, count: s.target - s.own },
          ]} />, s.target, s.own, s.target - s.own],
        }))} />
      <p className="mt-3 text-xs">학생 1명당 하루 한 번 · 본인이 수업 당일에 쓴 보고서만 작성(다른 사람이 쓴 것·다음 날 이후에 쓴 것은 미작성)</p>
    </>
  );
}

function weekRows<T>(weeks: WeekGroup<T>[], picked: number, onPick: (index: number) => void, cells: (rows: T[]) => TableRow["cells"]): TableRow[] {
  return weeks.map((week) => ({
    key: week.start, selected: week.index === picked, onSelect: () => onPick(week.index),
    cells: [
      <span key="week">
        <button type="button" aria-pressed={week.index === picked} className="text-primary font-bold underline underline-offset-4">{week.index + 1}주</button>
        <small className="num mt-1 block text-xs">{weekRange(week)}</small>
      </span>,
      ...cells(week.rows),
    ],
  }));
}

export function AttendanceEvidence({ period, nameOf, schoolOf, week, onWeek, sticky }: EvidenceProps) {
  const rows = metricOf(period, "attendance").detail;
  const done = (a: typeof rows) => a.filter((r) => r.done).length;
  const weeks = groupByWeek(period, rows, (r) => r.day);
  const picked = pickWeek(weeks, week.attendance);
  const current = weeks[picked];
  const bar = (a: typeof rows) => (
    <StackBar key="bar" total={a.length} parts={[{ color: METRIC_COLOR.attendance, count: done(a) }, { color: SHORTFALL_COLOR, count: a.length - done(a) }]} />
  );
  const counts = (a: typeof rows) => [a.length, done(a), a.length - done(a)];
  // 출결 대상이 있던 날만(수업이 없는 날 · 휴원일은 줄을 세우지 않는다 — 원장 2026-10-16, 보고서 일자별 표와 같은 규칙).
  const days = current ? [...new Set(current.rows.map((r) => r.day))].sort() : [];
  return (
    <>
      <StatTiles items={[
        { label: "처리 대상", value: `${rows.length}건` },
        { label: "처리 완료", value: `${done(rows)}건`, className: "text-primary" },
        { label: "미처리", value: `${rows.length - done(rows)}건`, className: "text-amber" },
      ]} />
      <SectionTitle>주간 출결</SectionTitle>
      <DataTable fixed sticky={sticky} headers={["주", "처리 현황", "대상", "처리", "미처리"]} kinds={["text", "bar"]}
        rows={weekRows(weeks, picked, (i) => onWeek("attendance", i), (a) => [bar(a), ...counts(a)])} />
      {current ? (
        <>
          <SectionTitle sub={weekRange(current)}>{picked + 1}주 일별 출결</SectionTitle>
          <DataTable fixed headers={["날짜", "처리 현황", "대상", "처리", "미처리"]} kinds={["text", "bar"]} empty="이 주에는 출결 대상이 없습니다."
            rows={days.map((day) => {
              const a = current.rows.filter((r) => r.day === day);
              return { key: day, cells: [dayWeekLabel(day), bar(a), ...counts(a)] };
            })} />
          {current.rows.length ? (
            <>
              <SectionTitle>학생별 기록</SectionTitle>
              <DataTable headers={["날짜", "학생 · 반", "처리"]} kinds={["text", "text", "num"]}
                rows={current.rows.map((r) => ({
                  key: `${r.day}|${r.studentId}|${r.className}`,
                  cells: [dayWeekLabel(r.day), <StudentCell key="s" name={nameOf(r.studentId)} school={schoolOf?.(r.studentId)} sub={r.className} />, <StatusChip key="c" state={r.done ? "완료" : r.ambiguous ? "담당 확인" : "미완료"} />],
                }))} />
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function FollowEvidence({ period, nameOf, schoolOf, week, onWeek, sticky }: EvidenceProps) {
  const rows = metricOf(period, "follow").detail;
  const due = (a: typeof rows) => a.filter((r) => r.scored);
  const finished = (a: typeof rows) => due(a).filter((r) => r.state === "완료").length;
  // '상담'은 이 달에 한 상담만 센다(점수 카드의 "상담 N건"과 같은 수). 앞 달 상담의 후속 기한은 '후속 대상'에만 선다.
  const held = (a: typeof rows) => a.filter((r) => r.day !== null && r.day >= period.start && r.day <= period.end).length;
  const weeks = groupByWeek(period, rows, (r) => followAnchor(period, r));
  const picked = pickWeek(weeks, week.follow);
  const current = weeks[picked];
  return (
    <>
      <StatTiles items={[
        { label: "이 달 상담", value: `${held(rows)}건` },
        { label: "후속 대상", value: `${due(rows).length}건` },
        { label: "완료", value: `${finished(rows)}건`, className: "text-primary" },
      ]} />
      <SectionTitle>주간 상담</SectionTitle>
      <DataTable fixed sticky={sticky} headers={["주", "후속 처리", "상담", "후속 대상", "완료"]} kinds={["text", "bar"]}
        rows={weekRows(weeks, picked, (i) => onWeek("follow", i), (a) => [
          <StackBar key="bar" total={due(a).length} parts={[{ color: METRIC_COLOR.follow, count: finished(a) }, { color: SHORTFALL_COLOR, count: due(a).length - finished(a) }]} />,
          held(a), due(a).length, finished(a),
        ])} />
      {current ? (
        <>
          <SectionTitle sub={weekRange(current)}>{picked + 1}주 상담 내역</SectionTitle>
          <DataTable headers={["학생", "상담일", "후속 기한", "처리"]} empty="이 주에는 상담 기록이 없습니다."
            rows={[...current.rows].sort((a, b) => (followAnchor(period, a) ?? "").localeCompare(followAnchor(period, b) ?? "")).map((r, i) => ({
              key: `${r.studentId}|${r.day}|${r.due}|${i}`,
              cells: [<StudentCell key="s" name={nameOf(r.studentId)} school={schoolOf?.(r.studentId)} />, r.day ? dayWeekLabel(r.day) : "—", r.due ? dayWeekLabel(r.due) : "—",
                <StatusChip key="c" state={r.state} />],
            }))} />
        </>
      ) : null}
    </>
  );
}

/** 학생 칸 — 이름 옆 학교학년(원장 2026-10-16 *"항목별 내역에서 학교 학년 추가 가능한곳은 전부"* · 모르면 비운다) · 아래 줄 = 반 등. */
export function StudentCell({ name, school, sub }: { name: string; school?: string; sub?: string }) {
  return (
    <span className="block min-w-0">
      {name}{school ? <small className="ml-1.5 text-xs">{school}</small> : null}
      {sub ? <small className="mt-0.5 block text-xs break-keep">{sub}</small> : null}
    </span>
  );
}
