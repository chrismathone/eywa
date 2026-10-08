import "server-only";
import { z } from "zod";
import { compileAgentQuery, InvalidAgentQuery, type QueryCatalog } from "../query-compiler";
import catalog from "./query-catalog.json";
import { agentDb } from "./db";
import { AgentError } from "./security";

export const WorkEnvelope = z.object({
  instanceId:z.string().uuid(), generation:z.string().regex(/^[1-9]\d{0,17}$/), module:z.enum(["classnote","makeedu"]),
});
const QueryInput = WorkEnvelope.extend({ id:z.string().regex(/^[a-f0-9]{64}$/),parameters:z.array(z.unknown()).max(1000),readOnly:z.boolean().default(false) }).strict();
export async function withAgentWork<T>(device:{id:string;tenantId:string}, envelope:z.infer<typeof WorkEnvelope>, fn:(sql: ReturnType<typeof agentDb>)=>Promise<T>):Promise<T> {
  const sql=agentDb();
  return await sql.begin(async tx=>{
    // Lock held through completion: revoke and takeover cannot interleave a data commit.
    const [lease]=await tx`select d.id from sync_agent_devices d join sync_agent_settings s on s.tenant_id=d.tenant_id
      join sync_agent_module_sessions m on m.device_id=d.id and m.module=${envelope.module} and m.instance_id=d.instance_id and m.generation=d.generation
      where d.id=${device.id} and d.tenant_id=${device.tenantId} and d.revoked_at is null and d.revoke_requested_at is null
        and d.instance_id=${envelope.instanceId} and d.generation=${envelope.generation}::bigint and d.lease_until>clock_timestamp()
        and s.cutover_at is not null and (m.stop_after is null or m.stop_after>clock_timestamp())
      for share of d,s,m`;
    if(!lease) throw new AgentError(409,"lease_lost");
    await tx`select set_config('eywa.agent_tenant',${device.tenantId},true),set_config('statement_timeout','15000',true),
      set_config('request.jwt.claims',${JSON.stringify({role:"service_role",tenant_id:device.tenantId})},true)`;
    await tx`set local role eywa_sync_agent`;
    // Queries in the read-only callback are individually read-only. Atomic writes use named operations.
    // The catalog compiler also checks the read-only template before execution.
    const result=await fn(tx as unknown as ReturnType<typeof agentDb>);
    return result;
  }) as T;
}
export async function runAgentQuery(device:{id:string;tenantId:string},input:unknown) {
  const parsed=QueryInput.safeParse(input); if(!parsed.success) throw new AgentError(400,"invalid_input");
  const p=parsed.data;
  let compiled;
  try { compiled=compileAgentQuery(catalog as QueryCatalog,p.module,p); }
  catch(e) { if(e instanceof InvalidAgentQuery) throw new AgentError(403,"unknown_operation"); throw e; }
  if(p.readOnly && !/^\s*select\b/i.test(compiled.text)) throw new AgentError(403,"read_only");
  return withAgentWork(device,p,async sql=>{
    try {
      const rows=await sql.unsafe(compiled.text,compiled.values as Parameters<typeof sql.unsafe>[1]);
      return {rows:[...rows],count:rows.count,columns:rows.columns.map(c=>({name:c.name,type:c.type}))};
    } catch(e) {
      // Preserve only safe SQLSTATE codes needed by existing compatibility fallbacks.
      const code=(e as {code?:string}).code;
      if(code && ["42P01","42703","23505","23503","42501","57014"].includes(code)) throw new AgentError(409,code);
      throw new AgentError(503,"operation_failed");
    }
  });
}
