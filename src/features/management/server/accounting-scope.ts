import "server-only";
import { isFeatureOptedIn } from "@/lib/license/server";
import { ManagementInputError } from "../errors";

export const ACCOUNTING_SCOPE_MESSAGE = "이 지점은 ECOUNT 회계 자료 가져오기가 꺼져 있습니다(계정 분류표 확인 전) — 사용하려면 운영사에 문의하세요.";

/**
 * ECOUNT 계정코드 → 경영 분류표(`ecount-ledger.ts`)는 첫 학원의 계정과목표 하나다 — 같은 코드가 다른 지점에서는 다른 계정일 수 있어,
 * **분류표가 맞다고 확인된 지점만** 회계 자료 가져오기·ECOUNT 월별 대조를 연다.
 * 판정 = 운영 콘솔의 지점 스위치 `ecount_accounting`(tenant_licenses · 🔴 줄이 없으면 꺼짐 · 조회 실패도 꺼짐 — `isFeatureOptedIn`).
 * 지점 id를 코드에 적지 않고, 원장이 학원 설정으로 바꿀 수도 없다(라이선스 표는 운영자만 쓴다). 첫 학원은 s2_0057가 켜 둔다.
 * 모르는 계정코드는 여전히 '분류 확인'으로 드러내고 집계에서 뺀다 — 이 스위치는 그 위의 문이다.
 */
export async function accountingImportAllowed(tenantId: string): Promise<boolean> {
  return isFeatureOptedIn(tenantId, "ecount_accounting");
}
export async function requireAccountingImport(tenantId: string): Promise<void> {
  if (!(await accountingImportAllowed(tenantId))) throw new ManagementInputError(ACCOUNTING_SCOPE_MESSAGE);
}
