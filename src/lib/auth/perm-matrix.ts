import "server-only";
import { cache } from "react";
import {
  accessLevel,
  canAccess,
  canWrite,
  resolveMatrix,
  type Access,
  type AccessMatrix,
  type MenuKey,
  type SystemRole,
} from "@/lib/permissions";
import { getTenantSettings } from "@/features/owner/server/queries";
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

/** 현재 테넌트 매트릭스로 메뉴 접근 여부(읽기 게이트용 — none만 차단, readonly 통과). 매트릭스 fetch는 cache(1회). */
export async function canAccessTenant(role: SystemRole, menu: MenuKey): Promise<boolean> {
  return canAccess(role, menu, await getPermMatrix());
}

/**
 * 현재 테넌트 매트릭스로 쓰기 권한 여부(변경 서버 액션 게이트용 — full|scoped만 통과, readonly/none 차단).
 * ⚠️ 쓰기 액션은 canAccessTenant 대신 이걸 쓸 것(readonly 누수 방지).
 */
export async function canWriteTenant(role: SystemRole, menu: MenuKey): Promise<boolean> {
  return canWrite(role, menu, await getPermMatrix());
}

/** 현재 테넌트 매트릭스로 접근 수준(readonly 다운그레이드가 쓰기 차단에 반영되도록). */
export async function accessLevelTenant(role: SystemRole, menu: MenuKey): Promise<Access> {
  return accessLevel(role, menu, await getPermMatrix());
}
