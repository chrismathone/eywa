"use server";

/**
 * 영어 수업보고서 AI 멘트(인사말 + 코멘트) 서버 액션 — 영어 템플릿 모드 전용.
 *
 * 수학 `generateReportComment`와 같은 문지기를 통과한다: 로그인 · '다른 강사 뷰'(열람 전용) 차단 ·
 * 학생 사실이 하나도 없으면 AI를 부르지 않는다. DB는 바꾸지 않는다(생성만).
 * 🔴 이름 규칙(사용자 2026-09-10: 최소 1번 언급)은 생성 뒤 코드가 확인한다 — 빠지면 **한 번만** 다시 만들고,
 *    그래도 빠지면 실패로 돌리지 않고 `nameMissing`으로 알린다(화면이 경고하고 강사가 고친다).
 * ⚠️ 이 파일은 async 함수만 export한다([[#119]]).
 */
import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { generateJSON } from "@/lib/ai/generate";
import { reportError } from "@/lib/observability/report-error";
import { aiUserMessage } from "@/lib/ai/user-message";
import { mentionsStudentName } from "@/features/report-templates/name-mention";
import { MENT_AI_TUNING } from "../prompt-defaults";
import {
  buildEnglishMentPrompt,
  hasEnglishMentFacts,
  parseEnglishMent,
  sanitizeEnglishMentInput,
  type EnglishMentInput,
  type EnglishMentResult,
} from "../english-ment";

/** 인사말 1~2문장 + 코멘트 3~5문장. 한국어라 여유를 둔다 — 한도에서 잘리면 JSON 오류로 위장한다([[#89]]). */
const MAX_TOKENS = 1200;

async function generateOnce(
  input: EnglishMentInput,
  remindName: boolean,
  tenantId: string,
): Promise<{ intro: string; comment: string } | null> {
  const { data } = await generateJSON<Record<string, unknown>>({
    prompt: buildEnglishMentPrompt(input, { remindName }),
    maxTokens: MAX_TOKENS,
    keyName: "default",
    tier: "fast",
    meta: { feature: "english_ment", tenantId },
    ...MENT_AI_TUNING,
  });
  return parseEnglishMent(data);
}

export async function generateEnglishMent(input: EnglishMentInput): Promise<EnglishMentResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) — DB는 안 바꾸지만 AI 호출(비용)이라 열람에서 못 누르게 한다(수학 멘트와 같다).
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };

  const safe = sanitizeEnglishMentInput(input);
  if (!safe.studentName) return { ok: false, error: "학생 이름이 없어 자동작성할 수 없습니다" };
  if (!hasEnglishMentFacts(safe)) {
    return { ok: false, error: "진도·테스트·태도 등을 입력한 뒤 자동작성할 수 있습니다" };
  }
  const mentions = (r: { intro: string; comment: string }) =>
    mentionsStudentName(`${r.intro}\n${r.comment}`, safe.studentName, safe.englishName);

  let first: { intro: string; comment: string } | null;
  try {
    first = await generateOnce(safe, false, user.tenantId);
  } catch (e) {
    reportError(e, { scope: "onescreen.english-ment", step: "generate" });
    // 잔액 소진·키 오류·한도 같은 사유는 한글로 그대로 보인다(E11 — 이유를 모르면 강사가 계속 다시 누른다).
    return { ok: false, error: aiUserMessage(e, "AI 자동작성에 실패했습니다. 잠시 후 다시 시도해 주세요.") };
  }
  if (!first) return { ok: false, error: "AI가 빈 답을 돌려줬습니다. 다시 시도해 주세요." };
  if (mentions(first)) return { ok: true, ...first, nameMissing: false };

  // 이름이 빠졌다 — 한 번만 다시(빠졌다고 짚어 준다). 두 번째가 실패해도 첫 답은 살린다.
  try {
    const second = await generateOnce(safe, true, user.tenantId);
    if (second && mentions(second)) return { ok: true, ...second, nameMissing: false };
    return { ok: true, ...(second ?? first), nameMissing: true };
  } catch (e) {
    reportError(e, { scope: "onescreen.english-ment", step: "retry-name" });
    return { ok: true, ...first, nameMissing: true };
  }
}
