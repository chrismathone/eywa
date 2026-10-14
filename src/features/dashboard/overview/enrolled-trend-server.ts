import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { monthlyPoints, subjectTrendOf, trendOf, yearlyPoints, type TrendEnrollment, type TrendPoint, type TrendStudent } from "./enrolled-trend";

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
    fetchAllPaged<{ id: string; status: string; enrolled_at: string | null; withdrawn_at: string | null; notes: string | null }>((from, to) =>
      db.from("students").select("id,status,enrolled_at,withdrawn_at,notes").eq("tenant_id", tenantId).order("id").range(from, to),
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
  const rows: TrendStudent[] = students.map((s) => ({ id: s.id, status: s.status, enrolledAt: s.enrolled_at, withdrawnAt: s.withdrawn_at, notes: s.notes }));
  const en = { firstStart, ended };
  const firstOut = students.reduce<string | null>((m, s) => (s.withdrawn_at && (!m || s.withdrawn_at < m) ? s.withdrawn_at : m), null);
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

async function loadTrendRaw(tenantId: string, today: string): Promise<TrendRaw> {
  const db = createAdminClient();
  type One<T> = T | T[] | null;
  const [students, enrollments] = await Promise.all([
    fetchAllPaged<{ id: string; status: string; enrolled_at: string | null; withdrawn_at: string | null; notes: string | null }>((from, to) =>
      db.from("students").select("id,status,enrolled_at,withdrawn_at,notes").eq("tenant_id", tenantId).order("id").range(from, to),
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
  const firstOut = students.reduce<string | null>((m, s) => (s.withdrawn_at && (!m || s.withdrawn_at < m) ? s.withdrawn_at : m), null);
  return {
    students: students.map((s) => ({ id: s.id, status: s.status, enrolledAt: s.enrolled_at, withdrawnAt: s.withdrawn_at, notes: s.notes })),
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
