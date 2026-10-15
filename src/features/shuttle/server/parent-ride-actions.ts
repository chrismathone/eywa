"use server";

import { checkReason } from "./parent-ride-guards";
import type { ParentRideActionState } from "./parent-ride-state";
import { forDates, multiDates, parentDayGate } from "./parent-ride-multi";
import { absentRideCore, changeRideStopCore, resetRideCore, skipRideCore } from "./ride-change-core";

/**
 * 학부모 **그날 하루** 등하원 변경 — 학부모가 바꾸면 **바로 적용**된다(사용자 2026-09-29 "바로 적용해서 디비도 바뀌게").
 * (매주 반복되는 고정 시간 변경은 `parent-regular-ride-actions.ts`.)
 *
 * 🔑 본체는 [`ride-change-core.ts`](./ride-change-core.ts) — 직원(관리자 · 셔틀 선생님)의 `staff-ride-actions.ts`와 **같은 함수**다.
 *    여기서는 문만 연다:
 *    · 아이·날짜 = `parentDayGate`(연결된 아이 · 오늘~62일 뒤 평일 · **공휴일 잠금**, 사용자 2026-10-01)
 *    · 여러 날(`dates`, 월별 달력에서 고른 날짜들) = 날짜마다 같은 규칙을 따로 통과(`forDates`)
 *    · 학부모만의 규칙 = 회차 출발 10분 전 마감(본체의 `closedRunsMessage`가 행위자로 가른다)
 */

/** 그날 그 방향의 **타는/내리는 곳**을 바꾼다. 평소 자리를 고르면 되돌리기와 같다. */
export async function changeParentRideStop(input: {
  studentId: string;
  onDate: string;
  ioKind: string;
  runStopId: string;
  dates?: string[];
}): Promise<ParentRideActionState> {
  const many = multiDates(input.dates);
  if (many) return forDates(many, (onDate) => changeParentRideStop({ ...input, onDate, dates: undefined }));
  const ctx = await parentDayGate(input);
  if ("error" in ctx) return ctx;
  return changeRideStopCore(ctx, input.runStopId);
}

/** 그날 그 방향을 **평소대로** — 걸려 있는 '여기서 탐'·'타지 않기'를 모두 지운다. */
export async function resetParentRide(input: {
  studentId: string;
  onDate: string;
  ioKind: string;
  dates?: string[];
}): Promise<ParentRideActionState> {
  const many = multiDates(input.dates);
  if (many) return forDates(many, (onDate) => resetParentRide({ ...input, onDate, dates: undefined }));
  const ctx = await parentDayGate(input);
  if ("error" in ctx) return ctx;
  return resetRideCore(ctx);
}

/**
 * 그날 그 방향을 **타지 않는다**('등원만/하원만 타지 않기', 사용자 2026-09-29).
 * 🔑 사유는 **필수**(짧게라도) — 줄의 `memo`로 남아 직원 화면·이력 장부에서 보인다.
 */
export async function skipParentRide(input: {
  studentId: string;
  onDate: string;
  ioKind: string;
  reason: string;
  dates?: string[];
}): Promise<ParentRideActionState> {
  const many = multiDates(input.dates);
  if (many) return forDates(many, (onDate) => skipParentRide({ ...input, onDate, dates: undefined }));
  const ctx = await parentDayGate(input);
  if ("error" in ctx) return ctx;
  const reason = checkReason(input.reason);
  if (typeof reason !== "string") return reason;
  return skipRideCore(ctx, reason);
}

/** **결석** — 그날 등원·하원 **둘 다** 타지 않는다(사용자 2026-09-29). 사유 필수. */
export async function absentParentRide(input: {
  studentId: string;
  onDate: string;
  reason: string;
  dates?: string[];
}): Promise<ParentRideActionState> {
  const many = multiDates(input.dates);
  if (many) return forDates(many, (onDate) => absentParentRide({ ...input, onDate, dates: undefined }));
  const ctx = await parentDayGate({ ...input, ioKind: "in" });
  if ("error" in ctx) return ctx;
  const reason = checkReason(input.reason);
  if (typeof reason !== "string") return reason;
  return absentRideCore(ctx, reason);
}
