/**
 * **원래 월간계획 ↔ 실제 수업** 대조 — 판정 단일 소스(순수, Vitest).
 *
 * 원장 2026-09-28: *"주간, 달력에서 해당 수업의 진도와 원래 월간계획을 바로 비교할 수 있는 기능"* +
 * *"월간계획과 선생님별 실제계획과 어느정도 틀린지 월별로 바로바로 볼수있는 페이지"*.
 * 교시 칸의 비교 모달과 월별 현황 페이지가 **이 함수 하나**를 통과한다 — 둘이 따로 판정하면 한 칸이
 * 모달에선 '일치'인데 현황표에선 '다름'으로 세어진다.
 *
 * 🔑 기준은 **원래 계획**(미루기·당기기를 반영하지 않은 계획)이다(원장 2026-09-28 *"계획 놔두고 일정만
 *    밀리게"*). 미루면 실제가 원래 계획보다 **늦어지고**, 그 늦음이 곧 이 화면들이 보여 줄 사실이다.
 * 🔑 늦음·빠름은 **차수로** 잰다 — 실제 진도 문구를 그 교재의 차수표에서 찾아 몇 차수인지 되짚는다.
 *    문구를 못 찾으면(강사가 고쳐 쓴 진도) 늦음을 지어내지 않고 '다름'으로 둔다.
 * 🔴 표기 흔들림은 어긋남이 아니다 — 교재는 [`sameBookName`](../class-sheets/lib/goal-match.ts),
 *    진도는 공백·대소문자만 접어 비교한다.
 */
import { normalizeBookName, sameBookName } from "@/features/class-sheets/lib/goal-match";

/** 비교에 필요한 원래 계획 한 줄(= `PlannedLine`의 일부). */
export type BaselineLine = {
  lessonNo: number;
  skillArea: string;
  title: string;
  progress: string | null;
};

/** 비교에 필요한 실제 줄 한 줄(= 평시 구획의 `class_sheet_plan_lines`). */
export type ActualLine = {
  skillArea: string;
  textbook: string | null;
  progress: string | null;
};

/**
 * 교재별 차수표 — `normalizeBookName(교재명)` → `normalizeProgress(진도)` → 차수.
 * 같은 문구가 두 차수에 있으면 **앞 차수**를 쓴다(늦음을 과장하지 않는 쪽).
 */
export type LessonIndex = Record<string, Record<string, number>>;

export type LineVerdict = "match" | "behind" | "ahead" | "differ" | "missing";

/**
 * 칸 하나의 판정.
 * - `noPlan`    원래 계획이 없는 칸(비교 대상 아님)
 * - `upcoming`  아직 안 온 날(실제가 없어도 미작성이 아니다)
 * - `unwritten` 지난 날인데 실제가 비어 있다
 * - `match`     원래 계획대로 나갔다
 * - `behind`    같은 교재인데 원래 계획보다 **앞 차수**를 했다(미루기·지연)
 * - `ahead`     같은 교재인데 원래 계획보다 **뒤 차수**를 했다
 * - `differ`    교재가 다르거나, 진도를 차수표에서 찾을 수 없다
 */
export type CellVerdict = "noPlan" | "upcoming" | "unwritten" | "match" | "behind" | "ahead" | "differ";

export type LineCompare = {
  baseline: BaselineLine;
  /** 같은 구분·같은 교재로 짝지은 실제 줄(없으면 null). */
  actual: ActualLine | null;
  /** 실제 진도를 차수표에서 찾은 차수(못 찾으면 null). */
  actualLessonNo: number | null;
  verdict: LineVerdict;
};

export type CellCompare = {
  verdict: CellVerdict;
  /** 늦거나 빠른 차수(양수). `behind`/`ahead`일 때만 의미가 있다. */
  lag: number;
  lines: LineCompare[];
};

/** 진도 비교 키 — 공백을 접고 소문자로. 표시에는 쓰지 않는다. */
export function normalizeProgress(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 차수표 한 권 추가(호출부가 교재마다 부른다). 이미 있는 문구는 앞 차수를 지킨다. */
export function addToLessonIndex(
  index: LessonIndex,
  title: string,
  lessons: Iterable<{ lessonNo: number; progress: string | null }>,
): void {
  const key = normalizeBookName(title);
  if (!key) return;
  const map = (index[key] ??= {});
  for (const l of lessons) {
    const p = normalizeProgress(l.progress);
    if (!p) continue;
    if (map[p] === undefined || l.lessonNo < map[p]!) map[p] = l.lessonNo;
  }
}

/** 실제 진도 → 그 교재의 몇 차수인가(교재명은 표기 흔들림을 허용해 찾는다). */
export function lessonNoOf(index: LessonIndex, title: string, progress: string | null): number | null {
  const p = normalizeProgress(progress);
  if (!p) return null;
  const direct = index[normalizeBookName(title)];
  if (direct && direct[p] !== undefined) return direct[p]!;
  for (const [book, map] of Object.entries(index)) {
    if (map[p] !== undefined && sameBookName(book, title)) return map[p]!;
  }
  return null;
}

/** 실제 줄이 뭔가 적힌 줄인가(구분만 고른 빈 줄은 없는 것과 같다). */
function hasContent(l: ActualLine): boolean {
  return !!(String(l.textbook ?? "").trim() || String(l.progress ?? "").trim());
}

export function compareCell(input: {
  baseline: readonly BaselineLine[];
  /** 그 칸 **평시** 구획의 실제 줄(내신 줄은 넘기지 않는다 — 배정은 평시 축뿐이다). */
  actual: readonly ActualLine[];
  lessonIndex: LessonIndex;
  /** 그 칸이 오늘보다 뒤인가. 오늘은 지난 날이다(앱 전역 `d <= today` 규약). */
  isFuture: boolean;
}): CellCompare {
  const { baseline, lessonIndex, isFuture } = input;
  const actual = input.actual.filter(hasContent);
  if (baseline.length === 0) return { verdict: "noPlan", lag: 0, lines: [] };

  const used = new Set<number>();
  const lines: LineCompare[] = baseline.map((b) => {
    // 짝 = 같은 구분 + 같은 교재. 🔴 교재가 비어 있는 실제 줄은 **같은 구분일 때만** 짝으로 본다
    //    (`sameBookName`은 한쪽이 비면 true라, 구분까지 안 보면 아무 줄이나 짝이 된다).
    const idx = actual.findIndex(
      (a, i) =>
        !used.has(i) &&
        a.skillArea === b.skillArea &&
        !!String(a.textbook ?? "").trim() &&
        sameBookName(a.textbook, b.title),
    );
    const fallback =
      idx >= 0
        ? idx
        : actual.findIndex((a, i) => !used.has(i) && a.skillArea === b.skillArea && !String(a.textbook ?? "").trim());
    if (fallback < 0) return { baseline: b, actual: null, actualLessonNo: null, verdict: "missing" };
    used.add(fallback);
    const a = actual[fallback]!;
    const planned = normalizeProgress(b.progress);
    const done = normalizeProgress(a.progress);
    // 원래 계획에 진도 문구가 없으면 교재가 같다는 것까지만 알 수 있다 — 그걸로 일치로 본다.
    if (!planned || planned === done) {
      return { baseline: b, actual: a, actualLessonNo: planned ? b.lessonNo : null, verdict: "match" };
    }
    const no = lessonNoOf(lessonIndex, b.title, a.progress);
    if (no === null || no === b.lessonNo) {
      return { baseline: b, actual: a, actualLessonNo: no, verdict: no === b.lessonNo ? "match" : "differ" };
    }
    return { baseline: b, actual: a, actualLessonNo: no, verdict: no < b.lessonNo ? "behind" : "ahead" };
  });

  if (actual.length === 0) {
    return { verdict: isFuture ? "upcoming" : "unwritten", lag: 0, lines };
  }
  // 칸 판정 — 하나라도 다르면 '다름'(교재가 빠졌거나 못 찾는 진도), 아니면 늦음 > 빠름 > 일치.
  if (lines.some((l) => l.verdict === "differ" || l.verdict === "missing")) {
    return { verdict: "differ", lag: 0, lines };
  }
  const lagOf = (l: LineCompare) => Math.abs((l.actualLessonNo ?? l.baseline.lessonNo) - l.baseline.lessonNo);
  const behind = lines.filter((l) => l.verdict === "behind");
  if (behind.length > 0) return { verdict: "behind", lag: Math.max(...behind.map(lagOf)), lines };
  const ahead = lines.filter((l) => l.verdict === "ahead");
  if (ahead.length > 0) return { verdict: "ahead", lag: Math.max(...ahead.map(lagOf)), lines };
  return { verdict: "match", lag: 0, lines };
}

/** 월별 집계 한 벌 — 현황 페이지의 한 줄(선생님·반). */
export type CompareTally = {
  /** 원래 계획이 있는 **지난** 칸(오늘 포함) — 판정 분모. */
  due: number;
  match: number;
  behind: number;
  ahead: number;
  differ: number;
  unwritten: number;
  /** 원래 계획이 있지만 아직 안 온 칸(분모 밖). */
  upcoming: number;
  /** 늦은 칸들의 늦은 차수 합(평균 = lagSum / behind). */
  lagSum: number;
};

export function emptyTally(): CompareTally {
  return { due: 0, match: 0, behind: 0, ahead: 0, differ: 0, unwritten: 0, upcoming: 0, lagSum: 0 };
}

/** 칸 판정 하나를 집계에 더한다. `noPlan`은 세지 않는다(견줄 계획이 없다). */
export function addToTally(t: CompareTally, c: CellCompare): void {
  switch (c.verdict) {
    case "noPlan":
      return;
    case "upcoming":
      t.upcoming += 1;
      return;
    case "unwritten":
      t.due += 1;
      t.unwritten += 1;
      return;
    case "match":
      t.due += 1;
      t.match += 1;
      return;
    case "behind":
      t.due += 1;
      t.behind += 1;
      t.lagSum += c.lag;
      return;
    case "ahead":
      t.due += 1;
      t.ahead += 1;
      return;
    case "differ":
      t.due += 1;
      t.differ += 1;
      return;
  }
}

export function mergeTally(into: CompareTally, from: CompareTally): void {
  for (const k of Object.keys(into) as (keyof CompareTally)[]) into[k] += from[k];
}

/** 일치율(%) — 분모 0이면 null(0%로 적으면 "하나도 안 맞았다"는 거짓이 된다). */
export function matchRate(t: CompareTally): number | null {
  return t.due === 0 ? null : Math.round((t.match / t.due) * 100);
}

/**
 * 판정 → 의미색(tone) — 칸 배지·모달·현황표가 **같은 색**을 쓴다(의미색 캐논, semantic-color.ts).
 * 계획대로=정상(초록) · 늦음=진행 중(파랑) · 빠름=예외(보라) · 미작성=주의(앰버) · 다름=위험(빨강) · 그 외=무채.
 */
export const VERDICT_TONE = {
  noPlan: "inert",
  upcoming: "inert",
  unwritten: "caution",
  match: "positive",
  behind: "info",
  ahead: "special",
  differ: "critical",
} as const satisfies Record<CellVerdict, "positive" | "caution" | "critical" | "info" | "special" | "inert">;
