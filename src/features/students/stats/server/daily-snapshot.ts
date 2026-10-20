import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import type { ActiveEnrollmentRow, EnrolledStudentRow } from "@/features/students/enrollment/enrolled-composition";
import { buildDailySnapshot } from "../daily-snapshot";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * 원생 매일 기록 — 지점마다 그날 재원생 구성을 `student_daily_stats`(0381a)에 한 줄 쓴다(같은 날 다시 돌면 덮어쓴다).
 * cron(관리 키 · 세션 없음)이라 **모든 조회에 tenant_id**를 건다([[#104]]) — 조회 모양은 운영실 재원생 카드의 조회
 * (`fetchEnrolledStudents`·`fetchActiveEnrolledEnrollments`)와 같고, 계산은 `buildDailySnapshot` 한 벌.
 * 지점 하나가 실패해도 나머지는 쓴다(실패 지점은 돌려준다).
 */
export async function recordStudentDailyStats(today: string): Promise<{ tenants: number; written: number; failed: string[] }> {
  const admin = createAdminClient();
  const { data: tenants, error } = await admin.from("tenants").select("id").order("id");
  if (error) throw error;
  const failed: string[] = [];
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
  return { tenants: tenants?.length ?? 0, written, failed };
}

async function recordTenant(admin: Admin, tenantId: string, today: string): Promise<void> {
  const [settings, students, rows, onHold] = await Promise.all([
    getTenantSettingsByTenantId(tenantId, { failOnReadError: true }),
    fetchAllPaged<EnrolledStudentRow>((from, to) =>
      admin.from("students").select("id, grade, school").eq("tenant_id", tenantId).eq("status", "enrolled").order("id").range(from, to),
    ),
    fetchAllPaged<ActiveEnrollmentRow>((from, to) =>
      admin
        .from("enrollments")
        .select("id, student_id, start_date, class:class_id!inner ( subject, english_track ), student:student_id!inner ( status )")
        .eq("tenant_id", tenantId)
        .is("end_date", null)
        .eq("on_hold", false)
        .eq("student.status", "enrolled")
        .order("id")
        .range(from, to),
    ),
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
    onHold,
    subjects: settings.operations.subjects.map((s) => ({ key: s.key, label: s.label })),
    gradeLevels: settings.operations.gradeLevels,
    today,
  });
  const { error } = await admin
    .from("student_daily_stats")
    .upsert({ tenant_id: tenantId, stat_date: today, data, recorded_at: new Date().toISOString() }, { onConflict: "tenant_id,stat_date" });
  if (error) throw error;
}
