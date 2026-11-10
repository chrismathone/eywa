import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { dashboardAssignmentOf } from "@/features/dashboard/layout/assignment";
import { sliceGroupsOf } from "@/features/dashboard/layout/slices";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { getSuperAdminIds } from "@/lib/auth/super-admin";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";

/**
 * 과목 키 → 그 과목의 관리자 이름들(원장 화면의 '과목 관리자' 칸). 판정은 관리자 화면의 과목 범위(`resolveDutyAdminScope`)와 같은 읽기다 —
 * 관리자(admin) 가운데 운영실 배정이 '과목'인 사람의 담당 과목 묶음에 드는 설정 과목. 표시 전용(권한 판정에 쓰지 않는다).
 */
export async function loadSubjectManagers(tenantId: string): Promise<Record<string, string[]>> {
  const [settings, supers] = await Promise.all([getTenantSettings(), getSuperAdminIds()]);
  const users = await fetchAllPaged<{ id: string; display_name: string | null; subjects: string[] | null }>((a, b) =>
    createAdminClient().from("users").select("id,display_name,subjects").eq("tenant_id", tenantId).eq("system_role", "admin").eq("status", "active").order("id").range(a, b));
  const labels = subjectLabelRecord(settings.operations.subjects);
  const programs = programSubjectsOf(labels);
  const groupOf = (key: string | null | undefined) => subjectGroupOf(key, programs);
  const groupsOf = sliceGroupsOf(settings.operations.subjects.map((s) => ({ key: s.key, label: s.label })), groupOf);
  const out: Record<string, string[]> = {};
  for (const u of users) {
    const own = (u.subjects ?? []).filter((s) => typeof s === "string" && s.trim());
    const a = dashboardAssignmentOf({ id: u.id, systemRole: "admin", isSuperAdmin: supers.has(u.id), subjects: own }, settings.dashboard.assignments?.find((x) => x.userId === u.id));
    if (!a.subjectScoped) continue;
    const groups = new Set(a.subjects.flatMap((s) => groupsOf(s)));
    for (const s of settings.operations.subjects) { const g = groupOf(s.key); if (g && groups.has(g)) (out[s.key] ??= []).push(u.display_name ?? "이름 없음"); }
  }
  for (const k of Object.keys(out)) out[k]!.sort((x, y) => x.localeCompare(y, "ko"));
  return out;
}
