"use client";

import { metricOf, type Metric, type StoredPeriod } from "@/features/teacher-portfolio/model/types";
import {
  METRIC_COLOR, PROXY_COLOR, REPORT_STATE_LABEL, SHORTFALL_COLOR, dayLabel, fmtScore, followAnchor, groupByWeek, itemColor, pickWeek, weekRange,
  type WeekGroup,
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
  /** 표 제목행을 스크롤 영역 위에 붙인다(내역 카드 안에서만). */
  sticky?: boolean;
};

const HOLIDAY = <span className="text-xs">휴원일</span>;

/** 기록을 시작하기 전인 달 — 기록 표 대신 대상 건수와 기준 달 점수만 보인다. */
export function EstimatedEvidence({ metric }: { metric: Metric }) {
  const e = metric.estimated;
  if (!e) return null;
  const rate = e.unit === "%"; // 새 행은 기준 달의 원래 수치(%), 2026-10-13 전 행은 점수.
  return (
    <>
      <StatTiles items={[
        { label: "대상", value: `${e.targets}건` },
        { label: "적용 점수", value: metric.value === null ? (rate ? "합계에서 뺌" : "산출불가") : `${fmtScore(metric.value)} / ${metric.max}점` },
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

export function ReportEvidence({ period, onOpenStudents, sticky }: EvidenceProps) {
  const m = metricOf(period, "report");
  const count = (...states: string[]) => m.detail.filter((c) => states.includes(c.state)).length;
  return (
    <>
      <StatTiles items={[
        { label: "대상", value: `${m.detail.length}건` },
        { label: "본인 작성", value: `${count("own")}건`, className: "text-primary" },
        { label: "대리 작성", value: `${count("proxy")}건`, className: "text-purple" },
        { label: "미작성", value: `${count("missing", "late")}건`, className: "text-amber" },
      ]} />
      <div className="mt-5 mb-2.5 flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold">일자별 수업보고서</h4>
        {onOpenStudents ? (
          <button type="button" onClick={onOpenStudents} className="text-primary text-xs font-medium whitespace-nowrap hover:underline">학생별 보기</button>
        ) : null}
      </div>
      <DataTable fixed sticky={sticky} headers={["날짜", "작성 현황", "대상", "본인", "대리", "미작성"]} kinds={["text", "bar"]}
        rows={period.dayStats.map((s) => ({
          key: s.day,
          cells: s.holiday
            ? [dayLabel(s.day), HOLIDAY, "—", "—", "—", "—"]
            : [dayLabel(s.day), <StackBar key="bar" total={s.target} parts={[
              { color: METRIC_COLOR.report, count: s.own }, { color: PROXY_COLOR, count: s.proxy }, { color: SHORTFALL_COLOR, count: s.missing },
            ]} />, s.target, s.own, s.proxy, s.missing],
        }))} />
      <p className="mt-3 text-xs">학생 1명당 하루 한 번 인정 · 마감 후 작성 {count("late")}건 제외</p>
    </>
  );
}

/** 학생 × 날짜 상태표 — 상세 창에서만 연다(넓다). */
export function ReportMatrix({ period, nameOf }: Pick<EvidenceProps, "period" | "nameOf">) {
  const m = metricOf(period, "report");
  const days = period.dayStats.map((s) => s.day);
  const cells = new Map(m.detail.map((c) => [`${c.studentId}|${c.day}`, c]));
  const students = [...new Set(m.detail.map((c) => c.studentId))].sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ko"));
  return (
    <DataTable headers={["학생", ...days.map(dayLabel)]} empty="이 달 보고 대상이 없습니다."
      rows={students.map((id) => ({
        key: id,
        cells: [<span key="name" className="whitespace-nowrap">{nameOf(id)}</span>, ...days.map((day) => {
          const cell = cells.get(`${id}|${day}`);
          return cell ? <StatusChip key={day} state={REPORT_STATE_LABEL[cell.state]} /> : "—";
        })],
      }))} />
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

export function AttendanceEvidence({ period, nameOf, week, onWeek, sticky }: EvidenceProps) {
  const rows = metricOf(period, "attendance").detail;
  const done = (a: typeof rows) => a.filter((r) => r.done).length;
  const weeks = groupByWeek(period, rows, (r) => r.day);
  const picked = pickWeek(weeks, week.attendance);
  const current = weeks[picked];
  const bar = (a: typeof rows) => (
    <StackBar key="bar" total={a.length} parts={[{ color: METRIC_COLOR.attendance, count: done(a) }, { color: SHORTFALL_COLOR, count: a.length - done(a) }]} />
  );
  const counts = (a: typeof rows) => [a.length, done(a), a.length - done(a)];
  const days = current
    ? [...new Set([...current.rows.map((r) => r.day), ...period.holidays.filter((day) => day >= current.start && day <= current.end)])].sort()
    : [];
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
              return { key: day, cells: period.holidays.includes(day) ? [dayLabel(day), HOLIDAY, "—", "—", "—"] : [dayLabel(day), bar(a), ...counts(a)] };
            })} />
          {current.rows.length ? (
            <>
              <SectionTitle>학생별 기록</SectionTitle>
              <DataTable headers={["날짜", "학생 · 반", "처리"]} kinds={["text", "text", "num"]}
                rows={current.rows.map((r) => ({
                  key: `${r.day}|${r.studentId}|${r.className}`,
                  cells: [dayLabel(r.day), <StudentCell key="s" name={nameOf(r.studentId)} sub={r.className} />, <StatusChip key="c" state={r.done ? "완료" : r.ambiguous ? "담당 확인" : "미완료"} />],
                }))} />
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function FollowEvidence({ period, nameOf, week, onWeek, sticky }: EvidenceProps) {
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
              cells: [nameOf(r.studentId), r.day ? dayLabel(r.day) : "—", r.due ? dayLabel(r.due) : "—", <StatusChip key="c" state={r.state} />],
            }))} />
        </>
      ) : null}
    </>
  );
}

export function StudentCell({ name, sub }: { name: string; sub: string }) {
  return (
    <span className="block min-w-0">
      {name}
      <small className="mt-0.5 block text-xs break-keep">{sub}</small>
    </span>
  );
}
