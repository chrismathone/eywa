import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { VENDOR_DENIED_MSG } from "../vendor-access";
import { requireInventoryWrite, type InventoryWriteCtx } from "./access";

/**
 * 업체리스트 게이트 — 탭 노출 · 건수 · 조회 · 등록/수정/삭제가 전부 이 한 함수를 지난다([[#77]] — 탭만 감추면 주소로 열린다).
 * 열람 = 재고관리 메뉴를 열 수 있는 직원 전원(원장 2026-10-28 — 10-23 '지정한 사람만'을 풀었다). 지점 보기는 그대로 닫는다.
 */
export const canViewVendorsNow = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user || user.tenantView) return false;
  return canAccessTenant(user.systemRole, "inventory");
});

/**
 * 업체리스트 **쓰기** = 재고관리 쓰기 게이트(`requireInventoryWrite`) **그리고** 열람 게이트 — 둘 중 하나라도 아니면 거절.
 * 등록 창 액션(vendor-actions)과 엑셀 가져오기(vendor-excel-actions)가 같은 이 함수를 지난다.
 * ⚠️ 여기("use server" 아님)에 둔다 — 액션 파일에서 export하면 클라가 부를 수 있는 엔드포인트가 된다.
 */
export async function requireVendorWrite(): Promise<InventoryWriteCtx | { error: string }> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  if (!(await canViewVendorsNow())) return { error: VENDOR_DENIED_MSG };
  return ctx;
}
