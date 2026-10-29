import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportWarning } from "@/lib/observability/report-error";
import { isMergedStudent } from "@/features/students/status/merged";
import { isCleanupExit } from "@/features/withdrawals/system-bulk";
import { loadExitCountDates } from "@/features/withdrawals/server/exit-month";
import type { TrendEnrollment, TrendEnrollments, TrendStudent } from "./enrolled-trend";
import { loadCleanupBilling, type CleanupBilling } from "./trend-billing-server";

/*
 * 재원생 추이·강좌수 추이의 **판정 재료 한 벌**(원생·수강 원본 + 장부 정리 청구) — 운영실 카드(`enrolled-trend-server.ts`)와 원생 통계
 * (`loadEnrolledTrendDetail` · `loadCourseTrendDetail`)가 같이 쓴다. 관리 키라 모든 조회에 tenant_id([[#104]]) · 캐시는 지점·날짜별(B6).
 */

export type TrendRaw = { students: TrendStudent[]; enrollments: TrendEnrollment[]; firstStart: [string, string][]; ended: string[]; recordsFrom: string | null; fromYear: number };

/** 재료 실패 — 경고만 남기고 종전대로 센다(재원생 추이 전체가 '못 불러옴'이 되지 않게, 적대 리뷰 2026-10-20). */
const warnFor = (scope: string, message: string) => (error: unknown): null => {
  reportWarning(message, { scope, cause: error instanceof Error ? error.message : String(error) });
  return null;
};
export const warnBilling = warnFor("dashboard.enrolledTrend.cleanupBilling", "재원생 추이 장부 정리 청구 조회 실패 — 이번 요청은 퇴원일 규칙으로");
export const warnCoverage = warnFor("dashboard.enrolledTrend.coverage", "재원생 추이 기록 범위 조회 실패 — 이번 요청은 시작 달로 자르지 않는다");

/** 판정 재료(`countedOn`) — 첫 수강 · 끝난 수강 · 청구 기록(장부 정리 학생을 청구로 세는 창 · 청구 재료가 없으면 종전 규칙). */
export const inputsOf = (raw: TrendRaw, billing: CleanupBilling | null, today: string): TrendEnrollments => ({
  firstStart: new Map(raw.firstStart),
  ended: new Set(raw.ended),
  billing: billing?.billingFrom ? { from: billing.billingFrom, today, months: new Map(billing.billed) } : undefined,
});

/**
 * 원생·수강 원본(과목별 추이·강좌수 추이·원생 통계) — 5분 캐시(B6) + 한 렌더 안 한 번(`cache` · 서버 액션에선 안 듣는다).
 * 키 판 v4 = 강좌수용 반 id·휴원·영어 프로그램을 더했다(침산 원본 약 0.5MB — 캐시 한도 2MB 안).
 */
export const loadTrendRawCached = cache((tenantId: string, today: string) =>
  unstable_cache(() => loadTrendRaw(tenantId, today), ["dashboard-enrolled-trend-raw-v5", tenantId, today], { revalidate: 300 })(),
);

/** 장부 정리 학생의 청구 재료 — 원본과 **따로** 5분 캐시. 실패는 캐시에 남지 않는다(`loadCleanupBilling`이 던진다). */
export const loadBillingCached = cache((tenantId: string, today: string) =>
  unstable_cache(() => loadCleanupBilling(createAdminClient(), tenantId, today), ["dashboard-enrolled-trend-billing-v1", tenantId, today], { revalidate: 300 })(),
);

/** 과목별 추이·원생 통계의 판정 재료 한 벌 — 청구 재료가 실패하면 **그 요청에서만** 종전 규칙. 🔴 다른 캐시 함수 안에서 부르지 말 것(Next가 안쪽 캐시를 건너뛴다). */
export const trendInputs = cache(async (tenantId: string, today: string): Promise<{ raw: TrendRaw; en: TrendEnrollments }> => {
  const [raw, billing] = await Promise.all([loadTrendRawCached(tenantId, today), loadBillingCached(tenantId, today).catch(warnBilling)]);
  return { raw, en: inputsOf(raw, billing, today) };
});

/**
 * 수강 종료가 처음 기록된 달(YYYY-MM) — 그 전에 그만둔 학생은 수강 행이 남아 있지 않아 과목·강좌를 셀 수 없다(과목 선·강좌수의 아래 경계).
 * 오늘 이후로 적힌 종료(반이동 예약 등)는 기록의 시작이 아니다. 끝난 수강이 하나도 없으면 null(새 지점 — 처음부터 다 기록돼 있다).
 */
export function breakdownFromOf(raw: Pick<TrendRaw, "enrollments">, today: string): string | null {
  return raw.enrollments.reduce<string | null>((m, e) => (e.end && e.end.slice(0, 10) <= today && (!m || e.end < m) ? e.end : m), null)?.slice(0, 7) ?? null;
}

/** 원본을 직접 읽는다 — 계산값을 캐시하는 함수(`loadEnrolledTrend`)가 캐시 안에서 부른다(캐시 겹침을 피하려고 캐시 없이). */
export async function loadTrendRaw(tenantId: string, today: string): Promise<TrendRaw> {
  const db = createAdminClient();
  type One<T> = T | T[] | null;
  const [students, enrollments] = await Promise.all([
    fetchAllPaged<{ id: string; status: string; enrolled_at: string | null; withdrawn_at: string | null; notes: string | null; withdrawal_metadata: unknown }>((from, to) =>
      db.from("students").select("id,status,enrolled_at,withdrawn_at,notes,withdrawal_metadata").eq("tenant_id", tenantId).order("id").range(from, to),
    ),
    fetchAllPaged<{
      id: string;
      student_id: string;
      class_id: string | null;
      start_date: string | null;
      end_date: string | null;
      is_transferred: boolean | null;
      on_hold: boolean | null;
      class: One<{ subject: string | null; english_track: string | null }>;
    }>((from, to) =>
      db
        .from("enrollments")
        .select("id,student_id,class_id,start_date,end_date,is_transferred,on_hold,class:class_id ( subject, english_track )")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(from, to),
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
  // 퇴원월(수강료를 낸 마지막 달 — 원장 2026-10-29): 재원에서 빠지는 날을 운영실 퇴원 카드와 같은 판정으로.
  const exitDates = await loadExitCountDates(
    students.filter((s) => s.status === "withdrawn" && s.withdrawn_at).map((s) => ({ id: s.id, tenantId, withdrawnAt: s.withdrawn_at })),
  );
  const firstOut = students.reduce<string | null>((m, s) => (s.withdrawn_at && s.withdrawn_at.slice(0, 10) <= today && (!m || s.withdrawn_at < m) ? s.withdrawn_at : m), null);
  return {
    // 메모 칸(원본의 절반 가까이)은 싣지 않고 병합 판정 값만 싣는다 — 원본 캐시 크기(2MB 한도)·파싱 비용(적대 재리뷰 2026-10-20).
    students: students.map((s) => ({ id: s.id, status: s.status, enrolledAt: s.enrolled_at, withdrawnAt: s.withdrawn_at, ...exitAtOf(exitDates.get(s.id), s.withdrawn_at), merged: isMergedStudent(s.notes), cleanup: isCleanupExit(s.withdrawal_metadata) })),
    enrollments: enrollments.map((e) => {
      const klass = Array.isArray(e.class) ? e.class[0] : e.class;
      return {
        studentId: e.student_id,
        subject: klass?.subject ?? null,
        start: e.start_date,
        end: e.end_date,
        transferred: !!e.is_transferred,
        classId: e.class_id,
        // 캐시 크기를 아끼려고 값이 있을 때만 싣는다(없음 = 휴원 아님 · 영어 프로그램 모름).
        ...(e.on_hold ? { onHold: true } : {}),
        ...(klass?.english_track ? { englishTrack: klass.english_track } : {}),
      };
    }),
    firstStart: [...firstStart],
    ended: [...ended],
    recordsFrom: firstOut ? firstOut.slice(0, 7) : null,
    fromYear: firstOut ? Number(firstOut.slice(0, 4)) : Number(today.slice(0, 4)),
  };
}

/** 퇴원월 날짜가 퇴원일과 다를 때만 싣는다(원본 캐시 크기 — 대부분 같다). */
function exitAtOf(exitAt: string | undefined, withdrawnAt: string | null): { exitAt?: string } {
  return exitAt && exitAt !== withdrawnAt?.slice(0, 10) ? { exitAt } : {};
}
