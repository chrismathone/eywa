import { applyUserOverrides, canWrite, mergeMostPermissive, resolveMatrix, type SystemRole } from "@/lib/permissions";
import { capDisabledModules } from "@/lib/modules";
import { applyUserMenuBlocks } from "@/lib/auth/user-menu-blocks";
import type { TenantSettings } from "@/features/owner/settings-types";

export type DeskStaffRow = { id: string; display_name: string | null; system_role: string };

/**
 * 데스크 담당자 후보 = **수납 쓰기 권한이 있는 직원**(리뷰 2026-11-03 — 환불 요청서를 처리(환불완료일자 저장)하는 수납 게이트가
 * `canWriteTenant(역할, "billing")`이라, 그 권한이 없는 사람을 담당으로 고르면 할 일만 받고 처리하지 못한다. 기본 권한표에서 매니저는 수납 읽기만,
 * 상담사는 없음). 게이트와 같은 재료로 사람마다 유효 권한표를 만든다 — 역할 권한(학원 덮어쓰기) → 개인별 권한 → 운영자 계정은 부여만 보존 →
 * 꺼진 모듈 → 개인 메뉴 차단(대시보드 직원 목록 `dashboardMembers`와 같은 순서). 🔴 `canWriteTenant`에 남의 역할을 넘기면 지금 사용자의 개인 예외가
 * 섞인다(perm-matrix 주석) — 그래서 여기서 그 사람 기준으로 계산한다.
 */
export function billingWriters(rows: readonly DeskStaffRow[], superIds: ReadonlySet<string>, settings: Pick<TenantSettings, "permissions" | "modules">): { id: string; name: string }[] {
  const base = resolveMatrix(settings.permissions.overrides);
  const defaults = resolveMatrix([]);
  return rows.flatMap((row) => {
    const name = (row.display_name ?? "").trim();
    if (!name || row.system_role === "student") return [];
    const role = row.system_role as SystemRole;
    const isSuperAdmin = superIds.has(row.id);
    const roleMatrix = isSuperAdmin ? mergeMostPermissive(defaults, base) : base;
    const applied = applyUserOverrides(roleMatrix, row.id, role, settings.permissions.userOverrides);
    const matrix = applyUserMenuBlocks(capDisabledModules(isSuperAdmin ? mergeMostPermissive(roleMatrix, applied) : applied, settings.modules.disabled), row.id, [role]);
    return canWrite(role, "billing", matrix) ? [{ id: row.id, name }] : [];
  });
}
