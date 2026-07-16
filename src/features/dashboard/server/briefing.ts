import "server-only";
/**
 * 일일 AI 브리핑 — 수집·생성·저장(0114a daily_briefings). cron(/api/cron/daily-briefing)과
 * '다시 생성' 서버 액션이 공유하는 단일 소스.
 *
 * - 페이지 로드는 절대 이 파일의 generate를 부르지 않는다(CLAUDE.md AI 정책) — 저장분 렌더만.
 * - daily_briefings엔 RLS 정책이 없다(0114a 의도: payload가 master 관점 전신호, #77) —
 *   읽기도 admin으로 하되 **호출부(page.tsx·액션)가 canManageStaff 게이트를 먼저 통과**해야 한다.
 * - 숫자·명단은 payload(결정론)가 진실. narrative는 validateNarrative 통과분만 저장,
 *   실패는 processing_error에 한글 사유(완료+narrative null = "서술만 실패" 시멘틱).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { generateJSON } from "@/lib/ai/generate";
import { reportError, reportWarning } from "@/lib/observability/report-error";
import { notifyUsers } from "@/features/notifications/server/notify";
import { computeRetentionRoster } from "@/features/retention/server/queries";
import { summarizeRoster } from "@/features/retention/roster";
import { getTodayActionSignals, type DashboardSignalsDb } from "./action-signals";
import { getAbsenceRiskStudents, getFollowUpConsultations } from "./queries";
import {
  buildDailyBriefingPayload,
  shouldGenerateNarrative,
  type DailyBriefingPayload,
} from "../briefing-digest";
import {
  buildFallbackTeamReport,
  buildTeamPrompt,
  validateTeamReport,
  type TeamReport,
} from "../briefing-team-report";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type DailyBriefingRow = {
  id: string;
  briefing_date: string;
  processing_status: string; // idle | analyzing | completed | failed
  processing_error: string | null;
  payload: DailyBriefingPayload | null;
  narrative: string | null; // v1 하위호환(구 행 표시용)
  team_report: TeamReport | null;
  generated_at: string | null;
};

/** KST 날짜 문자열에서 n일 전(YYYY-MM-DD) — 결정적 UTC 산술(date-kst 주석 규칙). */
function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** 오늘 브리핑 행 — ⚠️ 호출부가 canManageStaff 게이트 통과 후에만 부를 것(admin 읽기). */
export async function getDailyBriefing(tenantId: string, date: string): Promise<DailyBriefingRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("daily_briefings")
    .select("id, briefing_date, processing_status, processing_error, payload, narrative, team_report, generated_at")
    .eq("tenant_id", tenantId)
    .eq("briefing_date", date)
    .maybeSingle();
  if (error) throw new Error(`getDailyBriefing: ${error.message}`);
  return (data as DailyBriefingRow | null) ?? null;
}

/**
 * 테넌트 1건의 브리핑 생성 → upsert(tenant×date 멱등). 실패도 행으로 남겨 카드가 정직하게 표시.
 * notifyOnFirstGeneration: 그날 최초 생성시에만 master에게 벨 1회(notified_at 게이트 — 재생성은 미발송).
 */
export async function generateDailyBriefing(
  tenantId: string,
  opts: { notifyOnFirstGeneration?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const supabase = admin as unknown as Supabase;
  const db: DashboardSignalsDb = { supabase, tenantId };
  const date = kstToday();
  const yesterday = daysBefore(date, 1);
  try {
    const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
      new Date(`${date}T00:00:00Z`).getUTCDay()
    ]!;
    const [yesterdayRaw, todayRaw, followUpRows, absenceRisks, classSessionsRes] = await Promise.all([
      // 어제 마감: asOf=어제 + nowMinutes=1440(전 수업 시작됨) — '어제 무단결석·어제 미작성'이 정확해진다.
      getTodayActionSignals({}, { db, asOf: { date: yesterday, nowMinutes: 1440 } }),
      // 오늘: 어제 미기록 반·오늘 휴가·승인 대기만(나머지 도메인은 어제 수집분과 중복이라 스킵).
      getTodayActionSignals(
        {
          meetings: false,
          enrollment: false,
          consultations: false,
          lessonReports: false,
          students: false,
          billing: false,
          owner: false,
        },
        { db },
      ),
      getFollowUpConsultations(60, db),
      getAbsenceRiskStudents(db),
      supabase
        .from("class_schedules")
        .select("class_id, class:class_id!inner ( is_active )", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("day_of_week", dayKey)
        .eq("class.is_active", true)
        .lte("valid_from", date)
        .or(`valid_to.is.null,valid_to.gte.${date}`),
    ]);

    // retention은 앱 최중량 읽기 — 실패해도 브리핑 본체는 살린다(B7 준수: 라이브가 아니라 cron에서만 계산).
    let retention: { total: number; risk: number; warn: number; revenueRisk: number } | null = null;
    let retentionTop: { name: string; reasons: string[]; action: string | null }[] = [];
    try {
      const roster = await computeRetentionRoster(tenantId);
      const stats = summarizeRoster(roster);
      retention = { total: stats.total, risk: stats.risk, warn: stats.warn, revenueRisk: stats.revenueRisk };
      // roster는 위험도 내림차순 — 상위 위험 학생의 사유·권장 조치(전부 결정론)를 스포트라이트 재료로.
      retentionTop = roster
        .filter((student) => student.risk.level !== "ok")
        .slice(0, 5)
        .map((student) => ({
          name: student.name,
          reasons: student.risk.reasons,
          action: student.primaryAction || null,
        }));
    } catch (e) {
      reportWarning("브리핑 retention 계산 실패 — 이탈 신호 없이 진행", {
        scope: "briefing.retention",
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const payload = buildDailyBriefingPayload({
      date,
      yesterdayRaw,
      todayRaw,
      followUps: {
        overdue: followUpRows.filter((row) => row.urgency === "overdue").length,
        dueSoon: followUpRows.filter((row) => row.urgency === "today" || row.urgency === "soon").length,
      },
      absenceRisks: absenceRisks.map((risk) => ({ studentName: risk.studentName, absences: risk.absences })),
      retention,
      retentionTop,
      todayClassSessions: classSessionsRes.error ? null : (classSessionsRes.count ?? null),
    });

    let teamReport: TeamReport | null = null;
    let note: string | null = null;
    let modelVersion: string | null = null;
    if (shouldGenerateNarrative(payload)) {
      try {
        const { data, model } = await generateJSON<TeamReport>({
          prompt: buildTeamPrompt(payload),
          maxTokens: 1200,
          meta: { tenantId, feature: "daily_briefing" },
        });
        modelVersion = `${model}-${date}`;
        const check = validateTeamReport(data, payload);
        if (check.ok) teamReport = check.value;
        else {
          note = "AI 팀 보고가 검증에서 탈락해 결정론 요약으로 대체했습니다.";
          reportWarning("브리핑 팀 보고 검증 탈락", {
            scope: "briefing.teamReport.guard",
            tenantId,
            reason: check.reason,
          });
        }
      } catch (e) {
        // generateJSON이 키/한도 오류를 이미 한글화(rethrowAi) — 그대로 표면화.
        note = `AI 팀 보고 생성 실패: ${e instanceof Error ? e.message : String(e)}`;
        reportError(e, { scope: "briefing.teamReport", tenantId });
      }
    }

    const { error: upsertError } = await admin.from("daily_briefings").upsert(
      {
        tenant_id: tenantId,
        briefing_date: date,
        processing_status: "completed",
        processing_error: note,
        payload,
        narrative: null, // v1 컬럼 — 새 행은 team_report 사용(구 행 표시 하위호환만)
        team_report: teamReport,
        model_version: modelVersion,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,briefing_date" },
    );
    if (upsertError) throw new Error(`브리핑 저장 실패: ${upsertError.message}`);

    if (opts.notifyOnFirstGeneration) await notifyMasterOnce(tenantId, date, payload);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    reportError(e, { scope: "briefing.generate", tenantId });
    // 실패도 행으로 남긴다(정직성) — 기존 payload가 있으면 upsert가 해당 컬럼만 갱신해 보존된다.
    const { error: markError } = await admin.from("daily_briefings").upsert(
      {
        tenant_id: tenantId,
        briefing_date: date,
        processing_status: "failed",
        processing_error: `브리핑 생성 실패: ${message}`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,briefing_date" },
    );
    if (markError) reportError(markError, { scope: "briefing.generate.failmark", tenantId });
    return { ok: false, error: message };
  }
}

/**
 * 벨 알림 1회 게이트 — notifications엔 유니크 제약이 없어 재실행이 중복 벨을 쌓는다.
 * 수신자는 master만(원장 결정 2026-07-16 — 관리자 전원 아침 벨은 경보 피로).
 */
async function notifyMasterOnce(tenantId: string, date: string, payload: DailyBriefingPayload): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("daily_briefings")
    .select("id, notified_at")
    .eq("tenant_id", tenantId)
    .eq("briefing_date", date)
    .maybeSingle();
  if (!row || row.notified_at) return;
  const { data: masters, error } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId) // admin은 RLS 우회 — 이 필터가 유일한 격리선(notifyClassAssignment 선례)
    .eq("system_role", "master")
    .eq("status", "active");
  if (error || !masters || masters.length === 0) return;
  await notifyUsers(
    masters.map((master) => ({
      tenantId,
      recipientId: master.id as string,
      type: "daily_briefing" as const,
      title: "오늘의 운영 브리핑이 준비됐습니다",
      body: buildFallbackTeamReport(payload).headline.slice(0, 120),
      link: "/dashboard",
    })),
  );
  await admin.from("daily_briefings").update({ notified_at: new Date().toISOString() }).eq("id", row.id);
}
