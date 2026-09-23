import "server-only";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";

/**
 * 회차 정산 모듈(session_billing) 서버 게이트 — 감사 S7(2026-09-23).
 *
 * 수납관리 면(/billing?tab=sessions·verify·payroll)은 모듈이 꺼지면 세우지 않지만, 회차 확정·배분·분배
 * 서버 액션은 **직접 부르면 돌았다**(#77 — 화면에서만 잠근 것). 이 파일의 액션은 전부 첫 게이트 바로 뒤에서
 * 이 함수를 본다. 침산은 모듈이 켜져 있어 종전과 같다.
 */
export const SESSION_BILLING_OFF = "이 지점은 회차 정산 기능을 사용하지 않습니다";

export async function sessionBillingOff(): Promise<boolean> {
  return !isModuleEnabled((await getTenantSettings()).modules.disabled, "session_billing");
}
