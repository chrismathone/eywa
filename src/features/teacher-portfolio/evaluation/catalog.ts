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
};

export const METRIC_META: Record<BuiltinMetricId, MetricMeta> = {
  report: { unit: "%", short: "보고서", color: "var(--color-primary)", measure: "본인이 쓴 수업보고서 ÷ 보고 대상(학생·수업일, 결석·휴원·제외 반 빼고)" },
  attendance: { unit: "%", short: "출결", color: "var(--color-green)", measure: "처리한 출결 ÷ 출결 대상(수업을 맡은 강사 기준)" },
  follow: { unit: "%", short: "상담", color: "var(--color-rose)", measure: "마감 전에 마친 후속 처리 ÷ 후속 기한이 이 달인 상담" },
  quality: { unit: "점", short: "평가", color: "var(--color-purple)", measure: "이 달에 처음 완료된 타인 평가의 문항 평균(4점 만점, 자기 평가 제외)" },
  students: { unit: "", short: "배정·유지", color: "var(--color-blue)", measure: "신규 +1 · 퇴원·수강종료 −1 · 반이동 유입 +0.5 · 유출 −0.5를 더한 값" },
  revenue: { unit: "%", short: "매출", color: "var(--color-amber)", measure: "담당 매출 ÷ 그 과목 전체 매출" },
  expansion: { unit: "건", short: "과목 소개", color: "var(--color-chart-5)", measure: "인정된 소개 건수" },
  coverage: { unit: "%", short: "보강", color: "var(--color-gold)", measure: "기한 안에 마친 보강 ÷ 기한이 이 달에 끝나는 보강" },
};

/** 직접 만든 지표의 막대 색 — 차례대로 돌려 쓴다. */
export const MANUAL_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)"];
