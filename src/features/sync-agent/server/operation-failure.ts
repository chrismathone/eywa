import "server-only";
import { randomUUID } from "node:crypto";
import { agentDb } from "./db";

/** Safe, bounded diagnostics. Never record SQL, parameters, response data or credentials. */
export async function recordAgentQueryFailure(deviceId:string,module:"classnote"|"makeedu",queryId:string,code:string) {
  const safeCode=/^[A-Z0-9]{5}$/.test(code)?code:["unknown_operation","operation_failed","lease_lost"].includes(code)?code:"operation_failed";
  try {
    const sql=agentDb();
    const detail={operation:"query",queryId,code:safeCode};
    await sql`insert into sync_agent_events(device_id,tenant_id,event_id,occurred_at,kind,module,level,detail)
      select id,tenant_id,${randomUUID()},now(),'job_failed',${module},'error',${sql.json(detail)}
      from sync_agent_devices d where d.id=${deviceId} and d.revoked_at is null
      and not exists(select 1 from sync_agent_events e where e.device_id=d.id and e.kind='job_failed'
        and e.detail->>'queryId'=${queryId} and e.detail->>'code'=${safeCode} and e.received_at>now()-interval '5 minutes')`;
  } catch { /* Diagnostics must not change the operation's original result. */ }
}
