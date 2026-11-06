/**
 * EiE **월간 보고서의 한 달 학습 기록**(숙제 완성도·수업 태도·단어 테스트) — 순수 모듈(Vitest로 잠금).
 *
 * 원장 2026-11-06 *"EIE 월간보고서일경우 해당 달에 쌓은 데이터 가지고 그래프나 도표로 숙제완성도, 수업태도, 단어테스트 통계보는거 추가"*.
 * 재료 = 그 달 그 반의 일일 보고서(`lesson_reports` — homework_score · attitude · daily_test · 글 속 재시험 표시).
 *
 * 🔑 Monthly Test 점수(monthly-eval.ts)와 같은 방식으로 글 안에 **한 줄로 동결**한다 —
 *    `[월간학습 2026-10 | 10-02:100:4:18/20:R | 10-04:-:3:-:-]` (날짜:숙제%:태도 1~5:맞힌/문항:재시험).
 *    보낸 뒤 일일 보고서를 고쳐도 학부모가 받은 월간 보고서는 바뀌지 않는다(인쇄물 동결 원칙).
 * 🔴 줄 **전체**가 이 모양일 때만 자리다 — 문장 속 글자는 그냥 글자.
 */

/** 태도 눈금 — 수학 보고서 표(math-report-pilot-sections `LEVELS`)와 같은 순서(하 → 상). 테스트가 둘이 같은지 잠근다. */
export const LEVELS = ["하", "중하", "중", "중상", "상"] as const;
export type Level = (typeof LEVELS)[number];

export type MonthlyLesson = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** 숙제 완성도 0~100. 숙제가 없었거나 모르면 null. */
  homework: number | null;
  /** 수업 태도 눈금(하~상). 모르면 null. */
  attitude: Level | null;
  /** 단어 테스트 — 안 본 날은 null. */
  word: { right: number; total: number } | null;
  retest: boolean;
};

export type MonthlyActivity = {
  /** `YYYY-MM`. */
  month: string;
  lessons: MonthlyLesson[];
};

/** 한 달 수업 수 상한 — 줄이 끝없이 길어지지 않게(주 5회 × 5주 남짓). */
const MAX_LESSONS = 31;

const cell = (v: number | null) => (v == null ? "-" : String(v));

/** 글에 남는 한 줄. 수업이 없으면 "". */
export function monthlyActivityMarker(a: MonthlyActivity): string {
  if (!a.lessons.length) return "";
  const parts = a.lessons.slice(0, MAX_LESSONS).map((l) =>
    [
      l.date.slice(5),
      cell(l.homework),
      l.attitude ? String(LEVELS.indexOf(l.attitude) + 1) : "-",
      l.word ? `${l.word.right}/${l.word.total}` : "-",
      l.retest ? "R" : "-",
    ].join(":"),
  );
  return `[월간학습 ${a.month} | ${parts.join(" | ")}]`;
}

const LINE = /^\[\s*월간학습\s+(\d{4})-(\d{2})\s*\|(.+)\]$/;
const PART = /^(\d{2})-(\d{2}):(-|\d{1,3}):(-|[1-5]):(-|\d{1,3}\/\d{1,3}):(-|R)$/;

/** 이 줄이 월간 학습 기록 자리면 그 값. 모양이 하나라도 어긋나면 null(글자로 남긴다). */
export function monthlyActivityOfLine(line: string): MonthlyActivity | null {
  const m = LINE.exec(line.trim());
  if (!m) return null;
  const year = m[1]!;
  const lessons: MonthlyLesson[] = [];
  for (const raw of m[3]!.split("|")) {
    const p = PART.exec(raw.trim());
    if (!p) return null;
    const homework = p[3] === "-" ? null : Number(p[3]);
    if (homework != null && homework > 100) return null;
    let word: MonthlyLesson["word"] = null;
    if (p[5] !== "-") {
      const [r, t] = p[5]!.split("/").map(Number);
      if (!t || r! > t) return null;
      word = { right: r!, total: t };
    }
    lessons.push({
      date: `${year}-${p[1]}-${p[2]}`,
      homework,
      attitude: p[4] === "-" ? null : LEVELS[Number(p[4]) - 1]!,
      word,
      retest: p[6] === "R",
    });
  }
  return lessons.length ? { month: `${year}-${m[2]}`, lessons } : null;
}

/** 글에서 첫 월간 학습 기록 자리. 없으면 null. */
export function monthlyActivityOfText(text: string | null | undefined): MonthlyActivity | null {
  for (const line of (text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const a = monthlyActivityOfLine(line);
    if (a) return a;
  }
  return null;
}

export type MonthlyActivitySummary = {
  lessons: number;
  /** 숙제가 있던 수업의 평균 완성도(정수 %). 없으면 null. */
  homeworkAvg: number | null;
  homeworkCount: number;
  /** 태도 눈금별 횟수(하 → 상). */
  attitudeCounts: Record<Level, number>;
  attitudeCount: number;
  /** 단어 테스트 평균 정답률(정수 %). 없으면 null. */
  wordAvg: number | null;
  wordCount: number;
  retestCount: number;
};

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : null);

/** 그래프·표에 쓰는 요약 — 값이 없는 수업은 그 항목 평균에서 뺀다(지어내지 않는다). */
export function summarizeMonthlyActivity(a: MonthlyActivity): MonthlyActivitySummary {
  const hw = a.lessons.map((l) => l.homework).filter((v): v is number => v != null);
  const words = a.lessons.map((l) => l.word).filter((w) => w != null);
  const attitudeCounts = Object.fromEntries(LEVELS.map((lv) => [lv, 0])) as Record<Level, number>;
  for (const l of a.lessons) if (l.attitude) attitudeCounts[l.attitude] += 1;
  return {
    lessons: a.lessons.length,
    homeworkAvg: avg(hw),
    homeworkCount: hw.length,
    attitudeCounts,
    attitudeCount: LEVELS.reduce((s, lv) => s + attitudeCounts[lv], 0),
    wordAvg: avg(words.map((w) => (w.right / w.total) * 100)),
    wordCount: words.length,
    retestCount: a.lessons.filter((l) => l.retest).length,
  };
}
