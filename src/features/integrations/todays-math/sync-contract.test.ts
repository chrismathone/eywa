// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  COLLECTION_KINDS, controlLeaseExpiresAt, manifestSchema, normalizeEmail, normalizeName, parseBindingConfigs,
  readBoundedBody, sha256, signAssertion, signedHeaders, validateCompleteSnapshot, verifyAssertion, verifySignedRequest,
  type BindingConfig, type Control, type Manifest, type SnapshotPage, type SsoAssertion,
} from "./sync-contract";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-03T06:00:00.000Z");
const config: BindingConfig = { bindingId: id(1), tenantId: id(2), targetBranchId: id(3),
  sourceBaseUrl: "https://source.example", targetBaseUrl: "https://target.example", keyId: "first",
  controlSecret: "c".repeat(32), webhookSecret: "w".repeat(32), ssoSecret: "s".repeat(32) };
const control: Control = { schemaVersion: 2, bindingId: id(1), tenantId: id(2), targetBranchId: id(3), sourceEpoch: id(4),
  securityRevision: "9007199254740993", tenantRevocationGeneration: "10", enabled: true, mode: "active",
  validatedAt: new Date(now).toISOString(), nextEffectiveAt: null, healthy: true, users: [] };
function manifest(): Manifest {
  return manifestSchema.parse({ schemaVersion: 2, snapshotId: id(5), bindingId: id(1), tenantId: id(2), targetBranchId: id(3),
    sourceEpoch: id(4), securityRevision: control.securityRevision, contentGeneration: "2", generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 900_000).toISOString(), complete: true, control,
    collections: Object.fromEntries(COLLECTION_KINDS.map((kind) => [kind, { total: 0, pages: [] }])) });
}
function studentSnapshot(): { snapshot: Manifest; page: SnapshotPage } {
  const snapshot = manifest();
  const json = JSON.stringify([{ id: id(9), name: "김학생", grade: "고1", school: null, status: "enrolled", isTest: false }]);
  snapshot.collections.students = { total: 1, pages: [{ page: 0, count: 1, sha256: sha256(json) }] };
  return { snapshot, page: { bindingId: id(1), snapshotId: id(5), kind: "students", page: 0, json, sha256: sha256(json) } };
}
describe("signed v2 transport", () => {
  const path = "/api/integrations/todays-math/v2/control";
  const body = JSON.stringify({ bindingId: id(1) });
  const request = () => new Request(config.sourceBaseUrl + path, { method: "POST", body, headers: signedHeaders(config, "control", "POST", path, body, now, id(6)) });
  it("authenticates exact method, path, body, binding, purpose and key", () => {
    expect(verifySignedRequest(request(), body, [config], "control", now).config).toEqual(config);
    expect(() => verifySignedRequest(request(), body + " ", [config], "control", now)).toThrow();
    expect(() => verifySignedRequest(request(), body, [config], "webhook", now)).toThrow();
    expect(() => verifySignedRequest({ ...request(), url: config.sourceBaseUrl + path + "?a=1", method: "POST", headers: request().headers }, body, [config], "control", now)).toThrow();
    expect(() => verifySignedRequest(request(), body, [{ ...config, bindingId: id(8) }], "control", now)).toThrow();
  });
  it("rejects stale, far-future and malformed timestamps and signatures", () => {
    expect(() => verifySignedRequest(request(), body, [config], "control", now + 60_001)).toThrow();
    expect(() => verifySignedRequest(request(), body, [config], "control", now - 60_001)).toThrow();
    const bad = request(); bad.headers.set("x-eywa-timestamp", "NaN");
    expect(() => verifySignedRequest(bad, body, [config], "control", now)).toThrow();
    const short = request(); short.headers.set("x-eywa-signature", "abc");
    expect(() => verifySignedRequest(short, body, [config], "control", now)).toThrow();
  });
  it("accepts explicit key rotation without mixing binding identities", () => {
    const rotated = { ...config, keyId: "next", controlSecret: "n".repeat(32) };
    expect(parseBindingConfigs(JSON.stringify([rotated, config]))).toHaveLength(2);
    expect(() => parseBindingConfigs(JSON.stringify([config, config]))).toThrow();
    expect(() => parseBindingConfigs(JSON.stringify([config, { ...rotated, tenantId: id(8) }]))).toThrow();
    expect(() => parseBindingConfigs(JSON.stringify([{ ...config, targetBaseUrl: "https://target.example/evil" }]))).toThrow();
    expect(() => parseBindingConfigs(JSON.stringify([{ ...config, sourceBaseUrl: "http://internal.example" }]))).toThrow();
    expect(() => parseBindingConfigs(JSON.stringify([{ ...config, ssoSecret: " " }]))).toThrow();
  });
  it("limits the streaming body even when length header is absent", async () => {
    await expect(readBoundedBody(new Request("https://example.com", { method: "POST", body: "123456" }), 5)).rejects.toThrow("body_too_large");
  });
});
describe("complete snapshot required before absence processing", () => {
  it("distinguishes a legitimate empty snapshot from missing collections/pages", () => {
    expect(validateCompleteSnapshot(manifest(), [], now).students).toEqual([]);
    const { snapshot, page } = studentSnapshot();
    expect(validateCompleteSnapshot(snapshot, [page], now).students[0].name).toBe("김학생");
    expect(() => validateCompleteSnapshot(snapshot, [], now)).toThrow("snapshot_incomplete");
    const incomplete: Record<string, unknown> = { ...manifest(), collections: { classes: { total: 0, pages: [] } } };
    expect(() => manifestSchema.parse(incomplete)).toThrow();
  });
  it("rejects corrupt, duplicated, mixed-binding, stale and inconsistent data", () => {
    const { snapshot, page } = studentSnapshot();
    expect(() => validateCompleteSnapshot(snapshot, [{ ...page, json: "[]" }], now)).toThrow();
    expect(() => validateCompleteSnapshot(snapshot, [page, page], now)).toThrow("duplicate_page");
    expect(() => validateCompleteSnapshot(snapshot, [{ ...page, bindingId: id(8) }], now)).toThrow();
    expect(() => validateCompleteSnapshot(snapshot, [page], now + 900_000)).toThrow("snapshot_expired");
    expect(() => manifestSchema.parse({ ...snapshot, securityRevision: "1" })).toThrow();
  });
  it("anchors strict lease to earlier source time and request start/date boundary", () => {
    expect(controlLeaseExpiresAt(control, now + 10_000)).toBe(now + 60_000);
    expect(controlLeaseExpiresAt(control, now - 10_000)).toBe(now + 50_000);
    expect(controlLeaseExpiresAt({ ...control, nextEffectiveAt: new Date(now + 20_000).toISOString() }, now)).toBe(now + 20_000);
  });
});
describe("server-exchanged SSO assertion", () => {
  const assertion: SsoAssertion = { iss: "aywa", aud: "todays-math", bindingId: id(1), tenantId: id(2), sourceEpoch: id(4), sub: id(7),
    email: "teacher@example.test", name: "김선생", securityRevision: control.securityRevision, tenantRevocationGeneration: "10",
    accountRevocationGeneration: "2", iat: now / 1000, exp: now / 1000 + 60, jti: id(8) };
  it("keeps generations exact and binds audience, lifetime and identity", () => {
    const token = signAssertion(assertion, config);
    expect(verifyAssertion(token, config, now)).toEqual(assertion);
    expect(() => verifyAssertion(token, { ...config, tenantId: id(8) }, now)).toThrow();
    expect(() => verifyAssertion(token, config, now + 60_000)).toThrow();
    expect(() => verifyAssertion(token + "a", config, now)).toThrow();
    expect(() => signAssertion({ ...assertion, exp: assertion.iat + 61 }, config)).toThrow();
  });
  it("normalizes only exact candidates, without provider/fuzzy email merging", () => {
    expect(normalizeEmail(" Teacher+Math@Example.com ")).toBe("teacher+math@example.com");
    expect(normalizeName("  김\t선생  ")).toBe("김 선생");
    expect(normalizeEmail("a.b@gmail.com")).not.toBe(normalizeEmail("ab@gmail.com"));
  });
});
