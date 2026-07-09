import "server-only";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { getDailyProcessingStatus } from "@/features/attendance/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { fetchInChunks } from "@/lib/supabase/batch";
import type { TodayActionsRaw } from "../today-actions";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 오늘 미작성 보고서 신호 — 오늘 수업이 **시작된** 반(getTodaySchedule status≠upcoming)의 활성 수강생 중
 * 오늘 lesson_report가 0건인 학생 수(+대표 명단). 학생 단위(과목 무시) MVP. RLS 테넌트 스코프.
 */
async function unwrittenReportsSignal(supabase: Supabase, today: string): Promise<TodayActionsRaw["unwrittenReportsToday"]> {
  const slots = await getTodaySchedule();
  const startedClassIds = [...new Set(slots.filter((s) => s.status !== "upcoming").map((s) => s.classId))];
  if (startedClassIds.length === 0) return { count: 0, names: [] };
  const enr = await fetchInChunks<{ student_id: string }>(startedClassIds, (chunk) =>
    supabase.from("enrollments").select("student_id").is("end_date", null).in("class_id", chunk),
  );
  const expected = [...new Set(enr.map((e) => e.student_id))];
  if (expected.length === 0) return { count: 0, names: [] };
  const reps = await fetchInChunks<{ student_id: string }>(expected, (chunk) =>
    supabase.from("lesson_reports").select("student_id").eq("report_date", today).in("student_id", chunk),
  );
  const reported = new Set(reps.map((r) => r.student_id));
  const missing = expected.filter((id) => !reported.has(id));
  if (missing.length === 0) return { count: 0, names: [] };
  const studs = await fetchInChunks<{ name: string }>(missing.slice(0, 100), (chunk) =>
    supabase.from("students").select("name").in("id", chunk),
  );
  return { count: missing.length, names: studs.map((s) => s.name) };
}

/** KST 날짜 문자열에서 n일 전(YYYY-MM-DD) — 결정적 UTC 산술(date-kst 주석 규칙). */
function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * "오늘 조치할 것" 원시 신호 수집 — 전부 병렬(B4), 카운트는 count:exact head:true(B2, 행 안 받음).
 * 표시 조립은 순수 buildTodayActions(today-actions.ts)가 담당.
 */
export async function getTodayActionSignals(): Promise<TodayActionsRaw> {
  const supabase = await createClient();
  const today = kstToday();
  const yesterday = daysBefore(today, 1);
  const weekAgoDate = daysBefore(today, 7);
  const failedCutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // 최근 7일 내 실패만 — 오래된 실패가 패널을 영구 점유하는 잔소리 방지.
  const failedCount = (table: "meeting_minutes" | "enrollment_consultations" | "student_consultations") =>
    supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("processing_status", "failed")
      .gte("updated_at", failedCutoff);

  const [
    absentRes,
    dailyProcessing,
    failedMeetings,
    failedEnrollment,
    failedConsultations,
    syncRes,
    syncToggleRes,
    expensesRes,
    textbooksRes,
    leavesPendingRes,
    leavesTodayRes,
    unwrittenReports,
  ] = await Promise.all([
    // 오늘 무단결석 — 명단 필요(이름 표시)라 행 조회, 상한으로 방어.
    supabase
      .from("attendance_records")
      .select("student_id, student:student_id ( name )")
      .eq("session_date", today)
      .eq("status", "absent")
      .limit(200),
    // 어제 출석 미기록 반 — 기존 일별 미처리 쿼리 재사용(청크 안전).
    getDailyProcessingStatus(yesterday),
    failedCount("meeting_minutes"),
    failedCount("enrollment_consultations"),
    failedCount("student_consultations"),
    // makeedu 동기화 상태(RLS로 현 테넌트 행만, 도메인 수 = 수 행).
    supabase.from("makeedu_sync_state").select("domain, status, synced_at"),
    supabase.from("user_integrations").select("sync_enabled").eq("provider", "makeedu").maybeSingle(),
    supabase
      .from("expenses")
      .select("*", { count: "exact", head: true })
      .eq("approval_status", "pending")
      .gte("expense_date", weekAgoDate),
    supabase.from("textbook_orders").select("*", { count: "exact", head: true }).eq("status", "requested"),
    supabase
      .from("staff_leaves")
      .select("*", { count: "exact", head: true })
      .is("approved_at", null)
      .gte("ends_on", today),
    supabase
      .from("staff_leaves")
      .select("user:user_id ( display_name )")
      .lte("starts_on", today)
      .gte("ends_on", today)
      .limit(20),
    unwrittenReportsSignal(supabase, today),
  ]);

  // 무단결석 — 한 학생이 여러 반에서 결석해도 1명(학생 단위 dedupe).
  const seen = new Map<string, string>();
  for (const r of absentRes.data ?? []) {
    if (seen.has(r.student_id as string)) continue;
    const st = (Array.isArray(r.student) ? r.student[0] : r.student) as { name?: string } | undefined;
    seen.set(r.student_id as string, st?.name ?? "(학생)");
  }

  // makeedu — 자동 동기화 OFF면 경고 자체를 끈다(토글 존중). 행이 없으면 미사용 테넌트 = 무경고.
  let makeeduIssue: TodayActionsRaw["makeeduIssue"] = null;
  const syncEnabled = (syncToggleRes.data?.sync_enabled as boolean | undefined) ?? true;
  const syncRows = (syncRes.data ?? []) as { domain: string; status: string; synced_at: string }[];
  if (syncEnabled && syncRows.length > 0) {
    const errs = syncRows.filter((r) => r.status !== "ok");
    if (errs.length > 0) {
      makeeduIssue = { kind: "error", detail: `${errs.map((e) => e.domain).join("·")} 실패` };
    } else {
      const latest = Math.max(...syncRows.map((r) => Date.parse(r.synced_at)));
      const hours = Math.floor((Date.now() - latest) / 3_600_000);
      // 하루 2회(06/18 KST) 도는 동기화 — 26시간+ 무소식 = 최소 한 사이클 누락.
      if (hours >= 26) makeeduIssue = { kind: "stale", detail: `${hours}시간째 미동기` };
    }
  }

  return {
    absentToday: [...seen].map(([studentId, name]) => ({ studentId, name })),
    unrecordedYesterday: dailyProcessing
      .filter((c) => c.unprocessed > 0)
      .map((c) => ({ classId: c.classId, className: c.className })),
    yesterday,
    failedAnalysis: {
      meetings: failedMeetings.count ?? 0,
      enrollment: failedEnrollment.count ?? 0,
      consultations: failedConsultations.count ?? 0,
    },
    makeeduIssue,
    pendingExpenses: expensesRes.count ?? 0,
    requestedTextbooks: textbooksRes.count ?? 0,
    leavesPending: leavesPendingRes.count ?? 0,
    leavesToday: (leavesTodayRes.data ?? []).map((r) => {
      const u = (Array.isArray(r.user) ? r.user[0] : r.user) as { display_name?: string } | undefined;
      return { name: u?.display_name ?? "(직원)" };
    }),
    unwrittenReportsToday: unwrittenReports,
  };
}
