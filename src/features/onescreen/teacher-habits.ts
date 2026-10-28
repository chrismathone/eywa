/**
 * 선생님별 **늘 지우는 문장** — 자동작성 원문(0370a `ment_ai_drafts`) ↔ 그 선생님이 실제로 보낸 글을 견줘, 자주 지우는 종류의
 * 문장을 그 선생님 글에서는 처음부터 쓰지 않는다(원장 2026-10-28 *"자주 지우면 생략"* · *"허주연 선생님이 자주 지웠던 내용 반영할
 * 수 있게 자기가 쓴 것처럼"*). 순수 모듈(Vitest).
 *
 * 🔑 명단이 아니라 **기록**으로 정한다 — 선생님 이름을 코드에 적지 않는다. 판정은 자동작성할 때마다 최근 기록으로 다시 한다
 *    (주간 cron을 기다리지 않는다 — 배포하는 순간부터 그 선생님 기록대로 돈다).
 * 🔑 종류 셋:
 *    - promise  = "다음 시간에 한 번 더 짚어 챙기겠습니다" 같은 **다짐** 문장(원장 2026-10-21 기본 어투 — 안 지우는 선생님에겐 그대로).
 *    - filler   = "배운 개념을 문제에 적용해 보며 실력을 다졌고" 같은 **두루뭉술한 수업 묘사**(그날 사실이 아니라 틀 문장).
 *    - unitList = 소단원마다 "…은 대체로 따라왔지만 아직 조금 어려워했습니다"·"…을 잘 이해했습니다"를 늘어놓는 것 —
 *                 이해도 사실은 지키고 **한 문장으로 묶어** 짧게 쓴다(지우지 않는다 — 사실이다).
 * 🔴 다짐·틀 문장만 뗀다 — 숫자·날짜·선생님이 적은 말이 든 문장은 건드리지 않는다(stripHabitSentences).
 */

export type TeacherHabits = { omitPromises: boolean; omitFiller: boolean; compactUnits: boolean };
export const NO_HABITS: TeacherHabits = { omitPromises: false, omitFiller: false, compactUnits: false };

/**
 * 앞으로 하겠다는 다짐(학원이 챙기겠다) — **문장 끝이 '~하겠습니다/~하겠어요'**인 것. 지난 일을 말한 문장('정확하게 짚어 가며 개념을
 * 잡았습니다')은 다짐이 아니다(키워드만 보면 사실 문장까지 지운다). '좋겠습니다'(바람·부탁)는 다짐이 아니다.
 */
export const PROMISE_RE = /(?<!좋)겠(?:습니다|어요)[.!~\s]*$/;
/** 그날 사실이 아닌 틀 문장(수업 묘사·마무리) — 코드 갈래(PROGRESS_CLOSES)와 AI가 자주 쓰는 꼴. */
export const FILLER_RE = /(?:배운 개념을 문제에 적용해|개념을 적용하는 연습|실력을 다졌|자리 잡을 수 있도록|손에 익혔|빈틈을 메웠|헷갈리던 부분을 (?:정리|바로잡)|헷갈리지 않도록)/;
/** 소단원 하나하나의 이해 정도 문장. */
export const UNIT_RE = /(?:대체로 (?:잘 )?따라왔(?:지만|으나)|아직 조금 어려워|조금 힘들어|잘 이해(?:하고 있|했|하는)|강점이라고)/;

/** 판정 기준 — 그 종류 문장을 **4번 이상** 지웠고, 나온 것의 **35% 이상**을 지웠다(실측 2026-10-28: 다짐을 늘 지우는 선생님 26/64 = 41% · 안 지우는 선생님 0~3번). */
export const HABIT_MIN_REMOVED = 4;
export const HABIT_MIN_RATE = 0.35;

const squash = (s: string) => s.replace(/\s+/g, "");

/** 글 → 문장(항목 제목 줄 '■ …'은 뺀다). */
export function habitSentences(text: string | null | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("■"))
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

export type HabitStat = { seen: number; removed: number };
export type HabitStats = { promise: HabitStat; filler: HabitStat; unitList: HabitStat };

/** 원문 ↔ 보낸 글 짝들 → 종류별로 나온 문장 수·지운 문장 수(보낸 글에 그 문장이 공백 무시 그대로 없으면 지운 것). */
export function habitStats(pairs: readonly { ai: string; final: string }[]): HabitStats {
  const st: HabitStats = { promise: { seen: 0, removed: 0 }, filler: { seen: 0, removed: 0 }, unitList: { seen: 0, removed: 0 } };
  for (const p of pairs) {
    const fin = squash(p.final ?? "");
    if (!fin) continue;
    for (const s of habitSentences(p.ai)) {
      const gone = !fin.includes(squash(s));
      const bump = (k: keyof HabitStats) => {
        st[k].seen++;
        if (gone) st[k].removed++;
      };
      if (PROMISE_RE.test(s)) bump("promise");
      if (FILLER_RE.test(s)) bump("filler");
      if (UNIT_RE.test(s)) bump("unitList");
    }
  }
  return st;
}

export function habitQualifies(s: HabitStat): boolean {
  return s.removed >= HABIT_MIN_REMOVED && s.seen > 0 && s.removed / s.seen >= HABIT_MIN_RATE;
}

export function learnTeacherHabits(pairs: readonly { ai: string; final: string }[]): TeacherHabits {
  const st = habitStats(pairs);
  return { omitPromises: habitQualifies(st.promise), omitFiller: habitQualifies(st.filler), compactUnits: habitQualifies(st.unitList) };
}

/**
 * 글 한 덩어리(항목 본문)에서 그 선생님이 늘 지우는 다짐·틀 문장을 뗀다.
 * 🔴 숫자가 든 문장·선생님이 직접 적은 말(`keep`)이 든 문장은 남긴다 — 사실을 지우지 않는다.
 * 🔴 다 지워지면 원래 글 그대로(항목이 비면 안 된다).
 */
export function stripHabitSentences(text: string, habits: TeacherHabits, keep: readonly string[] = []): string {
  if (!habits.omitPromises && !habits.omitFiller) return text;
  const keeps = keep.map(squash).filter((k) => k.length >= 4);
  const lines = text.split("\n").map((line) => {
    if (line.trim().startsWith("■")) return line;
    const parts = line.split(/(?<=[.!?])\s+/);
    const kept = parts.filter((s) => {
      const t = s.trim();
      if (!t) return true;
      if (/\d/.test(t)) return true;
      const sq = squash(t);
      if (keeps.some((k) => k.includes(sq) || sq.includes(k))) return true;
      if (habits.omitPromises && PROMISE_RE.test(t)) return false;
      if (habits.omitFiller && FILLER_RE.test(t)) return false;
      return true;
    });
    return kept.join(" ");
  });
  const out = lines.join("\n");
  return out.replace(/\s+/g, "") ? out : text;
}

/** 항목별 글(■ 제목 + 본문)에 적용 — `skipTitles`(사랑의 한마디·수업 평가)는 그대로, 본문이 다 지워지는 항목은 원래 본문. */
export function applyHabitsToSections(
  text: string,
  habits: TeacherHabits,
  opts: { skipTitles?: readonly string[]; keep?: readonly string[] } = {},
): string {
  if (!habits.omitPromises && !habits.omitFiller) return text;
  const skip = new Set(opts.skipTitles ?? []);
  const blocks = text.split(/\n(?=■)/);
  return blocks
    .map((b) => {
      const nl = b.indexOf("\n");
      if (!b.startsWith("■") || nl < 0) return b;
      const head = b.slice(0, nl);
      const title = head.replace(/^■\s*/, "").trim();
      if (skip.has(title)) return b;
      const body = b.slice(nl + 1);
      // 본문 끝의 빈 줄(항목 사이 띄움)은 그대로 둔다.
      const m = body.match(/(\s*)$/);
      const tail = m ? m[1] : "";
      const core = body.slice(0, body.length - tail.length);
      return `${head}\n${stripHabitSentences(core, habits, opts.keep)}${tail}`;
    })
    .join("\n");
}
