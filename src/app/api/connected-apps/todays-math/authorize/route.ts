import { randomBytes } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { sha256, uuidSchema } from "@/features/integrations/todays-math/sync-contract";
import { NO_STORE, SyncHttpError, parseSyncBody, sourceControl, syncBindings, syncErrorResponse, syncRpc } from "@/features/integrations/todays-math/sync-server";

export const dynamic = "force-dynamic";
const inputSchema = z.object({
  bindingId: uuidSchema, state: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/), code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = parseSyncBody(inputSchema, JSON.stringify(Object.fromEntries(url.searchParams)));
    const config = syncBindings(input.bindingId).find((value) => value.bindingId === input.bindingId);
    if (!config) throw new SyncHttpError(503, "sync_not_configured");
    if (url.origin !== config.sourceBaseUrl) throw new SyncHttpError(401, "source_origin_mismatch");
    const user = await getCurrentUser();
    if (!user) {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", url.pathname + url.search);
      return NextResponse.redirect(login, { headers: NO_STORE });
    }
    if (user.tenantId !== config.tenantId || user.systemRole === "student") throw new SyncHttpError(403, "account_not_eligible");
    const control = await sourceControl(config, user.id);
    if (!control.healthy || !control.enabled || control.mode !== "active") throw new SyncHttpError(403, "account_not_eligible");
    if (!control.users.some((entry) => entry.id === user.id && entry.eligible)) {
      return NextResponse.redirect(new URL("/login?eywa=not-linked", config.targetBaseUrl), { headers: NO_STORE });
    }
    const code = randomBytes(32).toString("base64url");
    const issued = await syncRpc("tm_sync_issue_code", {
      p_binding_id: config.bindingId, p_user_id: user.id, p_code_hash: sha256(code),
      p_state_hash: sha256(input.state), p_challenge: input.code_challenge,
    });
    if (issued !== true) throw new SyncHttpError(403, "account_not_eligible");
    const callback = new URL("/api/sso/eywa/v2/callback", config.targetBaseUrl);
    callback.searchParams.set("bindingId", config.bindingId);
    callback.searchParams.set("state", input.state);
    callback.searchParams.set("code", code);
    return NextResponse.redirect(callback, { headers: NO_STORE });
  } catch (error) { return syncErrorResponse(error); }
}
