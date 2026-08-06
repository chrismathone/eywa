import "server-only";
import { cache } from "react";
import {
  accessLevel,
  applyUserOverrides,
  canAccess,
  canWrite,
  resolveMatrix,
  type Access,
  type AccessMatrix,
  type MenuKey,
  type SystemRole,
} from "@/lib/permissions";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";

/**
 * 현재 테넌트의 유효 권한 매트릭스 = 하드코딩 MENU_ACCESS(기본값) + owner 설정 permissions override.
 * 요청당 1회(React cache). getTenantSettings도 cache라 추가 라운드트립 0(반응속도 #1).
 * 비로그인/설정없음 등 실패는 빈 override(=MENU_ACCESS 그대로)로 폴백 — 미인증 게이트는 호출부가 별도 처리.
 * ⚠️ getCurrentUser에 직접 싣지 않는 이유: current-user ← owner/queries ← current-user 순환 import 회피.
 *
 * ⚠️ super_admin 우회: super_admin(SaaS 총괄, super_admins 테이블)은 owner가 편집하는 역할·권한
 * 매트릭스 **위에** 있다 — owner(master) override가 super_admin까지 잠그면 안 됨(사용자 결정 2026-07-02).
 * super_admin이면 override를 무시하고 **코드 기본 MENU_ACCESS**로 취급(blanket full이 아니라 기본값 —
 * 역할 전용 화면(원스크린/내 학습) 접근이 새로 생기지 않고, 기본 master=전 메뉴 full이라 실질 전체 접근).
 * 비용: override가 0개면 검사 자체를 스킵(쿼리 0), 있으면 요청당 1회 캐시된 PK 조회(GoTrue 왕복 없음).
 */
export const getPermMatrix = cache(async (): Promise<AccessMatrix> => {
  try {
    const settings = await getTenantSettings();
    const overrides = settings.permissions.overrides;
    if (overrides.length > 0 && (await isCurrentUserSuperAdmin())) {
      return resolveMatrix([]);
    }
    return resolveMatrix(overrides);
  } catch (e) {
    // ⚠️ fail-open(코드 기본값 복귀) = revoke override가 일시 무효화되는 방향 — 의도적·최종 결정이다.
    // 이유: fail-closed(차단)는 설정 조회 장애 시 master까지 /owner에 못 들어가 **복구 불능 락아웃**이 된다
    // (override를 고칠 유일한 경로가 owner 콘솔인데 그게 막힘). 기본값은 master=full이라 fail-open이 복구 가능성을 보존.
    // self-escalation(비-master가 override 자기부여)은 0038a tenant_settings master-guard 트리거로 DB레벨 차단됨 →
    // override는 항상 master가 정당히 설정한 값이고, 일시 무효는 캐시 회복 시 자가복구되는 낮은 위험. 관측성 위해 로깅.
    console.error("[perm-matrix] getTenantSettings 실패 — 코드 기본 권한으로 폴백(override 일시 미적용)", e);
    return resolveMatrix([]);
  }
});

/**
 * 테넌트 매트릭스 위에 **현재 로그인 사용자의 개인 예외**(permissions.userOverrides)까지 얹은
 * "사용자 유효 매트릭스" — requireAccess·사이드바 등 현재 행위자 판정의 단일 소스(2026-08-01).
 * 자기 역할 행만 패치되므로 다른 역할 행을 읽는 소비처(레이아웃 강사뷰 가드 등)는 영향받지 않는다.
 * 비로그인·super_admin(테넌트 설정 위에 있음)·조회 실패는 테넌트 매트릭스 그대로(fail-open, 위와 동일 철학).
 */
export const getUserPermMatrix = cache(async (): Promise<AccessMatrix> => {
  const base = await getPermMatrix();
  try {
    const user = await getCurrentUser();
    if (!user) return base;
    const settings = await getTenantSettings(); // getPermMatrix와 같은 요청 캐시 — 추가 라운드트립 0
    const userOverrides = settings.permissions.userOverrides;
    if (userOverrides.length === 0) return base;
    if (await isCurrentUserSuperAdmin()) return base;
    return applyUserOverrides(base, user.id, user.systemRole, userOverrides);
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
  return canWrite(role, menu, await getUserPermMatrix());
}

/** 현재 사용자 유효 매트릭스로 접근 수준(readonly 다운그레이드가 쓰기 차단에 반영되도록). */
export async function accessLevelTenant(role: SystemRole, menu: MenuKey): Promise<Access> {
  return accessLevel(role, menu, await getUserPermMatrix());
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
