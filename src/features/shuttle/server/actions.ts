"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { isBoardingStatus, isDirection, isSeason, SHUTTLE_DAYS, type DayCode } from "../types";
import { canRecordBoarding } from "./record-gate";

/**
 * 셔틀 쓰기 — 정류장·차량·회차·노선·배정·등하원 기록.
 *
 * 🔴 **게이트가 둘이고 축이 다르다** — 섞지 말 것:
 *   · `gate()`       = 편성(정류장·차량·회차·노선·배정) — `canWriteTenant("shuttle")` = 사무실 full.
 *   · `recordGate()` = 등하원 **기록** — [`canRecordBoarding`](./record-gate.ts)(사무실 ∪ 셔틀 체크 계정 ∪ super_admin).
 *   실측(2026-08-19) 셔틀 선생님은 역할이 `viewer`라, 기록까지 사무실 권한을 요구하면 정작 차에
 *   타는 사람이 아무것도 못 찍는다. 반대로 편성을 열면 viewer가 학생 동선을 바꿀 수 있다.
 *   새 액션을 더할 땐 **어느 축인지 먼저 정하고** 그 게이트를 쓸 것.
 *
 * 화면도 **같은 함수**를 본다([[#77]] — UI 조건은 게이트가 아니다).
 * 쓰기는 service_role 전용(0225a는 읽기 정책만) → ⚠️ admin은 RLS를 우회하므로 **모든 쿼리에
 * tenant_id 명시 필터**([[#104]]). 조회 후 수정하는 경로는 대상 행의 tenant까지 확인한다.
 *
 * 🔴 학생 레코드를 바꾸지 않는다 — 셔틀은 배정·기록만 만진다(퇴원·상태 변경은 students 게이트).
 */

export type ShuttleActionState = { ok?: true; error?: string; notice?: string } | undefined;

const MAX_STOP_NAME = 80;
const MAX_VEHICLE_NAME = 40;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

type Ctx = { tenantId: string; userId: string };

/** 공용 게이트 — 통과하면 tenant/user, 아니면 한글 사유. */
async function gate(): Promise<Ctx | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "shuttle"))) {
    return { error: "셔틀 편성을 수정할 권한이 없습니다" };
  }
  return { tenantId: user.tenantId, userId: user.id };
}

/**
 * 등하원 **기록** 게이트 — 편성(`gate`)과 다른 축이다. 셔틀 선생님(viewer)이 차에서 찍는 동작이라
 * 사무실 권한을 요구하면 정작 쓸 사람이 못 쓴다(record-gate.ts 머리 주석).
 */
async function recordGate(): Promise<Ctx | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canRecordBoarding())) {
    return { error: "셔틀 등하원을 기록할 권한이 없습니다" };
  }
  return { tenantId: user.tenantId, userId: user.id };
}

function refresh() {
  revalidatePath("/shuttle");
  revalidatePath("/shuttle/today");
}

/** PostgREST 에러를 한글로 — raw 원문을 화면에 그대로 내보내지 않는다(CLAUDE.md 반복 지적). */
function friendly(error: { code?: string; message?: string }, fallback: string): string {
  if (error.code === "23505") return "이미 같은 이름/자리가 있습니다";
  if (error.code === "23503") return "다른 곳에서 쓰고 있어 처리할 수 없습니다";
  return fallback;
}

// ── 정류장 마스터 ──────────────────────────────────────────────────────────────────────

export async function createStop(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const name = String(formData.get("name") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  if (!name) return { error: "정류장 이름을 입력하세요" };
  if (name.length > MAX_STOP_NAME) return { error: `정류장 이름은 ${MAX_STOP_NAME}자까지입니다` };

  const admin = createAdminClient();
  const { error } = await admin
    .from("shuttle_stops")
    .insert({ tenant_id: ctx.tenantId, name, memo });
  if (error) return { error: friendly(error, "정류장을 추가하지 못했습니다") };

  await logAction({ action: "shuttle_stop_create", targetType: "shuttle", metadata: { name } });
  refresh();
  return { ok: true };
}

export async function updateStop(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  if (!id) return { error: "정류장을 찾지 못했습니다" };
  if (!name) return { error: "정류장 이름을 입력하세요" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("shuttle_stops")
    .update({ name, memo })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendly(error, "정류장을 수정하지 못했습니다") };

  await logAction({ action: "shuttle_stop_update", targetType: "shuttle", metadata: { stopId: id, name } });
  refresh();
  return { ok: true };
}

/**
 * 정류장 접기(삭제 아님) — 지난 등하원 기록이 이 행을 참조하므로 실제 삭제는 하지 않는다.
 * 노선이 아직 쓰고 있으면 거절한다(FK가 restrict라 어차피 실패하지만, 한글 사유를 먼저 준다).
 */
export async function archiveStop(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "정류장을 찾지 못했습니다" };

  const admin = createAdminClient();
  // 세거나 판단하는 쿼리 = head+count(행을 안 받는다, B2).
  const { count, error: cntErr } = await admin
    .from("shuttle_run_stops")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("stop_id", id);
  if (cntErr) return { error: "정류장 사용 여부를 확인하지 못했습니다" };
  if ((count ?? 0) > 0) {
    return { error: `아직 ${count}개 노선이 이 정류장을 씁니다 — 노선에서 먼저 빼세요` };
  }

  const { error } = await admin
    .from("shuttle_stops")
    .update({ archived: true })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendly(error, "정류장을 정리하지 못했습니다") };

  await logAction({ action: "shuttle_stop_archive", targetType: "shuttle", metadata: { stopId: id } });
  refresh();
  return { ok: true };
}

// ── 차량 ──────────────────────────────────────────────────────────────────────────────

export async function saveVehicle(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim();
  const driverName = String(formData.get("driverName") ?? "").trim() || null;
  const driverPhone = String(formData.get("driverPhone") ?? "").trim() || null;
  if (!name) return { error: "차량 이름을 입력하세요" };
  if (name.length > MAX_VEHICLE_NAME) return { error: `차량 이름은 ${MAX_VEHICLE_NAME}자까지입니다` };

  const admin = createAdminClient();
  const patch = { name, driver_name: driverName, driver_phone: driverPhone };
  const { error } = id
    ? await admin.from("shuttle_vehicles").update(patch).eq("id", id).eq("tenant_id", ctx.tenantId)
    : await admin.from("shuttle_vehicles").insert({ tenant_id: ctx.tenantId, ...patch });
  if (error) return { error: friendly(error, "차량을 저장하지 못했습니다") };

  await logAction({
    action: id ? "shuttle_vehicle_update" : "shuttle_vehicle_create",
    targetType: "shuttle",
    targetLabel: name,
    metadata: { vehicleId: id },
  });
  refresh();
  return { ok: true };
}

// ── 회차 ──────────────────────────────────────────────────────────────────────────────

export async function createRun(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const season = String(formData.get("season") ?? "term");
  const direction = String(formData.get("direction") ?? "in");
  const label = String(formData.get("label") ?? "").trim() || null;
  if (!vehicleId) return { error: "차량을 고르세요" };
  if (!isSeason(season)) return { error: "학기중/방학중 중에서 고르세요" };
  if (!isDirection(direction)) return { error: "등원/하원 중에서 고르세요" };

  const admin = createAdminClient();
  // 다음 회차 번호 — 마지막 하나만 읽는다(전건 fetch 금지, B2).
  const { data: last, error: lastErr } = await admin
    .from("shuttle_runs")
    .select("run_no")
    .eq("tenant_id", ctx.tenantId)
    .eq("vehicle_id", vehicleId)
    .eq("season", season)
    .order("run_no", { ascending: false })
    .limit(1);
  if (lastErr) return { error: "회차 번호를 계산하지 못했습니다" };
  const runNo = (last?.[0]?.run_no ?? 0) + 1;
  if (runNo > 30) return { error: "회차는 30개까지입니다" };

  const { data, error } = await admin
    .from("shuttle_runs")
    .insert({
      tenant_id: ctx.tenantId,
      vehicle_id: vehicleId,
      season,
      run_no: runNo,
      direction,
      label,
    })
    .select("id")
    .single();
  if (error) return { error: friendly(error, "회차를 추가하지 못했습니다") };

  // 학원 출발/도착 두 칸을 미리 깔아준다 — 모든 회차가 그 사이를 도는 구조라 매번 손으로 만들 이유가 없다.
  const { error: seedErr } = await admin.from("shuttle_run_stops").insert([
    { tenant_id: ctx.tenantId, run_id: data.id, kind: "depart", sort_order: 0 },
    { tenant_id: ctx.tenantId, run_id: data.id, kind: "arrive", sort_order: 1 },
  ]);
  if (seedErr) return { error: "회차는 만들었지만 학원 출발/도착 칸을 넣지 못했습니다" };

  await logAction({ action: "shuttle_run_create", targetType: "shuttle", metadata: { vehicleId, season, runNo } });
  refresh();
  return { ok: true };
}

export async function updateRun(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const label = String(formData.get("label") ?? "").trim() || null;
  if (!id) return { error: "회차를 찾지 못했습니다" };
  if (!isDirection(direction)) return { error: "등원/하원 중에서 고르세요" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("shuttle_runs")
    .update({ direction, label })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendly(error, "회차를 수정하지 못했습니다") };

  await logAction({ action: "shuttle_run_update", targetType: "shuttle", metadata: { runId: id, direction } });
  refresh();
  return { ok: true };
}

export async function deleteRun(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "회차를 찾지 못했습니다" };

  const admin = createAdminClient();
  // 노선 칸·배정은 cascade로 함께 지워진다. 등하원 기록은 run_id가 null로 풀리며 **남는다**
  // (스냅샷 라벨이 있어 계속 읽힌다 — 0225a 설계).
  const { error } = await admin
    .from("shuttle_runs")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendly(error, "회차를 삭제하지 못했습니다") };

  await logAction({ action: "shuttle_run_delete", targetType: "shuttle", metadata: { runId: id } });
  refresh();
  return { ok: true };
}

// ── 노선(회차의 정류장) ────────────────────────────────────────────────────────────────

export async function addRunStop(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const runId = String(formData.get("runId") ?? "");
  const stopId = String(formData.get("stopId") ?? "");
  if (!runId || !stopId) return { error: "회차와 정류장을 고르세요" };

  const admin = createAdminClient();
  // 학원 도착 바로 앞에 끼운다(정류장은 출발과 도착 사이를 돈다).
  const { data: rows, error: readErr } = await admin
    .from("shuttle_run_stops")
    .select("id, kind, sort_order")
    .eq("tenant_id", ctx.tenantId)
    .eq("run_id", runId)
    .order("sort_order")
    .limit(200);
  if (readErr) return { error: "노선을 읽지 못했습니다" };

  const arrive = (rows ?? []).find((r) => r.kind === "arrive");
  const insertAt = arrive ? arrive.sort_order : (rows?.length ?? 0);

  const { error } = await admin
    .from("shuttle_run_stops")
    .insert({ tenant_id: ctx.tenantId, run_id: runId, kind: "stop", stop_id: stopId, sort_order: insertAt });
  if (error) {
    if (error.code === "23505") return { error: "이 회차에 이미 있는 정류장입니다" };
    return { error: friendly(error, "정류장을 노선에 넣지 못했습니다") };
  }
  // 도착 칸을 뒤로 밀어 순서를 유지.
  if (arrive) {
    await admin
      .from("shuttle_run_stops")
      .update({ sort_order: insertAt + 1 })
      .eq("id", arrive.id)
      .eq("tenant_id", ctx.tenantId);
  }

  await logAction({ action: "shuttle_run_stop_add", targetType: "shuttle", metadata: { runId, stopId } });
  refresh();
  return { ok: true };
}

export async function updateRunStopTime(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("atTime") ?? "").trim();
  if (!id) return { error: "노선 칸을 찾지 못했습니다" };
  if (raw && !HM.test(raw)) return { error: "시각은 13:46 형식으로 입력하세요" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("shuttle_run_stops")
    .update({ at_time: raw || null })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendly(error, "시각을 저장하지 못했습니다") };

  refresh();
  return { ok: true };
}

export async function removeRunStop(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "노선 칸을 찾지 못했습니다" };

  const admin = createAdminClient();
  // 배정된 학생이 있으면 함께 사라진다 — 몇 명인지 먼저 알려주기 위해 세어둔다(head+count, B2).
  const { count } = await admin
    .from("shuttle_riders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("run_stop_id", id);

  const { error } = await admin
    .from("shuttle_run_stops")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendly(error, "정류장을 노선에서 빼지 못했습니다") };

  await logAction({ action: "shuttle_run_stop_remove", targetType: "shuttle", metadata: { runStopId: id, riders: count ?? 0 } });
  refresh();
  return (count ?? 0) > 0 ? { ok: true, notice: `배정 ${count}명도 함께 해제됐습니다` } : { ok: true };
}

/**
 * 드래그로 바뀐 정류장 순서를 저장 — 한 회차의 **전체 순서를 통째로** 다시 쓴다.
 * ⚠️ sort_order에 유니크가 없는 이유가 여기다(중간 상태에서 반드시 충돌한다, 0225a 주석).
 */
export async function reorderRunStops(runId: string, orderedIds: string[]): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  if (!runId || orderedIds.length === 0) return { error: "순서를 읽지 못했습니다" };
  if (orderedIds.length > 200) return { error: "한 회차의 정류장이 너무 많습니다" };

  const admin = createAdminClient();
  // 넘어온 id가 정말 이 회차·이 테넌트의 것인지 확인 — 클라가 보낸 id를 그대로 믿지 않는다.
  const { data: owned, error: readErr } = await admin
    .from("shuttle_run_stops")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("run_id", runId)
    .limit(200);
  if (readErr) return { error: "노선을 읽지 못했습니다" };
  const ownedSet = new Set((owned ?? []).map((r) => r.id));
  if (orderedIds.some((id) => !ownedSet.has(id))) return { error: "이 회차의 노선이 아닙니다" };

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      admin
        .from("shuttle_run_stops")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("tenant_id", ctx.tenantId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: friendly(failed.error, "순서를 저장하지 못했습니다") };

  refresh();
  return { ok: true };
}

// ── 배정(정기 탑승) ────────────────────────────────────────────────────────────────────

function parseWeekdays(raw: FormDataEntryValue | null): DayCode[] {
  const parts = String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const set = new Set(parts);
  return SHUTTLE_DAYS.filter((d) => set.has(d));
}

/**
 * 학생을 정류장에 배정(드래그 드롭의 착지점). 이미 있으면 요일만 갱신한다 —
 * 드래그를 두 번 했다고 에러를 띄우면 손이 멈춘다.
 */
export async function assignRider(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const runStopId = String(formData.get("runStopId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const ioKind = String(formData.get("ioKind") ?? "");
  const weekdays = parseWeekdays(formData.get("weekdays"));
  if (!runStopId || !studentId) return { error: "정류장과 학생을 고르세요" };
  if (!isDirection(ioKind)) return { error: "승차/하차 중에서 고르세요" };
  if (weekdays.length === 0) return { error: "요일을 하나 이상 고르세요" };

  const admin = createAdminClient();
  // 학원(출발/도착) 칸에는 학생을 붙이지 않는다 — 붙이면 명단이 두 번 세어진다.
  const { data: target, error: readErr } = await admin
    .from("shuttle_run_stops")
    .select("id, kind")
    .eq("id", runStopId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (readErr || !target) return { error: "정류장을 찾지 못했습니다" };
  if (target.kind !== "stop") return { error: "학원 출발·도착 칸에는 학생을 배정하지 않습니다" };

  const { error } = await admin.from("shuttle_riders").upsert(
    {
      tenant_id: ctx.tenantId,
      run_stop_id: runStopId,
      student_id: studentId,
      io_kind: ioKind,
      weekdays,
    },
    { onConflict: "run_stop_id,student_id,io_kind" },
  );
  if (error) return { error: friendly(error, "학생을 배정하지 못했습니다") };

  await logAction({ action: "shuttle_rider_assign", targetType: "shuttle", metadata: { runStopId, studentId, ioKind, weekdays } });
  refresh();
  return { ok: true };
}

export async function updateRiderWeekdays(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "");
  const weekdays = parseWeekdays(formData.get("weekdays"));
  if (!id) return { error: "배정을 찾지 못했습니다" };
  // 마지막 요일을 끄면 "아무 요일도 안 탐"이 되는데 그건 배정을 지우는 것과 같다(0225a check 제약).
  if (weekdays.length === 0) return { error: "요일을 모두 끄려면 배정을 삭제하세요" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("shuttle_riders")
    .update({ weekdays })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendly(error, "요일을 저장하지 못했습니다") };

  refresh();
  return { ok: true };
}

export async function removeRider(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "배정을 찾지 못했습니다" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("shuttle_riders")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendly(error, "배정을 해제하지 못했습니다") };

  await logAction({ action: "shuttle_rider_remove", targetType: "shuttle", metadata: { riderId: id } });
  refresh();
  return { ok: true };
}

/** 드래그로 학생을 다른 정류장으로 옮김 — 배정 한 건의 착지점만 바꾼다. */
export async function moveRider(riderId: string, toRunStopId: string): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  if (!riderId || !toRunStopId) return { error: "옮길 대상을 찾지 못했습니다" };

  const admin = createAdminClient();
  const { data: target, error: readErr } = await admin
    .from("shuttle_run_stops")
    .select("id, kind")
    .eq("id", toRunStopId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (readErr || !target) return { error: "정류장을 찾지 못했습니다" };
  if (target.kind !== "stop") return { error: "학원 출발·도착 칸에는 학생을 배정하지 않습니다" };

  const { error } = await admin
    .from("shuttle_riders")
    .update({ run_stop_id: toRunStopId })
    .eq("id", riderId)
    .eq("tenant_id", ctx.tenantId);
  if (error) {
    if (error.code === "23505") return { error: "그 정류장에 이미 배정된 학생입니다" };
    return { error: friendly(error, "학생을 옮기지 못했습니다") };
  }

  await logAction({ action: "shuttle_rider_move", targetType: "shuttle", metadata: { riderId, toRunStopId } });
  refresh();
  return { ok: true };
}

// ── 등하원 기록 (원장 "셔틀 등하원 기록도 모두 DB화") ────────────────────────────────

/**
 * 그날 그 학생의 탑승 상태를 찍는다. 같은 (날짜·학생·회차·승하차)를 다시 찍으면 덮어쓴다
 * (오클릭 복구 — 되돌릴 문을 잠그지 않는다, [[#103]]).
 *
 * 차량·정류장 **이름을 스냅샷**으로 함께 저장한다 → 나중에 노선을 고쳐도 지난 기록이 그대로 읽힌다.
 */
export async function recordBoarding(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await recordGate();
  if ("error" in ctx) return ctx;
  const boardedOn = String(formData.get("boardedOn") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const runId = String(formData.get("runId") ?? "");
  const runStopId = String(formData.get("runStopId") ?? "") || null;
  const ioKind = String(formData.get("ioKind") ?? "");
  const status = String(formData.get("status") ?? "");
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (!YMD.test(boardedOn)) return { error: "날짜를 확인하세요" };
  if (!studentId || !runId) return { error: "학생과 회차를 고르세요" };
  if (!isDirection(ioKind)) return { error: "승차/하차 중에서 고르세요" };
  if (!isBoardingStatus(status)) return { error: "탑승 상태를 고르세요" };

  const admin = createAdminClient();
  // 스냅샷 재료 — 회차(차량 이름·회차번호)와 정류장 이름. 없으면 null로 두고 기록은 남긴다.
  const [runRes, stopRes] = await Promise.all([
    admin
      .from("shuttle_runs")
      .select("run_no, vehicle:shuttle_vehicles!shuttle_runs_vehicle_id_fkey(name)")
      .eq("id", runId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle(),
    runStopId
      ? admin
          .from("shuttle_run_stops")
          .select("stop_id, stop:shuttle_stops!shuttle_run_stops_stop_id_fkey(name)")
          .eq("id", runStopId)
          .eq("tenant_id", ctx.tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (!runRes.data) return { error: "회차를 찾지 못했습니다" };

  const vehicle = runRes.data.vehicle as { name?: string } | null;
  const stopRow = stopRes.data as { stop_id?: string | null; stop?: { name?: string } | null } | null;

  const { error } = await admin.from("shuttle_boardings").upsert(
    {
      tenant_id: ctx.tenantId,
      boarded_on: boardedOn,
      student_id: studentId,
      run_id: runId,
      stop_id: stopRow?.stop_id ?? null,
      vehicle_label: vehicle?.name ?? null,
      stop_label: stopRow?.stop?.name ?? null,
      run_no: runRes.data.run_no,
      io_kind: ioKind,
      status,
      memo,
      recorded_by: ctx.userId,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,boarded_on,student_id,run_id,io_kind" },
  );
  if (error) return { error: friendly(error, "탑승 기록을 저장하지 못했습니다") };

  await logAction({ action: "shuttle_boarding_record", targetType: "shuttle", metadata: { boardedOn, studentId, runId, status } });
  refresh();
  return { ok: true };
}

/** 잘못 찍은 기록 지우기 — 상태를 '탑승'으로 되돌리는 게 아니라 아예 안 찍은 상태로. */
export async function clearBoarding(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await recordGate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "기록을 찾지 못했습니다" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("shuttle_boardings")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendly(error, "기록을 지우지 못했습니다") };

  await logAction({ action: "shuttle_boarding_clear", targetType: "shuttle", metadata: { boardingId: id } });
  refresh();
  return { ok: true };
}
