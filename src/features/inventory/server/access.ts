import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 재고관리 **쓰기** 게이트 — 모든 서버 액션이 첫 줄에서 이걸 지난다([[#77]] — 화면 조건은 게이트가 아니다).
 *
 * 🔴 `canWriteTenant("inventory")`다. `canAccess`/`canAccessTenant`는 **readonly를 통과시킨다** —
 *    회계(accountant)는 열람만인데 그걸 쓰면 자산을 고치게 된다. '다른 강사 뷰'(열람 전용) 캡도 이 함수 안에 있다.
 * 열람 게이트는 페이지의 `requireAccess("inventory")`(메뉴 권한) 하나다 — 셔틀처럼 별도 토글 우회가 없다.
 * 🔑 사람 = '다른 강사 뷰'의 대상 직원(`getCurrentUser({ teacherView: true })`) — 실사 확인자(auditor_user_id·auditor_name)·점검자·
 *    등록자(created_by) 같은 기록 명의가 대상 직원이다(원장 2026-11-05 강사뷰 전수). 재고 쓰기는 전부 관리 클라이언트 + tenant_id라 RLS와 무관하다.
 *    감사로그 행위자는 로그인 계정 그대로(logAction). 보기 설정(prefs.ts — ui_prefs)은 이 게이트를 타지 않고 로그인 계정 것이다.
 */
export type InventoryWriteCtx = { tenantId: string; userId: string; displayName: string };

export async function requireInventoryWrite(): Promise<InventoryWriteCtx | { error: string }> {
  const user = await getCurrentUser({ teacherView: true });
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
  duplicate?: string,
): string {
  if (isMissingInventoryTable(error)) {
    return "재고관리 표가 아직 만들어지지 않았습니다 — 마이그레이션 0242a를 적용해 주세요";
  }
  // 판정·로그는 공용([[#138]]) — 예전엔 로그가 없어 일반 문구로 떨어진 실패의 원인을 찾을 길이 없었다.
  const why = explainDbError(error, { scope: "inventory", fallback, context: { action: fallback } });
  // 중복은 **호출부가 넘긴 문구가 먼저**(값·다음 행동까지 담는다 — "이미 같은 품목ID(X)가 있습니다", "미리보기를 다시 받아 주세요").
  // 안 넘겼을 때만 제약 이름 표의 이유(같은 표 유니크가 여럿이면 어느 칸인지)를 쓴다([[#138]] 리뷰).
  if (error.code === "23505") return duplicate ?? (why.specific ? why.message : "이미 같은 값이 있습니다");
  if (why.specific) return why.message;
  if (error.code === "23503") return "다른 기록이 참조하고 있어 처리할 수 없습니다";
  if (error.code === "23514") return "입력 값이 규칙에 맞지 않습니다(길이·형식·상태 짝을 확인하세요)";
  return why.message;
}
