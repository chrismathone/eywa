import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeSlackRoutes, type SlackRoute } from "../format";

/**
 * 슬랙 연결 저장소(0297a `slack_connections`, 지점당 1행) — 서버 전용.
 * 🔴 표는 service_role만 읽는다(정책 0, 권한 회수) → 여기 함수들은 **게이트를 통과한 호출부**만 부른다.
 */
export type SlackRow = { botToken: string; teamName: string; routes: SlackRoute[]; updatedAt: string | null };
export type SlackLoad = { status: "ok"; row: SlackRow | null } | { status: "missing_table" } | { status: "error" };

export const SLACK_TABLE_MISSING_MESSAGE = "슬랙 연결 표가 아직 DB에 없습니다(0297a 적용 필요)";

function isMissingTable(err: { code?: string; message?: string }): boolean {
  const msg = err.message ?? "";
  return err.code === "42P01" || err.code === "PGRST205" || (/slack_connections/.test(msg) && /schema cache|does not exist/.test(msg));
}

export async function loadSlackRow(tenantId: string): Promise<SlackLoad> {
  try {
    const { data, error } = await createAdminClient()
      .from("slack_connections")
      .select("bot_token, team_name, routes, updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return isMissingTable(error) ? { status: "missing_table" } : { status: "error" };
    if (!data) return { status: "ok", row: null };
    return {
      status: "ok",
      row: {
        botToken: (data.bot_token as string) ?? "",
        teamName: (data.team_name as string) ?? "",
        routes: sanitizeSlackRoutes(data.routes),
        updatedAt: (data.updated_at as string | null) ?? null,
      },
    };
  } catch {
    return { status: "error" };
  }
}

export async function saveSlackRow(
  tenantId: string,
  userId: string,
  patch: { botToken?: string; teamName?: string; routes?: SlackRoute[] },
): Promise<{ error?: string }> {
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_by: userId, updated_at: new Date().toISOString() };
  if (patch.botToken !== undefined) row.bot_token = patch.botToken;
  if (patch.teamName !== undefined) row.team_name = patch.teamName;
  if (patch.routes !== undefined) row.routes = patch.routes;
  const { error } = await createAdminClient().from("slack_connections").upsert(row, { onConflict: "tenant_id" });
  if (!error) return {};
  if (isMissingTable(error)) return { error: SLACK_TABLE_MISSING_MESSAGE };
  return { error: "슬랙 설정을 저장하지 못했습니다" };
}
