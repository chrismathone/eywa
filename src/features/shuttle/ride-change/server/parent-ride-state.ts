import "server-only";

import { revalidatePath } from "next/cache";

import { addDays, kstToday, weekdayIndexOf } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { dayCodeOf } from "../../roster";
import { isDirection, type Direction } from "../../types";
import { PARENT_PORTAL_UNAVAILABLE_MESSAGE, parentPortalAvailable } from "../../parent/server/parent-availability";
import { getParentViewer } from "../../parent/server/parent-viewer";

/**
 * 학부모 등하원 변경의 **공용 재료** — 게이트가 만든 문맥(`Ctx`), 그날 상태 읽기, 취소, 화면 갱신.
 * 서버 액션 파일(`parent-ride-actions.ts` · `parent-regular-ride-actions.ts`)과 확인 모듈(`parent-ride-guards.ts`)이 함께 쓴다.
 * ⚠️ 일반 서버 모듈이다(`"use server"` 아님) — 동기 함수·상수를 내보내야 해서([[#119]]).
 */

export type ParentRideActionState = { ok: true; message: string } | { error: string };
export type Admin = ReturnType<typeof createAdminClient>;
/**
 * 누가 바꾸나 — 학부모(학부모 화면) / 직원(관리자 · 셔틀 선생님, 셔틀 '오늘 등하원' 화면, 사용자 2026-10-06).
 * 🔑 같은 규칙·같은 저장 경로를 타고 **행위자만** 다르다 — 줄의 `actor_kind`·이력 장부(0321a)가 둘을 가른다.
 */
export type RideActor =
  | { kind: "parent"; parentAccountId: string; userId: null }
  | { kind: "staff"; parentAccountId: null; userId: string };
export type Ctx = { tenantId: string; studentId: string; onDate: string; ioKind: Direction; actorName: string; actor: RideActor };
/** 이력 장부·취소 함수에 넘기는 행위자 id(학부모 계정 id / 직원 id). */
export const actorIdOf = (a: RideActor) => (a.kind === "parent" ? a.parentAccountId : a.userId);

/** 미리 바꿀 수 있는 기간 — 월별 변경까지 염두에 둔 두 달. */
const MAX_AHEAD_DAYS = 62;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const DIRECTION_WORD: Record<Direction, string> = { in: "등원", out: "하원" };
/** 결석으로 건 '타지 않기'의 사유 머리 — 한 방향만 건 '타지 않기'와 가른다(직원 화면엔 "사유: 결석 · 감기"). */
export const ABSENT_PREFIX = "결석 · ";

export const otherDirection = (d: Direction): Direction => (d === "in" ? "out" : "in");

/**
 * 🔴 학부모 세션은 RLS로 아무것도 못 쓴다 — service_role로 쓰되 **모든 값을 서버에서 다시 확인한다**([[#77]]):
 * 아이 = `getParentViewer()`의 연결된 아이만(폼의 학생 id를 믿지 않는다) · 날짜 = 오늘 ~ 62일 뒤의 **평일**.
 */
export async function parentGate(input: { studentId: string; onDate: string; ioKind: string }): Promise<Ctx | { error: string }> {
  const viewer = await getParentViewer();
  if (!viewer) return { error: "학부모 로그인이 필요해요" };
  // 탑승 변경·결석·정기 변경 쓰기는 모두 이 문을 공유한다. 화면을 감추는 것만으로는 직접 액션 호출을 못 막는다.
  if (!(await parentPortalAvailable(viewer))) return { error: PARENT_PORTAL_UNAVAILABLE_MESSAGE };
  const child = viewer.children.find((c) => c.id === input.studentId);
  if (!child) return { error: "연결된 자녀가 아니에요" };
  if (!isDirection(input.ioKind)) return { error: "등원/하원을 확인해 주세요" };
  if (!YMD.test(input.onDate)) return { error: "날짜를 확인해 주세요" };
  const today = kstToday();
  if (input.onDate < today) return { error: "지난 날짜는 바꿀 수 없어요" };
  if (input.onDate > addDays(today, MAX_AHEAD_DAYS)) return { error: `${MAX_AHEAD_DAYS}일 뒤까지만 미리 바꿀 수 있어요` };
  const dow = weekdayIndexOf(input.onDate);
  if (dow === 0 || dow === 6) return { error: "주말에는 셔틀을 운영하지 않아요" };
  return {
    tenantId: viewer.tenantId,
    studentId: child.id,
    onDate: input.onDate,
    ioKind: input.ioKind,
    actorName: `학부모 · ${viewer.displayName}`,
    actor: { kind: "parent", parentAccountId: viewer.parentAccountId, userId: null },
  };
}

type ExceptionRow = { id: string; run_stop_id: string | null; memo: string | null };
export type RideState = { regularStopIds: string[]; add: ExceptionRow | null; skip: ExceptionRow | null };

/**
 * 그 아이·날짜의 **등원·하원 두 방향 상태를 한 번에** — 평소 자리(요일 규칙), '여기서 탐'(add) · '타지 않기'(skip).
 * 🔑 두 방향을 따로 읽지 않는다 — 짝 규칙(반대 방향)과 결석 하원 되살리기가 같은 재료를 쓰므로 왕복 2번이면 된다(B4).
 */
export async function loadStates(admin: Admin, ctx: Ctx): Promise<Record<Direction, RideState>> {
  const tenantId = ctx.tenantId;
  const [ridersRes, exceptionsRes] = await Promise.all([
    admin.from("shuttle_riders").select("io_kind, run_stop_id, weekdays")
      .eq("tenant_id", tenantId).eq("student_id", ctx.studentId).limit(40),
    admin.from("shuttle_ride_exceptions").select("id, kind, io_kind, run_stop_id, memo")
      .eq("tenant_id", tenantId).eq("student_id", ctx.studentId).eq("on_date", ctx.onDate),
  ]);
  for (const res of [ridersRes, exceptionsRes]) if (res.error) throw res.error;

  const day = dayCodeOf(ctx.onDate);
  const stateOf = (io: Direction): RideState => {
    const exceptions = (exceptionsRes.data ?? []).filter((e) => e.io_kind === io);
    return {
      regularStopIds: (ridersRes.data ?? [])
        .filter((r) => r.io_kind === io && ((r.weekdays ?? []) as string[]).includes(day))
        .map((r) => r.run_stop_id as string),
      add: (exceptions.find((e) => e.kind === "add") ?? null) as ExceptionRow | null,
      skip: (exceptions.find((e) => e.kind === "skip") ?? null) as ExceptionRow | null,
    };
  };
  return { in: stateOf("in"), out: stateOf("out") };
}

/** 그날 그 방향이 실제로 타는 칸 — '타지 않기'면 없음, '여기서 탐'이 있으면 그 칸, 아니면 평소 자리. */
export function effectiveStopId(state: RideState): string | null {
  if (state.skip) return null;
  return state.add?.run_stop_id ?? state.regularStopIds[0] ?? null;
}

/** 변경 줄 하나 취소 — 취소 함수로 지워야 이력 장부에 행위자(학부모/직원)가 남는다(0321a). */
async function cancel(admin: Admin, ctx: Ctx, exceptionId: string) {
  const { error } = await admin.rpc("cancel_shuttle_ride_exception", {
    p_tenant_id: ctx.tenantId,
    p_id: exceptionId,
    p_actor_kind: ctx.actor.kind,
    p_actor_id: actorIdOf(ctx.actor),
    p_actor_name: ctx.actorName,
  });
  if (error) throw error;
}

/** 걸려 있는 변경 줄 지우기(여기서 탐 · 타지 않기). 각 줄은 서로 독립이라 함께 보낸다. */
export async function cancelAll(admin: Admin, ctx: Ctx, rows: ({ id: string } | null)[]) {
  await Promise.all(rows.filter((r): r is { id: string } => !!r).map((r) => cancel(admin, ctx, r.id)));
}

/**
 * 결석 뒤 **등원을 다시 살리면 하원도 살린다**(사용자 2026-09-29 "등원을 수정하면 하원 시간을 그대로 살리고") —
 * 학원에 오면 집에도 가야 한다. 반대로 하원만 살리면 등원은 잠긴 그대로다.
 * 🔴 **결석으로 잠긴 하원만** 푼다 — 따로 건 '하원만 타지 않기'(사유 머리 없음)는 학부모의 다른 결정이라 둔다.
 * @param outState 이미 읽어 둔 하원 상태(`loadStates`) — 다시 읽지 않는다.
 * @returns 하원을 풀었으면 true.
 */
export async function reviveAbsentOut(admin: Admin, ctx: Ctx, outState: RideState): Promise<boolean> {
  if (ctx.ioKind !== "in") return false;
  if (!outState.skip?.memo?.startsWith(ABSENT_PREFIX)) return false;
  await cancel(admin, { ...ctx, ioKind: "out" }, outState.skip.id);
  return true;
}

/** 학부모가 바꾸면 보는 화면 넷이 같이 바뀐다. */
export function refreshRideViews() {
  revalidatePath("/parent/rides");
  revalidatePath("/shuttle/today");
  revalidatePath("/shuttle/live");
  revalidatePath("/shuttle/parent-rides");
  // 탑승 학생 시간표도 그 주 그날만 변경을 보여 준다(사용자 2026-11-04).
  revalidatePath("/shuttle/classes");
}
