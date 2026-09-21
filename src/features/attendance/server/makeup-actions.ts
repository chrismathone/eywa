"use server";

/**
 * 보강 확인창이 쓰는 서버 액션 — 결석 후보 조회(클라에서 부른다).
 * 조회 자체는 [`getMakeupAbsenceOptions`](./makeup-options.ts)가 하고, 여기는 **게이트만** 얹는다.
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherScope, getShellView } from "@/lib/auth/view-mode";
import { createClient } from "@/lib/supabase/server";
import { getTeachingClasses } from "@/features/classes/server/delegation";
import { getMakeupAbsenceOptions } from "./makeup-options";
import type { MakeupAbsenceList } from "../makeup-options";
import { orderHostClasses, type MakeupHostClass } from "../makeup-host";

/** 권한이 없거나 못 불렀을 때 — 확인창은 이걸 받아 '직접 입력'으로 폴백한다. */
const EMPTY: MakeupAbsenceList = { options: [], hiddenBySubject: 0 };

/**
 * 그 학생의 결석 후보(이전 반 포함, 최근 1년 — `getMakeupAbsenceOptions`의 WINDOW_DAYS).
 * ⚠️ 실패·권한 없음은 **빈 목록**으로 돌려준다 — 확인창은 그때 '직접 입력'으로 폴백한다(창이 막히면 안 된다).
 *
 * @param anchorClassId 지금 보강을 넣는 반 — 그 반 **과목**의 결석만 남긴다(수학 보강에 영어 결석이
 *   뜨던 것, 원장 제보 2026-08-19). 🔴 **과목 문자열이 아니라 반 id를 받는다** — 과목은 서버가
 *   `classes.subject`에서 읽는다(클라가 준 과목을 믿으면 필터를 우회할 수 있다). 안 넘기면 안 거른다.
 */
export async function fetchMakeupAbsences(
  studentId: string,
  makeupDate: string,
  anchorClassId?: string | null,
): Promise<MakeupAbsenceList> {
  const user = await getCurrentUser();
  if (!user) return EMPTY;
  // 보강 추가와 같은 권한(출결 쓰기) — 읽기 전용 계정이 남의 결석 이력을 훑는 경로를 열지 않는다.
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return EMPTY;
  // 🔴 앵커(보강을 넣는 반)가 없으면 **그 강사의 과목**으로 좁힌다(원장 2026-09-02) — 반 보강이 아닌
  //    보강 추가에서 전 과목 결석이 뜨던 것. 사무실 계정은 담당 반이 없어 scope가 null이라 안 걸러진다
  //    (전 학원을 보는 자리라 그게 맞다). 강사뷰·겸직은 effectiveTeacherId를 그대로 따른다.
  const teacherSubjects = anchorClassId ? null : ((await effectiveTeacherScope())?.subjects ?? null);
  // 🔴 보강 기한(결석한 달의 다음 달 말일)은 **강사뷰**에서만 건다(원장 2026-09-18 *"강사뷰 보강 추가할때 1개월 초과된
  //    보강은 보여주지말것"*) — 셸과 같은 판정(실 강사 + 겸직의 강사뷰). 사무실 화면은 1년치 그대로. 클라 값은 안 믿는다.
  const deadline = (await getShellView()) === "teacher";
  return getMakeupAbsenceOptions(studentId, makeupDate, anchorClassId ?? null, teacherSubjects, deadline);
}

/**
 * 보강을 기록할 수 있는 **수업(반) 후보** — 원장 2026-09-21 *"보강 추가시에 '수업'을 선택할 수 있어야겠어"*.
 * 🔴 **보강 등록 문(`registerMakeupEntries`)과 같은 판정**(#77 — 보여 놓고 실패하면 안 된다): 그날 담당 반(`getTeachingClasses` —
 *    담임 ∪ 위임, 활성)이고, `subjects`를 주면 그 과목의 반만. 등록 문이 과목까지 맞춰 보기 때문이다.
 * 학생이 그날 다니는 반(휴원 제외)이 맨 앞(`orderHostClasses`). '반 없이'는 창이 따로 둔다.
 * ⚠️ 실패는 `failed: true` — 창은 그때 묻지 않고 종전 앵커(보던 반 필터)로 기록한다(보강 추가 자체가 막히면 더 나쁘다).
 */
export async function fetchMakeupHostClasses(studentId: string, makeupDate: string, subjects?: readonly string[]): Promise<{ options: MakeupHostClass[]; failed?: boolean }> {
  const user = await getCurrentUser();
  if (!user || !(await canWriteTenant(user.systemRole, "attendance"))) return { options: [], failed: true };
  if (typeof studentId !== "string" || !studentId || !/^\d{4}-\d{2}-\d{2}$/.test(makeupDate)) return { options: [], failed: true };
  try {
    const supabase = await createClient();
    const [classes, enrollments] = await Promise.all([
      getTeachingClasses(supabase, user.id, makeupDate),
      supabase.from("enrollments").select("class_id").eq("student_id", studentId).eq("on_hold", false)
        .or(`start_date.is.null,start_date.lte.${makeupDate}`)
        .or(`end_date.is.null,end_date.gte.${makeupDate}`),
    ]);
    if (enrollments.error) throw new Error(enrollments.error.message);
    const enrolled = new Set(((enrollments.data ?? []) as { class_id: string }[]).map((e) => e.class_id));
    const wanted = subjects?.length ? new Set(subjects) : null;
    return { options: orderHostClasses(classes.filter((c) => !wanted || wanted.has(c.subject)).map((c) => ({
      classId: c.id, className: c.className, subject: c.subject, enrolled: enrolled.has(c.id),
    }))) };
  } catch (e) {
    console.error("[makeup-host] 반 후보 조회 실패", e instanceof Error ? e.message : e);
    return { options: [], failed: true };
  }
}
