import "server-only";
import { secretMatches } from "@/lib/http/secret-compare";

/** Existing workers retain their current contract; installed agents are strictly tenant scoped. */
export async function authorizeInternalWorker(header: string | null): Promise<{ tenantId: string | null } | null> {
  if (secretMatches(header, process.env.CLASSNOTE_INTERNAL_SECRET)) return { tenantId: null };
  const match = /^agent:([0-9a-f-]{36}\.[A-Za-z0-9_-]{43}):([0-9a-f-]{36}):([1-9]\d{0,17})$/i.exec(header ?? "");
  if (!match) return null;
  try {
    // Lazy import keeps the unchanged legacy path independent of the new schema.
    const [{ authenticate }, { withAgentWork, WorkEnvelope }] = await Promise.all([import("./security"), import("./gateway")]);
    const device = await authenticate(new Request("https://internal.invalid", { headers: { authorization: `Bearer ${match[1]}` } }));
    const envelope = WorkEnvelope.parse({ instanceId: match[2], generation: match[3], module: "classnote" });
    return await withAgentWork(device, envelope, async () => ({ tenantId: device.tenantId }));
  } catch { return null; }
}
