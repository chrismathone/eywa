/**
 * 진도맵 **미리보기 명단** — 숨은 기능(원장 2026-09-14: *"본서버에 적용하더라도 숨겨진 기능으로 st2000423@gmail.com
 * 계정에게만 바로가기 열어둘 것"*).
 *
 * 🔑 급여명세서 명단([`payslip-access.ts`](../payroll/payslip-access.ts))과 같은 꼴 — 이름·이메일이 아니라 **user id**로
 *    잠근다(이력서 E-mail을 바꾸면 로그인 아이디가 바뀌므로 이메일은 매칭 키로 흔들린다). 이메일은 주석으로만.
 * 🔑 메뉴키·사이드바·권한 매트릭스를 건드리지 않는다 — 숨은 기능이라 메뉴에 없고, 진입로는 MCS 랜딩 머리의
 *    '진도맵(시안)' 링크 하나뿐이다(명단 밖 계정에겐 링크도 페이지도 없다 — 페이지는 404).
 * ⚠️ super_admin은 명단에 없어도 통과한다(원장 2026-08-13 *"superadmin은 앞으로 뭘 안해도 그냥 넣고봐"* — 새 게이트 상시 규약).
 *    판정은 `server/access.ts`의 `canPreviewProgressMap()`이 얹는다.
 * ⚠️ 시안이 끝나 전 직원에게 열 땐 이 명단이 아니라 **메뉴키(`mcs`) 권한 그대로**로 넘긴다(명단을 늘리지 말 것).
 */

/** 미리보기 계정. 주석의 이름·역할은 2026-09-14 실측(판정에 쓰지 않는다). */
export const PROGRESS_MAP_PREVIEW_USER_IDS: readonly string[] = [
  "fcf735fa-edf7-4095-8fa6-724285a018ed", // 박소선 (master · st2000423@gmail.com)
];

/** 명단에 있는가 — 순수 판정(super_admin 통과는 서버 게이트가 얹는다). */
export function isProgressMapPreviewUser(userId: string): boolean {
  return PROGRESS_MAP_PREVIEW_USER_IDS.includes(userId);
}
