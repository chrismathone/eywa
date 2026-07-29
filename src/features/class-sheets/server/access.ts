import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import type { SkillAreaSetting } from "@/features/owner/settings-types";

/**
 * ECS(English Class Sheet) 공용 접근 게이트 — 조회·모든 서버 액션·RPC 호출부가 **전부** 이 함수를
 * 통과한다(#77 "게이트는 모든 표면이 같은 함수를"). class_sheet_* 테이블은 service_role 전용(0157a
 * deny-RLS)이라 이 게이트가 유일한 역할·스코프 방어선이다.
 *
 * 검증 순서:
 *  ① 로그인 + 메뉴 접근 수준(accessLevelTenant "ecs" — none 차단, write 요구 시 readonly도 차단)
 *  ② effectiveTeacherScope **상시 적용**(실 강사 + 겸직 강사뷰) — classId가 담당 반 목록에 없으면 차단.
 *     ⚠️ slot_teacher_label은 권한 근거로 쓰지 않는다(표시 전용 — LAB/JJ 역할 라벨·닉네임 중복).
 *  ③ 반 실재 + 테넌트 일치(서버 클라 RLS + user.tenantId 이중 확인)
 *  ④ ECS 대상 과목: subject === "english" && resolveSkillAreas 비어있지 않음(계획 v2.2 §A 확정 조건 —
 *     타 과목 확장 시 이 한 줄만 완화)
 */
export type EcsClassAccess = {
  user: CurrentUser;
  tenantId: string;
  classId: string;
  className: string;
  subject: string;
  teacherId: string | null; // classes.teacher_id(반 담임) — 표시·기본값용
  /** 계획/마크/메모 편집 가능(full|scoped). 출석은 별도 attendance 게이트(actions에서 판정). */
  canWrite: boolean;
  skillAreas: SkillAreaSetting[];
};

export type EcsAccessResult =
  | { ok: true; access: EcsClassAccess }
  | { ok: false; error: string };

export async function requireEcsClassAccess(
  classId: string,
  opts: { write?: boolean } = {},
): Promise<EcsAccessResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  const level = await accessLevelTenant(user.systemRole, "ecs");
  if (level === "none") return { ok: false, error: "접근 권한이 없습니다" };
  const canWrite = level === "full" || level === "scoped";
  if (opts.write && !canWrite) return { ok: false, error: "편집 권한이 없습니다" };

  // 강사 스코프 상시 적용(실 강사 + 겸직 강사뷰) — 담당 반이 아니면 차단.
  const scope = await effectiveTeacherScope();
  if (scope && !scope.classIds.includes(classId)) {
    return { ok: false, error: "담당 반이 아닙니다" };
  }

  // 반 실재 + 테넌트 일치. 서버 클라(RLS)라 타 테넌트 행은 애초에 안 보이지만 이중 확인.
  const supabase = await createClient();
  const { data: cls } = await supabase
    .from("classes")
    .select("id, tenant_id, class_name, subject, teacher_id")
    .eq("id", classId)
    .maybeSingle();
  if (!cls || cls.tenant_id !== user.tenantId) {
    return { ok: false, error: "반을 찾을 수 없습니다" };
  }

  // ECS 대상 과목 판정(설정 단일 소스) — v1 = english 한정 + skillAreas 비어있지 않음.
  const settings = await getTenantSettings();
  const subjectRow = settings.operations.subjects.find((s) => s.key === cls.subject);
  const skillAreas = resolveSkillAreas(subjectRow);
  if (cls.subject !== "english" || skillAreas.length === 0) {
    return { ok: false, error: "이 반은 English Class Sheet 대상이 아닙니다" };
  }

  return {
    ok: true,
    access: {
      user,
      tenantId: user.tenantId,
      classId: cls.id,
      className: cls.class_name,
      subject: cls.subject,
      teacherId: cls.teacher_id ?? null,
      canWrite,
      skillAreas,
    },
  };
}

/**
 * ECS 랜딩 스코프 — 현재 사용자가 볼 수 있는 english 반 id 목록 필터.
 * 강사(스코프 有)면 담당 반 교집합, 아니면 전체. 랜딩 쿼리가 재사용.
 */
export async function ecsVisibleClassFilter(): Promise<{ classIds: string[] | null }> {
  const scope = await effectiveTeacherScope();
  return { classIds: scope ? scope.classIds : null };
}
