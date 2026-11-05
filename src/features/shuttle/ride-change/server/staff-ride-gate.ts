import "server-only";

import { addDays, kstToday, weekdayIndexOf } from "@/lib/date-kst";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDirection } from "../../types";
import { HOLIDAY_CLOSED_MESSAGE } from "./parent-ride-multi";
import type { Ctx } from "./parent-ride-state";
import { canRecordBoarding } from "../../server/record-gate";
import { loadAcademyHolidays, restDayName } from "../../parent/server/rest-days";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** 미리 바꿀 수 있는 기간 — 학부모와 같은 두 달. */
const MAX_AHEAD_DAYS = 62;

/**
 * 직원(관리자 · 셔틀 선생님)의 **그날 하루** 등하원 변경 문(사용자 2026-10-06, 셔틀 '오늘 등하원' 줄의 [수정]·[등원 안함]).
 * 🔑 자격 = 등하원 **기록** 게이트(`canRecordBoarding` — 사무실 ∪ 셔틀 담당 ∪ super_admin)와 같다. 이건 편성 수정이 아니라
 *    그날의 운영이라 차에 타는 셔틀 선생님(역할 viewer)도 바꿀 수 있어야 한다(`setRideException`과 같은 판단).
 * 🔑 행위자 이름에 **누가 바꿨는지** 붙인다 — "관리자 · 이름"(편성 권한 보유) / "셔틀 선생님 · 이름". 줄의 `actor_kind`는 staff라
 *    학부모 변경과 이력 장부(0321a)·화면 표식에서 갈린다(사용자 "명확하게 구별").
 * 🔴 날짜·학생은 서버가 다시 본다([[#77]]): 우리 학원 학생 · 오늘~62일 뒤 평일 · 쉬는 날 아님. 지난 날짜는 그날의 기록이라 안 바꾼다.
 */
export async function staffDayGate(input: { studentId: string; onDate: string; ioKind: string }): Promise<Ctx | { error: string }> {
  // 바꾼 사람(actorName·created_by)은 화면 주인 — 강사뷰면 검증된 대상(자격 canRecordBoarding과 같은 사람).
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canRecordBoarding())) return { error: "셔틀 등하원을 바꿀 권한이 없습니다" };
  if (!isDirection(input.ioKind)) return { error: "등원/하원을 확인해 주세요" };
  if (!YMD.test(input.onDate)) return { error: "날짜를 확인해 주세요" };
  const today = kstToday();
  if (input.onDate < today) return { error: "지난 날짜는 바꿀 수 없어요 — 그날의 기록입니다" };
  if (input.onDate > addDays(today, MAX_AHEAD_DAYS)) return { error: `${MAX_AHEAD_DAYS}일 뒤까지만 미리 바꿀 수 있어요` };
  const dow = weekdayIndexOf(input.onDate);
  if (dow === 0 || dow === 6) return { error: "주말에는 셔틀을 운영하지 않아요" };

  // 🔴 학생 FK는 students(id)뿐이라 다른 학원 학생 uuid도 통과한다 — 우리 학원인지 확인한다(admin은 RLS 우회, [[#104]]).
  const admin = createAdminClient();
  const [studentRes, holidays, office] = await Promise.all([
    admin.from("students").select("id").eq("id", input.studentId).eq("tenant_id", user.tenantId).maybeSingle(),
    loadAcademyHolidays(user.tenantId),
    canWriteTenant(user.systemRole, "shuttle"),
  ]);
  if (studentRes.error || !studentRes.data) return { error: "학생을 찾지 못했습니다" };
  const rest = restDayName(holidays, input.onDate);
  if (rest) return { error: `${HOLIDAY_CLOSED_MESSAGE}(${rest})` };

  return {
    tenantId: user.tenantId,
    studentId: input.studentId,
    onDate: input.onDate,
    ioKind: input.ioKind,
    actorName: `${office ? "관리자" : "셔틀 선생님"} · ${user.displayName}`,
    actor: { kind: "staff", parentAccountId: null, userId: user.id },
  };
}
