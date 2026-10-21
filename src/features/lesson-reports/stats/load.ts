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
import { getUnreadReports, loadHomeworkRisk, type HomeworkRiskView, type UnreadReportsView } from "@/features/dashboard/onescreen/server/queries";

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
  /**
   * 운영실 '학습 · 학부모 보고' 카드의 **지금 숫자**(같은 함수 · 같은 과목 축) — 기간과 상관없이 위 칸에 고정한다(리뷰 2026-10-21: 카드는 7일 학생 수 ·
   * 30일 미확인 건수인데 상세는 기간 비율이라 카드 숫자를 상세에서 찾을 수 없었다). 각각 실패하면 null('—').
   */
  card: { homework: HomeworkRiskView | null; unread: UnreadReportsView | null };
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
  const base = { today, period, teacherScoped: false, scope: null, scopeEmpty: false, tracked, trend: null, classnoteOn, card: { homework: null, unread: null } };
  if (teacherId) return { ...base, teacherScoped: true };
  try {
    const scoped = await subjectScopeOf(user, settings, requestedSubject);
    if (scoped?.empty) return { ...base, scopeEmpty: true };
    const from = period.grain === "month" ? `${period.months[0]}-01` : period.from;
    const to = period.grain === "month" ? today : period.to;
    const db = await createClient();
    // 과목 관리자 = 운영실 카드처럼 **담당 묶음의 설정 과목 키**인 보고서만(`sliceSubjectKeys` — 과목이 빈·모르는 보고서는 카드가 안 센다 · 리뷰 2026-10-21).
    const keys = new Set(settings.operations.subjects.map((s) => s.key));
    const pred = scoped && !scoped.empty ? scoped.pred : null;
    const only = pred ? settings.operations.subjects.map((s) => s.key).filter((k) => pred(k)) : null;
    const inScope = pred ? (subject: string | null) => !!subject && keys.has(subject) && pred(subject) : undefined;
    const warn = (what: string) => (error: unknown) => {
      console.error(`[lesson-reports/stats/${what}]`, error);
      return null;
    };
    // 추이 조회가 실패해도 위 '현재 확인할 항목'(카드 숫자)은 살린다 — 구역마다 따로 실패한다(Codex 협의 2026-10-21).
    const [rows, homework, unread] = await Promise.all([
      fetchAllPaged<ReportBucketRow>((a, b) =>
        db
          .rpc("lesson_report_buckets", { p_from: from, p_to: to, p_grain: period.grain })
          .order("bucket")
          .order("subject")
          .order("homework_score")
          .range(a, b),
      ).catch(warn("trend")),
      // 운영실 카드와 같은 함수·같은 과목 축(과목 관리자 = 담당 과목 키) — 카드 숫자 그대로.
      loadHomeworkRisk().then((view) => view(only)).catch(warn("homework")),
      classnoteOn ? getUnreadReports(only).catch(warn("unread")) : Promise.resolve(null),
    ]);
    return { ...base, scope: pred ? scoped!.scope : null, trend: rows ? reportTrend({ rows, period, tracked, inScope }) : null, card: { homework, unread } };
  } catch (error) {
    console.error("[lesson-reports/stats]", error);
    return base;
  }
}
