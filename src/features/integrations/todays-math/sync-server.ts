import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertControlBinding, controlSchema, eventSchema, eventResultSchema, manifestSchema, pageSchema,
  parseBindingConfigs, readBoundedBody, signedHeaders, verifySignedRequest,
  type BindingConfig, type SecretPurpose, type SyncEvent,
} from "./sync-contract";

export const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export class SyncHttpError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export function syncBindings(): BindingConfig[] {
  try { return parseBindingConfigs(process.env.EYWA_SYNC_BINDINGS_JSON); }
  catch { throw new SyncHttpError(503, "sync_configuration_invalid"); }
}
export function sourceBindingForTenant(tenantId: string): BindingConfig | undefined {
  return syncBindings().find((config) => config.tenantId === tenantId);
}
/** RPCs grant EXECUTE exclusively to service_role; every call includes the fixed binding. */
export async function syncRpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await createAdminClient().rpc(name, args);
  if (error) throw new SyncHttpError(503, "sync_store_unavailable");
  return data;
}
export async function sourceControl(config: BindingConfig, userId?: string) {
  const control = controlSchema.parse(await syncRpc("tm_sync_control", { p_binding_id: config.bindingId, p_user_id: userId ?? null }));
  assertControlBinding(control, config);
  return control;
}
export async function authenticateSyncRequest(request: Request, purpose: SecretPurpose, consumeNonce = false) {
  let body: string;
  try { body = await readBoundedBody(request); }
  catch { throw new SyncHttpError(413, "invalid_request_body"); }
  const configs = syncBindings();
  if (!configs.length) throw new SyncHttpError(503, "sync_not_configured");
  let verified;
  try { verified = verifySignedRequest(request, body, configs, purpose); }
  catch { throw new SyncHttpError(401, "invalid_signature"); }
  if (new URL(request.url).origin !== verified.config.sourceBaseUrl) throw new SyncHttpError(401, "source_origin_mismatch");
  if (consumeNonce) {
    const accepted = await syncRpc("tm_sync_consume_nonce", {
      p_binding_id: verified.config.bindingId, p_nonce: verified.nonce,
      p_expires_at: new Date(verified.timestamp + 120_000).toISOString(),
    });
    if (accepted !== true) throw new SyncHttpError(409, "request_already_used");
  }
  return { ...verified, body };
}
export function parseSyncBody<T>(schema: z.ZodType<T>, body: string): T {
  try { return schema.parse(JSON.parse(body)); }
  catch { throw new SyncHttpError(400, "invalid_payload"); }
}
export function requireRequestBinding(bindingId: string, config: BindingConfig): void {
  if (bindingId !== config.bindingId) throw new SyncHttpError(403, "binding_mismatch");
}
export function syncResponse(data: unknown, status = 200): Response { return Response.json(data, { status, headers: NO_STORE }); }
/** Never put database errors, request bodies, email addresses or keys in HTTP errors. */
export function syncErrorResponse(error: unknown): Response {
  return syncResponse({ error: error instanceof SyncHttpError ? error.code : "sync_unavailable" }, error instanceof SyncHttpError ? error.status : 503);
}
export async function createSourceSnapshot(config: BindingConfig) {
  const manifest = manifestSchema.parse(await syncRpc("tm_sync_create_snapshot", { p_binding_id: config.bindingId }));
  assertControlBinding(manifest.control, config);
  return manifest;
}
export async function sourceSnapshotPage(config: BindingConfig, snapshotId: string, kind: string, page: number) {
  const result = pageSchema.parse(await syncRpc("tm_sync_snapshot_page", {
    p_binding_id: config.bindingId, p_snapshot_id: snapshotId, p_kind: kind, p_page: page,
  }));
  if (result.bindingId !== config.bindingId || result.snapshotId !== snapshotId || result.kind !== kind || result.page !== page) throw new SyncHttpError(503, "snapshot_mismatch");
  return result;
}
/** Only fixed configured origins; signed response body is never followed through redirects. */
export async function targetRequest(config: BindingConfig, path: string, method: "GET" | "POST", data?: unknown): Promise<unknown> {
  if (!path.startsWith("/api/integrations/eywa/v2/") || path.startsWith("//")) throw new Error("invalid_target_path");
  const body = method === "GET" ? "" : JSON.stringify(data ?? {});
  const response = await fetch(new URL(path, config.targetBaseUrl), {
    method, body: method === "GET" ? undefined : body,
    headers: signedHeaders(config, "webhook", method, path, body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new SyncHttpError(503, "target_unavailable");
  // Responses can include a snapshot page (escaped JSON), but never unlimited response data.
  const raw = await readBoundedBody(response);
  return JSON.parse(raw);
}
const claimSchema = z.array(z.object({ event: eventSchema, leaseToken: z.string().uuid(), attempts: z.number().int().nonnegative() }));
export type DispatchResult = { claimed: number; applied: number; received: number; conflict: number; superseded: number; retry: number; leaseLost: number; receiverSweeps: number; receiverUnavailable: number };
export async function dispatchSyncEvents(): Promise<DispatchResult> {
  const configs = syncBindings();
  const result: DispatchResult = { claimed: 0, applied: 0, received: 0, conflict: 0, superseded: 0, retry: 0, leaseLost: 0, receiverSweeps: 0, receiverUnavailable: 0 };
  if (!configs.length) return result;
  await syncRpc("tm_sync_reconcile");
  const claims = claimSchema.parse(await syncRpc("tm_sync_claim_events", { p_limit: 12 }));
  result.claimed = claims.length;
  const processedBindings = new Set<string>();
  const send = async (claim: (typeof claims)[number]) => {
    const event: SyncEvent = claim.event;
    const config = configs.find((c) => c.bindingId === event.bindingId && c.tenantId === event.tenantId);
    let status: "received" | "applied" | "conflict" | "superseded" | "retry" = "retry";
    try {
      if (!config) throw new Error("binding_not_configured");
      let receipt = eventResultSchema.parse(await targetRequest(config, "/api/integrations/eywa/v2/events", "POST", event));
      if (receipt.eventId !== event.eventId) throw new Error("event_receipt_mismatch");
      if (receipt.status === "received") {
        await targetRequest(config, "/api/integrations/eywa/v2/process", "POST", { bindingId: config.bindingId, limit: 3 });
        processedBindings.add(config.bindingId);
        const path = `/api/integrations/eywa/v2/events/${event.eventId}?bindingId=${config.bindingId}`;
        receipt = eventResultSchema.parse(await targetRequest(config, path, "GET"));
        if (receipt.eventId !== event.eventId) throw new Error("event_receipt_mismatch");
      }
      status = receipt.status;
    } catch { /* Durable source lease is retried; no raw payload or secret is logged. */ }
    const finished = await syncRpc("tm_sync_finish_event", { p_event_id: event.eventId, p_lease_token: claim.leaseToken, p_status: status, p_error: status === "retry" ? "delivery_unavailable" : null });
    // Another dispatcher may have acquired an expired lease while HTTP was in flight.
    // Its result owns the durable row; this worker must not report a persisted success.
    if (finished === true) result[status]++;
    else result.leaseLost++;
  };
  // Bound concurrency and work per invocation; SKIP LOCKED leases arbitrate cron and instant wakes.
  for (let index = 0; index < claims.length; index += 3) await Promise.all(claims.slice(index, index + 3).map(send));
  // Operator retries and receiver-local reconcile events may exist after the source
  // outbox is empty. Wake them independently; rotate bounded work across bindings.
  const unique = [...new Map(configs.slice().reverse().map((config) => [config.bindingId, config])).values()]
    .sort((a, b) => a.bindingId.localeCompare(b.bindingId));
  const offset = (Math.floor(Date.now() / 60_000) * 3) % unique.length;
  const sweep = Array.from({ length: Math.min(3, unique.length) }, (_, index) => unique[(offset + index) % unique.length])
    .filter((config) => !processedBindings.has(config.bindingId));
  await Promise.all(sweep.map(async (config) => {
    try {
      await targetRequest(config, "/api/integrations/eywa/v2/process", "POST", { bindingId: config.bindingId, limit: 3 });
      result.receiverSweeps++;
    } catch { result.receiverUnavailable++; }
  }));
  return result;
}
