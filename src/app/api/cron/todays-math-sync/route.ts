import { bearerMatches } from "@/lib/http/secret-compare";
import { dispatchSyncEvents, syncErrorResponse, syncResponse } from "@/features/integrations/todays-math/sync-server";
import { syncConfigDiagnostics } from "@/features/integrations/todays-math/sync-config-diagnostics";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
async function run(request: Request, secret: string | undefined) {
  if (!secret?.trim() || !bearerMatches(request.headers.get("authorization") ?? "", secret.trim())) return syncResponse({ error: "unauthorized" }, 401);
  if (new URL(request.url).searchParams.get("diagnostics") === "1") return syncResponse(syncConfigDiagnostics());
  try { return syncResponse(await dispatchSyncEvents()); }
  catch (error) { return syncErrorResponse(error); }
}
export async function GET(request: Request) { return run(request, process.env.CRON_SECRET); }
/** Database pg_net wake uses a separate secret, never the cron credential. */
export async function POST(request: Request) { return run(request, process.env.TODAYS_MATH_SYNC_WAKE_SECRET); }
