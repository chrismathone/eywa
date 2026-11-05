import { applyUserOverrides, canWrite, mergeMostPermissive, resolveMatrix, type SystemRole } from "@/lib/permissions";
import { capDisabledModules } from "@/lib/modules";
import { applyUserMenuBlocks } from "@/lib/auth/user-menu-blocks";
import type { TenantSettings } from "@/features/owner/settings-types";

export type DeskStaffRow = { id: string; display_name: string | null; system_role: string };
/**
 * 환불 요청서(`academy_documents` · restricted)를 열 수 있는 역할 — DB RLS `academy_documents_restricted_guard`(0170a · 2026-11-03 운영 정의 확인)의
 * 직원 연결 없는 restricted 행 갈래와 같다. 수납 쓰기가 개인 권한으로 열려도 이 역할이 아니면 요청서를 못 열어 처리하지 못한다.
 */
export const REFUND_DOCUMENT_ROLES: readonly string[] = ["master", "admin", "manager", "accountant"];

/**
 * 데스크 담당자 후보 = **수납 쓰기 권한이 있는 직원**(리뷰 2026-11-03 — 환불 요청서를 처리(환불완료일자 저장)하는 수납 게이트가
 * `canWriteTenant(역할, "billing")`이라, 그 권한이 없는 사람을 담당으로 고르면 할 일만 받고 처리하지 못한다. 기본 권한표에서 매니저는 수납 읽기만,
 * 상담사는 없음). 게이트와 같은 재료로 사람마다 유효 권한표를 만든다 — 역할 권한(학원 덮어쓰기) → 개인별 권한 → 운영자 계정은 부여만 보존 →
 * 꺼진 모듈 → 개인 메뉴 차단(대시보드 직원 목록 `dashboardMembers`와 같은 순서) · **요청서 RLS가 통과시키는 역할**(`REFUND_DOCUMENT_ROLES`)까지. 🔴 `canWriteTenant`에 남의 역할을 넘기면 지금 사용자의 개인 예외가
 * 섞인다(perm-matrix 주석) — 그래서 여기서 그 사람 기준으로 계산한다.
 */
export function billingWriters(rows: readonly DeskStaffRow[], superIds: ReadonlySet<string>, settings: Pick<TenantSettings, "permissions" | "modules">): { id: string; name: string }[] {
  const base = resolveMatrix(settings.permissions.overrides);
  const defaults = resolveMatrix([]);
  return rows.flatMap((row) => {
    const name = (row.display_name ?? "").trim();
    if (!name || !REFUND_DOCUMENT_ROLES.includes(row.system_role)) return [];
    const role = row.system_role as SystemRole;
    const isSuperAdmin = superIds.has(row.id);
    const roleMatrix = isSuperAdmin ? mergeMostPermissive(defaults, base) : base;
    const applied = applyUserOverrides(roleMatrix, row.id, role, settings.permissions.userOverrides);
    const matrix = applyUserMenuBlocks(capDisabledModules(isSuperAdmin ? mergeMostPermissive(roleMatrix, applied) : applied, settings.modules.disabled), row.id, [role]);
    return canWrite(role, "billing", matrix) ? [{ id: row.id, name }] : [];
  });
}
