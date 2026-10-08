import { agentDb } from "@/features/sync-agent/server/db";
import { agentRoute, authenticate } from "@/features/sync-agent/server/security";
export const runtime="nodejs";
export async function POST(request:Request){
  return agentRoute(async()=>{
    await authenticate(request);
    const [row]=await agentDb()`select manifest,signature from sync_agent_releases where revoked_at is null order by sequence desc limit 1`;
    return {release:row?{payload:row.manifest.payload,signature:row.signature}:null};
  });
}
