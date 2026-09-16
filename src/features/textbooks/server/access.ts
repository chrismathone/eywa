import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";

/**
 * 교재목록 **쓰기** 게이트 — 교재·차수를 바꾸는 서버 액션이 첫 줄에서 이걸 지난다([[#77]]).
 *
 * 🔴 `canWriteTenant("textbooks")`다. `canAccess`/`canAccessTenant`는 **readonly를 통과시킨다** —
 *    강사는 시트에서 교재를 **고르기만** 해야 하는데(원장 2026-09-16) 그걸 쓰면 마스터를 고치게 된다.
 *    '다른 강사 뷰'(열람 전용) 캡도 이 함수 안에 있다.
 *
 * ⚠️ **반 배정·기입은 이 게이트가 아니다** — 그건 그 반의 ECS 계획 줄을 쓰는 행위라
 *    `requireEcsClassAccess(classId, { write: true })`를 탄다(0266a 헤더 🔴). 교재 마스터를 못 고치는
 *    담임 강사도 자기 반에 교재를 태울 수 있어야 이 기능이 쓰인다.
 */
export type TextbookWriteCtx = { tenantId: string; userId: string; displayName: string };

export async function requireTextbookWrite(): Promise<TextbookWriteCtx | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "textbooks"))) {
    return { error: "교재목록을 수정할 권한이 없습니다" };
  }
  return { tenantId: user.tenantId, userId: user.id, displayName: user.displayName };
}

/**
 * 0266a가 아직 적용되지 않았을 때 나는 PostgREST 코드
 * (42P01 = undefined_table / PGRST205 = 스키마 캐시에 없음).
 * 🔴 **그냥 실패와 다른 사실이다** — 뭉치면 화면이 "SQL 미적용"이라고 거짓말하거나 그 반대가 된다.
 */
export function isMissingTextbookTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (/textbooks|textbook_lessons|class_textbook_plans|ecs_apply_textbook_lessons/.test(msg) &&
      /not find|does not exist|schema cache/i.test(msg))
  );
}

/**
 * 0268a(고른 교시 칸)가 없을 때 — 🔴 **조용히 옛 축으로 떨어뜨리지 않는다**(적대적 리뷰 P0):
 * 16:20만 골랐는데 16:20·17:20·18:20 전부에 3배 속도로 깔리고, 되돌리는 길은 줄을 하나씩 지우는 것뿐이다.
 * ⚠️ 이 상수가 여기 있는 이유 = `plan-actions.ts`는 `"use server"`라 **async 함수만** export할 수 있다([[#119]]).
 */
export const SLOTS_NOT_READY =
  "교시를 골라 배정하려면 마이그레이션 0268a가 필요합니다 — 적용한 뒤 다시 시도해 주세요";

export const TEXTBOOKS_NOT_READY = "교재목록 표가 아직 만들어지지 않았습니다 — 마이그레이션 0266a를 적용해 주세요";

/**
 * PostgREST 에러 → 한글. raw 원문을 화면에 그대로 내보내지 않는다(CLAUDE.md 반복 지적).
 */
export function friendlyTextbookError(
  error: { code?: string; message?: string },
  fallback: string,
  duplicate = "이미 같은 이름의 교재가 있습니다",
): string {
  if (isMissingTextbookTable(error)) return TEXTBOOKS_NOT_READY;
  if (error.code === "23505") return duplicate;
  if (error.code === "23503") return "다른 기록이 참조하고 있어 처리할 수 없습니다";
  if (error.code === "23514") return "입력 값이 규칙에 맞지 않습니다(길이·형식을 확인하세요)";
  return fallback;
}
