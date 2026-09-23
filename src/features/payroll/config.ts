import { isModuleEnabled } from "@/lib/modules";
import { isChinsanTenant } from "@/features/owner/preset";
import type { TenantSettings } from "@/features/owner/settings-types";

// 첫 지점의 기존 결정을 보존한다. 일반 지점은 원장 설정의 기능 모듈에서 제어한다.
export const PAYROLL_ENABLED = false;

// 침산은 옛 휴가 기록을 URL로 계속 열람할 수 있다. 일반 지점은 모듈을 끄면 직접 URL도 닫힌다.
export const STAFF_LEAVES_ENABLED = false;

/** Preserve Chimsan's legacy switches; generic branches control these in the owner module settings. */
export function isPayrollEnabled(settings: Pick<TenantSettings, "preset" | "modules">): boolean {
  return isChinsanTenant(settings) ? PAYROLL_ENABLED : isModuleEnabled(settings.modules.disabled, "payroll");
}

export function isStaffLeavesEnabled(settings: Pick<TenantSettings, "preset" | "modules">): boolean {
  return isChinsanTenant(settings) ? STAFF_LEAVES_ENABLED : isModuleEnabled(settings.modules.disabled, "staff_leaves");
}
