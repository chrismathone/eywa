/**
 * 공유 Google 스프레드시트에 추가되는 eywa 전용 탭의 이름 규약(순수 로직).
 *
 * eywa는 ijw(또는 다른 앱)와 **한 시트를 공유**하므로, 자기 탭을 `eywa·{tenant}·` 접두로
 * 네임스페이스해 ① 어느 탭이 eywa(이 테넌트) 것인지 식별하고(재동기화 시 직전 탭만 교체)
 * ② 남의 탭 **및 다른 테넌트의 eywa 탭**과 충돌하지 않게 한다.
 *
 * ⚠️ **테넌트 토큰을 접두에 포함**하는 이유: 두 테넌트가 (수동 googleSheetId 폴백 등으로) 우연히
 * 같은 시트를 가리키면, 토큰이 없을 때 한 테넌트의 동기화가 `eywa·` 접두만 보고 **다른 테넌트의
 * 탭까지 삭제**(교차 덮어쓰기·로스터 노출)한다. 토큰을 넣으면 재동기화 교체 대상이 **자기 테넌트
 * 탭으로만** 좁혀진다.
 *
 * 익스포터 탭명(전체 `수학 {weekLabel}`·강사명·`_meta`)은 주차마다 바뀌므로, 재동기화 교체 대상은
 * 정확한 이름이 아니라 **접두 일치**로 판별한다(지난주 `eywa·{t}·수학 6월 3주` → 이번주 것으로 교체).
 */

/** eywa 탭 네임스페이스 루트 접두(테넌트 토큰 앞에 붙는다). */
export const EYWA_TAB_PREFIX = "eywa·";

/**
 * Excel·Google Sheets 양쪽에서 안전한 탭 제목으로 정리.
 * - 금지문자(`\ / : * ? " [ ]`) → `_` (Excel/Sheets 공통 거부 문자 집합)
 * - 100자 클램프(Google Sheets 탭 제목 상한)
 */
export function sanitizeSheetTitle(title: string): string {
  return title.replace(/[\\/:*?"\[\]]/g, "_").slice(0, 100);
}

/**
 * 이 테넌트의 eywa 탭 접두 — `eywa·{tenantToken}·`.
 * tenantToken은 테넌트별 안정 식별자(예: `tenantId.slice(0,8)`). 금지문자는 정리한다.
 */
export function eywaTabPrefix(tenantToken: string): string {
  const token = tenantToken.replace(/[\\/:*?"\[\]·]/g, "_");
  return `${EYWA_TAB_PREFIX}${token}·`;
}

/** 원본 탭 제목 → 이 테넌트의 `eywa·{tenant}·` 접두를 붙인 최종 탭 제목(총 100자 이내 보장). */
export function eywaTabTitle(originalTitle: string, tenantToken: string): string {
  const prefix = eywaTabPrefix(tenantToken);
  const room = 100 - prefix.length;
  const base = sanitizeSheetTitle(originalTitle).slice(0, Math.max(0, room));
  return `${prefix}${base}`;
}

/** 이 테넌트가 이전에 추가한 탭인지 — 재동기화 시 삭제(교체) 대상 판별(다른 테넌트 탭은 제외). */
export function isEywaTab(title: string, tenantToken: string): boolean {
  return title.startsWith(eywaTabPrefix(tenantToken));
}
