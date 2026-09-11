/**
 * 사용자 템플릿 **저장 전 검사** — 순수 함수(Vitest로 잠금). 서버 액션과 편집 화면이 같은 함수를 쓴다.
 *
 * 🔴 모르는 토큰이 있으면 **저장을 거절한다**. 채우기(fill.ts)는 모르는 토큰을 빈 값으로 보고 그 줄을
 *    조용히 지우므로(학부모에게 중괄호가 나가지 않게), 오타(`{진도2}`)를 저장해 두면 그 줄이 **영영 안 나가는데**
 *    아무도 모른다. 저장 시점에 사람이 보는 문장으로 막는 게 유일한 기회다.
 */
import { ENGLISH_TEMPLATE_TOKENS, TEMPLATE_BODY_MAX, TEMPLATE_NAME_MAX } from "./defaults";
import { normalizeTokenName, templateTokens } from "./fill";
import { IMAGE_SLOT_KEYS, attachmentNameOfLine } from "./image-slots";

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
  const slotError = imageSlotLineError(body);
  if (slotError) return { ok: false, error: slotError };
  // 🔴 사진·PDF 자리 줄은 템플릿에 못 넣는다 — 첨부는 **보고서마다** 강사가 올리는 파일이라 템플릿에 적힌 이름은 가리킬 파일이
  //    없다(카드는 아무것도 안 그린다). 보고서 글에서 '사진·PDF 넣기'로 넣는다(적대 리뷰 2026-09-11).
  if (body.split("\n").some((line) => attachmentNameOfLine(line) !== null)) {
    return {
      ok: false,
      error: "사진·PDF 자리 줄([첨부: …])은 템플릿에 넣을 수 없습니다 — 보고서 글에서 '사진·PDF 넣기'로 넣어 주세요.",
    };
  }
  return { ok: true, name, body };
}

const SLOT_KEYS = new Set<string>(IMAGE_SLOT_KEYS);

/**
 * 🔴 그림 칸은 **한 줄에 혼자**, 템플릿에 **한 번씩만** — 문장 속에 섞이면 채운 값 `[시험결과지]`가 글자 그대로
 * 학부모에게 나간다(카드·글 복사는 줄 전체가 표식일 때만 그림 자리로 본다, image-slots.ts). 두 번이면 같은 그림이
 * 두 번 그려진다(적대 리뷰 2026-09-11). 두 키 모두 받침 없이 끝나 조사는 '는'이다.
 */
function imageSlotLineError(body: string): string | null {
  const seen = new Set<string>();
  for (const line of body.split("\n")) {
    for (const m of line.matchAll(/\{([^{}\n]{1,20})\}/g)) {
      const key = normalizeTokenName(m[1]!);
      if (!SLOT_KEYS.has(key)) continue;
      if (line.replace(/\s+/g, "") !== `{${key}}`) {
        return `그림 칸 {${key}}는 한 줄에 혼자 두어야 합니다 — 앞뒤 글은 다른 줄로 옮겨 주세요.`;
      }
      if (seen.has(key)) return `그림 칸 {${key}}는 템플릿에 한 번만 넣을 수 있습니다.`;
      seen.add(key);
    }
  }
  return null;
}
