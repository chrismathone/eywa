import "server-only";
import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import {
  accessLevel,
  MENU_KEYS,
  applyUserOverrides,
  canAccess,
  canWrite,
  mergeMostPermissive,
  resolveMatrix,
  SYSTEM_ROLES,
  type Access,
  type AccessMatrix,
  type MenuKey,
  type SystemRole,
} from "@/lib/permissions";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isTenantViewRequest, isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { isSignedInSuperAdmin } from "@/lib/auth/super-admin";
import { approvalMenuOverridesFor } from "@/features/approvals/access";
import { capDisabledModules } from "@/lib/modules";
// ⚠️ view-mode.ts가 아니라 view-as.ts에서 — view-mode는 teacher-scope·delegation을 물고 있어 순환 위험.
import { isReadonlyTeacherView, viewAsTeacher } from "@/lib/auth/view-as";
import { SETTINGS_ROLE_KEYS } from "@/lib/settings-role-catalog";
import { isFeatureLicensed, isFeatureOptedIn } from "@/lib/license/server";
import { capMakeupMode, normalizeMakeupSettings } from "@/features/makeups/config";
import { capLaboratoryMenus } from "@/lib/laboratory/rule";
import { getLaboratoryMenus } from "@/lib/laboratory/server";
import { applyUserMenuBlocks } from "@/lib/auth/user-menu-blocks";
import { capContributionMenu } from "@/features/student-contribution/model/access";

async function capLaboratory(matrix: AccessMatrix, tenantId: string): Promise<AccessMatrix> {
  matrix = capContributionMenu(matrix, tenantId);
  const menus = await getLaboratoryMenus();
  if (menus.length === 0) return matrix;
  return capLaboratoryMenus(matrix, menus, await isFeatureOptedIn(tenantId, "laboratory"));
}

async function capSettingFeatures(matrix: AccessMatrix, tenantId: string, role: SystemRole): Promise<AccessMatrix> {
  if (matrix.ai_ment[role] === "none" || await isFeatureLicensed(tenantId, "ai_analysis")) return matrix;
  return { ...matrix, ai_ment: { master: "none", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" } };
}

/**
 * 현재 테넌트의 유효 권한 매트릭스 = 하드코딩 MENU_ACCESS(기본값) + owner 설정 permissions override.
 * 요청당 1회(React cache). getTenantSettings도 cache라 추가 라운드트립 0(반응속도 #1).
 * 비로그인/설정없음 등 실패는 빈 override(=MENU_ACCESS 그대로)로 폴백 — 미인증 게이트는 호출부가 별도 처리.
 * ⚠️ getCurrentUser에 직접 싣지 않는 이유: current-user ← owner/queries ← current-user 순환 import 회피.
 *
 * ⚠️ super_admin 우회: super_admin(SaaS 총괄, super_admins 테이블)은 owner가 편집하는 역할·권한
 * 매트릭스 **위에** 있다 — owner(master) override가 super_admin까지 잠그면 안 됨(사용자 결정 2026-07-02).
 * super_admin이면 **코드 기본 MENU_ACCESS와 override 중 더 허용적인 쪽**을 취한다(mergeMostPermissive):
 * 잠금(낮추는 override)은 무시되고, 부여(올리는 override)는 보존된다. blanket full이 아니라 기본값이
 * 바닥이라 역할 전용 화면(원스크린/내 학습) 접근이 새로 생기지도 않는다.
 * 🔴 예전엔 override를 **통째로 버렸고**(`resolveMatrix([])`), 그래서 기본값이 `none`인 메뉴는
 *    super_admin에게 **일반 직원보다 덜** 보였다 — 2026-08-13 수업 평가·학원 설정 동시 실종의 원인.
 *    되돌리지 말 것(상세 = permissions.ts mergeMostPermissive 주석).
 * 비용: override가 0개면 검사 자체를 스킵(쿼리 0), 있으면 요청당 1회 캐시된 PK 조회(GoTrue 왕복 없음).
 */
export const getPermMatrix = cache(async (): Promise<AccessMatrix> => {
  try {
    const settings = await getTenantSettings();
    const makeupMode = normalizeMakeupSettings(settings.makeups).mode;
    const overrides = settings.permissions.overrides;
    // 🔴 꺼진 모듈(기능 묶음)은 **맨 끝에서** 전원 none — super_admin 병합으로도 안 열린다(그 학원엔 없는 기능이다).
    //    침산은 꺼진 모듈이 없어 capDisabledModules가 받은 매트릭스를 그대로 돌려준다(오늘과 같다).
    const disabled = settings.modules.disabled;
    if (overrides.length > 0 && (await isSignedInSuperAdmin())) {
      // 잠금은 무시(기본값이 살아남고), 부여는 보존(원장이 연 셀은 그대로) — mergeMostPermissive 주석 참조.
      return capLaboratory(capMakeupMode(capDisabledModules(mergeMostPermissive(resolveMatrix([]), resolveMatrix(overrides)), disabled), makeupMode), (await getCurrentUser())?.tenantId ?? "");
    }
    return capLaboratory(capMakeupMode(capDisabledModules(resolveMatrix(overrides), disabled), makeupMode), (await getCurrentUser())?.tenantId ?? "");
  } catch (e) {
    // Next가 흐름 제어에 쓰는 신호(끝난 '지점 보기'를 내보내는 이동 등 — current-user.ts)는 삼키지 않는다. 그 밖의 오류는 아래 폴백 그대로다.
    unstable_rethrow(e);
    // ⚠️ fail-open(코드 기본값 복귀) = revoke override가 일시 무효화되는 방향 — 의도적·최종 결정이다.
    // 이유: fail-closed(차단)는 설정 조회 장애 시 master까지 /owner에 못 들어가 **복구 불능 락아웃**이 된다
    // (override를 고칠 유일한 경로가 owner 콘솔인데 그게 막힘). 기본값은 master=full이라 fail-open이 복구 가능성을 보존.
    // self-escalation(비-master가 override 자기부여)은 0038a tenant_settings master-guard 트리거로 DB레벨 차단됨 →
    // override는 항상 master가 정당히 설정한 값이고, 일시 무효는 캐시 회복 시 자가복구되는 낮은 위험. 관측성 위해 로깅.
    console.error("[perm-matrix] getTenantSettings 실패 — 코드 기본 권한으로 폴백(override 일시 미적용)", e);
    return capLaboratory(capMakeupMode(resolveMatrix([]), "off"), (await getCurrentUser())?.tenantId ?? "");
  }
});

/**
 * 이 지점에서 **아무도** 열 수 없는 메뉴 — 꺼 둔 기능 · 보강 모드 '끔' · 실험실에 들지 않은 지점의 실험실 메뉴 · AI 라이선스가 없는 AI 멘트.
 * 역할 권한 · 개인 예외와 무관하게 위 조립의 **지점 단위 덮개만**(같은 함수 · 같은 차례) 전부 열린 표에 씌워 본다.
 * '탭 및 메뉴 구성' 편집기가 '없는 메뉴'를 세우지 않는 데 쓴다(원장 2026-10-14 *"없는 메뉴 (접근할 수 없는)"*).
 * 🔴 덮개를 더하면(새 지점 단위 제한) 여기에도 씌울 것. 조회 실패면 빈 목록 — 편집기가 메뉴를 더 보여 줄 뿐 아무것도 막지 않는다.
 */
export async function tenantClosedMenus(): Promise<MenuKey[]> {
  try {
    const [settings, user] = await Promise.all([getTenantSettings(), getCurrentUser()]);
    const tenantId = user?.tenantId ?? "";
    const open = Object.fromEntries(
      MENU_KEYS.map((menu) => [menu, Object.fromEntries(SYSTEM_ROLES.map((role) => [role, "full"]))]),
    ) as AccessMatrix;
    const base = capMakeupMode(capDisabledModules(open, settings.modules.disabled), normalizeMakeupSettings(settings.makeups).mode);
    // AI 멘트 라이선스는 역할마다 같은 판정이라 원장 줄로 한 번 본다(capSettingFeatures).
    const capped = await capSettingFeatures(await capLaboratory(base, tenantId), tenantId, "master");
    return MENU_KEYS.filter((menu) => SYSTEM_ROLES.every((role) => capped[menu][role] === "none"));
  } catch (e) {
    unstable_rethrow(e);
    console.error("[perm-matrix] 지점에서 닫힌 메뉴 계산 실패 — 빈 목록으로(메뉴 구성 편집기가 더 보여 줄 뿐이다)", e);
    return [];
  }
}

/**
 * '지점 보기'(읽기 전용)에서 **아예 닫는** 메뉴 — DB가 이 화면들의 지점을 `auth_tenant_id()`가 아니라 로그인한 사람의
 * `users` 행에서 직접 정한다. 보기 중에 열면 보는 지점이 아니라 운영자 **본인 지점**의 기록이 나오거나(보강관리),
 * 있는 기록이 없는 것처럼 비어 보인다(전자결재 · 급여 정책). 틀린 화면을 보여 주느니 닫는다.
 * 🔴 새 메뉴의 정책 · 함수가 `users`를 `auth.uid()`로 직접 읽는다면 여기에 더할 것.
 */
export const TENANT_VIEW_CLOSED_MENUS: readonly MenuKey[] = ["makeups", "approvals", "payroll_settings"];

/**
 * '다른 강사 뷰'에서 **아예 닫는** 메뉴 — 대상 강사에게 열려 있어도 닫는다(원장 2026-11-05 강사뷰 전수 점검).
 * 전자결재는 결재 · 기안이 **본인 서명**이고, 결재함 · 연차 · 결재선 판정을 DB 정책(`auth.uid()`)과 화면이 로그인한 사람으로
 * 정한다 — 열면 보는 사람의 결재함이 대상 강사 이름 아래 뜨고, 대상 강사 차례의 결재는 처리할 수 없다(틀린 화면).
 * 남의 이름으로 결재하는 길은 만들지 않는다 — 결재는 본인이 로그인해서 한다.
 */
export const TEACHER_VIEW_CLOSED_MENUS: readonly MenuKey[] = ["approvals"];

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용)면 그 자리(원장 줄)의 전체·담당 권한을 **읽기**로 누른다 — 없음은 그대로(읽기를 넓히지 않는다).
 * 사이드바·requireAccess·쓰기 게이트가 전부 이 매트릭스를 읽으므로 화면이 통째로 열람 전용이 된다.
 * 실제 쓰기 차단은 여기에 기대지 않는다(데이터 접근 층 tenant-view-guard.ts + DB 0356a).
 */
export function capTenantViewReadonly(matrix: AccessMatrix, role: SystemRole): AccessMatrix {
  return Object.fromEntries(MENU_KEYS.map((menu) => {
    const level = matrix[menu][role];
    const capped = TENANT_VIEW_CLOSED_MENUS.includes(menu) ? "none" : level === "full" || level === "scoped" ? "readonly" : level;
    return [menu, { ...matrix[menu], [role]: capped }];
  })) as AccessMatrix;
}

/**
 * 테넌트 매트릭스 위에 **현재 로그인 사용자의 개인 예외**(permissions.userOverrides)까지 얹은
 * "사용자 유효 매트릭스" — requireAccess·사이드바 등 현재 행위자 판정의 단일 소스(2026-08-01).
 * 자기 역할 행만 패치되므로 다른 역할 행을 읽는 소비처(레이아웃 강사뷰 가드 등)는 영향받지 않는다.
 * 비로그인·super_admin(테넌트 설정 위에 있음)·조회 실패는 테넌트 매트릭스 그대로(fail-open, 위와 동일 철학).
 *
 * ⚠️ **코드 기반 예외**도 같은 자리에서 얹는다 — 지금은 운영 계정이 기본값 '없음'인 메뉴(전자결재)를 여는 것뿐이다
 *    (approvals/access.ts — 사람 명단은 코드에 두지 않는다, 원장 2026-10-06). 저장된 설정보다 **먼저** 넣는다.
 *    이렇게 두면 사이드바·requireAccess·서버 액션이 전부 한 게이트를 공유한다(#77).
 *
 * 🔴 '지점 보기'(읽기 전용) 캡은 **맨 끝에서** 누른다 — 운영 계정 병합(잠금 무시 · 설정 메뉴 전체 권한)이 그 뒤에 오면
 *    읽기 전용이 다시 열린다. 계산은 아래 `resolveActorPermMatrix`, 여기는 캡만 얹는다.
 */
export const getActorPermMatrix = cache(async (): Promise<AccessMatrix> => {
  const matrix = await resolveActorPermMatrix();
  // 보기 = 그 지점 원장의 자리(current-user.ts)라 원장 줄을 누른다. 판정은 쿠키 하나를 보는 것이라 평소 요청엔 비용이 없다.
  const capped = (await isTenantViewRequest()) ? capTenantViewReadonly(matrix, "master") : matrix;
  // 🔴 개인 메뉴 차단은 **맨 끝**에서 — 슈퍼관리자 병합(낮추는 것 무시)보다 뒤여야 산다(user-menu-blocks.ts).
  //    지점 보기 중엔 원장 줄로 판정하므로 그 줄도 함께 누른다.
  const user = await getCurrentUser();
  return user ? applyUserMenuBlocks(capped, user.id, [user.systemRole, "master"]) : capped;
});

const resolveActorPermMatrix = cache(async (): Promise<AccessMatrix> => {
  const base = await getPermMatrix();
  try {
    const user = await getCurrentUser();
    if (!user) return base;
    const settings = await getTenantSettings(); // getPermMatrix와 같은 요청 캐시 — 추가 라운드트립 0
    const makeupMode = normalizeMakeupSettings(settings.makeups).mode;
    // 기본값이 전 역할 '없음'인 메뉴(전자결재)는 운영 계정이 따로 통과한다(원장 지시 2026-08-13). 그 밖의 개인별 권한은
    // 전부 저장값이다 — 학원 설정 '개인별 메뉴 권한'(원장 2026-10-06: 역할 권한이 기본 · 개인에게는 편집기에서. 코드 명단 폐지).
    // 요청 캐시된 PK 조회 1회이고, override가 있는 테넌트는 getPermMatrix에서 이미 부른 그 캐시다.
    const isSuperAdmin = await isSignedInSuperAdmin();
    const codeOverrides = approvalMenuOverridesFor(user.id, isSuperAdmin);
    const userOverrides = [...codeOverrides, ...settings.permissions.userOverrides];
    if (userOverrides.length === 0 && !isSuperAdmin) return capSettingFeatures(base, user.tenantId, user.systemRole);
    const applied = applyUserOverrides(base, user.id, user.systemRole, userOverrides);
    // super_admin도 **부여는 받는다**(예전엔 base로 되돌려 개인 예외가 통째로 날아갔다 — 2026-08-13
    // 수업 평가 실종의 절반). 개인 예외로 잠그는(낮추는) 것만 무시하려고 높은 쪽을 취한다.
    // 🔴 개인 예외가 꺼진 모듈 메뉴를 다시 열 수 있으니 한 번 더 누른다(base는 이미 눌려 있다).
    const disabled = settings.modules.disabled;
    // 🔴 저장된 개인 예외는 코드 예외 **뒤**에 얹혀 이긴다 — super_admin에게 코드가 준 전자결재(full)를 저장된
    //    `none` 한 줄이 덮으면 기본값도 none이라 잠긴다(보호 계정 점검 2026-09-30). 코드 예외만 얹은 매트릭스도
    //    함께 병합해 **어느 쪽이 준 부여든** 남긴다(낮추는 것만 무시 — 위 원칙 그대로).
    if (isSuperAdmin) {
      const codeOnly = applyUserOverrides(base, user.id, user.systemRole, codeOverrides);
      const merged = mergeMostPermissive(mergeMostPermissive(base, applied), codeOnly);
      // 슈퍼관리자는 공용 설정의 역할 제한으로 잠기지 않는다.
      for (const menu of SETTINGS_ROLE_KEYS) merged[menu] = { ...merged[menu], [user.systemRole]: "full" };
      return capSettingFeatures(capMakeupMode(capDisabledModules(merged, disabled), makeupMode), user.tenantId, user.systemRole);
    }
    return capSettingFeatures(capMakeupMode(capDisabledModules(applied, disabled), makeupMode), user.tenantId, user.systemRole);
  } catch (e) {
    unstable_rethrow(e); // 위와 같다 — 이동 신호는 삼키지 않는다
    console.error("[perm-matrix] 개인 예외 적용 실패 — 테넌트 매트릭스로 폴백", e);
    return base;
  }
});

/** A selected teacher view has that teacher's role and personal permissions, never the viewer's broader powers. */
export const getUserPermMatrix = cache(async (): Promise<AccessMatrix> => {
  const actor = await getActorPermMatrix();
  const target = await viewAsTeacher();
  if (!target) return capLaboratory(actor, (await getCurrentUser())?.tenantId ?? "");
  const user = await getCurrentUser();
  if (!user) return actor;
  const settings = await getTenantSettings();
  const targetMatrix = await capSettingFeatures(capMakeupMode(capDisabledModules(
    applyUserOverrides(resolveMatrix(settings.permissions.overrides), target.id, target.systemRole, settings.permissions.userOverrides),
    settings.modules.disabled), normalizeMakeupSettings(settings.makeups).mode), target.tenantId, target.systemRole);
  return capLaboratory(Object.fromEntries(MENU_KEYS.map((menu) => {
    // 원스크린은 역할 메뉴가 아니라 검증된 강사뷰의 홈이다. 겸직 직원은 실제 역할(admin 등)의
    // 값이 none이므로 이를 teacher 행에 복사하면 /onescreen → /onescreen 리다이렉트가 반복된다.
    // 본인 겸직 강사뷰와 동일하게 이 메뉴만 teacher 행을 쓰고, 나머지는 대상의 개인 권한을 유지한다.
    const value = TEACHER_VIEW_CLOSED_MENUS.includes(menu) ? "none" : targetMatrix[menu][menu === "teacher_onescreen" ? "teacher" : target.systemRole];
    const level = target.access === "readonly" && (value === "full" || value === "scoped") ? "readonly" : value;
    return [menu, { ...actor[menu], [user.systemRole]: level, [target.systemRole]: level, teacher: level }];
  })) as AccessMatrix, user.tenantId).then((m) =>
    // 다른 강사 뷰는 대상 값으로 내 역할 줄을 다시 쓰므로 개인 메뉴 차단을 한 번 더 누른다(user-menu-blocks.ts).
    // 보는 사람(A)의 차단과 **대상(X)의 차단 둘 다** — X에게 막힌 메뉴가 X의 강사뷰에서 열리지 않게(2026-11-05 강사뷰 적대 리뷰),
    // A에게 막힌 메뉴를 강사뷰로 우회하지 못하게.
    capContributionMenu(applyUserMenuBlocks(applyUserMenuBlocks(m, user.id, [user.systemRole, target.systemRole, "teacher"]), target.id, [user.systemRole, target.systemRole, "teacher"]), user.tenantId),
  );
});

/**
 * 현재 사용자 유효 매트릭스로 메뉴 접근 여부(읽기 게이트용 — none만 차단, readonly 통과).
 * 매트릭스 fetch는 cache(1회). ⚠️ role 인자는 **현재 행위자의 역할**만 넘길 것 — 개인 예외가
 * 현재 사용자 기준으로 얹히므로 남의 역할을 넘기면 판정이 섞인다(2026-08-01 전 호출처 확인함).
 */
export async function canAccessTenant(role: SystemRole, menu: MenuKey): Promise<boolean> {
  return canAccess(role, menu, await getUserPermMatrix());
}

/**
 * 현재 사용자 유효 매트릭스로 쓰기 권한 여부(변경 서버 액션 게이트용 — full|scoped만 통과, readonly/none 차단).
 * ⚠️ 쓰기 액션은 canAccessTenant 대신 이걸 쓸 것(readonly 누수 방지). role 인자 주의는 위와 동일.
 */
export async function canWriteTenant(role: SystemRole, menu: MenuKey): Promise<boolean> {
  // 🔴 '다른 강사 뷰'(열람 전용, 원장 2026-08-19)면 **누구든**(master·super_admin 포함) 쓰기 불가 —
  //    이 한 곳이 출석·보강·학생·상담·성적·케어 등 canWriteTenant를 지나는 모든 mutation의 중앙 캡이다.
  //    본인 강사뷰(겸직)·관리자뷰는 viewAsTeacher()=null이라 영향 0. UI 쓰기 플래그(canEditAttendance 등)도
  //    같은 함수를 읽어 화면이 자동으로 열람 전용이 된다.
  if (await isReadonlyTeacherView()) return false;
  // 운영 콘솔의 '지점 보기'도 같은 자리에서 막는다(매트릭스 캡과 이중 — 매트릭스 조회가 폴백을 타도 쓰기는 닫힌다).
  // 보기 쿠키가 있는데 확인하지 못한 요청도 막는다(데이터 접근 층의 쓰기 가드와 같은 판정 — tenant-view.ts).
  if (await isTenantViewWriteBlocked()) return false;
  return canWrite(role, menu, await getUserPermMatrix());
}

/** 현재 사용자 유효 매트릭스로 접근 수준(readonly 다운그레이드가 쓰기 차단에 반영되도록). */
export async function accessLevelTenant(role: SystemRole, menu: MenuKey): Promise<Access> {
  const level = accessLevel(role, menu, await getUserPermMatrix());
  // '다른 강사 뷰'는 열람 전용 — full/scoped를 readonly로 캡(ECS requireEcsClassAccess의 canWrite,
  // canManageTenant=학생 레코드 게이트 등이 이 수준을 본다). none은 그대로(읽기를 넓히지 않는다).
  if ((level === "full" || level === "scoped") && (await isReadonlyTeacherView())) return "readonly";
  if ((level === "full" || level === "scoped") && (await isTenantViewWriteBlocked())) return "readonly";
  return level;
}

/**
 * **학원 전체를 바꾸는 관리 작업**인가 — `full`(관리자 계열)만 통과.
 *
 * 🔴 `canWriteTenant`와 헷갈리지 말 것. 그건 `scoped`(강사)도 true다 — 뜻이 *"내 담당 것은 쓸 수 있다"*이지
 *    *"학원 전체를 건드려도 된다"*가 아니다. 반 생성·강의실 자동배정·학생 반 이동처럼 **남의 반까지 바뀌는**
 *    조작에 canWriteTenant를 걸면 강사가 통과한다(2026-08-06 원장 제보로 실측 확인: 강사 화면에 '새 반'·
 *    '강의실 자동배정'·시간표 '편집'이 그대로 떴고 서버 게이트도 열려 있었다).
 * ⚠️ 판정 기준은 **"담당(scoped) 개념이 성립하는 작업인가"**다. 성립하면 canWriteTenant + 담당 반 좁히기,
 *    성립하지 않으면(전체/없음만 의미 있으면) 이 함수. UI 노출도 **같은 함수**를 거쳐야 한다 — 화면에서만
 *    숨기는 건 게이트가 아니다(#77).
 */
export async function canManageTenant(role: SystemRole, menu: MenuKey): Promise<boolean> {
  return (await accessLevelTenant(role, menu)) === "full";
}
