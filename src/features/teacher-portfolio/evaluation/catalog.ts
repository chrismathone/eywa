/**
 * 지표 목록 — aywa가 스스로 셀 수 있는 지표와 그 **원래 수치**의 뜻·단위. 원장은 이 목록에서 넣고 빼고(설정),
 * 목록에 없는 것은 직접 만든 지표(달마다 숫자 입력)로 더한다. 순수 상수 모듈(서버·클라이언트 공용).
 *
 * 🔴 새 자동 지표를 더할 때: ① `config.ts`의 BUILTIN_METRICS·기본값 ② 여기 한 줄 ③ 계산 코드가 `raw`를 채운다.
 */
import type { BuiltinMetricId } from "./config";

export type MetricMeta = {
  /** 원래 수치의 단위 — 설정 화면의 구간 칸과 근거 문장에 붙는다. */
  unit: string;
  /** 표·탭의 짧은 이름(원장이 바꾼 이름이 없을 때). */
  short: string;
  /** 원래 수치가 무엇인가 — 설정 화면에 그대로 보인다. */
  measure: string;
  /** 막대 색 — 상태 뜻이 아니라 항목 구분. 토큰만. */
  color: string;
  /** 아직 계산이 들어오지 않았다 — 들어오는 단계(설정 화면·근거 화면이 알린다). */
  pending?: string;
};

export const METRIC_META: Record<BuiltinMetricId, MetricMeta> = {
  payRatio: { unit: "%", short: "급여 비율", color: "var(--color-amber)", measure: "지난달 급여(세전: 직접 입력 → 계약서 월급 → 출석부 실급여) ÷ 지난달 담당 매출(담당 반 학생 청구서의 그 반 금액, 할인 전 — 이름이 안 맞으면 짝이 하나일 때) — 이번 달 급여는 월말이 돼야 확정되므로 10월 점수 = 9월 값 · 지난달 담당 반이 없던 새 선생님은 합계에서 제외 · 금액은 보이지 않고 비율만" },
  churn: { unit: "%", short: "퇴원율", color: "var(--color-blue)", measure: "이 달에 그만둔 학생 ÷ 지난달 담당 학생(담임·교시 담당 모두 · 정규 수업으로 그 달 절반 이상 맡은 학생) — 다른 반으로 옮긴 뒤 그 과목을 그만두면 센다 · 고른 사유·반 이동·수업 끝남·끝난 특강·같은 과목 다른 반을 계속 다님(어느 선생님 반이든 — 반 이동처럼)은 제외 · 지난달 담당 학생이 없던 새 선생님은 합계에서 제외" },
  grades: { unit: "%", short: "성적", color: "var(--color-purple)", measure: "일일테스트 제출률(보고서 대상 칸 중 일일테스트 기록이 있는 칸) · 월말평가 응시율(그 달 마지막 날 담임 반 학생 중 그 달 월말평가를 본 학생) · 확인테스트·내신 점수율을 아래 비중으로 가중 평균 — 일일테스트·월말평가는 그 달 그 시험 기록이 있는 과목만(특강 반 제외)" },
  satisfaction: { unit: "점", short: "만족도", color: "var(--color-green)", measure: "학부모 글·댓글 판정(확실한 문구는 바로, 애매한 글은 확인 뒤 반영)과 원장이 넣은 클레임·칭찬의 가감 합 — 만점 없이 총점에 그대로 더하고 뺀다" },
  punctuality: { unit: "회", short: "근태", color: "var(--color-gold)", measure: "그 달 지각·결근·조퇴 횟수(가중 합) — 메이크에듀 출퇴근 시각을 그날 맡은 수업(또는 개인 출퇴근 시각)과 견준다 · 결재된 휴가·휴원일은 뺀다 · 원장이 넣은 횟수가 있으면 그 값" },
  report: { unit: "%", short: "보고서", color: "var(--color-primary)", measure: "본인이 수업 당일에 쓴 수업보고서 ÷ 보고 대상(학생·수업일, 결석·휴원·제외 반 빼고) — 대리·다음 날 이후 작성은 미작성" },
  attendance: { unit: "%", short: "출결", color: "var(--color-green)", measure: "본인이 수업 당일에 넣은 출결 ÷ 출결 대상(수업을 맡은 날) — 다른 사람·다음 날 이후 입력은 미작성" },
  counsel: { unit: "%", short: "상담", color: "var(--color-rose)", measure: "이 달 담임인 반의 학생 중 본인이 1회 이상 상담한 학생 ÷ 담임 반 학생(부담임 학생은 뺀다)" },
  follow: { unit: "%", short: "후속 처리", color: "var(--color-rose)", measure: "마감 전에 마친 후속 처리 ÷ 후속 기한이 이 달인 상담" },
  quality: { unit: "점", short: "평가", color: "var(--color-purple)", measure: "이 달에 처음 완료된 타인 평가의 문항 평균(4점 만점, 자기 평가 제외)" },
  students: { unit: "", short: "배정·유지", color: "var(--color-blue)", measure: "신규 +1 · 퇴원·수강종료 −1(강사 탓이 아닌 사유는 빼고) · 반이동 유입 +0.5 · 유출 −0.5를 더한 값" },
  revenue: { unit: "%", short: "매출", color: "var(--color-amber)", measure: "담당 매출 ÷ 그 과목 전체 매출" },
  expansion: { unit: "건", short: "소개", color: "var(--color-chart-5)", measure: "신규 콜&상담에서 '소개한 사람'으로 이어진 소개 건수(상담만 받아도 인정 · 소개한 원생의 상담일 담임 또는 소개한 직원에게 1건 · 같은 사람은 한 번)" },
  coverage: { unit: "%", short: "보강", color: "var(--color-gold)", measure: "기한 안에 마친 보강 ÷ 기한이 이 달에 끝나는 보강" },
};

/** 직접 만든 지표의 막대 색 — 차례대로 돌려 쓴다. */
export const MANUAL_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)"];
