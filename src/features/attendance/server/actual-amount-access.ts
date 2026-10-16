import "server-only";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasFreelancePart } from "@/features/staff/employment";

/** Teachers see their own freelance view; office views follow the selected teacher's contract type. */
export async function canShowAttendanceActualAmount(teacherId: string | null): Promise<boolean> {
  const user = await requireAccess("attendance");
  if (!teacherId) return false;
  const scopedTeacher = await effectiveTeacherId();
  if (scopedTeacher && scopedTeacher !== teacherId) return false;
  if (user.systemRole === "teacher" && user.id !== teacherId) return false;
  const { data, error } = await createAdminClient().from("users").select("employment_type")
    .eq("tenant_id", user.tenantId).eq("id", teacherId).maybeSingle();
  // 프리랜서 · 혼합(근로 + 용역 — 용역 학년만 실급여, `employment.ts`).
  return !error && hasFreelancePart(data?.employment_type);
}
