import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { logActionAs } from "@/features/audit/server/log";
import { ridePairConflict } from "../../parent/parent-rides";
import type { Direction } from "../../types";
import { checkStop, closedRunsMessage, closedStopsMessage, rodeMessage, stopPoint } from "./parent-ride-guards";
import {
  ABSENT_PREFIX,
  DIRECTION_WORD,
  cancelAll,
  effectiveStopId,
  loadStates,
  otherDirection,
  refreshRideViews,
  reviveAbsentOut,
  type Admin,
  type Ctx,
  type ParentRideActionState,
} from "./parent-ride-state";

/**
 * 그날 하루 등하원 변경의 **본체** — 학부모(`parent-ride-actions.ts`)와 직원(`staff-ride-actions.ts`, 관리자 · 셔틀 선생님,
 * 사용자 2026-10-06 "학부모 등하원에 있는 기능처럼 똑같이")가 **같은 함수**를 탄다. 문(게이트)만 다르다.
 * ⚠️ 일반 서버 모듈이다(`"use server"` 아님) — 여기 함수는 액션이 아니라 게이트를 통과한 `ctx`를 받는다.
 *
 * 🔑 저장 자리는 `shuttle_ride_exceptions`(0229a) 한 표 — 줄의 `actor_kind`(parent/staff)와 이력 장부(0321a)가 누가 바꿨는지를 남긴다.
 * 🔴 저장 전 서버가 다시 보는 규칙([[#77]]): 자리(우리 학원 · 학기중 · 운행 중인 차) · 이미 탔으면 잠금 · 짝 규칙.
 *    출발 10분 전 마감은 **학부모만**(직원은 전화를 받고 그 자리에서 바꾼다 — `closedRunsMessage`).
 */

/** 줄에 적는 행위자 칸 — 학부모면 학부모 계정, 직원이면 작성자(created_by). */
function actorColumns(ctx: Ctx) {
  return {
    created_by: ctx.actor.userId,
    actor_kind: ctx.actor.kind,
    actor_name: ctx.actorName,
    parent_account_id: ctx.actor.parentAccountId,
  };
}

const savedNote = (ctx: Ctx) =>
  ctx.actor.kind === "staff" ? "학부모 화면에도 바로 반영돼요" : "셔틀 선생님 화면에도 바로 반영돼요";

async function log(ctx: Ctx, action: string, metadata: Record<string, unknown>) {
  await logActionAs(
    { tenantId: ctx.tenantId, actorName: ctx.actorName },
    { action, targetType: "shuttle", metadata: { onDate: ctx.onDate, studentId: ctx.studentId, ...metadata, by: ctx.actor.kind } },
  );
}

/**
 * 그날 그 방향의 **타는/내리는 곳**을 바꾼다. 평소 자리를 고르면 되돌리기와 같다.
 * 🔑 '타지 않기'가 걸려 있으면 함께 풀린다 · 결석 뒤 등원을 고치면 하원도 되살린다(`reviveAbsentOut`).
 * 🔑 `memo` = 바꾼 사유(직원 '관리자 수정하기', 사용자 2026-10-20) — 줄 메모로 남아 학부모·직원 모두 본다. 없으면 null.
 *    같은 자리에 사유만 달라졌으면 사유만 고친다.
 */
export async function changeRideStopCore(ctx: Ctx, runStopId: string, memo: string | null = null): Promise<ParentRideActionState> {
  const tenantId = ctx.tenantId;
  const admin = createAdminClient();
  try {
    // ① 서로 독립인 읽기 셋 — 자리 확인 · 탄 기록 · 두 방향 상태(B4).
    const [stop, rode, states] = await Promise.all([
      checkStop(admin, tenantId, runStopId),
      rodeMessage(admin, ctx),
      loadStates(admin, ctx),
    ]);
    if ("error" in stop) return stop;
    if (rode) return { error: rode };
    const state = states[ctx.ioKind];
    const otherState = states[otherDirection(ctx.ioKind)];

    // ② 고른 자리가 정해진 뒤 — 마감 · 반대 방향 자리.
    // 🔑 마감은 **고른 회차와 지금 타는 회차 둘 다** 본다(사용자 2026-10-15 "출발 10분 전부터는 수정 불가능") —
    //    종전(2026-09-29)엔 고른 회차만 봐서, 이미 떠난 회차에 탄 아이를 다른 회차로 옮길 수 있었다.
    const currentStopIds = state.add?.run_stop_id ? [state.add.run_stop_id] : state.regularStopIds;
    const [closed, closedNow, other] = await Promise.all([
      closedRunsMessage(admin, ctx, [stop.runId]),
      state.skip ? Promise.resolve(null) : closedStopsMessage(admin, ctx, currentStopIds),
      stopPoint(admin, tenantId, effectiveStopId(otherState)),
    ]);
    if (closedNow) return { error: closedNow };
    if (closed) return { error: closed };
    const pair = ridePairConflict(ctx.ioKind, { runId: stop.runId, time: stop.time }, other);
    if (pair) return { error: pair };

    const before = state.skip ? "skip" : state.add?.run_stop_id ?? state.regularStopIds[0] ?? null;
    let message: string;
    if (state.regularStopIds.includes(stop.id)) {
      if (!state.add && !state.skip) return { ok: true, message: "이미 평소 타는 곳이에요" };
      await cancelAll(admin, ctx, [state.skip, state.add]);
      message = state.skip ? "다시 타는 것으로 바꿨어요" : "평소 타는 곳으로 되돌렸어요";
    } else {
      const sameStop = state.add?.run_stop_id === stop.id;
      const memoChanged = memo !== null && memo !== state.add?.memo;
      if (!state.skip && sameStop && !memoChanged) return { ok: true, message: "이미 그곳으로 바뀌어 있어요" };
      await cancelAll(admin, ctx, [state.skip]);
      if (!sameStop || memoChanged) {
        const { error } = await admin.from("shuttle_ride_exceptions").upsert(
          {
            tenant_id: tenantId,
            on_date: ctx.onDate,
            student_id: ctx.studentId,
            kind: "add",
            io_kind: ctx.ioKind,
            run_stop_id: stop.id,
            memo,
            ...actorColumns(ctx),
          },
          { onConflict: "tenant_id,on_date,student_id,kind,io_kind" },
        );
        if (error) throw error;
      }
      message = `바꿨어요. ${savedNote(ctx)}`;
    }
    if (await reviveAbsentOut(admin, ctx, states.out)) message += " · 하원도 평소대로 다시 타요";

    await log(ctx, "shuttle_ride_exception_set", { kind: "add", ioKind: ctx.ioKind, runStopId: stop.id, before, ...(memo ? { reason: memo } : {}) });
    refreshRideViews();
    return { ok: true, message };
  } catch (e) {
    reportError(e, { scope: "shuttle.rideChangeStop", onDate: ctx.onDate, by: ctx.actor.kind });
    return { error: "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요" };
  }
}

/** 그날 그 방향을 **평소대로** — 걸려 있는 '여기서 탐'·'타지 않기'를 모두 지운다. */
export async function resetRideCore(ctx: Ctx): Promise<ParentRideActionState> {
  const tenantId = ctx.tenantId;
  const admin = createAdminClient();
  try {
    const [rode, states] = await Promise.all([rodeMessage(admin, ctx), loadStates(admin, ctx)]);
    if (rode) return { error: rode };
    const state = states[ctx.ioKind];
    if (!state.add && !state.skip) return { ok: true, message: "이미 평소대로예요" };

    // 되돌아갈 평소 회차와 지금 걸린 회차(여기서 탐) 둘 다 마감을 본다.
    const [closed, back, other] = await Promise.all([
      closedStopsMessage(admin, ctx, [...state.regularStopIds, ...(state.add?.run_stop_id ? [state.add.run_stop_id] : [])]),
      stopPoint(admin, tenantId, state.regularStopIds[0] ?? null),
      stopPoint(admin, tenantId, effectiveStopId(states[otherDirection(ctx.ioKind)])),
    ]);
    if (closed) return { error: closed };
    const pair = back ? ridePairConflict(ctx.ioKind, back, other) : null;
    if (pair) return { error: `평소 자리로 되돌릴 수 없어요 — ${pair}` };

    await cancelAll(admin, ctx, [state.skip, state.add]);
    const revived = await reviveAbsentOut(admin, ctx, states.out);
    await log(ctx, "shuttle_ride_exception_clear", { ioKind: ctx.ioKind, revivedOut: revived });
    refreshRideViews();
    return { ok: true, message: revived ? "평소대로 되돌렸어요 · 하원도 다시 타요" : "평소 타는 곳으로 되돌렸어요" };
  } catch (e) {
    reportError(e, { scope: "shuttle.rideReset", onDate: ctx.onDate, by: ctx.actor.kind });
    return { error: "되돌리지 못했어요. 잠시 뒤 다시 시도해 주세요" };
  }
}

/**
 * 그 방향에 '타지 않기'를 건다 — 걸려 있던 '여기서 탐'은 지운다. 성공하면 true, 못 걸면 안내 문구.
 * 🔑 마감 = 지금 타는 회차 출발 10분 전(학부모만) · 이미 탔으면 못 건다.
 */
async function applySkip(admin: Admin, ctx: Ctx, memo: string): Promise<true | string> {
  const [rode, states] = await Promise.all([rodeMessage(admin, ctx), loadStates(admin, ctx)]);
  if (rode) return rode;
  const state = states[ctx.ioKind];
  const currentStopIds = state.add?.run_stop_id ? [state.add.run_stop_id] : state.regularStopIds;
  if (currentStopIds.length === 0) return `이날은 ${DIRECTION_WORD[ctx.ioKind]} 셔틀 일정이 없어요`;
  const closed = await closedStopsMessage(admin, ctx, currentStopIds);
  if (closed) return closed;

  await cancelAll(admin, ctx, [state.add]);
  const { error } = await admin.from("shuttle_ride_exceptions").upsert(
    {
      tenant_id: ctx.tenantId,
      on_date: ctx.onDate,
      student_id: ctx.studentId,
      kind: "skip",
      io_kind: ctx.ioKind,
      run_stop_id: null,
      memo,
      ...actorColumns(ctx),
    },
    { onConflict: "tenant_id,on_date,student_id,kind,io_kind" },
  );
  if (error) throw error;
  return true;
}

/** 그날 그 방향을 **타지 않는다** — 사유는 호출부가 확인한 값(`checkReason`). */
export async function skipRideCore(ctx: Ctx, reason: string): Promise<ParentRideActionState> {
  const admin = createAdminClient();
  try {
    const applied = await applySkip(admin, ctx, reason);
    if (applied !== true) return { error: applied };
    await log(ctx, "shuttle_ride_exception_set", { kind: "skip", ioKind: ctx.ioKind, reason });
    refreshRideViews();
    return { ok: true, message: `${DIRECTION_WORD[ctx.ioKind]}하지 않는 것으로 저장했어요` };
  } catch (e) {
    reportError(e, { scope: "shuttle.rideSkip", onDate: ctx.onDate, by: ctx.actor.kind });
    return { error: "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요" };
  }
}

/**
 * **결석** — 그날 등원·하원 **둘 다** 타지 않는다. 두 줄 모두 사유 앞에 "결석 · ".
 * 🔑 방향마다 따로 건다 — 못 거는 방향은 건너뛰고 나머지만(둘 다 못 걸면 안내).
 * 🔒 **그날 한 방향이라도 이미 탔으면 결석 자체를 거절한다**(사용자 2026-10-08 "차량에 탑승한 경우 결석 버튼은 누르지 못하게").
 *    종전엔 탄 방향만 건너뛰어 "결석으로 저장했어요 · 하원만 타지 않아요"로 **절반 결석**이 저장됐다 — 차에 탄 아이가
 *    결석으로 남는다. 하원을 빼려면 [하원 안 타기]를 쓴다(그건 그대로 된다). 화면도 버튼을 잠그지만 게이트는 여기다([[#77]]).
 * ⚠️ 셔틀만이다 — 출결(출석부)의 결석은 건드리지 않는다(0229a 원칙).
 */
export async function absentRideCore(ctx: Ctx, reason: string): Promise<ParentRideActionState> {
  const admin = createAdminClient();
  try {
    const directions = ["in", "out"] as const satisfies readonly Direction[];
    const rodeEither = await Promise.all(directions.map((ioKind) => rodeMessage(admin, { ...ctx, ioKind })));
    if (rodeEither.some(Boolean)) return { error: "오늘은 이미 셔틀을 탔어요. 탄 뒤에는 결석으로 바꿀 수 없어요" };
    const results = await Promise.all(
      directions.map((ioKind) => applySkip(admin, { ...ctx, ioKind }, `${ABSENT_PREFIX}${reason}`)),
    );
    const done = directions.filter((_, i) => results[i] === true);
    const skipped = results.filter((r): r is string => r !== true);
    if (done.length === 0) return { error: skipped[0] ?? "결석으로 바꿀 셔틀 일정이 없어요" };

    await log(ctx, "shuttle_ride_exception_set", { kind: "skip", ioKinds: done, absent: true, reason });
    refreshRideViews();
    return {
      ok: true,
      message: done.length === 2 ? "결석으로 저장했어요 · 등원·하원 모두 타지 않아요" : `결석으로 저장했어요 · ${DIRECTION_WORD[done[0]!]}만 타지 않아요`,
    };
  } catch (e) {
    reportError(e, { scope: "shuttle.rideAbsent", onDate: ctx.onDate, by: ctx.actor.kind });
    return { error: "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요" };
  }
}
