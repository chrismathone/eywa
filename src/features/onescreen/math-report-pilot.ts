/**
 * **수학 보고서 새 방식 — 테스트 학생 한정 시범**(원장 2026-10-21). 순수 모듈(Vitest).
 *
 * 원장 지시: *"해당 작업은 수학과 테스트 학생이한테만 반영해서 테스트 먼저 진행해보기 위함"* — 범위는 학생 '테스트' 한 명
 * (질문 답 "학생 '테스트' 기준"). 시범 대상 수학 행에서만 아래 다섯 가지가 바뀐다.
 *   1. 수학 보고서(멘트·추세) 칸은 **보기만** — 손으로 못 고친다(readOnly).
 *   2. '자동작성'으로 만든 글 그대로가 아니면 ClassNote 발송을 막는다(화면 게이트 + 서버 `saveAndQueueClassnote` 이중).
 *   3. 특이사항 자리표시 = 격려 멘트 예시.
 *   4. 소단원(오늘 진도의 차시)별 **이해도 10점 만점** 칸 — 일부를 빼고 남은 것만 자동작성에 쓴다.
 *   5. 자동작성 글 = `{이름}는 오늘 … 진도를 나갔습니다` + 이해도 + AI 본문 + 특이사항(맨 아래 그대로).
 *
 * 🔴 대상은 **id 명단 하나**(`MATH_REPORT_PILOT_STUDENT_IDS`)이고 판정은 `isMathReportPilot` 한 함수다 — 화면·서버가 같은 답을 낸다.
 *    시범이 끝나 전원에게 열 땐 이 명단을 지우고 판정을 과목만 보게 바꾼다(그때 이 주석도 고칠 것).
 */

import { skipStatusOf } from "./progress-status";

/** 시범 대상 학생 id — 학생 '테스트'(injaewon). */
export const MATH_REPORT_PILOT_STUDENT_IDS: readonly string[] = ["67a53999-fb62-4753-a938-9a5ce4af9e61"];

/** 이 학생·과목 행이 시범 대상인가. 과목키가 없는 행(데모)은 수학으로 본다(원스크린 관례). */
export function isMathReportPilot(studentId: string | null | undefined, subjectKey: string | null | undefined): boolean {
  if (!studentId || !MATH_REPORT_PILOT_STUDENT_IDS.includes(studentId)) return false;
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
 * 괄호·공백 뒤 꼬리("홍길동 (테스트)")는 뗀다. 한글 세 글자면 성을 뗀다(두 글자·네 글자 이상은 그대로 — 복성·외자를 추측하지 않는다).
 */
export function topicName(fullName: string): string {
  const base = fullName.replace(/[([].*$/, "").trim().split(/\s+/)[0] ?? "";
  const given = /^[가-힣]{3}$/.test(base) ? base.slice(1) : base;
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

/**
 * 첫 문장 — 원장 지시 *"단원 하나면 하나로 갔다 3개면 어디서 어디까지 나갔다"*.
 * 1개 = "승엽이는 오늘 소수와 거듭제곱 진도를 나갔습니다." / 2개 = "A와 B" / 3개 이상 = "A부터 B까지".
 * `stopLabel`(월말평가 등 진도 중단일) = 진도 대신 그날 한 일을 적는다.
 */
export function progressLead(fullName: string, lessons: readonly string[], stopLabel?: string | null): string {
  const who = topicName(fullName);
  if (!who) return "";
  if (stopLabel) return `${who} 오늘 ${stopLabel} 수업을 했습니다.`;
  const titles = lessons.map(lessonTitle).filter(Boolean);
  if (titles.length === 0) return "";
  if (titles.length === 1) return `${who} 오늘 ${titles[0]} 진도를 나갔습니다.`;
  if (titles.length === 2) {
    const [a, b] = titles;
    return `${who} 오늘 ${a}${hasBatchim(a!.slice(-1)) ? "과" : "와"} ${b} 진도를 나갔습니다.`;
  }
  return `${who} 오늘 ${titles[0]}부터 ${titles[titles.length - 1]}까지 진도를 나갔습니다.`;
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

export type UnderstandingRow = { lesson: string; title: string; score: number | null; off: boolean };

/** 화면 줄 — 오늘 진도의 차시마다 한 줄(뺀 것도 '뺌'으로 남겨 되살릴 수 있게). */
export function understandingRows(today: string | null | undefined, st: UnderstandingState | undefined): UnderstandingRow[] {
  const s = st ?? EMPTY_UNDERSTANDING;
  return pilotLessons(today).map((lesson) => ({
    lesson,
    title: lessonTitle(lesson),
    score: s.scores[lesson] ?? null,
    off: s.off.includes(lesson),
  }));
}

/** 자동작성에 쓰는 이해도 — 빼지 않았고 점수를 매긴 소단원만. */
export function activeUnderstanding(
  today: string | null | undefined,
  st: UnderstandingState | undefined,
): { title: string; score: number }[] {
  return understandingRows(today, st)
    .filter((r) => !r.off && r.score != null)
    .map((r) => ({ title: r.title, score: r.score! }));
}

/** 학부모 글에 들어가는 이해도 블록 — 비면 "". */
export function understandingBlock(items: readonly { title: string; score: number }[]): string {
  if (items.length === 0) return "";
  return [`[소단원별 이해도 · ${UNDERSTANDING_MAX}점 만점]`, ...items.map((i) => `· ${i.title} ${i.score}점`)].join("\n");
}

/**
 * 시범 대상 자동작성 글 조립 — 진도 첫 문장 → 이해도 → 본문 → 특이사항(맨 아래, 강사가 쓴 그대로).
 * 원장 지시 *"특이사항 멘트는 수학보고서 밑에 추가 되게"* — 특이사항은 AI에 주지 않고 원문을 붙인다.
 */
export function composePilotMent(parts: { lead: string; understanding: string; body: string; note: string }): string {
  return [parts.lead, parts.understanding, parts.body, parts.note]
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** 자동작성 글이 그대로 칸에 있나(발송 게이트). 자동작성을 안 했거나 글이 달라졌으면 false. */
export function isPilotAutoWritten(draft: string | null | undefined, autoDraft: string | null | undefined): boolean {
  const a = (autoDraft ?? "").trim();
  return a !== "" && (draft ?? "").trim() === a;
}

/**
 * AI 본문 지시 — 첫 문장·이해도 블록·특이사항은 코드가 붙이므로 본문이 같은 말을 되풀이하지 않게 한다.
 * 프롬프트 본문(원장 편집 가능) 밖, 섹션 끝에 코드로 붙는다.
 */
export const PILOT_AI_DIRECTIVE = [
  "[이번 알림장 추가 규칙]",
  "- 알림장 맨 앞에 '오늘 ○○ 진도를 나갔습니다' 문장과 소단원별 이해도 점수가 따로 붙습니다. 본문에서 진도 단원명을 다시 나열하거나 학생 이름으로 첫 문장을 시작하지 마세요.",
  "- '소단원별 이해도'가 있으면 각 소단원의 이해 정도를 점수 수준에 맞게 서술하세요(8~10점 잘 이해함, 5~7점 대체로 이해했으나 보완 필요, 4점 이하 다음 수업에서 다시 짚음). 점수 숫자는 다시 쓰지 마세요.",
  "- 특이사항은 알림장 맨 끝에 선생님 글 그대로 붙습니다. 본문에서 다루지 마세요.",
].join("\n");

/** 서버 발송 게이트 거절 문구 — 자동작성 글이 아니거나 고쳐졌다. */
export const PILOT_AUTOWRITE_REQUIRED_ERROR =
  "이 학생의 수학 보고서는 '자동작성'으로 만든 글만 보낼 수 있습니다(저장은 됐습니다) — 자동작성을 누른 뒤 다시 보내 주세요";

/**
 * 자동작성 글이 **지금 칸 값과 맞나** — 자동작성 뒤에 진도·이해도·특이사항을 바꾸면 글은 옛 값 그대로라 다시 눌러야 한다.
 * 코드가 붙인 부분(첫 문장·이해도 블록·맨 끝 특이사항)만 대조한다 — AI 본문은 대조할 기준이 없다.
 * ⚠️ 특이사항을 **지운** 경우는 못 잡는다(옛 글 끝에 남은 문장이 옛 특이사항인지 본문인지 가를 수 없다).
 */
export function isPilotDraftCurrent(
  draft: string | null | undefined,
  now: { studentName: string; today: string | null | undefined; note: string | null | undefined; understanding: readonly { title: string; score: number }[] },
): boolean {
  const d = (draft ?? "").trim();
  const lead = progressLead(now.studentName, pilotLessons(now.today), skipStatusOf(now.today));
  if (lead && !d.startsWith(lead)) return false;
  const block = understandingBlock(now.understanding);
  if (block ? !d.includes(block) : d.includes("[소단원별 이해도")) return false;
  const note = (now.note ?? "").trim();
  if (note && !d.endsWith(note)) return false;
  return true;
}

/** 발송 게이트용 — 자동작성 글 그대로이고 지금 칸 값과도 맞아야 보낼 수 있다(카드·표 공용). */
export function pilotNeedsAutoWrite(
  draft: string | null | undefined,
  autoDraft: string | null | undefined,
  now: Parameters<typeof isPilotDraftCurrent>[1],
): boolean {
  return !isPilotAutoWritten(draft, autoDraft) || !isPilotDraftCurrent(draft, now);
}
