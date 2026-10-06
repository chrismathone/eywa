// 급여명세서 열람 자격 — **원장 역할 + 학원 설정 '역할·권한'의 개인별 기능 권한에서 지정한 사람**.
//
// 원장 2026-10-06: *"개인 역할은 전부다 편집기"*. 전에는 이 파일이 계정 명단을 들고 있었다(2026-08-13 *"하드픽스"*) —
// 그때는 사람을 지정할 화면이 없었다. 명단이 코드에 있으면 원장이 누가 열려 있는지 볼 수도, 거둘 수도 없다
// (보는 곳과 정하는 곳이 갈린다). 지금은 `permissions.specialAccess.payslipViewerIds`가 단일 소스다.
//
// 🔴 **원장 역할은 지정 없이 본다**(원장 2026-10-06: *"원일은 원장인데 침산 전지점 권한이 있어야지"* ·
//    *"원일과 설현은 원장이니 최상위 권한일텐데"*). 2026-08-13에는 "원장이어도 명단에 있어야 본다"였다 — 그 규칙을 뒤집었다.
//    ⚠️ 그래서 누군가를 원장 역할로 올리면 급여명세서도 함께 열린다.
// 🔴 여기에 계정 명단을 다시 만들지 말 것(가드: payslip-access.test.ts).
// 🔴 원장이 아닌 사람에게는 **메뉴 권한과 다른 문**이다 — 급여명세서엔 주민번호·계좌·급여가 한 장에 실려서, 역할이 바뀌거나
//    (관리자 승급) 메뉴 권한을 손대는 것만으로 조용히 열리면 안 된다. 이름이 지정된 사람만 본다.
// ⚠️ 게이트가 여럿(화면·조회·저장·발행)이라 각자 판정을 복제하면 언젠가 한 곳만 열린 채 남는다([[#77]]) —
//    호출부는 전부 `canViewPayslipNow()`(server/payslip-gate.ts)를 지난다.
import type { SystemRole } from "@/lib/permissions";

export const PAYSLIP_DENIED_MSG = "급여명세서는 원장과 지정된 사람만 열람할 수 있습니다";

/**
 * 원장 역할이거나 지정된 사람인가 — **순수 판정**(테스트 가능).
 *
 * ⚠️ 실제 게이트는 이 함수가 아니라 **`canViewPayslipNow()`**다 — 기능이 꺼진 학원·운영 계정 판정이 거기 붙어 있다.
 */
export function canViewPayslip(user: { id: string; systemRole: SystemRole }, policy: { viewerIds: readonly string[] }): boolean {
  if (user.systemRole === "master") return true;
  // 저장값은 스키마를 거치지 않고 읽힌다 — 목록이 아니면(손으로 넣은 값) 지정된 사람이 없는 것으로 본다.
  return Array.isArray(policy.viewerIds) && policy.viewerIds.includes(user.id);
}
