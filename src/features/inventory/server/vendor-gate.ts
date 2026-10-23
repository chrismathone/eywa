import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { canViewVendors } from "../vendor-access";

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
