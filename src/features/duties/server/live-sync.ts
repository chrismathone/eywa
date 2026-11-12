import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { addDays, kstToday } from "@/lib/date-kst";
import { isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { reportError } from "@/lib/observability/report-error";
import { resetOwnerAsOf } from "./owner-as-of";
import { escalateAndSnapshot, syncDailyDuties } from "./sync";
import { syncDays } from "../model/sync-window";
import { syncMonthlyDuties } from "./monthly-sync";

export type DutyClaim = { locked: boolean; token: string; days: string[]; monthly: boolean; full: boolean };
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 맞출 것을 가져간다(s2_0077 `duty_sync_claim`) — force = 크론. SQL이 아직 없으면(#95) 잠기지 않은 것으로 본다(크론은 종전대로 돈다). */
export async function claimDutySync(tenantId: string, force = false): Promise<DutyClaim & { missing?: boolean }> {
  const { data, error } = await createAdminClient().rpc("duty_sync_claim", { p_tenant: tenantId, p_force: force });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return { locked: false, token: "", days: [], monthly: false, full: false, missing: true };
    throw new Error(`장부 맞춤 가져가기: ${error.message}`);
  }
  const r = (data ?? {}) as { locked?: boolean; token?: unknown; days?: unknown; monthly?: boolean; full?: boolean };
  const days = Array.isArray(r.days) ? r.days.filter((d): d is string => typeof d === "string" && YMD.test(d)) : [];
  const token = typeof r.token === "string" ? r.token : "";
  return { locked: r.locked === true && !!token, token, days, monthly: r.monthly === true, full: r.full === true };
}
/**
 * 맞춤이 끝났다(`duty_sync_finish`) — 성공이면 가져갔던 변경 기록을 지우고(stamp = 전체 맞춤이었으면 기준 시각을 적는다), 실패면 그대로 둬 다음 차례가 다시 맞춘다.
 * 증표가 지금 잠금의 것일 때만 움직인다 — 오래 걸려 잠금이 넘어갔으면 남의 잠금을 풀지 않는다.
 */
export async function finishDutySync(tenantId: string, claim: Pick<DutyClaim, "token">, ok: boolean, stamp = false): Promise<void> {
  const { error } = await createAdminClient().rpc("duty_sync_finish", { p_tenant: tenantId, p_token: claim.token, p_ok: ok, p_full: ok && stamp });
  if (error) throw new Error(`장부 맞춤 마무리: ${error.message}`);
}

/**
 * 화면이 장부를 **읽기 직전**에 부른다 — 저장 즉시 반영(원장 2026-11-10 *"출결이나 상담같이 실시간 체크 가능한것들은 실시간 반영 … 오해를 사지 않게"*).
 * 원 표의 트리거(s2_0077)가 적어 둔 "바뀐 날"만 기존 맞춤 함수로 다시 맞춘다(판정은 크론과 같은 함수 한 벌 — 새 규칙을 만들지 않는다 · 날은 오늘과 최근 7일만 `syncDays`).
 * 적힌 것이 없고 마지막 전체 맞춤이 30분 안이면 RPC 한 번으로 끝난다. 전체 맞춤이 오래됐으면(크론이 없는 환경 · 크론 실패) 오늘 치와 월간까지 스스로 맞춘다
 * (기한 지난 열린 날을 훑는 일은 크론 몫 — 그런 날도 원 표가 바뀌면 변경 기록으로 들어온다).
 * 다른 요청이나 크론이 맞추는 중이면 기다리지 않고 지금 장부를 그대로 읽는다(그 요청이 끝나면 다음 갱신에 반영).
 * 🔴 **절대 던지지 않는다** — 맞춤 실패가 '내 업무'·관리자 화면을 죽이면 안 된다(변경 기록은 남겨 두고 기록만 남긴다).
 */
export async function flushDuties(tenantId: string): Promise<void> {
  let claim: DutyClaim | null = null;
  try {
    // 지점 보기(읽기 전용) 중에는 맞춤을 시도하지 않는다 — 쓰기가 막혀 있어 요청마다 실패 기록만 쌓인다(크론이 맞춘다).
    if (await isTenantViewWriteBlocked()) return;
    const got = await claimDutySync(tenantId);
    if (!got.locked) return;
    claim = got;
    const today = kstToday();
    const settings = await getTenantSettingsByTenantId(tenantId, { failOnReadError: true });
    const days = syncDays(got.days, today, got.full ? [today] : []);
    resetOwnerAsOf(tenantId);
    for (const day of days) await syncDailyDuties(tenantId, day, settings);
    if (got.monthly || got.full) await syncMonthlyDuties(tenantId, today, settings);
    // 달 초 한 주 동안 월간 변경이 있으면 지난 달도 맞춘다(말일의 상담 · 성적을 다음 날 입력한 것 — 변경 기록은 어느 달인지까지는 넘기지 않는다).
    if (got.monthly && Number(today.slice(8, 10)) <= 7) await syncMonthlyDuties(tenantId, addDays(`${today.slice(0, 7)}-01`, -1), settings, { skipNewcomers: true, resolveOnly: true });
    await escalateAndSnapshot(tenantId, days, settings);
    await finishDutySync(tenantId, got, true, got.full);
    claim = null;
  } catch (error) {
    reportError(error, { scope: "duties.flush" });
    if (claim) await finishDutySync(tenantId, claim, false).catch((e) => reportError(e, { scope: "duties.flush.finish" }));
  }
}
