import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";

/** '시간이 바뀐 수업'으로 보는 기간 — 배치가 이 날수 안에 새로 시작됐으면 바뀐 것(사용자 2026-10-29). */
export const SCHEDULE_CHANGE_DAYS = 14;

/**
 * 탑승 학생 시간표의 **최근에 시간이 바뀐 수업 배치** — 배치 id → 시작일(`valid_from`).
 * 수업 시간표는 시간을 바꾸면 옛 배치를 어제까지로 닫고 **새 배치를 그날부터** 연다(행 분할) — 그래서 새 배치의 시작일이 곧 바뀐 날이다.
 * 🔑 수업 섹션 표(`class_schedules`)를 **읽기만** 한다(셔틀 섹션 밖은 고치지 않는다 — 사용자 2026-10-28).
 * 🔒 부르는 쪽이 권한을 확인한 뒤 그 학원으로 부른다. admin 클라이언트라 **tenant_id 필터 필수**([[#104]]). 대량 id는 청크(B3).
 * ⚠️ 실패하면 빈 맵(바뀐 수업 표시만 빠진다 — 보강 겹침은 그대로 뜬다).
 */
export async function loadRecentScheduleChanges(tenantId: string, slotIds: readonly string[], sinceYmd: string): Promise<Map<string, string>> {
  if (slotIds.length === 0) return new Map();
  try {
    const admin = createAdminClient();
    const rows = await fetchInChunks<{ id: string; valid_from: string }>([...new Set(slotIds)], (chunk) =>
      admin.from("class_schedules").select("id, valid_from").eq("tenant_id", tenantId).in("id", chunk).gte("valid_from", sinceYmd),
    );
    return new Map(rows.map((r) => [r.id, String(r.valid_from).slice(0, 10)]));
  } catch (e) {
    reportError(e, { scope: "shuttle.scheduleChanges" });
    return new Map();
  }
}
