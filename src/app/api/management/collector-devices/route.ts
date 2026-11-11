import { z } from "zod";
import { managementAccess } from "@/features/management/server/access";
import { collectorEnabled, newCollectorIdentity } from "@/features/management/server/collector-auth";
import { collectorOrigin, collectorScope } from "@/features/management/collector-contract";
import { forbidden, noStore, sameOrigin, wrongOrigin } from "@/features/management/server/http";
import { isCollectorDeployed } from "@/features/management/collector-switch";
import { logAction } from "@/features/audit/server/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/db-error";

export const runtime = "nodejs";
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable"), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("create"), name: z.string().trim().min(1).max(60), scopeConfirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("revoke"), id: z.uuid() }).strict(),
]);
const NOT_DEPLOYED = "학원 PC 수집기는 아직 준비 중입니다. 파일을 직접 올려 주세요.";
const audit = (summary: string, metadata: Record<string, unknown> = {}) => logAction({ action: "management_collector_manage", targetType: "management_collection_devices", targetLabel: "경영 분석 PC 수집기", metadata: { summary, ...metadata } });
const failed = () => noStore({ error: "수집 연결을 처리하지 못했습니다. 접근 권한과 입력을 확인해 주세요." }, 400);

/** 원장 전용 — 지점 스위치 상태와 이 지점의 수집 PC 목록(비밀·해시는 내보내지 않는다). */
export async function GET() {
  let user;
  try { user = await managementAccess(true); } catch { return forbidden(); }
  const [enabled, r] = await Promise.all([
    collectorEnabled(user.tenantId),
    createAdminClient().from("management_collection_devices").select("id,name,created_at,expires_at,revoked_at,last_seen_at,last_success_at,last_result").eq("tenant_id", user.tenantId).order("created_at", { ascending: false }).limit(100),
  ]);
  if (r.error) { logDbError(r.error, "management.collector_devices"); return noStore({ error: "수집 연결을 조회하지 못했습니다" }, 500); }
  return noStore({ available: isCollectorDeployed(), enabled: isCollectorDeployed() && enabled, devices: r.data });
}

/** 켜기·끄기 / 연결 파일 발급(켜져 있을 때만 · 비밀은 이 응답에서 한 번만) / 연결 해제. */
export async function POST(request: Request) {
  let user;
  try { user = await managementAccess(true); } catch { return forbidden(); }
  if (!sameOrigin(request)) return wrongOrigin();
  try {
    const text = await request.text();
    if (text.length > 2000) return failed();
    const v = input.parse(JSON.parse(text)), db = createAdminClient();
    // 배포 스위치가 꺼져 있으면 켜기·발급은 거절한다(끄기·해제는 늘 된다).
    if (!isCollectorDeployed() && (v.action === "create" || (v.action === "enable" && v.enabled))) return noStore({ error: NOT_DEPLOYED }, 409);
    if (v.action === "enable") {
      const r = await db.from("management_collection_settings").upsert({ tenant_id: user.tenantId, collector_enabled: v.enabled, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
      if (r.error) { logDbError(r.error, "management.collector_toggle"); return failed(); }
      await audit(v.enabled ? "PC 수집기 켜기" : "PC 수집기 끄기", { enabled: v.enabled });
      return noStore({ enabled: v.enabled });
    }
    if (v.action === "revoke") {
      const r = await db.from("management_collection_devices").update({ revoked_at: new Date().toISOString() }).eq("id", v.id).eq("tenant_id", user.tenantId).is("revoked_at", null).select("id");
      if (r.error) { logDbError(r.error, "management.collector_revoke"); return failed(); }
      if (r.data.length) await audit("수집 PC 연결 해제", { deviceId: v.id });
      return noStore({ revoked: r.data.length });
    }
    if (!(await collectorEnabled(user.tenantId))) return noStore({ error: "PC 수집기를 먼저 켜 주세요." }, 409);
    const identity = newCollectorIdentity(), expiresAt = new Date(Date.now() + 90 * 86400_000).toISOString();
    const r = await db.from("management_collection_devices").insert({ id: identity.id, tenant_id: user.tenantId, created_by: user.id, name: v.name, secret_hash: identity.hash, expires_at: expiresAt });
    if (r.error) { logDbError(r.error, "management.collector_create"); return failed(); }
    // 감사로그에는 기기 번호·이름·만료만 — 토큰 원문·해시는 남기지 않는다.
    await audit("수집 PC 연결 파일 발급", { deviceId: identity.id, name: v.name, expiresAt });
    // 비밀 원문은 이 한 번만 원장에게 내려간다(로그·목록에 남기지 않는다). 파일 이름은 ASCII만(B1).
    return new Response(JSON.stringify({ version: 1, baseUrl: collectorOrigin, scope: collectorScope, tenantId: user.tenantId, deviceId: identity.id, token: identity.token, expiresAt }), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="aywa-collector-${identity.id}.json"`, "Cache-Control": "no-store" },
    });
  } catch { return failed(); }
}
