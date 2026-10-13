"use client";

import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { referenceLabel } from "@/features/teacher-portfolio/model/pre-record";
import { METRIC_IDS, METRIC_MAX, metricOf, type MetricId, type StoredPeriod } from "@/features/teacher-portfolio/model/types";
import { METRIC_LABEL, fmtScore, monthName, periodLabel } from "@/features/teacher-portfolio/view";
import { MetricEvidence } from "./evidence-impact";
import { ReportMatrix, type EvidenceProps } from "./evidence-records";
import { BarList, DataTable, StatTiles } from "./parts";

/** 상세 창 — 평가 기준 · 점수 근거 · 항목별 근거(보고서는 학생 × 날짜 상태표). */
export type DetailTarget = { kind: "criteria" } | { kind: "ledger" } | { kind: "metric"; id: MetricId };

const CRITERIA: [MetricId, string][] = [
  ["report", "마감 전 본인 작성 ÷ 담당 학생의 보고 대상. 학생 1명당 하루 한 번 인정하며 대리 작성은 별도입니다."],
  ["attendance", "마감 전 처리 ÷ 담당 학생의 출결 대상. 시간표의 수업 담당으로 판정합니다."],
  ["follow", "해당 월 후속 기한 도래 건 중 마감 전 완료 비율. 상담 기록 수 자체에는 점수를 주지 않습니다."],
  ["quality", "해당 월 완료된 타인 평가 평균 ÷ 4 × 10. 완료 평가가 없으면 0점입니다."],
  ["students", "매월 기본 10점 + 신규 1점 − 퇴원·수강종료 1점. 반이동은 유입 +0.5점, 유출 −0.5점. 0~20점입니다."],
  ["revenue", "담당 과목의 매출 대비 담당 비중. 15%는 5점, 30% 이상은 10점입니다."],
  ["expansion", "검증된 소개 실적이 없으면 0점. 소개 기록·납부·첫 수업·기여자 확인이 필요합니다."],
  ["coverage", "결석 후 한 달 기한이 해당 월에 끝나는 건 중 기한 내 완료 비율. 마감 대상이 없으면 10점입니다."],
];

function Criteria({ periods }: { periods: readonly StoredPeriod[] }) {
  const estimated = periods.flatMap((w) => w.items).find((m) => m.estimated?.reference.length)?.estimated;
  const reference = estimated ? referenceLabel(estimated.reference.map((r) => r.month)) : "";
  return (
    <div className="flex flex-col gap-4 text-xs leading-relaxed">
      <div className="bg-primary-softer rounded-lg p-4">
        <b className="text-sm">매월 1일 시작 → 말일 마감</b>
        <p className="mt-1.5">모든 점수는 월별로 새로 계산합니다. 전월 점수는 비교에만 쓰며, 마감 이후 작성·발송·입력한 내용은 지난달 점수를 바꾸지 않습니다.</p>
      </div>
      <DataTable headers={["평가 항목", "배점", "계산 기준"]} kinds={["text", "num", "text"]}
        rows={CRITERIA.map(([id, rule]) => ({ key: id, cells: [<span key="l" className="whitespace-nowrap">{METRIC_LABEL[id]}</span>, `${METRIC_MAX[id]}점`, rule] }))} />
      <section>
        <h4 className="mb-1 text-sm font-bold">학생·매출의 인정 범위</h4>
        <p>담임·부담임을 모두 확인하고 강사별 같은 학생은 한 번만 셉니다. 같은 강사가 계속 맡는 반이동·역할 변경은 가감하지 않습니다. 추가 수강·재등록은 별도 표시합니다. 학생 수는 전월 말과 해당 월 마감일을 비교합니다.</p>
        <p className="mt-2">매출은 할인·환불을 반영한 월 수강료를 수강 기간과 시간표 시수로 배분합니다. 담당을 연결하지 못한 금액도 과목이 확인되면 그 과목 합계에 넣고, 과목을 알 수 없는 금액은 따로 둡니다.</p>
      </section>
      <section>
        <h4 className="mb-1 text-sm font-bold">보강 기한</h4>
        <p>결석 다음 달 같은 날까지 완료한 보강을 인정하며, 같은 날짜가 없으면 말일까지입니다. 기한이 끝나는 달에 한 번만 반영하고 기한 전 대기는 감점하지 않습니다. 예정·취소·중복·기한 초과는 제외합니다.</p>
      </section>
      {estimated ? (
        <section>
          <h4 className="mb-1 text-sm font-bold">기록을 시작하기 전인 달</h4>
          <p>수업보고서와 출결은 {monthName(estimated.since.slice(0, 7))} {Number(estimated.since.slice(8))}일부터 기록했습니다. 그 전 달의 두 항목은 같은 강사의 {reference}{reference.endsWith("평균") ? "으로" : "로"} 둡니다. 그 달에 대상이 없었으면 다른 달과 같이 계산하고, 기준 달에 점수가 없으면 산출불가입니다.</p>
        </section>
      ) : null}
      <section>
        <h4 className="mb-1 text-sm font-bold">마감 자료</h4>
        <p>‘마감 · 재구성’은 달이 끝난 뒤 남아 있는 기록으로 다시 만든 점수입니다. 작성·입력 시각이 마감 이후인 기록은 제외했고, 당시 상태를 확인할 수 없으면 산출불가로 둡니다. 마감한 달은 이후 보충해도 바뀌지 않습니다.</p>
      </section>
    </div>
  );
}

function Ledger({ period, teacherName }: { period: StoredPeriod; teacherName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs">{teacherName} 선생님 · {periodLabel(period)}</p>
      <StatTiles items={[
        { label: "총점", value: period.total === null ? "산출불가" : `${fmtScore(period.total)} / 100점` },
        { label: "산출 항목", value: `${period.knownCount} / 8` },
      ]} />
      <BarList rows={METRIC_IDS.map((id) => { const m = metricOf(period, id); return { label: `${METRIC_LABEL[id]} (${m.max}점)`, value: m.value, meta: m.basis }; })}
        max={20} color="var(--color-primary)" format={(n) => `${n.toFixed(1)}점`} />
    </div>
  );
}

export function DetailDialog({ target, onClose, periods, teacherName, evidence }: {
  target: DetailTarget | null; onClose: () => void; periods: readonly StoredPeriod[]; teacherName: string; evidence: EvidenceProps;
}) {
  const period = evidence.period;
  let title = "";
  let body: ReactNode = null;
  if (target?.kind === "criteria") {
    title = "평가 기준";
    body = <Criteria periods={periods} />;
  } else if (target?.kind === "ledger") {
    title = "점수 근거";
    body = <Ledger period={period} teacherName={teacherName} />;
  } else if (target) {
    const m = metricOf(period, target.id);
    title = METRIC_LABEL[target.id];
    body = (
      <>
        <p className="mb-4 text-xs"><b className="num text-sm">{fmtScore(m.value)} / {m.max}점</b> · {m.basis}</p>
        {target.id === "report" && !m.estimated
          ? <div className="overflow-auto"><ReportMatrix period={period} nameOf={evidence.nameOf} /></div>
          : <MetricEvidence id={target.id} {...evidence} sticky={false} onOpenStudents={undefined} />}
        {m.estimated ? null : <p className="mt-4 text-xs leading-relaxed">{m.reason}</p>}
      </>
    );
  }
  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[min(90dvh,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <div className="border-line flex items-center justify-between gap-3 border-b px-5 py-3.5">
          <DialogTitle className="text-base font-bold">{title}</DialogTitle>
          <DialogClose aria-label="닫기" className="hover:bg-muted focus-visible:outline-primary rounded-lg p-1.5 focus-visible:outline-2">
            <EyIcon name="close" size={18} />
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{body}</div>
      </DialogContent>
    </Dialog>
  );
}
