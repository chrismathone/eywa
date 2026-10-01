/**
 * 통계 수치 옆에 적는 **기간과 범위** 문구(퇴원관리 규약 — 목록 필터가 걸렸는데 '전체'처럼 보이면 화면이 거짓말을 한다).
 * 목록 위 요약 띠와 통계 화면이 **같은 문구**를 쓴다(순수 · 서버/클라 공용, [[#61]]).
 */
import { CONSULTATION_CATEGORY_LABEL } from "./labels";
import { dateSpanText, type ConsultationStats } from "./stats-model";
import type { ConsultationListParams } from "./list-href";

const RANGE_TEXT: Record<string, string> = { "7d": "최근 7일", "30d": "최근 30일" };
const URG_TEXT: Record<string, string> = { overdue: "지연", today: "오늘", soon: "3일 내", later: "예정", done: "완료" };

export type StatsScopeText = {
  /** 기간 + 실제로 잡힌 첫·마지막 상담일 — `전체 기간(1/5~9/30)`. 통계 화면 머리·띠 툴팁. */
  period: string;
  /** 기간 이름만 — `전체 기간`·`최근 7일`. 한 줄 띠처럼 좁은 자리(날짜 범위는 툴팁으로). */
  rangeText: string;
  /** 걸린 범위 — `내가 기록한 상담 · 과목 수학` 또는 `학원 전체`. */
  scope: string;
  /**
   * 검색어가 걸려 있다 — 통계엔 안 걸린다(집계 RPC에 없다). 목록 '결과 N건'과 통계 건수가 다른 이유라
   * 표면마다 **잘리지 않는 자리**에 '검색어 제외'를 따로 적는다(띠에서 문구 끝에 붙였더니 말줄임에 먹혔다 — 적대 리뷰 2026-10-01).
   */
  searchExcluded: boolean;
};

export function statsScopeText(
  stats: ConsultationStats,
  p: Pick<ConsultationListParams, "range" | "cat" | "urg" | "who" | "subject" | "q">,
  o: { teacherScoped: boolean; whoLabel: string | null; subjectLabel: string | null },
): StatsScopeText {
  // 기간 — 전체면 실제로 잡힌 첫·마지막 상담일까지 적는다("언제부터의 수치인가").
  const span = stats.full && stats.totals.first && stats.totals.last ? dateSpanText(stats.totals.first, stats.totals.last) : null;
  const rangeText = RANGE_TEXT[p.range] ?? "전체 기간";
  const bits = [
    o.teacherScoped ? "내가 기록한 상담" : null,
    p.cat !== "all" ? `카테고리 ${CONSULTATION_CATEGORY_LABEL[p.cat] ?? "—"}` : null,
    p.urg !== "all" ? `후속 ${URG_TEXT[p.urg] ?? "—"}` : null,
    !o.teacherScoped && p.who ? `상담사 ${o.whoLabel ?? "—"}` : null,
    p.subject ? `과목 ${o.subjectLabel ?? "—"}` : null,
  ].filter((v): v is string => !!v);
  return {
    period: `${rangeText}${span ? `(${span})` : ""}`,
    rangeText,
    scope: bits.length ? bits.join(" · ") : "학원 전체",
    searchExcluded: !!p.q,
  };
}
