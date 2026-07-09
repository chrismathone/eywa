"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { roleHome } from "@/lib/permissions";
import { isFullShellRole, VIEW_MODE_COOKIE } from "@/lib/auth/view-mode";

// 겸직(관리자 계열 + 담당 반 보유)의 셸 뷰 전환 — 쿠키만 바꾼다.
// ⚠️ 권한 변경이 아니다: 실 system_role은 그대로라 RLS·requireAccess는 관리자 권한 유지(락아웃 불가).
// 강사뷰에선 effectiveTeacherId가 데이터를 본인 담당으로 좁히고, 크롬은 미니셸로 렌더된다.

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365, // 1년(뷰 선호 유지)
};

/** 관리자 → 강사뷰. 겸직(풀셸 역할 + 실제 담당 반)만 허용. 강사 원스크린으로 착지. */
export async function switchToTeacherView() {
  const user = await getCurrentUser();
  if (!user || !isFullShellRole(user.systemRole)) return; // 실 강사·학생은 애초에 토글 미노출
  const { classIds } = await getTeacherScope(user.id);
  if (classIds.length === 0) return; // 담당 반 없으면 강사뷰가 무의미 — 무시
  (await cookies()).set(VIEW_MODE_COOKIE, "teacher", COOKIE_OPTS);
  redirect("/onescreen");
}

/** 강사뷰 → 관리자뷰. 쿠키 제거 후 역할 홈(관리자=대시보드)으로 착지. */
export async function switchToAdminView() {
  const user = await getCurrentUser();
  if (!user) return;
  (await cookies()).delete(VIEW_MODE_COOKIE);
  redirect(roleHome(user.systemRole));
}
