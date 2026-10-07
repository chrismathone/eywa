"use server";

import { formatKoreanDate, kstToday } from "@/lib/date-kst";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { RideLeg, RidePoint, VehicleFleet } from "../parent-rides";
import { isDirection, type Season } from "../types";
import { checkReason } from "./parent-ride-guards";
import { loadRideLegsFor } from "./parent-ride-data";
import type { ParentRideActionState } from "./parent-ride-state";
import { changeRideStopCore, resetRideCore, skipRideCore } from "./ride-change-core";
import { canRecordBoarding } from "./record-gate";
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
}): Promise<ParentRideActionState> {
  const ctx = await staffDayGate(input);
  if ("error" in ctx) return ctx;
  return changeRideStopCore(ctx, input.runStopId);
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
