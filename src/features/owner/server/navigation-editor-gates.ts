import "server-only";
import { tenantClosedMenus } from "@/lib/auth/perm-matrix";
import { capDisabledModules } from "@/lib/modules";
import { teacherMenuKeysFor } from "@/lib/navigation";
import { resolveMatrix, type MenuKey } from "@/lib/permissions";
import { personallyOpenedMenus } from "../navigation-editor-source";
import type { TenantSettings } from "../settings-types";
import { getUserSystemRoles } from "./queries";

/**
 * '탭 및 메뉴 구성' 편집기에 넘기는 판정 셋(원장 2026-10-14 *"없는 메뉴 (접근할 수 없는)"* — 규칙은 `navigation-editor-source.ts`).
 *  · `closed` = 이 지점에서 아무도 못 여는 메뉴(꺼 둔 기능 · 보강 모드 · 실험실 · 라이선스 — `tenantClosedMenus`).
 *  · `teacherOpen` = 강사 역할로 열린 '내 메뉴'(이 학원의 역할 권한 + 위 닫힘). 보는 사람의 표를 쓰지 않는다 — 운영 계정은 잠금을 무시한 병합이라 실제 강사 화면과 다르다.
 *  · `teacherPersonal` = 개인별 메뉴 권한으로 **강사 계정**에게 연 메뉴(강사 역할엔 꺼져 있어도 그 선생님 '내 메뉴'에는 선다).
 * '탭 및 메뉴 구성' 면을 열 때만 부른다(다른 면 진입 비용 0). 독립 조회 둘은 함께 띄운다(B4).
 */
export async function navigationEditorGates(settings: TenantSettings): Promise<{ closed: MenuKey[]; teacherOpen: MenuKey[]; teacherPersonal: MenuKey[] }> {
  const overrides = settings.permissions.userOverrides;
  const [closed, roles] = await Promise.all([tenantClosedMenus(), getUserSystemRoles(overrides.map((r) => r.userId))]);
  const shut = new Set(closed);
  const teacherOpen = teacherMenuKeysFor("teacher", capDisabledModules(resolveMatrix(settings.permissions.overrides), settings.modules.disabled)).filter((menu) => !shut.has(menu));
  // 역할 조회가 실패하면(null) 전부 센다 — 편집기에 메뉴가 더 보일 뿐이다.
  const teacherRows = roles === null ? overrides : overrides.filter((r) => roles[r.userId] === "teacher");
  return { closed, teacherOpen, teacherPersonal: personallyOpenedMenus(teacherRows, closed) };
}
