"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { protectionStatus } from "@/lib/auth/protected-accounts";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { dashboardAssignmentSchema } from "@/features/owner/settings-types";
import { saveOwnerSection } from "@/features/owner/server/actions";

/**
 * 직원 한 사람의 대시보드 배정 저장. 같은 직원을 두 창에서 고치면 **나중 저장이 이긴다**(원장 2026-10-14 *"동시에 저장하면
 * 최신 저장본이 덮어씌워지도록"*) — 예전의 기준값 비교("다른 창에서 이 직원의 배정이 변경되었습니다")는 걷었다.
 * 그 비교는 키 순서까지 보아서 같은 화면에서 두 번째 저장도 거절했다(리뷰 2026-10-14).
 */
export async function saveStaffDashboardAssignment(input: unknown): Promise<{ ok: true } | { error: string }> {
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
  const protection = await protectionStatus(target.id);
  if (protection !== "clear") return { error: protection === "unknown" ? "계정 정보를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." : "이 계정의 운영 설정은 지점에서 변경할 수 없습니다." };
  const current = settings.dashboard.assignments ?? [];
  const keys = new Set(settings.operations.subjects.map((s) => s.key));
  if (parsed.data.scope === "subjects" && parsed.data.subjects.some((key) => !keys.has(key))) return { error: "학원에 등록된 과목만 선택해 주세요" };
  const assignment = { ...parsed.data, subjects: parsed.data.scope === "subjects" ? [...new Set(parsed.data.subjects)] : [] };
  const data = { ...settings.dashboard, assignments: [...current.filter((a) => a.userId !== target.id), assignment] };
  const fd = new FormData();
  fd.set("section", "dashboard");
  // 이 직원의 배정 한 줄만 바꾼다 — 배치와 다른 직원의 배정은 저장 순간의 최신본을 그대로 둔다(mergeDashboardSave · 원장 2026-10-14).
  fd.set("dashboardPart", "assignments");
  fd.set("dashboardTouched", JSON.stringify([target.id]));
  fd.set("data", JSON.stringify(data));
  const result = await saveOwnerSection(undefined, fd);
  return result?.ok ? { ok: true } : { error: result?.error ?? "저장하지 못했습니다" };
}
