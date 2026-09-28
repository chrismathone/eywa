import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { JandiPayload } from "../format";

/**
 * 잔디 웹훅 저장소(0294a `jandi_webhooks`) + 발송 — 서버 전용.
 * 🔴 표는 service_role만 읽는다(정책 0, 권한 회수) → 여기 함수들은 **게이트를 통과한 호출부**만 부른다.
 */
export type JandiRow = { webhookUrl: string; eventTypes: string[]; updatedAt: string | null };
export type JandiLoad = { status: "ok"; row: JandiRow | null } | { status: "missing_table" } | { status: "error" };

function isMissingTable(err: { code?: string; message?: string }): boolean {
  const msg = err.message ?? "";
  return err.code === "42P01" || err.code === "PGRST205" || (/jandi_webhooks/.test(msg) && /schema cache|does not exist/.test(msg));
}

export async function loadJandiRow(tenantId: string): Promise<JandiLoad> {
  try {
    const { data, error } = await createAdminClient()
      .from("jandi_webhooks")
      .select("webhook_url, event_types, updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return isMissingTable(error) ? { status: "missing_table" } : { status: "error" };
    if (!data) return { status: "ok", row: null };
    return {
      status: "ok",
      row: {
        webhookUrl: (data.webhook_url as string) ?? "",
        eventTypes: (data.event_types as string[] | null) ?? [],
        updatedAt: (data.updated_at as string | null) ?? null,
      },
    };
  } catch {
    return { status: "error" };
  }
}

export async function saveJandiRow(
  tenantId: string,
  userId: string,
  patch: { webhookUrl?: string; eventTypes?: string[] },
): Promise<{ error?: string }> {
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_by: userId, updated_at: new Date().toISOString() };
  if (patch.webhookUrl !== undefined) row.webhook_url = patch.webhookUrl;
  if (patch.eventTypes !== undefined) row.event_types = patch.eventTypes;
  const { error } = await createAdminClient().from("jandi_webhooks").upsert(row, { onConflict: "tenant_id" });
  if (!error) return {};
  if (isMissingTable(error)) return { error: "잔디 연결 표가 아직 DB에 없습니다(0294a 적용 필요)" };
  return { error: "잔디 설정을 저장하지 못했습니다" };
}

/** 잔디로 한 통 보낸다. 5초 안에 답이 없으면 실패. status null = 네트워크·시간 초과. */
export async function postToJandi(url: string, payload: JandiPayload): Promise<{ ok: boolean; status: number | null }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/vnd.tosslab.jandi-v2+json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}
