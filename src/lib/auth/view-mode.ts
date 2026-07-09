import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { SystemRole } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTeacherScope, type TeacherScope } from "@/lib/auth/teacher-scope";
import { createClient } from "@/lib/supabase/server";

// 뷰 전환(겸직) 쿠키 — 관리자 계열 역할이 "강사뷰"를 켜면 세팅. 값 "teacher"만 의미 있음(그 외/부재=관리자뷰).
// httpOnly(서버만 읽음) + path "/"(모든 셸 경로 공유, 창=iframe도 같은 도메인이라 전파).
export const VIEW_MODE_COOKIE = "eywa-view";

/**
 * 풀셸(관리자 계열) 역할 판별 — 강사/학생은 미니셸 전용 역할이라 뷰 전환 대상 아님.
 * 나머지(master/admin/manager/accountant/counselor/viewer)는 겸직으로 강사뷰를 켤 수 있다.
 */
export function isFullShellRole(role: SystemRole): boolean {
  return role !== "teacher" && role !== "student";
}

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
  if (user.systemRole === "teacher") return user.id; // 실 강사 — 불변(추가 쿼리 없음)
  if (!isFullShellRole(user.systemRole)) return null; // student 등
  // 겸직: 관리자 계열이 강사뷰 쿠키를 켰고, 실제 담당 반이 있을 때만.
  const jar = await cookies();
  if (jar.get(VIEW_MODE_COOKIE)?.value !== "teacher") return null;
  const { classIds } = await getTeacherScope(user.id);
  return classIds.length > 0 ? user.id : null;
});

/** effectiveTeacherId 기반 스코프 객체(없으면 null). getTeacherScope와 동일 형태(요청당 캐시 공유). */
export async function effectiveTeacherScope(): Promise<TeacherScope | null> {
  const tId = await effectiveTeacherId();
  return tId ? getTeacherScope(tId) : null;
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
 * 겸직 여부 — 관리자 계열이면서 실제 담당 반이 있어 '강사뷰로 전환'을 제공할 수 있는 사용자.
 * 풀셸(사이드바)에서 토글 노출 판정용. head:true 카운트라 행을 받지 않음(B2 준수).
 */
export const canUseTeacherView = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user || !isFullShellRole(user.systemRole)) return false;
  const supabase = await createClient();
  const { count } = await supabase
    .from("classes")
    .select("*", { count: "exact", head: true })
    .eq("teacher_id", user.id);
  return (count ?? 0) > 0;
});
