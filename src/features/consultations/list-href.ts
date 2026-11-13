/**
 * 원생상담 목록·통계 주소 — 목록 쪽 넘김·통계 화면의 '이 값으로 거르기'·목록 ↔ 통계 이동이 **같은 규칙**으로 주소를 짓는다(순수 · 서버/클라 공용).
 * 필터를 하나 바꾸면 쪽은 1쪽으로 간다(같은 번호가 다른 행을 가리키게 되므로 — FilterSelect 규약과 같다).
 */
export type ConsultationListParams = {
  range: string; // "all" | "7d" | "30d"
  cat: string; // "all" | 카테고리
  urg: string; // "all" | 후속
  who: string; // 상담사 id(빈 값 = 전체)
  subject: string; // 과목 키(빈 값 = 전체)
  q: string;
  size: number;
  page?: number;
};

/**
 * 목록 한 쪽의 기본 행 수 — 쪽 크기는 **창이 정한다**([AutoPageSize](@/components/auto-page-size)가 `?size=N` + 기기 쿠키). 서버는
 * URL → 쿠키 → 이 기본값 순으로 읽는다. 12 = 최소 창(760×640, 본문 601px)의 한 단 행 수 6 × 2 — 쿠키가 없는 첫 방문에도 다시 청하지 않게.
 * 통계 화면의 '목록으로'도 이 값과 같으면 주소에서 size를 뺀다(쿠키가 정한다) — 두 화면이 같은 상수를 읽는다.
 */
export const CONSULT_DEFAULT_PAGE_SIZE = 12;

function buildHref(
  base: string,
  p: ConsultationListParams,
  defaultSize: number,
  patch: Partial<ConsultationListParams>,
): string {
  const next = { ...p, ...patch };
  const filterChanged = (["range", "cat", "urg", "who", "subject", "q"] as const).some((k) => k in patch && patch[k] !== p[k]);
  const page = filterChanged ? 1 : (next.page ?? 1);
  const params = new URLSearchParams();
  if (next.range && next.range !== "all") params.set("range", next.range);
  if (next.cat && next.cat !== "all") params.set("cat", next.cat);
  if (next.urg && next.urg !== "all") params.set("urg", next.urg);
  if (next.who) params.set("who", next.who);
  if (next.subject) params.set("subject", next.subject);
  if (next.q) params.set("q", next.q);
  if (next.size !== defaultSize) params.set("size", String(next.size));
  if (page > 1) params.set("page", String(page));
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}

export function consultationsHref(
  p: ConsultationListParams,
  defaultSize: number,
  patch: Partial<ConsultationListParams> = {},
): string {
  const href = buildHref("/consultations", p, defaultSize, patch);
  // 값이 하나도 없으면 목록 표식 — 원장·관리자는 빈 주소면 통계로 간다(stats-first.ts).
  return href === "/consultations" ? "/consultations?list=1" : href;
}

/**
 * 통계 화면 주소(원장 2026-10-01 — 목록 ↔ 통계를 오가도 **같은 필터**). 목록 주소와 **같은 규칙**: 기간·카테고리·후속·상담사·과목에
 * 검색어·쪽·쪽 크기까지 그대로 싣는다 — 통계는 검색어·쪽을 안 쓰지만 '목록으로' 돌아올 때 같은 쪽·같은 크기로 되살린다(3쪽에서
 * 통계를 봤다 돌아왔는데 1쪽이면 보던 자리를 잃는다 — 적대 리뷰 2026-10-01). 필터를 바꾸면(분해 줄 `patch`·드롭다운) 1쪽으로 간다.
 */
export function consultationsStatsHref(p: ConsultationListParams, patch: Partial<ConsultationListParams> = {}): string {
  return buildHref("/consultations/stats", p, CONSULT_DEFAULT_PAGE_SIZE, patch);
}
