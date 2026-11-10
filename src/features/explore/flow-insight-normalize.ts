/**
 * 원생 흐름 분석 응답 다듬기 — 검증(`flowInsightSchema`) **앞**에서 길이·개수만 계약에 맞춘다(2026-11-11).
 * 운영 로그(2026-11-10 밤 배치): 모델이 주제(themes) 하나를 60자 넘게 써서 검증이 통째로 실패 → 그 학생 분석이 갱신되지 않았다.
 * 한도를 올리면 실패 경계만 옮겨 가므로(Codex 협의) 넘친 **표현**만 다듬고, **구조**가 틀린 응답(형식·방향 값·빈 제목)은 그대로 거절한다.
 *  - 주제(themes): 짧은 이름표라 반쪽으로 자르면 뜻이 흐려진다 → 넘친 주제는 **뺀다** · 빈 것도 뺀다 · 앞에서 6개.
 *  - 글(headline·recentChange·basis·watch·nextSteps): 한도에서 말줄임(…)으로 자른다(띄어쓰기 경계를 먼저 찾는다) · 목록의 빈 줄은 빼고 앞에서 4개.
 * 같은 결과를 다시 넣어도 그대로다(저장된 요약을 읽을 때도 같은 함수를 지난다).
 * ⚠️ `"use client"`도 `server-only`도 붙이지 말 것(#61·#81) — 화면·서버·테스트가 같이 읽는 계약 모듈과 같은 자리.
 */

export const FLOW_TEXT_LIMITS = { headline: 200, recentChange: 400, basis: 200, item: 200, theme: 60 } as const;
export const FLOW_LIST_LIMITS = { themes: 6, watch: 4, nextSteps: 4 } as const;

/** 한도(글자 수 = JS 길이 — zod `max`와 같은 셈)를 넘으면 말줄임으로 자른다. 띄어쓰기가 끝쪽 20자 안에 있으면 거기서. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let room = text.slice(0, max - 1);
  // 이모지 같은 두 칸짜리 글자를 반으로 자르면 짝 없는 반쪽이 남아 jsonb 저장이 거절된다 — 그 반쪽은 뺀다.
  if (/[\uD800-\uDBFF]$/.test(room)) room = room.slice(0, -1);
  const space = room.lastIndexOf(" ");
  const cut = space >= max - 21 && space > 0 ? room.slice(0, space) : room;
  return `${cut.trimEnd()}…`;
}

type Adjusted = string[];

function normText(o: Record<string, unknown>, key: keyof typeof FLOW_TEXT_LIMITS, adjusted: Adjusted, max: number) {
  const v = o[key];
  if (typeof v !== "string") return;
  const t = v.trim();
  const c = clipText(t, max);
  if (c !== t) adjusted.push(key);
  o[key] = c;
}

function normList(o: Record<string, unknown>, key: keyof typeof FLOW_LIST_LIMITS, adjusted: Adjusted, each: (s: string) => string | null) {
  const v = o[key];
  if (!Array.isArray(v)) return;
  const out: unknown[] = [];
  let changed = false;
  for (const item of v) {
    if (typeof item !== "string") {
      out.push(item); // 형식이 틀린 항목은 검증이 거절하게 둔다(그럴듯하게 고치지 않는다)
      continue;
    }
    const t = item.trim();
    const n = t === "" ? null : each(t);
    if (n !== t) changed = true;
    if (n !== null) out.push(n);
  }
  const limited = out.slice(0, FLOW_LIST_LIMITS[key]);
  if (changed || limited.length !== out.length) adjusted.push(key);
  o[key] = limited;
}

/**
 * 응답을 계약 길이·개수에 맞춘 사본과, 손댄 칸 이름(학생 글은 담지 않는다 — 로그용).
 * 객체가 아니면 그대로 돌려준다(검증이 거절한다).
 */
export function normalizeFlowInsight(data: unknown): { value: unknown; adjusted: string[] } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { value: data, adjusted: [] };
  const o: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  const adjusted: Adjusted = [];
  normText(o, "headline", adjusted, FLOW_TEXT_LIMITS.headline);
  normText(o, "recentChange", adjusted, FLOW_TEXT_LIMITS.recentChange);
  normText(o, "basis", adjusted, FLOW_TEXT_LIMITS.basis);
  normList(o, "themes", adjusted, (t) => (t.length > FLOW_TEXT_LIMITS.theme ? null : t));
  normList(o, "watch", adjusted, (t) => clipText(t, FLOW_TEXT_LIMITS.item));
  normList(o, "nextSteps", adjusted, (t) => clipText(t, FLOW_TEXT_LIMITS.item));
  return { value: o, adjusted };
}
