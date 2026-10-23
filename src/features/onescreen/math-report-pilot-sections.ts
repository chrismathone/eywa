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

import { attitudeClause } from "./attitude";
import { parseHomeworkRate } from "./homework-rate";
import { activeUnderstanding, PILOT_SECTION_TITLES as T, pilotSection, understandingSig } from "./math-report-pilot";
import { buildReportCommentInput } from "./report-comment";
import type { OneScreenStudent } from "./types";

/** 일일 테스트를 안 친 사유 — 선택지 순서 = 화면 순서. 라벨은 화면 사전(`os.card.testSkip.*`)이 단다. */
export const TEST_SKIP_REASONS = ["sick", "slow", "parent", "teacher", "other"] as const;
export type TestSkipReason = (typeof TEST_SKIP_REASONS)[number];

/** 일일 테스트 '없음' 상태 — 사유 + 강사가 덧붙인 말(선택, '기타'면 필수). 세션 `subject_progress`에 실린다. */
export type DailyTestSkip = { reason: TestSkipReason | null; detail: string };

/** 사유 → 학부모 문장. 🔴 아이를 탓하는 말은 쓰지 않는다('이해도가 느려서' → 개념을 더 다지는 데 시간을 썼다). */
const SKIP_SENTENCE: Record<TestSkipReason, string> = {
  sick: "오늘은 몸이 좋지 않아 일일 테스트를 보지 않았습니다.",
  slow: "오늘은 개념을 조금 더 다지는 데 시간을 써서 일일 테스트를 보지 않았습니다.",
  parent: "오늘은 어머님의 요청으로 일일 테스트를 보지 않았습니다.",
  teacher: "오늘은 수업 상황을 보고 일일 테스트를 다음 시간으로 미뤘습니다.",
  other: "오늘은 일일 테스트를 보지 않았습니다.",
};

/** 보충 시험 약속이 붙는 사유 — 원장 지시 *"이해도가 느리거나, 선생님이 봤을 때 시험을 칠 수 없다고 판단되는 경우"*. */
export const MAKEUP_TEST_REASONS: readonly TestSkipReason[] = ["slow", "teacher"];
export const MAKEUP_TEST_PROMISE = "다음 시간에 보충해서 시험을 칠 수 있도록 하겠습니다.";

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
export function testSkipText(skip: DailyTestSkip): string {
  if (!skip.reason) return "";
  const parts = [SKIP_SENTENCE[skip.reason], skip.detail.trim()];
  if (MAKEUP_TEST_REASONS.includes(skip.reason)) parts.push(MAKEUP_TEST_PROMISE);
  return parts.filter(Boolean).join(" ");
}

/** 점수 줄에서 지난 회차 비교 꼬리를 뗀다 — 표기는 "N문제 중 M개 맞음" 하나(결정 로그 2026-08-11). */
function scoreOnly(line: string): string {
  return line.replace(/\s*\(지난 회차[^)]*\)\s*$/, "").trim();
}

/**
 * 점수 줄 뒤에 붙는 한두 문장 — 원장 2026-10-23 *"너무 짧고 이상함 사람이 쓴거처럼 좀 부풀려서"*.
 * 점수 표기("N문제 중 M개 맞음")는 그대로 두고(결정 로그 2026-08-11) 아래 줄에 말을 덧붙인다. 못 맞힌 몫은 학원이 챙긴다는 어투.
 */
export function scoreRemark(line: string): string {
  const m = line.match(/(\d+)문제 중 (\d+)개 맞음/);
  if (!m) return "";
  const total = Number(m[1]);
  const right = Number(m[2]);
  if (!total || right > total) return "";
  if (right === total) return "한 문제도 놓치지 않고 모두 맞혔습니다. 정말 잘했습니다! 다음 시간에도 지금처럼 이어 갈 수 있도록 응원하겠습니다.";
  const r = right / total;
  if (r >= 0.8) return "대부분의 문제를 잘 맞혔습니다. 틀린 문제는 다음 시간에 한 번 더 짚어 확실히 익히도록 챙기겠습니다.";
  if (r >= 0.5) return "절반 넘게 맞혔습니다. 틀린 문제는 다음 시간에 다시 풀어 보며 확실히 이해할 수 있도록 꼼꼼히 챙기겠습니다.";
  return "아직 어려워한 문제가 있었습니다. 틀린 문제는 다음 시간에 처음부터 함께 다시 짚어 보며 확실히 챙기겠습니다.";
}

/** 점수 줄 + 덧붙인 말. 점수가 없으면 "". */
function scoreText(line: string): string {
  const score = scoreOnly(line);
  if (!score) return "";
  return [score, scoreRemark(score)].filter(Boolean).join("\n");
}

/** 수업 태도 5단 → 학부모 문단. 고른 정도만 옮기고, 낮은 쪽은 학원이 챙긴다는 어투로 맺는다. 옛 값은 예전 조각 그대로. */
const ATTITUDE_TEXT: Record<string, string> = {
  "매우 좋음": "오늘 수업 태도가 매우 좋았습니다. 처음부터 끝까지 성실하게 수업에 참여해 주어 많이 칭찬해 주고 싶습니다.",
  좋음: "오늘 수업 태도가 좋았습니다. 지금처럼 꾸준히 이어 갈 수 있도록 옆에서 계속 응원하겠습니다.",
  보통: "오늘 수업 태도는 보통이었습니다. 수업에 조금 더 집중할 수 있도록 학원에서도 함께 신경 쓰겠습니다.",
  안좋음: "오늘은 수업 태도가 좋지 않았습니다. 다음 시간에는 더 집중해서 참여할 수 있도록 학원에서 잘 살피고 챙기겠습니다.",
  "매우 안좋음":
    "오늘은 수업 태도가 많이 좋지 않았습니다. 다음 시간에는 수업에 잘 집중할 수 있도록 학원에서 더 세심하게 살피고 챙기겠습니다.",
};

export function attitudeText(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  return ATTITUDE_TEXT[s] ?? `오늘 수업 태도는 ${attitudeClause(s)}.`;
}

/** 지난 과제 수행률 → 문단. 고른 값을 옮기고, 덜 해 온 몫은 아이를 탓하지 않고 학원이 챙긴다는 말로 맺는다. */
export function homeworkSentence(v: string): string {
  const s = v.trim();
  if (!s || s === "—") return "";
  if (s === "없음") return "지난 시간에 내준 과제는 없었습니다.";
  // 0%는 미제출과 같은 문장 — "0% 해 왔습니다"는 어색하다.
  if (s === "미제출" || parseHomeworkRate(s) === 0) return "지난 과제는 아직 해 오지 못했습니다. 다음 시간에 학원에서 함께 확인하며 꼭 마무리할 수 있도록 챙기겠습니다.";
  const n = parseHomeworkRate(s);
  if (n == null) return s;
  if (n >= 100) return "지난 시간에 내준 과제를 빠짐없이 모두 해 왔습니다. 스스로 끝까지 챙겨 온 점이 정말 대견합니다.";
  const head = `지난 시간에 내준 과제를 ${n}% 해 왔습니다.`;
  if (n >= 90) return `${head} 거의 다 해 온 만큼 성실하게 잘 챙겨 주었습니다. 남은 부분도 마저 마무리할 수 있도록 함께 확인하겠습니다.`;
  if (n >= 50) return `${head} 다 하지 못한 부분은 다음 시간에 함께 확인해서 끝까지 마무리할 수 있도록 챙기겠습니다.`;
  return `${head} 아직 다 하지 못한 부분은 다음 시간에 학원에서 함께 확인하며 꼼꼼히 챙기겠습니다.`;
}

/** 항목 글의 재료 — 원스크린이 AI에 주는 값(ReportCommentInput)과 같은 모양. */
export type PilotFacts = {
  progress?: string;
  dailyTest: string;
  dailyTestSkip?: DailyTestSkip | null;
  checkTest: string;
  attitude: string;
  homework: string;
  homeworkToday: string;
  videoHomework?: boolean;
  videoHomeworkDue?: string;
  /** 소단원별 이해도(뺀 것 제외) — 평가표 '이해도' 줄의 재료. */
  understanding?: readonly { title: string; score: number }[];
};

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

/** 평가표 본문 — 표 모양(머리 줄 + 항목 줄, 고른 칸에 ●). 값이 있는 줄만, 하나도 없으면 "" (항목째 빠진다). */
export function levelTableText(f: Pick<PilotFacts, "attitude" | "homework" | "understanding">): string {
  const rows: [string, Level | null][] = [
    [T.attitude, attitudeLevel(f.attitude)],
    [T.homework, homeworkLevel(f.homework)],
    [T.understanding, understandingLevel(f.understanding)],
  ];
  const filled = rows.filter((r): r is [string, Level] => r[1] != null);
  if (!filled.length) return "";
  const w = Math.max(2, ...filled.map(([l]) => [...l].length));
  const head = padFw("구분", w) + LEVELS.map((lv) => FW + padFw(lv, 2)).join("");
  const lines = filled.map(([l, v]) => padFw(l, w) + LEVELS.map((lv) => FW + (lv === v ? "●" : "○") + FW).join("") + v);
  return [head.replace(/\u3000+$/, ""), ...lines].join("\n");
}

/** 맨 위 '수업 평가' 항목 — 원장 2026-10-23 *"진도보다 위에 표 형태로"*. 진도 항목 앞에 붙는다(actions.ts composePilot). */
export function pilotLevelsSection(f: Pick<PilotFacts, "attitude" | "homework" | "understanding">): string {
  return pilotSection(T.levels, levelTableText(f));
}

/**
 * 진도 항목과 선생님 한마디 사이의 항목들 — 일일 테스트 → 확인 테스트 → 수업 태도 → 과제 수행률 → 이해도 → 오늘 과제.
 * (수업 평가 표는 맨 위 — `pilotLevelsSection`.)
 * 값이 없는 항목은 통째로 뺀다. `understandingText`는 AI가 쓴 이해도 글, `videoReceipt`는 지난 영상 숙제 확인 문장.
 */
export function pilotBody(f: PilotFacts, extra: { understandingText?: string; videoReceipt?: string | null }): string {
  const daily = f.dailyTestSkip ? testSkipText(f.dailyTestSkip) : scoreText(f.dailyTest);
  const hw = [homeworkSentence(f.homework), extra.videoReceipt?.trim() ?? ""].filter(Boolean).join(" ");
  const video = f.videoHomework === true ? `영상 숙제가 있습니다${f.videoHomeworkDue ? `(${f.videoHomeworkDue} 제출)` : ""}.` : "";
  const todayHw = f.homeworkToday.trim();
  const today = todayHw || video
    ? [todayHw ? `오늘 내준 과제는 아래와 같습니다.\n${todayHw}` : "", video, "다음 시간에 잘 해 왔는지 함께 확인하겠습니다."]
        .filter(Boolean)
        .join("\n")
    : "";
  return [
    pilotSection(T.daily, daily),
    pilotSection(T.check, scoreText(f.checkTest)),
    pilotSection(T.attitude, attitudeText(f.attitude)),
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
    f.dailyTestSkip ? ["skip", f.dailyTestSkip.reason, f.dailyTestSkip.detail.trim()] : scoreOnly(f.dailyTest),
    scoreOnly(f.checkTest),
    f.attitude.trim(),
    f.homework.trim(),
    f.homeworkToday.trim(),
    f.videoHomework === true,
    understandingSig(understanding),
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
    { ...buildReportCommentInput(student, idx), dailyTestSkip: su.dailyTestSkip ?? null },
    activeUnderstanding(su.today, su.understanding),
  );
}
