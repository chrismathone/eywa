import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TenantSettings } from "@/features/owner/settings-types";
import { addDays, kstToday } from "@/lib/date-kst";
import { escalateAndSnapshot, syncDailyDuties } from "./sync";
import { syncMonthlyDuties } from "./monthly-sync";

/**
 * 한 달 치 장부를 기록으로 다시 만든다(원장 2026-11-10 *"10월 기록을 총 동원해서 지난달 것도 만들어볼것"*) — 그 달의 날마다 일간 맞춤, 그 달 말일 기준 월간 맞춤(상담 · 월말평가).
 * 맞춤 함수는 평소와 같은 것이다: 그날의 시간표 · 수강 · 출결 · 보고서 · 발송 시각으로 분모를 만들고 완료 시각은 기록의 실제 시각을 쓴다(제때/늦음이 가려진다).
 * ⚠️ 한계 — **지금** 기준으로 읽는 것: 운영 중인 반만(그 뒤 닫은 반은 빠진다) · 담임 · 재직 여부 · 보고서 설정 · 재원 상태. 그래서 지난달은 참고 기록이다.
 * 신규생 정착은 건드리지 않는다(달이 아니라 오늘 기준 한 벌이라, 지난 날 기준으로 돌리면 지금 열린 것이 지워진다).
 * 그 달의 월간 의무는 더는 채울 수 없으므로(그 달 안의 기록만 인정) 열린 채 남은 것을 미이행으로 확정한다.
 */
export async function backfillDutyMonth(tenantId: string, month: string, settings: TenantSettings): Promise<{ days: number; drafts: number; monthly: number; closed: number; skipped?: string }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("달은 YYYY-MM 꼴이어야 합니다");
  const today = kstToday();
  if (month > today.slice(0, 7)) throw new Error("앞날의 달은 만들 수 없습니다");
  // 🔴 **평가 개시 전에 끝난 달만** 만든다 — 개시 뒤의 날을 지금 담임 · 지금 반으로 다시 맞추면 이미 평가된 실적이 새 담당으로 옮겨 가고(rekey는 끝난 의무까지 옮긴다),
  //    지난 달 월간을 미이행으로 확정하는 것도 평소 규칙(열린 채 지연)과 달라진다. 개시일이 없는 지점은 '개시 전'이 없으므로 만들지 않는다.
  const { data: st, error: stError } = await createAdminClient().from("duty_settings").select("live_from").eq("tenant_id", tenantId).maybeSingle();
  if (stError) throw new Error(`장부 설정: ${stError.message}`);
  const liveDay = st?.live_from ? new Date(Date.parse(st.live_from as string) + 9 * 3_600_000).toISOString().slice(0, 10) : null;
  if (!liveDay || addDays(`${nextMonth(month)}-01`, -1) >= liveDay) return { days: 0, drafts: 0, monthly: 0, closed: 0, skipped: "not_before_live" };
  const last = addDays(`${nextMonth(month)}-01`, -1);
  const days: string[] = [];
  for (let d = `${month}-01`; d <= last; d = addDays(d, 1)) days.push(d);
  let drafts = 0;
  for (const day of days) drafts += (await syncDailyDuties(tenantId, day, settings)).drafts;
  const m = await syncMonthlyDuties(tenantId, last, settings, { skipNewcomers: true });
  let closed = 0;
  {
    const { data, error } = await createAdminClient().from("duty_items").update({ status: "void", void_reason: "expired", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("period", "monthly").eq("cycle", month).eq("status", "open").select("id");
    if (error) throw new Error(`지난 달 월간 확정: ${error.message}`);
    closed = data?.length ?? 0;
  }
  await escalateAndSnapshot(tenantId, days, settings);
  return { days: days.length, drafts, monthly: m.counsel + m.exam, closed };
}
const nextMonth = (month: string) => { const y = Number(month.slice(0, 4)), mm = Number(month.slice(5, 7)); return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; };
