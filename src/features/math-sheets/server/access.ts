import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
import { getDelegatedClassIdsInRange } from "@/features/classes/server/delegation";
import { addDays, kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";

/**
 * MCS(Math Class Sheet) 공용 접근 게이트 — 조회·모든 서버 액션이 **전부** 이 함수를 통과한다
 * ([[#77]] "게이트는 모든 표면이 같은 함수를"). `math_month_goals`는 service_role 전용(0237a deny-RLS)이라
 * 이 게이트가 유일한 역할·스코프 방어선이다.
 *
 * ECS 게이트(`requireEcsClassAccess`)와 **일부러 같은 모양**이되 두 가지가 다르다:
 *  · 과목 판정이 `math`다(그리고 `skillAreas`를 요구하지 않는다 — 수학엔 영역 축이 없다).
 *  · **부담임(슬롯 강사) 갈래가 없다.** 실측 2026-08: 수학 유효 슬롯 230개 전부
 *    `class_schedules.teacher_id`가 null이라 그 갈래는 아무도 통과시키지 못한다. 없는 문을 그려 두면
 *    "여기로도 열린다"는 잘못된 인상을 남기므로 아예 두지 않는다.
 *    ⚠️ 나중에 수학 슬롯에 담당이 배선되면 그때 ECS와 같은 방식으로 갈래를 더할 것.
 *
 * 검증 순서:
 *  ① 로그인 + 메뉴 접근 수준(`accessLevelTenant("mcs")` — none 차단, write 요구 시 readonly도 차단)
 *  ② `effectiveTeacherScope` 상시 적용(실 강사 + 겸직 강사뷰) — 담당 반이 아니면 **임시 위임**까지 보고 차단
 *  ③ 반 실재 + 테넌트 일치(서버 클라 RLS + user.tenantId 이중 확인)
 *  ④ MCS 대상 과목: `subject === "math"`
 */
export type McsClassAccess = {
  user: CurrentUser;
  tenantId: string;
  classId: string;
  className: string;
  subject: string;
  /** `classes.teacher_id`(반 담임) — 표시용. 수학은 담임이 목표를 적는 유일한 사람이다. */
  teacherId: string | null;
  /** 목표 편집 가능(full|scoped). */
  canWrite: boolean;
};

export type McsAccessResult = { ok: true; access: McsClassAccess } | { ok: false; error: string };

/** 반 임시 위임(0173a) — ECS와 **같은 창**(오늘 ±7일). 두 시트가 다른 창을 쓰면 설명할 수 없다. */
const DELEGATION_GRACE_DAYS = 7;

async function delegatedClassIds(): Promise<string[]> {
  try {
    const teacherId = await effectiveTeacherId();
    if (!teacherId) return [];
    const today = kstToday();
    return await getDelegatedClassIdsInRange(
      teacherId,
      addDays(today, -DELEGATION_GRACE_DAYS),
      addDays(today, DELEGATION_GRACE_DAYS),
    );
  } catch {
    // 보조 갈래가 죽어도 본 게이트는 살아 있어야 한다(담당 반 동작으로 강등 = fail-closed).
    return [];
  }
}

/**
 * **전체 목표 '초기화'(배정 취소)는 원장 이상급** — 원장 2026-09-18 *"'초기화'는 원장 이상급"*.
 *
 * 🔴 저장(`canWrite`)과 **다른 문**이다: 저장은 덮어쓰기라 되돌릴 값이 화면에 남지만, 초기화는 행을 지워
 *    누가 무엇을 지웠는지가 감사로그에만 남는다. 담임(scoped)이 반 전체 목표를 한 번에 날릴 수 있으면 안 된다.
 * 🔴 super_admin은 명단·게이트를 **언제나** 통과한다(앱 전역 규약, 원장 2026-08-13).
 */
export async function canResetMathLearningGoals(user: CurrentUser | null): Promise<boolean> {
  if (!user) return false;
  return user.systemRole === "master" || (await isCurrentUserSuperAdmin());
}

export async function requireMcsClassAccess(
  classId: string,
  opts: { write?: boolean } = {},
): Promise<McsAccessResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  const level = await accessLevelTenant(user.systemRole, "mcs");
  if (level === "none") return { ok: false, error: "접근 권한이 없습니다" };
  const canWrite = level === "full" || level === "scoped";
  if (opts.write && !canWrite) return { ok: false, error: "편집 권한이 없습니다" };

  // ⚠️ 이 갈래는 목록(`mcsVisibleClassFilter`)과 **같아야** 한다 — 갈라지면 목록엔 뜨는데 열면 거절된다.
  const scope = await effectiveTeacherScope();
  if (scope && !scope.classIds.includes(classId)) {
    const delegated = await delegatedClassIds();
    if (!delegated.includes(classId)) return { ok: false, error: "담당 반이 아닙니다" };
  }

  const supabase = await createClient();
  const { data: cls } = await supabase
    .from("classes")
    .select("id, tenant_id, class_name, subject, teacher_id")
    .eq("id", classId)
    .maybeSingle();
  if (!cls || cls.tenant_id !== user.tenantId) return { ok: false, error: "반을 찾을 수 없습니다" };

  if (cls.subject !== "math") return { ok: false, error: "이 반은 수학 강사 시트 대상이 아닙니다" };

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
    },
  };
}

/**
 * 목록에 세울 반을 좁히는 필터 — 게이트와 **같은 두 갈래**(담당 반 ∪ 임시 위임).
 * 강사 스코프가 없으면(사무실 계정) `null`을 돌려 "전부"를 뜻한다.
 */
export async function mcsVisibleClassFilter(): Promise<((classId: string) => boolean) | null> {
  const scope = await effectiveTeacherScope();
  if (!scope) return null;
  const delegated = await delegatedClassIds();
  const allow = new Set([...scope.classIds, ...delegated]);
  return (classId: string) => allow.has(classId);
}
