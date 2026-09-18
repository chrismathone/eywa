"use server";

/**
 * 보강 확인창이 쓰는 서버 액션 — 결석 후보 조회(클라에서 부른다).
 * 조회 자체는 [`getMakeupAbsenceOptions`](./makeup-options.ts)가 하고, 여기는 **게이트만** 얹는다.
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherScope, getShellView } from "@/lib/auth/view-mode";
import { getMakeupAbsenceOptions } from "./makeup-options";
import type { MakeupAbsenceList } from "../makeup-options";

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
