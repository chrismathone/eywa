import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTeacherScope, type TeacherScope } from "@/lib/auth/teacher-scope";
import { getTeacherReadScope } from "@/lib/auth/teacher-read-scope";
import { hasActiveDelegation } from "@/features/classes/server/delegation";
import { createClient } from "@/lib/supabase/server";
import { isFullShellRole, viewAsTeacher, VIEW_MODE_COOKIE } from "@/lib/auth/view-as";

// 쿠키 상수·풀셸 판별·'다른 강사 뷰' 접근 검증은 [view-as.ts](./view-as.ts)로 분리 —
// perm-matrix(쓰기 캡)가 이 파일을 import하면 순환이 생겨서다. 기존 소비처를 위해 재수출.
export {
  isFullShellRole,
  viewAsTeacher,
  canUseOtherTeacherView,
  isReadonlyTeacherView,
  readonlyTeacherViewError,
  READONLY_TEACHER_VIEW_ERROR,
  VIEW_MODE_COOKIE,
  VIEW_AS_COOKIE,
} from "@/lib/auth/view-as";

/**
 * 강사 데이터 스코프를 적용할 강사 id(없으면 null) — 모든 스코프 소비처의 단일 소스.
 * - **실 강사**(system_role='teacher'): 항상 본인 id. 기존 스코프 불변(authoritative, 쿼리 0 추가).
 * - **겸직**(풀셸 역할 + 쿠키 view=teacher + 실제 담당 반 ≥1): 본인 id → 강사와 동일하게 좁힘.
 * - 그 외(관리자 뷰·담당 반 없음·비로그인·학생): null(학원 전체 뷰).
 *
 * ⚠️ 뷰 전환은 **권한이 아니라 스코프/크롬만** 바꾼다. 실 system_role은 그대로 authoritative로 남아
 * RLS·requireAccess·canWriteTenant 게이트에 쓰인다(강사뷰의 겸직도 실제 권한은 관리자 그대로 = 락아웃 없음).
 * React cache로 요청당 1회(getCurrentUser·getTeacherScope 재사용).
 */
export const effectiveTeacherId = cache(async (): Promise<string | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.systemRole === "student") return null;
  // 다른 강사 뷰는 검증된 대상 강사의 id로 조회 범위를 정한다.
  // 전체 권한의 업무 액션은 대상 강사로 귀속하고, 읽기 권한은 저장·발송을 차단한다.
  const viewAs = await viewAsTeacher();
  if (viewAs) return viewAs.id;
  // 운영 콘솔의 '지점 보기'(읽기 전용)는 늘 원장 화면(학원 전체)이다 — 이 브라우저에 남은 강사뷰 쿠키로 좁히지 않는다(view-as.ts).
  if (user.tenantView) return null;
  if (user.systemRole === "teacher") return user.id;
  // 겸직: 관리자 계열이 강사뷰 쿠키를 켰고, 실제 담당 반(또는 아래 오늘 위임)이 있을 때만.
  // 🔑 이 두 조건은 노출·진입 판정(canUseTeacherView)과 같다 — 한쪽만 바꾸면 '보이는데 안 들어가지는' 버튼이 된다.
  const jar = await cookies();
  if (jar.get(VIEW_MODE_COOKIE)?.value !== "teacher") return null;
  const { classIds } = await getTeacherScope(user.id);
  if (classIds.length > 0) return user.id;
  // 담당 반이 0개여도 **오늘 위임받은 반**이 있으면 강사뷰에 들어올 수 있어야 한다(0173a).
  // 안 그러면 담당 반 없는 관리자에게 위임을 걸었을 때 그 사람 화면엔 아무것도 안 뜬다 = 조용한 실패.
  // ⚠️ 여는 것은 **진입 자격뿐** — getTeacherScope의 classIds(ECS·교재요청·시간표 스코프)는 그대로다.
  return (await hasActiveDelegation(user.id)) ? user.id : null;
});

/** effectiveTeacherId 기반 스코프 객체(없으면 null). getTeacherScope와 동일 형태(요청당 캐시 공유). */
export async function effectiveTeacherScope(options?: { includeScheduled: boolean }): Promise<TeacherScope | null> {
  const tId = await effectiveTeacherId();
  return tId ? (options?.includeScheduled ? getTeacherReadScope(tId) : getTeacherScope(tId)) : null;
}

export type ShellView = "admin" | "teacher" | "student";

/**
 * 셸 크롬 결정 — student=학생 미니셸, teacher(실 강사 or 겸직-강사뷰)=강사 미니셸, 그 외=풀셸(사이드바).
 */
export const getShellView = cache(async (): Promise<ShellView> => {
  const user = await getCurrentUser();
  if (!user) return "admin";
  if (user.systemRole === "student") return "student";
  if (user.systemRole === "teacher") return "teacher";
  // 겸직: 강사뷰 쿠키 + 담당 반이 있을 때만 강사 미니셸(effectiveTeacherId가 쿠키·담당반 판정).
  return (await effectiveTeacherId()) ? "teacher" : "admin";
});

/**
 * 강사뷰 자격 — 관리자 계열이면서 **담당 반이 있거나 오늘 위임받은 반이 있는**(0173a) 사용자.
 * 🔑 **노출과 진입의 단일 소스** — 풀셸 사이드바의 '강사뷰로 전환' 노출(레이아웃)과 그 버튼이 부르는 전환 액션
 *    ([switchToTeacherView](@/features/shell/view-actions))이 이 함수 하나를 본다. 둘이 따로 판정하던 때(액션은
 *    담당 반만 봤다) 위임만 받은 관리자에게 버튼은 서는데 눌러도 아무 일도 없었다(2026-09-11 전수검사).
 *    들어간 뒤 매 요청의 판정(effectiveTeacherId)도 같은 두 조건이다 — 셋 중 하나만 바꾸지 말 것.
 * head:true 카운트라 행을 받지 않음(B2 준수).
 */
export const canUseTeacherView = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user || !isFullShellRole(user.systemRole)) return false;
  // 지점 보기 중에는 강사뷰 전환을 내놓지 않는다(view-as.ts) — 전환은 쿠키를 써서 보기가 끝난 뒤의 본인 화면까지 바꾼다.
  if (user.tenantView) return false;
  const supabase = await createClient();
  const { count } = await supabase
    .from("classes")
    .select("*", { count: "exact", head: true })
    .eq("teacher_id", user.id);
  if ((count ?? 0) > 0) return true;
  // 오늘 위임받은 반이 있으면 토글을 보여준다 — 안 그러면 위임받은 관리자가 전환 버튼조차 못 찾는다(0173a).
  return hasActiveDelegation(user.id);
});
