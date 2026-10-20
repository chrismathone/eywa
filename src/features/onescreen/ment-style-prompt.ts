// 강사 말투 프로파일의 프롬프트 두 쪽 — **만드는** 프롬프트(buildMentStylePrompt)와 자동작성에 **붙이는** 지침(mentStyleDirective).
import type { MentStyleProfile, StyleSample } from "./ment-style";

/**
 * 프롬프트 규칙 버전 — 표본 지문(`styleCorpusHash`)에 섞인다. 아래 문구를 **뜻이 바뀌게** 고치면 올릴 것(그래야 표본이 같아도
 * 다음 갱신에서 다시 접는다). 실코퍼스 드라이런(2026-09-12)이 잡은 결함 셋을 반영한 것이 v2:
 *  ① 줄바꿈을 ' / '로 이었더니 모델이 "슬래시로 항목을 나누는 말투"라고 적었다 → ⏎ 기호 + 범례
 *  ② 그날의 행사 문장이 '자주 쓰는 표현'으로 나왔다 → 짧은 어구만 + 사건 금지(코드는 keepRecurringPhrases로 한 번 더)
 *  ③ 선생님의 오탈자가 표현으로 남았다 → 맞춤법은 표준으로
 */
// v3(재리뷰 2026-09-12): closing에 인사말을 적지 못하게 — 알림장 규칙(끝인사 금지)과 말투 지침이 같은 프롬프트에서 충돌하지 않게 원천에서 막는다.
// v4(첫 빌드 2026-09-12): AI 템플릿의 획일성 문구("오늘은"·"오늘 과제는")를 품은 표현을 뺀다(dropTemplatePhrases) — 코드 변경이라 버전을 올려 다시 접는다.
// v5(2026-10-16): 자동작성 원문(0370a)을 수정 표본 옆에 싣고 '늘 고치는 것'(edits)을 받는다 — 원장 *"한계를 수정할 수 있을까"*.
export const MENT_STYLE_PROMPT_VERSION = 5;

/**
 * 표본을 번호 매겨 싣고 JSON 한 덩어리를 받는다.
 * ⚠️ 사실 원칙(FACT_GUARD)은 generateJSON이 앞에 붙인다. 여기선 "내용을 옮기지 말라"를 따로 못박는다.
 */
export function buildMentStylePrompt(samples: readonly StyleSample[]): string {
  const manualCount = samples.filter((s) => s.source === "manual").length;
  const editedCount = samples.length - manualCount;
  const draftCount = samples.filter((s) => s.draft).length;
  const flat = (t: string) => t.replace(/\n+/g, " ⏎ ");
  const list = samples
    .map((s, i) => `${i + 1}. ${s.source === "auto_edited" ? "[수정] " : ""}${flat(s.text)}${s.draft ? `\n   ↳ 고치기 전 자동작성: ${flat(s.draft)}` : ""}`)
    .join("\n");
  return [
    "당신은 학원 학부모 알림장 문장을 분석하는 편집자입니다. 아래는 한 선생님이 학부모에게 **직접 쓴** 알림장 멘트들입니다",
    "(앞에 [수정]이 붙은 것은 자동작성 문장을 선생님이 고친 것 · 그 아래 '↳ 고치기 전 자동작성'은 선생님이 고치기 전의 AI 글 · ⏎ 는 원문의 줄바꿈 자리이지 선생님이 쓴 기호가 아닙니다).",
    "이 선생님의 **말투**를 다른 사람이 흉내 낼 수 있게 짧은 지침으로 정리하세요.",
    "",
    "[규칙 — 반드시]",
    "- 말투(어조·문장 길이·구조·자주 쓰는 표현·마무리 방식)만 정리합니다. 진도·점수·학생 이름·날짜·교재·단원·그날의 행사 같은 **내용은 절대 옮기지 마세요** — 지침에 사람 이름·숫자·특정 날의 사건이 들어가면 안 됩니다.",
    "- 표본에 실제로 **반복되는** 특징만 적습니다. 한두 번 나온 것을 일반화하지 마세요.",
    "- 자주 쓰는 표현은 **짧은 어구(2~6어절, 예: '풀어오기', '다음 시간에 마무리하겠습니다')**만 — 표본 여러 개에 그대로 되풀이되는 것 최대 6개. 어떤 날의 수업 내용·안내문·행사를 담은 문장은 표현이 아닙니다. 없으면 빈 배열.",
    "- 표본의 오탈자·띄어쓰기 오류는 말투가 아닙니다 — 맞춤법이 틀린 어구는 표현에 넣지 마세요(학부모에게 그대로 나갑니다).",
    "- 알림장 규칙상 인사말·끝인사(감사합니다·좋은 하루 되세요 등)는 쓰지 않습니다 — closing·phrases·edits에 인사말을 적지 마세요(표본에 있어도 뺍니다).",
    "- 'edits'(늘 고치는 것): '↳ 고치기 전 자동작성'이 붙은 표본에서 AI 글과 선생님 글을 견줘, **여러 표본에 되풀이되는 고침**만 적으세요 — 지우는 말·바꾸는 말·덧붙이는 말·순서(예: \"'아주 좋았습니다'를 지운다\", \"오늘 과제는 입력에 적힌 말 그대로 다 적는다\"). 한 줄씩 최대 5개. 점수·진도 같은 **사실을 바로잡은 것**과 그날만의 내용·사람 이름·숫자는 적지 마세요. 원문이 붙은 표본이 없으면 빈 배열. 선생님이 **덧붙인 내용**(일정·보강 안내·당부·칭찬)과, 자동작성 글 끝의 영상 과제 안내·학부모님께 드리는 말(코드가 붙이는 문장)을 지우거나 남긴 것은 적지 마세요 — 그날의 사실이라 따라 쓰면 지어낸 말이 됩니다.",
    "- 각 칸은 한국어 한두 문장. 전체 500자 이내.",
    "",
    `[표본 ${samples.length}개 — 직접 작성 ${manualCount}, 자동작성 후 수정 ${editedCount}${draftCount ? `(그중 고치기 전 원문이 있는 것 ${draftCount})` : ""}]`,
    list,
    "",
    '[출력] JSON만 출력: {"tone": "...", "sentence": "...", "length": "...", "phrases": ["..."], "closing": "...", "caution": "...", "edits": ["..."]}',
    "- tone: 어조(존댓말 종결형·격식·온도) · sentence: 문장 구조·리듬(짧게 끊는지, 줄바꿈을 쓰는지) · length: 보통 길이(짧다/중간/길다 + 대략 몇 문장)",
    "- phrases: 자주 쓰는 표현 · closing: 끝맺는 방식(과제 안내·다음 수업 예고 등) · caution: 이 선생님이 쓰지 않는 표현(없으면 빈 문자열)",
    "마크다운 코드블록 금지.",
  ].join("\n");
}

const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * AI 템플릿의 획일성 문구 — 2026-07-30 발송 감사 실측(AI 멘트 144건 중 94%가 '오늘은'으로 시작, 87%가 '아주 좋았', 83%가
 * '오늘 과제는 ~입니다'로 끝남 — prompt-defaults.ts). 🔴 기본 프롬프트 **전문**을 재료로 쓰면 안 된다 — 예시 문장이 강사 어투라
 * 선생님 고유 어구("다음시간에"·"성실히 참여했습니다")까지 우연히 부분 문자열로 걸려 사라진다(리뷰 2026-09-12 실측 26개 중 23개).
 */
export const AI_TEMPLATE_PHRASES: readonly string[] = ["오늘은", "아주 좋았", "오늘 과제는"];

/**
 * '자주 쓰는 표현' 중 **AI 템플릿의 획일성 문구를 품은 어구**를 뺀다 — 자동작성 후 수정 표본이 많은 강사는 그 문구가 표본마다
 * 되풀이되어 `keepRecurringPhrases`를 통과한다(첫 빌드 2026-09-12: 남정화·유형숙의 "오늘은"·"오늘 과제는"). 그건 선생님 말투가
 * 아니라 우리 프롬프트의 말투이고, '결' 변형이 금지하는 첫마디("오늘은")와 정면으로 부딪힌다. 공백 차이는 같은 문구로 본다.
 */
export function dropTemplatePhrases(profile: MentStyleProfile): MentStyleProfile {
  const stops = AI_TEMPLATE_PHRASES.map(squash);
  return { ...profile, phrases: profile.phrases.filter((p) => !stops.some((stop) => squash(p).includes(stop))) };
}

/** 프롬프트에 붙는 지침 블록의 머리 — 배선 가드가 이 글자를 찾는다. */
export const MENT_STYLE_DIRECTIVE_HEAD = "[이 선생님의 말투 — 따라 쓰기]";

/**
 * 자동작성 프롬프트 끝에 붙는 **말투 지침** — 결정적 렌더(같은 프로파일 = 같은 글자).
 * 🔴 마지막 줄이 핵심이다: 이 말투는 **항목 지침(문장 수·인사말 금지·시작어 규칙 등) 아래**에 있다 — 원장이 편집하는 프롬프트의
 *    금지를 말투가 뒤집으면 안 된다(리뷰 2026-09-12: "감사합니다"로 끝나는 선생님의 closing이 끝인사 금지를 이겼다). 첫 문장 여는
 *    자리는 '이번 알림장의 결'(학생·날짜별 변형)이 이긴다 — 안 그러면 한 선생님 반 전원이 같은 첫마디로 열려 07-30 복사본 문제가
 *    되살아난다. 사실은 [입력] 그대로, 맞춤법은 표준(표본의 오탈자를 따라 쓰지 않는다).
 * ⚠️ `length`는 **지침에 싣지 않는다**(카드 표시용) — 문장 수는 항목 지침(2~4문장)이 정하고, "6~7문장"·"1문장" 같은 성향은 그 규칙과
 *    정면으로 부딪힌다(재리뷰 2026-09-12). 짧게 쓰는 결은 `sentence`(명사형·짧게 끊음)가 이미 나른다.
 */
export function mentStyleDirective(profile: MentStyleProfile): string {
  const lines = [MENT_STYLE_DIRECTIVE_HEAD, `- 어조: ${profile.tone}`, `- 문장: ${profile.sentence}`];
  if (profile.phrases.length) lines.push(`- 자주 쓰는 표현: ${profile.phrases.map((p) => `"${p}"`).join(", ")}`);
  if (profile.closing) lines.push(`- 마무리: ${profile.closing}`);
  if (profile.caution) lines.push(`- 쓰지 않는 표현: ${profile.caution}`);
  // 0370a — 선생님이 자동작성 글에서 늘 고치는 것. 처음부터 그렇게 쓰면 고칠 일이 준다.
  if (profile.edits?.length) lines.push(`- 이 선생님이 자동작성 글에서 늘 고치는 것([입력]의 사실 안에서 처음부터 그렇게 쓰세요): ${profile.edits.join(" · ")}`);
  lines.push(
    "- 위는 **말투**일 뿐입니다. 이 항목의 지침(문장 수·인사말 금지·시작어 규칙 등)이 말투보다 우선하고, '이번 알림장의 결' 지시가 있으면 첫 문장을 여는 자리는 그것을 따르세요. [입력]의 사실은 하나도 빼거나 더하지 말고, 맞춤법·띄어쓰기는 표준으로(표본의 오탈자는 따라 쓰지 않습니다).",
  );
  return lines.join("\n");
}

/** 학습 추세에 붙는 지침의 머리 — 배선 가드가 이 글자를 찾는다. */
export const MENT_STYLE_TONE_HEAD = "[이 선생님의 말투 — 어조만 따라 쓰기]";

/**
 * 학습 추세에 붙는 **어조만** 지침(2026-10-16 원장 *"한계를 수정할 수 있을까"* — 추세엔 말투가 안 붙던 것).
 * 🔴 표현·마무리·쓰지 않는 표현은 싣지 않는다 — 선생님 표현("다음 시간에 마무리하겠습니다")을 추세가 따라 쓰면 추세 금지(계획·전망)에
 *    걸려 문장째 버려진다. 어조(존댓말 결)와 문장 리듬만 옮긴다.
 */
export function mentStyleToneDirective(profile: MentStyleProfile): string {
  return [
    MENT_STYLE_TONE_HEAD,
    `- 어조: ${profile.tone}`,
    `- 문장: ${profile.sentence}`,
    "- 어조·문장 결만 따르세요. 이 항목의 [쓰지 않는 것]·[기록] 규칙이 말투보다 우선하고, [기록]에 없는 말은 덧붙이지 마세요.",
  ].join("\n");
}
