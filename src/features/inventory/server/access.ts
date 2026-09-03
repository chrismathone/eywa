import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";

/**
 * 재고관리 **쓰기** 게이트 — 모든 서버 액션이 첫 줄에서 이걸 지난다([[#77]] — 화면 조건은 게이트가 아니다).
 *
 * 🔴 `canWriteTenant("inventory")`다. `canAccess`/`canAccessTenant`는 **readonly를 통과시킨다** —
 *    회계(accountant)는 열람만인데 그걸 쓰면 자산을 고치게 된다. '다른 강사 뷰'(열람 전용) 캡도 이 함수 안에 있다.
 * 열람 게이트는 페이지의 `requireAccess("inventory")`(메뉴 권한) 하나다 — 셔틀처럼 별도 토글 우회가 없다.
 */
export type InventoryWriteCtx = { tenantId: string; userId: string; displayName: string };

export async function requireInventoryWrite(): Promise<InventoryWriteCtx | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "inventory"))) {
    return { error: "재고관리를 수정할 권한이 없습니다" };
  }
  return { tenantId: user.tenantId, userId: user.id, displayName: user.displayName };
}

/** 표가 아직 없을 때 나는 PostgREST 코드(42P01 = undefined_table / PGRST205 = 스키마 캐시에 없음). */
export function isMissingInventoryTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .*inventory_.* does not exist|could not find the table .*inventory_/i.test(error.message ?? "")
  );
}

/**
 * PostgREST 에러 → 한글. raw 원문을 화면에 그대로 내보내지 않는다(CLAUDE.md 반복 지적).
 * ⚠️ 표 없음(0242a 미적용)은 **원인을 말한다** — 그냥 실패와 같은 문구로 뭉치면 화면이 거짓말을 한다.
 */
export function friendlyInventoryError(
  error: { code?: string; message?: string },
  fallback: string,
  duplicate = "이미 같은 값이 있습니다",
): string {
  if (isMissingInventoryTable(error)) {
    return "재고관리 표가 아직 만들어지지 않았습니다 — 마이그레이션 0242a를 적용해 주세요";
  }
  if (error.code === "23505") return duplicate;
  if (error.code === "23503") return "다른 기록이 참조하고 있어 처리할 수 없습니다";
  if (error.code === "23514") return "입력 값이 규칙에 맞지 않습니다(길이·형식·상태 짝을 확인하세요)";
  return fallback;
}
