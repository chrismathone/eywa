"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { logActionAs } from "@/features/audit/server/log";
import { ridePairConflict } from "../parent-rides";
import type { Direction } from "../types";
import {
  checkReason,
  checkStop,
  closedRunsMessage,
  closedStopsMessage,
  rodeMessage,
  stopPoint,
} from "./parent-ride-guards";
import {
  ABSENT_PREFIX,
  DIRECTION_WORD,
  cancelAll,
  effectiveStopId,
  loadStates,
  otherDirection,
  parentGate,
  refreshRideViews,
  reviveAbsentOut,
  type Admin,
  type Ctx,
  type ParentRideActionState,
} from "./parent-ride-state";

/**
 * 학부모 **그날 하루** 등하원 변경 — 학부모가 바꾸면 **바로 적용**된다(사용자 2026-09-29 "바로 적용해서 디비도 바뀌게").
 * (매주 반복되는 고정 시간 변경은 `parent-regular-ride-actions.ts`.)
 *
 * 🔑 저장 자리는 직원의 '오늘만 승하차'와 **같은 표**(`shuttle_ride_exceptions`, 0229a)다 — 날짜 하나 · 방향 하나에
 *    `add`(여기서 탐) 한 줄. 셔틀 선생님 화면·관제·인쇄가 이미 이 표를 읽으므로 따로 알릴 필요 없이 그대로 보인다.
 *    평소 자리로 되돌리면 그 줄을 지운다(= 정기 배정대로).
 * 🔑 누가·언제·어떻게는 이력 장부(0321a 트리거)가 남긴다 — 여기서는 줄에 **행위자**(학부모 · 이름)만 적는다.
 *    감사로그에도 `logActionAs`로 한 줄(학부모는 직원 표에 없어 `logAction`은 조용히 건너뛴다).
 *
 * 🔴 저장 전 서버가 다시 보는 규칙([[#77]], 확인 함수는 `parent-ride-guards.ts`):
 *    · 아이·날짜 = `parentGate`(연결된 아이 · 오늘~62일 뒤 평일)
 *    · 자리 = 우리 학원 · 학기중 회차 · 운행 중인 차의 정류장 칸
 *    · 이미 탔으면 못 바꾼다(오늘 · `rodeMessage`, 사용자 2026-09-30)
 *    · 마감 = **고른 회차 출발 10분 전**(마감된 회차**로** 바꾸는 것만 막는다)
 *    · 짝 규칙 = 그날 반대 방향과 같은 회차 금지 · 등원이 하원보다 빨라야(`ridePairConflict`, 사용자 2026-09-30)
 * ⚡ 서로 기다릴 필요 없는 조회는 함께 돌린다(B4) — 예전엔 저장 한 번에 왕복이 12번 넘게 줄지어 있었다.
 */

/**
 * 그날 그 방향의 **타는/내리는 곳**을 바꾼다. 평소 자리를 고르면 되돌리기와 같다.
 * 🔑 '타지 않기'가 걸려 있으면 **함께 풀린다** — 다른 시간을 고른 것 = 다시 탄다(사용자 2026-09-29).
 * 🔑 결석 뒤 등원을 고치면 하원도 되살린다(`reviveAbsentOut`). 하원을 고치면 등원은 그대로.
 */
export async function changeParentRideStop(input: {
  studentId: string;
  onDate: string;
  ioKind: string;
  runStopId: string;
}): Promise<ParentRideActionState> {
  const ctx = await parentGate(input);
  if ("error" in ctx) return ctx;
  const tenantId = ctx.viewer.tenantId;
  const admin = createAdminClient();

  try {
    // ① 서로 독립인 읽기 셋 — 자리 확인 · 탄 기록 · 두 방향 상태.
    const [stop, rode, states] = await Promise.all([
      checkStop(admin, tenantId, input.runStopId),
      rodeMessage(admin, ctx),
      loadStates(admin, ctx),
    ]);
    if ("error" in stop) return stop;
    if (rode) return { error: rode };
    const state = states[ctx.ioKind];
    const otherState = states[otherDirection(ctx.ioKind)];

    // ② 고른 자리가 정해진 뒤 — 마감(고른 회차만, 사용자 2026-09-29) · 반대 방향 자리.
    const [closed, other] = await Promise.all([
      closedRunsMessage(admin, ctx, [stop.runId]),
      stopPoint(admin, tenantId, effectiveStopId(otherState)),
    ]);
    if (closed) return { error: closed };
    const pair = ridePairConflict(ctx.ioKind, { runId: stop.runId, time: stop.time }, other);
    if (pair) return { error: pair };

    const before = state.skip ? "skip" : state.add?.run_stop_id ?? state.regularStopIds[0] ?? null;
    let message: string;
    if (state.regularStopIds.includes(stop.id)) {
      // 평소 자리 = 되돌리기(타지 않기도 함께 푼다).
      if (!state.add && !state.skip) return { ok: true, message: "이미 평소 타는 곳이에요" };
      await cancelAll(admin, ctx, [state.skip, state.add]);
      message = state.skip ? "다시 타는 것으로 바꿨어요" : "평소 타는 곳으로 되돌렸어요";
    } else {
      if (!state.skip && state.add?.run_stop_id === stop.id) return { ok: true, message: "이미 그곳으로 바뀌어 있어요" };
      await cancelAll(admin, ctx, [state.skip]);
      if (state.add?.run_stop_id !== stop.id) {
        const { error } = await admin.from("shuttle_ride_exceptions").upsert(
          {
            tenant_id: tenantId,
            on_date: ctx.onDate,
            student_id: ctx.studentId,
            kind: "add",
            io_kind: ctx.ioKind,
            run_stop_id: stop.id,
            memo: null,
            created_by: null,
            actor_kind: "parent",
            actor_name: ctx.actorName,
            parent_account_id: ctx.viewer.parentAccountId,
          },
          { onConflict: "tenant_id,on_date,student_id,kind,io_kind" },
        );
        if (error) throw error;
      }
      message = "바꿨어요. 셔틀 선생님 화면에도 바로 반영돼요";
    }
    if (await reviveAbsentOut(admin, ctx, states.out)) message += " · 하원도 평소대로 다시 타요";

    await logActionAs(
      { tenantId, actorName: ctx.actorName },
      {
        action: "shuttle_ride_exception_set",
        targetType: "shuttle",
        metadata: { onDate: ctx.onDate, studentId: ctx.studentId, kind: "add", ioKind: ctx.ioKind, runStopId: stop.id, before, by: "parent" },
      },
    );
    refreshRideViews();
    return { ok: true, message };
  } catch (e) {
    reportError(e, { scope: "shuttle.parentChangeStop", onDate: ctx.onDate });
    return { error: "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요" };
  }
}

/** 그날 그 방향을 **평소대로** — 걸려 있는 '여기서 탐'·'타지 않기'를 모두 지운다. */
export async function resetParentRide(input: {
  studentId: string;
  onDate: string;
  ioKind: string;
}): Promise<ParentRideActionState> {
  const ctx = await parentGate(input);
  if ("error" in ctx) return ctx;
  const tenantId = ctx.viewer.tenantId;
  const admin = createAdminClient();
  try {
    const [rode, states] = await Promise.all([rodeMessage(admin, ctx), loadStates(admin, ctx)]);
    if (rode) return { error: rode };
    const state = states[ctx.ioKind];
    if (!state.add && !state.skip) return { ok: true, message: "이미 평소대로예요" };

    // 되돌아갈 곳 = 평소 자리 — 그 회차가 마감이면 못 돌아가고(지금 회차가 마감인 건 상관없다),
    // 그날 반대 방향과도 짝 규칙을 지켜야 한다.
    const [closed, back, other] = await Promise.all([
      closedStopsMessage(admin, ctx, state.regularStopIds),
      stopPoint(admin, tenantId, state.regularStopIds[0] ?? null),
      stopPoint(admin, tenantId, effectiveStopId(states[otherDirection(ctx.ioKind)])),
    ]);
    if (closed) return { error: closed };
    const pair = back ? ridePairConflict(ctx.ioKind, back, other) : null;
    if (pair) return { error: `평소 자리로 되돌릴 수 없어요 — ${pair}` };

    await cancelAll(admin, ctx, [state.skip, state.add]);
    const revived = await reviveAbsentOut(admin, ctx, states.out);
    await logActionAs(
      { tenantId, actorName: ctx.actorName },
      {
        action: "shuttle_ride_exception_clear",
        targetType: "shuttle",
        metadata: { onDate: ctx.onDate, studentId: ctx.studentId, ioKind: ctx.ioKind, revivedOut: revived, by: "parent" },
      },
    );
    refreshRideViews();
    return { ok: true, message: revived ? "평소대로 되돌렸어요 · 하원도 다시 타요" : "평소 타는 곳으로 되돌렸어요" };
  } catch (e) {
    reportError(e, { scope: "shuttle.parentResetRide", onDate: ctx.onDate });
    return { error: "되돌리지 못했어요. 잠시 뒤 다시 시도해 주세요" };
  }
}

/**
 * 그 방향에 '타지 않기'를 건다 — 걸려 있던 '여기서 탐'은 지운다. 성공하면 true, 못 걸면 안내 문구.
 * 🔑 마감 = **지금 타는 회차** 출발 10분 전 — 이미 떠난 차에서 빠질 수는 없다. 이미 탔으면 못 건다.
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
      tenant_id: ctx.viewer.tenantId,
      on_date: ctx.onDate,
      student_id: ctx.studentId,
      kind: "skip",
      io_kind: ctx.ioKind,
      run_stop_id: null,
      memo,
      created_by: null,
      actor_kind: "parent",
      actor_name: ctx.actorName,
      parent_account_id: ctx.viewer.parentAccountId,
    },
    { onConflict: "tenant_id,on_date,student_id,kind,io_kind" },
  );
  if (error) throw error;
  return true;
}

/**
 * 그날 그 방향을 **타지 않는다**('등원만/하원만 타지 않기', 사용자 2026-09-29).
 * 🔑 사유는 **필수**(짧게라도) — 줄의 `memo`로 남아 직원 화면·이력 장부에서 보인다(학부모 문장엔 안 싣는다).
 * 다시 타려면 모달에서 시간을 고르거나 '평소 타는 곳으로 되돌리기'(둘 다 이 줄을 지운다).
 */
export async function skipParentRide(input: {
  studentId: string;
  onDate: string;
  ioKind: string;
  reason: string;
}): Promise<ParentRideActionState> {
  const ctx = await parentGate(input);
  if ("error" in ctx) return ctx;
  const reason = checkReason(input.reason);
  if (typeof reason !== "string") return reason;
  const admin = createAdminClient();
  try {
    const applied = await applySkip(admin, ctx, reason);
    if (applied !== true) return { error: applied };

    await logActionAs(
      { tenantId: ctx.viewer.tenantId, actorName: ctx.actorName },
      {
        action: "shuttle_ride_exception_set",
        targetType: "shuttle",
        metadata: { onDate: ctx.onDate, studentId: ctx.studentId, kind: "skip", ioKind: ctx.ioKind, reason, by: "parent" },
      },
    );
    refreshRideViews();
    return { ok: true, message: `${DIRECTION_WORD[ctx.ioKind]}하지 않는 것으로 저장했어요` };
  } catch (e) {
    reportError(e, { scope: "shuttle.parentSkipRide", onDate: ctx.onDate });
    return { error: "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요" };
  }
}

/**
 * **결석** — 그날 등원·하원 **둘 다** 타지 않는다(사용자 2026-09-29). 사유 필수, 두 줄 모두 사유 앞에 "결석 · ".
 * 🔑 방향마다 따로 건다 — 이미 떠난 방향·이미 탄 방향·그날 탈 일이 없는 방향은 건너뛰고 나머지만 건다(둘 다 못 걸면 안내).
 *    두 방향은 서로 다른 줄이라 **함께** 건다.
 * ⚠️ 셔틀만이다 — 출결(출석부)의 결석은 건드리지 않는다(0229a 원칙: 셔틀 예외와 출결은 다른 사실).
 */
export async function absentParentRide(input: {
  studentId: string;
  onDate: string;
  reason: string;
}): Promise<ParentRideActionState> {
  const ctx = await parentGate({ ...input, ioKind: "in" });
  if ("error" in ctx) return ctx;
  const reason = checkReason(input.reason);
  if (typeof reason !== "string") return reason;
  const admin = createAdminClient();
  try {
    const directions = ["in", "out"] as const satisfies readonly Direction[];
    const results = await Promise.all(
      directions.map((ioKind) => applySkip(admin, { ...ctx, ioKind }, `${ABSENT_PREFIX}${reason}`)),
    );
    const done = directions.filter((_, i) => results[i] === true);
    const skipped = results.filter((r): r is string => r !== true);
    if (done.length === 0) return { error: skipped[0] ?? "결석으로 바꿀 셔틀 일정이 없어요" };

    await logActionAs(
      { tenantId: ctx.viewer.tenantId, actorName: ctx.actorName },
      {
        action: "shuttle_ride_exception_set",
        targetType: "shuttle",
        metadata: { onDate: ctx.onDate, studentId: ctx.studentId, kind: "skip", ioKinds: done, absent: true, reason, by: "parent" },
      },
    );
    refreshRideViews();
    return {
      ok: true,
      message: done.length === 2 ? "결석으로 저장했어요 · 등원·하원 모두 타지 않아요" : `결석으로 저장했어요 · ${DIRECTION_WORD[done[0]!]}만 타지 않아요`,
    };
  } catch (e) {
    reportError(e, { scope: "shuttle.parentAbsent", onDate: ctx.onDate });
    return { error: "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요" };
  }
}
