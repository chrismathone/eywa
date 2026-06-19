import "server-only";
import { cache } from "react";
import {
  accessLevel,
  canAccess,
  resolveMatrix,
  type Access,
  type AccessMatrix,
  type MenuKey,
  type SystemRole,
} from "@/lib/permissions";
import { getTenantSettings } from "@/features/owner/server/queries";

/**
 * 현재 테넌트의 유효 권한 매트릭스 = 하드코딩 MENU_ACCESS(기본값) + owner 설정 permissions override.
 * 요청당 1회(React cache). getTenantSettings도 cache라 추가 라운드트립 0(반응속도 #1).
 * 비로그인/설정없음 등 실패는 빈 override(=MENU_ACCESS 그대로)로 폴백 — 미인증 게이트는 호출부가 별도 처리.
 * ⚠️ getCurrentUser에 직접 싣지 않는 이유: current-user ← owner/queries ← current-user 순환 import 회피.
 */
export const getPermMatrix = cache(async (): Promise<AccessMatrix> => {
  try {
    const settings = await getTenantSettings();
    return resolveMatrix(settings.permissions.overrides);
  } catch (e) {
    // ⚠️ 코드 기본값 복귀 = revoke(권한 박탈) override가 일시 무효화되는 fail-open 방향이다.
    // 무음이면 운영 로그에 안 남아 진단 불가 → 최소한 로깅(관측성). 전면 fail-closed(차단)는 일시
    // 조회 실패 시 락아웃 위험이 있어, tenant_settings RLS 자기상승 차단 후속(HANDOFF §5)과 함께 다룬다.
    console.error("[perm-matrix] getTenantSettings 실패 — 코드 기본 권한으로 폴백(override 일시 미적용)", e);
    return resolveMatrix([]);
  }
});

/** 현재 테넌트 매트릭스로 메뉴 접근 여부(서버 액션 직접 게이트용). 매트릭스 fetch는 cache(1회). */
export async function canAccessTenant(role: SystemRole, menu: MenuKey): Promise<boolean> {
  return canAccess(role, menu, await getPermMatrix());
}

/** 현재 테넌트 매트릭스로 접근 수준(readonly 다운그레이드가 쓰기 차단에 반영되도록). */
export async function accessLevelTenant(role: SystemRole, menu: MenuKey): Promise<Access> {
  return accessLevel(role, menu, await getPermMatrix());
}
