import { agentRoute,authenticate,readBody } from "@/features/sync-agent/server/security";
import { runAgentOperation } from "@/features/sync-agent/server/operations";
export const runtime="nodejs";
export const maxDuration=60;
export async function POST(request:Request) {
  return agentRoute(async()=>runAgentOperation(await authenticate(request),await readBody(request,2*1024*1024)));
}
