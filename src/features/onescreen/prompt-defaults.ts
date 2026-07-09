/**
 * AI 멘트 프롬프트 — 기본값(SSOT) + mustache 치환 + 출력계약 조립. edutrix config/prompts.ts 이식.
 * 프로덕션은 ai_prompt_overrides(DB) 활성값이 이 기본을 덮음(server/prompt-loader.ts).
 *
 * 설계: 각 프롬프트는 "본문"(지침 + {{자리표시자}})만 정의하고, **출력 JSON 계약은 코드가 붙인다**.
 *  - 단일 호출/미리보기: assembleSingle(body, type) — 그 항목 하나만 {"comment"|"trend"} 출력.
 *  - 통합 1회 호출: assembleCombined(sections) — 멘트·추세(·P1·P2)를 한 번에 {comment,trend,…} 출력(비용·지연↓).
 * 원장은 본문만 편집(출력 계약은 자동). ⚠️ 이 파일은 클라 번들에도 실릴 수 있어 서버 전용 import 금지.
 */

// comment(단일 멘트·모드 A)·trend(학습 추세)·comment_p1/p2(공지 모드 B 2문단).
export const PROMPT_TYPES = ["comment", "trend", "comment_p1", "comment_p2"] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

/**
 * 멘트/추세 생성 AI 후보정 — edutrix solar.ts 이식(Solar Pro 3 전용 튜닝).
 * temperature 0.3 = 사실 서술 일관성(창작·변동 억제). reasoning_effort "minimal" = 추론 과정이 본문에
 * 섞이는 것 방지. generateJSON에 opt-in으로 전달(전역 기본 미변경 — 타 도메인은 그대로).
 */
export const MENT_AI_TUNING = { temperature: 0.3, reasoningEffort: "minimal" } as const;

export const PROMPT_TYPE_LABELS: Record<PromptType, string> = {
  comment: "학부모 멘트 (모드 A·단일)",
  trend: "학습 추세(종합분석)",
  comment_p1: "공지 모드 B · 수업 내용(P1)",
  comment_p2: "공지 모드 B · 태도·특이사항(P2)",
};

/** 통합 프롬프트 섹션 제목. */
const SECTION_LABEL: Record<PromptType, string> = {
  comment: "학부모 멘트",
  trend: "학습 추세",
  comment_p1: "수업 내용",
  comment_p2: "태도·특이사항",
};

/** 단일 호출 시 출력 JSON 필드(미리보기·개별 테스트). P1/P2도 단독일 땐 comment로 받는다. */
const SINGLE_FIELD: Record<PromptType, "comment" | "trend"> = {
  comment: "comment",
  trend: "trend",
  comment_p1: "comment",
  comment_p2: "comment",
};

/** {{key}} → vars[key]. 없는 키는 빈 문자열. edutrix interpolatePrompt 대응. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (k in vars ? vars[k]! : ""));
}

/**
 * 기본 프롬프트 "본문"(지침 + 자리표시자). 출력 JSON 계약은 assembleSingle/Combined가 붙인다.
 * 변수: {{facts}}(멘트)·{{historySummary}}(추세)·{{p1facts}}·{{p2facts}} — 빌더가 채워진 사실만 주입.
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
    "예) 오늘은 이차함수 진도를 진행했고, 확인테스트에서 20문제 중 18개를 맞혔습니다. 지난 회차보다 3개 더 맞았으며, 수업 태도도 좋았고 과제도 완료했습니다.",
    "",
    "[입력]",
    "{{facts}}",
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
    "예) 6월 1일 일일테스트에서 10문제 중 6개, 6월 8일 10문제 중 8개, 6월 15일 10문제 중 9개로 점수가 꾸준히 올랐습니다.",
    "",
    "[기록]",
    "{{historySummary}}",
  ].join("\n"),
  comment_p1: [
    '당신은 학원 담임 선생님입니다. 학부모님께 보내는 알림장의 "첫 문단(오늘 수업 내용)"을 씁니다.',
    "[입력]에 있는 사실만 그대로 문장으로 옮깁니다. 오늘 배운 교재·진도와 과제 외에는 아무것도 쓰지 않습니다.",
    "",
    "[반드시]",
    "- [입력]에 적힌 것만 쓰세요. 없는 페이지·활동·반응·성취·평가를 지어내거나 언급하지 마세요.",
    "- 전망·기대·조언·격려('잘할 거예요/기대됩니다')를 덧붙이지 마세요. 오직 사실 서술만.",
    "- '과제'는 집에서 할 숙제입니다. \"과제를 풀었다\"로 쓰지 말고, 마지막 문장 \"오늘 과제는 ~입니다.\"에서만 언급하세요.",
    "- 학생 태도·칭찬은 여기 쓰지 마세요(둘째 문단 담당). 날짜형식·마크다운·불릿·끝인사·학생 호칭 금지.",
    "",
    "[예시]",
    "입력) 교재: 개념원리 중2-1 / 진도: 일차함수의 그래프 / 과제: 워크북 P32까지",
    "예) 오늘은 개념원리 중2-1 교재로 일차함수의 그래프를 학습했습니다. 오늘 과제는 워크북 P32까지입니다.",
    "",
    "[입력]",
    "{{p1facts}}",
  ].join("\n"),
  comment_p2: [
    '당신은 학원 담임 선생님입니다. 알림장의 "둘째 문단(태도·특이사항)"을 씁니다. 첫 문단 뒤에 이어지니 인사·날짜·호칭 없이 본론부터 씁니다.',
    "[입력]의 태도·특이사항에 적힌 사실만 그대로 옮깁니다. 적히지 않은 것은 아예 언급하지 마세요.",
    "",
    "[반드시]",
    "- 적힌 것만 쓰세요. 회복·재참여·미래·성취·평가·증상·이유 등 [입력]에 없는 내용을 지어내지 마세요.",
    "- 적히지 않은 항목은 침묵하세요(예: '조퇴'만 있고 증상이 없으면 조퇴 사실만 담담히).",
    "- 전망·조언·격려 금지. 진도·교재·과제 언급 금지(첫 문단 담당).",
    "- 경고·지시 문구는 부드러운 권유로 바꾸되 사실은 유지. 없는 긍정을 만들지 마세요. 학생 호칭·마크다운·불릿 금지.",
    "",
    "[예시]",
    "입력) 태도: 좋음 / 특이사항: 개념이 어려워 연습문제로 한 번 더 확인 후 하원",
    "예) 오늘 수업에 성실히 참여했습니다. 개념이 다소 어려운 부분은 연습문제로 한 번 더 확인한 뒤 마무리했습니다.",
    "",
    "[입력]",
    "{{p2facts}}",
  ].join("\n"),
};

/** 프롬프트에 반드시 있어야 하는 변수 placeholder(원장 편집 시 실수로 지우면 입력이 안 들어감 → UI 경고용). */
export const REQUIRED_PLACEHOLDER: Record<PromptType, string> = {
  comment: "{{facts}}",
  trend: "{{historySummary}}",
  comment_p1: "{{p1facts}}",
  comment_p2: "{{p2facts}}",
};

/** 단일 항목 출력 계약 부착(미리보기·개별 테스트용). 그 항목 하나만 JSON으로 출력. */
export function assembleSingle(body: string, type: PromptType): string {
  const field = SINGLE_FIELD[type];
  return `${body}\n\n[출력] JSON만 출력: {"${field}": "..."} — ${field}는 한국어 한 단락(줄바꿈 없이). 마크다운 코드블록 금지.`;
}

/** 통합 프롬프트 섹션 — 실행 시점에 활성 본문들을 하나로 묶어 1회 호출. field=최종 JSON 키(comment/p1/p2/trend). */
export type PromptSection = { type: PromptType; field: string; body: string };

/** 여러 항목을 한 번의 호출로 — 각 항목 본문을 섹션으로 묶고, 지정 필드들을 담은 JSON 하나만 출력하게 한다. */
export function assembleCombined(sections: PromptSection[]): string {
  const blocks = sections
    .map((s, i) => `=== 항목 ${i + 1}: ${SECTION_LABEL[s.type]} ("${s.field}") ===\n${s.body}`)
    .join("\n\n");
  const shape = sections.map((s) => `"${s.field}": "..."`).join(", ");
  return [
    "당신은 학원 담임 선생님입니다. 아래 각 항목의 지침을 지켜 학부모 알림장 항목을 각각 작성합니다.",
    "각 항목은 그 항목의 [입력]/[기록]에 있는 사실만 사용하세요(항목끼리 내용을 섞지 마세요).",
    "",
    blocks,
    "",
    `[최종 출력] 위 각 항목을 담아 아래 JSON 하나만 출력하세요(마크다운·코드블록 금지): {${shape}}`,
    "각 값은 한국어 한 단락(줄바꿈 없이). 해당 항목에 쓸 사실이 없으면 그 값은 빈 문자열 \"\".",
  ].join("\n");
}
