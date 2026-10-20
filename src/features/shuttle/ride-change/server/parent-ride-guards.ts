import "server-only";

import { kstMinutesOfDay, kstToday } from "@/lib/date-kst";
import {
  EDIT_CUTOFF_MINUTES,
  dayRunsEndTime,
  legRode,
  regularRunClosed,
  runEditClosed,
  runStartTime,
  type RidePoint,
} from "../../parent/parent-rides";
import { isBoardingStatus, isDirection, type DayCode, type Direction, type RunStopKind } from "../../types";
import type { Admin, Ctx } from "./parent-ride-state";

/**
 * 학부모 등하원 변경의 **확인들** — 저장하기 전에 서버가 다시 보는 규칙 전부([[#77]] — 화면 잠금은 게이트가 아니다).
 * 각 함수는 막히면 **한글 안내 문구**, 통과면 null을 돌려준다(자리 확인만 결과 객체).
 * ⚠️ 서로 기다릴 필요가 없는 확인은 호출부가 `Promise.all`로 함께 돌린다(CLAUDE.md B4 — 학부모 저장 한 번이 왕복 12번을 넘었다).
 */

const kindOf = (k: unknown): RunStopKind => (k === "depart" || k === "arrive" ? k : "stop");
const hhmm = (t: unknown): string | null => (t ? String(t).slice(0, 5) : null);

/** 고른 자리 — 우리 학원 · 정류장 칸 · 학기중 · 운행 중인 차. 짝 규칙 재료로 회차·시각도 함께 돌려준다. */
export type CheckedStop = { id: string; runId: string; time: string | null };

/** 고를 수 있는 자리인가(회차 방향은 가리지 않는다 — 사용자 2026-09-29 "등원시간 하원시간 나누지 말고 자유롭게"). */
export async function checkStop(admin: Admin, tenantId: string, runStopId: string): Promise<CheckedStop | { error: string }> {
  const { data: stop, error: stopError } = await admin.from("shuttle_run_stops").select("id, kind, run_id, at_time")
    .eq("tenant_id", tenantId).eq("id", runStopId).maybeSingle();
  if (stopError) throw stopError;
  if (!stop) return { error: "정류장을 찾지 못했어요" };
  if (stop.kind !== "stop") return { error: "학원 출발·도착 칸은 고를 수 없어요" };
  const { data: run, error: runError } = await admin.from("shuttle_runs").select("season, vehicle_id")
    .eq("tenant_id", tenantId).eq("id", stop.run_id).maybeSingle();
  if (runError) throw runError;
  if (!run || run.season !== "term") return { error: "지금 운행하는 회차가 아니에요" };
  const { data: vehicle, error: vehicleError } = await admin.from("shuttle_vehicles").select("archived")
    .eq("tenant_id", tenantId).eq("id", run.vehicle_id).maybeSingle();
  if (vehicleError) throw vehicleError;
  if (!vehicle || vehicle.archived) return { error: "지금 운행하는 차가 아니에요" };
  return { id: stop.id as string, runId: stop.run_id as string, time: hhmm(stop.at_time) };
}

/** 노선 칸 하나의 회차·시각 — 반대 방향 자리를 짝 규칙에 넣을 때. 못 찾으면 null. */
export async function stopPoint(admin: Admin, tenantId: string, runStopId: string | null): Promise<RidePoint | null> {
  if (!runStopId) return null;
  const { data, error } = await admin.from("shuttle_run_stops").select("run_id, at_time")
    .eq("tenant_id", tenantId).eq("id", runStopId).maybeSingle();
  if (error) throw error;
  return data ? { runId: data.run_id as string, time: hhmm(data.at_time) } : null;
}

/**
 * 그날 그 방향에 **이미 탔으면** 안내 문구(사용자 2026-09-30 "아이가 탔을 경우에만 수정 못하게").
 * 판정은 카드와 같은 `legRode`(탑승·추가 탑승) — '미탑승'은 막지 않는다(차가 지나갔어도 다른 회차로 옮긴다).
 * 🔑 오늘만 본다 — 미래 날짜에 남은 테스트 기록이 앞날을 잠그면 안 된다.
 * 🔴 이걸 빼면 저장은 되는데 화면은 탄 구간만 보여 줘서 "바꿨어요"가 거짓말이 된다(`oneLegPerRide`).
 */
export async function rodeMessage(admin: Admin, ctx: Ctx): Promise<string | null> {
  if (ctx.onDate !== kstToday()) return null;
  const { data, error } = await admin.from("shuttle_boardings").select("status")
    .eq("tenant_id", ctx.tenantId).eq("student_id", ctx.studentId)
    .eq("boarded_on", ctx.onDate).eq("io_kind", ctx.ioKind).limit(20);
  if (error) throw error;
  if (!(data ?? []).some((b) => legRode({ status: isBoardingStatus(b.status) ? b.status : null }))) return null;
  return ctx.ioKind === "in"
    ? "오늘은 이미 등원 셔틀을 탔어요. 탄 뒤에는 수정할 수 없어요"
    : "오늘은 이미 하원 셔틀에서 내렸어요. 내린 뒤에는 수정할 수 없어요";
}

/**
 * 회차들 중 **출발 10분 전이 지난** 것이 있으면 안내 문구. 앞으로의 날짜는 늘 null.
 * 판정은 화면과 같은 `runEditClosed`(시작 = 학원 출발 칸, 없으면 첫 시각 · 모르면 막지 않음).
 */
export async function closedRunsMessage(admin: Admin, ctx: Ctx, runIds: string[]): Promise<string | null> {
  // 🔑 출발 10분 전 마감은 **학부모 규칙**이다 — 직원(관리자 · 셔틀 선생님)은 전화를 받고 그 자리에서 바꾼다
  //    (기존 '오늘만 승하차'도 마감이 없다). 이미 탄 뒤 잠금(`rodeMessage`)·짝 규칙은 직원에게도 그대로다.
  if (ctx.actor.kind === "staff") return null;
  const today = kstToday();
  if (ctx.onDate !== today || runIds.length === 0) return null;
  const tenantId = ctx.tenantId;
  const [stopsRes, runsRes, tripsRes] = await Promise.all([
    admin.from("shuttle_run_stops").select("run_id, kind, at_time").eq("tenant_id", tenantId).in("run_id", runIds).limit(500),
    admin.from("shuttle_runs").select("id, run_no, label").eq("tenant_id", tenantId).in("id", runIds),
    // 🔑 [출발]을 이미 눌렀으면 10분 전이 안 됐어도 마감(사용자 2026-10-15 "셔틀이 시작된 후에도 수정 가능하네").
    //    운행 표(0243a)가 없거나 조회가 실패하면 시각 규칙만 본다(막는 쪽으로 지어내지 않는다).
    admin.from("shuttle_trips").select("run_id").eq("tenant_id", tenantId).eq("ran_on", today).in("run_id", runIds).not("started_at", "is", null),
  ]);
  for (const res of [stopsRes, runsRes]) if (res.error) throw res.error;
  const started = new Set((tripsRes.error ? [] : tripsRes.data ?? []).map((t) => String(t.run_id)));
  const now = kstMinutesOfDay();
  for (const run of runsRes.data ?? []) {
    if (started.has(String(run.id))) {
      const name = run.label?.trim() || `${run.run_no}회차`;
      return `${name} 차량이 이미 출발해 수정할 수 없어요`;
    }
    const start = runStartTime(
      (stopsRes.data ?? []).filter((s) => s.run_id === run.id).map((s) => ({ kind: kindOf(s.kind), time: hhmm(s.at_time) })),
    );
    if (runEditClosed(start, ctx.onDate, today, now)) {
      const name = run.label?.trim() || `${run.run_no}회차`;
      return `${name}(${start} 출발) 10분 전이 지나 수정할 수 없어요. 각 회차 출발 ${EDIT_CUTOFF_MINUTES}분 전까지만 수정할 수 있어요`;
    }
  }
  return null;
}

/** 노선 칸들의 회차로 `closedRunsMessage` — 칸만 알 때(되돌아갈 평소 자리 · 지금 타는 자리). */
export async function closedStopsMessage(admin: Admin, ctx: Ctx, runStopIds: string[]): Promise<string | null> {
  if (ctx.onDate !== kstToday() || runStopIds.length === 0) return null;
  const { data: own, error } = await admin.from("shuttle_run_stops").select("run_id")
    .eq("tenant_id", ctx.tenantId).in("id", runStopIds);
  if (error) throw error;
  return closedRunsMessage(admin, ctx, [...new Set((own ?? []).map((s) => s.run_id as string))]);
}

/**
 * 고정 시간 변경 마감 — 그 요일의 가장 가까운 날이 **오늘**이면 고른 회차가 출발 10분 전을 지났는지 본다.
 * 오늘 모든 회차가 끝났으면(학원 모든 호차 노선의 마지막 칸 시각 이후) 막지 않는다 — 판정은 화면과 같은 `regularRunClosed`.
 * 🔑 지금 고정 회차가 오늘 이미 출발했으면 막는다 — 옮기면 새 고정이 오늘 명단에도 먹어서, 이미 탄 아이가
 *    같은 방향 차에 한 번 더 잡힌다(사용자 2026-09-30 "등원 표가 하나 더 나오네").
 */
export async function regularClosedMessage(
  admin: Admin,
  tenantId: string,
  runId: string,
  /** 그 요일의 지금 고정 자리(노선 칸 id) — 회차는 아래 노선 조회에서 되짚는다(따로 한 번 더 묻지 않는다). */
  currentStopIds: readonly string[],
  onDate: string,
): Promise<string | null> {
  if (onDate !== kstToday()) return null;
  // 화면의 '오늘 운행 끝' 재료(loadFleet)와 같은 범위 — 운행 중인 차의 학기중 회차.
  const [vehiclesRes, runsRes] = await Promise.all([
    admin.from("shuttle_vehicles").select("id").eq("tenant_id", tenantId).eq("archived", false).limit(50),
    admin.from("shuttle_runs").select("id, vehicle_id, run_no, direction, label")
      .eq("tenant_id", tenantId).eq("season", "term").limit(300),
  ]);
  for (const res of [vehiclesRes, runsRes]) if (res.error) throw res.error;
  const live = new Set((vehiclesRes.data ?? []).map((v) => v.id as string));
  const runs = (runsRes.data ?? []).filter((r) => live.has(r.vehicle_id as string) && isDirection(r.direction));
  if (runs.length === 0) return null;
  const { data: stops, error } = await admin.from("shuttle_run_stops").select("id, run_id, kind, at_time")
    .eq("tenant_id", tenantId).in("run_id", runs.map((r) => r.id as string)).limit(1000);
  if (error) throw error;
  const currentRunIds = [
    ...new Set((stops ?? []).filter((s) => currentStopIds.includes(s.id as string)).map((s) => s.run_id as string)),
  ];
  const byRun = new Map<string, { kind: RunStopKind; time: string | null }[]>();
  for (const s of stops ?? []) {
    const list = byRun.get(s.run_id as string) ?? [];
    list.push({ kind: kindOf(s.kind), time: hhmm(s.at_time) });
    byRun.set(s.run_id as string, list);
  }
  const dayEnd = dayRunsEndTime([...byRun.values()].map((list) => ({ stops: list })));
  const now = kstMinutesOfDay();
  const closed = (id: string) => regularRunClosed(runStartTime(byRun.get(id) ?? []), dayEnd, onDate, onDate, now);
  const until = `오늘 운행이 모두 끝난${dayEnd ? `(${dayEnd})` : ""} 뒤에 바꿔 주세요`;
  const nameOf = (id: string) => {
    const run = runs.find((r) => r.id === id);
    const start = runStartTime(byRun.get(id) ?? []);
    return `${run?.label?.trim() || (run ? `${run.run_no}회차` : "그 회차")}${start ? `(${start} 출발)` : ""}`;
  };
  const departed = currentRunIds.find((id) => id !== runId && closed(id));
  if (departed) return `오늘은 이미 ${nameOf(departed)}이 출발했어요. ${until}`;
  if (closed(runId)) return `${nameOf(runId)}은 오늘 이미 운행이 시작됐어요. 다른 시간을 고르거나, ${until}`;
  return null;
}

/**
 * 그 아이의 그 요일 **고정 자리 두 방향**(정기 배정) — 한 번 읽어 지금 고정 회차(마감 판정)와 반대 방향 자리(짝 규칙)에
 * 함께 쓴다. 날짜 하루짜리 변경은 섞지 않는다("매주 이 요일엔 원래 어디서 타나"만).
 */
export async function regularStopsOn(
  admin: Admin,
  tenantId: string,
  studentId: string,
  weekday: DayCode,
): Promise<Record<Direction, string[]>> {
  const { data, error } = await admin.from("shuttle_riders").select("io_kind, run_stop_id, weekdays")
    .eq("tenant_id", tenantId).eq("student_id", studentId).limit(40);
  if (error) throw error;
  const of = (io: Direction) =>
    (data ?? []).filter((r) => r.io_kind === io && ((r.weekdays ?? []) as string[]).includes(weekday)).map((r) => r.run_stop_id as string);
  return { in: of("in"), out: of("out") };
}

/** '타지 않기'·'결석' 사유 길이 — 짧게라도 받는다(사용자 2026-09-29). 0229a 메모 상한(300)보다 작게. */
const SKIP_REASON_MAX = 100;

/** 사유 확인 — 통과하면 다듬은 사유, 아니면 안내. */
export function checkReason(raw: unknown): string | { error: string } {
  const reason = String(raw ?? "").trim();
  if (!reason) return { error: "이유를 짧게 적어 주세요" };
  if (reason.length > SKIP_REASON_MAX) return { error: `이유는 ${SKIP_REASON_MAX}자까지 적을 수 있어요` };
  return reason;
}
