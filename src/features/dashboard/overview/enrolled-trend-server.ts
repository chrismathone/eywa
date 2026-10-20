import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { isCleanupExit } from "@/features/withdrawals/system-bulk";
import { MIX_KEYS, breakdownTrendOf, monthlyPoints, subjectTrendOf, trendOf, weeklyPoints, yearlyPoints, type MixKey, type TrendEnrollment, type TrendPoint, type TrendStudent } from "./enrolled-trend";
import { subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";

export type EnrolledTrend = { monthly: TrendPoint[]; yearly: TrendPoint[]; recordsFrom: string | null };

/**
 * 재원생 추이(월별 12개월 · 연도별) — 운영실 30초 갱신마다 원생·수강 전건을 다시 읽지 않게 **지점·날짜별 5분 캐시**
 * (B6 — 쿠키 없는 admin client + 신뢰 tenantId 키, `tenant_id` 필터 필수 [[#104]]). 오늘 점이 카드보다 최대 5분 늦을 수 있다.
 * 연도별은 **퇴원 기록이 있는 첫 해**부터 — 그 전 해는 퇴원이 기록되지 않아 재원생이 부풀어 보인다(실측 첫 퇴원 2025-02).
 */
export function loadEnrolledTrend(tenantId: string, today: string): Promise<EnrolledTrend> {
  return unstable_cache(() => computeEnrolledTrend(tenantId, today), ["dashboard-enrolled-trend", tenantId, today], {
    revalidate: 300,
  })();
}

async function computeEnrolledTrend(tenantId: string, today: string): Promise<EnrolledTrend> {
  const db = createAdminClient();
  const [students, enrollments] = await Promise.all([
    fetchAllPaged<{ id: string; status: string; enrolled_at: string | null; withdrawn_at: string | null; notes: string | null; withdrawal_metadata: unknown }>((from, to) =>
      db.from("students").select("id,status,enrolled_at,withdrawn_at,notes,withdrawal_metadata").eq("tenant_id", tenantId).order("id").range(from, to),
    ),
    fetchAllPaged<{ id: string; student_id: string; start_date: string | null; end_date: string | null }>((from, to) =>
      db.from("enrollments").select("id,student_id,start_date,end_date").eq("tenant_id", tenantId).order("id").range(from, to),
    ),
  ]);
  const firstStart = new Map<string, string>();
  const ended = new Set<string>();
  for (const e of enrollments) {
    if (e.end_date) ended.add(e.student_id);
    if (!e.start_date) continue;
    const cur = firstStart.get(e.student_id);
    if (!cur || e.start_date < cur) firstStart.set(e.student_id, e.start_date);
  }
  const rows: TrendStudent[] = students.map((s) => ({ id: s.id, status: s.status, enrolledAt: s.enrolled_at, withdrawnAt: s.withdrawn_at, notes: s.notes, cleanup: isCleanupExit(s.withdrawal_metadata) }));
  const en = { firstStart, ended };
  // 오늘 이후로 적힌 퇴원(퇴원 예약)은 기록의 시작이 아니다 — 새 지점의 첫 퇴원이 예약이면 미래 달이 경계가 되어 화면이 빈다(리뷰 2026-10-20).
  const firstOut = students.reduce<string | null>((m, s) => (s.withdrawn_at && s.withdrawn_at.slice(0, 10) <= today && (!m || s.withdrawn_at < m) ? s.withdrawn_at : m), null);
  const fromYear = firstOut ? Number(firstOut.slice(0, 4)) : Number(today.slice(0, 4));
  return {
    monthly: trendOf(rows, en, monthlyPoints(today)),
    yearly: trendOf(rows, en, yearlyPoints(today, fromYear)),
    recordsFrom: firstOut ? firstOut.slice(0, 7) : null,
  };
}

type TrendRaw = { students: TrendStudent[]; enrollments: TrendEnrollment[]; firstStart: [string, string][]; ended: string[]; recordsFrom: string | null; fromYear: number };

/**
 * 과목별 재원생 추이(원장 2026-10-14 2단계) — 과목 관리자 화면·미리보기 원본에서만 부른다. 원생·수강(반 과목 포함) 원본을
 * 지점·날짜별 5분 캐시로 받고(학원 전체 추이와 같은 B6 규약), 묶음마다 `subjectTrendOf`로 센다(판정은 순수 함수 한 벌).
 */
export async function loadEnrolledTrendSlicer(tenantId: string, today: string): Promise<(inSubject: (subject: string | null) => boolean) => EnrolledTrend> {
  const raw = await unstable_cache(() => loadTrendRaw(tenantId, today), ["dashboard-enrolled-trend-raw", tenantId, today], { revalidate: 300 })();
  const en = { firstStart: new Map(raw.firstStart), ended: new Set(raw.ended) };
  return (inSubject) => ({
    monthly: subjectTrendOf(raw.students, en, raw.enrollments, monthlyPoints(today), inSubject, today),
    yearly: subjectTrendOf(raw.students, en, raw.enrollments, yearlyPoints(today, raw.fromYear), inSubject, today),
    recordsFrom: raw.recordsFrom,
  });
}

/** 원생 통계 화면의 재원생 추이 — 월별 36개월 · 주별 26주 · 연도별, 학원 전체 · 과목마다 · 수강 구성마다. */
export type TrendSeriesSet = { monthly: TrendPoint[]; weekly: TrendPoint[]; yearly: TrendPoint[] };
export type EnrolledTrendDetail = {
  total: TrendSeriesSet;
  bySubject: ({ key: string } & TrendSeriesSet)[];
  byMix: ({ key: MixKey } & TrendSeriesSet)[];
  /** 재원생인데 그날 걸린 수강이 없는 학생 — 과목·구성으로 가를 수 없는 인원(화면이 신뢰 구간을 가른다). */
  unknown: TrendSeriesSet;
  /** 퇴원 기록이 시작된 달(YYYY-MM) — 그 전 기간은 재원생을 정확히 셀 수 없다. */
  recordsFrom: string | null;
  /**
   * 수강 종료가 처음 기록된 달(YYYY-MM) — 그 전에 끝난 수강은 남아 있지 않아(옛 퇴원생은 수강 행이 없다) 과목·구성을 가를 수 없다.
   * 실측 2026-10-20(침산): 가장 이른 수강 종료 2026-01-31 · 그 전 종료 0건 · 2025-02 재원생 348명 중 165명이 수강 기록 없음.
   * 끝난 수강이 하나도 없으면 null(새 지점 — 처음부터 다 기록돼 있다).
   */
  breakdownFrom: string | null;
};

export const DETAIL_MONTHS = 36;
export const DETAIL_WEEKS = 26;

/**
 * 원생 통계 화면(`/students/stats`) — 운영실 '재원생 추이'와 **같은 원본·같은 판정**(`trendOf`)을 더 긴 창으로, 과목별·수강 구성은
 * `breakdownTrendOf`(그날 걸린 수강으로만 가른다 — 수강 기록 없는 학생을 모든 과목에 넣지 않는다)로 그날로 되감아 센다.
 * 원본은 과목별 추이와 같은 5분 캐시를 나눠 쓴다(B6).
 * `subjects` = 학원설정 `operations.subjects`(레거시 라벨이 섞인 표를 넘기지 말 것 — programOf 규약).
 */
export async function loadEnrolledTrendDetail(
  tenantId: string,
  today: string,
  subjects: readonly ProgramSubject[],
  /**
   * 과목 관리자(원장 2026-10-20 *"자기 과목만"*) — 운영실 과목 관리자 화면과 같은 판정(`slicePredicate`). 주면 학원 전체 선 대신
   * **담당 과목 전체**(`subjectTrendOf` — 운영실 과목 관리자 '재원생 추이'와 같은 값) · 과목 선은 담당 과목만 · 수강 구성은 비운다.
   */
  scope?: (subject: string | null) => boolean,
): Promise<EnrolledTrendDetail> {
  const raw = await unstable_cache(() => loadTrendRaw(tenantId, today), ["dashboard-enrolled-trend-raw", tenantId, today], { revalidate: 300 })();
  const en = { firstStart: new Map(raw.firstStart), ended: new Set(raw.ended) };
  const points = { monthly: monthlyPoints(today, DETAIL_MONTHS), weekly: weeklyPoints(today, DETAIL_WEEKS), yearly: yearlyPoints(today, raw.fromYear) };
  const keys = subjects.map((s) => s.key);
  const groupOf = (subject: string | null) => subjectGroupOf(subject, subjects);
  const split = {
    monthly: breakdownTrendOf(raw.students, en, raw.enrollments, points.monthly, keys, groupOf, today),
    weekly: breakdownTrendOf(raw.students, en, raw.enrollments, points.weekly, keys, groupOf, today),
    yearly: breakdownTrendOf(raw.students, en, raw.enrollments, points.yearly, keys, groupOf, today),
  };
  const total = scope
    ? {
        monthly: subjectTrendOf(raw.students, en, raw.enrollments, points.monthly, scope, today),
        weekly: subjectTrendOf(raw.students, en, raw.enrollments, points.weekly, scope, today),
        yearly: subjectTrendOf(raw.students, en, raw.enrollments, points.yearly, scope, today),
      }
    : {
        monthly: trendOf(raw.students, en, points.monthly),
        weekly: trendOf(raw.students, en, points.weekly),
        yearly: trendOf(raw.students, en, points.yearly),
      };
  return {
    total,
    bySubject: keys
      .filter((key) => !scope || scope(key))
      .map((key) => ({ key, monthly: split.monthly.bySubject[key]!, weekly: split.weekly.bySubject[key]!, yearly: split.yearly.bySubject[key]! })),
    byMix: scope ? [] : MIX_KEYS.map((key) => ({ key, monthly: split.monthly.mix[key], weekly: split.weekly.mix[key], yearly: split.yearly.mix[key] })),
    unknown: { monthly: split.monthly.unknown, weekly: split.weekly.unknown, yearly: split.yearly.unknown },
    recordsFrom: raw.recordsFrom,
    // 오늘 이후로 적힌 종료(반이동 예약 등)는 기록의 시작이 아니다.
    breakdownFrom: raw.enrollments.reduce<string | null>((m, e) => (e.end && e.end.slice(0, 10) <= today && (!m || e.end < m) ? e.end : m), null)?.slice(0, 7) ?? null,
  };
}

async function loadTrendRaw(tenantId: string, today: string): Promise<TrendRaw> {
  const db = createAdminClient();
  type One<T> = T | T[] | null;
  const [students, enrollments] = await Promise.all([
    fetchAllPaged<{ id: string; status: string; enrolled_at: string | null; withdrawn_at: string | null; notes: string | null; withdrawal_metadata: unknown }>((from, to) =>
      db.from("students").select("id,status,enrolled_at,withdrawn_at,notes,withdrawal_metadata").eq("tenant_id", tenantId).order("id").range(from, to),
    ),
    fetchAllPaged<{ id: string; student_id: string; start_date: string | null; end_date: string | null; is_transferred: boolean | null; class: One<{ subject: string | null }> }>((from, to) =>
      db.from("enrollments").select("id,student_id,start_date,end_date,is_transferred,class:class_id ( subject )").eq("tenant_id", tenantId).order("id").range(from, to),
    ),
  ]);
  const firstStart = new Map<string, string>();
  const ended = new Set<string>();
  for (const e of enrollments) {
    if (e.end_date) ended.add(e.student_id);
    if (!e.start_date) continue;
    const cur = firstStart.get(e.student_id);
    if (!cur || e.start_date < cur) firstStart.set(e.student_id, e.start_date);
  }
  // 오늘 이후로 적힌 퇴원(퇴원 예약)은 기록의 시작이 아니다 — 새 지점의 첫 퇴원이 예약이면 미래 달이 경계가 되어 화면이 빈다(리뷰 2026-10-20).
  const firstOut = students.reduce<string | null>((m, s) => (s.withdrawn_at && s.withdrawn_at.slice(0, 10) <= today && (!m || s.withdrawn_at < m) ? s.withdrawn_at : m), null);
  return {
    students: students.map((s) => ({ id: s.id, status: s.status, enrolledAt: s.enrolled_at, withdrawnAt: s.withdrawn_at, notes: s.notes, cleanup: isCleanupExit(s.withdrawal_metadata) })),
    enrollments: enrollments.map((e) => ({
      studentId: e.student_id,
      subject: (Array.isArray(e.class) ? e.class[0] : e.class)?.subject ?? null,
      start: e.start_date,
      end: e.end_date,
      transferred: !!e.is_transferred,
    })),
    firstStart: [...firstStart],
    ended: [...ended],
    recordsFrom: firstOut ? firstOut.slice(0, 7) : null,
    fromYear: firstOut ? Number(firstOut.slice(0, 4)) : Number(today.slice(0, 4)),
  };
}
