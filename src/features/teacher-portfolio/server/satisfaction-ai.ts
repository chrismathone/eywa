import "server-only";
import { generateJSON } from "@/lib/ai/generate";

/**
 * 학부모 만족도 — 문구로 가르기 애매한 학부모 글을 AI가 먼저 읽는다(계획서 3번 · 원장 2026-10-13 승인).
 * AI 판정은 바로 반영하지 않고 '확인 대기'에 쌓는다(원장 결정 8) — 사람이 반영/무시한다.
 *
 * - 모델 = fast 등급 Claude Haiku 5.5 먼저(2026-10-26 원장 결정) → 막히면 사다리(ChatGPT).
 *   40자 남짓 글의 가점/감점/무관이라 추론형은 과하다.
 * - 사실 원칙(FACT_GUARD)은 `generateJSON`이 붙인다. 근거 구절은 **원문에 그대로 있는 것만** 남긴다(없으면 비운다 — 지어낸 근거 금지).
 * - 이름·연락처는 보내지 않는다 — 글 본문만(출결 분류가 이미 같은 글을 보낸다).
 */
export type AiVerdict = { verdict: "plus" | "minus" | "none"; quote: string | null };
type ModelResult = { results?: Array<{ id?: unknown; verdict?: unknown; quote?: unknown }> };

const PROMPT = `학원 강사 평가 자료입니다. 아래는 학부모가 학원 알림장에 남긴 글·댓글입니다(결석·지각 연락은 이미 뺐습니다).
글마다 학부모가 **학원·선생님·수업에 대해** 나타낸 마음을 하나로 고르세요.
- plus: 선생님·수업 덕분에 아이가 나아졌다는 말, 선생님이 한 일을 콕 집은 고마움·칭찬. 맺음 인사('감사합니다'·'잘 부탁드립니다'·'믿고 맡기겠습니다')만 있으면 none.
- minus: 선생님·수업·학원에 대한 불만·항의·서운함을 직접 말하거나 고쳐 달라고 요구한 글, 그만두거나 옮기려는 뜻. 묻거나 확인하는 글(수업 방식·일정·보강·연락)은 아쉬운 기색이 있어도 none.
- none: 그 밖 — 문의·확인·일정·인사·부탁·아이에 대한 걱정이나 집에서의 이야기.
quote = 판단 근거가 된 구절을 원문에서 **그대로** 옮긴 30자 이내(none이면 빈 문자열). 원문에 없는 말을 쓰지 마세요.
JSON으로만 답하세요: {"results":[{"id":"…","verdict":"plus|minus|none","quote":"…"}]}`;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export async function judgeWithAi(tenantId: string, posts: readonly { id: string; content: string }[]): Promise<{ verdicts: Map<string, AiVerdict>; model: string }> {
  const res = await generateJSON<ModelResult>({
    // 2026-10-26 원장 결정 — 빠른 등급 = Haiku 5.5. 막히면 사다리로 ChatGPT.
    tier: "fast", provider: "anthropic", maxTokens: 2048,
    meta: { feature: "parent_satisfaction", tenantId },
    prompt: `${PROMPT}\n\n${JSON.stringify(posts.map((p) => ({ id: p.id, text: squash(p.content).slice(0, 600) })))}`,
  });
  const verdicts = new Map<string, AiVerdict>();
  const byId = new Map(posts.map((p) => [p.id, squash(p.content)]));
  for (const r of res.data?.results ?? []) {
    const id = typeof r.id === "string" ? r.id : "";
    const text = byId.get(id);
    if (!text) continue;
    const verdict = r.verdict === "plus" || r.verdict === "minus" ? r.verdict : "none";
    // 근거 구절은 30자까지(프롬프트와 같은 길이) — 짧은 글의 본문 전체가 판정 줄에 남지 않게.
    const quote = typeof r.quote === "string" ? squash(r.quote).slice(0, 30) : "";
    verdicts.set(id, { verdict, quote: quote && text.includes(quote) ? quote : null });
  }
  return { verdicts, model: res.model };
}
