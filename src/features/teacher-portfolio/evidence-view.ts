/**
 * 직원 포트폴리오 내역 표의 표시 규칙(원장 2026-10-16) — 요일 붙은 날짜 · 총점의 지난달 비교 · 보고서 반별 표 · 성적 시험 종류별 줄.
 * 순수 모듈(서버·클라이언트 공용). 값은 `model/`이 저장한 것을 그대로 쓰고 새로 판정하지 않는다.
 */
import { KIND_LABEL } from "@/features/grades/unified/model";
import { shiftMonth } from "@/lib/date-kst";
import type { GradeKind, GradeKindStat, GradeRow } from "./model/source-types";
import type { ReportCell, ReportState, StoredPeriod } from "./model/types";
import { dayLabel, periodMax, shownItems } from "./view";

const WEEKDAYS = "일월화수목금토";
/** "2026-09-01" → "화". 날짜 글자만 보고 정한다(시각대와 상관없다). */
export const weekdayOf = (ymd: string): string => WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()] ?? "";
/** "2026-09-01" → "09.01 (화)" — 내역 표의 날짜 칸(원장 2026-10-16 *"날짜에 요일도"*). */
export const dayWeekLabel = (ymd: string): string => `${dayLabel(ymd)} (${weekdayOf(ymd)})`;

/** 바로 앞 달 — 달 목록은 저장된 달만 오므로 사이가 비면 `index + 1`이 두 달 전일 수 있다. */
export function previousPeriod<T extends { month: string }>(periods: readonly T[], month: string): T | undefined {
  const before = shiftMonth(month, -1);
  return periods.find((w) => w.month === before);
}

/**
 * 총점의 지난달 값(원장 2026-10-16 *"지난달을 기준으로 가감이 몇점인지도"*) — 바로 앞 달이 있고 두 달 모두 합계가 서고
 * 만점이 같을 때만(만점이 다르면 차이가 실적이 아니라 배점 변화다 — 항목 증감의 `beforeOf`와 같은 결).
 * 지난달에 계산 전이던 항목이 이번 달엔 계산됐어도 견주지 않는다 — 그 0점은 잰 값이 아니다(리뷰 2026-10-16).
 */
type TotalSide = Pick<StoredPeriod, "total" | "evaluation" | "knownMax" | "items">;
export function totalBefore(period: TotalSide, previous: TotalSide | undefined): number | null {
  if (!previous || period.total === null || previous.total === null) return null;
  if (periodMax(previous) !== periodMax(period)) return null;
  const still = new Set(shownItems(period).filter((m) => m.uncounted).map((m) => m.id));
  return shownItems(previous).some((m) => m.uncounted && !still.has(m.id)) ? null : previous.total;
}

/** 보고서 학생 × 날짜 표의 기호(원장 2026-10-16 — 작성 O · 미작성 빗금). */
export const reportMark = (state: ReportState): { mark: string; label: string; done: boolean } =>
  state === "own" ? { mark: "O", label: "작성", done: true } : { mark: "/", label: "미작성", done: false };

export type ReportClassGroup = {
  className: string; days: string[]; students: string[]; missing: number; cells: ReadonlyMap<string, ReportState>;
};
/**
 * 보고서 칸을 반별로 나눈다(원장 2026-10-16 *"반별 분리해서 이름 학교 학년"*) — 열 = 그 반에 보고 대상이 있던 날만 ·
 * 줄 = 그 반 칸이 있는 학생. 달 중간에 반을 옮긴 학생은 두 반에 다 선다(칸은 한 번씩만).
 * 같은 날 이 강사의 두 반 대상인 칸은 반 이름이 이어 붙어 온다(`duties.ts` — "A반, B반") — 첫 반 표에 한 번만 둔다(리뷰 2026-10-16).
 */
export function reportGroups(cells: readonly ReportCell[], nameOf: (studentId: string) => string): ReportClassGroup[] {
  const byClass = new Map<string, ReportCell[]>();
  for (const c of cells) {
    const key = c.className.split(", ")[0] || "반 미상";
    byClass.set(key, [...(byClass.get(key) ?? []), c]);
  }
  return [...byClass].sort(([a], [b]) => a.localeCompare(b, "ko")).map(([className, xs]) => ({
    className,
    days: [...new Set(xs.map((c) => c.day))].sort(),
    students: [...new Set(xs.map((c) => c.studentId))].sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ko")),
    missing: xs.filter((c) => c.state !== "own").length,
    cells: new Map(xs.map((c) => [`${c.studentId}|${c.day}`, c.state])),
  }));
}

/** 점수율 시험 한 종류의 학생 값 — 2026-10-16 전에 저장된 줄은 `kinds` 글자("확인테스트 2")로 시험 수를 세고, 평균은 그 종류만 본 학생일 때만. */
export function scoredKindOf(row: GradeRow, kind: GradeKind): { count: number; average: number | null } | null {
  const stored = row.byKind?.[kind];
  if (stored) return stored;
  if (row.byKind) return null;
  const hit = new RegExp(`(?:^|· )${KIND_LABEL[kind]} (\\d+)(?: ·|$)`).exec(row.kinds);
  const count = hit ? Number(hit[1]) : 0;
  return count ? { count, average: row.tests === count ? row.average : null } : null;
}

/**
 * 시험 종류 탭의 학생 줄 — 제출률(일일테스트) = 제출 칸이 있는 학생 · 응시율(월말평가) = 응시 대상 · 점수율 = 그 종류 시험을 본 학생.
 * 셈은 그 달 종류 줄의 `measure`로 고른다 — 10-15 전에 저장된 달은 일일테스트·월말평가도 점수율이다.
 */
export function gradeRowsOf(rows: readonly GradeRow[], kind: GradeKind, measure?: GradeKindStat["measure"]): GradeRow[] {
  if (measure === "submit") return rows.filter((r) => r.daily);
  if (measure === "take") return rows.filter((r) => r.monthly !== undefined);
  return rows.filter((r) => scoredKindOf(r, kind));
}
