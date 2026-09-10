/**
 * 사용자 템플릿 **저장 전 검사** — 순수 함수(Vitest로 잠금). 서버 액션과 편집 화면이 같은 함수를 쓴다.
 *
 * 🔴 모르는 토큰이 있으면 **저장을 거절한다**. 채우기(fill.ts)는 모르는 토큰을 빈 값으로 보고 그 줄을
 *    조용히 지우므로(학부모에게 중괄호가 나가지 않게), 오타(`{진도2}`)를 저장해 두면 그 줄이 **영영 안 나가는데**
 *    아무도 모른다. 저장 시점에 사람이 보는 문장으로 막는 게 유일한 기회다.
 */
import { ENGLISH_TEMPLATE_TOKENS, TEMPLATE_BODY_MAX, TEMPLATE_NAME_MAX } from "./defaults";
import { templateTokens } from "./fill";

export type TemplateInput = { name: string; body: string };
export type TemplateCheck = { ok: true; name: string; body: string } | { ok: false; error: string };

const KNOWN = new Set<string>(ENGLISH_TEMPLATE_TOKENS.map((t) => t.key));

export function checkTemplateInput(input: TemplateInput): TemplateCheck {
  const name = (input.name ?? "").trim();
  const body = (input.body ?? "").replace(/\r\n?/g, "\n").trim();
  if (!name) return { ok: false, error: "템플릿 이름을 적어 주세요." };
  if (name.length > TEMPLATE_NAME_MAX) return { ok: false, error: `템플릿 이름은 ${TEMPLATE_NAME_MAX}자까지입니다.` };
  if (!body) return { ok: false, error: "템플릿 내용을 적어 주세요." };
  if (body.length > TEMPLATE_BODY_MAX) {
    return { ok: false, error: `템플릿 내용은 ${TEMPLATE_BODY_MAX.toLocaleString("ko-KR")}자까지입니다.` };
  }
  const unknown = templateTokens(body).filter((t) => !KNOWN.has(t));
  if (unknown.length) {
    return {
      ok: false,
      error: `없는 칸이 있습니다: ${unknown.map((t) => `{${t}}`).join(", ")} — 아래 칸 목록에서 골라 넣어 주세요.`,
    };
  }
  return { ok: true, name, body };
}
