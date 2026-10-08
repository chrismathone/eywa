import { acquireDevice, deviceConfiguration, heartbeatDevice, releaseDevice, storeDeviceEvents } from "@/features/sync-agent/server/control";
import { AgentError, agentRoute, authenticate, readBody } from "@/features/sync-agent/server/security";
import { moduleSession, prepareCutover, scheduleDevice, unlockDevice } from "@/features/sync-agent/server/lifecycle";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  return agentRoute(async () => {
    const [{ action }, device] = await Promise.all([context.params, authenticate(request)]);
    const body = await readBody(request);
    switch (action) {
      case "configuration": return deviceConfiguration(device);
      case "acquire": return acquireDevice(device, body);
      case "heartbeat": return heartbeatDevice(device, body);
      case "release": return releaseDevice(device, body);
      case "events": return storeDeviceEvents(device, body);
      case "cutover": return prepareCutover(device, body);
      case "schedule": return scheduleDevice(device, body);
      case "unlock": return unlockDevice(device, body);
      case "module-start": return moduleSession(device,body,false);
      case "module-stop": return moduleSession(device,body,true);
      default: throw new AgentError(404, "not_found");
    }
  });
}
