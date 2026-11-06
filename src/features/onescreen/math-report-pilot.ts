/**
 * **수학 보고서 새 방식 — 테스트 학생 한정 시범**(원장 2026-10-21). 순수 모듈(Vitest).
 *
 * 원장 지시: *"해당 작업은 수학과 테스트 학생이한테만 반영해서 테스트 먼저 진행해보기 위함"* — 범위는 학생 '테스트' 한 명
 * (질문 답 "학생 '테스트' 기준"). 시범 대상 수학 행에서만 아래 다섯 가지가 바뀐다.
 *   1. 수학 보고서(멘트·추세) 칸은 **자동작성 전엔 보기만**, 자동작성 뒤엔 고칠 수 있다(원장 2026-10-23 — 종전 '항상 보기만'을 뒤집음, `pilotCanEdit`).
 *   2. 자동작성을 한 번도 안 한 글은 ClassNote 발송을 막는다(화면 게이트 + 서버 `saveAndQueueClassnote` 이중 — 작성 방식 auto·auto_edited만 통과).
 *   3. 특이사항 자리표시 = 격려 멘트 예시.
 *   4. 소단원(오늘 진도의 차시)별 **이해도 10점 만점** 칸 — 일부를 빼고 남은 것만 자동작성에 쓴다.
 *   5. 자동작성 글 = `{이름}는 오늘 … 진도를 나갔습니다` + 이해도 + AI 본문 + 특이사항(맨 아래 그대로).
 *
 * 🔴 대상은 **id 명단 하나**(`MATH_REPORT_PILOT_STUDENT_IDS`)이고 판정은 `isMathReportPilot` 한 함수다 — 화면·서버가 같은 답을 낸다.
 *    시범이 끝나 전원에게 열 땐 이 명단을 지우고 판정을 과목만 보게 바꾼다(그때 이 주석도 고칠 것).
 */

import { skipStatusOf } from "./progress-status";
import { asProgressMode } from "./progress-mode";
import { asVariety, pickVariant, type Variety } from "./ment-variants";
import { NO_HABITS, type TeacherHabits } from "./teacher-habits";

/**
 * 이 학생·과목 행이 새 수학 보고서 대상인가 — **수학 전원**(원장 2026-10-26 *"수학보고서 디자인 전체로 반영"* → *"지금 바로 전원"*).
 * 시범(2026-10-21~)은 학생 id 명단(테스트·학원이·학원삼)으로 좁혔는데 그 명단을 걷었다. 과목키가 없는 행(데모)은 수학으로 본다(원스크린 관례).
 * 🔴 학생 id가 없으면 false — 학생을 모르는 화면(사무실 직접 작성 등)은 종전 방식 그대로다.
 * ⚠️ 함수 이름·"시범" 표현은 호출부 20곳이 쓰고 있어 그대로 둔다(의미 = '새 수학 보고서').
 */
export function isMathReportPilot(studentId: string | null | undefined, subjectKey: string | null | undefined): boolean {
  if (!studentId) return false;
  return !subjectKey || subjectKey === "math";
}

/** 한글 음절에 받침이 있나 — 한글이 아니면 false(조사 '는/와'로). */
function hasBatchim(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}

/**
 * 학부모 글에서 부르는 이름 + 주제 조사 — "이승엽" → "승엽이는", "김지수" → "지수는".
 * 괄호·공백 뒤 꼬리("홍길동 (테스트)")와 동명이인 구분 글자("김라윤A" — 실측 재원생 497명 중 37명)는 뗀다.
 * 한글 세 글자·두 글자(외자 "이윤" → "윤이는")면 성을 뗀다. 네 글자 이상은 그대로(복성을 추측하지 않는다 — 실측 0명).
 */
export function topicName(fullName: string): string {
  const base = (fullName.replace(/[([].*$/, "").trim().split(/\s+/)[0] ?? "").replace(/[A-Za-z0-9]+$/, "");
  const given = /^[가-힣]{2,3}$/.test(base) ? base.slice(1) : base;
  if (!given) return "";
  return hasBatchim(given.slice(-1)) ? `${given}이는` : `${given}는`;
}

/** 차시 → 학부모에게 보일 소단원 이름. 앞의 단원 번호(`1-1-1 `)는 뗀다(번호만 있으면 그대로). */
export function lessonTitle(lesson: string): string {
  const t = lesson.replace(/^\s*\d+-\d+-\d+\s*/, "").trim();
  return t || lesson.trim();
}

/** 진도칸(개행으로 이은 차시) → 소단원 목록(중복 제거, 순서 유지). */
export function pilotLessons(today: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (today ?? "").split("\n")) {
    const l = raw.trim();
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}

/** 진도 첫 문장 뒤 마무리 갈래(첫 갈래 = 종전 문장) — 매크로성 반복 금지(원장 2026-10-26, ment-variants.ts). */
export const PROGRESS_CLOSES = {
  진도: [
    "오늘 배운 내용이 잘 자리 잡을 수 있도록 다음 시간에도 이어서 꼼꼼히 다지겠습니다.",
    "새로 배운 개념이 헷갈리지 않도록 다음 시간에도 이어서 차근차근 다지겠습니다.",
    "오늘 익힌 내용을 다음 시간에 한 번 더 확인하며 확실히 다지겠습니다.",
  ],
  복습: [
    "앞서 배운 개념을 다시 짚으며 헷갈리던 부분을 정리했고, 다음 시간에도 이어서 꼼꼼히 다지겠습니다.",
    "배웠던 내용을 한 번 더 정리하며 헷갈리던 부분을 바로잡았고, 다음 시간에도 이어서 챙기겠습니다.",
    "이전 개념을 다시 살펴보며 빈틈을 메웠고, 다음 시간에도 계속 확인하겠습니다.",
  ],
  문제풀이: [
    "배운 개념을 문제에 적용해 보며 실력을 다졌고, 틀린 문제는 다음 시간에 다시 짚고 넘어가겠습니다.",
    "여러 문제를 풀어 보며 개념을 적용하는 연습을 했고, 틀린 문제는 다음 시간에 함께 다시 보겠습니다.",
    "개념을 문제에 직접 써 보며 손에 익혔고, 헷갈린 문제는 다음 시간에 다시 정리하겠습니다.",
  ],
} as const;

/**
 * 진도 항목의 **첫 문장**(사실 문장) — 마무리 문장은 갈래가 바뀌어도 이 문장은 그대로다. 자동작성 글이 지금 값과 맞는지는
 * 이 문장으로 대조한다(isPilotDraftCurrent — 마무리까지 대조하면 갈래가 바뀔 때마다 '자동작성 다시 필요'가 뜬다).
 * 원장 지시 *"단원 하나면 하나로 갔다 3개면 어디서 어디까지 나갔다"* — 1개 = 'A' / 2개 = 'A'와 'B', 두 소단원 / 3개+ = 'A'부터 'B'까지.
 * `stopLabel`(월말평가 등 진도 중단일) = 진도 대신 그날 한 일. `mode`(복습·문제풀이, progress-mode.ts) = 그날 수업 성격대로(원장 2026-10-26).
 * 소단원 이름은 따옴표로 묶는다(원장 2026-10-23 — 이름 안의 '의'·'와'가 문장 조사와 섞였다). '우리 ○○이는' = 원장 2026-10-21 친근감.
 */
export function progressLeadHead(
  fullName: string,
  lessons: readonly string[],
  stopLabel?: string | null,
  mode?: string | null,
): string {
  const name = topicName(fullName);
  if (!name) return "";
  const who = `우리 ${name}`;
  if (stopLabel) return `${who} 오늘 ${stopLabel} 수업을 했습니다.`;
  const titles = lessons.map(lessonTitle).filter(Boolean);
  if (titles.length === 0) return "";
  const q = (t: string) => `'${t}'`;
  const [first, second] = titles;
  const span =
    titles.length === 1
      ? q(first!)
      : titles.length === 2
        ? `${q(first!)}${hasBatchim(first!.slice(-1)) ? "과" : "와"} ${q(second!)}, 두 소단원`
        : `${q(first!)}부터 ${q(titles[titles.length - 1]!)}까지 모두 ${titles.length}개 소단원`;
  const kind = asProgressMode(mode);
  if (kind === "복습") return `${who} 오늘 ${span}${titles.length === 1 ? " 내용" : ""}을 복습했습니다.`;
  if (kind === "문제풀이") return `${who} 오늘 ${span}${titles.length === 1 ? "" : "의"} 문제풀이 위주로 수업했습니다.`;
  return `${who} 오늘 ${span} 진도를 나갔습니다.`;
}

export function progressLead(
  fullName: string,
  lessons: readonly string[],
  stopLabel?: string | null,
  mode?: string | null,
  variety?: Variety | null,
): string {
  const head = progressLeadHead(fullName, lessons, stopLabel, mode);
  if (!head || stopLabel) return head;
  const kind = asProgressMode(mode) ?? "진도";
  return `${head} ${pickVariant(PROGRESS_CLOSES[kind], asVariety(variety), `close:${kind}`)}`;
}

/** 소단원별 이해도 상태 — 점수(차시 원문 키 → 0~10) + 뺀 차시. 세션 `subject_progress`에 실린다. */
export type UnderstandingState = { scores: Record<string, number>; off: string[] };

export const EMPTY_UNDERSTANDING: UnderstandingState = { scores: {}, off: [] };

/** 이해도 만점. */
export const UNDERSTANDING_MAX = 10;

/** 0~10 정수로 맞춘다. 숫자가 아니면 null(칸 비움). */
export function clampUnderstanding(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(UNDERSTANDING_MAX, Math.round(n)));
}

/** 세션에서 읽은 값(모양을 믿지 않는다) → 상태. */
export function readUnderstanding(raw: unknown): UnderstandingState {
  if (!raw || typeof raw !== "object") return EMPTY_UNDERSTANDING;
  const r = raw as { scores?: unknown; off?: unknown };
  const scores: Record<string, number> = {};
  if (r.scores && typeof r.scores === "object")
    for (const [k, v] of Object.entries(r.scores as Record<string, unknown>)) {
      const n = clampUnderstanding(v);
      if (n != null) scores[k] = n;
    }
  const off = Array.isArray(r.off) ? r.off.filter((x): x is string => typeof x === "string") : [];
  return { scores, off };
}

/**
 * 점수를 안 매긴 소단원의 기본값 — 원장 2026-10-26 *"초기 데이터 값(10)을 설정해 두고 변경 하도록"*.
 * 🔑 **저장값에 10을 박지 않는다** — 세션 `scores`에는 강사가 바꾼 소단원만 있고, 없는 소단원은 화면·자동작성이 이 값으로 읽는다
 *    (`UnderstandingRow.stored`로 가른다). 그래서 기본값을 바꾸면 손대지 않은 칸이 전부 따라온다.
 */
export const UNDERSTANDING_DEFAULT = 10;

/**
 * 한 번에 넣는 단계 — 원장 2026-10-26 *"버튼식으로 이해도 우수 보통 나쁨 이런식으로 바로 기입"*. 카드 패널·일괄 입력이 같은 목록을 쓴다.
 * 라벨은 화면 사전(`os.card.understandingPreset.<key>`)이 단다.
 */
export const UNDERSTANDING_PRESETS = [
  { key: "good", score: 10 },
  { key: "ok", score: 7 },
  { key: "poor", score: 4 },
] as const;
export type UnderstandingPresetKey = (typeof UNDERSTANDING_PRESETS)[number]["key"];

/**
 * 0~10 눈금 안내 — 원장이 나중에 줄 예정(2026-10-26 *"0~10까지 이해도의 가이드는 배치로 강사들이 보고 설정 할 수 있도록 할 예정"*).
 * 🔴 내용을 지어내지 않는다 — 비어 있으면 화면이 안내를 안 그린다. 받으면 여기(또는 학원설정으로 옮겨) 채운다.
 */
export const UNDERSTANDING_GUIDE: readonly { score: number; text: string }[] = [];

/** 소단원 전부에 같은 점수 — 단계 버튼·일괄 입력. 뺀 소단원은 그대로 둔다(점수만 바뀐다). */
export function setAllUnderstanding(
  today: string | null | undefined,
  st: UnderstandingState | undefined,
  score: number,
): UnderstandingState {
  const s = st ?? EMPTY_UNDERSTANDING;
  const v = clampUnderstanding(score) ?? UNDERSTANDING_DEFAULT;
  const scores = { ...s.scores };
  for (const lesson of pilotLessons(today)) scores[lesson] = v;
  return { scores, off: s.off };
}

/**
 * 지금 눌린 단계 버튼 — 직접 매긴 점수가 있고 남은 소단원이 전부 한 단계 점수로 같을 때만. 카드 패널·표가 같은 판정을 쓴다.
 * (뺀 소단원은 보지 않는다 · 기본값만 있으면 아무 버튼도 눌리지 않은 것으로 보인다.)
 */
export function understandingPresetOf(rows: readonly { off: boolean; score: number | null; stored?: boolean }[]): UnderstandingPresetKey | null {
  const live = rows.filter((r) => !r.off);
  if (!live.length || !live.some((r) => r.stored)) return null;
  const first = live[0]!.score;
  if (!live.every((r) => r.score === first)) return null;
  return UNDERSTANDING_PRESETS.find((p) => p.score === first)?.key ?? null;
}

/**
 * 일괄 입력에서 뺄 소단원 후보 — 대상 행들의 오늘 진도에 나온 소단원(처음 나온 순서) + 몇 행에 있는지(원장 2026-10-27 *"몇개 선택 빼기"*).
 * `extra` = 이번 일괄이 새로 넣을 진도(그 진도가 들어갈 행 수) — 같은 차례에 진도를 바꾸면 그 소단원도 고를 수 있게.
 */
export function bulkUnderstandingLessons(
  todays: readonly (string | null | undefined)[],
  extra?: { today: string; rows: number },
): { lesson: string; title: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const today of todays) for (const l of pilotLessons(today)) counts.set(l, (counts.get(l) ?? 0) + 1);
  if (extra) for (const l of pilotLessons(extra.today)) counts.set(l, Math.max(counts.get(l) ?? 0, extra.rows));
  return [...counts].map(([lesson, count]) => ({ lesson, title: lessonTitle(lesson), count }));
}

/** 강사가 점수를 하나라도 직접 매겼나('빈 칸만' 일괄 입력 판정). */
export function hasStoredUnderstanding(today: string | null | undefined, st: UnderstandingState | undefined): boolean {
  const s = st ?? EMPTY_UNDERSTANDING;
  return pilotLessons(today).some((l) => s.scores[l] != null);
}

/** `stored` = 강사가 매긴 점수인가(아니면 기본값으로 읽은 것). */
export type UnderstandingRow = { lesson: string; title: string; score: number | null; off: boolean; stored: boolean };

/** 화면 줄 — 오늘 진도의 차시마다 한 줄(뺀 것도 '뺌'으로 남겨 되살릴 수 있게). */
export function understandingRows(today: string | null | undefined, st: UnderstandingState | undefined): UnderstandingRow[] {
  const s = st ?? EMPTY_UNDERSTANDING;
  return pilotLessons(today).map((lesson) => ({
    lesson,
    title: lessonTitle(lesson),
    // 안 매긴 소단원은 기본값(10)으로 읽는다(원장 2026-10-26) — 저장값엔 없다(`stored: false`).
    score: s.scores[lesson] ?? UNDERSTANDING_DEFAULT,
    stored: s.scores[lesson] != null,
    off: s.off.includes(lesson),
  }));
}

/**
 * 자동작성에 쓰는 이해도 — 빼지 않은 소단원 전부(안 매긴 소단원은 기본값 10 · `rated: false`).
 * 수업 평가 표의 '이해도' 줄은 전부로 그린다(원장 2026-10-26 기본값 10). **글로 쓰는 이해도**는 선생님이 매긴 것만이다
 * (`ratedUnderstanding` — 원장 2026-10-28: 안 매긴 소단원이 "잘 이해했습니다"로 나가 선생님이 지웠다).
 */
export function activeUnderstanding(
  today: string | null | undefined,
  st: UnderstandingState | undefined,
): { title: string; score: number; rated: boolean }[] {
  return understandingRows(today, st)
    .filter((r) => !r.off && r.score != null)
    .map((r) => ({ title: r.title, score: r.score!, rated: !!r.stored }));
}

/**
 * 글로 쓸 이해도 — 선생님이 **직접 매긴** 소단원만. `rated`가 없는 항목(이 표식을 모르는 옛 화면이 보낸 값)은 매긴 것으로 본다(종전 그대로).
 */
export function ratedUnderstanding<T extends { rated?: boolean }>(items: readonly T[] | undefined): T[] {
  return (items ?? []).filter((u) => u.rated !== false);
}

/** '오늘의 수업' 메모 길이 상한 — 한 줄 메모(줄바꿈은 공백으로 접는다). */
export const LESSON_MEMO_MAX = 300;
export function readLessonMemo(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s*\n+\s*/g, " ").trim().slice(0, LESSON_MEMO_MAX) : "";
}

/**
 * 이해도 서명 — 자동작성할 때 쓴 이해도와 지금 칸 값이 같은지 대조한다(발송 게이트).
 * 🔴 점수는 학부모 글에 **숫자로 싣지 않는다**(원장 2026-10-21 *"점수로 하지 말고 … 말로 풀어서"*) — 글만 봐서는
 *    점수가 바뀌었는지 알 수 없어서, 자동작성 시점의 서명을 화면이 들고 있다가 비교한다.
 */
export function understandingSig(items: readonly { title: string; score: number }[] | undefined): string {
  return (items ?? []).map((i) => `${i.title}=${i.score}`).join("|");
}

/**
 * 항목 제목 — 학부모 글을 **항목별로 나눠** 무엇에 대한 답인지 보이게 한다(원장 2026-10-22 *"텍스트로 우르르 들어가는 게 아닌
 * 섹션을 나눠서 어떤 것에 어떤 답인지 볼 수 있게"*). ClassNote 본문은 평문이라 기호 한 글자로 머리를 단다.
 */
export const PILOT_SECTION_TITLES = {
  progress: "진도",
  attendance: "출결", // 지각·조퇴·공결 + 사유(원장 2026-10-26, attendance-sentence.ts) — 출석도 적는다 · 출결 기록이 없으면 항목이 없다
  daily: "일일 테스트",
  check: "확인 테스트",
  levels: "수업 평가",
  attitude: "수업 태도",
  homework: "숙제 완성도", // 원장 2026-10-23 *"과제 → 숙제완성도로 이름 변경"* — 라벨만(값은 그대로 지난 과제 수행률)
  understanding: "오늘의 수업", // 원장 2026-10-23 *"이해도가 아니라 오늘수업의 이해도로"* → *"오늘의 수업으로 명칭 변경"* — 라벨만(표의 줄 이름은 짧게 '이해도')
  homeworkToday: "오늘의 숙제", // 원장 2026-10-23(옛 '오늘 과제')
  note: "사랑의 한마디", // 원장 2026-10-23 *"강사 한줄멘트 → 사랑의 한마디"*(옛 '선생님 한마디')
} as const;

/**
 * 이름을 바꾸기 전 제목 — 이미 저장된 글을 학부모 카드가 같은 모양으로 그리고, 옛 글 끝의 한마디도 그 자리에서 바꿔 끼우려고 남긴다.
 * 새 글에는 쓰지 않는다.
 */
export const PILOT_LEGACY_TITLES = {
  homework: "과제 수행률",
  homeworkToday: "오늘 과제",
  note: "선생님 한마디",
} as const;

/**
 * **EiE 일일 보고서의 다른 이름**(원장 2026-11-06 *"eie 일일보고서일 경우 일일테스트 -> 단어테스트 이름변경"*) — 같은 항목으로 본다
 * (표 머리의 테스트 칸에 선다). 수학·다른 영어 글은 그대로 '일일 테스트'다.
 */
export const PILOT_ALIAS_TITLES = {
  daily: "단어 테스트",
} as const;

/** 단어 테스트 본문 맨 윗줄이 이 글자면 재시험이다(EiE 일일 보고서 — 카드가 제목 옆에 '재시험' 표시를 단다). */
export const RETEST_MARK = "[재시험]";

/** 항목 하나 — 내용이 비면 항목째 뺀다(없는 것을 '없음'으로 지어 쓰지 않는다). */
export function pilotSection(title: string, body: string | null | undefined): string {
  const b = (body ?? "").trim();
  return b ? `■ ${title}\n${b}` : "";
}

/** 맨 끝 '사랑의 한마디' 항목 — 강사가 적은 원문 그대로. */
export function noteBlock(note: string | null | undefined): string {
  return pilotSection(PILOT_SECTION_TITLES.note, note);
}

/**
 * 시범 대상 자동작성 글 조립 — `lead`(수업 평가 표 · 진도 항목) → `body`(이미 항목으로 나눈 글, math-report-pilot-sections.ts) →
 * 사랑의 한마디(맨 아래, 강사가 적은 원문 그대로 — AI에 주지 않는다).
 */
export function composePilotMent(parts: { lead: string; body: string; note: string }): string {
  return [parts.lead, parts.body, noteBlock(parts.note)]
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 강사 한줄 멘트를 고치면 자동작성 글 맨 끝을 **그 자리에서** 바꿔 끼운다(원장 2026-10-22 *"AI 자동 작성 후 치면 실시간으로
 * 우측에 반영해서 강사 한줄 멘트 쓰고 볼 수 있게"*). 한줄 멘트는 AI에 주지 않고 원문을 맨 끝에 붙이므로(composePilotMent)
 * 다시 자동작성할 필요가 없다 — 끝의 옛 멘트만 떼고 새 멘트를 붙인다.
 * 자동작성을 한 번도 안 했거나 끝이 옛 멘트로 끝나지 않으면 null(손대지 않는다).
 * 자동작성 뒤 강사가 고친 글도 끝만 바꾼다(원장 2026-10-23 *"자동작성하고나면 수정은 할수있게"*).
 */
export function pilotRecomposeNote(
  draft: string | null | undefined,
  autoDraft: string | null | undefined,
  prevNote: string | null | undefined,
  nextNote: string | null | undefined,
): string | null {
  if (!(autoDraft ?? "").trim()) return null;
  const d = (draft ?? "").trim();
  const p = (prevNote ?? "").trim();
  // 옛 제목('선생님 한마디')으로 끝난 글도 끝만 바꾼다 — 바꿔 끼우면 새 제목이 된다.
  const tails = p ? [noteBlock(p), pilotSection(PILOT_LEGACY_TITLES.note, p)] : [""];
  let base: string | null = null;
  for (const tail of tails) {
    if (!tail) base = d;
    else if (d === tail) base = "";
    else if (d.endsWith(`\n\n${tail}`)) base = d.slice(0, d.length - tail.length - 2);
    if (base !== null) break;
  }
  if (base === null) return null;
  return composePilotMent({ lead: base, body: "", note: nextNote ?? "" });
}

/** 강사 한줄 멘트가 적혀 있나 — 시범 대상은 필수(원장 2026-10-22 *"한줄멘트 … 없으면 발송 안 되게"*). */
export function hasPilotOneLine(note: string | null | undefined): boolean {
  return (note ?? "").trim() !== "";
}

/** 서버 발송 게이트 거절 문구 — 강사 한줄 멘트가 없거나 보고서 끝에 붙어 있지 않다. */
export const PILOT_ONELINE_REQUIRED_ERROR =
  "이 학생의 수학 보고서는 '사랑의 한마디'를 적어야 보낼 수 있습니다(저장은 됐습니다) — 사랑의 한마디를 적은 뒤 다시 보내 주세요";

/** 시험 없음·숙제 미제출 사유가 비었다(서버 발송 게이트, 2026-10-26 — 일괄 발송도 같은 조건). */
export const PILOT_REASON_REQUIRED_ERROR =
  "이 학생의 수학 보고서는 '시험 없음' 또는 '숙제 미제출' 사유를 적어야 보낼 수 있습니다(저장은 됐습니다) — 사유를 적은 뒤 다시 보내 주세요";

/** 새 보고서 조건에 걸린 서버 거절인가 — 일괄 발송이 '실패'와 갈라 센다. */
export function isPilotGateError(error: string | null | undefined): boolean {
  return (
    error === PILOT_AUTOWRITE_REQUIRED_ERROR ||
    error === PILOT_ONELINE_REQUIRED_ERROR ||
    error === PILOT_REASON_REQUIRED_ERROR ||
    error === ENGLISH_ONELINE_REQUIRED_ERROR
  );
}

/** 영어 보고서 발송 거절 문구 — '사랑의 한마디'가 비었다(원장 2026-10-26, 영어도 필수). */
export const ENGLISH_ONELINE_REQUIRED_ERROR =
  "이 학생의 영어 보고서는 '사랑의 한마디'를 적어야 보낼 수 있습니다(저장은 됐습니다) — 사랑의 한마디를 적은 뒤 다시 보내 주세요";

/** 서버 판정 — 한줄 멘트가 있고 보낼 글 맨 끝에 그대로 붙어 있나. */
export function pilotOneLineAttached(notes: string | null | undefined, oneLine: string | null | undefined): boolean {
  const o = (oneLine ?? "").trim();
  return o !== "" && (notes ?? "").trim().endsWith(o);
}

/** 자동작성 글이 그대로 칸에 있나(발송 게이트). 자동작성을 안 했거나 글이 달라졌으면 false. */
export function isPilotAutoWritten(draft: string | null | undefined, autoDraft: string | null | undefined): boolean {
  const a = (autoDraft ?? "").trim();
  return a !== "" && (draft ?? "").trim() === a;
}

/**
 * AI 본문 지시 — 첫 문장·특이사항은 코드가 붙이므로 본문이 같은 말을 되풀이하지 않게 하고, 이해도 점수는 **말로** 풀게 한다.
 * 원장 2026-10-21: *"점수로 하지 말고 점수에 따라 강점, 낮으면 낮은 만큼 응원 또는 격려와 같은 식으로 말로 풀어서"*.
 * 원장 2026-10-21 후속: *"학생이름 앞에 '우리' 붙여서 친근감"* · *"못했을 경우 학원에서 챙기겠다 / 다음 시간에 챙기겠다 등 학원에서 신경을 쓴다는 어투"*. · *"개념을 힘들어했다는 등 표현이 좋음"*(낮은 이해도 = '○○을 힘들어했습니다' 꼴)
 *   · *"응용문제 식을 세우는 이런 식의 추측성은 사용 금지 — 학생이 어떤 걸 어려워했는지 모르자나"*(2026-10-22) — 대상은 소단원 이름·개념까지만.
 * 프롬프트 본문(원장 편집 가능) 밖, 섹션 끝에 코드로 붙는다.
 */
/** 규칙 줄 — 선생님 습관(teacher-habits.ts)·수업 메모에 따라 몇 줄을 바꿔 끼운다. 기본(습관 없음·메모 없음) = 종전 지시 그대로. */
const PILOT_RULE_HEAD = "[이번 알림장 추가 규칙]";
const PILOT_RULES: readonly string[] = [
  "- 이 알림장은 항목별로 나뉩니다(수업 평가·진도·일일 테스트·수업 태도·숙제 완성도·오늘의 수업·오늘의 숙제·사랑의 한마디). 진도·테스트·태도·숙제·사랑의 한마디는 따로 붙으니, comment에는 '오늘의 수업' 항목에 들어갈 문장만 쓰세요 — 인사, 진도 나열, 테스트 점수, 수업 태도, 과제 이야기는 쓰지 마세요.",
  "- comment는 학생 이름으로 시작하지 말고, 오늘 수업 이야기부터 바로 시작하세요.",
  // 원장 2026-10-26 *"이해도를 기입하면 오늘의 수업에서 소단원별로 비슷한 워딩이 계속 그냥 나열되기만 하는데 실제 사람이 쓴거처럼 요약 및 문구 정리"*.
  "- 소단원을 하나씩 나열하지 말고, 선생님이 직접 쓴 것처럼 오늘 수업 전체를 2~4문장으로 자연스럽게 요약하세요. 이해 정도가 비슷한 소단원은 한 문장으로 묶고('A와 B는 …'), 잘한 부분은 한 번, 더 챙길 부분은 한 번만 말하세요. 같은 말투·같은 문장 끝('~했습니다. ~했습니다.')을 소단원마다 되풀이하지 마세요.",
  "- 본문에서 학생을 부를 때는 이름 앞에 '우리'를 붙여 친근하게 부르세요. 부를 이름은 맨 아래 [부르는 이름]에 있습니다 — 그 이름 말고 다른 이름은 절대 쓰지 마세요.",
  "- '소단원별 이해도'는 점수 대신 말로 풀어 쓰세요. '잘 이해함'인 소단원들은 묶어서 아이의 강점으로 구체적으로 칭찬하세요.",
  "- '대체로 따라왔으나 아직 조금 어려워함'·'어려워함'인 소단원은 반드시 두 단계로 쓰세요. ① 먼저 그 소단원을 아이가 힘들어했다는 사실만 부드럽게 말합니다 — 대상은 소단원 이름(또는 그 소단원의 개념)까지만입니다(중간 예: '연립방정식의 풀이는 대체로 잘 따라왔지만 아직 조금 어려워했습니다' / 낮음 예: '해가 특수한 연립방정식 개념을 조금 힘들어했습니다'). 소단원 안의 어느 부분이 어려웠는지(응용 문제·식 세우기·계산·풀이 정리·문장제 등)는 입력에 없는 정보이므로 절대 추측해서 쓰지 마세요 — 선생님이 점수만 매겼을 뿐, 무엇이 어려웠는지는 알려 주지 않았습니다. '이해도가 낮다'·'못한다'·'부족하다' 같은 직접적인 표현은 쓰지 마세요. ② 그다음 '그래서'·'그만큼' 같은 말로 이어, 바로 그 이유 때문에 학원에서 챙기겠다고 아이를 향한 응원·격려와 함께 마무리합니다(예: '그래서 다음 시간에 한 번 더 짚어 확실히 챙기겠습니다', '충분히 해낼 수 있는 부분이라 그만큼 수업 중에 꼼꼼히 살펴보겠습니다'). 상태 설명 없이 '챙기겠습니다'만 쓰면 학부모가 왜 챙기는지 알 수 없으니 절대 그렇게 쓰지 마세요.",
  "- 아이가 잘 못한 부분·과제를 못 해 온 부분도 아이나 가정에 책임을 돌리지 말고, 학원이 책임지고 챙긴다는 어투로 마무리하세요. 가정에 숙제·복습을 부탁하는 말로 끝내지 마세요.",
  "- 점수 숫자·'10점 만점'·'이해도 N점' 같은 표현은 절대 쓰지 마세요. 소단원 이름은 그대로 써도 됩니다.",
  "- comment에는 학부모님께 보낼 문장만 쓰세요. 규칙을 지켰는지에 대한 설명이나 고쳐 쓰겠다는 말은 절대 넣지 마세요.",
];
const RULE_LIST = PILOT_RULES[2]!;
const RULE_TWO_STEP = PILOT_RULES[5]!;
const RULE_RESPONSIBLE = PILOT_RULES[6]!;
const RULE_NUMBERS = PILOT_RULES[7]!;

export const PILOT_AI_DIRECTIVE = [PILOT_RULE_HEAD, ...PILOT_RULES].join("\n");

/** 부르는 이름 — "학원삼" → "원삼이", "김지수" → "지수"(`topicName`에서 조사 '는'만 뗀 것). 모르면 "". */
export function callName(fullName: string): string {
  return topicName(fullName).replace(/는$/, "");
}

/**
 * 이 학생의 AI 지시 — 공통 규칙 + 부르는 이름. 원장 2026-10-23 *"왜 로그인 한 사람의 이름으로 뜨는거지?"* — 사실 입력엔 학생 이름이
 * 없었고, 지시의 예시 이름('우리 승엽이가')을 모델이 그대로 베꼈다. 그래서 예시 이름을 없애고 이 학생의 실제 이름을 준다.
 */
export function pilotAiDirective(
  fullName: string,
  opts?: { habits?: TeacherHabits | null; memo?: string | null },
): string {
  const call = callName(fullName);
  const h = opts?.habits ?? NO_HABITS;
  const memo = (opts?.memo ?? "").trim();
  const rules = PILOT_RULES.map((r) => {
    // 선생님 습관(원장 2026-10-28 *"자주 지우면 생략"*) — 그 선생님이 늘 지우는 문장은 처음부터 안 쓴다.
    if (r === RULE_LIST && h.compactUnits) return PILOT_RULE_COMPACT_UNITS;
    if (r === RULE_TWO_STEP && h.omitPromises) return PILOT_RULE_TWO_STEP_NO_PROMISE;
    if (r === RULE_RESPONSIBLE && h.omitPromises) return PILOT_RULE_NO_PROMISE_ENDING;
    if (r === RULE_NUMBERS && memo) return `${r} 단, [선생님 수업 메모]에 적힌 숫자·날짜·교재 이름은 메모에 적힌 그대로 써도 됩니다.`;
    return r;
  });
  if (h.omitFiller) rules.push(PILOT_RULE_NO_FILLER);
  if (memo) rules.push(PILOT_RULE_MEMO);
  return [
    PILOT_RULE_HEAD,
    ...rules,
    ...(memo ? [`[선생님 수업 메모] ${memo}`] : []),
    call ? `[부르는 이름] 우리 ${call}` : "[부르는 이름] 없음 — 이름을 부르지 말고 '아이'라고 쓰세요.",
  ].join("\n");
}

/** 소단원 나열을 늘 지우는 선생님 — 이해 정도는 지키되 한 문장으로 묶는다(사실은 남긴다). */
export const PILOT_RULE_COMPACT_UNITS =
  "- 소단원을 하나씩 나열하지 마세요. 이해 정도는 잘한 부분과 더 챙길 부분을 한 문장(길어도 두 문장)으로 묶어 짧게 쓰고, 소단원마다 '…은 대체로 따라왔지만 아직 조금 어려워했습니다'·'…을 잘 이해했습니다' 같은 문장을 되풀이하지 마세요.";
/** 다짐 문장을 늘 지우는 선생님 — 힘들어한 사실만 부드럽게, 다짐(②)은 쓰지 않는다. */
export const PILOT_RULE_TWO_STEP_NO_PROMISE =
  "- '대체로 따라왔으나 아직 조금 어려워함'·'어려워함'인 소단원은 아이가 힘들어했다는 사실만 부드럽게 말하세요 — 대상은 소단원 이름(또는 그 소단원의 개념)까지만입니다. 소단원 안의 어느 부분이 어려웠는지는 입력에 없는 정보이므로 절대 추측해서 쓰지 마세요. '이해도가 낮다'·'못한다'·'부족하다' 같은 직접적인 표현은 쓰지 마세요. '다음 시간에 ~하겠습니다'·'챙기겠습니다'·'살펴보겠습니다' 같은 다짐·계획 문장은 쓰지 마세요(이 선생님은 그런 문장을 쓰지 않습니다).";
export const PILOT_RULE_NO_PROMISE_ENDING =
  "- 아이가 잘 못한 부분도 아이나 가정에 책임을 돌리지 마세요. 가정에 숙제·복습을 부탁하는 말이나 다짐 문장으로 끝내지 말고, 사실을 말한 문장으로 끝내세요.";
/** 두루뭉술한 수업 묘사를 늘 지우는 선생님. */
export const PILOT_RULE_NO_FILLER =
  "- '배운 개념을 문제에 적용해 보며 실력을 다졌다'·'오늘 배운 내용이 잘 자리 잡도록' 같은 두루뭉술한 수업 묘사는 쓰지 마세요. 입력에 있는 사실만 짧게 쓰세요.";
/** 선생님 수업 메모(원장 2026-10-28) — 그날 수업에서 실제로 한 일. */
export const PILOT_RULE_MEMO =
  "- 아래 [선생님 수업 메모]는 선생님이 오늘 수업에 대해 직접 적은 사실입니다. '오늘의 수업' 앞부분에 그 사실을 살려 자연스러운 문장으로 쓰세요. 뜻을 바꾸거나 부풀리지 말고, 메모에 없는 일을 덧붙이지 마세요."

/** 이해도 점수 → AI에 줄 말. 숫자를 주면 금지해도 '10점 만점에 N점'을 베꼈다(2026-10-23 실측). 경계는 수업 평가 표와 같은 쪽(8↑ · 5~7 · 4↓). */
export function understandingBandText(score: number): string {
  if (score >= 8) return "잘 이해함";
  if (score >= 5) return "대체로 따라왔으나 아직 조금 어려워함";
  return "어려워함";
}

/** 모델이 규칙을 어기고 남긴 문장 — 점수 숫자 · 규칙에 대한 혼잣말("금지 표현이니 제외하고 다시 쓰겠습니다"). */
const LEAK = /\d+\s*점|만점|점수|금지 표현|다시 쓰|제외하고|규칙을|지침을|지침에/;

/**
 * 모델이 아무것도 못 남겼을 때의 이해도 글 — 이해 정도가 같은 소단원끼리 **묶어** 한 문장씩(원장 2026-10-26 *"소단원별로 비슷한 워딩이
 * 나열되기만"* — 소단원마다 같은 문장을 되풀이하지 않는다). 아직 어려워한 묶음이 있으면 학원이 챙긴다는 말로 한 번만 맺는다.
 */
export function fallbackUnderstanding(items: readonly { title: string; score: number }[], habits?: TeacherHabits | null): string {
  const group = (pred: (s: number) => boolean) => items.filter((i) => pred(i.score)).map((i) => `'${i.title}'`);
  const topic = (names: string[]) => {
    const last = names[names.length - 1]!;
    const joined = names.length === 1 ? last : `${names.slice(0, -1).join(", ")}${hasBatchim(names[names.length - 2]!.slice(-2, -1)) ? "과" : "와"} ${last}`;
    return `${joined}${hasBatchim(last.slice(-2, -1)) ? "은" : "는"}`;
  };
  const good = group((s) => s >= 8);
  const mid = group((s) => s >= 5 && s < 8);
  const low = group((s) => s < 5);
  const out: string[] = [];
  if (good.length) out.push(`${topic(good)} 잘 이해하고 있습니다.`);
  if (mid.length) out.push(`${topic(mid)} 대체로 잘 따라왔지만 아직 조금 어려워했습니다.`);
  if (low.length) out.push(`${topic(low)} 조금 힘들어했습니다.`);
  if ((mid.length || low.length) && !habits?.omitPromises) out.push("그래서 다음 시간에 한 번 더 짚어 확실히 챙기겠습니다.");
  return out.join(" ");
}

/**
 * AI 이해도 글 후보정 — 점수 숫자·규칙 혼잣말이 든 **문장을 통째로** 뺀다(고쳐 쓰지 않는다 — 지어내지 않으려고).
 * 다 빠지면 `fallbackUnderstanding`. 지시가 무시돼도 학부모에게 숫자·혼잣말이 가지 않게 하는 마지막 관문.
 */
export function cleanPilotUnderstanding(
  text: string,
  items: readonly { title: string; score: number }[],
  opts?: { habits?: TeacherHabits | null; memo?: string | null },
): string {
  const memo = (opts?.memo ?? "").trim();
  // 메모에 선생님이 적은 점수(예 '월말고사 92점')는 새는 숫자가 아니다 — 걸린 글자가 모두 메모에 그대로 있으면 둔다.
  const leaks = (sen: string) => {
    if (!memo) return LEAK.test(sen);
    const hits = sen.match(new RegExp(LEAK.source, "g")) ?? [];
    return hits.some((h) => !memo.includes(h));
  };
  const out = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((sen) => sen && !leaks(sen))
    .join(" ")
    .trim();
  return out || (items.length ? fallbackUnderstanding(items, opts?.habits) : memo);
}

const QUOTED_RE = /'[^'\n]+'/g;
const PROGRESS_MODE_WORDS = ["복습", "문제풀이"] as const;

/**
 * 진도 글의 사실 — 따옴표 안 소단원 이름(순서대로) · 숫자 · 성격 말(복습·문제풀이). 말투 다시 쓰기(pilot-restyle-guard.ts)가 바꿀 수 없는
 * 것들이고, 발송 게이트가 다시 쓴 진도 글을 지금 값과 견줄 때도 이것으로 본다(원장 2026-10-30 진도 문장도 선생님 말투로).
 */
export function progressFacts(text: string): { quotes: string[]; digits: string[]; modes: string[] } {
  const sq = text.replace(/\s+/g, "");
  return {
    quotes: text.match(QUOTED_RE) ?? [],
    digits: text.match(/\d+/g) ?? [],
    modes: PROGRESS_MODE_WORDS.filter((w) => sq.includes(w)),
  };
}

/** 글에서 한 항목 본문(제목 줄 다음부터 다음 '■' 앞까지). 없으면 null. */
function sectionBodyOf(text: string, title: string): string | null {
  const head = `■ ${title}\n`;
  const at = text.startsWith(head) ? 0 : text.indexOf(`\n${head}`);
  if (at < 0) return null;
  const from = at === 0 ? head.length : at + 1 + head.length;
  const end = text.indexOf("\n■", from);
  return (end < 0 ? text.slice(from) : text.slice(from, end)).trim();
}

/**
 * 말투로 다시 쓴 진도 항목도 지금 값의 글인가 — 첫 문장 글자 대조 대신 사실로 본다: 소단원 이름이 순서까지 같고, 지금 첫 문장의 숫자가
 * 다 있고, 성격 말(복습·문제풀이)이 지금 값과 맞는다(지금 값에 있으면 글에 있어야 하고, 글 첫 문장에 있으면 지금 값에도 있어야 한다).
 * 🔴 소단원 이름이 없는 첫 문장(멈춤 수업 '월말평가 수업을 했습니다')은 다시 쓰지 않으므로 여기서도 false — 글자 대조만.
 */
export function progressSectionMatches(draft: string, leadHead: string): boolean {
  const body = sectionBodyOf(draft, PILOT_SECTION_TITLES.progress);
  if (!body) return false;
  const want = progressFacts(leadHead);
  if (!want.quotes.length) return false;
  const got = progressFacts(body);
  if (got.quotes.join("\n") !== want.quotes.join("\n")) return false;
  if (!want.digits.every((n) => got.digits.includes(n))) return false;
  if (!want.modes.every((m) => got.modes.includes(m))) return false;
  const firstSentence = body.split("\n")[0]!.split(/(?<=[.!?])\s+/)[0] ?? "";
  return progressFacts(firstSentence).modes.every((m) => want.modes.includes(m));
}

/** 서버 발송 게이트 거절 문구 — 자동작성 글이 아니거나 고쳐졌다. */
export const PILOT_AUTOWRITE_REQUIRED_ERROR =
  "이 학생의 수학 보고서는 '자동작성'을 먼저 해야 보낼 수 있습니다(저장은 됐습니다) — 자동작성을 누른 뒤 다시 보내 주세요";

/**
 * 자동작성 글이 **지금 칸 값과 맞나** — 자동작성 뒤에 진도·테스트·태도·과제·이해도를 바꾸면 글은 옛 값 그대로라 다시 눌러야 한다
 * (한줄 멘트는 그 자리에서 바뀌므로 예외 — pilotRecomposeNote). 진도 항목·맨 끝 한마디는 글에서 대조하고, 나머지는 자동작성 때
 * 남긴 사실 서명(`writtenSig`)과 대조한다(이해도 점수처럼 글에 숫자로 없는 값이 있다).
 * ⚠️ 서명은 화면 상태라 새로고침하면 없다 — 없으면 서명 대조를 건너뛴다(막지 않는다).
 */
export function isPilotDraftCurrent(
  draft: string | null | undefined,
  now: {
    studentName: string;
    today: string | null | undefined;
    /** 진도 칸의 복습·문제풀이(progress-mode.ts) — 첫 문장이 이 값에 따라 달라서 대조에도 같은 값을 넣는다. */
    progressMode: string | null | undefined;
    note: string | null | undefined;
    /** 지금 칸 값의 사실 서명(math-report-pilot-sections.ts `pilotFactsSig`) — 자동작성 때 남긴 `writtenSig`와 대조한다. */
    factsSig: string;
    writtenSig?: string;
  },
): boolean {
  const d = (draft ?? "").trim();
  // 첫 문장(사실)만 대조한다 — 마무리 문장은 갈래(ment-variants.ts)라 날마다 다르다(원장 2026-10-26 매크로성 반복 금지).
  const lead = progressLeadHead(now.studentName, pilotLessons(now.today), skipStatusOf(now.today), now.progressMode);
  // 진도 항목은 맨 앞이거나 '수업 평가' 표 바로 뒤(원장 2026-10-23 표를 맨 위로).
  // 선생님 말투로 다시 쓴 진도(원장 2026-10-30)는 글자가 달라 사실로 견준다(progressSectionMatches).
  const sec = lead ? pilotSection(PILOT_SECTION_TITLES.progress, lead) : "";
  if (sec && !d.startsWith(sec) && !d.includes(`\n\n${sec}`) && !progressSectionMatches(d, lead)) return false;
  if (now.writtenSig !== undefined && now.writtenSig !== now.factsSig) return false;
  const note = (now.note ?? "").trim();
  if (note && !d.endsWith(note)) return false;
  return true;
}

/**
 * 자동작성을 한 번이라도 했나 — 시범 대상 멘트 칸은 그 전엔 잠기고, 그 뒤엔 고칠 수 있다
 * (원장 2026-10-23 *"자동작성하고나면 수정은 할수있게 열어줘"*, 종전 2026-10-21 *"수정하지 못하도록 막고 보이게만"*을 뒤집음).
 */
export function pilotCanEdit(autoDraft: string | null | undefined): boolean {
  return (autoDraft ?? "").trim() !== "";
}

/**
 * 발송 게이트용(카드·표 공용) — 자동작성을 한 번은 해야 하고, 그 뒤 칸 값(진도·테스트·태도·과제·이해도)이 바뀌었으면 다시 눌러야 한다.
 * · 자동작성 글 그대로 = 종전 대조 전부(진도 첫 문장 · 사실 서명 · 끝의 한마디).
 * · 강사가 고친 글 = 글 대조(진도 첫 문장)는 못 한다 — 사실 서명과 끝의 한마디만 본다(고친 글을 '다시 자동작성'으로 지우게 하지 않는다).
 */
export function pilotNeedsAutoWrite(
  draft: string | null | undefined,
  autoDraft: string | null | undefined,
  now: Parameters<typeof isPilotDraftCurrent>[1],
): boolean {
  const d = (draft ?? "").trim();
  if (!pilotCanEdit(autoDraft) || !d) return true;
  if (isPilotAutoWritten(draft, autoDraft)) return !isPilotDraftCurrent(draft, now);
  if (now.writtenSig !== undefined && now.writtenSig !== now.factsSig) return true;
  // 고친 글은 한마디가 **들어 있기만** 하면 된다 — 끝에 한 줄 덧붙였다고 '자동작성 다시'를 요구하면 고친 글을 지우게 된다(2026-10-27).
  const note = (now.note ?? "").trim();
  return note !== "" && !d.includes(note);
}
