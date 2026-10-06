/**
 * 전자결재 메뉴 접근 — **역할별 메뉴 권한이 기본이고, 개인에게는 학원 설정의 '개인별 메뉴 권한'에서 준다.**
 *
 * 원장 2026-10-06: *"전부다 역할 권한을 기본으로 움직이도록 하고, 필요한건 개인 권한을 따로 편집기에서 줘서 할것."*
 * 전에는 파일럿 계정 넷(2026-08-14 *"일단 테스트용이라 이승엽 김예원만 보이게"* → 테스터 · 엄소윤 추가)을 **이 파일의 코드 명단**으로
 * 열었다 — 그때는 저장값(개인 예외)을 넣을 화면이 없어서였다. 지금은 역할·권한 면에서 원장이 직접 주고 거두므로 명단을 없앴다.
 * 명단이 코드에 있으면 그 화면에 줄이 안 보이는데도 열려 있고 × 로 거둘 수도 없다(권한을 보는 곳과 정하는 곳이 갈린다).
 *
 * 🔴 여기에 계정 명단을 다시 만들지 말 것. `MENU_ACCESS.approvals`의 기본값은 전 역할 '없음'이다 — 여는 길은 둘뿐이다:
 *    ① 역할·권한 표에서 그 역할의 '전자결재' 칸을 연다 ② '개인별 메뉴 권한'에서 그 사람에게 준다.
 * ⚠️ 결재자·참조자 **후보 풀은 메뉴 권한과 무관하다** — 활성 직원 전원이다(원장 2026-08-14: *"결재자랑 이런 건 직원들 다
 *    있어야지"*). 메뉴가 없는 직원도 결재자로 지정되면 **벨 알림의 문서 링크로** 들어가 결재한다(문서 열람·결재 자격은 메뉴가
 *    아니라 동결된 결재선 — 결정 로그).
 * 🔴 단 **강사 역할은 예외다** — 강사 화면의 가드(`(shell)/layout.tsx`)가 `/approvals/<문서>`도 전자결재 메뉴로 판정해,
 *    그 칸이 '없음'이면 문서를 새로 열 때(주소 입력 · 새로고침) 강사 홈으로 보낸다(벨 알림으로 넘어온 이동에서는 열릴 수 있지만
 *    믿을 수 있는 길이 아니다). 강사를 결재자로 세우거나 강사가 기안하게 하려면 전자결재를 열어 줘야 한다.
 */

import type { MenuKey, UserPermissionOverride } from "@/lib/permissions";

/** 기본값이 전 역할 '없음'이라 운영 계정이 따로 통과해야 하는 메뉴. */
const DEFAULT_CLOSED_MENUS: readonly MenuKey[] = ["approvals"];

/**
 * 권한 매트릭스에 얹을 **코드 기반 예외** — 운영 계정(super_admin)만이다. `tenant_settings`의 userOverrides와 같은 모양이라
 * `applyUserOverrides`가 그대로 처리한다(사이드바·requireAccess·서버 액션이 한 게이트를 공유).
 *
 * ⚠️ super_admin은 어떤 제한에도 걸리지 않는다 — 원장 지시(2026-08-13) *"superadmin은 앞으로 뭘 안해도 그냥 넣고봐"*.
 *    기본값이 '없음'인 메뉴는 "기본값과 저장값 중 높은 쪽"(mergeMostPermissive)으로는 열리지 않아 여기서 얹는다.
 * ⚠️ 저장된 설정(userOverrides)보다 **먼저** 적용된다 — 순서는 perm-matrix.ts가 정한다.
 */
export function approvalMenuOverridesFor(userId: string, isSuperAdmin: boolean): UserPermissionOverride[] {
  if (!isSuperAdmin) return [];
  return DEFAULT_CLOSED_MENUS.map((menu) => ({ userId, menu, access: "full" as const }));
}
