/**
 * 업체리스트(거래처 연락처) 열람 = **재고관리를 열 수 있는 직원 전원**(원장 2026-10-28 *"업체리스트 전직원사용가능하게 풀고"*).
 * ~~2026-10-23 '지정한 사람만'(specialAccess.vendorViewerIds)~~ → 폐지. 판정은 서버 `canViewVendorsNow` 한 곳.
 * 쓰기는 재고관리 쓰기 게이트(`requireInventoryWrite`) 그대로.
 */
export const VENDOR_DENIED_MSG = "업체리스트를 볼 권한이 없습니다";
