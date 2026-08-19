import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { SystemRole } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { createClient } from "@/lib/supabase/server";
import { READONLY_TEACHER_VIEW_ERROR } from "@/lib/auth/view-as-message";

/**
 * '다른 강사 뷰'(열람 전용) — 관리자가 로그인 없이 특정 강사의 강사뷰를 그대로 본다 (원장 2026-08-19).
 *
 * 설계 원칙:
 * - **권한이 아니라 스코프만 바꾼다** — 실 system_role이 계속 RLS·requireAccess를 지배(기존 겸직 강사뷰와
 *   같은 결). 대상 강사의 권한·명의를 "얻는" 경로는 없다.
 * - **열람 전용** — 강사 귀속 저장·발송은 전부 차단([readonlyTeacherViewError] + perm-matrix 쓰기 캡).
 * - **대상 강사는 모른다** — presence track 전면 차단(EditPresenceProvider trackDisabled), 알림 0.
 *   원스크린 "다른 창/기기 동시 열림" 경고가 `onescreen:{teacherId}:{date}` 축이라, 여기서 track하면
 *   그 강사 화면에 열람자가 그대로 떴을 것이다.
 * - 쿠키는 신뢰하지 않는다 — 매 요청 [viewAsTeacher]가 자격(토글)·대상(테넌트)을 재검증한다(React cache,
 *   쿠키가 없으면 검증 쿼리 0). 위조 쿠키는 검증에서 무력화될 뿐 아무 효과가 없다.
 */

// 뷰 전환(겸직) 쿠키 — 관리자 계열 역할이 "강사뷰"를 켜면 세팅. 값 "teacher"만 의미 있음(그 외/부재=관리자뷰).
// httpOnly(서버만 읽음) + path "/"(모든 셸 경로 공유, 창=iframe도 같은 도메인이라 전파).
export const VIEW_MODE_COOKIE = "eywa-view";

// '다른 강사 뷰' 대상 쿠키 — 값 = 대상 강사의 user id. VIEW_MODE_COOKIE=teacher와 함께일 때만 의미.
export const VIEW_AS_COOKIE = "eywa-view-as";

/**
 * 풀셸(관리자 계열) 역할 판별 — 강사/학생은 미니셸 전용 역할이라 뷰 전환 대상 아님.
 * 나머지(master/admin/manager/accountant/counselor/viewer)는 겸직으로 강사뷰를 켤 수 있다.
 */
export function isFullShellRole(role: SystemRole): boolean {
  return role !== "teacher" && role !== "student";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * '다른 강사 뷰'를 켤 자격 — **master 또는 super_admin 또는 직원관리 '강사뷰 접근' 토글**(0224a
 * `users.teacher_view_access`, 원장 결정 2026-08-19). super_admin은 결정 로그대로 어떤 게이트든 자동 통과.
 *
 * 🔴 토글 컬럼은 getCurrentUser의 전역 select에 싣지 말 것(#95 — 0224a 미적용이면 전 화면이 죽는다).
 *    여기서만 별도 fail-soft 조회(에러=false = 기능만 꺼짐, 화면은 산다). master·super_admin은 컬럼 무관.
 */
export const canUseOtherTeacherView = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user || !isFullShellRole(user.systemRole)) return false;
  if (user.systemRole === "master") return true;
  if (await isCurrentUserSuperAdmin()) return true;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("teacher_view_access")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return false; // 0224a 미적용·조회 실패 = 기능만 꺼짐(fail-closed — 열람 권한은 넓히지 않는다)
  return data.teacher_view_access === true;
});

export type ViewAsTeacher = { id: string; displayName: string };

/**
 * '다른 강사 뷰' 대상 검증 단일 소스 — 같은 테넌트·학생 아님·**활성(active)만**(피커와 같은 조건, #77:
 * 퇴사·대기 계정 뷰는 UI에서만 감추면 직접 액션 호출로 뚫린다). 진입 액션(switchToOtherTeacherView)과
 * 매 요청 재검증(viewAsTeacher)이 **이 함수 하나**를 쓴다 — 조건이 두 벌이면 반드시 갈라진다.
 * ⚠️ 자격(canUseOtherTeacherView)·쿠키 판독은 호출부 몫 — 여기는 대상 검증만.
 */
export async function loadViewAsTarget(targetId: string): Promise<ViewAsTeacher | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  // 세션 클라이언트(RLS)라 타 테넌트 행은 애초에 안 보이지만 tenant_id 이중 확인.
  const { data } = await supabase
    .from("users")
    .select("id, tenant_id, display_name, system_role, status")
    .eq("id", targetId)
    .maybeSingle();
  if (!data || data.tenant_id !== user.tenantId || data.system_role === "student") return null;
  if (data.status !== "active") return null;
  return { id: data.id, displayName: ((data.display_name as string | null) ?? "").trim() };
}

/**
 * 지금 요청이 '다른 강사 뷰'인가 — 맞으면 **검증된 대상 강사**를, 아니면 null.
 *
 * 매 요청 재검증(캐시 1회): ① 뷰어가 풀셸 역할 + 강사뷰 쿠키 ② 자격([canUseOtherTeacherView])
 * ③ 대상이 같은 테넌트의 실존 직원(학생 아님·본인 아님). 하나라도 어긋나면 null = 기존 겸직/관리자 뷰로
 * 조용히 폴백(쿠키를 지울 수는 없지만 — RSC는 쿠키 쓰기 불가 — 아무 효과도 없다).
 *
 * ⚠️ 실 강사(system_role=teacher)는 여기 절대 안 걸린다(①에서 탈락) — 강사가 쿠키를 위조해도 남의 뷰 불가.
 */
export const viewAsTeacher = cache(async (): Promise<ViewAsTeacher | null> => {
  const user = await getCurrentUser();
  if (!user || !isFullShellRole(user.systemRole)) return null;
  const jar = await cookies();
  if (jar.get(VIEW_MODE_COOKIE)?.value !== "teacher") return null;
  const targetId = jar.get(VIEW_AS_COOKIE)?.value;
  if (!targetId || !UUID_RE.test(targetId) || targetId === user.id) return null;
  if (!(await canUseOtherTeacherView())) return null;
  return loadViewAsTarget(targetId); // 대상 검증(활성·테넌트·비학생) = 진입 액션과 같은 단일 소스
});

/** 지금 요청이 '다른 강사 뷰'(열람 전용)인가 — 쓰기 캡·presence 차단·배지 노출의 공용 판정. */
export async function isReadonlyTeacherView(): Promise<boolean> {
  return (await viewAsTeacher()) !== null;
}

// 거절 문구는 클라 토스트와 공유하는 순수 모듈(view-as-message.ts)이 단일 소스 — 기존 소비처를 위해 재수출.
export { READONLY_TEACHER_VIEW_ERROR } from "@/lib/auth/view-as-message";

/**
 * 쓰기 서버 액션 공용 가드 — '다른 강사 뷰'면 거절 사유(한글)를, 아니면 null.
 *
 * 🔴 **강사 명의/귀속으로 쓰는 액션은 반드시 이걸 먼저 통과**할 것(공지 발송·학생 순서·보고서 저장 등
 *    `effectiveTeacherId`를 귀속에 쓰는 파일 전부 — view-as-wiring.test.ts가 목록을 잠근다).
 *    canWriteTenant/accessLevelTenant를 지나는 쓰기는 perm-matrix 캡이 자동 차단하므로 별도 가드 불요.
 */
export async function readonlyTeacherViewError(): Promise<string | null> {
  return (await isReadonlyTeacherView()) ? READONLY_TEACHER_VIEW_ERROR : null;
}
