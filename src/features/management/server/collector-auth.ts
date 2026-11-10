import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { resolveMatrix, applyUserOverrides, canAccess, canWrite } from "@/lib/permissions";
import { capDisabledModules } from "@/lib/modules";
import { applyUserMenuBlocks } from "@/lib/auth/user-menu-blocks";
import type { CollectorResult } from "../collector-contract";
import { isCollectorDeployed } from "../collector-switch";

/** 기기 요청 오류 — `code`는 PC 프로그램이 읽는 짧은 영문 코드(화면에는 `collectorResultLabel`로만 나간다). */
export class CollectorError extends Error { constructor(public status: number, public code: string) { super(code); } }
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function newCollectorIdentity() { const id = randomUUID(), secret = randomBytes(32).toString("hex"); return { id, token: `${id}.${secret}`, hash: tokenHash(secret) }; }
export function parseCollectorToken(header: string | null) {
  const m = header?.match(/^Bearer ([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.([a-f0-9]{64})$/);
  if (!m) throw new CollectorError(401, "connection_required");
  return { id: m[1]!, hash: tokenHash(m[2]!) };
}

/** 지점 스위치(s2_0071 management_collection_settings) — 줄이 없거나 꺼져 있으면 false. 조회 실패는 꺼진 것으로(닫힌 쪽). */
export async function collectorEnabled(tenantId: string): Promise<boolean> {
  const r = await createAdminClient().from("management_collection_settings").select("collector_enabled").eq("tenant_id", tenantId).maybeSingle();
  return !r.error && r.data?.collector_enabled === true;
}

/**
 * 기기 요청 인증 — 지점·행위자는 **기기 줄에서만** 정한다(요청 본문의 지점 값을 믿지 않는다).
 * 순서: 배포 스위치(collector-switch.ts) → 토큰 모양 → 기기(만료·해제·비밀 대조) → 지점 스위치 → 만든 원장이 아직 재직 중 원장 + 경영 분석·수납 쓰기·원생·직원 열람 → 마지막 접속 기록.
 * rateLimit=true면 같은 기기의 2초 안 연속 요청을 429로 돌려보낸다(동시 해제와도 경합하지 않게 조건부 갱신).
 */
export async function collectorAccess(header: string | null, rateLimit = false) {
  if (!isCollectorDeployed()) throw new CollectorError(403, "collector_disabled");
  const parsed = parseCollectorToken(header), db = createAdminClient();
  const row = await db.from("management_collection_devices").select("id,tenant_id,created_by,secret_hash,expires_at,revoked_at").eq("id", parsed.id).maybeSingle();
  if (row.error) throw new CollectorError(503, "connection_unavailable");
  const d = row.data;
  const expires = d ? Date.parse(d.expires_at) : NaN;
  if (!d || d.revoked_at || !Number.isFinite(expires) || expires <= Date.now() || !/^[a-f0-9]{64}$/.test(d.secret_hash)
    || !timingSafeEqual(Buffer.from(d.secret_hash, "hex"), Buffer.from(parsed.hash, "hex"))) throw new CollectorError(401, "connection_expired_or_revoked");
  if (!(await collectorEnabled(d.tenant_id))) throw new CollectorError(403, "collector_disabled");
  const [actor, settings] = await Promise.all([
    db.from("users").select("id,tenant_id,status,system_role").eq("id", d.created_by).eq("tenant_id", d.tenant_id).maybeSingle(),
    getTenantSettingsByTenantId(d.tenant_id, { failOnReadError: true }).catch(() => null),
  ]);
  if (actor.error || !settings) throw new CollectorError(503, "connection_unavailable");
  if (!actor.data || actor.data.system_role !== "master" || actor.data.status !== "active") throw new CollectorError(403, "owner_access_changed");
  const matrix = applyUserMenuBlocks(capDisabledModules(applyUserOverrides(resolveMatrix(settings.permissions.overrides), d.created_by, "master", settings.permissions.userOverrides), settings.modules.disabled), d.created_by, ["master"]);
  const readable = (["management", "billing", "students", "staff"] as const).every((k) => canAccess("master", k, matrix));
  if (!readable || !canWrite("master", "management", matrix) || !canWrite("master", "billing", matrix)) throw new CollectorError(403, "owner_access_changed");
  const now = new Date().toISOString();
  let q = db.from("management_collection_devices").update(rateLimit ? { last_seen_at: now, last_request_at: now } : { last_seen_at: now })
    .eq("id", d.id).eq("tenant_id", d.tenant_id).is("revoked_at", null).gt("expires_at", now);
  if (rateLimit) q = q.lt("last_request_at", new Date(Date.now() - 2000).toISOString());
  const touched = await q.select("id");
  if (touched.error) throw new CollectorError(503, "connection_unavailable");
  if (!touched.data.length) throw new CollectorError(429, "retry_later");
  return { id: d.created_by, tenantId: d.tenant_id as string, deviceId: d.id as string };
}

export async function recordCollectorResult(user: { tenantId: string; deviceId: string }, result: CollectorResult) {
  const r = await createAdminClient().from("management_collection_devices")
    .update({ last_result: result, ...(result.code === "saved" ? { last_success_at: new Date().toISOString() } : {}) })
    .eq("id", user.deviceId).eq("tenant_id", user.tenantId).is("revoked_at", null);
  if (r.error) throw new CollectorError(503, "status_unavailable");
}
