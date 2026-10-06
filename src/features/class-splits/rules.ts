/**
 * 수업 나누기(0351a) **순수 규칙** — 시간 단위·고를 수 있는 시작 시각·기간·활성 판정·표시 문구.
 *
 * 원장(2026-10-06): *"화금 이성우 수업 3시간에서 1시간만 유형숙으로"* → *"시작시간 하고 정하면 되는 거 아님?"* →
 * *"수학은 1시간 EiE 40분이면 EiE는 40분 기준"* → *"기간도 일별 월별 영구적 지정 가능하게"*.
 *
 * 🔴 수강이 아니다 — 인원·청구·재원 집계에 닿는 값을 여기서 만들지 않는다(수강료는 원래 반 기준).
 * ⚠️ 클라(팝업)도 import한다 — `server-only` 금지([[#61]]).
 */

export type SplitDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type SplitPeriodKind = "day" | "month" | "forever";

const DAYS: readonly SplitDay[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const SPLIT_DAY_KO: Record<SplitDay, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

export function isSplitDay(v: unknown): v is SplitDay {
  return typeof v === "string" && (DAYS as readonly string[]).includes(v);
}

export const PERIOD_KIND_LABEL: Record<SplitPeriodKind, string> = {
  day: "일별",
  month: "월별",
  forever: "영구",
};

/** DB에 저장된 한 건(조회 결과를 앱 모양으로). */
export type ClassSplit = {
  id: string;
  studentId: string;
  sourceClassId: string;
  targetClassId: string;
  dayOfWeek: SplitDay;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
  validFrom: string;
  /** null = 영구 */
  validTo: string | null;
  periodKind: SplitPeriodKind;
  note: string | null;
};

/** "HH:MM[:SS]" → 자정 기준 분. 형식이 아니면 NaN. */
export function toMin(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 분 → "HH:MM". */
export function toHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 나누는 **시간 단위(분)** — 수학 1시간 · EiE 40분(원장 2026-10-06).
 * 🔑 판정은 받는 반과 원래 반 중 **하나라도 EiE면 40분**이다(EiE 교시 위에 1시간을 얹으면 칸이 안 맞는다).
 * EiE 판정은 `classes.english_track` 컬럼 하나(반 이름으로 추측 금지 — CLAUDE.md 결정 로그).
 */
export function splitUnitMinutes(classes: readonly { subject: string | null; englishTrack: string | null }[]): number {
  return classes.some((c) => c.subject === "english" && c.englishTrack === "eie") ? 40 : 60;
}

export type TimeWindow = { start: number; end: number };

/** 이어 붙은 구간을 하나로(교시마다 행이 따로인 반 — 16:20~17:20 + 17:20~18:20 → 16:20~18:20). */
export function mergeWindows(windows: readonly TimeWindow[]): TimeWindow[] {
  const sorted = windows
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  const out: TimeWindow[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else out.push({ ...w });
  }
  return out;
}

/** 두 반이 **같이 도는** 구간 — 나눌 수 있는 시간은 이 안뿐이다. */
export function intersectWindows(a: readonly TimeWindow[], b: readonly TimeWindow[]): TimeWindow[] {
  const out: TimeWindow[] = [];
  for (const x of mergeWindows(a)) {
    for (const y of mergeWindows(b)) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return mergeWindows(out);
}

/**
 * 고를 수 있는 **시작 시각** — 겹치는 구간의 시작에서 단위만큼씩, 한 단위가 통째로 들어가는 자리만.
 * 예: 16:20~19:20 · 60분 → 16:20·17:20·18:20.
 */
export function startOptions(windows: readonly TimeWindow[], unit: number): number[] {
  if (!(unit > 0)) return [];
  const out: number[] = [];
  for (const w of mergeWindows(windows)) {
    for (let s = w.start; s + unit <= w.end; s += unit) out.push(s);
  }
  return out;
}

/** 그 시작에서 고를 수 있는 **최대 단위 수**(그 구간 끝까지). 시작이 어느 구간에도 없으면 0. */
export function maxUnitsFrom(windows: readonly TimeWindow[], start: number, unit: number): number {
  if (!(unit > 0)) return 0;
  const w = mergeWindows(windows).find((x) => start >= x.start && start < x.end);
  if (!w) return 0;
  return Math.floor((w.end - start) / unit);
}

/** 길이(분) 표시 — 60의 배수면 "N시간", 아니면 "N분"(EiE 40분·80분). */
export function durationLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60}시간`;
  return `${minutes}분`;
}
