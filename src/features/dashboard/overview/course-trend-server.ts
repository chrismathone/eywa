import "server-only";
import { monthlyPoints, weeklyPoints, yearlyPoints } from "./enrolled-trend";
import { courseBreakdownOf, type CourseRow } from "./course-trend";
import { DETAIL_MONTHS, DETAIL_WEEKS, type TrendSeriesSet } from "./enrolled-trend-server";
import { trendInputs } from "./trend-inputs-server";
import { PROGRAMS, programOf, type Program, type ProgramSubject } from "@/features/students/enrollment/program";

/** 원생 통계 '강좌수 추이'(원장 2026-10-20 '카드 따로') — 첫 선(학원 전체 · 과목 관리자는 담당 과목 전체) + 프로그램별 선. */
export type CourseTrendDetail = { total: TrendSeriesSet; byProgram: ({ key: Program } & TrendSeriesSet)[] };

/**
 * 강좌수 추이(자세히) — 운영실 '강좌수 추이' 카드와 **같은 원본·같은 판정**(`courseBreakdownOf` → `coursesOn`)을 원생 통계의 긴 창
 * (월별 36개월 · 주별 26주 · 연도별)으로. 프로그램 = 수강 반의 과목·영어 프로그램(`programOf` — 운영실 '강좌수' 칸과 같은 판정 ·
 * 세 프로그램 밖 과목은 첫 선에만). 원본은 재원생 추이와 같은 5분 캐시를 나눠 쓴다(B6). 아래 경계(에이와 기록이 갖춰진 달 등)는
 * 화면(page.tsx)이 재원생 추이와 같은 값으로 자른다.
 * `scope` = 과목 관리자(원장 2026-10-20 *"자기 과목만"* — 운영실과 같은 판정) — 주면 담당 과목 반만 세고, 프로그램 선도 담당 쪽만.
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
  const programOfRow = (e: CourseRow) => programOf({ subject: e.subject, englishTrack: e.englishTrack ?? null }, subjects);
  const count = (points: { key: string; label: string; date: string }[]) =>
    courseBreakdownOf(raw.students, en, raw.enrollments, points, PROGRAMS, programOfRow, today, inRow);
  const split = { monthly: count(monthlyPoints(today, DETAIL_MONTHS)), weekly: count(weeklyPoints(today, DETAIL_WEEKS)), yearly: count(yearlyPoints(today, raw.fromYear)) };
  // 과목 관리자는 담당 과목이 든 프로그램만(영어 관리자 화면에 '수학' 선이 서지 않게 — 운영실 '재원생' 칸과 같은 결). 영어 과목은 EiE·인재원 영어 둘 다.
  const scoped = new Set(subjects.filter((s) => scope?.(s.key)).map((s) => programOf({ subject: s.key }, subjects)));
  const inScope = (p: Program) => !scope || (p === "math" ? scoped.has("math") : scoped.has("eie") || scoped.has("injaewon"));
  return {
    total: { monthly: split.monthly.total, weekly: split.weekly.total, yearly: split.yearly.total },
    byProgram: PROGRAMS.filter(inScope).map((key) => ({ key, monthly: split.monthly.groups[key], weekly: split.weekly.groups[key], yearly: split.yearly.groups[key] })),
  };
}
