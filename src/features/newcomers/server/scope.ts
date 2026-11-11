import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, readonlyViewErasedScope } from "@/lib/auth/perm-matrix";
import type { SystemRole } from "@/lib/permissions";

/**
 * **신규생 관리 권한이 여는 범위** — 이 권한을 보는 화면이 전부 같은 판정을 쓴다(#77).
 *  · `none` = 권한 없음
 *  · `scoped` = 담당 범위 — 강사 · '담당' · 읽기 강사뷰가 지운 담당(#154 ③). 자기가 담임인 학생·과목 / 자기에게 배정된 약속만 본다.
 *  · `all` = 지점 전체('전체' · '읽기')
 *
 * 🔴 `canAccessTenant(…, "newcomers")`만 보고 '전체 열람'으로 다루지 말 것 — 강사에게 '담당'을 연 학원에서 강사가 남이 맡은 기록까지 읽는다
 *    (2026-11-11 적대 리뷰: 약속·인계(`student-care`)의 `readAll`이 그랬다 — 강사 '담당'을 열기 전에는 강사가 이 권한을 가진 적이 없어 드러나지 않았다).
 *    전체 열람이 필요한 자리는 `=== "all"`로 본다 · 가드 `scope.test.ts`가 이 권한을 읽는 자리를 잠근다.
 */
export type NewcomerScope = "none" | "scoped" | "all";

/** 그 역할(강사뷰면 보는 강사의 역할 — `getCurrentUser({ teacherView: true })`)의 범위. */
export async function newcomerScopeOf(role: SystemRole): Promise<NewcomerScope> {
  const level = await accessLevelTenant(role, "newcomers");
  if (level === "none") return "none";
  return role === "teacher" || level === "scoped" || (level === "readonly" && (await readonlyViewErasedScope("newcomers"))) ? "scoped" : "all";
}

/**
 * 지금 보는 사람이 신규생 관리 기록을 **지점 전체로** 읽는가 — 화면의 입구(원생 상세·상담 상세의 '약속·인계' 단추 · 연결 탐색의 90일 점검)가
 * 서버 문(`careAccess`의 `readAll`)과 같은 판정을 쓰게 한다. 담당 범위 계정에게 세우면 눌러도 권한 화면으로 튕기는 단추가 된다.
 */
export async function readsAllNewcomers(): Promise<boolean> {
  const user = await getCurrentUser({ teacherView: true });
  return !!user && (await newcomerScopeOf(user.systemRole)) === "all";
}
