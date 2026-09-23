import "server-only";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { canViewPayslip } from "../payslip-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isChinsanTenant } from "@/features/owner/preset";
import type { SystemRole } from "@/lib/permissions";

/**
 * 급여명세서 열람 게이트 — **모든 호출부(화면·조회·저장·발행·취소)가 이 함수 하나만 쓴다.**
 *
 * 통과 조건 = 하드 픽스 명단(payslip-access.ts) **또는** super_admin.
 *
 * 🔑 **super_admin은 앞으로 만드는 어떤 제한 명단도 자동 통과한다**(원장 지시 2026-08-13:
 *    *"superadmin은 앞으로 뭘 안해도 그냥 넣고봐"*). 이 프로젝트의 기존 규약과도 같다 —
 *    권한 매트릭스(perm-matrix)도 super_admin을 우회시킨다. 새 제한을 만들 때 명단만 두고
 *    super_admin을 빼먹으면, 총괄이 자기 시스템에서 잠기는 이상한 상태가 된다.
 *
 * ⚠️ 판정은 요청 단위로 캐시된다(`isCurrentUserSuperAdmin`이 React cache) — 게이트를 4곳에서
 *    불러도 왕복은 요청당 한 번이다.
 * ⚠️ 명단에 있으면 super_admin 조회 자체를 건너뛴다(대부분의 호출이 여기서 끝난다).
 */
export async function canViewPayslipNow(user: { id: string; systemRole: SystemRole }): Promise<boolean> {
  if (await isCurrentUserSuperAdmin()) return true;
  const settings = await getTenantSettings();
  return canViewPayslip(user, {
    isChinsanTenant: isChinsanTenant(settings),
    viewerIds: settings.permissions.specialAccess.payslipViewerIds,
  });
}
