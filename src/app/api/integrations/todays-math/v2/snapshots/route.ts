import { z } from "zod";
import { uuidSchema } from "@/features/integrations/todays-math/sync-contract";
import { authenticateSyncRequest, createSourceSnapshot, parseSyncBody, requireRequestBinding, syncErrorResponse, syncResponse } from "@/features/integrations/todays-math/sync-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const { config, body } = await authenticateSyncRequest(request, "control", true);
    const input = parseSyncBody(z.object({ bindingId: uuidSchema }).strict(), body);
    requireRequestBinding(input.bindingId, config);
    return syncResponse(await createSourceSnapshot(config));
  } catch (error) { return syncErrorResponse(error); }
}
