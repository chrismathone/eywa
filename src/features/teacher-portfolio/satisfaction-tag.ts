/**
 * 만족도 확인 대기 글의 꼬리표 — 화면엔 짧게, 긴 사유는 마우스를 올리면 카드로(원장 2026-10-16 *"이런 문구 길게 쓰지말고 간략하게.
 * 마우스오버시 길게. 예를 들어 애매 같은 라벨을 붙이는거지"*).
 */
export type SatisfactionTag = { label: string; title: string; lines: string[] };

export function satisfactionTag(q: { ai: boolean; verdict: "plus" | "minus" | null; reason: string | null }): SatisfactionTag {
  const v = q.verdict === "plus" ? "가점" : q.verdict === "minus" ? "감점" : null;
  const lines = q.reason ? [q.reason] : [];
  if (q.ai) return { label: v ? `AI ${v}` : "AI 보류", title: `AI 판정 — ${v ? `${v} 제안` : "판단 없음"}`, lines };
  // 문구는 확실한데 보드로 과목·반을 못 가려 보류한 글(`server/satisfaction-judge.ts`) — '애매'가 아니다(적대적 리뷰 2026-10-16).
  if (v) return { label: `${v} 확인`, title: `문구로는 ${v} — 보드로 과목·반을 못 가려 확인 대기`, lines };
  return { label: "애매", title: "문구 판정 애매 — 가점·감점이 확실하지 않습니다", lines };
}
