/**
 * **수학 보고서 시범 — 항목별 글**(원장 2026-10-22). 순수 모듈(Vitest). 시범 대상 판정·조립 뼈대는 [math-report-pilot.ts](./math-report-pilot.ts).
 *
 * 원장 지시: *"일일테스트 이해도 등 텍스트로 우르르 들어가는 게 아닌 섹션을 나눠서 어떤 것에 어떤 답인지 볼 수 있게"*
 *   + *"일일테스트는 시험 있음/없음으로 구분 · 없으면 없는 사유를 기입 후 보고서에 적용 · 이해도가 느리거나 선생님이 봤을 때
 *     시험을 칠 수 없다고 판단되는 경우 다음 시간 보충해서 시험 칠 수 있도록 하겠다는 멘트"*.
 *
 * 🔑 AI는 **이해도 항목만** 쓴다. 테스트·태도·과제는 강사가 고른 값을 코드가 그대로 옮긴다 — 항목마다 무엇에 대한 답인지가
 *    분명해야 하고, 테스트를 못 친 사유처럼 **꼭 들어가야 하는 문장**은 모델에 맡기면 빠질 수 있다.
 */

import { asProgressMode } from "./progress-mode";
import { attitudeClause } from "./attitude";
import { parseHomeworkRate } from "./homework-rate";
import { asVariety, pickVariant, type Variety } from "./ment-variants";
import { activeUnderstanding, PILOT_SECTION_TITLES as T, pilotSection, understandingSig } from "./math-report-pilot";
import { buildReportCommentInput } from "./report-comment";
import type { OneScreenStudent } from "./types";

/** 일일 테스트를 안 친 사유 — 선택지 순서 = 화면 순서. 라벨은 화면 사전(`os.card.testSkip.*`)이 단다. */
export const TEST_SKIP_REASONS = ["sick", "slow", "parent", "teacher", "other"] as const;
export type TestSkipReason = (typeof TEST_SKIP_REASONS)[number];

/** 일일 테스트 '없음' 상태 — 사유 + 강사가 덧붙인 말(선택, '기타'면 필수). 세션 `subject_progress`에 실린다. */
export type DailyTestSkip = { reason: TestSkipReason | null; detail: string };

/**
 * 사유 → 학부모 문장. 🔴 아이를 탓하는 말은 쓰지 않는다('이해도가 느려서' → 개념을 더 다지는 데 시간을 썼다).
 * 갈래가 여럿이다(원장 2026-10-26 매크로성 반복 금지, ment-variants.ts) — 첫 갈래가 종전 문장이다.
 */
const SKIP_SENTENCE: Record<TestSkipReason, readonly string[]> = {
  sick: [
    "오늘은 몸이 좋지 않아 일일 테스트를 보지 않았습니다.",
    "오늘은 컨디션이 좋지 않아 일일 테스트는 쉬어 갔습니다.",
    "몸이 좀 불편해 보여서 오늘 일일 테스트는 보지 않았습니다.",
  ],
  slow: [
    "오늘은 개념을 조금 더 다지는 데 시간을 써서 일일 테스트를 보지 않았습니다.",
    "오늘은 개념을 한 번 더 다지는 데 수업 시간을 써서 일일 테스트는 보지 않았습니다.",
    "오늘은 시험보다 개념 정리에 시간을 더 들여 일일 테스트는 다음으로 넘겼습니다.",
  ],
  parent: [
    "오늘은 어머님의 요청으로 일일 테스트를 보지 않았습니다.",
    "오늘은 가정에서 요청해 주셔서 일일 테스트를 보지 않았습니다.",
  ],
  teacher: [
    "오늘은 수업 상황을 보고 일일 테스트를 다음 시간으로 미뤘습니다.",
    "오늘은 수업 흐름을 보고 일일 테스트를 다음 시간으로 옮겼습니다.",
    "오늘 수업 진행 상황상 일일 테스트는 다음 시간에 보기로 했습니다.",
  ],
  other: [
    "오늘은 일일 테스트를 보지 않았습니다.",
    "오늘은 일일 테스트 없이 수업을 진행했습니다.",
  ],
};

/** 보충 시험 약속이 붙는 사유 — 원장 지시 *"이해도가 느리거나, 선생님이 봤을 때 시험을 칠 수 없다고 판단되는 경우"*. */
export const MAKEUP_TEST_REASONS: readonly TestSkipReason[] = ["slow", "teacher"];
export const MAKEUP_TEST_PROMISE = "다음 시간에 보충해서 시험을 칠 수 있도록 하겠습니다.";
/** 보충 시험 약속의 갈래 — 첫 갈래 = MAKEUP_TEST_PROMISE. */
export const MAKEUP_TEST_PROMISES: readonly string[] = [
  MAKEUP_TEST_PROMISE,
  "다음 시간에 보충 시험으로 꼭 확인하겠습니다.",
  "놓친 시험은 다음 시간에 보충해서 볼 수 있도록 챙기겠습니다.",
];

const DETAIL_MAX = 200;

/** 세션에서 읽은 값(모양을 믿지 않는다) → 상태. 없으면 null(= 시험 있음). */
export function readTestSkip(raw: unknown): DailyTestSkip | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { reason?: unknown; detail?: unknown };
  const reason = TEST_SKIP_REASONS.includes(r.reason as TestSkipReason) ? (r.reason as TestSkipReason) : null;
  const detail = typeof r.detail === "string" ? r.detail.replace(/\s*\n+\s*/g, " ").slice(0, DETAIL_MAX) : "";
  return { reason, detail };
}

/** 사유를 다 적었나 — 사유를 골랐고, '기타'면 덧붙인 말까지 있어야 한다(발송 게이트). */
export function testSkipComplete(skip: DailyTestSkip | null | undefined): boolean {
  if (!skip) return true;
  if (!skip.reason) return false;
  return skip.reason !== "other" || skip.detail.trim() !== "";
}

/** '없음'일 때 일일 테스트 항목 글 — 사유 문장 → 덧붙인 말(원문) → (해당 사유면) 보충 시험 약속. */
export function testSkipText(skip: DailyTestSkip, variety?: Variety | null): string {
  if (!skip.reason) return "";
  const parts = [pickVariant(SKIP_SENTENCE[skip.reason], asVariety(variety), `skip:${skip.reason}`), skip.detail.trim()];
  if (MAKEUP_TEST_REASONS.includes(skip.reason)) parts.push(pickVariant(MAKEUP_TEST_PROMISES, asVariety(variety), "skip:promise"));
  return parts.filter(Boolean).join(" ");
}

/** 점수 줄에서 지난 회차 비교 꼬리를 뗀다 — 표기는 "N문제 중 M개 맞음" 하나(결정 로그 2026-08-11). */
function scoreOnly(line: string): string {
  return line.replace(/\s*\(지난 회차[^)]*\)\s*$/, "").trim();
}

/**
 * 점수 줄 뒤에 붙는 한두 문장 — 원장 2026-10-23 *"너무 짧고 이상함 사람이 쓴거처럼 좀 부풀려서"*.
 * 점수 표기("N문제 중 M개 맞음")는 그대로 두고(결정 로그 2026-08-11) 아래 줄에 말을 덧붙인다. 못 맞힌 몫은 학원이 챙긴다는 어투.
 * 원장 2026-10-23 *"많이 칭찬해주고싶습니다 라는 워딩이 사람이 안쓰는워딩"* — 선생님이 실제로 쓰는 짧은 말로(꾸밈 감탄·다짐 남발 금지).
 */
/** 점수 한마디의 갈래(첫 갈래 = 종전 문장) — 매크로성 반복 금지(원장 2026-10-26). */
export const SCORE_REMARKS = {
  perfect: [
    "한 문제도 틀리지 않고 모두 맞혔습니다. 아주 잘했습니다.",
    "모든 문제를 정확하게 맞혔습니다. 오늘 배운 내용을 잘 익혔습니다.",
    "틀린 문제 없이 전부 맞혔습니다. 깔끔하게 잘 풀었습니다.",
  ],
  high: [
    "대부분 잘 맞혔습니다. 틀린 문제는 다음 시간에 다시 짚고 넘어가겠습니다.",
    "거의 다 맞혔습니다. 놓친 문제는 다음 시간에 한 번 더 확인하겠습니다.",
    "실수 몇 개를 빼면 잘 풀었습니다. 틀린 부분은 다음 시간에 꼭 다시 보겠습니다.",
  ],
  mid: [
    "절반 이상 맞혔습니다. 틀린 문제는 다음 시간에 다시 풀어 보며 정리하겠습니다.",
    "절반 넘게 맞혔습니다. 틀린 문제는 다음 시간에 함께 다시 풀어 보겠습니다.",
    "맞힌 문제가 더 많았습니다. 헷갈린 문제는 다음 시간에 하나씩 다시 정리하겠습니다.",
  ],
  low: [
    "아직 어려워하는 문제가 있었습니다. 틀린 문제는 다음 시간에 하나씩 다시 짚고 넘어가겠습니다.",
    "아직 손에 익지 않은 문제가 있었습니다. 다음 시간에 틀린 문제를 차근차근 다시 풀어 보겠습니다.",
    "어려워한 문제가 몇 개 있었습니다. 다음 시간에 하나씩 같이 짚으며 확실히 챙기겠습니다.",
  ],
} as const;

/** 점수 줄 뒤 한마디. 갈래는 `variety`로 고른다(없으면 첫 갈래 = 종전 문장). */
export function scoreRemark(line: string, variety?: Variety | null): string {
  const m = line.match(/(\d+)문제 중 (\d+)개 맞음/);
  if (!m) return "";
  const total = Number(m[1]);
  const right = Number(m[2]);
  if (!total || right > total) return "";
  const r = right / total;
  const band = right === total ? "perfect" : r >= 0.8 ? "high" : r >= 0.5 ? "mid" : "low";
  return pickVariant(SCORE_REMARKS[band], asVariety(variety), `score:${band}`);
}

/** 점수 줄 + 덧붙인 말. 점수가 없으면 "". `family`는 일일·확인 테스트가 같은 날 같은 한마디를 쓰지 않게 가른다. */
export function scoreText(line: string, variety?: Variety | null, family = ""): string {
  const score = scoreOnly(line);
  if (!score) return "";
  const v = asVariety(variety);
  return [score, scoreRemark(score, v ? { ...v, seed: `${v.seed}${family}` } : null)].filter(Boolean).join("\n");
}

/** 수업 태도 5단 → 학부모 문단. 고른 정도만 옮기고, 낮은 쪽은 학원이 챙긴다는 어투로 맺는다. 옛 값은 예전 조각 그대로. */
const ATTITUDE_TEXT: Record<string, string> = {
  "매우 좋음": "오늘 수업 태도가 매우 좋았습니다. 처음부터 끝까지 집중해서 성실하게 참여했습니다.",
  좋음: "오늘 수업 태도가 좋았습니다. 수업에 성실하게 잘 참여했습니다.",
  보통: "오늘 수업 태도는 보통이었습니다. 수업에 더 집중할 수 있도록 옆에서 잘 이끌겠습니다.",
  안좋음: "오늘은 수업 태도가 좋지 않았습니다. 다음 시간에는 더 집중할 수 있도록 잘 지도하겠습니다.",
  "매우 안좋음":
    "오늘은 수업 태도가 많이 좋지 않았습니다. 다음 시간에는 수업에 집중할 수 있도록 더 신경 써서 지도하겠습니다.",
};

export function attitudeText(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  return ATTITUDE_TEXT[s] ?? `오늘 수업 태도는 ${attitudeClause(s)}.`;
}

/**
 * **새 수학 보고서의 수업 태도**(원장 2026-10-26) — *"상, 중상, 중일때는 따로 문구가 들어가지 않음 · 하, 중하 일때는 수업태도 부분을
 * 강사가 직접 작성 하도록 (3줄이상)"*. 정도는 '수업 평가' 표가 이미 말하므로 좋은 쪽은 항목을 비운다. 낮은 쪽은 정해진 문장 대신
 * 강사가 적은 '수업 태도 의견' 원문을 그대로 싣는다. 옛 자유입력 값(5단 밖)은 예전 문장 그대로.
 * ⚠️ 영어 항목 보고서는 이 규칙 밖이다(`attitudeText` 그대로 — english-sheet.ts).
 */
const ATTITUDE_SILENT = new Set(["매우 좋음", "좋음", "보통"]);
const ATTITUDE_LOW = new Set(["안좋음", "매우 안좋음"]);

/** 강사가 직접 적어야 하는 태도인가(하·중하). */
export function attitudeNeedsNote(raw: string | null | undefined): boolean {
  return ATTITUDE_LOW.has((raw ?? "").trim());
}

/** '3줄 이상' — 빈 줄을 뺀 3줄 이상, 또는 한 줄로 길게 쓴 경우 90자 이상. */
export const ATTITUDE_NOTE_MIN_LINES = 3;
export const ATTITUDE_NOTE_MIN_CHARS = 90;
const ATTITUDE_NOTE_MAX = 1000;

export function attitudeNoteComplete(note: string | null | undefined): boolean {
  const t = (note ?? "").trim();
  if (!t) return false;
  const lines = t.split("\n").filter((l) => l.trim() !== "").length;
  return lines >= ATTITUDE_NOTE_MIN_LINES || t.replace(/\s+/g, " ").length >= ATTITUDE_NOTE_MIN_CHARS;
}

/** 하·중하인데 의견이 모자라나(발송 게이트). 그 밖의 태도면 false. */
export function needsAttitudeNote(attitude: string | null | undefined, note: string | null | undefined): boolean {
  return attitudeNeedsNote(attitude) && !attitudeNoteComplete(note);
}

/** 세션에서 읽은 태도 의견(모양을 믿지 않는다) — 줄바꿈은 지키고(3줄 판정) 길이만 자른다. 문자열이 아니면 "". */
export function readAttitudeNote(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").slice(0, ATTITUDE_NOTE_MAX) : "";
}

/** 새 수학 보고서 '수업 태도' 항목 글 — 좋은 쪽은 "", 낮은 쪽은 강사 원문, 옛 값은 예전 문장. */
export function pilotAttitudeText(raw: string, note?: string | null): string {
  const s = raw.trim();
  if (!s || ATTITUDE_SILENT.has(s)) return "";
  if (ATTITUDE_LOW.has(s)) return (note ?? "").trim();
  return attitudeText(s);
}

/** 숙제를 안 해 왔나 — '미제출' 또는 0%(같은 문장을 쓴다). 이때 사유를 적어야 보낸다(원장 2026-10-23 *"미제출일경우 사유작성"*). */
export function isHomeworkMissed(v: string | null | undefined): boolean {
  const s = (v ?? "").trim();
  return s === "미제출" || parseHomeworkRate(s) === 0;
}

const MISS_REASON_MAX = 200;

/** 세션에서 읽은 미제출 사유(모양을 믿지 않는다) — 한 줄로 접고 길이를 자른다. 문자열이 아니면 "". */
export function readHomeworkMissReason(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s*\n+\s*/g, " ").slice(0, MISS_REASON_MAX) : "";
}

/** 세션에서 읽은 보강 사유(2026-10-26) — 한 줄로 접고 길이를 자른다(출결 문장 괄호 안에 들어간다). 문자열이 아니면 "". */
export function readMakeupReason(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s*\n+\s*/g, " ").slice(0, MISS_REASON_MAX) : "";
}

/** 미제출인데 사유가 비었나(발송 게이트). 미제출이 아니면 false. */
export function needsHomeworkMissReason(homework: string | null | undefined, reason: string | null | undefined): boolean {
  return isHomeworkMissed(homework) && (reason ?? "").trim() === "";
}

/** 사유 원문을 문장으로 — 끝에 마침표가 없으면 붙인다(강사가 '감기' 처럼 짧게 적어도 문장 사이에 끼워진다). */
function asSentence(text: string): string {
  const t = text.trim();
  return !t || /[.!?。]$/.test(t) ? t : `${t}.`;
}

/**
 * 숙제 완성도(지난 과제 수행률) → 문단. 고른 값을 옮기고, 덜 해 온 몫은 아이를 탓하지 않고 학원이 챙긴다는 말로 맺는다.
 * 미제출이면 강사가 적은 사유(`missReason`)를 두 문장 사이에 그대로 넣는다.
 */
export function homeworkSentence(v: string, missReason?: string | null, variety?: Variety | null): string {
  const s = v.trim();
  if (!s || s === "—") return "";
  // 과제가 없던 날은 항목째 뺀다(원장 2026-10-23 *"미제출이면 미제출 사유가 들어가야하고 없으면 숙제완성도는 없어야"*) — 수업 평가 표 줄도 같이 빠진다(homeworkLevel).
  if (s === "없음") return "";
  // 0%는 미제출과 같은 문장 — "0% 해 왔습니다"는 어색하다.
  if (isHomeworkMissed(s))
    // typeof — `.map(homeworkSentence)`처럼 두 번째 인자에 숫자가 들어와도 깨지지 않게.
    return ["지난 시간 과제를 아직 해 오지 못했습니다.", asSentence(typeof missReason === "string" ? missReason : ""), "다음 시간에 함께 확인하고 꼭 마무리하도록 하겠습니다."]
      .filter(Boolean)
      .join(" ");
  const n = parseHomeworkRate(s);
  if (n == null) return s;
  // 갈래(원장 2026-10-26 매크로성 반복 금지) — 첫 갈래 = 종전 문장. 수행률 숫자는 갈래와 무관하게 그대로 싣는다.
  const vv = asVariety(variety);
  if (n >= 100) return pickVariant(HOMEWORK_FULL, vv, "hw:full");
  const head = `지난 시간 과제를 ${n}% 해 왔습니다.`;
  const band = n >= 90 ? "near" : n >= 50 ? "half" : "low";
  return `${head} ${pickVariant(HOMEWORK_TAIL[band], vv, `hw:${band}`)}`;
}

/** 숙제 완성도 갈래 — 다 해 온 날(첫 갈래 = 종전 문장). */
export const HOMEWORK_FULL: readonly string[] = [
  "지난 시간 과제를 빠짐없이 모두 해 왔습니다. 성실하게 잘 해 왔습니다.",
  "지난 시간 과제를 하나도 빠뜨리지 않고 다 해 왔습니다. 꾸준히 잘하고 있습니다.",
  "지난 시간 과제를 끝까지 모두 마쳐 왔습니다. 성실한 모습이 좋았습니다.",
];
/** 숙제 완성도 갈래 — 덜 해 온 날(수행률 문장 뒤에 붙는다, 첫 갈래 = 종전 문장). */
export const HOMEWORK_TAIL = {
  near: [
    "거의 다 해 왔고, 남은 부분은 수업 시간에 함께 확인하겠습니다.",
    "조금 남은 부분은 수업 시간에 같이 확인하고 마무리하겠습니다.",
    "대부분 해 왔고, 못 한 부분은 수업에서 함께 채우겠습니다.",
  ],
  half: [
    "다 하지 못한 부분은 다음 시간에 함께 확인하고 마무리하겠습니다.",
    "남은 부분은 다음 시간에 같이 점검하며 끝까지 마치도록 하겠습니다.",
    "못 다한 부분은 다음 수업에서 함께 확인해 마무리하겠습니다.",
  ],
  low: [
    "남은 부분은 다음 시간에 수업에서 함께 확인하며 꼭 마무리하겠습니다.",
    "남은 과제는 다음 시간에 하나씩 같이 확인하며 꼭 마치도록 챙기겠습니다.",
    "못 한 부분은 다음 수업에서 차근차근 함께 마무리하겠습니다.",
  ],
} as const;

/** 항목 글의 재료 — 원스크린이 AI에 주는 값(ReportCommentInput)과 같은 모양. */
export type PilotFacts = {
  progress?: string;
  /** 진도 칸의 복습·문제풀이 — 진도 첫 문장이 이 값으로 갈린다(원장 2026-10-26). */
  progressMode?: string | null;
  dailyTest: string;
  dailyTestSkip?: DailyTestSkip | null;
  checkTest: string;
  attitude: string;
  homework: string;
  /** 숙제 미제출 사유(시범 행, 강사 원문) — 미제출일 때만 글에 들어간다. */
  homeworkMissReason?: string;
  /** 수업 태도 의견(강사 원문) — 태도가 하·중하일 때만 '수업 태도' 항목에 그대로 들어간다(2026-10-26). */
  attitudeNote?: string;
  homeworkToday: string;
  /** 교재명 — 오늘의 숙제가 쪽수뿐이면 앞에 붙인다(homeworkTodayLine, 2026-10-26). */
  textbook?: string;
  videoHomework?: boolean;
  videoHomeworkDue?: string;
  /** 소단원별 이해도(뺀 것 제외) — 평가표 '이해도' 줄의 재료. */
  understanding?: readonly { title: string; score: number }[];
  /** 그날 출결 문장(attendance-sentence.ts) — 지각·조퇴·공결일 때만 값이 있다. */
  attendance?: string;
};

/**
 * 비어도 항목을 지우지 않는다(원장 2026-10-26 *"시험없고 숙제없으면 영역 사라지지말고 금일 테스트 안봤다 숙제없습니다 등으로 알려줘야함"*).
 * 종전(2026-10-23 *"없으면 숙제완성도는 없어야"*)을 뒤집었다 — 항목이 사라지면 학부모는 "안 적은 건지 없었던 건지" 모른다.
 */
export const NO_DAILY_TEST_TEXT = "오늘은 일일 테스트를 보지 않았습니다.";
export const NO_HOMEWORK_TEXT = "지난 시간에 내준 숙제가 없었습니다.";
export const NO_HOMEWORK_TODAY_TEXT = "오늘은 숙제가 없습니다.";
/** 갈래(첫 갈래 = 위 상수) — 매크로성 반복 금지(원장 2026-10-26, ment-variants.ts). */
export const NO_DAILY_TEST_TEXTS: readonly string[] = [NO_DAILY_TEST_TEXT, "오늘은 일일 테스트가 없었습니다.", "오늘 수업에서는 일일 테스트를 따로 보지 않았습니다."];
export const NO_HOMEWORK_TODAY_TEXTS: readonly string[] = [NO_HOMEWORK_TODAY_TEXT, "오늘은 따로 내준 숙제가 없습니다.", "오늘 수업 뒤 숙제는 없습니다."];

/**
 * 평가표 눈금 — 원장 2026-10-22 *"수업태도 과제 수행률, 이해도 상 중 하 해서 표로"*(보내 준 시트 표 = 하·중하·중·중상·상 5칸).
 * 낮은 쪽부터(표의 왼쪽부터).
 */
export const LEVELS = ["하", "중하", "중", "중상", "상"] as const;
export type Level = (typeof LEVELS)[number];

/** 수업 태도 5단 → 눈금. 선택지 그대로 한 칸씩 옮긴다. 옛 값·자유입력은 정도를 몰라 null(줄을 뺀다). */
const ATTITUDE_LEVEL: Record<string, Level> = {
  "매우 좋음": "상",
  좋음: "중상",
  보통: "중",
  안좋음: "중하",
  "매우 안좋음": "하",
};

/**
 * 0~100 → 눈금. 이해도(10점 만점 ×10)·과제 수행률(%)이 같은 경계를 쓴다.
 * 경계는 AI 이해도 지시(8~10 강점 · 5~7 중간 · 4 이하 낮음)와 어긋나지 않게 잡았다 — 글은 '힘들어했다'인데 표가 '중상'이면 모순이다.
 */
export function levelOfPercent(n: number): Level {
  if (n >= 90) return "상";
  if (n >= 75) return "중상";
  if (n >= 50) return "중";
  if (n >= 30) return "중하";
  return "하";
}

export function attitudeLevel(raw: string): Level | null {
  return ATTITUDE_LEVEL[raw.trim()] ?? null;
}

/** 과제 수행률 → 눈금. '미제출'=하, '없음'·빈칸·정도 미상은 null(과제가 없던 날을 '하'로 적지 않는다). */
export function homeworkLevel(raw: string): Level | null {
  const n = parseHomeworkRate(raw);
  return n == null ? null : levelOfPercent(n);
}

/** 이해도 → 눈금. 매긴 소단원 점수의 평균(10점 만점). 없으면 null. */
export function understandingLevel(items: readonly { score: number }[] | undefined): Level | null {
  if (!items?.length) return null;
  const avg = items.reduce((a, i) => a + i.score, 0) / items.length;
  return levelOfPercent(avg * 10);
}

/**
 * 전각 공백 — 한글 한 글자와 폭이 같고 HTML이 접지 않는다(ClassNote 본문은 평문). 그래서 칸을 이걸로 맞춘다.
 * ⚠️ 줄 **앞**에 두지 말 것 — `String.trim()`이 전각 공백까지 지워 첫 줄이 밀린다(그래서 머리 줄은 '구분'으로 시작한다).
 */
const FW = "\u3000";

/** 전각 폭 w칸으로 — 안의 반각 공백도 전각으로 바꾼다(반각은 폭이 반이라 줄이 어긋난다). */
function padFw(text: string, w: number): string {
  const t = text.replace(/ /g, FW);
  return t + FW.repeat(Math.max(0, w - [...t].length));
}

/** 값이 없는 줄의 표기(원장 2026-10-26). */
export const LEVEL_NONE_HOMEWORK = "숙제 없음";
export const LEVEL_NONE = "평가 없음";
/** 값이 없는 줄에서 이름과 표기 사이 기호 — 카드가 이 기호로 '없음' 줄을 알아본다(pilot-notes.ts parseLevelRows). */
export const LEVEL_NONE_SEP = "—";

/** 평가표 본문 — 표 모양(머리 줄 + 항목 줄, 고른 칸에 ●). 값이 없는 줄은 `이름 — 숙제 없음`. 줄이 하나도 없으면 "" (항목째 빠진다). */
export function levelTableText(
  f: Pick<PilotFacts, "attitude" | "understanding"> & Partial<Pick<PilotFacts, "homework">>,
): string {
  // 값이 없는 줄도 지우지 않는다(원장 2026-10-26 *"여기서는 그냥 사라지자나 없다는거 여기서 표시해줘"*) — `이름 — 숙제 없음`.
  //   단 값은 있는데 정도를 모르는 옛 자유입력(예: '완료')은 지어내지 않고 그 줄을 뺀다(종전대로).
  //   이해도 줄은 `understanding`을 넘긴 행(수학)에만 — 영어엔 그 칸이 없다.
  //   숙제 줄은 `homework`를 넘긴 행에만 — JJ 수업보고서는 태도 한 줄이다(원장 2026-10-27 *"숙제완성도도 필요없음"*).
  const rows: [string, string | null][] = [[T.attitude, attitudeLevel(f.attitude) ?? (f.attitude.trim() ? null : LEVEL_NONE)]];
  if (f.homework !== undefined) {
    const hw = f.homework.trim();
    rows.push([T.homework, homeworkLevel(f.homework) ?? (!hw || hw === "없음" || hw === "—" ? LEVEL_NONE_HOMEWORK : null)]);
  }
  // 표의 줄 이름은 짧게 — 항목 제목은 '오늘의 수업'
  if (f.understanding !== undefined) rows.push(["이해도", understandingLevel(f.understanding) ?? LEVEL_NONE]);
  const filled = rows.filter((r): r is [string, string] => r[1] != null);
  if (!filled.length) return "";
  const w = Math.max(2, ...filled.map(([l]) => [...l].length));
  const head = padFw("구분", w) + LEVELS.map((lv) => FW + padFw(lv, 2)).join("");
  const isLevel = (v: string): v is Level => (LEVELS as readonly string[]).includes(v);
  const lines = filled.map(([l, v]) =>
    isLevel(v)
      ? padFw(l, w) + LEVELS.map((lv) => FW + (lv === v ? "●" : "○") + FW).join("") + v
      : `${padFw(l, w)}${FW}${LEVEL_NONE_SEP} ${v}`,
  );
  return [head.replace(/\u3000+$/, ""), ...lines].join("\n");
}

/** 맨 위 '수업 평가' 항목 — 원장 2026-10-23 *"진도보다 위에 표 형태로"*. 진도 항목 앞에 붙는다(actions.ts composePilot). */
export function pilotLevelsSection(f: Pick<PilotFacts, "attitude" | "homework" | "understanding">): string {
  return pilotSection(T.levels, levelTableText(f));
}

/**
 * 진도 항목과 사랑의 한마디 사이의 항목들 — 원장 2026-10-23 순서 *"진도 → 일일테스트 → 수업태도 → 숙제완성도 → 오늘의 수업 →
 * 오늘의 숙제 → 사랑의 한마디"*. 확인 테스트는 일일 테스트 바로 뒤(값이 있을 때만). (수업 평가 표는 맨 위 — `pilotLevelsSection`.)
 * 일일 테스트·오늘의 숙제는 비어도 '없었다'고 적는다(`NO_*_TEXT`, 원장 2026-10-26). 숙제 완성도는 지난 숙제가 없으면 항목째 뺀다 — 수업 평가 표가 이미 '숙제 없음'을 적는다(원장 2026-10-27). 확인 테스트·이해도·출결은 값이 없으면 항목째 뺀다. `understandingText`는 AI가 쓴 이해도 글, `videoReceipt`는 지난 영상 숙제 확인 문장.
 * 오늘의 숙제는 숙제 내용만 적는다 — 원장 2026-10-23 *"오늘 내준 과제 및 다음 시간에 잘 해 왔는지 등 멘트 삭제"*.
 */
/** 쪽수·범위만 적힌 숙제인가 — `153-170p` · `p40-p56` · `128-135p, 140-149p` · `~131p`. 숫자가 하나는 있어야 한다. */
const PAGES_ONLY = /^(?=.*\d)[\dpP쪽.\s\-~–`,]+$/;

/**
 * 오늘의 숙제 한 줄 — 숙제 칸이 **쪽수만**이면 교재명을 앞에 붙인다(원장 2026-10-26 *"같은 교재면 교재 명과 오늘과제랑 잘 조합 시켜서 바로 반영"*).
 * 실측(9월~ 수학 보고서): 숙제 칸의 상당수가 `153-170p`처럼 쪽수뿐이고 그때 책은 교재 칸의 책이다 → "쎈 미적분 153-170p".
 * 🔴 붙이지 않는 경우 — 숙제에 글자가 섞였다(`쎈 25-35p`·`프린트`: 이미 책을 적었거나 다른 자료) · 교재가 여러 권이다(`,`·`/` — 어느 책인지 모른다).
 */
export function homeworkTodayLine(homeworkToday: string, textbook?: string | null): string {
  const hw = homeworkToday.trim();
  const tb = (textbook ?? "").trim();
  if (!hw || !tb || /[,/]/.test(tb) || !PAGES_ONLY.test(hw)) return hw;
  return `${tb} ${hw}`;
}

export function pilotBody(
  f: PilotFacts,
  extra: { understandingText?: string; videoReceipt?: string | null; variety?: Variety | null },
): string {
  const v = extra.variety ?? null;
  const daily =
    (f.dailyTestSkip ? testSkipText(f.dailyTestSkip, v) : scoreText(f.dailyTest, v, ":daily")) ||
    pickVariant(NO_DAILY_TEST_TEXTS, v, "none:daily");
  // 숙제가 없던 날은 항목째 뺀다(원장 2026-10-27 *"숙제가 없으면 위에서 이야기했는데 밑에서도 동일하게 계속 나오는데"*) —
  // 맨 위 수업 평가 표가 같은 조건(levelTableText: 빈칸·'없음'·'—')에서 이미 `숙제 완성도 — 숙제 없음`을 적는다.
  // 🔴 그 표는 이 경우 항상 선다(숙제 줄이 비지 않는다) — 그래서 여기서 빼도 "안 적은 건지 없던 건지"(2026-10-26)는 안 흐려진다.
  // 지난 영상 숙제 확인 문장(videoReceipt)이 있으면 그것만으로 항목을 세운다(표에 없는 사실이다).
  const hw = [homeworkSentence(f.homework, f.homeworkMissReason, v), extra.videoReceipt?.trim() ?? ""].filter(Boolean).join(" ");
  const video = f.videoHomework === true ? `영상 숙제가 있습니다${f.videoHomeworkDue ? `(${f.videoHomeworkDue} 제출)` : ""}.` : "";
  const today = [homeworkTodayLine(f.homeworkToday, f.textbook) || (video ? "" : pickVariant(NO_HOMEWORK_TODAY_TEXTS, v, "none:today")), video]
    .filter(Boolean)
    .join("\n");
  return [
    pilotSection(T.attendance, f.attendance),
    pilotSection(T.daily, daily),
    pilotSection(T.check, scoreText(f.checkTest, v, ":check")),
    pilotSection(T.attitude, pilotAttitudeText(f.attitude, f.attitudeNote)),
    pilotSection(T.homework, hw),
    pilotSection(T.understanding, extra.understandingText),
    pilotSection(T.homeworkToday, today),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 사실 서명 — 자동작성 때 쓴 값과 지금 칸 값이 같은지 대조한다(발송 게이트, isPilotDraftCurrent).
 * 이해도 점수는 글에 숫자로 없어 글만 봐서는 바뀐 줄 모른다 — 그래서 값 자체를 비교한다. 한줄 멘트는 빼 둔다(그 자리에서 바뀐다).
 * ⚠️ 영상 마감 문구는 넣지 않는다 — 날짜를 알아야 만들 수 있어 화면 렌더 시점엔 같은 값을 못 만든다(영상 과제 여부는 넣는다).
 */
export function pilotFactsSig(f: PilotFacts, understanding: readonly { title: string; score: number }[]): string {
  return JSON.stringify([
    f.progress ?? "",
    // 진도 성격(복습·문제풀이) — 값이 있을 때만 서명에 싣는다(안 고른 행의 서명은 예전과 같다).
    ...(asProgressMode(f.progressMode) ? [asProgressMode(f.progressMode)] : []),
    f.dailyTestSkip ? ["skip", f.dailyTestSkip.reason, f.dailyTestSkip.detail.trim()] : scoreOnly(f.dailyTest),
    scoreOnly(f.checkTest),
    // 태도 의견은 하·중하일 때만 글에 들어가므로 그때만 서명에 싣는다(나머지 행의 서명은 예전 그대로 — 자동작성이 풀리지 않게).
    attitudeNeedsNote(f.attitude) ? [f.attitude.trim(), (f.attitudeNote ?? "").trim()] : f.attitude.trim(),
    f.homework.trim(),
    isHomeworkMissed(f.homework) ? (f.homeworkMissReason ?? "").trim() : "",
    homeworkTodayLine(f.homeworkToday, f.textbook), // 교재명을 붙인 줄 — 붙이지 않는 행은 예전 값 그대로(서명이 안 바뀐다)
    f.videoHomework === true,
    understandingSig(understanding),
    // 출결 — 자동작성 뒤 출석부에서 지각·사유를 고치면 글이 옛 출결을 말한다(발송 게이트가 다시 자동작성을 요구해야 한다).
    (f.attendance ?? "").trim(),
  ]);
}

/**
 * 이 행의 사실 서명 — 자동작성할 때와 발송 게이트(카드·표)가 **같은 함수**로 만든다(재료도 같은 `buildReportCommentInput`).
 * 따로 만들면 값이 그대로인데도 서명이 갈라져 "자동작성 입력 필요"가 풀리지 않는다.
 */
export function pilotRowSig(student: OneScreenStudent, subjectName: string): string {
  const idx = student.subjects.findIndex((s) => s.name === subjectName);
  const su = student.subjects[idx];
  if (!su) return "";
  return pilotFactsSig(
    { ...buildReportCommentInput(student, idx), dailyTestSkip: su.dailyTestSkip ?? null, homeworkMissReason: su.homeworkMissReason ?? "", attitudeNote: su.attitudeNote ?? "" },
    activeUnderstanding(su.today, su.understanding),
  );
}
