"use server";

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { roleHome } from "@/lib/permissions";
import { getActorPermMatrix } from "@/lib/auth/perm-matrix";
import { canUseTeacherView, getShellView, isFullShellRole, VIEW_MODE_COOKIE } from "@/lib/auth/view-mode";
import { canUseOtherTeacherView, loadViewAsTarget, VIEW_AS_COOKIE } from "@/lib/auth/view-as";
import { getSuperAdminIds, isSignedInSuperAdmin } from "@/lib/auth/super-admin";
import { canViewAsRole } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import { teacherHomeForSubjects } from "@/lib/auth/teacher-home";
import { ENGLISH_TEACHER_HOME, teacherHomeFromAssistantClasses } from "@/lib/auth/teacher-home-rule";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { englishAssistantClassIdsOf } from "@/features/class-sheets/server/access";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";

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
 * 그 강사의 강사 홈 — 담당 반 과목으로 가르고, 담당 반이 0개면 부담임(슬롯) 영어 반까지 본다.
 * teacherViewHome()과 같은 규칙인데, 두 전환 액션은 방금 이 응답에서 세팅한 쿠키를 그 함수가 아직 못 읽어
 * 여기서 직접 잇는다(규칙·ECS 접근 가드는 teacher-home 한 곳뿐). 부담임 판정은 ecsAssistantClassIds와 같은
 * 파라미터판 단일 소스(englishAssistantClassIdsOf). 위임만 받은 관리자도 담당 반이 0개라 이 갈래를 탄다
 * (위임 반은 원스크린 로스터에 선다).
 * ⚠️ export하지 말 것 — "use server" 파일의 export는 전부 서버 액션이 된다(#119).
 */
async function teacherHomeOf(teacherId: string): Promise<string> {
  const { classIds, subjects } = await getTeacherScope(teacherId);
  if (classIds.length > 0) return teacherHomeForSubjects(subjects);
  const assistantCount = (await englishAssistantClassIdsOf(teacherId)).length;
  return teacherHomeForSubjects(
    teacherHomeFromAssistantClasses(assistantCount) === ENGLISH_TEACHER_HOME ? ["english"] : [],
  );
}

/**
 * 관리자 → 강사뷰. **토글이 보이면 들어간다** — 자격은 노출과 같은 함수(`canUseTeacherView`: 담당 반 ≥1 또는
 * 오늘 위임받은 반)로 판정한다. **착지 경로(강사 홈)를 반환** — 네비게이션은 호출부(클라)가 `window.location`으로
 * 확정한다(switchToAdminView와 대칭). 자격이 확인되지 않으면 null — 세션 없음·자격 없음·조회 실패를 가르지 않으니
 * 호출부는 원인을 단정하지 말고 알린다(view-mode-toggle).
 * 강사 홈은 담당 과목으로 갈린다(영어 전담=`/ecs`·그 외=`/onescreen`, 2026-08-07).
 *
 * 🔴 예전엔 여기만 **담당 반**으로 판정했다 — 노출은 위임까지 치는데 진입은 안 쳐서, 위임만 받은 관리자에게
 *    버튼은 서는데 눌러도 쿠키가 안 걸려 아무 일도 없었다(2026-09-11 전수검사). 자격 조건을 여기 다시 적지 말 것.
 *
 * ⚠️ 여기서 redirect()(서버액션=soft nav)를 쓰지 않는 이유: soft nav은 **공유 (shell) 레이아웃을 Next
 * 라우터 캐시에 강사 미니셸로 남긴다** → 뒤로가기 시 그 캐시가 관리자 페이지를 강사 미니셸 크롬으로 감싸
 * "강사뷰인데 관리자 화면"인 깨진 렌더가 났다(심각 버그). hard nav(window.location)은 라우터 캐시를 통째로
 * 버리고 풀 문서 로드라 뒤로가기가 실제 서버 네비 → (shell) 레이아웃의 뷰-경로 가드가 정상 발화한다.
 */
export async function switchToTeacherView(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user || !isFullShellRole(user.systemRole)) return null; // 실 강사·학생은 애초에 토글 미노출
  if (!(await canUseTeacherView())) return null; // 담당 반도 위임도 없으면 강사뷰가 무의미 — 노출과 같은 판정
  const jar = await cookies();
  jar.set(VIEW_MODE_COOKIE, "teacher", COOKIE_OPTS);
  jar.delete(VIEW_AS_COOKIE); // '내 강사뷰'는 항상 본인 — 남아 있던 '다른 강사 뷰' 대상은 해제
  // 착지 = 그 사람의 강사 홈(영어 전담이면 ECS, 2026-08-07). `teacherViewHome()`을 못 쓰는 이유는 teacherHomeOf 주석.
  return teacherHomeOf(user.id);
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
  const jar = await cookies();
  jar.delete(VIEW_MODE_COOKIE);
  jar.delete(VIEW_AS_COOKIE); // '다른 강사 뷰' 열람도 여기서 끝난다 — 대상 쿠키를 남기지 않는다
  // 🔴 매트릭스를 **반드시** 넘긴다(2026-10-01, gotchas #137) — 빼면 코드 기본값으로 판정해 대시보드를 원장이 꺼 둔
  //    역할(뷰어·회계 등)도 늘 `/dashboard`를 받고, 그 문서 이동이 곧장 튕기면서 Next 기본 오류 화면의 입구가 됐다.
  //    `landingPath`는 쓰지 않는다: 강사뷰 쿠키를 **이 응답에서** 지웠지만 요청 쿠키엔 남아 있어 강사 홈을 돌려준다.
  return roleHome(user.systemRole, await getActorPermMatrix());
}

/**
 * '다른 강사 뷰' 진입 — 대상 강사를 검증하고 두 쿠키(view=teacher + view-as=대상)를 세팅한 뒤
 * **그 강사의 강사 홈 경로를 반환**한다(네비게이션은 호출부가 window.location — 위 두 액션과 동일 규약).
 *
 * 역할·개인별 '강사뷰 접근' 권한을 확인한다(canUseOtherTeacherView).
 * 전체는 대상 강사의 권한, 읽기는 쓰기 차단 — 상세는 view-as.ts.
 * 열람 시작은 감사로그(teacher_view_impersonate)에 남긴다(누가 누구 뷰를 봤는지 역검수).
 */
export async function switchToOtherTeacherView(targetId: string): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user || !isFullShellRole(user.systemRole) || await getShellView() !== "admin") return null;
  if (!(await canUseOtherTeacherView())) return null;
  if (targetId === user.id) return switchToTeacherView(); // 자기 자신 = 본인 강사뷰(쓰기 가능한 그 뷰)

  // 대상 검증 — viewAsTeacher()(매 요청 재검증)와 **같은 단일 소스**(활성·테넌트·비학생, #77).
  const target = await loadViewAsTarget(targetId);
  if (!target) return null;

  const jar = await cookies();
  // 🔴 두 쿠키의 수명을 **함께** 12시간으로 — 대상 쿠키만 먼저 죽으면 겸직은 다음 요청부터 조용히
  //    "본인(쓰기 가능) 강사뷰"로 갈아타 앉는다. 열람은 명시적으로 끝나야 한다(만료 = 둘 다 → 관리자뷰).
  const opts = { ...COOKIE_OPTS, maxAge: 60 * 60 * 12 };
  jar.set(VIEW_MODE_COOKIE, "teacher", opts);
  jar.set(VIEW_AS_COOKIE, target.id, opts);

  await logAction({
    action: "teacher_view_impersonate",
    targetType: "user",
    targetLabel: target.displayName || target.id,
    metadata: { targetUserId: target.id },
  });

  // 착지 = 그 강사의 강사 홈(영어 전담=ECS, 담당 반 0개면 부담임 영어 반까지) — 본인 전환과 같은 teacherHomeOf.
  return teacherHomeOf(target.id);
}

export type TeacherViewTarget = { id: string; name: string };

/**
 * '다른 강사 뷰' 대상 후보 — 이 학원의 **활성 강사**(system_role=teacher) ∪ **담당 반이 있는 직원**(겸직)
 * ∪ **JJ 보고서 담당**(학원설정 개인별 기능 권한 `jjReportManagerIds`, 원장 2026-10-26 *"강사뷰 전환에도 김동후가 떠야"*) —
 * 담임 반은 없지만 그날 JJ 교시 반을 원스크린에서 맡는다(delegation.ts). 🔑 그 명단만 더한다 — 다른 개인 권한 명단은 강사 업무가 아니다.
 * 사이드바 피커·열람 배지 드롭다운이 열릴 때만 호출(지연 로드 — 레이아웃 상시 비용 0).
 * 자격 없는 호출은 빈 목록(게이트 재검증 — UI 조건은 게이트가 아니다 #77).
 */
export async function listTeacherViewTargets(): Promise<TeacherViewTarget[]> {
  const user = await getCurrentUser();
  if (!user || !isFullShellRole(user.systemRole) || await getShellView() !== "admin" || !(await canUseOtherTeacherView())) return [];
  const supabase = await createClient();
  // 전건 fetch지만 둘 다 whitelist 용도라 fetchAllPaged(B2 — 1000행 silent 절단 방지).
  const [staff, classRows, jjIds] = await Promise.all([
    fetchAllPaged<{ id: string; display_name: string | null; system_role: string }>((from, to) =>
      supabase
        .from("users")
        .select("id, display_name, system_role")
        .eq("status", "active")
        .neq("system_role", "student") // 학생이 압도적 다수 — SQL에서 걸러야 전건 페이징이 헛돌지 않는다(B2)
        .order("display_name")
        .order("id") // unique tie-break — 페이지 경계 안정(fetchAllPaged 계약)
        .range(from, to),
    ),
    fetchAllPaged<{ teacher_id: string | null }>((from, to) =>
      supabase
        .from("classes")
        .select("teacher_id")
        .eq("is_active", true)
        .not("teacher_id", "is", null)
        .order("id")
        .range(from, to),
    ),
    // 설정을 못 읽으면 이 갈래만 빈다(목록 전체를 죽이지 않는다).
    getTenantSettings()
      .then((st) => new Set(st.permissions.specialAccess.jjReportManagerIds ?? []))
      .catch(() => new Set<string>()),
  ]);
  const teachingIds = new Set(classRows.map((r) => r.teacher_id).filter(Boolean) as string[]);
  // 자기보다 높은 역할은 후보에서 뺀다 — 진입 검증(loadViewAsTarget)과 같은 위계 규칙(운영 계정은 예외 · 2026-11-05).
  // 운영 계정(super_admin) 대상도 같은 규칙 — 실제 계정이 운영 계정이 아니면 후보에 세우지 않는다(진입이 막는 대상을 목록에 띄우지 않게,
  // 2026-11-05 적대 재리뷰). 명단 조회가 실패하면 빈 명단(표시용) — 고르더라도 진입 검증이 다시 막는다.
  const anyRole = await isSignedInSuperAdmin();
  const superAdminIds = anyRole ? new Set<string>() : await getSuperAdminIds();
  return staff
    .filter((s) => s.id !== user.id && s.system_role !== "student")
    .filter((s) => anyRole || canViewAsRole(user.systemRole, s.system_role as SystemRole))
    .filter((s) => !superAdminIds.has(s.id))
    .filter((s) => s.system_role === "teacher" || teachingIds.has(s.id) || jjIds.has(s.id))
    .map((s) => ({ id: s.id, name: s.display_name ?? "(이름 없음)" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko")); // Postgres 정렬은 로마자→한글(#84) — 한글 우선 정렬
}
