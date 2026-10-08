import { pairDevice } from "@/features/sync-agent/server/control";
import { agentRoute, readBody } from "@/features/sync-agent/server/security";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return agentRoute(async () => pairDevice(await readBody(request, 2048), request.headers.get("x-real-ip") ?? "unknown"));
}
