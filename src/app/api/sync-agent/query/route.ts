import { agentRoute,authenticate,readBody } from "@/features/sync-agent/server/security";
import { runAgentQuery } from "@/features/sync-agent/server/gateway";
export const runtime="nodejs";
export const maxDuration=60;
export async function POST(request:Request) {
  return agentRoute(async()=>runAgentQuery(await authenticate(request),await readBody(request,2*1024*1024)));
}
