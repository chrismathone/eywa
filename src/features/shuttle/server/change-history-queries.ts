import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { kstDateOf, kstTimeOf } from "@/lib/date-kst";
import type { RegularChange, RideChange } from "../parent-rides";
import { isDirection, type DayCode } from "../types";

/**
 * 관리자 '학부모 등하원' 화면의 **변경 내역** 조회 — 그날 변경(0314a 장부) · 고정 시간 변경(0315a 장부).
 * 🔴 **직원 전용**(사용자 2026-09-29 "관리자나 셔틀 선생님만") — 세션 + RLS(테넌트 직원)로 읽는다. 학부모 화면 로더는
 *    이 장부를 읽지 않는다. 직원이 [확인]한 줄(0316a)은 여기서 뺀다(장부는 그대로).
 * ⚠️ 장부·확인 표가 없거나(마이그레이션 전) 읽기에 실패해도 화면은 산다 — 내역만 비거나, 아무것도 안 숨긴다([[#95]]).
 * (`queries.ts`에서 떼어 냈다 — 셔틀 조회 파일이 600줄을 넘어서.)
 */

/** 표가 아직 없음(42P01 / PostgREST 스키마 캐시에 없음) — 실패가 아니라 "아직 안 켜짐". */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .*shuttle_.* does not exist/i.test(error.message ?? "")
  );
}

/**
 * 직원이 **확인**한 장부 줄 id(0316a) — 화면에서만 내린다(장부는 그대로, 사용자 2026-09-30).
 * ⚠️ 표가 없거나(0316a 전) 읽기에 실패하면 **빈 집합** — 아무것도 안 숨긴다(모르는 것을 '확인했다'로 읽지 않는다).
 */
async function ackedHistoryIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: "ride" | "regular",
  ids: string[],
): Promise<Set<string>> {
  try {
    const rows = await fetchInChunks<{ history_id: string }>(ids, (chunk) =>
      supabase.from("shuttle_history_acks").select("history_id").eq("history_kind", kind).in("history_id", chunk),
    );
    return new Set(rows.map((r) => r.history_id));
  } catch (e) {
    if (!/shuttle_history_acks|42P01|PGRST205/.test(String(e))) reportError(e, { scope: "shuttle.historyAcks", kind });
    return new Set();
  }
}

/** "9/29 10:12"(KST) — 변경 내역 표시용. */
function shortStamp(iso: string): string {
  const date = kstDateOf(iso);
  return date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ${kstTimeOf(iso) ?? ""}`.trim() : "";
}

/**
 * 최근 **고정 시간 변경**(0315a 장부) — 학생 id → 최신 먼저. 🔴 직원 전용(세션 + RLS).
 * 고정 변경은 날짜가 아니라 요일에 걸리므로 '그날'로 거르지 않고 최근 60일을 보인다.
 */
export async function getRegularChanges(): Promise<Map<string, RegularChange[]>> {
  const out = new Map<string, RegularChange[]>();
  const user = await getCurrentUser();
  if (!user) return out;
  const supabase = await createClient();
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("shuttle_rider_history")
    .select("id, student_id, io_kind, weekday, before_label, after_label, reason, actor_name, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500); // 두 달 치 고정 변경 — 몇십 건 규모(B2)
  if (error) {
    if (!isMissingTable(error)) reportError(error, { scope: "shuttle.regularChanges" });
    return out;
  }
  const acked = await ackedHistoryIds(supabase, "regular", (data ?? []).map((r) => r.id as string));
  for (const r of data ?? []) {
    if (!isDirection(r.io_kind) || acked.has(r.id)) continue;
    const list = out.get(r.student_id) ?? [];
    list.push({
      id: r.id,
      direction: r.io_kind,
      weekday: r.weekday as DayCode,
      beforeLabel: r.before_label,
      afterLabel: r.after_label,
      reason: r.reason,
      actorName: r.actor_name ?? "알 수 없음",
      at: shortStamp(r.created_at),
    });
    out.set(r.student_id, list);
  }
  return out;
}

/**
 * 그날 **변경 내역**(0314a 이력 장부) — 학생 id → 최신 먼저. 🔴 **직원 전용**(사용자 2026-09-29 "관리자나
 * 셔틀 선생님만") — 세션 + RLS(테넌트 직원)로 읽는다. 학부모 화면 로더는 이 장부를 읽지 않는다.
 * ⚠️ 장부가 없거나(0314a 전) 읽기에 실패해도 화면은 산다 — 내역만 빈다.
 */
export async function getRideChangesOn(ymd: string): Promise<Map<string, RideChange[]>> {
  const out = new Map<string, RideChange[]>();
  const user = await getCurrentUser();
  if (!user) return out;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shuttle_ride_exception_history")
    .select("id, student_id, io_kind, op, before_label, after_label, memo, actor_name, created_at")
    .eq("on_date", ymd)
    .order("created_at", { ascending: false })
    .limit(500); // 하루 변경은 몇십 건 규모 — 절단 방지 명시 상한(B2)
  if (error) {
    if (!isMissingTable(error)) reportError(error, { scope: "shuttle.rideChanges", ymd });
    return out;
  }
  const acked = await ackedHistoryIds(supabase, "ride", (data ?? []).map((r) => r.id as string));
  for (const r of data ?? []) {
    if (!isDirection(r.io_kind) || !["create", "update", "cancel"].includes(r.op) || acked.has(r.id)) continue;
    const date = kstDateOf(r.created_at);
    const list = out.get(r.student_id) ?? [];
    list.push({
      id: r.id,
      direction: r.io_kind,
      op: r.op as RideChange["op"],
      beforeLabel: r.before_label,
      afterLabel: r.after_label,
      memo: r.memo,
      actorName: r.actor_name ?? "알 수 없음",
      at: date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ${kstTimeOf(r.created_at) ?? ""}`.trim() : "",
    });
    out.set(r.student_id, list);
  }
  return out;
}
