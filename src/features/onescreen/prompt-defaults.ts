/**
 * AI 멘트 프롬프트 — 기본값(SSOT) + mustache 치환. edutrix config/prompts.ts + interpolatePrompt 이식.
 * 프로덕션은 ai_prompt_overrides(DB) 활성값이 이 기본을 덮음(server/prompt-loader.ts). 여기 기본만 순수 정의.
 * 빌더(report-comment.ts·trend-comment.ts)가 `interpolate(active ?? DEFAULT_PROMPTS[type], vars)`로 최종 조립.
 * ⚠️ 이 파일은 클라이언트 번들에도 실릴 수 있으니 서버 전용 import 금지(순수 문자열·함수만).
 */

// 4b: comment(단일 멘트)·trend(학습 추세). 4c에서 comment_p1/comment_p2(공지 모드 B) 추가 예정.
export const PROMPT_TYPES = ["comment", "trend"] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

export const PROMPT_TYPE_LABELS: Record<PromptType, string> = {
  comment: "학부모 멘트",
  trend: "학습 추세(종합분석)",
};

/** {{key}} → vars[key]. 없는 키는 빈 문자열. edutrix interpolatePrompt 대응. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (k in vars ? vars[k]! : ""));
}

/**
 * 기본 프롬프트 템플릿(활성 오버라이드 없을 때). 변수는 {{facts}}(멘트)·{{historySummary}}(추세) —
 * 빌더가 채워진 사실/기록만 조립해 주입(빈 데이터 창작 방지 가드는 빌더+프롬프트 이중).
 */
export const DEFAULT_PROMPTS: Record<PromptType, string> = {
  comment: [
    "당신은 학원 담임 선생님입니다. 아래 [입력]의 사실만으로 학부모님께 보내는 오늘 수업 알림장을 2~4문장으로 씁니다.",
    "",
    "[반드시]",
    "- [입력]에 있는 사실만 쓰세요. 없는 내용(없는 진도·활동·반응·성취·전망)을 지어내지 마세요.",
    "- 점수 숫자는 [입력] 그대로 정확히 옮기세요. 임의로 바꾸거나 만들지 마세요.",
    "- 수신인은 '학부모님'으로 통칭. 학생 호칭('○○ 학생,')·끝인사·마크다운·불릿·날짜 금지.",
    "- '기대됩니다/잘할 거예요' 같은 전망·격려나 상투적 접속사(또한/특히/그러나) 남발 금지. 담담한 사실 전달.",
    "- 부정적 내용은 완곡하게 쓰되 없는 긍정을 만들지 마세요. [입력]에 없는 항목은 아예 언급하지 마세요.",
    "",
    "[예시]",
    "입력) 오늘 진도: 수학(상) 이차함수 / 확인테스트(오늘 진도 범위): 20문제 중 18개 (지난 회차 대비 ▲3) / 수업 태도: 좋음 / 과제: 완료",
    '출력) {"comment": "오늘은 이차함수 진도를 진행했고, 확인테스트에서 20문제 중 18개를 맞혔습니다. 지난 회차보다 3개 더 맞았으며, 수업 태도도 좋았고 과제도 완료했습니다."}',
    "",
    "[입력]",
    "{{facts}}",
    "",
    '[출력] JSON만 출력: {"comment": "..."} — comment는 한국어 한 단락(줄바꿈 없이). 마크다운 코드블록 금지.',
  ].join("\n"),
  trend: [
    "당신은 학원 담임 선생님입니다. 아래 [기록]의 시험·과제 점수 변화를 학부모님께 한 문단의 자연스러운 문장으로 전합니다.",
    "",
    "[반드시]",
    "- [기록]에 있는 날짜·점수만 쓰세요. 없는 회차·점수·평가·전망을 지어내지 마세요.",
    "- 점수 숫자는 [기록] 그대로 정확히 옮기세요. 'X/Y'는 'Y문제 중 X문제'로 풀어쓰세요.",
    "- 날짜를 나열하거나 줄로 끊지 말고, 점수 변화를 한 문단의 이어지는 문장(3~4문장)으로 이야기하세요.",
    "- '만점 가능/기대됩니다' 같은 전망·격려·조언은 넣지 마세요. 오직 점수 변화 사실만.",
    "- 점수가 떨어졌어도 담담히 사실만 전하세요(비난 없이). 수신인 호칭·인사말·마크다운·불릿 금지.",
    "",
    "[예시]",
    "기록) 시험·테스트 점수 흐름(날짜순): [06-01] 일일 6/10 -> [06-08] 일일 8/10 -> [06-15] 일일 9/10",
    '출력) {"trend": "6월 1일 일일테스트에서 10문제 중 6개, 6월 8일 10문제 중 8개, 6월 15일 10문제 중 9개로 점수가 꾸준히 올랐습니다."}',
    "",
    "[기록]",
    "{{historySummary}}",
    "",
    '[출력] JSON만 출력: {"trend": "..."} — trend는 한국어 한 단락(줄바꿈 없이). 마크다운 코드블록 금지.',
  ].join("\n"),
};

/** 프롬프트에 반드시 있어야 하는 변수 placeholder(원장 편집 시 실수로 지우면 입력이 안 들어감 → UI 경고용). */
export const REQUIRED_PLACEHOLDER: Record<PromptType, string> = {
  comment: "{{facts}}",
  trend: "{{historySummary}}",
};
