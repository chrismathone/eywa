import "server-only";
import { monthlyPoints, weeklyPoints, yearlyPoints } from "./enrolled-trend";
import { courseBreakdownOf, type CourseRow } from "./course-trend";
import { DETAIL_MONTHS, DETAIL_WEEKS, type TrendSeriesSet } from "./enrolled-trend-server";
import { trendInputs } from "./trend-inputs-server";
import { ENGLISH_PROGRAM_KEYS, isEnglishProgramKey, programOf, subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";

/** 원생 통계 '강좌수 추이'(원장 2026-10-20 '카드 따로') — 첫 선(학원 전체 · 과목 관리자는 담당 과목 전체) + 과목별 선. */
export type CourseTrendDetail = { total: TrendSeriesSet; bySubject: ({ key: string } & TrendSeriesSet)[]; /** 영어를 인재원 영어 · EiE로 갈랐나. */ englishSplit?: boolean };

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
  /**
   * 영어 선을 **인재원 영어 · EiE** 둘로(원장 2026-10-29 — EiE 모듈이 켜진 지점만 호출부가 켠다). 전체 강좌도 두 강좌로 센다(원장 2026-10-30
   * *"사업자가 다르고 금액도 상이하므로 분리"* — 운영실 '강좌수' 칸과 같은 판정) — 과목 선의 합 = 전체.
   */
  splitEnglish = false,
): Promise<CourseTrendDetail> {
  const { raw, en } = await trendInputs(tenantId, today);
  const inRow = scope ? (e: CourseRow) => scope(e.subject) : undefined;
  const groupKeys = [...new Set([...subjects.map((s) => s.key), ...raw.enrollments.map((e) => e.subject)].map((key) => subjectGroupOf(key, subjects)).filter((key): key is string => key !== null))];
  const split = splitEnglish && groupKeys.includes("english") && !subjects.some((s) => isEnglishProgramKey(s.key));
  const keys = split ? groupKeys.flatMap((k) => (k === "english" ? [...ENGLISH_PROGRAM_KEYS] : [k])) : groupKeys;
  const groupOfRow = (e: CourseRow) => {
    const g = subjectGroupOf(e.subject, subjects);
    if (!split || g !== "english") return g;
    return programOf({ subject: e.subject, englishTrack: e.englishTrack ?? null }, subjects) === "eie" ? "eie" : "injaewon";
  };
  const count = (points: { key: string; label: string; date: string }[]) =>
    courseBreakdownOf(raw.students, en, raw.enrollments, points, keys, groupOfRow, today, inRow, subjects);
  const sets = { monthly: count(monthlyPoints(today, DETAIL_MONTHS)), weekly: count(weeklyPoints(today, DETAIL_WEEKS)), yearly: count(yearlyPoints(today, raw.fromYear)) };
  const groupOfKey = (key: string) => (split && isEnglishProgramKey(key) ? "english" : key);
  return {
    total: { monthly: sets.monthly.total, weekly: sets.weekly.total, yearly: sets.yearly.total },
    englishSplit: split,
    bySubject: keys.filter((key) => !scope || subjects.some((s) => scope(s.key) && subjectGroupOf(s.key, subjects) === groupOfKey(key))).map((key) => ({ key, monthly: sets.monthly.groups[key], weekly: sets.weekly.groups[key], yearly: sets.yearly.groups[key] })),
  };
}
