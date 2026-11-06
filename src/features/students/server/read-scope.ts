import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, readonlyViewErasedScope } from "@/lib/auth/perm-matrix";
import { getDelegatedClassIdsInRange } from "@/features/classes/server/delegation";
import { addDays, kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";

/**
 * 강사(scoped) 학생 **상세 열람** 스코프 — 적대 리뷰 F9(2026-08-18, 원장 "신중히 작업 진행").
 *
 * 배경: 학생 목록은 담당 학생으로 좁혀지는데 상세(getStudentById)는 스코프가 없어, 강사가 URL만 치면
 * 학원 전체 학생의 전화·주소·케어 분석까지 열렸다. 상세도 "담당 학생만"으로 좁힌다.
 *
 * 허용 반 = ECS 게이트(requireEcsClassAccess)와 **같은 세 갈래**:
 *   ① 담임(classes.teacher_id) ② 교시 담당/부담임(class_schedules.teacher_id — 라벨은 권한 근거 금지)
 *   ③ 임시 위임(0173a, ±7일 유예 — ECS_DELEGATION_GRACE_DAYS와 동일 의미론).
 * 갈래를 줄이면 ECS 로스터·좌석표의 학생 링크가 "명단엔 뜨는데 열면 404"가 된다(access.ts 경고와 동일).
 *
 * 허용 학생 = 그 반들에 수강이 있고 **열려 있거나 끝난 지 60일 이내** — ECS 하단 '퇴원' 줄이 30일
 * 유예로 최근 퇴원·전출자를 보여주고 이름이 상세로 링크되므로, 그 두 배를 창으로 잡아 링크가 죽지 않게.
 *
 * 판정 대상은 **students 접근수준이 scoped인 사용자만**(=실 강사). 겸직 관리자(강사뷰)는 실 역할이
 * full이라 무제한 유지(뷰 전환은 스코프/크롬만 바꾸고 권한 불변 — view-mode.ts 규약). readonly
 * (회계·뷰어)는 사무실 역할이라 종전대로 무제한.
 */
export const READ_GRACE_DAYS = 60;

/**
 * 이 강사가 학생 상세를 열람할 수 있는 반 id 합집합(요청당 캐시). 실패는 좁은 쪽으로 떨어진다.
 * JJ실(ijw/server/viewer.ts)도 **같은 갈래**를 쓴다 — 여기를 바꾸면 두 화면이 함께 바뀐다(상세엔 뜨는데 JJ실엔 없는 일이 없게).
 */
export const teacherViewableClassIds = cache(async (userId: string): Promise<string[]> => {
  const supabase = await createClient();
  const today = kstToday();
  const [own, slots, delegated] = await Promise.all([
    supabase.from("classes").select("id").eq("teacher_id", userId),
    supabase.from("class_schedules").select("class_id").eq("teacher_id", userId),
    getDelegatedClassIdsInRange(userId, addDays(today, -7), addDays(today, 7)).catch(() => []),
  ]);
  return [
    ...new Set([
      ...(own.data ?? []).map((r) => r.id as string),
      ...(slots.data ?? []).map((r) => r.class_id as string),
      ...delegated,
    ]),
  ];
});

/** 세 갈래를 **따로** 들고 있는 스코프 — 교시 행은 유효기간까지(지금 도는지 판정용, [[#88]]). */
export type TeacherClassScope = {
  /** 담임(classes.teacher_id) — 반 단위 단일 값이라 그 자체가 '지금'이다. */
  own: string[];
  /** 교시 담당 행 — 마감된 이력 행까지 담는다. */
  slots: { classId: string; validFrom: string | null; validTo: string | null }[];
  /** 임시 위임(오늘 ±7일). */
  delegated: string[];
};

/**
 * 엄격판 — 담임·교시 담당 조회가 실패하면 **던진다**(JJ실용, ijw/server/viewer.ts). 조용히 빈 갈래로 떨어지면 강사에게
 * "담당 학생 없음"이 사실처럼 보인다(적대 재리뷰 2026-09-10). 갈래는 위 `teacherViewableClassIds`와 **같다** — 한쪽을
 * 바꾸면 여기도 함께 바꿀 것(가드: ijw/tenant-guard.test.ts). 학생 상세의 기본판 동작(실패 = 그 갈래만 빈 채)은 그대로다.
 * 위임 실패도 구분해야 하는 소비처는 strictDelegation=true로 호출한다. 기본값은 기존 호출부 동작을 유지한다.
 */
export const teacherClassScopeStrict = cache(async (userId: string, strictDelegation = false): Promise<TeacherClassScope> => {
  const supabase = await createClient();
  const today = kstToday();
  const [own, slots, delegated] = await Promise.all([
    supabase.from("classes").select("id").eq("teacher_id", userId),
    supabase.from("class_schedules").select("class_id, valid_from, valid_to").eq("teacher_id", userId),
    getDelegatedClassIdsInRange(userId, addDays(today, -7), addDays(today, 7), strictDelegation),
  ]);
  if (own.error) throw new Error(`teacher scope (homeroom): ${own.error.message}`);
  if (slots.error) throw new Error(`teacher scope (slots): ${slots.error.message}`);
  return {
    own: (own.data ?? []).map((r) => r.id as string),
    slots: (slots.data ?? []).map((r) => ({
      classId: r.class_id as string,
      validFrom: (r.valid_from as string | null) ?? null,
      validTo: (r.valid_to as string | null) ?? null,
    })),
    delegated,
  };
});

/**
 * 현재 사용자가 이 학생의 상세를 열람할 수 있는가 — getStudentById가 유일 소비 지점(초크포인트)이라
 * 상세 페이지·요약 API(/api/students/[id]/summary)가 함께 잠긴다(#77 — 표면마다 다시 쓰지 않는다).
 */
export async function canViewStudentDetail(studentId: string): Promise<boolean> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return false;
  const level = await accessLevelTenant(user.systemRole, "students");
  // 🔴 읽기 강사뷰는 X의 scoped를 readonly로 캡한다 — 그 캡이 담당 범위까지 지우면 X와 무관한 학생 상세가 열렸다(반 상세는
  //    막히는데 그 반 학생은 열림, 2026-11-05 강사뷰 적대 재리뷰). 반 상세(class-scope.ts)와 같은 판정으로 X의 담당을 다시 건다.
  if (level !== "scoped" && !(level === "readonly" && (await readonlyViewErasedScope("students")))) return true;

  const classIds = await teacherViewableClassIds(user.id);
  if (classIds.length === 0) return false;
  const supabase = await createClient();
  const floor = addDays(kstToday(), -READ_GRACE_DAYS);
  // 담당 반 id는 강사 1인 규모(수십)지만 이력 슬롯이 쌓이면 커질 수 있어 100개 청크(B3) + 조기 종료.
  for (let i = 0; i < classIds.length; i += 100) {
    const part = classIds.slice(i, i + 100);
    const { count, error } = await supabase
      .from("enrollments")
      .select("*", { count: "exact", head: true })
      .eq("student_id", studentId)
      .in("class_id", part)
      .or(`end_date.is.null,end_date.gte.${floor}`);
    // 조회 실패는 차단으로 두지 않는다 — 순간 장애로 강사의 정당 화면이 404가 되는 것보다,
    // 이 요청 한 번을 종전 동작(열람)으로 두는 쪽이 낫다(권한 폴백 fail-open 규약 #60과 같은 결).
    if (error) return true;
    if ((count ?? 0) > 0) return true;
  }
  return false;
}
