/**
 * 영어 수업보고서 **기본 템플릿 + 토큰 목록** — 순수 상수(Vitest로 잠금).
 *
 * 사용자 2026-09-10: *"ecs자동이 기본 하나 각 사용자가 정하는 템플릿"* — 기본 템플릿은 코드가 제공하고
 * (ECS 값으로 칸이 자동으로 채워진다), 사용자는 같은 토큰으로 자기 문장을 만든다.
 * 본문은 사용자가 보내 준 EiE 클래스노트 글(부원장 작성분)을 토큰으로 바꾼 것이다.
 *
 * ⚠️ 토큰은 이 목록이 **단일 소스**다 — 편집 화면의 칩·미리보기·채우기 값이 전부 이 키를 쓴다.
 *    키를 바꾸면 사용자가 저장한 템플릿이 "모르는 토큰"이 되어 그 줄이 빠진다(fill.ts 규칙 4).
 *    그래서 **키는 바꾸지 않는다** — 라벨만 바꾼다.
 */

export type TemplateTokenKey = "학생" | "작성자" | "인사말" | "진도" | "테스트" | "숙제" | "다음테스트" | "코멘트";

export type TemplateToken = {
  key: TemplateTokenKey;
  /** 편집 화면 칩에 보이는 이름. */
  label: string;
  /** 값이 어디서 오는가(편집 화면 도움말). */
  source: string;
  /** AI가 쓰는 칸인가. */
  ai?: boolean;
};

export const ENGLISH_TEMPLATE_TOKENS: readonly TemplateToken[] = [
  { key: "학생", label: "학생 이름", source: "학생 이름 — 뒤 조사(이/가·은/는)는 자동으로 맞춘다" },
  { key: "작성자", label: "보내는 사람", source: "보고서를 쓰는 선생님" },
  { key: "인사말", label: "AI 인사말", source: "AI가 오늘 수업 분위기로 한두 문장", ai: true },
  { key: "진도", label: "오늘 진도", source: "원스크린 진도 칸(강사 시트에서 가져온 값)" },
  { key: "테스트", label: "오늘 테스트", source: "원스크린 테스트 칸" },
  { key: "숙제", label: "오늘 숙제", source: "원스크린 오늘 과제 칸" },
  { key: "다음테스트", label: "다음 시간 테스트", source: "다음 시간 테스트 안내 칸" },
  { key: "코멘트", label: "AI 코멘트", source: "AI가 쓰는 학생별 피드백", ai: true },
] as const;

export const ENGLISH_TEMPLATE_TOKEN_KEYS: readonly TemplateTokenKey[] = ENGLISH_TEMPLATE_TOKENS.map((t) => t.key);

/**
 * **꾸밈 토큰** — 값이 있어도 문단을 '내용 있음'으로 만들지 않는다(fill.ts 규칙 3).
 * 🔴 이게 없으면 AI 코멘트가 빈 날 `💌 {작성자} 코멘트 (Feedback)` 머리말만 학부모에게 나간다(적대 리뷰 2026-09-10).
 */
export const TEMPLATE_DECORATION_TOKENS: readonly TemplateTokenKey[] = ["학생", "작성자"];

/** AI가 채우는 토큰 — 템플릿에 이 칸이 하나도 없으면 AI를 부르지 않는다(헛돈 쓰지 않게). */
export const TEMPLATE_AI_TOKENS: readonly TemplateTokenKey[] = ["인사말", "코멘트"];

/** 저장된 템플릿 한 벌. 기본 템플릿은 `builtIn`이고 id가 `builtin:`으로 시작한다(DB 행이 아니다). */
export type ReportTemplate = {
  id: string;
  name: string;
  body: string;
  builtIn: boolean;
};

export const BUILTIN_ENGLISH_TEMPLATE_ID = "builtin:english-ecs";

export const BUILTIN_ENGLISH_TEMPLATE: ReportTemplate = {
  id: BUILTIN_ENGLISH_TEMPLATE_ID,
  name: "ECS 자동 (기본)",
  builtIn: true,
  body: [
    "안녕하세요 학부모님, {작성자}입니다! 😊❤️",
    "",
    "{인사말}",
    "",
    "📍 오늘의 진도",
    "{진도}",
    "테스트 : {테스트}",
    "",
    "📅 오늘의 숙제",
    "{숙제}",
    "",
    "💡 다음 시간 테스트 안내",
    "{다음테스트}",
    "(※ 오늘 재시가 걸린 친구들은 다음 시간 전까지 꼼꼼하게 공부해 올 수 있도록 지도 부탁드립니다!)",
    "",
    "💌 {작성자} 코멘트 (Feedback)",
    "{코멘트}",
  ].join("\n"),
};

/**
 * 사용자 템플릿이 붙는 과목(표준 키). 영어부터 연다 — `english`는 과목 운영 표준 키라(KNOWN_SUBJECT_KEYS)
 * 코드 특수동작이 허용된 자리다(운영 enum 하드코딩 규칙의 예외 범위).
 */
export const TEMPLATE_SUBJECT = "english";

/**
 * 템플릿 관리 창 **미리보기용 예시 값** — 학부모 글은 한국어라 예시도 한국어 그대로 둔다(화면 언어와 무관).
 * `작성자`는 창이 지금 사용자 이름으로 바꿔 끼운다.
 */
export const TEMPLATE_PREVIEW_SAMPLE: Readonly<Record<TemplateTokenKey, string>> = {
  학생: "공서연",
  작성자: "담당 선생님",
  인사말: "(AI가 오늘 수업 분위기를 한두 문장으로 씁니다)",
  진도: "Unit 1~3 핵심 내용 전체 리뷰",
  테스트: "일일 20문제 중 18개 맞음",
  숙제: "Work Book : p.30~33 풀어오기",
  다음테스트: "단어 시험 : 71~80번",
  코멘트: "(AI가 학생 이름을 넣어 오늘의 피드백을 씁니다)",
};

/** 템플릿 본문 상한 — ClassNote 공지 본문 4,000자 fail-closed 선례(notice-actions)와 같은 값. */
export const TEMPLATE_BODY_MAX = 4000;
/** 템플릿 이름 상한. */
export const TEMPLATE_NAME_MAX = 40;
