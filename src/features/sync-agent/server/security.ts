import "server-only";
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { tenantViewWriteError } from "@/lib/auth/tenant-view";
import { agentDb } from "./db";

export class AgentError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export const digestSecret = (value: string) => createHash("sha256").update(value).digest("hex");
export function privateHash(value: string) {
  const key = process.env.SYNC_AGENT_CODE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new AgentError(503, "unavailable");
  return createHmac("sha256", key).update(`sync-agent:v1:${value}`).digest("hex");
}
export const generateCode = () => String(randomInt(0, 1_000_000_000_000)).padStart(12, "0");
export async function requireManager() {
  const user = await getCurrentUser();
  if (!user || !["master", "admin"].includes(user.systemRole) || !(await canWriteTenant(user.systemRole, "integration_settings")))
    throw new AgentError(403, "권한을 확인해 주세요.");
  // 운영 콘솔의 '지점 보기'(읽기 전용)에서는 연동 PC를 관리하지 않는다 — 이 모듈은 DB에 직접 접속해 데이터 접근 층의 쓰기 차단을
  // 지나지 않는다(위 쓰기 권한 문이 이미 거절하지만, 그 문이 바뀌어도 여기서 멈춘다).
  if (await tenantViewWriteError()) throw new AgentError(403, "권한을 확인해 주세요.");
  return user;
}
export async function rateLimit(key: string, limit: number) {
  const sql = agentDb();
  const [row] = await sql`
    insert into sync_agent_attempts(key_hash,bucket,attempts) values(${privateHash(key)},date_trunc('minute',now()),1)
    on conflict(key_hash) do update set
      attempts=case when sync_agent_attempts.bucket=date_trunc('minute',now()) then sync_agent_attempts.attempts+1 else 1 end,
      bucket=date_trunc('minute',now()) returning attempts`;
  if (Number(row.attempts) > limit) throw new AgentError(429, "slow_down");
}
export async function authenticate(request: Request) {
  const match = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization") ?? "");
  if (!match || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(match[1]!)) throw new AgentError(401, "unauthorized");
  const sql = agentDb();
  const [device] = await sql`select id,tenant_id,token_hash,revoked_at,instance_id,generation,lease_until from sync_agent_devices where id=${match[1]!}`;
  const supplied = Buffer.from(digestSecret(match[2]!), "hex");
  const expected = Buffer.from(device?.token_hash ?? "0".repeat(64), "hex");
  if (!timingSafeEqual(supplied, expected) || !device || device.revoked_at) throw new AgentError(401, "unauthorized");
  return { id: String(device.id), tenantId: String(device.tenant_id) };
}
export async function readBody(request: Request, max = 65536): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > max)) throw new AgentError(413, "too_large");
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AgentError(415, "invalid_type");
  if (!request.body) throw new AgentError(400, "invalid_input");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new AgentError(413, "too_large"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) { if (e instanceof AgentError) throw e; throw new AgentError(400, "invalid_input"); }
  finally { reader.releaseLock(); }
}
export async function agentRoute(fn: () => Promise<unknown>) {
  try { return Response.json(await fn(), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) {
    const known = e instanceof AgentError;
    return Response.json({ error: known ? e.code : "unavailable" }, { status: known ? e.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
