"use server";
import { logAction } from "@/features/audit/server/log";
import { revalidatePath } from "next/cache";
import { SettingsInput } from "../protocol";
import { agentDb } from "./db";
import { AgentError, generateCode, privateHash, rateLimit, requireManager } from "./security";
import { deviceConfiguration } from "./control";

async function action<T>(fn: () => Promise<T>): Promise<{ data?: T; error?: string }> {
  try { return { data: await fn() }; }
  catch (error) { return { error: error instanceof AgentError && error.status !== 429 ? error.code : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }; }
}
export async function getAgentDashboard() {
  return action(async () => {
    const user = await requireManager(); const sql = agentDb();
    await sql`update sync_agent_devices set revoked_at=now() where tenant_id=${user.tenantId} and revoke_requested_at is not null
      and revoked_at is null and (lease_until is null or lease_until<=clock_timestamp())`;
    const [devices, events, releases, configuration] = await Promise.all([
      sql`select id,name,version,last_seen_at,status,created_at,lease_until,revoke_requested_at from sync_agent_devices where tenant_id=${user.tenantId} and revoked_at is null`,
      sql`select event_id,received_at,kind,module,level,detail from sync_agent_events where tenant_id=${user.tenantId} order by received_at desc limit 100`,
      sql`select version,installer_url from sync_agent_releases where revoked_at is null order by sequence desc limit 1`,
      deviceConfiguration({ id: "", tenantId: user.tenantId }),
    ]);
    return { device: devices[0] ? JSON.parse(JSON.stringify(devices[0])) as { id: string; name: string; version: string | null; last_seen_at: string | null; status: Record<string, unknown>; created_at: string; lease_until: string | null; revoke_requested_at: string | null } : null,
      events: JSON.parse(JSON.stringify(events)) as Array<{ event_id: string; received_at: string; kind: string; module: string; level: string; detail: Record<string, unknown> }>,
      release: releases[0] ? { version: String(releases[0].version), url: String(releases[0].installer_url) } : null, configuration };
  });
}
export async function issueAgentCode() {
  return action(async () => {
    const user = await requireManager(); await rateLimit(`issue:${user.id}`, 5);
    const sql = agentDb();
    const config = await deviceConfiguration({ id: "", tenantId: user.tenantId });
    if (!config.classnoteEnabled && !config.makeeduEnabled) throw new AgentError(403, "사용 가능한 PC 연동을 먼저 켜 주세요.");
    const result = await sql.begin(async (tx) => {
      await tx`select id from tenants where id=${user.tenantId} for update`;
      const active = await tx`select id from sync_agent_devices where tenant_id=${user.tenantId} and revoked_at is null`;
      if (active.length) throw new AgentError(409, "현재 연결된 PC를 해제한 뒤 새 코드를 발급해 주세요.");
      const code = generateCode();
      const [saved] = await tx`insert into sync_agent_codes(tenant_id,code_hash,issued_by,expires_at)
        values(${user.tenantId},${privateHash(`code:${code}`)},${user.id},clock_timestamp()+interval '15 minutes')
        on conflict(tenant_id) do update set code_hash=excluded.code_hash,issued_by=excluded.issued_by,
          issued_at=clock_timestamp(),expires_at=excluded.expires_at,consumed_by=null,consumed_at=null returning expires_at`;
      return { code, expiresAt: new Date(saved!.expires_at).toISOString() };
    });
    await logAction({action:"sync_agent_manage",targetType:"tenant_settings",targetLabel:"연동 PC",metadata:{summary:"지점 연결 코드 발급"}});
    return result;
  });
}
export async function saveAgentSettings(input: unknown) {
  return action(async () => {
    const user = await requireManager(); const p = SettingsInput.safeParse(input);
    if (!p.success) throw new AgentError(400, "설정 값을 확인해 주세요.");
    const sql = agentDb();
    await sql.begin(async (tx) => {
      await tx`insert into sync_agent_settings(tenant_id) values(${user.tenantId}) on conflict do nothing`;
      const saved = await tx`update sync_agent_settings set enabled=${p.data.enabled},classnote_enabled=${p.data.classnoteEnabled},
        makeedu_enabled=${p.data.makeeduEnabled},updates_enabled=${p.data.updatesEnabled},revision=revision+1,updated_at=now(),updated_by=${user.id}
        where tenant_id=${user.tenantId} and revision=${p.data.revision} returning revision`;
      if (!saved.length) throw new AgentError(409, "설정이 변경되었습니다. 새로고침한 뒤 다시 저장해 주세요.");
    });
    await logAction({action:"sync_agent_manage",targetType:"tenant_settings",targetLabel:"연동 PC",metadata:{summary:"실행·업데이트 설정 변경",...p.data}});
    revalidatePath("/owner"); return { ok: true };
  });
}
export async function revokeAgentDevice(deviceId: string) {
  return action(async () => {
    const user = await requireManager(); const sql = agentDb();
    await sql.begin(async (tx) => {
      const [device] = await tx`select id,lease_until,status from sync_agent_devices where id=${deviceId} and tenant_id=${user.tenantId} and revoked_at is null for update`;
      if (!device) throw new AgentError(404, "연결된 PC를 찾지 못했습니다.");
      // Wait out the existing lease; an offline PC must not overlap its replacement.
      if (device.lease_until && new Date(device.lease_until).getTime() > Date.now()) {
        await tx`update sync_agent_devices set revoke_requested_at=now() where id=${deviceId}`;
        return;
      }
      await tx`update sync_agent_devices set revoked_at=now() where id=${deviceId}`;
      await tx`delete from sync_agent_codes where tenant_id=${user.tenantId}`;
    });
    await logAction({action:"sync_agent_manage",targetType:"tenant_settings",targetLabel:"연동 PC",metadata:{summary:"PC 연결 해제 요청",deviceId}});
    revalidatePath("/owner"); return { ok: true };
  });
}
export async function issueAgentManagementCode() {
  return action(async()=>{
    const user=await requireManager();await rateLimit(`manage-issue:${user.id}`,5);const sql=agentDb();
    const code=generateCode();
    const [saved]=await sql`insert into sync_agent_management_codes(device_id,code_hash,expires_at,issued_by)
      select id,${privateHash(`manage:${code}`)},clock_timestamp()+interval '10 minutes',${user.id}
      from sync_agent_devices where tenant_id=${user.tenantId} and revoked_at is null and revoke_requested_at is null
      on conflict(device_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,issued_by=excluded.issued_by,consumed_at=null returning expires_at`;
    if(!saved)throw new AgentError(404,"연결된 PC를 찾지 못했습니다.");
    await logAction({action:"sync_agent_manage",targetType:"tenant_settings",targetLabel:"연동 PC",metadata:{summary:"PC 설정 관리 코드 발급"}});
    return {code,expiresAt:new Date(saved.expires_at).toISOString()};
  });
}
