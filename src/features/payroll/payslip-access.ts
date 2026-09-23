// 급여명세서 열람 자격 — **하드 픽스 명단**(원장 지시 2026-08-13: *"박소선, 원일, 설현, 김예원 하드픽스"*).
//
// 🔴 왜 권한 매트릭스가 아니라 하드코딩인가: 원장이 "하드 픽스"를 명시했다. 급여명세서엔 주민번호·계좌·
//    급여가 한 장에 다 실려서, 역할이 바뀌거나(관리자 승급) 메뉴 권한을 손대는 순간 조용히 열리면 안 된다.
//    역할·메뉴 게이트는 다른 이유로 움직이는 물건이라, 이 문서만은 **이름이 적힌 사람만** 본다.
//
// 🔑 이름이 아니라 **user id**로 잠근다 — 동명이인·개명에 흔들리지 않는다(2026-08-13 실측: 이 4명은
//    동명이인 없음, 그래도 id가 정답이다). 이름은 주석으로만 남긴다.
// ⚠️ 사람이 바뀌면 **여기 한 곳**만 고친다. 게이트가 4곳(화면·조회·저장·발행)이라 각자 복제하면 언젠가
//    한 곳만 열린 채 남는다(#77 — 화면에서만 잠그면 우회된다).

import type { SystemRole } from "@/lib/permissions";

/** 열람 허용 계정. 주석의 이름·역할은 2026-08-13 실측값(설명용이며 판정에 쓰지 않는다). */
export const PAYSLIP_VIEWER_IDS: readonly string[] = [
  "fcf735fa-edf7-4095-8fa6-724285a018ed", // 박소선 (master)
  "94007db7-12d3-4b5d-97f2-39071446536b", // 원일 (master)
  "44626c09-22d9-445f-a350-b792d6afdf75", // 설현 (admin)
  "8bb70f71-a8c3-450c-9236-561e9b43ca4f", // 김예원 (admin)
  "477950d4-9cb0-4c02-9ac4-f00d42754d55", // 이승엽 (admin · super_admin)
];

export const PAYSLIP_DENIED_MSG = "급여명세서는 지정된 계정만 열람할 수 있습니다";

/**
 * 명단에 이름이 올라 있는가 — **순수 판정**(테스트 가능).
 *
 * ⚠️ master라고 무조건 통과시키지 않는다 — 명단이 곧 전부다. 새 원장이 생겨도 명단에 넣기 전엔 안 열린다
 *    (조용히 넓히는 쪽이 더 위험하다).
 * ⚠️ 실제 게이트는 이 함수가 아니라 **`canViewPayslipNow()`**(server/payslip-gate.ts)다 —
 *    super_admin 자동 통과가 거기 붙어 있다. 새 호출부는 그쪽을 쓸 것.
 */
export function canViewPayslip(
  user: { id: string; systemRole: SystemRole },
  policy: { isChinsanTenant: boolean; viewerIds: readonly string[] },
): boolean {
  return policy.isChinsanTenant
    ? PAYSLIP_VIEWER_IDS.includes(user.id)
    : policy.viewerIds.includes(user.id);
}
