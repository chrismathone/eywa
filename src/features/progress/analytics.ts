/**
 * 진도 컨테이너 — 분석 순수함수 (edutrix lib/progress-analytics/* 공식 이식).
 * 속도(forward-only·수업일 기준) / 또래 백분위 / 미래 예측. DB 접근 없음(입력은 배열). Vitest 대상.
 */
import { TOTAL_LESSONS } from "./curriculum-position";
import { diffDays } from "@/lib/date-kst";

/** UTC 기준 날짜 파싱(TZ 무관) — "YYYY-MM-DD" */
function ymdToUtc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
function shiftDays(iso: string, delta: number): string {
  return new Date(ymdToUtc(iso) + delta * 86400000).toISOString().slice(0, 10);
}
export type ProgressEntry = { globalPosition: number; entryDate: string }; // entryDate = "YYYY-MM-DD"

export type SpeedStats = {
  advancement: number; // 최근 창(sinceDays) 내 인접 엔트리 양(+) delta 합(forward-only)
  lessonDays: number; // 창 내 distinct 엔트리 날짜 수(≈ 수업일)
  speedPerLessonDay: number; // 표시용: 수업당 진도 차시
  speedPerDay: number; // 예측용: 달력일당 진도(실제 창 span 기준)
  windowEntries: number;
};

/**
 * 속도 통계 — 최근 sinceDays 창의 엔트리에서 forward-only 진도량을 산출.
 * advancement = 인접(날짜순) 엔트리 간 max(0, delta) 합(복습/역행 0 기여, 리포트 빈도 artifact 제거).
 * speedPerLessonDay = advancement / distinct 날짜수(edutrix computeSpeedPerLessonDay).
 * speedPerDay = advancement / 실제 창 span(달력일) — 예측용(edutrix calculateProgressSpeed).
 */
export function computeSpeedStats(entries: ProgressEntry[], sinceDays: number, todayIso: string): SpeedStats {
  const start = shiftDays(todayIso, -sinceDays);
  const win = entries
    .filter((e) => e.entryDate >= start)
    .sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : a.globalPosition - b.globalPosition));
  const lessonDays = new Set(win.map((e) => e.entryDate)).size;
  if (win.length < 2) {
    return { advancement: 0, lessonDays, speedPerLessonDay: 0, speedPerDay: 0, windowEntries: win.length };
  }
  let advancement = 0;
  for (let i = 1; i < win.length; i++) {
    advancement += Math.max(0, win[i]!.globalPosition - win[i - 1]!.globalPosition);
  }
  // 창이 하루 이내(같은 날짜만)면 span=0 → 일당 속도 산출 불가 → 0(edutrix days<=0 가드).
  // Math.max(1,…)로 span을 1일로 깔면 하루치 전진을 매일 반복으로 외삽해 허위 예측이 난다.
  const span = diffDays(win[0]!.entryDate, win[win.length - 1]!.entryDate);
  return {
    advancement,
    lessonDays,
    speedPerLessonDay: lessonDays > 0 ? advancement / lessonDays : 0,
    speedPerDay: span >= 1 ? advancement / span : 0,
    windowEntries: win.length,
  };
}

/**
 * 또래 백분위(상위 %) — 같은 (학년 × track) 속도 풀 대비. 중간순위법: (below + equal/2)/count*100.
 * 표본 없으면 null, 1명이면 50(비교불가). 반환은 0~100(클수록 빠름=상위).
 */
export function percentileOf(speed: number, pool: number[]): number | null {
  const p = pool.filter((x) => Number.isFinite(x));
  if (p.length === 0 || !Number.isFinite(speed)) return null;
  if (p.length === 1) return 50;
  const below = p.filter((x) => x < speed).length;
  const equal = p.filter((x) => x === speed).length;
  return Math.round(((below + equal / 2) / p.length) * 100);
}

export type Prediction = { days: number; position: number };

/** 미래 위치 예측 — pos + speedPerDay*d, 커리큘럼 범위 clamp. speed≤0이면 제자리. */
export function predict(currentPosition: number, speedPerDay: number, daysAhead: number[] = [30, 90]): Prediction[] {
  return daysAhead.map((days) => {
    const raw = currentPosition + speedPerDay * days;
    const position = !Number.isFinite(raw) ? currentPosition : Math.min(TOTAL_LESSONS, Math.max(1, Math.round(raw)));
    return { days, position };
  });
}
