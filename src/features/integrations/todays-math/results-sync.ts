import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, kstToday } from "@/lib/date-kst";
import { licenseExplicitlyOn } from "@/lib/license/rule";
import { uuidSchema, timestampSchema } from "./sync-contract";
import { sourceBindingForTenant, targetRequest } from "./sync-server";
import type { BindingConfig } from "./sync-contract";

/**
 * 오늘 수학 채점 결과 → aywa(`todays_math_test_results`, 0371a) — 역방향 2단계(2026-10-17).
 *
 * 깨우는 길 둘(원장 2026-10-17 *"섞는 방식으로"*): ① 오늘 수학이 채점을 저장하면 서명한 신호만 보낸다
 * (`/api/integrations/todays-math/v2/results-wake` → 그 지점만 바로) ② 신호가 빠졌을 때의 안전망으로 1시간마다
 * (`/api/cron/todays-math-results`) 켜진 지점 전부. 어느 쪽이든 하는 일은 같다: ① 기간의 날짜별 지문을 받고 ② 저장해 둔 지문과 다른 날만
 * 그날 행 전부를 받아 ③ DB 함수가 그날을 통째로 갈아끼운다. 오늘 수학은 연결이 꺼졌거나 확인이 안 되면 **오류**를 준다 —
 * 그때는 아무것도 바꾸지 않는다(빈 목록으로 지우지 않는다).
 *
 * 기간 = 오늘(KST) 45일 전 ~ 7일 뒤. 그보다 오래된 결과는 마지막으로 받은 값 그대로 남는다.
 * 한 번에 최대 15일 — 처음 켠 지점은 몇 번에 걸쳐 채워진다(최근 날짜부터).
 */
export const RESULTS_BACK_DAYS = 45;
export const RESULTS_AHEAD_DAYS = 7;
export const RESULTS_DAYS_PER_RUN = 15;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const date = z.iso.date();
const daysSchema = z.object({
  bindingId: uuidSchema, from: date, to: date,
  days: z.array(z.object({ date, count: z.number().int().nonnegative(), sha256 })).max(200),
});
const rowSchema = z.object({
  sourceTestId: uuidSchema, sourceStudentId: uuidSchema, sourceClassId: uuidSchema.nullable(),
  kind: z.enum(["daily", "review", "monthly", "unit", "school", "other"]),
  title: z.string().max(200).nullable(), unitName: z.string().max(200).nullable(), testDate: date,
  questionCount: z.number().int().min(0).max(1000), absent: z.boolean(),
  score: z.number().finite().min(0).max(10000).nullable(), correctCount: z.number().int().nonnegative().nullable(),
  takenAt: timestampSchema,
});
const daySchema = z.object({ bindingId: uuidSchema, date, sha256, rows: z.array(rowSchema).max(5000) });

/** 저장한 지문과 받은 지문을 견줘 다시 받을 날 — 최근 날짜부터. 순수 함수(테스트 대상). */
export function changedResultDays(
  remote: readonly { date: string; sha256: string }[],
  stored: readonly { test_date: string; digest: string; row_count: number }[],
): string[] {
  const storedBy = new Map(stored.map((s) => [s.test_date, s]));
  const remoteDates = new Set(remote.map((d) => d.date));
  const dates = remote.filter((d) => storedBy.get(d.date)?.digest !== d.sha256).map((d) => d.date);
  // 저쪽 목록에서 빠진 날(시험이 지워짐) — 우리 쪽에 행이 남아 있으면 그날을 받아 비운다.
  for (const s of stored) if (!remoteDates.has(s.test_date) && s.row_count > 0) dates.push(s.test_date);
  return [...new Set(dates)].sort((a, b) => b.localeCompare(a));
}

export type ResultsSyncTenant = { tenantId: string; status: "synced" | "not_ready" | "unavailable"; days: number; rows: number };

const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "PGRST202";

export async function syncTenant(config: BindingConfig): Promise<ResultsSyncTenant> {
  const admin = createAdminClient();
  const tenantId = config.tenantId;
  const today = kstToday();
  const from = addDays(today, -RESULTS_BACK_DAYS);
  const to = addDays(today, RESULTS_AHEAD_DAYS);
  const stored = await admin.from("todays_math_result_days").select("test_date, digest, row_count")
    .eq("tenant_id", tenantId).gte("test_date", from).lte("test_date", to);
  if (isMissingTable(stored.error)) return { tenantId, status: "not_ready", days: 0, rows: 0 };
  if (stored.error) throw new Error("result_days_read_failed");
  const remote = daysSchema.parse(await targetRequest(config,
    `/api/integrations/eywa/v2/results?bindingId=${config.bindingId}&from=${from}&to=${to}`, "GET"));
  if (remote.bindingId !== config.bindingId || remote.from !== from || remote.to !== to) throw new Error("result_days_mismatch");
  const dates = changedResultDays(remote.days, stored.data ?? []).slice(0, RESULTS_DAYS_PER_RUN);
  let rows = 0, applied = 0, failed = 0;
  // 한 날이 실패해도(행이 너무 많음 · 그 순간 저쪽 오류) 나머지 날은 받는다 — 막힌 날 하나가 그 뒤 날짜를 영영 막지 않게.
  for (const day of dates) {
    try {
      const fetched = daySchema.parse(await targetRequest(config, `/api/integrations/eywa/v2/results/${day}?bindingId=${config.bindingId}`, "GET"));
      if (fetched.bindingId !== config.bindingId || fetched.date !== day || fetched.rows.some((r) => r.testDate !== day)) throw new Error("result_day_mismatch");
      const { data, error } = await admin.rpc("todays_math_apply_result_day", {
        p_tenant: tenantId, p_date: day, p_digest: fetched.sha256, p_rows: fetched.rows,
      });
      if (isMissingTable(error)) return { tenantId, status: "not_ready", days: 0, rows: 0 };
      if (error) throw new Error("result_day_apply_failed");
      rows += Number(data ?? 0);
      applied++;
    } catch (e) {
      failed++;
      console.error("[todays-math-results] 날짜 반영 실패", tenantId, day, e instanceof Error ? e.message : "unknown");
    }
  }
  return { tenantId, status: failed && !applied ? "unavailable" : "synced", days: applied, rows };
}

/** 오늘 수학이 켜진 지점 전부 — 한 지점이 실패해도 다른 지점은 돈다. */
export async function syncTodaysMathResults(): Promise<ResultsSyncTenant[]> {
  const { data, error } = await createAdminClient().from("tenant_licenses")
    .select("tenant_id, is_active, expires_at").eq("feature", "todays_math");
  if (error) throw new Error("license_read_failed");
  const tenants = (data ?? []).filter((row) => licenseExplicitlyOn(row)).map((row) => row.tenant_id as string);
  const out: ResultsSyncTenant[] = [];
  for (const tenantId of tenants) {
    let config: BindingConfig | undefined;
    try { config = sourceBindingForTenant(tenantId); } catch { config = undefined; }
    if (!config) continue;
    try { out.push(await syncTenant(config)); }
    catch (e) {
      // 원문(개인정보·키) 없이 까닭 코드만.
      console.error("[todays-math-results] 지점 동기화 실패", tenantId, e instanceof Error ? e.message : "unknown");
      out.push({ tenantId, status: "unavailable", days: 0, rows: 0 });
    }
  }
  return out;
}
