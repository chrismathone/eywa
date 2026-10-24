import "server-only";
import { monthlyPoints, weeklyPoints, yearlyPoints } from "./enrolled-trend";
import { courseBreakdownOf, type CourseRow } from "./course-trend";
import { DETAIL_MONTHS, DETAIL_WEEKS, type TrendSeriesSet } from "./enrolled-trend-server";
import { trendInputs } from "./trend-inputs-server";
import { subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";

/** 원생 통계 '강좌수 추이'(원장 2026-10-20 '카드 따로') — 첫 선(학원 전체 · 과목 관리자는 담당 과목 전체) + 과목별 선. */
export type CourseTrendDetail = { total: TrendSeriesSet; bySubject: ({ key: string } & TrendSeriesSet)[] };

/**
 * 강좌수 추이(자세히) — 운영실 '강좌수 추이' 카드와 **같은 원본·같은 판정**(`courseBreakdownOf` → `coursesOn`)을 원생 통계의 긴 창
 * (월별 36개월 · 주별 26주 · 연도별)으로. 과목 = 학원 설정의 묶음(`subjectGroupOf` — 운영실 강좌수와 같은 판정). 원본은 재원생 추이와 같은 5분 캐시를 나눠 쓴다(B6). 아래 경계(에이와 기록이 갖춰진 달 등)는
 * 화면(page.tsx)이 재원생 추이와 같은 값으로 자른다.
 * `scope` = 과목 관리자(원장 2026-10-20 *"자기 과목만"* — 운영실과 같은 판정) — 주면 담당 과목 반만 세고, 과목 선도 담당 쪽만.
 * `subjects` = 학원설정 `operations.subjects`(레거시 라벨이 섞인 표를 넘기지 말 것 — programOf 규약).
 */
export async function loadCourseTrendDetail(
  tenantId: string,
  today: string,
  subjects: readonly ProgramSubject[],
  scope?: (subject: string | null) => boolean,
): Promise<CourseTrendDetail> {
  const { raw, en } = await trendInputs(tenantId, today);
  const inRow = scope ? (e: CourseRow) => scope(e.subject) : undefined;
  const keys = [...new Set([...subjects.map((s) => s.key), ...raw.enrollments.map((e) => e.subject)].map((key) => subjectGroupOf(key, subjects)).filter((key): key is string => key !== null))];
  const groupOfRow = (e: CourseRow) => subjectGroupOf(e.subject, subjects);
  const count = (points: { key: string; label: string; date: string }[]) =>
    courseBreakdownOf(raw.students, en, raw.enrollments, points, keys, groupOfRow, today, inRow, subjects);
  const split = { monthly: count(monthlyPoints(today, DETAIL_MONTHS)), weekly: count(weeklyPoints(today, DETAIL_WEEKS)), yearly: count(yearlyPoints(today, raw.fromYear)) };
  return {
    total: { monthly: split.monthly.total, weekly: split.weekly.total, yearly: split.yearly.total },
    bySubject: keys.filter((key) => !scope || subjects.some((s) => scope(s.key) && subjectGroupOf(s.key, subjects) === key)).map((key) => ({ key, monthly: split.monthly.groups[key], weekly: split.weekly.groups[key], yearly: split.yearly.groups[key] })),
  };
}
