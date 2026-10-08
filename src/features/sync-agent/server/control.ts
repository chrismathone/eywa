import "server-only";
import { z } from "zod";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { AGENT_PROTOCOL, BeatInput, EventInput, LeaseInput, PairInput } from "../protocol";
import { agentDb } from "./db";
import { AgentError, digestSecret, privateHash, rateLimit } from "./security";

export async function pairDevice(input: unknown, ip: string) {
  await rateLimit("pair:global", 120);
  await rateLimit(`pair:ip:${ip}`, 10);
  const parsed = PairInput.safeParse(input);
  if (!parsed.success) throw new AgentError(400, "invalid_code");
  const p = parsed.data;
  await rateLimit(`pair:device:${p.deviceId}`, 10);
  const sql = agentDb();
  return sql.begin(async (tx) => {
    const [code] = await tx`select * from sync_agent_codes where code_hash=${privateHash(`code:${p.code}`)} for update`;
    if (!code) throw new AgentError(400, "invalid_code");
    // A response lost after commit can be recovered only by the very same secret/device.
    if (code.consumed_by === p.deviceId) {
      const [prior] = await tx`select id from sync_agent_devices where id=${p.deviceId} and token_hash=${digestSecret(p.secret)} and revoked_at is null`;
      if (!prior) throw new AgentError(400, "invalid_code");
    } else {
      if (code.consumed_by || new Date(code.expires_at).getTime() <= Date.now()) throw new AgentError(400, "invalid_code");
      const registered = await tx`insert into sync_agent_devices(id,tenant_id,token_hash,name)
        values(${p.deviceId},${code.tenant_id},${digestSecret(p.secret)},${p.name}) on conflict do nothing returning id`;
      if (!registered.length) throw new AgentError(409, "device_exists");
      await tx`update sync_agent_codes set consumed_by=${p.deviceId},consumed_at=now() where tenant_id=${code.tenant_id}`;
      await tx`insert into sync_agent_settings(tenant_id) values(${code.tenant_id}) on conflict do nothing`;
    }
    const [tenant] = await tx`select name from tenants where id=${code.tenant_id}`;
    return { deviceId: p.deviceId, tenantId: code.tenant_id, tenantName: tenant?.name ?? "연결된 지점", protocol: AGENT_PROTOCOL };
  });
}

export async function deviceConfiguration(device: { id: string; tenantId: string }) {
  const sql = agentDb();
  const [rows, tenantSettings, tenants] = await Promise.all([
    sql`select enabled,classnote_enabled,makeedu_enabled,updates_enabled,revision,cutover_at from sync_agent_settings where tenant_id=${device.tenantId}`,
    getTenantSettingsByTenantId(device.tenantId),
    sql`select name from tenants where id=${device.tenantId}`,
  ]);
  const s = rows[0];
  return {
    protocol: AGENT_PROTOCOL, tenantId: device.tenantId, tenantName: tenants[0]?.name ?? "연결된 지점",
    revision: Number(s?.revision ?? 1), enabled: s?.enabled !== false,
    classnoteEnabled: s?.classnote_enabled !== false && isModuleEnabled(tenantSettings.modules.disabled, "classnote"),
    makeeduEnabled: s?.makeedu_enabled !== false && isModuleEnabled(tenantSettings.modules.disabled, "makeedu"),
    updatesEnabled: s?.updates_enabled !== false, cutoverReady: !!s?.cutover_at,
    pollMs: 20_000, leaseMs: 90_000,
  };
}
export async function acquireDevice(device: { id: string; tenantId: string }, input: unknown) {
  const p = LeaseInput.safeParse(input); if (!p.success) throw new AgentError(400, "invalid_input");
  const sql = agentDb();
  const [row] = await sql`select * from claim_sync_agent(${device.id},${p.data.instanceId},${p.data.version})`;
  if (!row) throw new AgentError(409, "device_busy");
  return { generation: String(row.generation), remainingMs: Number(row.remaining_ms) };
}
export async function heartbeatDevice(device: { id: string; tenantId: string }, input: unknown) {
  const p = BeatInput.safeParse(input); if (!p.success) throw new AgentError(400, "invalid_input");
  const sql = agentDb();
  const [row] = await sql`update sync_agent_devices set last_seen_at=clock_timestamp(),version=${p.data.version},
    status=${sql.json(p.data.status)},lease_until=clock_timestamp()+interval '90 seconds'
    where id=${device.id} and revoked_at is null and revoke_requested_at is null and instance_id=${p.data.instanceId}
      and generation=${p.data.generation}::bigint and lease_until>clock_timestamp()
    returning floor(extract(epoch from(lease_until-clock_timestamp()))*1000)::bigint remaining_ms`;
  if (!row) throw new AgentError(409, "lease_lost");
  const config=await deviceConfiguration(device);
  await sql`update sync_agent_module_sessions set stop_after=coalesce(stop_after,clock_timestamp()+interval '2 hours')
    where device_id=${device.id} and instance_id=${p.data.instanceId} and generation=${p.data.generation}::bigint
      and (not ${config.enabled} or case when module='classnote' then not ${config.classnoteEnabled} else not ${config.makeeduEnabled} end)`;
  return { remainingMs: Number(row.remaining_ms), config };
}
export async function releaseDevice(device: { id: string; tenantId: string }, input: unknown) {
  const p = z.object({ instanceId: z.string().uuid(), generation: z.string().regex(/^[1-9]\d{0,17}$/) }).strict().safeParse(input);
  if (!p.success) throw new AgentError(400, "invalid_input");
  const sql = agentDb();
  await sql`update sync_agent_devices set lease_until=clock_timestamp(),revoked_at=case when revoke_requested_at is not null then clock_timestamp() else revoked_at end
    where id=${device.id} and instance_id=${p.data.instanceId} and generation=${p.data.generation}::bigint`;
  return { ok: true };
}
export async function storeDeviceEvents(device: { id: string; tenantId: string }, input: unknown) {
  const p = z.object({ events: z.array(EventInput).max(50) }).strict().safeParse(input);
  if (!p.success) throw new AgentError(400, "invalid_input");
  await rateLimit(`events:${device.id}`, 20);
  const sql = agentDb();
  await sql.begin(async (tx) => {
    const active = await tx`select id from sync_agent_devices where id=${device.id} and revoked_at is null for share`;
    if (!active.length) throw new AgentError(401, "unauthorized");
    for (const event of p.data.events) {
      await tx`insert into sync_agent_events(device_id,tenant_id,event_id,occurred_at,kind,module,level,detail)
        values(${device.id},${device.tenantId},${event.id},${event.at},${event.kind},${event.module},${event.level},${tx.json(event.detail)})
        on conflict do nothing`;
    }
    await tx`delete from sync_agent_events where tenant_id=${device.tenantId} and received_at<now()-interval '30 days'`;
    await tx`delete from sync_agent_attempts where bucket<now()-interval '1 day'`;
  });
  return { accepted: p.data.events.map((event) => event.id) };
}
