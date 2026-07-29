import "server-only";
import { cache } from "react";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
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
 *  ② effectiveTeacherScope **상시 적용**(실 강사 + 겸직 강사뷰) — classId가 담당 반 목록에 없으면
 *     **부담임 보조 스코프**(ecsAssistantClassIds — 원장 승인 2026-07-29 확장)까지 보고 없으면 차단.
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

  // 강사 스코프 상시 적용(실 강사 + 겸직 강사뷰) — 반담당도 부담임(슬롯 강사)도 아니면 차단.
  const scope = await effectiveTeacherScope();
  if (scope && !scope.classIds.includes(classId)) {
    const assistant = await ecsAssistantClassIds();
    if (!assistant.includes(classId)) {
      return { ok: false, error: "담당 반이 아닙니다" };
    }
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
 * ECS 전용 부담임(슬롯 강사) 보조 스코프 — 내가 슬롯 강사로 배선된 english 반 id 목록.
 * (원장 승인 2026-07-29: "부담임도 ECS 열 수 있도록. JJ·LAB 아르바이트 강사는 필요없음.")
 *
 * - 근거는 `class_schedules.teacher_id`(FK)**만** — slot_teacher_label은 여전히 권한 근거 금지(표시 전용).
 * - **JJ·LAB 당번 슬롯 제외는 구조적으로 자동**: 그 슬롯들은 teacher_id가 전부 null(2026-07-29 실측
 *   90/90 — 라벨만 있는 자리)이라 FK 기반 확장에 애초에 안 걸린다. 라벨 검사를 넣지 말 것.
 * - 전역 teacher-scope.ts는 **불변**(출석·학생·시간표 전 화면 파급) — ECS만 이 보조 스코프를 합집합.
 * - 유효기간 지난 슬롯도 포함(반담당 스코프와 동일 의미론 — 과거 주차 시트 열람 유지).
 * - 조회 실패는 [](보조 스코프만 소실 = 기존 반담당 동작으로 강등, fail-closed) — 확장이 죽어도
 *   본 게이트는 안 죽는다.
 */
export const ecsAssistantClassIds = cache(async (): Promise<string[]> => {
  const teacherId = await effectiveTeacherId();
  if (!teacherId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_schedules")
    .select("class_id, classes!inner(subject)")
    .eq("teacher_id", teacherId)
    .eq("classes.subject", "english");
  if (error) return [];
  return [...new Set((data ?? []).map((r) => r.class_id as string))];
});

/**
 * ECS 랜딩 스코프 — 현재 사용자가 볼 수 있는 english 반 id 목록 필터.
 * 강사(스코프 有)면 담당 반 ∪ 부담임 반, 아니면 전체. 랜딩 쿼리·반 전환 드롭다운이 재사용.
 */
export async function ecsVisibleClassFilter(): Promise<{ classIds: string[] | null }> {
  const scope = await effectiveTeacherScope();
  if (!scope) return { classIds: null };
  const assistant = await ecsAssistantClassIds();
  return { classIds: [...new Set([...scope.classIds, ...assistant])] };
}
