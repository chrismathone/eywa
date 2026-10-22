import { METRIC_LABELS, type Metric } from "../model/config";
import type { StudentFact, StudentSource } from "@/features/students/ontology/types";

export const numberText = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
export const monthText = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
export const metricLabels: Record<Metric, string> = { ...METRIC_LABELS,
  referralConsult: "소개 상담", referralStarted: "소개 후 수업 시작", subjectMonths: "과목별 수강",
  perfectMonths: "개근", videoMonths: "영상 숙제 완료", examMonths: "월말평가 응시" };
export const metricUnits: Record<Metric, string> = {
  referralConsult: "건", referralStarted: "건", tuitionWon: "원", subjectMonths: "과목·개월", tenureYears: "회",
  perfectMonths: "개월", videoMonths: "개월", examMonths: "개월", parentPositiveMonths: "개월", teacherPositiveMonths: "개월",
};
export const rawText = (metric: Metric, value: number) => `${numberText(value)}${metricUnits[metric]}`;
export const rateUnit = (metric: Metric) => metric === "tuitionWon" ? "10만 원당" : metric === "tenureYears" ? "재원 12개월마다"
  : metric === "subjectMonths" ? "1과목·1개월당" : metric.endsWith("Months") ? "한 달당" : "한 건당";
export const factLabels: Record<StudentFact["kind"], string> = {
  consulted: "상담", referred: "소개", enrolled: "수강", tuition: "수업료", attendance: "출결", homework: "영상 숙제", exam: "시험", observation: "긍정 신호 판정",
};
export const sourceLabels: Record<StudentSource, string> = {
  students: "학생 정보", enrollments: "수강 이력", enrollment_consultations: "등록 상담·소개", invoices: "에이와 수업료",
  makeedu_history_bills: "메이크에듀 수업료", attendance_records: "출결", student_homework_videos: "영상 숙제", student_grades: "시험 응시",
  classnote_parent_messages: "학부모 글", classnote_parent_replies: "선생님 답글", student_positive_signals: "긍정 신호 판정",
  lesson_reports: "수업 기록", class_schedules: "수업 일정", audit_logs: "변경 이력",
};
export const fieldClass = "h-(--control-h) min-w-0 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15";

/** 저장된 검토 사유는 유지하고 화면에서는 확인할 행동으로 풀어 쓴다. */
export const referralReason = (reason: string) => ({
  "동명이인 원생번호 충돌": "같은 이름의 학생 번호가 서로 다릅니다",
  "소개 문맥 확인 필요": "실제 소개인지 상담 내용을 확인해 주세요",
  "직원 이름과 겹침": "직원과 이름이 같아 확인이 필요합니다",
  "상담일 재원 근거 없음": "상담 당시 재원 여부를 확인해 주세요",
  "소개자 학교·학년 불일치": "소개자의 학교·학년 정보가 맞지 않습니다",
  "서로 다른 소개 후보": "소개자 후보가 여러 명입니다",
  "동명이인 확인 필요": "같은 이름의 학생이 여러 명입니다",
  "본인 소개": "상담 대상과 소개자가 같은 학생으로 확인됩니다",
}[reason] ?? reason);
