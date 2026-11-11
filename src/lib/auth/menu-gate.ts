import "server-only";
import type { MenuKey } from "@/lib/permissions";
import { getCurrentUser, type CurrentUser } from "./current-user";
import { canAccessTenant, canManageTenant, canWriteTenant } from "./perm-matrix";
import { isCurrentUserSuperAdmin } from "./super-admin";
import { readonlyTeacherViewError } from "./view-as";

export type MenuGate = { user: CurrentUser; superAdmin: boolean; write: boolean; manage: boolean; readAll: boolean };

/**
 * 서버 라우트·조회용 메뉴 문 — 페이지 문(`requireAccess` · 시안 때의 `requireSampleViewer`/`requireManagementSample`)과 같은 판정을
 * **리다이렉트 없이** 돌려준다(업무 작성센터 · 조직·OKR · 경영 분석·지식그래프, 2026-11-11 실제 기록 연결).
 * - 읽기 = 역할·권한 표(개인 권한 포함)의 그 메뉴 · 운영 계정은 늘 통과(결정 로그 2026-08-13 · 시안 문과 같다).
 * - 쓰기 = 그 메뉴 '전체'·'담당' · 관리 = '전체'. 다른 강사 뷰(열람) · 지점 보기에서는 누구든 쓰기·관리 불가(`readonlyTeacherViewError`).
 * - 읽는 범위(`readAll` — 남의 기록까지 보는가)는 쓰기 차단과 따로 간다: 지점 보기는 그 지점 원장의 자리라 전체를 읽는다(쓰기만 막힌다).
 *   다른 강사 뷰(열람)는 그 강사 본인 것만 — 캡이 '전체'를 지워 원래 값을 알 수 없어 좁은 쪽으로 둔다.
 * - 사람 = 강사뷰면 그 강사(#154 — 기록 명의·본인 판정은 보는 사람 기준).
 * 권한이 없으면 null — 호출부가 403이나 안내 문구로 바꾼다.
 */
export async function menuGate(menu: MenuKey): Promise<MenuGate | null> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return null;
  const superAdmin = await isCurrentUserSuperAdmin();
  if (!superAdmin && !(await canAccessTenant(user.systemRole, menu))) return null;
  const blocked = !!(await readonlyTeacherViewError());
  if (blocked) return { user, superAdmin, write: false, manage: false, readAll: !!user.tenantView };
  const [write, manage] = superAdmin ? [true, true] : await Promise.all([canWriteTenant(user.systemRole, menu), canManageTenant(user.systemRole, menu)]);
  return { user, superAdmin, write, manage, readAll: manage };
}
