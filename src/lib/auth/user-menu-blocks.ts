import type { AccessMatrix, MenuKey, SystemRole } from "@/lib/permissions";

/**
 * **개인 메뉴 차단 — 슈퍼관리자도 따르는 유일한 예외**(원장 2026-10-20 *"윤여원은 직원 관리페이지는 안보이게"*).
 *
 * 슈퍼관리자는 설계상 권한 매트릭스 **위**에 있어서(mergeMostPermissive — 잠금은 무시, 부여만 보존) 학원 설정의
 * 개인별 권한으로 메뉴를 '없음'으로 해도 무시된다. 원장 역할(master)도 개인 예외보다 위다. 그래서 "모든 권한은 주되
 * 이 메뉴 하나만은 닫는다"는 저장값으로 표현할 수 없고, 매트릭스를 **다 계산한 뒤 맨 끝에서** 누르는 이 명단이 맡는다.
 *
 * 🔴 명단은 원장이 명시로 지시한 것만. 이것은 "슈퍼관리자는 새 제한을 자동 통과"(결정 2026-08-13)의 **명시적 예외**다 —
 *    다른 사람에게 넓히거나 용도를 바꾸지 말고, 필요하면 원장에게 다시 물을 것.
 * 🔴 판정은 화면·서버 액션 게이트(requireAccess·canWriteTenant·사이드바·팔레트)가 함께 읽는 매트릭스에서 끝난다.
 *    DB(RLS `auth_menu_access`)는 master를 그대로 통과시킨다 — PostgREST 직결까지 막는 장치는 아니다.
 * 풀 때는 이 표에서 그 줄을 지운다.
 */
export const USER_MENU_BLOCKS: Readonly<Record<string, readonly MenuKey[]>> = {
  "07cbe245-e8c8-4938-a974-8873689f72f4": ["staff"], // 윤여원 — 원장 지시 2026-10-20
};

/** 이 사용자에게 막힌 메뉴를 주어진 역할 행에서 '없음'으로 누른 새 매트릭스. 막을 게 없으면 입력 그대로(요청 캐시 오염 방지 — 변형 금지). */
export function applyUserMenuBlocks(
  matrix: AccessMatrix,
  userId: string | null | undefined,
  roles: readonly SystemRole[],
  blocks: Readonly<Record<string, readonly MenuKey[]>> = USER_MENU_BLOCKS,
): AccessMatrix {
  const menus = userId ? blocks[userId] : undefined;
  if (!menus || menus.length === 0) return matrix;
  const out = { ...matrix };
  for (const menu of menus) {
    if (!out[menu]) continue;
    const row = { ...out[menu] };
    for (const role of roles) row[role] = "none";
    out[menu] = row;
  }
  return out;
}
