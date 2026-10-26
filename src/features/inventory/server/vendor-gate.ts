import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { canViewVendors, VENDOR_DENIED_MSG } from "../vendor-access";
import { requireInventoryWrite, type InventoryWriteCtx } from "./access";

/**
 * 업체리스트 게이트 — 탭 노출 · 건수 · 조회 · 등록/수정/삭제가 전부 이 한 함수를 지난다([[#77]] — 탭만 감추면 주소로 열린다).
 * 판정 주체는 로그인한 본인이다('다른 강사 뷰'·지점 보기의 대상이 아니다). 설정 조회 실패는 닫는다(연락처는 지정된 사람만).
 */
export const canViewVendorsNow = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user || user.tenantView) return false;
  try {
    const settings = await getTenantSettings();
    return canViewVendors(user.id, settings.permissions.specialAccess.vendorViewerIds);
  } catch {
    return false;
  }
});

/**
 * 업체리스트 **쓰기** = 재고관리 쓰기 게이트(`requireInventoryWrite`) **그리고** 업체리스트 지정 — 둘 중 하나라도 아니면 거절.
 * 등록 창 액션(vendor-actions)과 엑셀 가져오기(vendor-excel-actions)가 같은 이 함수를 지난다.
 * ⚠️ 여기("use server" 아님)에 둔다 — 액션 파일에서 export하면 클라가 부를 수 있는 엔드포인트가 된다.
 */
export async function requireVendorWrite(): Promise<InventoryWriteCtx | { error: string }> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  if (!(await canViewVendorsNow())) return { error: VENDOR_DENIED_MSG };
  return ctx;
}
