import "server-only";

/**
 * JJ실을 보는 사람 — 짝 잇기 권한 + 강사 스코프(누구의 학생까지 보이나).
 *
 * 🔴 강사 스코프는 **학생 상세 열람과 같은 세 갈래**(담임 ∪ 교시 담당 ∪ 임시 위임, students/server/read-scope.ts)다.
 *    담임 반만 보던 첫 구현은 원어민 강사(담임 0 · 교시 담당 5)에게 JJ실을 통째로 비워 보이면서 "담당 학생 중
 *    연결된 학생이 없습니다"라고 말했다 — 정작 그 학생 상세에선 JJ 구역이 떴다(적대 리뷰 2026-09-10).
 * 🔑 수강은 열려 있거나 끝난 지 60일 이내(READ_GRACE_DAYS — 상세 열람과 같은 창). 퇴원 예정일이 잡힌 학생도 남는다.
 * 🔴 칩 노출(hasEnglish)은 학생 범위와 **다른 판정** — 지금 도는 영어 반만 센다(scope.ts). 마감된 옛 영어 교시로
 *    수학 강사에게 학원 전체 영어 집계가 새지 않게(적대 재리뷰 2026-09-10).
 * 🔴 스코프 조회는 **엄격판**(teacherClassScopeStrict)이다 — 담임·교시 조회가 실패하면 던지고, 여기서 **좁게**(학생 0명)
 *    떨어지면서 scopeFailed로 그 사실을 화면에 알린다(조용히 빈 표 = "담당 학생 없음"이라는 거짓말). 넓게 떨어지면 남의 학생이 보인다.
 * ⚠️ admin 클라이언트 = RLS 우회 → 조회마다 tenant_id(tenant-guard.test.ts).
 */
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";
import { READ_GRACE_DAYS, teacherClassScopeStrict } from "@/features/students/server/read-scope";
import { hasLiveEnglishClass, viewableClassIds } from "../scope";

export type JjAccess = {
  tenantId: string;
  /** 짝을 잇고 끊을 수 있는가 = 학생 기록 관리(students full). 강사·열람 전용은 false. */
  canLink: boolean;
};

/** 짝 권한만(스코프 계산 없음 — 학생 상세처럼 이미 열람 게이트를 지난 곳은 이것만 쓴다). */
export const getJjAccess = cache(async (): Promise<JjAccess | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  return { tenantId: user.tenantId, canLink: await canManageTenant(user.systemRole, "students") };
});

export type JjViewer = JjAccess & {
  /** 강사 스코프면 볼 수 있는 학생 id, 아니면 null(전체). */
  teacherStudentIds: ReadonlySet<string> | null;
  /** 담당(세 갈래) 반에 영어가 있는가 — 없으면 JJ 칩을 세우지 않는다. 전체 보기면 true. */
  hasEnglish: boolean;
  /** 강사 스코프 계산이 실패했다(좁게 떨어짐) — 빈 화면 대신 이 사실을 알린다. */
  scopeFailed: boolean;
};

async function teacherJjScope(
  tenantId: string,
  teacherId: string,
): Promise<{ teacherStudentIds: Set<string>; hasEnglish: boolean }> {
  // 엄격판 — 조회가 실패하면 던진다 → getJjViewer가 scopeFailed로 알린다.
  const scope = await teacherClassScopeStrict(teacherId);
  const classIds = viewableClassIds(scope);
  if (classIds.length === 0) return { teacherStudentIds: new Set(), hasEnglish: false };
  const admin = createAdminClient();
  const today = kstToday();
  const floor = addDays(today, -READ_GRACE_DAYS);
  const [classes, enr] = await Promise.all([
    fetchInChunks<{ id: string; subject: string | null; is_active: boolean | null }>(classIds, (chunk) =>
      admin.from("classes").select("id, subject, is_active").eq("tenant_id", tenantId).in("id", chunk),
    ),
    fetchAllPagedInChunks<{ id: string; student_id: string }>(classIds, (chunk, from, to) =>
      admin
        .from("enrollments")
        .select("id, student_id")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .or(`end_date.is.null,end_date.gte.${floor}`)
        .order("id")
        .range(from, to),
    ),
  ]);
  return {
    teacherStudentIds: new Set(enr.map((e) => e.student_id)),
    // 🔴 칩 노출은 **지금 도는** 영어 반만(scope.ts) — 학생 범위(위, 이력 교시 포함)와 다른 판정이다.
    hasEnglish: hasLiveEnglishClass(
      scope,
      classes.map((c) => ({ id: c.id, subject: c.subject, isActive: c.is_active === true })),
      today,
    ),
  };
}

/** JJ실 화면(성적관리·결과 창)용 — 강사면 세 갈래 스코프까지. 요청당 한 번. */
export const getJjViewer = cache(async (): Promise<JjViewer | null> => {
  const [access, teacherId] = await Promise.all([getJjAccess(), effectiveTeacherId()]);
  if (!access) return null;
  if (!teacherId) return { ...access, teacherStudentIds: null, hasEnglish: true, scopeFailed: false };
  try {
    return { ...access, ...(await teacherJjScope(access.tenantId, teacherId)), scopeFailed: false };
  } catch (e) {
    reportError(e, { scope: "ijw", step: "teacher-scope" });
    return { ...access, teacherStudentIds: new Set(), hasEnglish: true, scopeFailed: true };
  }
});
