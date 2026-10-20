"use server";

import { formatKoreanDate, kstToday } from "@/lib/date-kst";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import type { RideLeg, RidePoint, VehicleFleet } from "../../parent/parent-rides";
import { isDirection, type Season } from "../../types";
import { checkReason } from "./parent-ride-guards";
import { loadRideLegsFor } from "../../parent/server/parent-ride-data";
import type { ParentRideActionState } from "./parent-ride-state";
import { absentRideCore, changeRideStopCore, resetRideCore, skipRideCore } from "./ride-change-core";
import { canRecordBoarding } from "../../server/record-gate";
import { staffDayGate } from "./staff-ride-gate";

/**
 * 직원(관리자 · 셔틀 선생님)의 **그날 하루** 등하원 변경 — 셔틀 '오늘 등하원' 줄의 [수정]·[등원 안함]/[하원 안함]
 * (사용자 2026-10-06 "학부모 등하원에 있는 기능처럼 똑같이 · 관리자 또는 셔틀 선생님이 하는 거니 명확하게 구별").
 * 🔑 본체는 학부모와 **같은 함수**([`ride-change-core.ts`](./ride-change-core.ts)) — 문만 `staffDayGate`.
 *    줄에는 `actor_kind = staff`와 "관리자 · 이름"/"셔틀 선생님 · 이름"이 남는다.
 */

export async function staffChangeRideStop(input: {
  studentId: string;
  onDate: string;
  ioKind: string;
  runStopId: string;
  /** 바꾼 사유(선택 · 월별 '관리자 수정하기', 사용자 2026-10-20) — 학부모·직원 모두 본다. */
  reason?: string;
}): Promise<ParentRideActionState> {
  const ctx = await staffDayGate(input);
  if ("error" in ctx) return ctx;
  let memo: string | null = null;
  if (input.reason?.trim()) {
    const reason = checkReason(input.reason);
    if (typeof reason !== "string") return reason;
    memo = reason;
  }
  return changeRideStopCore(ctx, input.runStopId, memo);
}

export async function staffResetRide(input: { studentId: string; onDate: string; ioKind: string }): Promise<ParentRideActionState> {
  const ctx = await staffDayGate(input);
  if ("error" in ctx) return ctx;
  return resetRideCore(ctx);
}

export async function staffSkipRide(input: {
  studentId: string;
  onDate: string;
  ioKind: string;
  reason: string;
}): Promise<ParentRideActionState> {
  const ctx = await staffDayGate(input);
  if ("error" in ctx) return ctx;
  const reason = checkReason(input.reason);
  if (typeof reason !== "string") return reason;
  return skipRideCore(ctx, reason);
}

/**
 * 직원 **결석** — 그날 등원·하원 둘 다 안 탄다(월별 '관리자 수정하기', 사용자 2026-10-20 "결석인지 시간 이동인지 확실히").
 * 본체는 학부모 [결석]과 같은 `absentRideCore` — 이미 탄 날은 거절 · 사유 필수 · 셔틀만(출석부는 건드리지 않는다).
 */
export async function staffAbsentRide(input: { studentId: string; onDate: string; reason: string }): Promise<ParentRideActionState> {
  const ctx = await staffDayGate({ ...input, ioKind: "in" });
  if ("error" in ctx) return ctx;
  const reason = checkReason(input.reason);
  if (typeof reason !== "string") return reason;
  return absentRideCore(ctx, reason);
}

export type StaffRideEditor =
  | { error: string }
  | { leg: RideLeg; other: RidePoint | null; fleet: VehicleFleet[]; dayLabel: string; today: string };

/**
 * [수정] 창의 재료 — 그 학생의 그날 구간(학부모 '수정하기'와 같은 `loadRideLegsFor`) + 학원 호차 전체 노선.
 * 🔑 누를 때만 읽는다 — 줄마다 노선 전체를 미리 싣지 않는다(오늘 등하원은 전원이 매일 여는 화면이다).
 */
export async function loadStaffRideEditor(input: {
  studentId: string;
  onDate: string;
  ioKind: string;
  runId: string;
  season: Season;
}): Promise<StaffRideEditor> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canRecordBoarding())) return { error: "셔틀 등하원을 바꿀 권한이 없습니다" };
  if (!isDirection(input.ioKind)) return { error: "등원/하원을 확인해 주세요" };
  const today = kstToday();
  const { legs, fleet } = await loadRideLegsFor(
    user.tenantId,
    [input.studentId],
    input.onDate,
    input.season,
    input.onDate === today,
    true,
  );
  const mine = legs.get(input.studentId) ?? [];
  const same = mine.filter((l) => l.direction === input.ioKind);
  const leg = same.find((l) => l.runId === input.runId && !l.skipped) ?? same.find((l) => !l.skipped) ?? same[0];
  if (!leg) return { error: "이 학생의 그날 셔틀 일정을 찾지 못했어요" };
  const otherLeg = mine.find((l) => l.direction !== input.ioKind && !l.skipped) ?? null;
  const other = otherLeg
    ? { runId: otherLeg.runId, time: otherLeg.route.find((s) => s.mine)?.time ?? otherLeg.plannedTime }
    : null;
  const dayLabel = input.onDate === today ? `오늘 · ${formatKoreanDate(input.onDate)}` : `${formatKoreanDate(input.onDate)} 일정`;
  return { leg, other, fleet, dayLabel, today };
}

export type StaffRideDay =
  | { error: string }
  | { legs: RideLeg[]; fleet: VehicleFleet[]; dayLabel: string; today: string };

/**
 * 월별 상세의 [관리자 수정하기](사용자 2026-10-20) — 고른 아이의 그날 **등원·하원 구간 전부** + 학원 호차 전체 노선.
 * 오늘 등하원 [수정](`loadStaffRideEditor`)과 같은 재료(`loadRideLegsFor`)에서 한 방향만 고르지 않고 둘 다 준다.
 * 🔑 누를 때만 읽는다 · 저장은 `staffChangeRideStop`/`staffResetRide`/`staffAbsentRide`가 서버에서 다시 판정한다([[#77]]).
 */
export async function loadStaffRideDay(input: { studentId: string; onDate: string; season: Season }): Promise<StaffRideDay> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canRecordBoarding())) return { error: "셔틀 등하원을 바꿀 권한이 없습니다" };
  const today = kstToday();
  const { legs, fleet } = await loadRideLegsFor(
    user.tenantId,
    [input.studentId],
    input.onDate,
    input.season,
    input.onDate === today,
    true,
  );
  const dayLabel = input.onDate === today ? `오늘 · ${formatKoreanDate(input.onDate)}` : `${formatKoreanDate(input.onDate)} 일정`;
  return { legs: legs.get(input.studentId) ?? [], fleet, dayLabel, today };
}

export type StaffRideStudent = { id: string; name: string; schoolGrade: string };

/**
 * [관리자 수정하기] 1단계의 아이 목록 — 우리 학원 **재원생 전부**(사용자 2026-10-20 "모든 학생들 중 내가 원하는 아이").
 * 🔑 이름·학교·학년만 — 학부모 연락처는 싣지 않는다(셔틀 선생님도 여는 창이다). 누를 때만 읽는다.
 * admin은 RLS를 우회하므로 `tenant_id` 필터가 곧 지점 격리다.
 */
export async function listStaffRideStudents(): Promise<{ students: StaffRideStudent[] } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canRecordBoarding())) return { error: "셔틀 등하원을 바꿀 권한이 없습니다" };
  const admin = createAdminClient();
  type Row = { id: string; name: string; school: string | null; grade: string | null };
  const rows = await fetchAllPaged<Row>((from, to) =>
    admin
      .from("students")
      .select("id, name, school, grade")
      .eq("tenant_id", user.tenantId)
      .eq("status", "enrolled")
      .order("name")
      .order("id")
      .range(from, to),
  );
  return { students: rows.map((r) => ({ id: r.id, name: r.name, schoolGrade: schoolGradeLabel(r.school, r.grade) })) };
}
