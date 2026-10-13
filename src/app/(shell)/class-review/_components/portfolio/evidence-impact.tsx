"use client";

import { metricOf, type MetricId } from "@/features/teacher-portfolio/model/types";
import { METRIC_COLOR, SHORTFALL_COLOR, dayLabel, fmtScore, won } from "@/features/teacher-portfolio/view";
import {
  AttendanceEvidence, EstimatedEvidence, FollowEvidence, ReportEvidence, StudentCell, type EvidenceProps,
} from "./evidence-records";
import { BarList, DataTable, Delta, SectionTitle, StackBar, StatTiles, StatusChip } from "./parts";

/** 학원 운영 영향 쪽 내역 — 배정·유지 · 매출 · 과목 소개 · 보강, 그리고 직원 평가. */

function EmptyNote({ count, text }: { count: string; text: string }) {
  return (
    <div className="border-line mt-4 flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center">
      <b className="num text-2xl">{count}</b>
      <span className="text-xs">{text}</span>
    </div>
  );
}

function StudentsEvidence({ period, nameOf }: EvidenceProps) {
  const m = metricOf(period, "students");
  const t = m.tracking;
  const flows: [string, number, number][] = [
    ["신규", t.newCount, 1], ["퇴원·수강종료", t.exitCount + t.endedCount, -1], ["반이동 유입", t.transferIn, 0.5], ["반이동 유출", t.transferOut, -0.5],
  ];
  return (
    <>
      <StatTiles items={[
        { label: "전월 말", value: `${t.previous}명` }, { label: "이번 달", value: `${t.current}명` },
        { label: "기본 점수", value: "10.0점" }, { label: "월간 점수", value: `${fmtScore(m.value)}점` },
      ]} />
      {/* 매월 10점에서 새로 시작한다 — 전월 점수는 이 식에 들어가지 않는다. */}
      <p className="bg-primary-softer mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3.5 py-3 text-xs">
        <span>기본 <b className="num text-base">10.0</b></span>
        <span aria-hidden>{t.adjustment >= 0 ? "+" : "−"}</span>
        <span>이번 달 변동 <b className="num text-base">{Math.abs(t.adjustment).toFixed(1)}</b></span>
        <span aria-hidden>→</span>
        <b className="num text-primary text-xl">{fmtScore(m.value)}점</b>
      </p>
      {10 + t.adjustment !== m.value ? <p className="mt-2 text-xs">0~20점 범위로 반영했습니다.</p> : null}
      <ul className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {flows.map(([label, count, points]) => (
          <li key={label} className="border-line-faint rounded-md border px-1.5 py-2.5 text-center">
            <span className="block text-xs">{label}</span>
            <b className="num my-1.5 block text-base">{count}명</b>
            <Delta now={count * points} before={0} />
          </li>
        ))}
      </ul>
      <SectionTitle>학생 변동</SectionTitle>
      <DataTable headers={["학생 · 반", "날짜", "변동", "점수"]} empty="이번 달 담당 학생 변동이 없습니다."
        rows={m.detail.map((r, i) => ({
          key: `${r.studentId}|${r.day}|${r.type}|${i}`,
          cells: [<StudentCell key="s" name={nameOf(r.studentId)} sub={`${r.className} · ${r.role}`} />, dayLabel(r.day), r.type, <Delta key="d" now={r.points} before={0} />],
        }))} />
      <p className="mt-3 text-xs">같은 강사가 계속 맡는 이동은 가감하지 않습니다. 추가 수강·재등록·담당 변경은 별도로 표시합니다.</p>
    </>
  );
}

function RevenueEvidence({ period }: EvidenceProps) {
  const m = metricOf(period, "revenue");
  const share = m.subjectTotal ? m.amount / m.subjectTotal : 0;
  return (
    <>
      <StatTiles items={[
        { label: "담당 매출", value: won(m.amount) }, { label: "과목 전체 매출", value: won(m.subjectTotal) },
        { label: "매출 점수", value: `${fmtScore(m.value)} / 10점` },
      ]} />
      <div className="my-5">
        <div className="mb-1.5 flex items-center justify-between gap-4 text-xs">
          <span>과목 매출 중 담당 비중</span>
          <b className="whitespace-nowrap">30%부터 10점</b>
        </div>
        <div className="bg-bg-soft relative h-2 rounded-full">
          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, background: METRIC_COLOR.revenue }} />
          <i aria-hidden className="bg-foreground absolute -top-1 -bottom-1 left-[30%] w-[3px]" />
        </div>
      </div>
      <DataTable headers={["과목", "담당 매출", "과목 전체"]} kinds={["text", "money", "money"]}
        rows={m.subjects.map((s) => ({ key: s.key, cells: [s.label, won(s.amount), won(s.total)] }))} />
      <SectionTitle>반별 담당 매출</SectionTitle>
      {m.detail.length ? (
        <BarList rows={m.detail.map((r) => ({ label: r.className, value: r.amount }))} max={Math.max(...m.detail.map((r) => r.amount))}
          color={METRIC_COLOR.revenue} format={won} />
      ) : <p className="text-xs">연결된 담당 매출이 없습니다.</p>}
      <p className="mt-4 text-xs leading-relaxed">
        담당 연결 미확인 {won(m.unassigned)}은 과목 합계에 포함하고, 과목 자체 미확인 {won(m.unclassified)}은 따로 둡니다.
      </p>
    </>
  );
}

function CoverageEvidence({ period, nameOf }: EvidenceProps) {
  const m = metricOf(period, "coverage");
  return (
    <>
      <StatTiles items={[
        { label: "이번 달 마감", value: `${m.due}건` }, { label: "기한 내 완료", value: `${m.done}건`, className: "text-primary" },
        { label: "미완료", value: `${m.due - m.done}건`, className: "text-amber" }, { label: "기한 내 대기", value: `${m.pending}건` },
      ]} />
      <div className="my-4">
        <StackBar total={m.due} parts={[{ color: METRIC_COLOR.coverage, count: m.done }, { color: SHORTFALL_COLOR, count: m.due - m.done }]} />
      </div>
      <DataTable headers={["학생 · 반", "결석일", "기한", "완료일", "반영"]} empty="이번 달 마감할 보강이 없어 10점입니다."
        rows={m.detail.map((r, i) => ({
          key: `${r.studentId}|${r.absence}|${i}`,
          cells: [<StudentCell key="s" name={nameOf(r.studentId)} sub={r.className} />, dayLabel(r.absence), dayLabel(r.deadline), r.makeup ? dayLabel(r.makeup) : "—", <StatusChip key="c" state={r.state} />],
        }))} />
    </>
  );
}

function QualityEvidence({ period }: EvidenceProps) {
  const m = metricOf(period, "quality");
  return (
    <>
      <StatTiles items={[{ label: "완료된 평가", value: `${m.detail.length}건` }, { label: "평가 점수", value: `${fmtScore(m.value)} / 10점` }]} />
      {m.detail.length ? (
        <div className="mt-5">
          <BarList rows={m.detail.map((r, i) => ({ label: `${r.name}${m.detail.length > 1 ? ` ${i + 1}` : ""}`, value: r.average, meta: r.date ? `${r.date} 제출` : undefined }))}
            max={4} color={METRIC_COLOR.quality} format={(n) => `${n.toFixed(1)} / 4점`} />
        </div>
      ) : <EmptyNote count="0건" text="해당 월에 완료된 직원 평가가 없습니다." />}
    </>
  );
}

function ExpansionEvidence() {
  return (
    <>
      <StatTiles items={[{ label: "인정된 소개", value: "0건" }, { label: "과목 소개 점수", value: "0.0 / 10점" }]} />
      <ul className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {["소개 기록", "납부 확인", "첫 수업", "기여자 확인"].map((step) => (
          <li key={step} className="bg-bg-soft/60 rounded-md px-1.5 py-3 text-center text-xs">
            {step}
            <b aria-hidden className="mt-2 block">—</b>
          </li>
        ))}
      </ul>
      <EmptyNote count="0건" text="확인된 과목 소개 내역이 없습니다." />
    </>
  );
}

/** 항목 하나의 내역. 기록 시작 전이라 평균으로 둔 달은 기록 표를 그리지 않는다. */
export function MetricEvidence({ id, ...props }: EvidenceProps & { id: MetricId }) {
  const metric = metricOf(props.period, id);
  if (metric.estimated) return <EstimatedEvidence metric={metric} />;
  switch (id) {
    case "report": return <ReportEvidence {...props} />;
    case "attendance": return <AttendanceEvidence {...props} />;
    case "follow": return <FollowEvidence {...props} />;
    case "quality": return <QualityEvidence {...props} />;
    case "students": return <StudentsEvidence {...props} />;
    case "revenue": return <RevenueEvidence {...props} />;
    case "coverage": return <CoverageEvidence {...props} />;
    default: return <ExpansionEvidence />;
  }
}
