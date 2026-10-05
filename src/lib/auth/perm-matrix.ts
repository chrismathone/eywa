import "server-only";
import { cache } from "react";
import {
  accessLevel,
  applyUserOverrides,
  canAccess,
  canWrite,
  mergeMostPermissive,
  resolveMatrix,
  type Access,
  type AccessMatrix,
  type MenuKey,
  type SystemRole,
} from "@/lib/permissions";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isChinsanTenant } from "@/features/owner/preset";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { approvalMenuOverridesFor } from "@/features/approvals/access";
import { capDisabledModules } from "@/lib/modules";
// ⚠️ view-mode.ts가 아니라 view-as.ts에서 — view-mode는 teacher-scope·delegation을 물고 있어 순환 위험.
import { isReadonlyTeacherView } from "@/lib/auth/view-as";
import { SETTINGS_ROLE_KEYS } from "@/lib/settings-role-catalog";
import { isFeatureLicensed } from "@/lib/license/server";
import { capMakeupMode, normalizeMakeupSettings } from "@/features/makeups/config";

async function capSettingFeatures(matrix: AccessMatrix, tenantId: string, role: SystemRole): Promise<AccessMatrix> {
  if (matrix.ai_ment[role] === "none" || await isFeatureLicensed(tenantId, "ai_analysis")) return matrix;
  return { ...matrix, ai_ment: { master: "none", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "none" } };
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
    if (overrides.length > 0 && (await isCurrentUserSuperAdmin())) {
      // 잠금은 무시(기본값이 살아남고), 부여는 보존(원장이 연 셀은 그대로) — mergeMostPermissive 주석 참조.
      return capMakeupMode(capDisabledModules(mergeMostPermissive(resolveMatrix([]), resolveMatrix(overrides)), disabled), makeupMode);
    }
    return capMakeupMode(capDisabledModules(resolveMatrix(overrides), disabled), makeupMode);
  } catch (e) {
    // ⚠️ fail-open(코드 기본값 복귀) = revoke override가 일시 무효화되는 방향 — 의도적·최종 결정이다.
    // 이유: fail-closed(차단)는 설정 조회 장애 시 master까지 /owner에 못 들어가 **복구 불능 락아웃**이 된다
    // (override를 고칠 유일한 경로가 owner 콘솔인데 그게 막힘). 기본값은 master=full이라 fail-open이 복구 가능성을 보존.
    // self-escalation(비-master가 override 자기부여)은 0038a tenant_settings master-guard 트리거로 DB레벨 차단됨 →
    // override는 항상 master가 정당히 설정한 값이고, 일시 무효는 캐시 회복 시 자가복구되는 낮은 위험. 관측성 위해 로깅.
    console.error("[perm-matrix] getTenantSettings 실패 — 코드 기본 권한으로 폴백(override 일시 미적용)", e);
    return capMakeupMode(resolveMatrix([]), "off");
  }
});

/**
 * 테넌트 매트릭스 위에 **현재 로그인 사용자의 개인 예외**(permissions.userOverrides)까지 얹은
 * "사용자 유효 매트릭스" — requireAccess·사이드바 등 현재 행위자 판정의 단일 소스(2026-08-01).
 * 자기 역할 행만 패치되므로 다른 역할 행을 읽는 소비처(레이아웃 강사뷰 가드 등)는 영향받지 않는다.
 * 비로그인·super_admin(테넌트 설정 위에 있음)·조회 실패는 테넌트 매트릭스 그대로(fail-open, 위와 동일 철학).
 *
 * ⚠️ **코드 기반 개인 예외**(파일럿 기능)도 같은 자리에서 얹는다 — 지금은 휴가관리(2026-08-14,
 *    이승엽·김예원 + 연차 조정 담당 박소선)뿐이다. 저장된 설정보다 **먼저** 넣어 원장이 owner 콘솔에서 덮어쓸 수 있게 한다.
 *    이렇게 두면 사이드바·requireAccess·서버 액션이 전부 한 게이트를 공유한다(#77).
 */
export const getUserPermMatrix = cache(async (): Promise<AccessMatrix> => {
  const base = await getPermMatrix();
  try {
    const user = await getCurrentUser();
    if (!user) return base;
    const settings = await getTenantSettings(); // getPermMatrix와 같은 요청 캐시 — 추가 라운드트립 0
    const makeupMode = normalizeMakeupSettings(settings.makeups).mode;
    // 파일럿 명단 판정에 super_admin 여부가 필요하다(명단에 없어도 통과 — 원장 지시 2026-08-13).
    // 명단 자체는 침산 전용이다. 일반 프리셋은 저장된 개인 예외만 사용한다.
    // 요청 캐시된 PK 조회 1회이고, override가 있는 테넌트는 getPermMatrix에서 이미 부른 그 캐시다.
    const isSuperAdmin = await isCurrentUserSuperAdmin();
    const codeOverrides = approvalMenuOverridesFor(user.id, isSuperAdmin, isChinsanTenant(settings));
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
    console.error("[perm-matrix] 개인 예외 적용 실패 — 테넌트 매트릭스로 폴백", e);
    return base;
  }
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
  return canWrite(role, menu, await getUserPermMatrix());
}

/** 현재 사용자 유효 매트릭스로 접근 수준(readonly 다운그레이드가 쓰기 차단에 반영되도록). */
export async function accessLevelTenant(role: SystemRole, menu: MenuKey): Promise<Access> {
  const level = accessLevel(role, menu, await getUserPermMatrix());
  // '다른 강사 뷰'는 열람 전용 — full/scoped를 readonly로 캡(ECS requireEcsClassAccess의 canWrite,
  // canManageTenant=학생 레코드 게이트 등이 이 수준을 본다). none은 그대로(읽기를 넓히지 않는다).
  if ((level === "full" || level === "scoped") && (await isReadonlyTeacherView())) return "readonly";
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
