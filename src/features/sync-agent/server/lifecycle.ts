import "server-only";
import { z } from "zod";
import { agentDb } from "./db";
import { AgentError, privateHash, rateLimit } from "./security";
import { CodeInput } from "../protocol";
import { WorkEnvelope } from "./gateway";
import { deviceConfiguration } from "./control";

type Device = {id:string;tenantId:string};
export async function moduleSession(device:Device,input:unknown,stop:boolean) {
  const p=WorkEnvelope.strict().safeParse(input);if(!p.success)throw new AgentError(400,"invalid_input");
  const sql=agentDb();
  if(stop){await sql`delete from sync_agent_module_sessions where device_id=${device.id} and module=${p.data.module}
    and instance_id=${p.data.instanceId} and generation=${p.data.generation}::bigint`;return {ok:true};}
  const config=await deviceConfiguration(device);
  if(!config.enabled||!config.cutoverReady||!(p.data.module==='classnote'?config.classnoteEnabled:config.makeeduEnabled))throw new AgentError(403,"module_disabled");
  return sql.begin(async tx=>{
    const [d]=await tx`select d.id from sync_agent_devices d join sync_agent_settings s on s.tenant_id=d.tenant_id
      where d.id=${device.id} and d.tenant_id=${device.tenantId} and d.instance_id=${p.data.instanceId}
      and d.generation=${p.data.generation}::bigint and d.lease_until>clock_timestamp() and d.revoked_at is null and d.revoke_requested_at is null
      and s.enabled and s.cutover_at is not null and case when ${p.data.module}='classnote' then s.classnote_enabled else s.makeedu_enabled end for share of d,s`;
    if(!d)throw new AgentError(409,"lease_lost");
    // A same-session retry cannot reset its drain deadline.
    await tx`insert into sync_agent_module_sessions(device_id,module,instance_id,generation) values(${device.id},${p.data.module},${p.data.instanceId},${p.data.generation}::bigint)
      on conflict(device_id,module) do update set instance_id=excluded.instance_id,generation=excluded.generation,started_at=now(),stop_after=null
      where sync_agent_module_sessions.instance_id<>excluded.instance_id or sync_agent_module_sessions.generation<>excluded.generation`;
    return {ok:true};
  });
}
export async function unlockDevice(device:Device,input:unknown) {
  await rateLimit(`unlock:${device.id}`,5);
  const p=z.object({code:CodeInput}).strict().safeParse(input);
  if(!p.success)throw new AgentError(400,"invalid_code");
  const sql=agentDb();
  const rows=await sql`update sync_agent_management_codes set consumed_at=clock_timestamp()
    where device_id=${device.id} and code_hash=${privateHash(`manage:${p.data.code}`)} and consumed_at is null
      and expires_at>clock_timestamp() returning device_id`;
  if(!rows.length)throw new AgentError(400,"invalid_code");
  return {ok:true,validForMs:600000};
}

export async function prepareCutover(device:Device,input:unknown) {
  const p=WorkEnvelope.omit({module:true}).strict().safeParse(input);
  if(!p.success)throw new AgentError(400,"invalid_input");
  const sql=agentDb();
  return sql.begin(async tx=>{
    const [d]=await tx`select id from sync_agent_devices where id=${device.id} and tenant_id=${device.tenantId}
      and instance_id=${p.data.instanceId} and generation=${p.data.generation}::bigint and lease_until>clock_timestamp()
      and revoked_at is null and revoke_requested_at is null for update`;
    if(!d)throw new AgentError(409,"lease_lost");
    const [s]=await tx`select cutover_at from sync_agent_settings where tenant_id=${device.tenantId} for update`;
    if(s?.cutover_at)return {ready:true};
    const busy=await tx`select 1 from classnote_workers where tenant_id=${device.tenantId} and last_seen>clock_timestamp()-interval '180 seconds'
      union all select 1 from makeedu_sync_workers where tenant_id=${device.tenantId} and last_seen>clock_timestamp()-interval '180 seconds' limit 1`;
    if(busy.length)throw new AgentError(409,"legacy_busy");
    await tx`update sync_agent_settings set cutover_at=clock_timestamp(),revision=revision+1 where tenant_id=${device.tenantId}`;
    return {ready:true};
  });
}

// At most the latest due period is claimed. A failed/incomplete period is visible; it is never silently replayed.
export async function scheduleDevice(device:Device,input:unknown) {
  const p=WorkEnvelope.extend({finish:z.object({kind:z.enum(["sync","login"]),bucket:z.string().datetime(),ok:z.boolean()}).strict().optional()}).strict().safeParse(input);
  if(!p.success||p.data.module!=="makeedu")throw new AgentError(400,"invalid_input");
  const config=await deviceConfiguration(device);
  if(!p.data.finish&&(!config.enabled||!config.makeeduEnabled||!config.cutoverReady))throw new AgentError(403,"module_disabled");
  const sql=agentDb();
  return sql.begin(async tx=>{
    const [d]=await tx`select d.id from sync_agent_devices d join sync_agent_settings s on s.tenant_id=d.tenant_id
      where d.id=${device.id} and d.tenant_id=${device.tenantId} and d.instance_id=${p.data.instanceId}
      and d.generation=${p.data.generation}::bigint and d.lease_until>clock_timestamp() and d.revoked_at is null and d.revoke_requested_at is null
      and (${!!p.data.finish} or (s.enabled and s.makeedu_enabled and s.cutover_at is not null)) for share of d,s`;
    if(!d)throw new AgentError(409,"lease_lost");
    if(p.data.finish){const f=p.data.finish;
      await tx`update sync_agent_schedule_runs set finished_at=now(),succeeded=${f.ok} where tenant_id=${device.tenantId}
        and kind=${f.kind} and bucket=${f.bucket} and device_id=${device.id} and instance_id=${p.data.instanceId}
        and generation=${p.data.generation}::bigint and finished_at is null`;
      return {job:null};
    }
    const [job]=await tx`with local as (select clock_timestamp() at time zone 'Asia/Seoul' t), candidates as (
      select 'sync'::text kind,(date_trunc('day',t)+case when extract(hour from t)>=18 then interval '18 hours'
        when extract(hour from t)>=6 then interval '6 hours' else interval '-6 hours' end) at time zone 'Asia/Seoul' bucket from local
      union all select 'login',(date_trunc('day',t)+interval '8 hours 30 minutes'-case when t::time<'08:30' then interval '1 day' else interval '0 day' end) at time zone 'Asia/Seoul' from local
    ), next as (select c.* from candidates c where not exists(select 1 from sync_agent_schedule_runs r where r.tenant_id=${device.tenantId} and r.kind=c.kind and r.bucket=c.bucket) order by bucket desc limit 1)
    insert into sync_agent_schedule_runs(tenant_id,kind,bucket,device_id,instance_id,generation)
      select ${device.tenantId},kind,bucket,${device.id},${p.data.instanceId},${p.data.generation}::bigint from next
      on conflict do nothing returning kind,bucket`;
    return {job:job?{kind:job.kind,bucket:new Date(job.bucket).toISOString()}:null};
  });
}
