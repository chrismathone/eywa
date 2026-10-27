import { isMetric, METRIC_LABELS, type Metric } from "./config";

export type PendingDetail = { metric: Metric; reason: string; months: string[]; count: number | null; lessons?: string[] };
const reasons: Partial<Record<Metric, string>> = {
  subjectMonths: "수업료 청구에 과목명이 없거나, 수업명을 한 과목으로 확정할 수 없습니다. 확인된 수업료 금액은 반영했으며, 미확인 과목은 과목별 수강 실적에서 제외했습니다.",
  parentPositiveMonths: "학부모 글의 긍정 신호 판정이 남아 있습니다. 새 글·수정된 글·재판정 요청을 확인한 뒤 반영합니다.",
  teacherPositiveMonths: "선생님 답글의 긍정 신호 판정이 남아 있습니다. 새 글·수정된 글·재판정 요청을 확인한 뒤 반영합니다.",
  perfectWeeks: "개근 판정에 필요한 출결 자료를 확인하지 못했습니다.",
  videoAssignments: "영상 숙제 완료 판정에 필요한 배정·제출 자료를 확인하지 못했습니다.",
  examMonths: "월말평가 응시 자료를 확인하지 못했습니다.",
  parentSeminarEvents: "이 학원의 설명회 명단에 아직 확인되지 않은 자료가 있습니다. 확인된 신청·형제 참여만 반영했으며, 해당 학생의 참석 누락이 확정됐다는 뜻은 아닙니다.",
};
export function pendingDetails(metrics: readonly Metric[], saved: readonly PendingDetail[] = []): PendingDetail[] {
  return [...new Set(metrics)].filter(isMetric).map(metric => saved.find(d => d.metric === metric) ?? {
    metric, reason: reasons[metric] ?? `${METRIC_LABELS[metric]} 계산에 필요한 일부 원자료를 확인하지 못했습니다.`, months: [], count: null,
  });
}
