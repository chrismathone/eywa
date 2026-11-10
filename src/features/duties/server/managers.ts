import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getSuperAdminIds } from "@/lib/auth/super-admin";
import { dashboardAssignmentOf } from "@/features/dashboard/layout/assignment";
import { sliceGroupsOf } from "@/features/dashboard/layout/slices";
import type { TenantSettings } from "@/features/owner/settings-types";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";

/** 과목 키 → 그 과목의 이름과 과목 관리자(이름 · id). 설정에 있는 과목은 관리자가 없어도 줄이 있다. */
export type SubjectManagers = Record<string, { label: string; names: string[]; ids: string[] }>;

/**
 * 과목마다 과목 관리자 — 판정은 관리자 화면의 과목 범위(`resolveDutyAdminScope`)와 같은 읽기다: 관리자(admin) 가운데 운영실 배정이 '과목'인 사람의
 * 담당 과목 묶음에 드는 설정 과목. 쓰는 곳 = 원장 화면의 '과목 관리자' 칸(이름) · 3일 지연 배정(id — `duty_escalate_up`). 권한 판정에는 쓰지 않는다.
 * 설정은 부르는 쪽이 넘긴다(화면 = 로그인한 지점 · 크론 = 지점 id로 읽은 값).
 */
export async function loadSubjectManagers(tenantId: string, settings: TenantSettings): Promise<SubjectManagers> {
  const [supers, users] = await Promise.all([getSuperAdminIds(), fetchAllPaged<{ id: string; display_name: string | null; subjects: string[] | null }>((a, b) =>
    createAdminClient().from("users").select("id,display_name,subjects").eq("tenant_id", tenantId).eq("system_role", "admin").eq("status", "active").order("id").range(a, b))]);
  const labels = subjectLabelRecord(settings.operations.subjects);
  const programs = programSubjectsOf(labels);
  const groupOf = (key: string | null | undefined) => subjectGroupOf(key, programs);
  const groupsOf = sliceGroupsOf(settings.operations.subjects.map((s) => ({ key: s.key, label: s.label })), groupOf);
  const out: SubjectManagers = Object.fromEntries(settings.operations.subjects.map((s) => [s.key, { label: s.label, names: [], ids: [] }]));
  for (const u of [...users].sort((x, y) => (x.display_name ?? "").localeCompare(y.display_name ?? "", "ko"))) {
    const own = (u.subjects ?? []).filter((s) => typeof s === "string" && s.trim());
    const a = dashboardAssignmentOf({ id: u.id, systemRole: "admin", isSuperAdmin: supers.has(u.id), subjects: own }, settings.dashboard.assignments?.find((x) => x.userId === u.id));
    if (!a.subjectScoped) continue;
    const groups = new Set(a.subjects.flatMap((s) => groupsOf(s)));
    for (const s of settings.operations.subjects) { const g = groupOf(s.key); if (g && groups.has(g)) { out[s.key]!.names.push(u.display_name ?? "이름 없음"); out[s.key]!.ids.push(u.id); } }
  }
  return out;
}
