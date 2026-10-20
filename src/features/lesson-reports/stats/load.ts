import "server-only";
import { kstToday } from "@/lib/date-kst";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { readMyUiPrefs } from "@/lib/ui-prefs/read";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { subjectScopeOf, type StatsSubjectScope } from "@/features/students/stats/server/load";
import { hasPeriodParams, paramsForMode, parsePeriodMode, parseStatsPeriod, type PeriodMode, type PeriodParams, type StatsPeriod } from "@/features/stats/period";
import { reportTrend, type ReportBucketRow, type ReportTrend } from "./report-trend";

export const REPORT_STATS_PREFS_NS = "reportStats";

export type ReportStats = {
  today: string;
  period: StatsPeriod;
  /** 강사 범위 — 통계를 보이지 않는다(운영실 카드도 학원 단위 신호다). */
  teacherScoped: boolean;
  scope: StatsSubjectScope | null;
  scopeEmpty: boolean;
  /** 보고서를 쓰는 과목(학원 설정 `report.classnoteSubjects` — 비면 좁히지 않았다). 화면이 라벨로 적는다. */
  tracked: string[];
  trend: ReportTrend | null;
  /** ClassNote 기능이 켜졌나 — 꺼진 지점엔 발송·확인 칸이 없다(운영실도 미확인 카드를 뺀다 · 기능 스위치 = 흔적 없이). */
  classnoteOn: boolean;
};

function savedMode(uiPrefs: Record<string, unknown>): PeriodMode | null {
  const ns = uiPrefs[REPORT_STATS_PREFS_NS];
  return parsePeriodMode(ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).mode : undefined);
}

/**
 * 보고서 통계 원본 — RPC `lesson_report_buckets`(0388a · 운영실 '학습 · 학부모 보고'와 같은 발송·미확인 판정)를 기간으로 한 번.
 * 행은 칸 × 과목 × 숙제 값이라 작지만 1,000행 상한에 걸리지 않게 페이지로 받는다(B2). 과목 관리자는 `subjectScopeOf`.
 * 호출부가 `requireAccess("lesson_reports")`를 먼저 지난다.
 */
export async function loadReportStats(params: PeriodParams, requestedSubject?: string): Promise<ReportStats> {
  const today = kstToday();
  const [user, teacherId, prefs, settings] = await Promise.all([getCurrentUser(), effectiveTeacherId(), readMyUiPrefs(), getTenantSettings()]);
  if (!user) throw new Error("로그인이 필요합니다");
  const mode = savedMode(prefs);
  const period = parseStatsPeriod(hasPeriodParams(params) || !mode ? params : paramsForMode(mode, today), today);
  // 운영실 숙제 위험·미확인과 같은 과목 축(`trackedSubjects` — 비면 좁히지 않는다 · fail-open).
  const tracked = (settings.report.classnoteSubjects ?? []).map((v) => String(v ?? "").trim()).filter(Boolean);
  const classnoteOn = isModuleEnabled(settings.modules.disabled, "classnote");
  const base = { today, period, teacherScoped: false, scope: null, scopeEmpty: false, tracked, trend: null, classnoteOn };
  if (teacherId) return { ...base, teacherScoped: true };
  try {
    const scoped = await subjectScopeOf(user, settings, requestedSubject);
    if (scoped?.empty) return { ...base, scopeEmpty: true };
    const from = period.grain === "month" ? `${period.months[0]}-01` : period.from;
    const to = period.grain === "month" ? today : period.to;
    const db = await createClient();
    const rows = await fetchAllPaged<ReportBucketRow>((a, b) =>
      db
        .rpc("lesson_report_buckets", { p_from: from, p_to: to, p_grain: period.grain })
        .order("bucket")
        .order("subject")
        .order("homework_score")
        .range(a, b),
    );
    // 과목 관리자 = 운영실 카드처럼 **담당 묶음의 설정 과목 키**인 보고서만(`sliceSubjectKeys` — 과목이 빈·모르는 보고서는 카드가 안 센다 · 리뷰 2026-10-21).
    const keys = new Set(settings.operations.subjects.map((s) => s.key));
    const inScope = scoped && !scoped.empty ? (subject: string | null) => !!subject && keys.has(subject) && scoped.pred(subject) : undefined;
    return { ...base, scope: scoped && !scoped.empty ? scoped.scope : null, trend: reportTrend({ rows, period, tracked, inScope }) };
  } catch (error) {
    console.error("[lesson-reports/stats]", error);
    return base;
  }
}
