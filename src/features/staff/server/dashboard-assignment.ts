"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { dashboardAssignmentSchema } from "@/features/owner/settings-types";
import { saveOwnerSection } from "@/features/owner/server/actions";

export async function saveStaffDashboardAssignment(input: unknown, baseline: string): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user || !(await canWriteTenant(user.systemRole, "staff")) || (user.systemRole !== "master" && !(await isCurrentUserSuperAdmin()))) return { error: "대시보드 배정은 원장만 변경할 수 있습니다" };
  const parsed = dashboardAssignmentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "담당 범위를 확인해 주세요" };
  const db = await createClient();
  const [settings, { data: target, error }] = await Promise.all([
    getTenantSettings(),
    db.from("users").select("id, system_role").eq("tenant_id", user.tenantId).eq("id", parsed.data.userId).eq("status", "active").neq("system_role", "student").maybeSingle(),
  ]);
  if (error || !target) return { error: "현재 지점의 재직 직원을 찾지 못했습니다" };
  const current = settings.dashboard.assignments ?? [];
  if (JSON.stringify(current.find((a) => a.userId === target.id) ?? null) !== baseline) return { error: "다른 창에서 이 직원의 배정이 변경되었습니다. 새로고침해 주세요." };
  const keys = new Set(settings.operations.subjects.map((s) => s.key));
  if (parsed.data.scope === "subjects" && parsed.data.subjects.some((key) => !keys.has(key))) return { error: "학원에 등록된 과목만 선택해 주세요" };
  const assignment = { ...parsed.data, subjects: parsed.data.scope === "subjects" ? [...new Set(parsed.data.subjects)] : [] };
  const data = { ...settings.dashboard, assignments: [...current.filter((a) => a.userId !== target.id), assignment] };
  const fd = new FormData();
  fd.set("section", "dashboard");
  fd.set("dashboardBaseline", JSON.stringify(settings.dashboard));
  fd.set("data", JSON.stringify(data));
  const result = await saveOwnerSection(undefined, fd);
  return result?.ok ? { ok: true } : { error: result?.error ?? "저장하지 못했습니다" };
}
