"use server";

/**
 * 보강 확인창이 쓰는 서버 액션 — 결석 후보 조회(클라에서 부른다).
 * 조회 자체는 [`getMakeupAbsenceOptions`](./makeup-options.ts)가 하고, 여기는 **게이트만** 얹는다.
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getMakeupAbsenceOptions } from "./makeup-options";
import type { MakeupAbsenceOption } from "../makeup-options";

/**
 * 그 학생의 결석 후보(이전 반 포함, 최근 90일).
 * ⚠️ 실패·권한 없음은 **빈 목록**으로 돌려준다 — 확인창은 그때 '직접 입력'으로 폴백한다(창이 막히면 안 된다).
 */
export async function fetchMakeupAbsences(
  studentId: string,
  makeupDate: string,
): Promise<MakeupAbsenceOption[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  // 보강 추가와 같은 권한(출결 쓰기) — 읽기 전용 계정이 남의 결석 이력을 훑는 경로를 열지 않는다.
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return [];
  return getMakeupAbsenceOptions(studentId, makeupDate);
}
