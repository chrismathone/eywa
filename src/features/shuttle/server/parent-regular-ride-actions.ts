"use server";

import { revalidatePath } from "next/cache";

import { addDays, kstToday } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { logActionAs } from "@/features/audit/server/log";
import { ridePairConflict } from "../parent-rides";
import { dayCodeOf } from "../roster";
import { dayLabel, type DayCode } from "../types";
import { checkReason, checkStop, regularClosedMessage, regularStopsOn, stopPoint } from "./parent-ride-guards";
import {
  DIRECTION_WORD,
  otherDirection,
  parentGate,
  refreshRideViews,
  type ParentRideActionState,
} from "./parent-ride-state";

const WEEKDAYS: readonly DayCode[] = ["mon", "tue", "wed", "thu", "fri"];

/**
 * 학부모 **고정 시간 변경** — 그 요일의 정기 배정(매주 반복)을 다른 회차·정류장으로 옮긴다(사용자 2026-09-29). 사유 필수.
 * (그날 하루만 바꾸는 것은 `parent-ride-actions.ts`.)
 *
 * 🔑 요일 **하나만** 옮긴다(월~금 배정 중 수요일만 등). 실제 이동·이력은 DB 함수 `change_shuttle_regular_ride`(0322a)가
 *    한 트랜잭션으로 한다 — 이력(전/후 · 사유 · 학부모)은 직원 화면에서 보인다.
 * 🔑 이번 주에 이미 지난 요일도 바꿀 수 있다(사용자 2026-09-30) — 게이트 날짜는 그 요일의 **다음** 날짜라 다음 그 요일부터 적용.
 * 🔑 **그 요일이 오늘이면 이미 출발한(10분 전 지난) 회차로는 못 옮기고**, 지금 고정 회차가 이미 출발했어도 오늘 운행이
 *    끝날 때까지 막는다(사용자 2026-09-30). 오늘 **모든 회차가 끝나면** 다시 전부 고를 수 있다. 판정 = `regularRunClosed`.
 * 🔑 짝 규칙(사용자 2026-09-30) — 그 요일의 **반대 방향 고정 자리**와 같은 회차 금지 · 등원이 하원보다 빨라야.
 * ⚠️ 날짜 하루짜리 변경('그날만'·'타지 않기')이 걸린 날은 그 변경이 여전히 이긴다.
 * ⚡ 확인은 두 단계로 함께 돌린다(B4): ① 자리 · 두 방향 고정 자리 → ② 마감 · 반대 방향 자리.
 */
export async function changeRegularRide(input: {
  studentId: string;
  weekday: string;
  ioKind: string;
  runStopId: string;
  reason: string;
}): Promise<ParentRideActionState> {
  if (!WEEKDAYS.includes(input.weekday as DayCode)) return { error: "월~금 중에서 골라 주세요" };
  const weekday = input.weekday as DayCode;
  // 그 요일의 가장 가까운 날(오늘 포함) — 게이트(자녀·방향·평일) 확인과 '오늘인가' 판정에만 쓴다.
  const today = kstToday();
  const onDate = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, i)).find((d) => dayCodeOf(d) === weekday)!;
  const ctx = await parentGate({ studentId: input.studentId, onDate, ioKind: input.ioKind });
  if ("error" in ctx) return ctx;
  const reason = checkReason(input.reason);
  if (typeof reason !== "string") return reason;
  const tenantId = ctx.tenantId;
  const admin = createAdminClient();
  try {
    const [stop, regular] = await Promise.all([
      checkStop(admin, tenantId, input.runStopId),
      regularStopsOn(admin, tenantId, ctx.studentId, weekday),
    ]);
    if ("error" in stop) return stop;

    const [closed, other] = await Promise.all([
      regularClosedMessage(admin, tenantId, stop.runId, regular[ctx.ioKind], onDate),
      stopPoint(admin, tenantId, regular[otherDirection(ctx.ioKind)][0] ?? null),
    ]);
    if (closed) return { error: closed };
    const pair = ridePairConflict(ctx.ioKind, { runId: stop.runId, time: stop.time }, other);
    if (pair) return { error: pair };

    const { data, error } = await admin.rpc("change_shuttle_regular_ride", {
      p_tenant_id: tenantId,
      p_student_id: ctx.studentId,
      p_io_kind: ctx.ioKind,
      p_weekday: weekday,
      p_run_stop_id: stop.id,
      p_reason: reason,
      p_actor_kind: "parent",
      p_actor_id: ctx.actor.parentAccountId,
      p_actor_name: ctx.actorName,
    });
    if (error) throw error;
    if (data === "same") return { ok: true, message: "이미 그 시간이 고정 시간이에요" };

    await logActionAs(
      { tenantId, actorName: ctx.actorName },
      {
        action: "shuttle_rider_move",
        targetType: "shuttle",
        metadata: { studentId: ctx.studentId, weekday, ioKind: ctx.ioKind, runStopId: stop.id, reason, by: "parent" },
      },
    );
    refreshRideViews();
    revalidatePath("/shuttle");
    return { ok: true, message: `매주 ${dayLabel(weekday)}요일 ${DIRECTION_WORD[ctx.ioKind]} 고정 시간을 바꿨어요` };
  } catch (e) {
    reportError(e, { scope: "shuttle.parentRegularRide", weekday });
    return { error: "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요" };
  }
}
