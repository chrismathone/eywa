import "server-only";
/**
 * 학원 비서 권한 범위의 서버 몫 — 묻는 사람(또는 의견을 만든 사람)의 지금 권한 → 허용 묶음 키(`../scope.ts` scopeKeysFor).
 * 🔴 권한을 읽지 못하면 기본값으로 돌아가지 않고 멈춘다(Codex 합의 9) — 권한 표(perm-matrix)는 설정 조회 실패 때 코드 기본값으로 열리는데(#60),
 *    비서는 그 폴백으로 넓어지면 안 된다. 그래서 설정을 먼저 직접 읽어 '못 읽어 기본값으로 접은 설정'이면 던진다(같은 요청 캐시라 권한 표도 같은 값을 쓴다).
 * 🔴 개인 메뉴 차단(`USER_MENU_BLOCKS` — 원장·운영 계정도 따른다)이 있는 사람은 원장 묶음(`master`)을 받지 않는다 — 원장 묶음은 전부를 열어
 *    막힌 메뉴(직원관리 등)의 자료까지 답하게 된다(적대 리뷰 2026-11-12). 막히지 않은 메뉴의 묶음만 받는다(원장 전용 표는 닫힌다).
 */
import { createHash } from "node:crypto";
import { getTenantSettings, getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { capMakeupMode, normalizeMakeupSettings } from "@/features/makeups/config";
import { canViewPayslip } from "@/features/payroll/payslip-access";
import { canViewPayslipNow } from "@/features/payroll/server/payslip-gate";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { applyUserMenuBlocks, USER_MENU_BLOCKS } from "@/lib/auth/user-menu-blocks";
import type { CurrentUser } from "@/lib/auth/current-user";
import { foldedReason } from "@/lib/folded-read";
import { capDisabledModules, isModuleEnabled } from "@/lib/modules";
import { accessLevel, applyUserOverrides, canAccess, resolveMatrix, SYSTEM_ROLES, type AccessMatrix, type SystemRole } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { AssistantError } from "./agent";
import { MASTER_SCOPE, scopeKeysFor } from "../scope";

const SCOPE_FAILED = "권한을 확인하지 못했습니다. 잠시 뒤 다시 물어봐 주세요";

const hasMenuBlocks = (userId: string) => (USER_MENU_BLOCKS[userId]?.length ?? 0) > 0;

/**
 * 원장 자격(원장 역할 · 운영 계정) + 권한 표 → 묶음 키. 원장 자격인데 개인 메뉴 차단이 있으면 원장 줄로 묶음을 고른다
 * (원장은 모든 묶음의 역할 목록에 있다 — 학원 전체 행을 본다) — 막힌 메뉴는 권한 표가 이미 '없음'이다.
 */
function keysOf(userId: string, role: SystemRole, privileged: boolean, matrix: AccessMatrix, payslipViewer: boolean): string[] {
  if (privileged && !hasMenuBlocks(userId)) return [MASTER_SCOPE];
  const asRole: SystemRole = privileged ? "master" : role;
  return scopeKeysFor({ role: asRole, master: false, access: (m) => accessLevel(role, m, matrix), payslipViewer });
}

/** 로그인한 본인의 지금 범위(질문 · 추천 질문 · 대화 다시 열기). 문(gate.ts)을 지난 사람만 부른다. */
export async function viewerScopeKeys(user: Pick<CurrentUser, "id" | "systemRole">): Promise<string[]> {
  try {
    const settings = await getTenantSettings();
    // 못 읽어 기본값으로 접은 설정이면 멈춘다 — 권한 표가 역할·개인 설정이 빠진 코드 기본값으로 계산된다(적대 리뷰 2026-11-12).
    if (foldedReason(settings)) throw new AssistantError(SCOPE_FAILED);
    const privileged = user.systemRole === "master" || (await isCurrentUserSuperAdmin());
    if (privileged && !hasMenuBlocks(user.id)) return [MASTER_SCOPE];
    // 권한 표는 한 번만 읽는다(메뉴마다 다시 계산하지 않게) — 강사뷰·지점 보기는 문(gate.ts)이 이미 막았다.
    const [matrix, payslipViewer] = await Promise.all([getUserPermMatrix(), canViewPayslipNow(user)]);
    return keysOf(user.id, user.systemRole, privileged, matrix, payslipViewer);
  } catch (error) {
    if (error instanceof AssistantError) throw error;
    throw new AssistantError(SCOPE_FAILED);
  }
}

/**
 * 세션 없이(밤 재측정) 한 사람의 지금 범위 — 재직 중이고 학원 비서 권한이 남아 있을 때만. 아니면 빈 배열(재지 않는다).
 * 권한 표 계산은 세션 판정과 같은 순서의 핵심(역할 표 · 개인별 권한 · 꺼진 기능 · 보강 모드 · 개인 메뉴 차단)이다. ⚠️ 실험실·AI 멘트 덮개는 세션 판정
 * (로그인한 사람의 지점을 읽는다)에만 있어 여기선 빠진다 — 그 덮개로 닫힌 메뉴의 의견도 잴 수 있다. 잰 값은 의견 표에만 남고, 목록·다시 열기는
 * 세션 범위(`covers`)로 다시 거르니 화면에 새지 않는다. 부르는 쪽은 의견에 저장된 묶음을 이 범위가 다 덮을 때만 잰다(Codex 합의 6).
 */
export async function userScopeKeys(tenantId: string, userId: string): Promise<string[]> {
  const db = createAdminClient();
  // 운영 계정 판정은 직접 읽는다 — 공용 목록(getSuperAdminIds)은 조회 실패를 빈 목록으로 삼켜 운영 계정의 의견이 영구 '멈춤'이 될 수 있다(재리뷰 2026-11-12).
  const [row, settings, superRow] = await Promise.all([
    db.from("users").select("id, system_role, status").eq("id", userId).eq("tenant_id", tenantId).maybeSingle(),
    getTenantSettingsByTenantId(tenantId, { failOnReadError: true }),
    db.from("super_admins").select("id").eq("id", userId).maybeSingle(),
  ]);
  if (row.error || superRow.error) throw new AssistantError(SCOPE_FAILED);
  const superIds = new Set(superRow.data ? [userId] : []);
  const role = row.data?.system_role as SystemRole | undefined;
  if (!row.data || row.data.status !== "active" || !role || !(SYSTEM_ROLES as readonly string[]).includes(role)) return [];
  const privileged = role === "master" || superIds.has(userId);
  const matrix = applyUserMenuBlocks(
    capMakeupMode(
      capDisabledModules(applyUserOverrides(resolveMatrix(settings.permissions.overrides), userId, role, settings.permissions.userOverrides), settings.modules.disabled),
      normalizeMakeupSettings(settings.makeups).mode,
    ),
    userId,
    [role],
  );
  // 문(gate.ts)과 같은 판정 — 학원 비서 권한 또는 운영 계정. 원장 역할도 비서 권한을 꺼 두면 재지 않는다(적대 리뷰 2026-11-12).
  if (!superIds.has(userId) && !canAccess(role, "assistant", matrix)) return [];
  if (privileged && !hasMenuBlocks(userId)) return [MASTER_SCOPE];
  const payroll = isModuleEnabled(settings.modules.disabled, "payroll");
  const payslipViewer =
    payroll &&
    (privileged ||
      canViewPayslip({ id: userId, systemRole: role }, { viewerIds: settings.permissions.specialAccess.payslipViewerIds, managerIds: settings.permissions.specialAccess.payslipManagerIds }));
  return keysOf(userId, role, privileged, matrix, payslipViewer);
}

/** 범위 지문 — 추천 질문 캐시·브라우저 키에 섞는다(권한이 바뀌면 옛 묶음을 다시 쓰지 않게 · Codex 합의 6). 비밀이 아니다. */
export function scopeFingerprint(keys: readonly string[]): string {
  return createHash("sha256").update([...keys].sort().join(",")).digest("hex").slice(0, 12);
}
