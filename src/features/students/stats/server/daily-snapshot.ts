import "server-only";
import { isModuleEnabled } from "@/lib/modules";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import type { ActiveEnrollmentRow, EnrolledStudentRow } from "@/features/students/enrollment/enrolled-composition";
import { buildDailySnapshot } from "../daily-snapshot";
import { recordAywaHistory } from "./history";
import { buildOpsDaily } from "./ops-daily";
import type { OpsDaily } from "../ops-daily";
import { filterKeptOps } from "./kept-ops";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * 원생 매일 기록 — 지점마다 그날 재원생 구성을 `student_daily_stats`(0381a)에 한 줄 쓴다(같은 날 다시 돌면 덮어쓴다).
 * cron(관리 키 · 세션 없음)이라 **모든 조회에 tenant_id**를 건다([[#104]]) — 조회 모양은 운영실 재원생 카드의 조회
 * (`fetchEnrolledStudents`·`fetchActiveEnrolledEnrollments`)와 같고, 계산은 `buildDailySnapshot` 한 벌.
 * 지점 하나가 실패해도 나머지는 쓴다(실패 지점은 돌려준다).
 * 같은 길에 '지난 기록' 에이와 쪽 월별 값(`recordAywaHistory` · 0385a)도 다시 센다 — **모든 지점의 매일 기록을 먼저** 쓰고 그 뒤에 돈다
 * (매일 기록은 자정 직전 상태라야 해서 다른 지점 집계를 기다리지 않게 · 시간이 모자라 잘려도 매일 기록은 남게). 따로 실패한다.
 */
export async function recordStudentDailyStats(today: string): Promise<{ tenants: number; written: number; failed: string[]; historyFailed: string[] }> {
  const admin = createAdminClient();
  const { data: tenants, error } = await admin.from("tenants").select("id").order("id");
  if (error) throw error;
  const failed: string[] = [];
  const historyFailed: string[] = [];
  let written = 0;
  for (const t of (tenants ?? []) as { id: string }[]) {
    try {
      await recordTenant(admin, t.id, today);
      written++;
    } catch (e) {
      console.error(JSON.stringify({ level: "error", scope: "student-daily-stats", tenantId: t.id, message: e instanceof Error ? e.message : String(e) }));
      failed.push(t.id);
    }
  }
  for (const t of (tenants ?? []) as { id: string }[]) {
    try {
      await recordAywaHistory(admin, t.id, today);
    } catch (e) {
      console.error(JSON.stringify({ level: "error", scope: "student-history-aywa", tenantId: t.id, message: e instanceof Error ? e.message : String(e) }));
      historyFailed.push(t.id);
    }
  }
  return { tenants: tenants?.length ?? 0, written, failed, historyFailed };
}

async function recordTenant(admin: Admin, tenantId: string, today: string): Promise<void> {
  const enrollmentRows = (ending: boolean) =>
    fetchAllPaged<ActiveEnrollmentRow>((from, to) => {
      const q = admin
        .from("enrollments")
        .select("id, student_id, class_id, start_date, end_date, is_transferred, class:class_id!inner ( subject, english_track ), student:student_id!inner ( status )")
        .eq("tenant_id", tenantId)
        .eq("on_hold", false)
        .eq("student.status", "enrolled");
      return (ending ? q.gte("end_date", today) : q.is("end_date", null)).order("id").range(from, to);
    });
  const [settings, students, rows, endingRows, onHold] = await Promise.all([
    getTenantSettingsByTenantId(tenantId, { failOnReadError: true }),
    fetchAllPaged<EnrolledStudentRow>((from, to) =>
      admin.from("students").select("id, grade, school").eq("tenant_id", tenantId).eq("status", "enrolled").order("id").range(from, to),
    ),
    // 재원생 구성 = 종료일 없는 수강(운영실 카드와 같은 줄) · 강좌수는 종료일이 오늘 이후로 적힌 수강도 더한다(운영실 '강좌수' 칸과 같은 규약).
    enrollmentRows(false),
    enrollmentRows(true),
    admin
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "on_hold")
      .then(({ count, error }) => {
        if (error) throw error;
        return count ?? 0;
      }),
  ]);
  const data = buildDailySnapshot({
    students,
    rows,
    endingRows,
    onHold,
    subjects: settings.operations.subjects.map((s) => ({ key: s.key, label: s.label })),
    gradeLevels: settings.operations.gradeLevels,
    today,
    // 강좌수 = 운영실 '강좌수' 칸과 같은 판정(영어 = 인재원 영어 · EiE 따로 — 원장 2026-10-30, EiE 모듈 켜진 지점).
    splitEnglish: isModuleEnabled(settings.modules.disabled, "eie"),
  });
  const opsModules = {
    calendar: isModuleEnabled(settings.modules.disabled, "calendar"),
    newcomers: isModuleEnabled(settings.modules.disabled, "newcomers"),
  };
  // 상담 진행 · 신규생(2026-10-21) — 같은 줄에 함께 싣는다. 부분 실패는 그 칸만 빠진다(재원생 기록은 그대로 쓴다).
  const ops: OpsDaily = await buildOpsDaily(admin, tenantId, today, settings.operations.subjects, opsModules).catch((e: unknown) => {
    console.error(JSON.stringify({ level: "error", scope: "student-daily-stats.ops", tenantId, message: e instanceof Error ? e.message : String(e) }));
    return {};
  });
  // 같은 날 다시 돌 때(재시도) 이번에 실패한 칸은 앞서 쓴 그날 값을 남긴다 — 줄을 통째로 갈아끼우므로 안 그러면 지워진다.
  const kept = ops.consult && ops.newcomers
    ? {}
    : filterKeptOps(await keptOps(admin, tenantId, today), opsModules);
  const merged: OpsDaily = { ...kept, ...ops };
  const row = Object.keys(merged).length ? { ...data, ops: merged } : data;
  const { error } = await admin
    .from("student_daily_stats")
    .upsert({ tenant_id: tenantId, stat_date: today, data: row, recorded_at: new Date().toISOString() }, { onConflict: "tenant_id,stat_date" });
  if (error) throw error;
}

/**
 * 그날 이미 쓴 운영 칸. 🔴 못 읽으면 던진다 — 빈 값으로 덮으면 앞서 쓴 칸이 지워진다(그 지점의 이번 기록만 실패하고, 있던 줄은 그대로 남는다).
 * 하루 한 번(23:55) 도는 cron이라 두 실행이 겹치는 경우는 막지 않는다(읽고-합치고-쓰기는 원자적이지 않다).
 */
async function keptOps(admin: Admin, tenantId: string, today: string): Promise<OpsDaily> {
  const { data, error } = await admin
    .from("student_daily_stats")
    .select("ops:data->ops")
    .eq("tenant_id", tenantId)
    .eq("stat_date", today)
    .maybeSingle<{ ops: OpsDaily | null }>();
  if (error) throw error;
  return data?.ops ?? {};
}
