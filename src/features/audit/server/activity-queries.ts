import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ActivityOp, ActivityChange } from "../activity";

// 활동 로그 조회 — activity_log RLS(0081a)가 사무실(master/admin/manager)만 통과시킨다(비-사무실은 0행).
// 선생님별 = actor_id로 필터(그 사람이 한 변경). 소량 페이지네이션(호출부 슬라이스 대신 range).

export type ActivityRow = {
  id: string;
  table: string;
  op: ActivityOp;
  targetLabel: string | null;
  changed: Record<string, ActivityChange> | null;
  createdAt: string;
};

export type ActivityPage = { rows: ActivityRow[]; total: number };

const PAGE_SIZE = 30;

/** 특정 직원(actor)이 한 변경 이력(최신순). page는 1-base. */
export async function getStaffActivityLog(actorId: string, page = 1): Promise<ActivityPage> {
  const supabase = await createClient();
  const from = (Math.max(1, page) - 1) * PAGE_SIZE;
  const { data, count } = await supabase
    .from("activity_log")
    .select("id, table_name, op, target_label, changed, created_at", { count: "exact" })
    .eq("actor_id", actorId)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  const rows: ActivityRow[] = (data ?? []).map((r) => ({
    id: r.id,
    table: r.table_name,
    op: r.op as ActivityOp,
    targetLabel: (r.target_label as string | null) ?? null,
    changed: (r.changed as Record<string, ActivityChange> | null) ?? null,
    createdAt: r.created_at,
  }));
  return { rows, total: count ?? rows.length };
}

export const ACTIVITY_PAGE_SIZE = PAGE_SIZE;
