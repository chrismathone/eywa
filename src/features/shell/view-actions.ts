"use server";

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { roleHome } from "@/lib/permissions";
import { isFullShellRole, VIEW_MODE_COOKIE } from "@/lib/auth/view-mode";
import { teacherHomeForSubjects } from "@/lib/auth/teacher-home";

// 겸직(관리자 계열 + 담당 반 보유)의 셸 뷰 전환 — 쿠키만 바꾼다.
// ⚠️ 권한 변경이 아니다: 실 system_role은 그대로라 RLS·requireAccess는 관리자 권한 유지(락아웃 불가).
// 강사뷰에선 effectiveTeacherId가 데이터를 본인 담당으로 좁히고, 크롬은 미니셸로 렌더된다.

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365, // 1년(뷰 선호 유지)
};

/**
 * 관리자 → 강사뷰. 겸직(풀셸 역할 + 실제 담당 반)만 허용. **착지 경로(강사 홈)를 반환** — 네비게이션은
 * 호출부(클라)가 `window.location`으로 확정한다(switchToAdminView와 대칭). 자격 미달이면 null(무동작).
 * 강사 홈은 담당 과목으로 갈린다(영어 전담=`/ecs`·그 외=`/onescreen`, 2026-08-07).
 *
 * ⚠️ 여기서 redirect()(서버액션=soft nav)를 쓰지 않는 이유: soft nav은 **공유 (shell) 레이아웃을 Next
 * 라우터 캐시에 강사 미니셸로 남긴다** → 뒤로가기 시 그 캐시가 관리자 페이지를 강사 미니셸 크롬으로 감싸
 * "강사뷰인데 관리자 화면"인 깨진 렌더가 났다(심각 버그). hard nav(window.location)은 라우터 캐시를 통째로
 * 버리고 풀 문서 로드라 뒤로가기가 실제 서버 네비 → (shell) 레이아웃의 뷰-경로 가드가 정상 발화한다.
 */
export async function switchToTeacherView(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user || !isFullShellRole(user.systemRole)) return null; // 실 강사·학생은 애초에 토글 미노출
  const { classIds, subjects } = await getTeacherScope(user.id);
  if (classIds.length === 0) return null; // 담당 반 없으면 강사뷰가 무의미 — 무시
  (await cookies()).set(VIEW_MODE_COOKIE, "teacher", COOKIE_OPTS);
  // 착지 = 그 사람의 강사 홈(영어 전담이면 ECS, 2026-08-07). ⚠️ 여기서 `teacherViewHome()`을 쓰지 않는 이유:
  // 그건 방금 **이 응답에서 세팅한** 쿠키를 다시 읽어야 하는데, 그 요청의 cookies()엔 아직 없다. 담당 반
  // 과목은 이미 손에 있으므로 그걸 받는 갈래를 쓴다(규칙·ECS 접근 가드는 teacher-home 한 곳뿐).
  return teacherHomeForSubjects(subjects);
}

/**
 * 강사뷰 → 관리자뷰. 쿠키만 제거하고 **착지 경로(역할 홈)를 반환** — 네비게이션은 호출부(클라)가 한다.
 * ⚠️ 여기서 redirect()를 쓰지 않는 이유: 이 액션은 base-ui 드롭다운(내 메뉴) 안에서 호출되는데,
 * 드롭다운 컨텍스트에선 서버액션 redirect의 클라 네비게이션이 유실된다(쿠키만 지워지고 화면이 안 바뀜).
 * 그래서 경로만 반환하고 호출부가 window.location으로 확정 네비게이션한다. (switchToTeacherView도 동일하게
 * window.location으로 통일 — soft nav 라우터 캐시 오염을 피하려 양방향 모두 풀 문서 네비.)
 */
export async function switchToAdminView(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) return "/";
  (await cookies()).delete(VIEW_MODE_COOKIE);
  return roleHome(user.systemRole);
}
