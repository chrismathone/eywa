"use server";

import { revalidatePath } from "next/cache";
import { phoneLabel } from "@/lib/format/phone";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import {
  isBoardingStatus,
  isDirection,
  isRideExceptionKind,
  isSeason,
  SHUTTLE_DAYS,
  type DayCode,
} from "../types";
import { canRecordBoarding } from "./record-gate";
import { explainDbError, logDbError } from "@/lib/supabase/db-error";
import { runNotOpenMessage } from "../today/server/trip-open-guard";
import { endTripUncheckedMessage } from "../today/server/trip-end-guard";
import { isMissingNotifyColumn } from "../parent/notify-column";
import { isMissingActorColumns, isMissingCancelFunction } from "../actor-columns";

/**
 * 셔틀 쓰기 — 정류장·차량·회차·노선·배정·등하원 기록.
 *
 * 🔴 **게이트가 둘이고 축이 다르다** — 섞지 말 것:
 *   · `gate()`       = 편성(정류장·차량·회차·노선·배정) — `canWriteTenant("shuttle")` = 사무실 full.
 *   · `recordGate()` = 등하원 **기록** — [`canRecordBoarding`](./record-gate.ts)(사무실 ∪ '셔틀 담당' 토글 ∪ super_admin).
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

type Ctx = { tenantId: string; userId: string; userName: string };

/**
 * 공용 게이트 — 통과하면 tenant/user, 아니면 한글 사유.
 * 🔑 명의(created_by·recorded_by·started_by·ended_by)는 **화면 주인** — 강사뷰면 검증된 대상(감사로그만 실제 계정).
 */
async function gate(): Promise<Ctx | { error: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "shuttle"))) {
    return { error: "셔틀 편성을 수정할 권한이 없습니다" };
  }
  return { tenantId: user.tenantId, userId: user.id, userName: user.displayName };
}

/**
 * 등하원 **기록** 게이트 — 편성(`gate`)과 다른 축이다. 셔틀 선생님(viewer)이 차에서 찍는 동작이라
 * 사무실 권한을 요구하면 정작 쓸 사람이 못 쓴다(record-gate.ts 머리 주석).
 */
async function recordGate(): Promise<Ctx | { error: string }> {
  // 자격(canRecordBoarding)과 같은 사람으로 명의를 남긴다 — 강사뷰면 검증된 대상(위 gate 주석).
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canRecordBoarding())) {
    return { error: "셔틀 등하원을 기록할 권한이 없습니다" };
  }
  return { tenantId: user.tenantId, userId: user.id, userName: user.displayName };
}

function refresh() {
  revalidatePath("/shuttle");
  revalidatePath("/shuttle/today");
  // 관제(운행 현황)도 같은 사실을 본다 — 빼먹으면 관리자 화면만 옛 값으로 남는다.
  revalidatePath("/shuttle/live");
  // 주간 시간표도 편성 보드를 그대로 읽는다.
  revalidatePath("/shuttle/week");
  // 탑승 학생 시간표도 편성 보드를 읽고 수정 카드로 고친다(사용자 2026-11-04).
  revalidatePath("/shuttle/classes");
}

/** PostgREST 에러를 한글로 — raw 원문을 화면에 그대로 내보내지 않는다(CLAUDE.md 반복 지적). */
function friendly(error: { code?: string; message?: string }, fallback: string): string {
  // 제약 이름별 이유(정류장 이름·회차 번호 등)·로그는 공용 판정([[#138]]). 모르는 제약의 중복·참조는 예전 문구 그대로.
  const why = explainDbError(error, { scope: "shuttle", fallback, context: { action: fallback } });
  if (why.specific) return why.message;
  if (error.code === "23505") return "이미 같은 이름/자리가 있습니다";
  if (error.code === "23503") return "다른 곳에서 쓰고 있어 처리할 수 없습니다";
  return why.message;
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
  if (cntErr) {
    logDbError(cntErr, "shuttle.archiveStop");
    return { error: "정류장 사용 여부를 확인하지 못했습니다" };
  }
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
  const driverPhone = phoneLabel(String(formData.get("driverPhone") ?? ""));
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
  if (lastErr) {
    logDbError(lastErr, "shuttle.createRun");
    return { error: "회차 번호를 계산하지 못했습니다" };
  }
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
  if (seedErr) {
    logDbError(seedErr, "shuttle.createRun");
    return { error: "회차는 만들었지만 학원 출발/도착 칸을 넣지 못했습니다" };
  }

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
  if (readErr) {
    logDbError(readErr, "shuttle.addRunStop");
    return { error: "노선을 읽지 못했습니다" };
  }

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

  await logAction({ action: "shuttle_run_stop_time", targetType: "shuttle", metadata: { runStopId: id, atTime: raw || null } });
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
  if (readErr) {
    logDbError(readErr, "shuttle.reorderRunStops");
    return { error: "노선을 읽지 못했습니다" };
  }
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

  await logAction({ action: "shuttle_run_stop_reorder", targetType: "shuttle", metadata: { runId, stops: orderedIds.length } });
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
  if (readErr || !target) {
    logDbError(readErr, "shuttle.assignRider");
    return { error: "정류장을 찾지 못했습니다" };
  }
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
  const { data: rider, error } = await admin
    .from("shuttle_riders")
    .update({ weekdays })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .select("student_id")
    .maybeSingle();
  if (error) return { error: friendly(error, "요일을 저장하지 못했습니다") };

  if (rider) {
    await logAction({
      action: "shuttle_rider_weekdays",
      targetType: "shuttle",
      metadata: { riderId: id, studentId: (rider.student_id as string | null) ?? null, weekdays },
    });
  }
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
  if (readErr || !target) {
    logDbError(readErr, "shuttle.moveRider");
    return { error: "정류장을 찾지 못했습니다" };
  }
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
 *
 * 🔑 `notify=0`이면 **학부모 알림 없이 기록만**(0368c — 등원 줄의 [저장]). 없거나 그 밖이면 알림 대상([전송]).
 *    매번 이 칸을 같이 보낸다 — 다시 [전송]하면 덮어써 알림 대상으로 돌아온다.
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
  const notifyParent = formData.get("notify") !== "0";

  if (!YMD.test(boardedOn)) return { error: "날짜를 확인하세요" };
  if (!studentId || !runId) return { error: "학생과 회차를 고르세요" };
  if (!isDirection(ioKind)) return { error: "승차/하차 중에서 고르세요" };
  if (!isBoardingStatus(status)) return { error: "탑승 상태를 고르세요" };

  const admin = createAdminClient();
  // 스냅샷 재료 — 회차(차량 이름·회차번호)와 정류장 이름. 없으면 null로 두고 기록은 남긴다.
  // ⚡ 출발 전 열림 규칙(직원은 30분 전, trip-open-guard)·운행 상태도 **같이** 묻는다 — 학생마다 누르는 버튼이라 따로 한 번 더 기다리지 않게.
  const [notOpen, trip, runRes, stopRes] = await Promise.all([
    runNotOpenMessage(admin, ctx.tenantId, runId, boardedOn),
    admin
      .from("shuttle_trips")
      .select("started_at, ended_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("ran_on", boardedOn)
      .eq("run_id", runId)
      .maybeSingle(),
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
  if (notOpen) return { error: notOpen };
  // 🔒 **오늘 기록은 [출발]이 눌린 회차에서만**(사용자 2026-10-07 "탑승 미탑승 하차는 출발이 눌러진 후에만 작동") —
  //    차가 떠나기 전에 찍힌 "탔어요"가 학부모 알림으로 나가면 거짓이 된다. 화면도 버튼을 잠그지만 게이트는 여기다([[#77]]).
  //    ⚠️ 운행 표(0243a)를 못 읽으면(표 없음 등) 막지 않는다([[#95]] — 출발 버튼 자체가 없는 상태다). 지난 날짜 정정도 막지 않는다.
  if (boardedOn === kstToday() && !trip.error && !trip.data?.started_at) {
    return { error: "먼저 이 회차의 [출발]을 누르세요 — 출발한 뒤에 탑승·미탑승·하차를 기록할 수 있습니다" };
  }
  if (trip.data?.ended_at) return { error: TRIP_ENDED_MESSAGE };
  if (!runRes.data) return { error: "회차를 찾지 못했습니다" };

  const vehicle = runRes.data.vehicle as { name?: string } | null;
  const stopRow = stopRes.data as { stop_id?: string | null; stop?: { name?: string } | null } | null;

  const row = {
    tenant_id: ctx.tenantId,
    boarded_on: boardedOn,
    student_id: studentId,
    run_id: runId,
    // 🔴 노선 칸을 모르는 줄('예정에 없던 탑승')에서 누르면 정류장을 **보내지 않는다** — null로 보내면
    //    이미 적혀 있던 정류장 이름(그날 어디서 탔나)을 지운다(2026-09-27 실제로 지워졌다).
    //    upsert는 보낸 칸만 덮으므로 빼면 기존 값이 남는다(새 줄이면 원래대로 비어 있다).
    ...(runStopId ? { stop_id: stopRow?.stop_id ?? null, stop_label: stopRow?.stop?.name ?? null } : {}),
    vehicle_label: vehicle?.name ?? null,
    run_no: runRes.data.run_no,
    io_kind: ioKind,
    status,
    memo,
    notify_parent: notifyParent,
    recorded_by: ctx.userId,
    recorded_at: new Date().toISOString(),
  };
  const onConflict = { onConflict: "tenant_id,boarded_on,student_id,run_id,io_kind" };
  let { error } = await admin.from("shuttle_boardings").upsert(row, onConflict);
  // ⚠️ 0368c(notify_parent) 전 DB면 그 칸만 빼고 다시 저장한다 — 안 그러면 아무도 기록을 못 한다(notify-column.ts).
  //    그때는 [저장]도 알림 대상으로 남는다(칸이 없으니 끌 방법이 없다).
  if (isMissingNotifyColumn(error)) {
    const { notify_parent: _skip, ...withoutNotify } = row;
    void _skip;
    ({ error } = await admin.from("shuttle_boardings").upsert(withoutNotify, onConflict));
  }
  if (error) return { error: friendly(error, "탑승 기록을 저장하지 못했습니다") };

  await logAction({ action: "shuttle_boarding_record", targetType: "shuttle", metadata: { boardedOn, studentId, runId, status, notifyParent } });
  refresh();
  return { ok: true };
}

// ── 일회성 탑승 개입 (원장 "오늘 연락이 와서 갑자기 탄다던지, 안타던지") ─────────────────

/**
 * 그날만의 **예정 변경**을 찍는다(0229a) — 오늘만 탐(`add`) / 오늘만 안 탐(`skip`).
 *
 * 🔴 **기록(`shuttle_boardings`)에 미리 찍지 않는 이유가 여기 있다** — 저 표는 "일어난 일"이라
 *    아침에 미리 `missed`를 넣어 두면 실제로는 탄 아이가 안 탄 걸로 남고, 그 거짓이 출결 신호로
 *    새어나간다. 예정은 예정의 자리에 둔다(0229a 머리 주석).
 *
 * 🔴 게이트는 **편성(`gate`)이 아니라 기록(`recordGate`)** — 이건 편성 수정이 아니라 **오늘의 운영**이고,
 *    전화를 받는 데스크와 차에 타는 셔틀 선생님(실측 역할 `viewer`)이 그 자리에서 찍어야 한다.
 * 🔴 **오늘 이전 날짜는 바꾸지 않는다** — 예외는 "앞으로 이렇게 하자"는 예정이라 지난 날짜에 새로
 *    적을 이유가 없고, 지난 예외는 그날의 기록 일부라 덮어써도 안 된다. 화면도 같은 판정을 하지만
 *    화면 조건은 게이트가 아니므로([[#77]]) 여기서 다시 막는다.
 */
export async function setRideException(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await recordGate();
  if ("error" in ctx) return ctx;
  const onDate = String(formData.get("onDate") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const ioKind = String(formData.get("ioKind") ?? "");
  const runStopId = String(formData.get("runStopId") ?? "") || null;
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (!YMD.test(onDate)) return { error: "날짜를 확인하세요" };
  if (onDate < kstToday()) return { error: "지난 날짜는 바꿀 수 없습니다 — 오늘 이후만 조정합니다" };
  if (!studentId) return { error: "학생을 고르세요" };
  if (!isRideExceptionKind(kind)) return { error: "변경 종류를 고르세요" };
  if (!isDirection(ioKind)) return { error: "등원/하원 중에서 고르세요" };
  if (kind === "add" && !runStopId) {
    // 어디서 타는지 모르면 기사가 못 태운다 — 자리 없는 '추가'는 만들지 않는다.
    return { error: "어디서 타는지(정류장)를 고르세요" };
  }

  const admin = createAdminClient();
  // 🔴 클라가 보낸 id를 그대로 믿지 않는다. **학생까지 확인하는 이유**: `student_id`의 FK는
  //    `students(id)`뿐이라 **다른 학원의 학생 uuid도 FK를 통과한다**(admin은 RLS 우회, [[#104]]).
  //    화면엔 "(삭제된 학생)"으로 보여 티도 안 나므로 여기서 막는다.
  // 서로 독립이라 함께 받는다(B4).
  const [studentRes, stopRes] = await Promise.all([
    admin.from("students").select("id").eq("id", studentId).eq("tenant_id", ctx.tenantId).maybeSingle(),
    kind === "add"
      ? admin
          .from("shuttle_run_stops")
          .select("id, kind")
          .eq("id", runStopId)
          .eq("tenant_id", ctx.tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (studentRes.error || !studentRes.data) return { error: "학생을 찾지 못했습니다" };
  if (kind === "add") {
    const target = stopRes.data as { kind?: string } | null;
    if (stopRes.error || !target) return { error: "정류장을 찾지 못했습니다" };
    if (target.kind !== "stop") return { error: "학원 출발·도착 칸에는 학생을 세우지 않습니다" };
  }

  const base = {
    tenant_id: ctx.tenantId,
    on_date: onDate,
    student_id: studentId,
    kind,
    io_kind: ioKind,
    run_stop_id: kind === "add" ? runStopId : null,
    memo,
    created_by: ctx.userId,
  };
  // ⚠️ 0229a의 유니크가 **부분 인덱스가 아니라서** 이 추론이 된다([[#113]]) — 술어를 붙이면 42P10.
  const onConflict = { onConflict: "tenant_id,on_date,student_id,kind,io_kind" };
  const first = await admin.from("shuttle_ride_exceptions").upsert(
    // 마지막으로 바꾼 사람(0321a) — 트리거가 이력 장부에 그대로 옮긴다. 학부모가 걸었던 줄을 덮으면 직원으로 바뀐다.
    { ...base, actor_kind: "staff", actor_name: ctx.userName, parent_account_id: null },
    onConflict,
  );
  // 0321a 전 DB면 행위자 칸 없이 종전대로 저장한다([[#95]] — 이미 쓰던 기능이 SQL 적용 전에 멈추지 않게).
  const { error } = isMissingActorColumns(first.error)
    ? await admin.from("shuttle_ride_exceptions").upsert(base, onConflict)
    : first;
  if (error) return { error: friendly(error, "오늘 탑승 변경을 저장하지 못했습니다") };

  await logAction({
    action: "shuttle_ride_exception_set",
    targetType: "shuttle",
    metadata: { onDate, studentId, kind, ioKind, runStopId },
  });
  refresh();
  return { ok: true };
}

/**
 * 일회성 변경 되돌리기 — 예외를 지우면 그 줄은 **정기 배정 그대로**로 돌아간다.
 * ⚠️ 여기서 지우는 건 예정뿐이다. 이미 찍힌 등하원 기록은 `clearBoarding`이 따로 지운다.
 */
export async function clearRideException(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await recordGate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "변경 내역을 찾지 못했습니다" };

  const admin = createAdminClient();
  // 지난 날짜의 예외는 그날의 기록 일부라 지우지 않는다(원장 브리프) — 날짜를 먼저 확인한다.
  // ⚠️ admin은 RLS를 우회하므로 tenant 필터가 필수다([[#104]]).
  const { data: target, error: readErr } = await admin
    .from("shuttle_ride_exceptions")
    .select("id, on_date")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (readErr) {
    logDbError(readErr, "shuttle.clearRideException");
    return { error: "변경 내역을 읽지 못했습니다" };
  }
  if (!target) return { error: "변경 내역을 찾지 못했습니다" };
  if (String(target.on_date).slice(0, 10) < kstToday()) {
    return { error: "지난 날짜의 변경은 지울 수 없습니다 — 그날의 기록입니다" };
  }

  // 🔑 직접 delete하지 않고 함수로 지운다(0321a) — 그래야 이력 장부에 **누가 취소했는지**가 남는다.
  const { error } = await admin.rpc("cancel_shuttle_ride_exception", {
    p_tenant_id: ctx.tenantId,
    p_id: id,
    p_actor_kind: "staff",
    p_actor_id: ctx.userId,
    p_actor_name: ctx.userName,
  });
  // 0321a 전 DB면 함수가 없다 — 종전처럼 직접 지운다([[#95]]).
  const fallbackErr = isMissingCancelFunction(error)
    ? (await admin.from("shuttle_ride_exceptions").delete().eq("id", id).eq("tenant_id", ctx.tenantId)).error
    : error;
  if (fallbackErr) return { error: friendly(fallbackErr, "오늘 탑승 변경을 되돌리지 못했습니다") };

  await logAction({
    action: "shuttle_ride_exception_clear",
    targetType: "shuttle",
    metadata: { exceptionId: id, onDate: String(target.on_date).slice(0, 10) },
  });
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
  // 🔒 종료된 회차의 기록은 지우지 않는다(recordBoarding과 같은 판정) — 그 기록이 어느 날·어느 회차인지 먼저 읽는다.
  const { data: rec } = await admin
    .from("shuttle_boardings")
    .select("boarded_on, run_id")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (rec?.run_id && (await tripEnded(admin, ctx.tenantId, String(rec.boarded_on), String(rec.run_id)))) {
    return { error: TRIP_ENDED_MESSAGE };
  }
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

// ── 운행 단위 (0243a) — 그 회차가 출발했나 / 끝났나 ─────────────────────────────────────

/**
 * 출발을 찍는다 — **관제 화면의 재료**다.
 *
 * 🔑 이 액션이 없던 동안 관제에서 빈 회차는 두 가지 뜻이었다: ① 아직 출발 전이라 당연히 비었다
 *    ② 출발했는데 아무도 안 찍고 있다. 전자는 정상이고 후자는 전화할 일인데 구분이 안 됐다.
 *
 * 🔴 게이트는 **기록 축**(`recordGate`)이다 — 차에 타는 셔틀 선생님(실측 역할 `viewer`)이 누를 버튼이라
 *    편성 권한을 요구하면 정작 쓸 사람이 못 쓴다(0225a·record-gate.ts와 같은 결).
 * 🔴 **오늘 것만** 찍는다 — 지난 날짜는 그날의 기록이고, 내일 차를 오늘 출발시키면 관제가 거짓이 된다.
 *    화면도 같은 판정을 하지만 화면 조건은 게이트가 아니므로([[#77]]) 여기서 다시 막는다.
 * ⚠️ 이미 출발한 회차를 다시 눌러도 **덮어쓰지 않는다** — 두 사람이 같이 눌렀을 때 나중 사람의 시각이
 *    이겨서 "언제 떠났나"가 바뀌면 안 된다. 먼저 찍힌 것이 사실이다.
 */
export async function startTrip(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await recordGate();
  if ("error" in ctx) return ctx;
  const ranOn = String(formData.get("ranOn") ?? "");
  const runId = String(formData.get("runId") ?? "");
  if (!YMD.test(ranOn)) return { error: "날짜를 확인하세요" };
  if (!runId) return { error: "회차를 찾지 못했습니다" };
  if (ranOn !== kstToday()) return { error: "오늘 운행만 출발을 찍을 수 있습니다" };

  const admin = createAdminClient();
  // 스냅샷 재료 — 회차를 지워도 "그날 1호차 3회차가 돌았다"는 남아야 한다(boardings와 같은 규약).
  // ⚡ 회차 · 출발 전 열림 규칙(직원은 30분 전, trip-open-guard) · 이미 찍힌 운행은 서로 독립이라 함께 묻는다(B4).
  const [runRes, notOpen, existing] = await Promise.all([
    admin
      .from("shuttle_runs")
      .select("run_no, vehicle:shuttle_vehicles!shuttle_runs_vehicle_id_fkey(name)")
      .eq("id", runId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle(),
    runNotOpenMessage(admin, ctx.tenantId, runId, ranOn),
    loadTrip(admin, ctx.tenantId, ranOn, runId),
  ]);
  const run = runRes.data;
  if (!run) return { error: "회차를 찾지 못했습니다" };
  if (notOpen) return { error: notOpen };

  // 이미 출발했으면 그대로 둔다(먼저 찍힌 시각이 사실). 종료된 것도 여기서 되살리지 않는다 — 그건 reopenTrip.
  if (existing?.started_at) return { ok: true, notice: "이미 출발로 찍혀 있습니다" };

  const vehicle = run.vehicle as { name?: string } | null;
  const { error } = await admin.from("shuttle_trips").upsert(
    {
      tenant_id: ctx.tenantId,
      ran_on: ranOn,
      run_id: runId,
      vehicle_label: vehicle?.name ?? null,
      run_no: run.run_no,
      started_at: new Date().toISOString(),
      started_by: ctx.userId,
    },
    // 🔴 `ignoreDuplicates`(= ON CONFLICT DO NOTHING) — **먼저 찍힌 시각이 사실**이다.
    //    기본 upsert(DO UPDATE)면 두 사람이 동시에 누를 때 나중 사람이 출발 시각을 덮어써
    //    "언제 떠났나"가 바뀐다(위 early-return은 레이스를 못 막는다 — 둘 다 빈 상태를 본다).
    { onConflict: "tenant_id,ran_on,run_id", ignoreDuplicates: true },
  );
  if (error) return { error: friendly(error, "출발을 저장하지 못했습니다") };

  await logAction({ action: "shuttle_trip_start", targetType: "shuttle", metadata: { ranOn, runId } });
  refresh();
  return { ok: true };
}

/**
 * 종료를 찍는다.
 * 🔴 **명단 전원의 상태가 정해져야 끝난다**(사용자 2026-10-07 — 종전 "미기록이 남아도 막지 않는다"를 뒤집음).
 *    탑승·미탑승 기록(전송·저장) 또는 오늘 안 탐(등원 안함)이 아닌 아이가 있으면 "누구누구 학생 확인이 필요합니다"로
 *    돌려보낸다(`trip-end-guard.ts`). 확인할 수 없을 때(조회 실패)는 막지 않는다.
 */
export async function endTrip(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await recordGate();
  if ("error" in ctx) return ctx;
  const ranOn = String(formData.get("ranOn") ?? "");
  const runId = String(formData.get("runId") ?? "");
  if (!YMD.test(ranOn)) return { error: "날짜를 확인하세요" };
  if (!runId) return { error: "회차를 찾지 못했습니다" };
  if (ranOn !== kstToday()) return { error: "오늘 운행만 종료할 수 있습니다" };

  const admin = createAdminClient();
  const existing = await loadTrip(admin, ctx.tenantId, ranOn, runId);
  if (!existing?.started_at) return { error: "아직 출발을 찍지 않았습니다" };
  if (existing.ended_at) return { ok: true, notice: "이미 종료로 찍혀 있습니다" };
  const unchecked = await endTripUncheckedMessage(ctx.tenantId, runId, ranOn);
  if (unchecked) return { error: unchecked };

  const { error } = await admin
    .from("shuttle_trips")
    .update({ ended_at: new Date().toISOString(), ended_by: ctx.userId })
    .eq("id", existing.id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendly(error, "종료를 저장하지 못했습니다") };

  await logAction({ action: "shuttle_trip_end", targetType: "shuttle", metadata: { ranOn, runId } });
  refresh();
  return { ok: true };
}

/**
 * 종료를 되돌린다 — **오늘 안에서만**.
 * ⚠️ 되돌릴 문을 막으면 잘못 누른 한 번에 그날 남은 명단을 못 찍는다([[#103]] — 잠금은 되돌릴 문과 함께).
 */
export async function reopenTrip(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await recordGate();
  if ("error" in ctx) return ctx;
  const ranOn = String(formData.get("ranOn") ?? "");
  const runId = String(formData.get("runId") ?? "");
  if (!YMD.test(ranOn)) return { error: "날짜를 확인하세요" };
  if (!runId) return { error: "회차를 찾지 못했습니다" };
  if (ranOn !== kstToday()) return { error: "오늘 운행만 되돌릴 수 있습니다" };

  const admin = createAdminClient();
  const existing = await loadTrip(admin, ctx.tenantId, ranOn, runId);
  if (!existing?.ended_at) return { error: "종료된 운행이 아닙니다" };

  const { error } = await admin
    .from("shuttle_trips")
    .update({ ended_at: null, ended_by: null })
    .eq("id", existing.id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendly(error, "종료를 되돌리지 못했습니다") };

  await logAction({ action: "shuttle_trip_reopen", targetType: "shuttle", metadata: { ranOn, runId } });
  refresh();
  return { ok: true };
}

const TRIP_ENDED_MESSAGE = "운행이 종료됐습니다 — 바꾸려면 [종료 취소]를 먼저 누르세요";

/**
 * 그 회차가 그날 **종료**됐나(사용자 2026-10-06 "회차가 종료됐을 경우 아이들 내용을 수정할 수 없게").
 * 화면도 줄을 잠그지만 화면 조건은 게이트가 아니다([[#77]]). 0243a 미적용(표 없음)이면 loadTrip이 null → 막지 않는다.
 */
async function tripEnded(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  ranOn: string,
  runId: string,
): Promise<boolean> {
  const trip = await loadTrip(admin, tenantId, ranOn, runId);
  return Boolean(trip?.ended_at);
}

/** 그날 그 회차의 운행 행. ⚠️ admin은 RLS 우회라 tenant_id 필터 필수([[#104]]). */
async function loadTrip(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  ranOn: string,
  runId: string,
): Promise<{ id: string; started_at: string | null; ended_at: string | null } | null> {
  const { data } = await admin
    .from("shuttle_trips")
    .select("id, started_at, ended_at")
    .eq("tenant_id", tenantId)
    .eq("ran_on", ranOn)
    .eq("run_id", runId)
    .maybeSingle();
  return data ?? null;
}

// ── 정류장 좌표 (0244a) ────────────────────────────────────────────────────────────────

/**
 * 정류장 위치를 찍는다 — 위경도·반경·주소.
 *
 * 🔴 **좌표는 둘 다이거나 둘 다 아니다**(0244a check와 같은 판정). 한쪽만 저장되면 지도에 못 찍으면서
 *    "좌표 있음"으로 세어져 빈 마커가 된다. 빈 값으로 보내면 **좌표를 지운다**(잘못 찍은 것을 되돌리는 길).
 * 🔴 게이트는 **편성 축**(`gate`) — 정류장 마스터는 데스크가 관리하는 편성 정보다(등하원 기록과 다른 축).
 * ⚠️ 0244a 미적용이면 컬럼이 없어 update가 실패한다 — 한글 사유로 돌려준다(화면은 애초에 이 폼을
 *    `coordsReady`가 false면 안 그린다, [[#95]]).
 */
export async function saveStopLocation(formData: FormData): Promise<ShuttleActionState> {
  const ctx = await gate();
  if ("error" in ctx) return ctx;
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "정류장을 찾지 못했습니다" };

  const rawLat = String(formData.get("lat") ?? "").trim();
  const rawLng = String(formData.get("lng") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const rawRadius = String(formData.get("radiusM") ?? "").trim();

  // 둘 다 비면 좌표를 지운다(되돌리기). 한쪽만 있으면 거절 — 반쪽 좌표는 지도에 못 찍는다.
  const cleared = !rawLat && !rawLng;
  let lat: number | null = null;
  let lng: number | null = null;
  if (!cleared) {
    if (!rawLat || !rawLng) return { error: "위도와 경도를 함께 입력하세요" };
    lat = Number(rawLat);
    lng = Number(rawLng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: "위도는 -90~90 사이여야 합니다" };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { error: "경도는 -180~180 사이여야 합니다" };
  }

  let radiusM = 50;
  if (rawRadius) {
    radiusM = Number(rawRadius);
    if (!Number.isFinite(radiusM) || radiusM < 10 || radiusM > 500) {
      return { error: "도착 반경은 10~500m 사이여야 합니다" };
    }
    radiusM = Math.round(radiusM);
  }
  if (address && address.length > 200) return { error: "주소는 200자까지입니다" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("shuttle_stops")
    .update({ lat, lng, radius_m: radiusM, address })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) {
    // 컬럼이 아직 없는 배포 — 무엇을 해야 하는지 사람 말로 돌려준다(raw 원문 노출 금지).
    if (error.code === "42703" || error.code === "PGRST204") {
      return { error: "정류장 좌표 기능이 아직 준비되지 않았습니다 (마이그레이션 0244a 필요)" };
    }
    return { error: friendly(error, "정류장 위치를 저장하지 못했습니다") };
  }

  await logAction({
    action: "shuttle_stop_location",
    targetType: "shuttle",
    metadata: { stopId: id, cleared, radiusM },
  });
  refresh();
  return { ok: true };
}
