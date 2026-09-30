/**
 * 원생상담 목록 주소 — 목록 쪽 넘김·통계 패널의 '이 값으로 거르기'가 **같은 규칙**으로 주소를 짓는다(순수 · 서버/클라 공용).
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

export function consultationsHref(
  p: ConsultationListParams,
  defaultSize: number,
  patch: Partial<ConsultationListParams> = {},
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
  return s ? `/consultations?${s}` : "/consultations";
}
