"use client";

import { isManualId } from "@/features/teacher-portfolio/evaluation/config";
import { settingOf } from "@/features/teacher-portfolio/evaluation/preview";
import { metricOf, type ItemId, type ManualMetricItem, type MetricId } from "@/features/teacher-portfolio/model/types";
import { METRIC_COLOR, SHORTFALL_COLOR, dayLabel, itemOf, pointsText, ruleText, won } from "@/features/teacher-portfolio/view";
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

/** 학생 변동값 — 설정으로 매긴 달은 원래 수치(+1·−0.5)라 '점'을 붙이지 않는다. 옛 달은 그때 그대로 점수. */
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;

function StudentsEvidence({ period, nameOf }: EvidenceProps) {
  const m = metricOf(period, "students");
  const t = m.tracking;
  const change = (n: number) => (period.evaluation ? <span className="num text-xs font-bold">{signed(n)}</span> : <Delta now={n} before={0} />);
  const flows: [string, number, number][] = [
    ["신규", t.newCount, 1], ["퇴원·수강종료", t.exitCount + t.endedCount, -1], ["반이동 유입", t.transferIn, 0.5], ["반이동 유출", t.transferOut, -0.5],
  ];
  return (
    <>
      <StatTiles items={[
        { label: "전월 말", value: `${t.previous}명` }, { label: "이번 달", value: `${t.current}명` },
        { label: "이번 달 변동", value: signed(t.adjustment) },
        { label: "월간 점수", value: pointsText(m, period) },
      ]} />
      {/* 매월 새로 센다 — 전월 변동은 이 식에 들어가지 않는다. 몇 점인지는 그 달을 매긴 설정의 규칙. */}
      <p className="bg-primary-softer mt-4 rounded-lg px-3.5 py-3 text-xs leading-relaxed">
        {ruleText(period, "students") ?? "기본 10점에서 이번 달 변동을 더하고 빼 0~20점 범위로 반영합니다."}
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {flows.map(([label, count, points]) => (
          <li key={label} className="border-line-faint rounded-md border px-1.5 py-2.5 text-center">
            <span className="block text-xs">{label}</span>
            <b className="num my-1.5 block text-base">{count}명</b>
            {change(count * points)}
          </li>
        ))}
      </ul>
      <SectionTitle>학생 변동</SectionTitle>
      <DataTable headers={["학생 · 반", "날짜", "변동", period.evaluation ? "변동값" : "점수"]} empty="이번 달 담당 학생 변동이 없습니다."
        rows={m.detail.map((r, i) => ({
          key: `${r.studentId}|${r.day}|${r.type}|${i}`,
          cells: [<StudentCell key="s" name={nameOf(r.studentId)} sub={`${r.className} · ${r.role}`} />, dayLabel(r.day), r.type, <span key="d">{change(r.points)}</span>],
        }))} />
      <p className="mt-3 text-xs">같은 강사가 계속 맡는 이동은 가감하지 않습니다. 추가 수강·재등록·담당 변경은 별도로 표시합니다.</p>
    </>
  );
}

function RevenueEvidence({ period }: EvidenceProps) {
  const m = metricOf(period, "revenue");
  const share = m.subjectTotal ? m.amount / m.subjectTotal : 0;
  // 만점 눈금 — 비례 규칙이면 만점 문턱, 구간표·건당이면 한 점으로 못 찍어 그리지 않는다. 옛 달은 그때 규칙(30%).
  const s = period.evaluation ? settingOf(period.evaluation, "revenue") : undefined;
  const mark = !period.evaluation ? 30 : s?.scoring.mode === "linear" && s.scoring.full > s.scoring.zero ? s.scoring.full : null;
  return (
    <>
      <StatTiles items={[
        { label: "담당 매출", value: won(m.amount) }, { label: "과목 전체 매출", value: won(m.subjectTotal) },
        { label: "매출 점수", value: pointsText(m, period) },
      ]} />
      <div className="my-5">
        <div className="mb-1.5 flex items-center justify-between gap-4 text-xs">
          <span>과목 매출 중 담당 비중</span>
          <b className="text-right">{ruleText(period, "revenue") ?? "30%부터 10점"}</b>
        </div>
        <div className="bg-bg-soft relative h-2 rounded-full">
          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, background: METRIC_COLOR.revenue }} />
          {mark !== null && mark > 0 && mark <= 100 ? <i aria-hidden className="bg-foreground absolute -top-1 -bottom-1 w-[3px]" style={{ left: `${mark}%` }} /> : null}
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
      <DataTable headers={["학생 · 반", "결석일", "기한", "완료일", "반영"]}
        empty={period.evaluation ? `이번 달 마감할 보강이 없습니다 — ${pointsText(m, period)}.` : "이번 달 마감할 보강이 없어 10점입니다."}
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
      <StatTiles items={[{ label: "완료된 평가", value: `${m.detail.length}건` }, { label: "평가 점수", value: pointsText(m, period) }]} />
      {m.detail.length ? (
        <div className="mt-5">
          <BarList rows={m.detail.map((r, i) => ({ label: `${r.name}${m.detail.length > 1 ? ` ${i + 1}` : ""}`, value: r.average, meta: r.date ? `${r.date} 제출` : undefined }))}
            max={4} color={METRIC_COLOR.quality} format={(n) => `${n.toFixed(1)} / 4점`} />
        </div>
      ) : <EmptyNote count="0건" text="해당 월에 완료된 직원 평가가 없습니다." />}
    </>
  );
}

function ExpansionEvidence({ period }: Pick<EvidenceProps, "period">) {
  return (
    <>
      <StatTiles items={[{ label: "인정된 소개", value: "0건" }, { label: "과목 소개 점수", value: pointsText(metricOf(period, "expansion"), period) }]} />
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

/** 원장이 직접 만든 지표 — 그 달에 넣은 숫자와 메모가 근거의 전부다. */
function ManualEvidence({ metric, period }: { metric: ManualMetricItem } & Pick<EvidenceProps, "period">) {
  return (
    <>
      <StatTiles items={[
        { label: "이 달 입력", value: metric.raw === null || metric.raw === undefined ? "입력 없음" : `${metric.raw}${metric.unit}` },
        { label: "점수", value: pointsText(metric, period) },
      ]} />
      {metric.note ? <p className="bg-primary-softer mt-4 rounded-lg px-3.5 py-3 text-xs leading-relaxed">{metric.note}</p> : null}
      <p className="mt-4 text-xs leading-relaxed">{metric.reason}</p>
      {ruleText(period, metric.id) ? <p className="mt-2 text-xs leading-relaxed">점수 규칙: {ruleText(period, metric.id)}</p> : null}
      <p className="mt-2 text-xs leading-relaxed">원장이 달마다 넣는 지표입니다. 값은 직원 포트폴리오의 ‘직접 입력 지표’에서 넣습니다.</p>
    </>
  );
}

/** 항목 하나의 내역. 기록 시작 전이라 평균으로 둔 달은 기록 표를 그리지 않는다. */
export function MetricEvidence({ id, ...props }: EvidenceProps & { id: ItemId }) {
  const item = itemOf(props.period, id);
  if (!item) return null;
  if (isManualId(item.id)) return <ManualEvidence metric={item as ManualMetricItem} period={props.period} />;
  const metric = metricOf(props.period, id as MetricId);
  if (metric.estimated) return <EstimatedEvidence metric={metric} />;
  switch (id) {
    case "report": return <ReportEvidence {...props} />;
    case "attendance": return <AttendanceEvidence {...props} />;
    case "follow": return <FollowEvidence {...props} />;
    case "quality": return <QualityEvidence {...props} />;
    case "students": return <StudentsEvidence {...props} />;
    case "revenue": return <RevenueEvidence {...props} />;
    case "coverage": return <CoverageEvidence {...props} />;
    default: return <ExpansionEvidence period={props.period} />;
  }
}
