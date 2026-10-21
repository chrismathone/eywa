import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import type { StatsPeriod } from "@/features/stats/period";
import type { OpsDaily } from "../ops-daily";
import type { OpsDay } from "../ops-series";

/**
 * 매일 기록의 운영 칸 조회 — `student_daily_stats`(0381a)는 서버 전용(정책 0개)이라 **호출부가 권한(콜&상담 · 신규생 메뉴)을 확인한 뒤**
 * 관리 키 + tenant_id로 읽는다([[#104]]). 운영 칸(`data->ops`)만 받는다(재원생 구성은 원생 통계가 따로 읽는다).
 */
export async function loadOpsHistory(tenantId: string, period: StatsPeriod, today: string): Promise<OpsDay[]> {
  const from = period.grain === "month" ? `${period.months[0]}-01` : period.from;
  const to = period.grain === "month" ? today : period.to;
  const admin = createAdminClient();
  const rows = await fetchAllPaged<{ stat_date: string; ops: unknown }>((a, b) =>
    admin
      .from("student_daily_stats")
      .select("stat_date, ops:data->ops")
      .eq("tenant_id", tenantId)
      .gte("stat_date", from)
      .lte("stat_date", to)
      .order("stat_date")
      .range(a, b),
  );
  // jsonb 칸이라 모양을 믿지 않는다 — 객체가 아니면 그날 기록 없음.
  return rows.map((r) => ({ date: String(r.stat_date).slice(0, 10), ops: r.ops && typeof r.ops === "object" && !Array.isArray(r.ops) ? (r.ops as OpsDaily) : null }));
}
