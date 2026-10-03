import { z } from "zod";
import { uuidSchema } from "@/features/integrations/todays-math/sync-contract";
import { authenticateSyncRequest, parseSyncBody, requireRequestBinding, sourceControl, syncErrorResponse, syncResponse } from "@/features/integrations/todays-math/sync-server";

export const dynamic = "force-dynamic";
const bodySchema = z.object({ bindingId: uuidSchema, userId: uuidSchema.optional() }).strict();
export async function POST(request: Request) {
  try {
    const { config, body } = await authenticateSyncRequest(request, "control");
    const input = parseSyncBody(bodySchema, body);
    requireRequestBinding(input.bindingId, config);
    return syncResponse(await sourceControl(config, input.userId));
  } catch (error) { return syncErrorResponse(error); }
}
