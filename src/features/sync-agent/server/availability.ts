import "server-only";
import { requireManager } from "./security";
import { agentDb } from "./db";
export async function agentTabAvailable(moduleOn:boolean) {
  try {
    const user=await requireManager();
    if(moduleOn) return true;
    const sql=agentDb();
    const [row]=await sql`select exists(select 1 from sync_agent_devices where tenant_id=${user.tenantId} and revoked_at is null) as present`;
    return row?.present===true;
  } catch { return false; }
}
