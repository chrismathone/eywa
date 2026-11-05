import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "./current-user";
import type { SystemRole } from "@/lib/permissions";

export type CurrentSuperAdmin = {
  id: string;
  email: string;
  displayName: string;
};

// React cache() dedupes within a single request.
// super_admin은 academy 권한과 직교 — academy master여도 super_admin이 아닐 수 있고, 그 반대도 가능.
export const getCurrentSuperAdmin = cache(async (): Promise<CurrentSuperAdmin | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("super_admins")
    .select("id, email, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    displayName: data.display_name,
  };
});

/**
 * 현재 로그인 사용자가 super_admin인지 — **경량 판정**(perm-matrix 등 요청 핫패스용).
 * getCurrentSuperAdmin과 달리 auth.getUser()(GoTrue 네트워크 왕복)를 안 타고, 이미 요청 캐시된
 * getCurrentUser(getClaims 로컬검증)의 id로 super_admins PK 조회만 한다(RLS: 본인 row select).
 * ⚠️ 테넌트 users 행이 없는 순수 super_admin은 false가 나온다 — 학원 셸 권한 우회 용도로만 쓸 것
 * (셸은 어차피 users 행이 없으면 진입 불가). /super-admin 게이트는 기존 getCurrentSuperAdmin 유지.
 */
export const isCurrentUserSuperAdmin = cache(async (): Promise<boolean> => {
  if (!(await isSignedInSuperAdmin())) return false;
  // '다른 강사 뷰' 중에는 **그 강사와 같은 화면**이어야 한다(원장 2026-11-05 *"강사뷰 전환시에 실제 그 사람으로 완벽하게 전환"*) —
  // 운영 계정만 통과하는 문(담당 반 우회 · 지정 명단 우회 · 답변 권한 등)을 열지 않는다. 열면 강사에게 없는 버튼이 섞이고,
  // 반대로 담당 판정 구멍이 우회에 가려 '되는 것처럼' 보인다(점검 2026-11-05). 지점 보기와 같은 원칙.
  // view-as가 이 파일을 쓰므로 순환을 피해 늦게 불러온다(current-user.ts와 같은 방식).
  const { viewAsTeacher } = await import("./view-as");
  return !(await viewAsTeacher());
});

/**
 * **실제 로그인 계정**이 super_admin인가 — 강사뷰여도 실제 계정으로 답한다.
 * 🔴 강사뷰 자격(`view-as.ts` otherTeacherViewAccess) · 실제 계정의 권한표(`perm-matrix.ts`) · 지점 보기 감시 탑재(셸 레이아웃)
 *    전용이다. 업무 판정(담당 · 명단 · 우회)은 위 `isCurrentUserSuperAdmin`을 쓸 것 — 이걸 쓰면 강사뷰에 운영 계정의 문이 열린다.
 *    (perm-matrix · view-as가 위 함수를 쓰면 viewAsTeacher → 권한표 → 슈퍼관리자 → viewAsTeacher로 순환한다.)
 */
export const isSignedInSuperAdmin = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user) return false;
  // 운영 콘솔의 '지점 보기'(읽기 전용) 중에는 **그 지점 원장과 같은 화면**이어야 한다 — 운영 계정만 통과하는 문
  // (잠금 무시 · 설정 전체 권한 · 숨은 메뉴)을 열지 않는다. 열면 원장에게는 없는 화면이 섞인다.
  if (user.tenantView) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("super_admins")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  return !!data;
});

/**
 * 전체 super_admin id 집합 — **service_role**(RLS 우회)로 조회.
 * super_admins RLS는 "본인 행만" 노출하므로, academy master 등 **다른 사용자**가 목록에서
 * super_admin 계정을 식별하려면 admin client가 필요하다. 아래 displayRoleFor(표시 위장) 전용.
 */
export const getSuperAdminIds = cache(async (): Promise<Set<string>> => {
  const admin = createAdminClient();
  const { data } = await admin.from("super_admins").select("id");
  return new Set((data ?? []).map((r) => r.id as string));
});

/**
 * 대상이 super_admin인데 요청자는 아닌가 — 계정 탈취 보호선(보안 감사 2026-09-29).
 * super_admin도 한 학원에 users 행(보통 master)을 갖기 때문에, 역할 위계(`canManageStaffMember`, 동급 허용)만
 * 보면 **그 학원 원장이 super_admin 계정의 비밀번호·이메일을 바꿔 전 지점 총괄 권한을 가져갈 수 있다**.
 * 비밀번호·이메일·이름·삭제 등 대상 계정을 바꾸는 서버 액션은 이 값이 true면 거절한다.
 */
export async function isProtectedSuperAdminTarget(actorId: string, targetId: string): Promise<boolean> {
  return (await superAdminTargetProtection(actorId, targetId)) !== "allowed";
}

/**
 * 위 보호 판정의 세 갈래 — `unknown` = 조회 실패. '막음'과 '확인 못 함'을 나눠야 하는 소비처용이다.
 * 강사뷰 대상 검증(view-as.ts)은 막으면 실제 계정으로 돌아가므로, 확인 못 한 요청을 **읽기 전용**으로 닫으려면 둘을 구분해야 한다
 * (2026-11-05 적대 재리뷰 — 조회가 순간 실패하면 읽기 강사뷰의 그 요청만 쓰기가 열렸다).
 */
export async function superAdminTargetProtection(actorId: string, targetId: string): Promise<"protected" | "allowed" | "unknown"> {
  if (actorId === targetId) return "allowed";
  // getSuperAdminIds(표시용)는 조회 실패를 빈 명단으로 삼킨다 — 보호선이 그걸 쓰면 실패하는 순간 조용히 꺼진다.
  // 여기서는 두 사람만 직접 묻고, 조회가 실패하면 `unknown`(isProtectedSuperAdminTarget는 **막는 쪽**)으로 둔다.
  const { data, error } = await createAdminClient()
    .from("super_admins")
    .select("id")
    .in("id", [actorId, targetId]);
  if (error) return "unknown";
  const ids = new Set((data ?? []).map((r) => r.id as string));
  return ids.has(targetId) && !ids.has(actorId) ? "protected" : "allowed";
}

export const SUPER_ADMIN_TARGET_DENIED_MSG = "이 계정을 변경할 권한이 없습니다";

/**
 * super_admin 계정의 **표시** 역할을 '관리자(admin)'로 위장 — 실제 role/접근/권한은 불변.
 * super_admin은 학원 안에서 숨은 총괄이라 owner(master)로 노출되면 안 됨(사용자 결정 2026-07-02).
 * 역할·권한 매트릭스는 이미 getPermMatrix에서 우회되므로 여기선 "보이는 라벨"만 바꾼다.
 * ⚠️ **표시 전용** — 위계/권한 판정(canManageStaffMember·assignableRoles·급여 게이트 등)엔 절대
 * 쓰지 말 것(반드시 실제 systemRole 사용). 위장값을 위계에 넣으면 master가 super_admin을
 * '하위 admin'으로 오인해 편집·삭제할 수 있게 된다.
 */
export function displayRoleFor(
  userId: string,
  realRole: SystemRole,
  superAdminIds: Set<string>,
): SystemRole {
  return superAdminIds.has(userId) && realRole === "master" ? "admin" : realRole;
}

export async function requireSuperAdmin(): Promise<CurrentSuperAdmin> {
  const sa = await getCurrentSuperAdmin();
  if (sa) return sa;

  // 세션 유무에 따라 분기 (F10): 비로그인 → /login, 로그인했으나 super_admin 아님 → 그 사람의 홈.
  // 홈은 착지 단일 소스 `/home`(landingPath + 개인 예외까지 얹은 매트릭스)이 정한다 — 예전엔 코드 기본 권한으로
  // `/dashboard`를 골라, 원장이 대시보드를 꺼 둔 역할이 한 번 더 튕겼다(gotchas #137). 여기서 landingPath를 직접
  // 부르지 않는 이유: teacher-home → perm-matrix → 이 파일로 도는 순환 import가 생긴다.
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect("/home");
}
