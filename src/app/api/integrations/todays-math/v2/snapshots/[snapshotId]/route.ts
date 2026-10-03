import { z } from "zod";
import { collectionKindSchema, uuidSchema } from "@/features/integrations/todays-math/sync-contract";
import { authenticateSyncRequest, parseSyncBody, requireRequestBinding, sourceSnapshotPage, syncErrorResponse, syncResponse } from "@/features/integrations/todays-math/sync-server";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ snapshotId: string }> }) {
  try {
    const { config } = await authenticateSyncRequest(request, "control");
    const url = new URL(request.url);
    const input = parseSyncBody(z.object({ bindingId: uuidSchema, snapshotId: uuidSchema, kind: collectionKindSchema,
      page: z.string().regex(/^(0|[1-9]\d{0,6})$/).transform(Number) }), JSON.stringify({
      bindingId: url.searchParams.get("bindingId"), kind: url.searchParams.get("kind"), page: url.searchParams.get("page"),
      snapshotId: (await context.params).snapshotId,
    }));
    requireRequestBinding(input.bindingId, config);
    return syncResponse(await sourceSnapshotPage(config, input.snapshotId, input.kind, input.page));
  } catch (error) { return syncErrorResponse(error); }
}
