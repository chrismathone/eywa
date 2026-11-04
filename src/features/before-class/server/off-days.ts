import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";

/**
 * 쉰 날(원장 2026-11-02 *"휴일은 수업일로 왜 쳐야해? 말이안되자나"*) — 반마다 `날짜 → 휴일 이름`, [from, to] 안만.
 * 휴일 = 학원설정 `operations.holidays`(단일 소스, [[class-sheets/lib/holiday.ts]] — 내장 법정공휴일 표는 안 쓴다).
 * 🔴 휴일에도 실제로 수업한 반이 있다(실측 2026-08-17 대체공휴일 출결 21행) — 그날 이 반에 **체크리스트 기록이나 출석부 기록이
 *    하나라도 있으면** 수업한 날로 두고, 둘 다 없을 때만 쉰 날로 뺀다(작성률의 휴일 규약과 같은 결: 쓴 휴일은 인정).
 * 쉰 날은 통계('체크 없는 날 = 모두 해 옴')와 '지난 수업' 찾기에서 빠진다. 칸을 없애거나 잠그지는 않는다(그날 수업했다면 체크할 수 있게).
 * 실패하면 빈 값(지금처럼 휴일도 수업일) — 화면을 막지 않는다.
 */
export async function loadOffDays(
  tenantId: string, classIds: readonly string[], from: string, to: string,
): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  if (classIds.length === 0) return out;
  try {
    const settings = await getTenantSettingsByTenantId(tenantId);
    const holidays = Object.entries(buildHolidayMap(settings.operations.holidays)).filter(([d]) => d >= from && d <= to);
    if (holidays.length === 0) return out;
    const dates = holidays.map(([d]) => d);
    const admin = createAdminClient();
    const ids = [...classIds];
    const [checks, attendance] = await Promise.all([
      admin.from("before_class_checks").select("class_id, check_date").eq("tenant_id", tenantId).in("class_id", ids).in("check_date", dates),
      admin.from("attendance_records").select("class_id, session_date").eq("tenant_id", tenantId).in("class_id", ids).in("session_date", dates),
    ]);
    if (checks.error) throw new Error(`before_class_checks: ${checks.error.message}`);
    if (attendance.error) throw new Error(`attendance_records: ${attendance.error.message}`);
    // 휴일 몇 날 × 반 몇 개라 행이 적다 — 그래도 1000행을 넘으면 '수업한 날'을 놓쳐 쉰 날로 잘못 뺀다([[#54]]). 넘으면 빼지 않는다.
    if ((checks.data?.length ?? 0) >= 1000 || (attendance.data?.length ?? 0) >= 1000) return out;
    const held = new Set<string>();
    for (const r of checks.data ?? []) held.add(`${r.class_id}|${r.check_date}`);
    for (const r of attendance.data ?? []) held.add(`${r.class_id}|${r.session_date}`);
    for (const id of ids) {
      const off: Record<string, string> = {};
      for (const [d, name] of holidays) if (!held.has(`${id}|${d}`)) off[d] = name;
      out.set(id, off);
    }
    return out;
  } catch (e) {
    console.error("[before-class] 휴일 판정 실패 — 휴일도 수업일로 진행", e);
    return out;
  }
}
