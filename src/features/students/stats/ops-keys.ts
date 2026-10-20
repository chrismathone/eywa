import type { PeriodKeys } from "@/features/stats/period";

/**
 * 매일 기록 카드의 주소 이름 — 같은 화면의 다른 기간 칸과 겹치지 않게(서버 페이지·카드가 함께 읽어 일반 모듈에 둔다 — [[#81]]).
 * 상담 진행 기록 = 신규 콜&상담 통계 보기(`trend…`는 신규 문의 추이) · 신규생 기록 = `/newcomers/stats`.
 */
export const PROGRESS_KEYS: PeriodKeys = { grain: "pg", month: "pgMonth", from: "pgFrom", to: "pgTo", span: "pgSpan" };
export const NEWCOMER_KEYS: PeriodKeys = { grain: "grain", month: "month", from: "from", to: "to", span: "span" };
