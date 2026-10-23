/**
 * 업체리스트(거래처 연락처)를 볼 수 있나 — 학원 설정 '역할·권한'의 개인별 기능 권한 **'업체리스트'에 지정한 사람만**
 * (`permissions.specialAccess.vendorViewerIds`).
 *
 * 🔴 **원장 역할·운영 계정도 지정이 있어야 본다** — 원장 2026-10-23 *"해당 기능은 이승엽만 보이게"*(이승엽 = 원장 역할 ·
 *    운영 계정). 다른 개인별 기능(원장은 지정 없이 통과)과 **다른 규칙**이고, "super_admin은 새 게이트를 자동 통과"
 *    (2026-08-13)의 명시 예외다 — 원장 역할 계정이 여럿이라 그 규칙을 따르면 "이승엽만"이 성립하지 않는다.
 * 🔴 코드에 계정 명단을 두지 않는다(staff.md '사람을 지정하는 권한은 전부 역할·권한 면에서').
 * ⚠️ 쓰기는 이것 **그리고** 재고관리 쓰기 게이트(`requireInventoryWrite`)를 둘 다 통과해야 한다.
 */
export function canViewVendors(userId: string, viewerIds: readonly string[] | undefined): boolean {
  return Array.isArray(viewerIds) && viewerIds.includes(userId);
}

export const VENDOR_DENIED_MSG = "업체리스트는 지정된 사람만 볼 수 있습니다";
