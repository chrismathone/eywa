/** Shared v2 wire contract. Keep the source and receiver copies identical. Server only. */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SYNC_VERSION = 2 as const;
export const LEASE_MS = 60_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const CAPABILITIES = ["class:read", "student:read", "test:read", "test:write", "progress:read", "progress:write", "student:account"] as const;
export const COLLECTION_KINDS = ["staff", "classes", "memberships", "students", "enrollments", "progress"] as const;
export const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const revisionSchema = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
export const timestampSchema = z.iso.datetime({ offset: true });
export const dateSchema = z.iso.date();
const text = z.string().max(10_000);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const collectionKindSchema = z.enum(COLLECTION_KINDS);
export type CollectionKind = z.infer<typeof collectionKindSchema>;
export const controlUserSchema = z.object({
  id: uuidSchema, email: z.string().max(320), name: text, status: text, role: text,
  subjects: z.array(text), eligible: z.boolean(), blockReasons: z.array(text),
  accountRevocationGeneration: revisionSchema, classListRevision: revisionSchema,
  classes: z.array(z.object({ id: uuidSchema, permissionRevision: revisionSchema,
    capabilities: z.array(z.enum(CAPABILITIES)), validUntil: timestampSchema.nullable() })),
});
export const controlSchema = z.object({
  schemaVersion: z.literal(2), bindingId: uuidSchema, tenantId: uuidSchema, targetBranchId: z.string().min(1).max(200),
  sourceEpoch: uuidSchema, securityRevision: revisionSchema, tenantRevocationGeneration: revisionSchema,
  enabled: z.boolean(), mode: z.enum(["shadow", "active"]), validatedAt: timestampSchema,
  nextEffectiveAt: timestampSchema.nullable(), healthy: z.boolean(), users: z.array(controlUserSchema),
});
export type Control = z.infer<typeof controlSchema>;
export type ControlUser = z.infer<typeof controlUserSchema>;
export const eventSchema = z.object({
  schemaVersion: z.literal(2), eventId: uuidSchema, bindingId: uuidSchema, tenantId: uuidSchema,
  sourceEpoch: uuidSchema, securityRevision: revisionSchema, tenantRevocationGeneration: revisionSchema,
  occurredAt: timestampSchema, kind: z.enum(["security", "content", "reconcile"]),
  entityType: z.string().min(1).max(100), entityId: z.string().max(200).nullable(),
});
export type SyncEvent = z.infer<typeof eventSchema>;
export const classSchema = z.object({
  id: uuidSchema, name: text, subject: text, grade: text.nullable(), active: z.boolean(),
  closedAt: timestampSchema.nullable(), teacherId: uuidSchema.nullable(), permissionRevision: revisionSchema,
});
export const membershipSchema = z.object({
  id: z.string().min(1).max(300), classId: uuidSchema, userId: uuidSchema,
  role: z.enum(["homeroom", "slot", "delegate"]), startsOn: dateSchema.nullable(), endsOn: dateSchema.nullable(),
  revokedAt: timestampSchema.nullable(), capabilities: z.array(z.enum(CAPABILITIES)),
});
export const studentSchema = z.object({ id: uuidSchema, name: text, grade: text.nullable(), school: text.nullable(), status: text, isTest: z.boolean() });
export const enrollmentSchema = z.object({
  id: uuidSchema, studentId: uuidSchema, classId: uuidSchema, startsOn: dateSchema, endsOn: dateSchema.nullable(),
  onHold: z.boolean(), isTransferred: z.boolean(), attendanceDays: z.array(text),
});
export const progressSchema = z.object({
  id: uuidSchema, studentId: uuidSchema, classId: uuidSchema.nullable(), makeupClassId: uuidSchema.nullable(),
  reportDate: dateSchema, createdAt: timestampSchema, progress: z.string().max(MAX_BODY_BYTES),
});
export const collectionSchemas = {
  staff: controlUserSchema, classes: classSchema, memberships: membershipSchema,
  students: studentSchema, enrollments: enrollmentSchema, progress: progressSchema,
};
export type SnapshotRows = { [K in CollectionKind]: z.infer<(typeof collectionSchemas)[K]>[] };
const collectionManifest = z.object({ total: z.number().int().nonnegative(), pages: z.array(z.object({
  page: z.number().int().nonnegative(), count: z.number().int().positive(), sha256: hash,
})) });
export const manifestSchema = z.object({
  schemaVersion: z.literal(2), snapshotId: uuidSchema, bindingId: uuidSchema, tenantId: uuidSchema,
  targetBranchId: z.string().min(1).max(200), sourceEpoch: uuidSchema, securityRevision: revisionSchema,
  contentGeneration: revisionSchema, generatedAt: timestampSchema, expiresAt: timestampSchema, complete: z.literal(true),
  control: controlSchema,
  collections: z.object({ staff: collectionManifest, classes: collectionManifest, memberships: collectionManifest,
    students: collectionManifest, enrollments: collectionManifest, progress: collectionManifest }),
}).superRefine((v, ctx) => {
  if (v.bindingId !== v.control.bindingId || v.tenantId !== v.control.tenantId || v.targetBranchId !== v.control.targetBranchId
    || v.sourceEpoch !== v.control.sourceEpoch || v.securityRevision !== v.control.securityRevision) {
    ctx.addIssue({ code: "custom", message: "snapshot_control_mismatch" });
  }
  for (const kind of COLLECTION_KINDS) {
    const collection = v.collections[kind];
    if (collection.pages.reduce((n, p) => n + p.count, 0) !== collection.total
      || collection.pages.some((p, i) => p.page !== i)) ctx.addIssue({ code: "custom", message: `incomplete_${kind}` });
  }
});
export type Manifest = z.infer<typeof manifestSchema>;
export const pageSchema = z.object({
  snapshotId: uuidSchema, bindingId: uuidSchema, kind: collectionKindSchema, page: z.number().int().nonnegative(),
  json: z.string(), sha256: hash,
});
export type SnapshotPage = z.infer<typeof pageSchema>;
export const eventResultSchema = z.object({ eventId: uuidSchema, status: z.enum(["received", "applied", "conflict", "superseded"]) });

const secretSchema = z.string().transform((s) => s.trim()).pipe(z.string().min(32).max(1024));
const originSchema = z.string().url().superRefine((s, ctx) => {
  const url = new URL(s);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password
    || url.search || url.hash || url.pathname !== "/") ctx.addIssue({ code: "custom", message: "fixed_https_origin_required" });
}).transform((s) => new URL(s).origin);
export const bindingConfigSchema = z.object({
  bindingId: uuidSchema, tenantId: uuidSchema, targetBranchId: z.string().min(1).max(200),
  sourceBaseUrl: originSchema, targetBaseUrl: originSchema, keyId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  controlSecret: secretSchema, webhookSecret: secretSchema, ssoSecret: secretSchema,
});
export type BindingConfig = z.infer<typeof bindingConfigSchema>;
export type SecretPurpose = "control" | "webhook" | "sso";
export function parseBindingConfigs(raw: string | undefined): BindingConfig[] {
  if (!raw?.trim()) return [];
  const configs = z.array(bindingConfigSchema).parse(JSON.parse(raw));
  const keys = new Set<string>();
  const bindings = new Map<string, BindingConfig>();
  const sourceTenants = new Map<string, string>();
  const targetBranches = new Map<string, string>();
  for (const config of configs) {
    const key = `${config.bindingId}:${config.keyId}`;
    if (keys.has(key)) throw new Error("duplicate_binding_key");
    keys.add(key);
    const previous = bindings.get(config.bindingId);
    if (previous && ["tenantId", "targetBranchId", "sourceBaseUrl", "targetBaseUrl"].some((field) =>
      previous[field as keyof BindingConfig] !== config[field as keyof BindingConfig])) throw new Error("binding_identity_mismatch");
    if (sourceTenants.has(config.tenantId) && sourceTenants.get(config.tenantId) !== config.bindingId) throw new Error("ambiguous_tenant_binding");
    if (targetBranches.has(config.targetBranchId) && targetBranches.get(config.targetBranchId) !== config.bindingId) throw new Error("ambiguous_branch_binding");
    sourceTenants.set(config.tenantId, config.bindingId);
    targetBranches.set(config.targetBranchId, config.bindingId);
    bindings.set(config.bindingId, config);
  }
  return configs;
}
export function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function s256(verifier: string): string { return createHash("sha256").update(verifier).digest("base64url"); }
export function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
export function normalizeName(value: string): string { return value.normalize("NFC").trim().replace(/\s+/gu, " "); }
export function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function signatureInput(method: string, path: string, bindingId: string, keyId: string, timestamp: string, nonce: string, body: string): string {
  return ["v2", method.toUpperCase(), path, bindingId, keyId, timestamp, nonce, sha256(body)].join("\n");
}
export function signedHeaders(config: BindingConfig, purpose: SecretPurpose, method: string, path: string, body = "", now = Date.now(), nonce: string = randomUUID()): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000));
  const signature = createHmac("sha256", config[`${purpose}Secret`])
    .update(signatureInput(method, path, config.bindingId, config.keyId, timestamp, nonce, body)).digest("hex");
  return { "content-type": "application/json", "x-eywa-binding": config.bindingId, "x-eywa-key-id": config.keyId,
    "x-eywa-timestamp": timestamp, "x-eywa-nonce": nonce, "x-eywa-signature": signature };
}
export function verifySignedRequest(request: Pick<Request, "url" | "method" | "headers">, body: string, configs: BindingConfig[], purpose: SecretPurpose, now = Date.now()): { config: BindingConfig; nonce: string; timestamp: number } {
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("body_too_large");
  const get = (name: string) => request.headers.get(`x-eywa-${name}`) ?? "";
  const bindingId = get("binding"); const keyId = get("key-id"); const timestamp = get("timestamp"); const nonce = get("nonce");
  if (!/^\d{10,12}$/.test(timestamp) || !uuidSchema.safeParse(nonce).success || !hash.safeParse(get("signature")).success
    || Math.abs(now - Number(timestamp) * 1000) > LEASE_MS) throw new Error("invalid_signature");
  const config = configs.find((c) => c.bindingId === bindingId && c.keyId === keyId);
  if (!config) throw new Error("invalid_signature");
  const url = new URL(request.url);
  const expected = createHmac("sha256", config[`${purpose}Secret`])
    .update(signatureInput(request.method, url.pathname + url.search, bindingId, keyId, timestamp, nonce, body)).digest("hex");
  if (!equalSecret(expected, get("signature"))) throw new Error("invalid_signature");
  return { config, nonce, timestamp: Number(timestamp) * 1000 };
}
/** Bound the body while streaming; Content-Length alone is untrusted. */
export async function readBoundedBody(request: Pick<Request, "body">, limit = MAX_BODY_BYTES): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error("body_too_large"); }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { reader.releaseLock(); }
}
export function assertControlBinding(control: Control, config: BindingConfig): void {
  if (control.bindingId !== config.bindingId || control.tenantId !== config.tenantId || control.targetBranchId !== config.targetBranchId) throw new Error("binding_mismatch");
}
export function controlLeaseExpiresAt(control: Control, requestStartedAt: number): number {
  const validated = Date.parse(control.validatedAt);
  return Math.min(requestStartedAt + LEASE_MS, validated + LEASE_MS,
    control.nextEffectiveAt ? Date.parse(control.nextEffectiveAt) : Infinity);
}
export function verifySnapshotPage(manifest: Manifest, input: unknown): { kind: CollectionKind; rows: Array<SnapshotRows[CollectionKind][number]> } {
  const page = pageSchema.parse(input);
  const expected = manifest.collections[page.kind].pages[page.page];
  if (!expected || page.bindingId !== manifest.bindingId || page.snapshotId !== manifest.snapshotId
    || sha256(page.json) !== expected.sha256 || page.sha256 !== expected.sha256) throw new Error("snapshot_page_mismatch");
  const rows = z.array(collectionSchemas[page.kind]).parse(JSON.parse(page.json));
  if (rows.length !== expected.count) throw new Error("snapshot_page_count_mismatch");
  return { kind: page.kind, rows };
}
export function validateCompleteSnapshot(manifest: Manifest, pages: SnapshotPage[], now = Date.now()): SnapshotRows {
  manifestSchema.parse(manifest);
  if (Date.parse(manifest.expiresAt) <= now || Date.parse(manifest.generatedAt) > now + 5000) throw new Error("snapshot_expired");
  const rows: SnapshotRows = { staff: [], classes: [], memberships: [], students: [], enrollments: [], progress: [] };
  const seen = new Set<string>();
  for (const page of pages) {
    const key = `${page.kind}:${page.page}`;
    if (seen.has(key)) throw new Error("duplicate_page");
    seen.add(key);
    const verified = verifySnapshotPage(manifest, page);
    (rows[verified.kind] as Array<SnapshotRows[CollectionKind][number]>).push(...verified.rows);
  }
  for (const kind of COLLECTION_KINDS) {
    if (rows[kind].length !== manifest.collections[kind].total || manifest.collections[kind].pages.some((p) => !seen.has(`${kind}:${p.page}`))) throw new Error("snapshot_incomplete");
    const ids = rows[kind].map((row) => row.id);
    if (new Set(ids).size !== ids.length) throw new Error("duplicate_entity");
  }
  return rows;
}
export const assertionSchema = z.object({
  iss: z.literal("aywa"), aud: z.literal("todays-math"), bindingId: uuidSchema, sourceEpoch: uuidSchema,
  sub: uuidSchema, tenantId: uuidSchema, email: z.string().max(320), name: text,
  securityRevision: revisionSchema, tenantRevocationGeneration: revisionSchema, accountRevocationGeneration: revisionSchema,
  iat: z.number().int().nonnegative(), exp: z.number().int().positive(), jti: uuidSchema,
});
export type SsoAssertion = z.infer<typeof assertionSchema>;
export function signAssertion(input: SsoAssertion, config: BindingConfig): string {
  const data = assertionSchema.parse(input);
  if (data.bindingId !== config.bindingId || data.tenantId !== config.tenantId || data.exp - data.iat > 60 || data.exp <= data.iat) throw new Error("invalid_assertion");
  const value = `v2.${Buffer.from(JSON.stringify(data)).toString("base64url")}`;
  return `${value}.${createHmac("sha256", config.ssoSecret).update(value).digest("base64url")}`;
}
export function verifyAssertion(token: string, config: BindingConfig, now = Date.now()): SsoAssertion {
  if (token.length > 16_384) throw new Error("invalid_assertion");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v2" || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) throw new Error("invalid_assertion");
  const expected = createHmac("sha256", config.ssoSecret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  if (!equalSecret(expected, parts[2])) throw new Error("invalid_assertion");
  const data = assertionSchema.parse(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
  if (data.bindingId !== config.bindingId || data.tenantId !== config.tenantId || data.iat * 1000 > now + 5000
    || data.exp * 1000 <= now || data.exp - data.iat > 60 || data.exp <= data.iat) throw new Error("invalid_assertion");
  return data;
}
