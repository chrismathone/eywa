/**
 * 편집기 미리보기·배지용 — **역할 묶음이 열 수 있는 메뉴**(그 학원의 역할별 권한 override + 꺼진 기능을 반영).
 * 순수 함수: 학원 설정을 받아 계산한다(설정 화면이 서버에서 한 번 부른다 — 탭 및 메뉴 구성 면의 강사 권한 계산과 같은 길).
 *
 * ⚠️ 개인 예외(`permissions.userOverrides`)는 역할 단위가 아니라 반영하지 않는다 — 편집기 배지가 "이 역할은 OO 권한이 없어
 *    보이지 않습니다(개인 예외로 연 직원에겐 보일 수 있음)"라고 함께 적는다. 실제 화면의 상한은 서버가 **그 사람의** 권한으로 건다.
 * 상담·회계·열람도 각자의 시스템 역할로 계산한다. 총괄 자격은 코드 기본 권한을 하한으로 유지한다.
 */
import { MENU_KEYS, canAccess, mergeMostPermissive, resolveMatrix, type MenuKey, type PermissionOverride } from "@/lib/permissions";
import { capDisabledModules, type ModuleId } from "@/lib/modules";
import { BUNDLE_ROLES } from "./bundle";
import { BUNDLES, type Bundle } from "./types";

export function bundleMenus(settings: {
  permissions: { overrides: readonly PermissionOverride[] };
  modules: { disabled: readonly ModuleId[] };
}): Record<Bundle, MenuKey[]> {
  const matrix = capDisabledModules(resolveMatrix(settings.permissions.overrides), [...settings.modules.disabled]);
  const superMatrix = capDisabledModules(mergeMostPermissive(resolveMatrix([]), matrix), [...settings.modules.disabled]);
  return Object.fromEntries(
    BUNDLES.map((b) => [b, MENU_KEYS.filter((key) => BUNDLE_ROLES[b].some((role) => canAccess(role, key, b === "super" ? superMatrix : matrix)))]),
  ) as Record<Bundle, MenuKey[]>;
}
