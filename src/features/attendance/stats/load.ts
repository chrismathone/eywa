import "server-only";
import { kstToday } from "@/lib/date-kst";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { readMyUiPrefs } from "@/lib/ui-prefs/read";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";
import { intakeGroupMeta } from "@/features/enrollment/intake-groups";
import { subjectScopeOf, type StatsSubjectScope } from "@/features/students/stats/server/load";
import { hasPeriodParams, paramsForMode, parsePeriodMode, parseStatsPeriod, type PeriodMode, type PeriodParams, type StatsPeriod } from "@/features/stats/period";
import { rateTrend, type RateBucketRow, type RateTrend } from "./rate-trend";

export const ATTENDANCE_STATS_PREFS_NS = "attendanceStats";

export type AttendanceStats = {
  today: string;
  period: StatsPeriod;
  /** 강사 범위 — 통계를 보이지 않는다(운영실 출결 카드도 학원 전체 기록이라 담당 범위로 가를 기준이 없다). */
  teacherScoped: boolean;
  scope: StatsSubjectScope | null;
  scopeEmpty: boolean;
  trend: RateTrend | null;
  groups: Record<string, { label: string; color: string }>;
};

function savedMode(uiPrefs: Record<string, unknown>): PeriodMode | null {
  const ns = uiPrefs[ATTENDANCE_STATS_PREFS_NS];
  return parsePeriodMode(ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).mode : undefined);
}

/**
 * 출결 통계 원본 — RPC `attendance_rate_buckets`(0387a · 운영실 '최근 14일 등원율'과 같은 판정)를 기간으로 한 번 부른다(B2 group-by).
 * 과목 관리자는 운영실과 같은 판정(`subjectScopeOf` — 반 과목). 호출부가 `requireAccess("attendance")`를 먼저 지난다.
 */
export async function loadAttendanceStats(params: PeriodParams, requestedSubject?: string): Promise<AttendanceStats> {
  const today = kstToday();
  const [user, teacherId, prefs, settings] = await Promise.all([getCurrentUser(), effectiveTeacherId(), readMyUiPrefs(), getTenantSettings()]);
  if (!user) throw new Error("로그인이 필요합니다");
  const mode = savedMode(prefs);
  const period = parseStatsPeriod(hasPeriodParams(params) || !mode ? params : paramsForMode(mode, today), today);
  const groups = intakeGroupMeta(settings.operations.subjects);
  const base = { today, period, teacherScoped: false, scope: null, scopeEmpty: false, trend: null, groups };
  if (teacherId) return { ...base, teacherScoped: true };
  try {
    const scoped = await subjectScopeOf(user, settings, requestedSubject);
    if (scoped?.empty) return { ...base, scopeEmpty: true };
    const from = period.grain === "month" ? `${period.months[0]}-01` : period.from;
    const to = period.grain === "month" ? today : period.to;
    const db = await createClient();
    const { data, error } = await db.rpc("attendance_rate_buckets", { p_from: from, p_to: to, p_grain: period.grain });
    if (error) throw error;
    const programSubjects = programSubjectsOf(subjectLabelRecord(settings.operations.subjects));
    const trend = rateTrend({
      rows: (data ?? []) as RateBucketRow[],
      period,
      groupOf: (subject) => {
        // 선 묶음 = 학원 설정에 있는 과목 묶음만(설정에 없는 옛 과목은 전체에만 든다).
        const g = subject ? subjectGroupOf(subject, programSubjects) : null;
        return g && groups[g] ? g : null;
      },
      inScope: scoped && !scoped.empty ? scoped.pred : undefined,
    });
    return { ...base, scope: scoped && !scoped.empty ? scoped.scope : null, trend };
  } catch (error) {
    console.error("[attendance/stats]", error);
    return base;
  }
}
