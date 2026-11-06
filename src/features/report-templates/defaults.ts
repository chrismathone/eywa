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
import { IMAGE_SLOT_KEYS, imageSlotMarker, type ImageSlotKey } from "./image-slots";
import { monthlyEvalMarker } from "./monthly-eval";
import { monthlyActivityMarker } from "./monthly-activity";

export type TemplateTokenKey =
  | "학생"
  | "작성자"
  | "인사말"
  | "진도"
  | "테스트"
  | "숙제"
  | "다음테스트"
  | "코멘트"
  | SheetTokenKey
  | ImageSlotKey
  // EiE 월간 보고서 점수 자리(2026-11-05) — 값은 점수를 담은 한 줄(monthly-eval.ts). 그 달 Monthly Test 점수가 없으면 빈 값.
  | "월간평가"
  // EiE 월간 보고서 한 달 기록 자리(2026-11-06) — 값은 그 달 숙제·태도·단어 테스트를 담은 한 줄(monthly-activity.ts). 기록이 없으면 빈 값.
  | "월간학습";

/**
 * **항목 칸**(원장 2026-10-26 *"수학보고서 디자인을 영어보고서에도 적용"*) — 수학 새 보고서와 **같은 문장**을 영어 칸 값으로 만든 것.
 * 값은 원스크린이 수학 조각(math-report-pilot-sections.ts)으로 만들어 넘긴다(english-sheet.ts) — 여기는 이름만 안다.
 */
export type SheetTokenKey =
  | "출결"
  | "수업평가"
  | "태도평가"
  | "일일테스트"
  | "확인테스트"
  | "수업태도"
  | "숙제완성도"
  | "오늘의숙제"
  | "한마디"
  // EiE 일일 보고서(원장 2026-11-06) — 단어 테스트(일일 테스트 문장 + 재시험 표시) · 강사가 적은 단어 테스트 피드백.
  | "단어테스트"
  | "단어피드백";

export const SHEET_TOKEN_KEYS: readonly SheetTokenKey[] = ["출결", "수업평가", "태도평가", "일일테스트", "확인테스트", "수업태도", "숙제완성도", "오늘의숙제", "한마디", "단어테스트", "단어피드백"];

export type TemplateToken = {
  key: TemplateTokenKey;
  /** 편집 화면 칩에 보이는 이름. */
  label: string;
  /** 값이 어디서 오는가(편집 화면 도움말). */
  source: string;
  /** AI가 쓰는 칸인가. */
  ai?: boolean;
  /**
   * 그림 칸(2026-09-11) — 값은 글이 아니라 **자리 표식**(`[시험결과지]`)이고, 학부모 카드가 그 줄 자리에 인재원 그림을
   * 그린다(image-slots.ts). 자료가 없으면 빈 값이라 그 줄·문단이 빠진다(fill.ts 규칙 2·3 그대로).
   */
  image?: boolean;
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
  { key: "출결", label: "출결", source: "출석부의 출석·지각·조퇴·공결(+ 사유)을 문장으로 — 출결 기록이 없으면 줄이 빠진다" },
  { key: "수업평가", label: "수업 평가 표", source: "수업 태도·숙제 완성도를 하~상 눈금 표로" },
  // JJ 수업보고서(원장 2026-10-27 *"숙제완성도도 필요없음"*) — 같은 표에서 숙제 줄을 뺀 것. 숙제 칸을 안 쓰는 반이 '숙제 없음'을 적지 않게.
  { key: "태도평가", label: "수업 평가 표(태도만)", source: "수업 태도를 하~상 눈금 표로(숙제 완성도 줄 없음)" },
  { key: "일일테스트", label: "일일 테스트 문장", source: "점수 + 한마디. 시험이 없으면 '보지 않았습니다'" },
  { key: "확인테스트", label: "확인 테스트 문장", source: "점수 + 한마디. 없으면 줄이 빠진다" },
  { key: "수업태도", label: "수업 태도 문장", source: "원스크린 태도 칸을 문장으로" },
  { key: "숙제완성도", label: "숙제 완성도 문장", source: "지난 과제 수행률을 문장으로. 숙제가 없었으면 '없었습니다'" },
  { key: "오늘의숙제", label: "오늘의 숙제(없음 포함)", source: "오늘 과제 칸. 비면 '오늘은 숙제가 없습니다'" },
  { key: "한마디", label: "사랑의 한마디", source: "원스크린 특이사항 칸 원문 그대로" },
  {
    key: "시험결과지",
    label: "시험 결과지(그림)",
    source: "그날 본 인재원 단어 시험 결과지 — 저장할 때 인재원에서 받아 이 줄 자리에 그린다. 시험이 없으면 줄이 빠진다",
    image: true,
  },
  {
    key: "학습분석지",
    label: "학습 분석지(그림)",
    source: "인재원 30일 학습 분석지 — 저장할 때 인재원에서 받아 이 줄 자리에 그린다. 학습 기록이 없으면 줄이 빠진다",
    image: true,
  },
  {
    key: "단어백분위",
    label: "단어 백분위(그림)",
    source: "인재원 누적 단어·장기기억 단어 수와 학년·반 백분위(기본모드 기준) — 인재원이 순위를 안 주면 줄이 빠진다",
    image: true,
  },
  {
    key: "학습배지",
    label: "학습 배지(그림)",
    source: "인재원 학습 레벨 배지(통과한 학년 과정) — 아직 배지가 없으면 줄이 빠진다. 빼려면 이 줄을 지운다",
    image: true,
  },
  {
    key: "월간평가",
    label: "Monthly Test 점수(그래프·표)",
    source: "성적관리 영어 Monthly Test의 쓰기·말하기·읽기·듣기 점수와 반 평균 — 그 달 점수가 없으면 줄이 빠진다",
    image: true,
  },
  {
    key: "월간학습",
    label: "한 달 학습 기록(그래프·표)",
    source: "그 달 일일 보고서의 숙제 완성도·수업 태도·단어 테스트(재시험 포함) — EiE 반만, 기록이 없으면 줄이 빠진다",
    image: true,
  },
  { key: "단어테스트", label: "단어 테스트 문장", source: "일일 테스트 점수 + 한마디. 재시험을 체크하면 '재시험' 표시가 붙는다" },
  { key: "단어피드백", label: "단어 테스트 피드백", source: "원스크린 '단어 테스트 피드백' 칸 원문. 비면 줄이 빠진다" },
] as const;

export const ENGLISH_TEMPLATE_TOKEN_KEYS: readonly TemplateTokenKey[] = ENGLISH_TEMPLATE_TOKENS.map((t) => t.key);

/**
 * **꾸밈 토큰** — 값이 있어도 문단을 '내용 있음'으로 만들지 않는다(fill.ts 규칙 3).
 * 🔴 이게 없으면 AI 코멘트가 빈 날 `💌 {작성자} 코멘트 (Feedback)` 머리말만 학부모에게 나간다(적대 리뷰 2026-09-10).
 */
export const TEMPLATE_DECORATION_TOKENS: readonly TemplateTokenKey[] = ["학생", "작성자"];

/** AI가 채우는 토큰 — 템플릿에 이 칸이 하나도 없으면 AI를 부르지 않는다(헛돈 쓰지 않게). */
export const TEMPLATE_AI_TOKENS: readonly TemplateTokenKey[] = ["인사말", "코멘트"];

/** 그림 칸 — 템플릿에 하나라도 있으면 자동작성·다시 채우기가 인재원 자료를 먼저 받는다. */
export const TEMPLATE_IMAGE_TOKENS: readonly TemplateTokenKey[] = IMAGE_SLOT_KEYS;

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

export const BUILTIN_ENGLISH_JJ_TEMPLATE_ID = "builtin:english-ecs-jj";

/**
 * 기본 템플릿 **+ 인재원 그림 두 장**(2026-09-11) — 원래 기본 템플릿은 글자 하나 바꾸지 않고(쓰던 글·지문이 안 흔들리게)
 * 그림이 들어간 두 번째 기본 템플릿을 둔다. 그림 칸은 **문단 하나에 혼자** 선다 — 자료가 없는 날 그 문단째 빠진다.
 */
export const BUILTIN_ENGLISH_JJ_TEMPLATE: ReportTemplate = {
  id: BUILTIN_ENGLISH_JJ_TEMPLATE_ID,
  name: "ECS 자동 + 인재원 결과지",
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
    "{시험결과지}",
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
    "",
    "{학습분석지}",
  ].join("\n"),
};

export const BUILTIN_ENGLISH_SHEET_TEMPLATE_ID = "builtin:english-sheet";

/**
 * **수학과 같은 항목 보고서**(원장 2026-10-26 *"우리 지금 수학보고서 디자인을 영어보고서에도 적용"* → *"수학과 같은 칸 + 영어 칸"*).
 * 글이 `■ 제목` 항목으로 나뉘어 학부모 카드가 수학과 같은 표(PilotReportSheet)로 그린다(parent-report-card.tsx).
 * 순서 = 수업 평가 → 진도 → 출결 → 일일·확인 테스트 → 수업 태도 → 숙제 완성도 → 오늘의 수업(AI) → 오늘의 숙제 → 다음 테스트 →
 * 인재원 결과지(그림) → 사랑의 한마디. 이해도 점수는 영어에 없다(그래서 '수업 평가' 표는 태도·숙제 두 줄).
 * 🔴 항목 제목은 수학 `PILOT_SECTION_TITLES`와 **글자까지 같아야** 카드가 그 항목으로 알아본다(테스트가 잠근다 — english-sheet.test.ts).
 * 🔑 항목 머리(`■ …`)는 칸과 **같은 문단**에 둔다 — 칸이 비면 문단째 빠져 머리만 남지 않는다(fill.ts 규칙 3).
 */
export const BUILTIN_ENGLISH_SHEET_TEMPLATE: ReportTemplate = {
  id: BUILTIN_ENGLISH_SHEET_TEMPLATE_ID,
  name: "영어 보고서", // 원장 2026-11-06 이름만 바꿈(옛 이름 '수학과 같은 항목 보고서 (기본)') — id·본문 그대로
  builtIn: true,
  body: [
    "■ 수업 평가",
    "{수업평가}",
    "",
    "■ 진도",
    "{진도}",
    "",
    "■ 출결",
    "{출결}",
    "",
    "■ 일일 테스트",
    "{일일테스트}",
    "",
    "■ 확인 테스트",
    "{확인테스트}",
    "",
    "■ 수업 태도",
    "{수업태도}",
    "",
    "■ 숙제 완성도",
    "{숙제완성도}",
    "",
    "■ 오늘의 수업",
    "{인사말}",
    "{코멘트}",
    "",
    "■ 오늘의 숙제",
    "{오늘의숙제}",
    "",
    "■ 다음 테스트",
    "{다음테스트}",
    "",
    "■ 인재원 결과지",
    "{시험결과지}",
    "{학습분석지}",
    "",
    "■ 사랑의 한마디",
    "{한마디}",
  ].join("\n"),
};

export const BUILTIN_JJ_SHEET_TEMPLATE_ID = "builtin:english-jj-sheet";

/**
 * **JJ 수업보고서**(원장 2026-10-26 *"jj(영어) 양식 추가 · 기존 srs 디자인 밑에 하고 위에 [수학 보고서 표] 넣고 밑에 srs 사진"*).
 * 위 = 수학 보고서와 같은 표 머리(로고·제목·날짜·반·담임 → 수업 평가(태도)) → 사랑의 한마디, 아래 = SRS(인재원) 결과지·학습 분석지.
 * 그리는 길은 항목 보고서와 **같다**(parent-report-card → PilotReportSheet — 테스트·수업 평가는 표 머리로, 그림 항목은 TemplateBody로).
 * 🔴 항목 제목('수업 평가'·'사랑의 한마디')은 수학 `PILOT_SECTION_TITLES`와 글자까지 같아야 표 머리로 올라간다.
 * 🔑 인재원 자료가 없는 날은 그림 항목이 통째로 빠진다(카드가 그림만 든 항목을 거른다 — 빈 띠를 그리지 않는다).
 */
export const BUILTIN_JJ_SHEET_TEMPLATE: ReportTemplate = {
  id: BUILTIN_JJ_SHEET_TEMPLATE_ID,
  name: "SRS 보고서",
  builtIn: true,
  // 원장 2026-10-27: *"일일테스트 영역 삭제 · 숙제완성도도 필요없음 · 수업태도 밑에 사랑의 한마디 배치해서 작성가능하도록 ·
  // 작성안하면 영역 삭제"* — 수업 평가 표는 태도 한 줄({태도평가}), 사랑의 한마디는 그 바로 아래 항목(특이사항 칸 원문).
  // 🔑 한마디가 비면 문단째 빠진다(fill.ts 규칙 3). 🔴 맨 끝 항목이 아니라 카드가 '맨 아래로' 옮기지 않는다(splitPilotNote) — 의도다.
  body: [
    "■ 수업 평가",
    "{태도평가}",
    "",
    "■ 사랑의 한마디",
    "{한마디}",
    "",
    // 단어 순위·학습 배지(원장 2026-10-26) — 인재원이 순위·배지를 줄 때만 선다. 빼려면 그 줄을 지운다(그림 자리 줄 규약).
    "■ 단어 학습 현황",
    "{학습배지}",
    "{단어백분위}",
    "",
    "■ SRS 학습 결과",
    "{시험결과지}",
    "{학습분석지}",
  ].join("\n"),
};

export const BUILTIN_EIE_DAILY_TEMPLATE_ID = "builtin:eie-daily";

/**
 * **EiE 일일 보고서**(원장 2026-11-05 *"eie는 … 월간 보고서와 일일보고서 두가지 종류로 … 일일보고서는 수학 일일보고서 디자인으로
 * 하나 만들어줘"*). 수학 보고서와 같은 표(PilotReportSheet)로 그린다 — 항목 제목은 수학 `PILOT_SECTION_TITLES`와 글자까지 같다.
 * 항목 보고서(기본)에서 인재원 결과지를 뺀 모양이다(EiE 반은 인재원 단어 시험을 보지 않는다).
 */
export const BUILTIN_EIE_DAILY_TEMPLATE: ReportTemplate = {
  id: BUILTIN_EIE_DAILY_TEMPLATE_ID,
  name: "EiE 일일 보고서",
  builtIn: true,
  body: [
    "■ 수업 평가",
    "{수업평가}",
    "",
    "■ 진도",
    "{진도}",
    "",
    "■ 출결",
    "{출결}",
    "",
    // 원장 2026-11-06 *"일일테스트 -> 단어테스트 이름변경 · 재시험이면 단어테스트 옆에 재시험 마크"* — 같은 표 머리 칸(PILOT_ALIAS_TITLES).
    "■ 단어 테스트",
    "{단어테스트}",
    "",
    "■ 확인 테스트",
    "{확인테스트}",
    "",
    "■ 수업 태도",
    "{수업태도}",
    "",
    "■ 숙제 완성도",
    "{숙제완성도}",
    "",
    "■ 오늘의 수업",
    "{인사말}",
    "{코멘트}",
    "",
    "■ 오늘의 숙제",
    "{오늘의숙제}",
    "",
    // 원장 2026-11-06 *"오늘의 숙제 다음에 단어테스트 피드백 및 다음시간에 칠 단어테스트 범위안내 영역 추가"* — 비면 항목째 빠진다.
    "■ 단어 테스트 피드백",
    "{단어피드백}",
    "",
    "■ 다음 단어 테스트 범위",
    "{다음테스트}",
    "",
    "■ 사랑의 한마디",
    "{한마디}",
  ].join("\n"),
};

export const BUILTIN_EIE_MONTHLY_TEMPLATE_ID = "builtin:eie-monthly";

/**
 * **EiE 월간 보고서**(원장 2026-11-05 *"월간 보고서 디자인은 해당 시트로 동일하게"*) — 시트(Monthly Evaluation Report) 모양.
 * 첫 줄 = Monthly Test 점수 자리(카드가 그래프·표로 그린다), 그 아래 글 = Teacher's Comment(원스크린 특이사항 칸 원문).
 * 🔑 학부모 카드는 이 점수 줄이 든 영어 글을 시트 모양으로 그린다(parent-report-card.tsx). 그 달 점수가 없으면 줄이 빠져 예전 카드다.
 * 🔑 코멘트가 비면 점수 줄만 남아 '빈 멘트'로 발송이 막힌다(image-slots.ts `hasTextBesidesMarkers`) — Teacher's Comment 없이 나가지 않는다.
 */
export const BUILTIN_EIE_MONTHLY_TEMPLATE: ReportTemplate = {
  id: BUILTIN_EIE_MONTHLY_TEMPLATE_ID,
  name: "EiE 월간 보고서",
  builtIn: true,
  // 한 달 기록(원장 2026-11-06 *"해당 달에 쌓은 데이터 가지고 그래프나 도표로 숙제완성도, 수업태도, 단어테스트 통계"*)은 점수 아래.
  body: ["{월간평가}", "", "{월간학습}", "", "{한마디}"].join("\n"),
};

/**
 * 영어 행의 **기본 템플릿**(템플릿을 고르지 않은 행) — 2026-10-26부터 항목 보고서다. 옛 'ECS 자동'은 목록에 남아 고를 수 있다
 * (글자 하나 안 바꿨다 — 그 템플릿으로 쓴 글·지문이 흔들리지 않게).
 */
export const DEFAULT_ENGLISH_TEMPLATE: ReportTemplate = BUILTIN_ENGLISH_SHEET_TEMPLATE;

/** 기본 템플릿 전부(목록 맨 앞 순서 — 기본이 맨 앞). 목록을 못 받아도 이것들은 언제나 고를 수 있다(findTemplateIn). */
export const BUILTIN_ENGLISH_TEMPLATES: readonly ReportTemplate[] = [
  BUILTIN_ENGLISH_SHEET_TEMPLATE,
  BUILTIN_ENGLISH_TEMPLATE,
  BUILTIN_ENGLISH_JJ_TEMPLATE,
  BUILTIN_JJ_SHEET_TEMPLATE,
  // EiE 두 종류(2026-11-05) — 뒤에 붙인다(앞 템플릿들의 자리·기본은 그대로).
  BUILTIN_EIE_DAILY_TEMPLATE,
  BUILTIN_EIE_MONTHLY_TEMPLATE,
];

/**
 * 고르는 목록에서 **숨긴** 기본 템플릿(원장 2026-11-06 *"ecs 자동 · ecs 자동 + 인재원 결과지를 템플릿에서 일단 숨김"*).
 * 🔑 지우지 않는다 — 이미 이 템플릿으로 쓴 행은 그대로 찾아 그리고(findTemplateIn은 BUILTIN_ENGLISH_TEMPLATES 전체),
 *    지금 그 템플릿이 걸린 행의 드롭다운에는 그 하나만 남는다. 새로 고르는 목록·관리 창·계정의 마지막 선택에서만 빠진다.
 *    다시 열려면 이 목록에서 id를 뺀다.
 */
export const HIDDEN_BUILTIN_TEMPLATE_IDS: ReadonlySet<string> = new Set([BUILTIN_ENGLISH_TEMPLATE_ID, BUILTIN_ENGLISH_JJ_TEMPLATE_ID]);

export function isHiddenBuiltinTemplate(id: string | null | undefined): boolean {
  return !!id && HIDDEN_BUILTIN_TEMPLATE_IDS.has(id);
}

/** 기본 템플릿 이름의 화면 문구 키(teacher-view/i18n.ts) — 기본 템플릿 이름은 화면 언어를 따른다. */
export function builtinTemplateLabelKey(
  id: string,
):
  | "os.tpl.builtinName"
  | "os.tpl.builtinJjName"
  | "os.tpl.builtinSheetName"
  | "os.tpl.builtinJjSheetName"
  | "os.tpl.builtinEieDailyName"
  | "os.tpl.builtinEieMonthlyName" {
  if (id === BUILTIN_EIE_DAILY_TEMPLATE_ID) return "os.tpl.builtinEieDailyName";
  if (id === BUILTIN_EIE_MONTHLY_TEMPLATE_ID) return "os.tpl.builtinEieMonthlyName";
  if (id === BUILTIN_ENGLISH_SHEET_TEMPLATE_ID) return "os.tpl.builtinSheetName";
  if (id === BUILTIN_JJ_SHEET_TEMPLATE_ID) return "os.tpl.builtinJjSheetName";
  return id === BUILTIN_ENGLISH_JJ_TEMPLATE_ID ? "os.tpl.builtinJjName" : "os.tpl.builtinName";
}

/**
 * 사용자 템플릿이 붙는 과목(표준 키). 영어부터 연다 — `english`는 과목 운영 표준 키라(KNOWN_SUBJECT_KEYS)
 * 코드 특수동작이 허용된 자리다(운영 enum 하드코딩 규칙의 예외 범위).
 */
export const TEMPLATE_SUBJECT = "english";

/**
 * 템플릿 관리 창 **미리보기용 예시 값** — 학부모 글은 한국어라 예시도 한국어 그대로 둔다(화면 언어와 무관).
 * `작성자`는 창이 지금 사용자 이름으로 바꿔 끼운다. 그림 칸은 자리 표식 그대로(미리보기가 자리 상자로 그린다).
 */
export const TEMPLATE_PREVIEW_SAMPLE: Readonly<Record<TemplateTokenKey, string>> = {
  학생: "홍길동",
  작성자: "담당 선생님",
  인사말: "(AI가 오늘 수업 분위기를 한두 문장으로 씁니다)",
  진도: "Unit 1~3 핵심 내용 전체 리뷰",
  테스트: "일일 20문제 중 18개 맞음",
  숙제: "Work Book : p.30~33 풀어오기",
  다음테스트: "단어 시험 : 71~80번",
  코멘트: "(AI가 학생 이름을 넣어 오늘의 피드백을 씁니다)",
  출결: "오늘은 조금 늦게 도착했습니다(사유: 병원 진료).",
  수업평가: "(수업 태도·숙제 완성도를 하~상 눈금 표로 그립니다)",
  태도평가: "(수업 태도를 하~상 눈금 표로 그립니다)",
  일일테스트: "20문제 중 18개 맞음\n대부분 잘 맞혔습니다. 틀린 문제는 다음 시간에 다시 짚고 넘어가겠습니다.",
  확인테스트: "",
  수업태도: "오늘 수업 태도가 좋았습니다. 수업에 성실하게 잘 참여했습니다.",
  숙제완성도: "지난 시간 과제를 빠짐없이 모두 해 왔습니다. 성실하게 잘 해 왔습니다.",
  오늘의숙제: "Work Book : p.30~33 풀어오기",
  한마디: "오늘도 끝까지 집중해 줘서 고마웠어요!",
  단어테스트: "[재시험]\n20문제 중 18개 맞음\n대부분 잘 맞혔습니다. 틀린 문제는 다음 시간에 다시 짚고 넘어가겠습니다.",
  단어피드백: "철자를 헷갈린 단어 2개는 다음 시간 전까지 다시 외워 오도록 지도하겠습니다.",
  시험결과지: imageSlotMarker("시험결과지"),
  학습분석지: imageSlotMarker("학습분석지"),
  단어백분위: imageSlotMarker("단어백분위"),
  학습배지: imageSlotMarker("학습배지"),
  월간평가: monthlyEvalMarker({
    month: "2026-10",
    areaMax: 100,
    areas: {
      writing: { score: 70, average: 95 },
      speaking: { score: 90, average: 97 },
      reading: { score: 80, average: 96 },
      listening: { score: 90, average: 96 },
    },
  }),
  월간학습: monthlyActivityMarker({
    month: "2026-10",
    lessons: [
      { date: "2026-10-06", homework: 100, attitude: "상", word: { right: 18, total: 20 }, retest: false },
      { date: "2026-10-08", homework: 80, attitude: "중상", word: { right: 12, total: 20 }, retest: true },
      { date: "2026-10-13", homework: 100, attitude: "상", word: { right: 19, total: 20 }, retest: false },
      { date: "2026-10-15", homework: 90, attitude: "중상", word: { right: 20, total: 20 }, retest: false },
    ],
  }),
};

/** 템플릿 본문 상한 — ClassNote 공지 본문 4,000자 fail-closed 선례(notice-actions)와 같은 값. */
export const TEMPLATE_BODY_MAX = 4000;
/** 템플릿 이름 상한. */
export const TEMPLATE_NAME_MAX = 40;
