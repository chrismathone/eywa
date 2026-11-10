import { buildSubjectMaps } from "@/features/owner/subjects";
import type { SubjectSetting } from "@/features/owner/settings-types";
import type { accountingTotals, InvoiceSummary, Metric } from "./model";
import type { reportedFinancialView } from "./reported-financials";

export type MetricInput = {
  month: string; asOf: string; current: InvoiceSummary;
  activeStudents: number; activeCourses: number;
  /** 기준일에 영어·수학을 함께 듣는 학생 수(과목 키 english · math). */
  dual: number; subjects: SubjectSetting[];
  /** 퇴원관리와 같은 판정으로 센 그 달 퇴원(장부 정리 제외 · 퇴원월 = 수강료를 낸 마지막 달). null = 퇴원 조회 실패(0이 아니다). */
  withdrawals: number | null; cohort: number; cohortWithdrawals: number | null;
  reportedFinancials: ReturnType<typeof reportedFinancialView>; accounting: ReturnType<typeof accountingTotals> | null;
};

/**
 * 경영 지표 목록 — 순수 계산(화면 카드 · AI 검토 입력이 같은 목록을 쓴다).
 * - 동시수강률: 학원설정에 영어·수학 과목이 둘 다 있을 때만(라벨도 설정에서) — 없으면 지표를 내지 않는다.
 * - 영업이익률·인건비율: 값이 있을 때만(마감 확인된 보고서 기준 손익 또는 대사가 끝난 그 달 손익). 없으면 카드를 내지 않는다.
 */
export function buildMetrics(v: MetricInput): Metric[] {
  const { month, asOf, current } = v, accountingHref = `/dashboard/management?month=${month}#accounting`;
  const metrics: Metric[] = [
    { id: "net_billed", label: "실청구액", value: current.net, unit: "원", definition: "청구월 기준 청구액−할인. 무효 청구 제외. 회계 매출·입금일 현금흐름과 구분", source: "MakeEdu → 에이와 청구 원장", href: `/billing?period=${month}` },
    { id: "collected", label: "해당 청구분 누적 수납", value: current.collected, unit: "원", definition: "선택 월 청구서의 현재까지 수납액. 이번 달 입금 합계가 아님", source: "MakeEdu → 에이와 청구 원장", href: "/billing/stats" },
    { id: "outstanding", label: "미수 잔액", value: current.outstanding, unit: "원", definition: "기존 수납관리의 완납·환불·무효 판정 적용", source: "에이와 수납관리", href: "/billing" },
    { id: "charged_students", label: "청구 학생 수", value: current.students, unit: "명", definition: "해당 월 양의 실청구가 있는 학생 중복 제거", source: "청구서·학생 ID", href: "/billing/stats" },
    { id: "per_student", label: "청구 학생당 실청구액", value: current.perStudent, unit: "원", definition: "실청구액÷청구 학생 수. 기준일 재원생당 매출과 구분", source: "실청구액·청구 학생 수", href: "/billing/stats" },
    { id: "active_students", label: "기준일 수강 학생", value: v.activeStudents, unit: "명", definition: `${asOf}에 유효한 수강이 있는 학생. 보강용 반·현재 휴강 표시·테스트·병합 학생 제외. 과거 휴강 상태 이력은 미확인`, source: "에이와 학생·수강·반", href: "/students" },
    { id: "active_courses", label: "기준일 수강 건수", value: v.activeCourses, unit: "건", definition: "학생별 수강 관계 건수. 개설 반 수와 구분", source: "에이와 수강", href: "/timetable" },
  ];
  const keys = new Set(v.subjects.map((s) => s.key));
  if (keys.has("english") && keys.has("math")) {
    const { labelOf } = buildSubjectMaps(v.subjects), pair = `${labelOf("english")}·${labelOf("math")}`;
    metrics.push({ id: "dual_ratio", label: `${pair} 동시수강률`, value: v.activeStudents ? v.dual / v.activeStudents * 100 : null, unit: "%", definition: `기준일 ${pair}을 함께 듣는 학생÷기준일 수강 학생`, source: "에이와 유효 수강 관계", href: "/students/stats" });
  }
  metrics.push(
    { id: "withdrawals", label: "퇴원 인원", value: v.withdrawals, unit: "명", definition: "퇴원관리와 같은 기준 — 수업 기록 없는 장부 정리 제외 · 퇴원월 = 수강료를 낸 마지막 달. 과목 종료·반 이동과 구분", source: "에이와 퇴원관리", href: "/withdrawals" },
    { id: "withdrawal_rate", label: "월초 수강 집단 퇴원율", value: v.cohort && v.cohortWithdrawals !== null ? v.cohortWithdrawals / v.cohort * 100 : null, unit: "%", definition: v.cohortWithdrawals === null ? `월초 수강 집단 ${v.cohort}명 기준. 퇴원 기록을 불러오지 못해 계산을 보류했습니다` : `월초 수강 집단 ${v.cohort}명 중 ${asOf}까지 이 달 퇴원으로 센 ${v.cohortWithdrawals}명. 월중 신규생 제외`, source: "에이와 수강·퇴원관리", href: "/withdrawals" },
  );
  const reported = v.reportedFinancials, margin = reported ? reported.margin : v.accounting?.margin ?? null, labor = reported ? reported.laborRatio : v.accounting?.laborRatio ?? null;
  if (margin !== null) metrics.push({ id: "operating_margin", label: reported ? "ECOUNT 기재 영업이익률" : "월 영업이익률", value: margin, unit: "%", definition: reported ? "보고서 기재 영업손익÷보고서 매출. 사용자 확인 마감 월만 계산. 차량 원금·이자 혼합 비용이 포함된 조정 전 수치이며 채용 판단용 확정 손익이 아님" : "같은 월의 대사 완료 회계 매출·영업비용 기준. 누적 손익을 월별로 나누지 않음", source: "ECOUNT 손익계산서", href: accountingHref });
  if (labor !== null) metrics.push({ id: "labor_ratio", label: reported ? "보고서 매출 대비 인건비율" : "월 인건비율", value: labor, unit: "%", definition: "급여·상여·퇴직·복리후생·4대보험 계정 순액÷같은 월 ECOUNT 매출. 임대·관리비 포함 전체 매출 기준", source: "ECOUNT 원장 계정 분류", href: accountingHref });
  return metrics;
}
