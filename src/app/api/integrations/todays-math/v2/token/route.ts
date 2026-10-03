import { z } from "zod";
import { assertControlBinding, controlSchema, controlUserSchema, s256, sha256, signAssertion, timestampSchema, uuidSchema } from "@/features/integrations/todays-math/sync-contract";
import { authenticateSyncRequest, parseSyncBody, requireRequestBinding, SyncHttpError, syncErrorResponse, syncResponse, syncRpc } from "@/features/integrations/todays-math/sync-server";

export const dynamic = "force-dynamic";
const inputSchema = z.object({ bindingId: uuidSchema, code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  state: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/), codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/) }).strict();
const redemptionSchema = z.object({ control: controlSchema, user: controlUserSchema, jti: uuidSchema, issuedAt: timestampSchema, expiresAt: timestampSchema });
export async function POST(request: Request) {
  try {
    // The exchange RPC consumes nonce AND authorization code in the same transaction.
    const { config, body, nonce, timestamp } = await authenticateSyncRequest(request, "sso");
    const input = parseSyncBody(inputSchema, body);
    requireRequestBinding(input.bindingId, config);
    const result = await syncRpc("tm_sync_exchange_code", {
      p_binding_id: config.bindingId, p_code_hash: sha256(input.code), p_state_hash: sha256(input.state),
      p_challenge: s256(input.codeVerifier), p_nonce: nonce, p_expires_at: new Date(timestamp + 120_000).toISOString(),
    });
    if (result == null) throw new SyncHttpError(401, "authorization_code_invalid");
    const { control, user, jti, issuedAt, expiresAt } = redemptionSchema.parse(result);
    assertControlBinding(control, config);
    if (!control.enabled || !control.healthy || control.mode !== "active" || !user.eligible
      || !control.users.some((entry) => entry.id === user.id && entry.eligible)) throw new SyncHttpError(403, "account_not_eligible");
    const assertion = signAssertion({
      iss: "aywa", aud: "todays-math", bindingId: config.bindingId, sourceEpoch: control.sourceEpoch,
      sub: user.id, tenantId: config.tenantId, email: user.email, name: user.name,
      securityRevision: control.securityRevision, tenantRevocationGeneration: control.tenantRevocationGeneration,
      accountRevocationGeneration: user.accountRevocationGeneration, jti,
      iat: Math.floor(Date.parse(issuedAt) / 1000), exp: Math.floor(Date.parse(expiresAt) / 1000),
    }, config);
    return syncResponse({ assertion });
  } catch (error) { return syncErrorResponse(error); }
}
