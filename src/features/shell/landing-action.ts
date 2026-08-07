"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { landingPath } from "@/lib/auth/teacher-home";

/**
 * 로그인 직후 착지 경로 — 서버가 확정한다.
 *
 * 왜 서버여야 하는가: 강사 홈은 **담당 반 과목**으로 갈리는데(영어 전담=ECS·그 외=원스크린, 2026-08-07)
 * 그건 DB에만 있다. 로그인 폼은 클라라 JWT의 `system_role`까지밖에 못 봐서, 예전처럼 클라에서
 * `role === "teacher" ? "/onescreen" : …`로 정하면 영어 강사가 매번 빈 원스크린에 착지한다.
 *
 * ⚠️ **세션 쿠키 전파 전이면 `null`** — 로그인은 브라우저 supabase 클라가 쿠키를 쓰고, 이 액션은 그 직후
 * 별도 요청이다. 아직 안 실린 찰나엔 `getCurrentUser()`가 비어 있을 수 있으므로 **지어내지 않고 null을
 * 돌린다** → 호출부가 기존 role 기반 폴백으로 착지한다(로그인이 실패하는 일은 없다).
 */
export async function resolveLoginLanding(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return landingPath(user.systemRole, await getPermMatrix());
}
