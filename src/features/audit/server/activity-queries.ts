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

// === 최근 접속(로그인) — login_events(수동, 영구) + auth.sessions(자동 판별, 라이브) ===

export type LoginEventRow = { id: string; at: string; userAgent: string | null; ip: string | null };
export type AccessSession = {
  sessionId: string;
  startedAt: string;
  lastActive: string;
  userAgent: string | null;
  ip: string | null;
  auto: boolean; // 세션이 오래전 시작됐는데 지금도 활동 = 자동 로그인(세션 유지)
};

const AUTO_GAP_MS = 12 * 3600_000; // 시작~마지막활동 12h+ 벌어지면 지속 세션(자동) 판정

/** 그 직원의 수동 로그인 기록(영구, 최신순). RLS 사무실만. */
export async function getStaffLoginEvents(userId: string, limit = 10): Promise<LoginEventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("login_events")
    .select("id, at, user_agent, ip")
    .eq("user_id", userId)
    .order("at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id,
    at: r.at,
    userAgent: (r.user_agent as string | null) ?? null,
    ip: (r.ip as string | null) ?? null,
  }));
}

/** 그 직원의 활성 세션(auth.sessions, 사무실·동일테넌트만 — get_staff_recent_access 0082a). 자동 판별 포함. */
export async function getStaffRecentAccess(userId: string): Promise<AccessSession[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_staff_recent_access", { target: userId });
  return ((data as Array<Record<string, unknown>>) ?? []).map((r) => {
    const startedAt = String(r.started_at);
    const lastActive = String(r.last_active);
    return {
      sessionId: String(r.session_id),
      startedAt,
      lastActive,
      userAgent: (r.user_agent as string | null) ?? null,
      ip: (r.ip as string | null) ?? null,
      auto: new Date(lastActive).getTime() - new Date(startedAt).getTime() > AUTO_GAP_MS,
    };
  });
}
