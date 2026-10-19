// @vitest-environment node
import { describe, expect, it } from "vitest";
import { analyzeUpload, readUpload } from "./upload";
import { sampleForm, sampleOptions } from "../test-fixtures";
import { MAX_FILE_BYTES, MAX_REQUEST_BYTES } from "../contract";
import { SAMPLE_CSV } from "../sample";

const now = new Date("2026-10-19T00:00:00Z");
describe("bounded read-only upload pipeline", () => {
  it("roundtrips multipart and returns aggregate-only results", async () => {
    const req = new Request("https://aywa.test/api/management-analytics", { method: "POST", body: sampleForm() });
    const report = await analyzeUpload(await readUpload(req), "tenant-a", now);
    expect(report).toMatchObject({ ok: true, report: { kpis: { netReceipts: 1050000 }, quality: { payments: { duplicates: 1 } } } });
    expect(JSON.stringify(report)).not.toMatch(/S001|P001|C001|studentId|transactionId|consultationId|\.csv/);
  });
  it("does not accumulate uploads or share state between tenants", async () => {
    const a = await analyzeUpload(sampleForm(), "tenant-a", now);
    const b = await analyzeUpload(sampleForm("tenant-b"), "tenant-b", now);
    const aAgain = await analyzeUpload(sampleForm(), "tenant-a", now);
    expect(a).toEqual(b); expect(aAgain).toEqual(a);
    await expect(analyzeUpload(sampleForm(), "tenant-b", now)).rejects.toMatchObject({ status: 403 });
  });
  it("rejects duplicate, absent and unexpected fields", async () => {
    for (const change of [
      (f: FormData) => f.append("tenantId", "tenant-a"),
      (f: FormData) => f.delete("payments"),
      (f: FormData) => f.set("unknown", "secret"),
    ]) { const f = sampleForm(); change(f); await expect(analyzeUpload(f, "tenant-a", now)).rejects.toMatchObject({ status: 400 }); }
  });
  it("rejects corrupt options, absent confirmations, future dates and wrong file types", async () => {
    for (const options of ["{", JSON.stringify({ ...sampleOptions(), completeHistory: false }), JSON.stringify({ ...sampleOptions(), asOf: "2026-10-20" })]) {
      const f = sampleForm(); f.set("options", options);
      await expect(analyzeUpload(f, "tenant-a", now)).rejects.toMatchObject({ status: 400 });
    }
    const f = sampleForm(); f.set("payments", new File(["x"], "payments.xlsx"));
    await expect(analyzeUpload(f, "tenant-a", now)).rejects.toMatchObject({ status: 400 });
  });
  it("checks KST today, including the UTC previous day", async () => {
    const f = sampleForm(); f.set("options", JSON.stringify({ ...sampleOptions(), asOf: "2026-10-20" }));
    expect((await analyzeUpload(f, "tenant-a", new Date("2026-10-19T15:00:00Z"))).ok).toBe(true);
  });
  it("rejects oversized files", async () => {
    const f = sampleForm(); f.set("payments", new File(["x".repeat(MAX_FILE_BYTES + 1)], "payments.csv"));
    await expect(analyzeUpload(f, "tenant-a", now)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects oversized chunked bodies without trusting Content-Length", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(MAX_REQUEST_BYTES + 1)); }, cancel() { canceled = true; } });
    const req = new Request("https://aywa.test", { method: "POST", body, duplex: "half", headers: { "Content-Type": "multipart/form-data; boundary=a", "Content-Length": "1" } } as RequestInit);
    await expect(readUpload(req)).rejects.toMatchObject({ status: 413 }); expect(canceled).toBe(true);
  });
  it("rejects invalid content type, declared oversized bodies and malformed multipart", async () => {
    for (const req of [
      new Request("https://aywa.test", { method: "POST", body: "text" }),
      new Request("https://aywa.test", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=a", "Content-Length": String(MAX_REQUEST_BYTES + 1) } }),
      new Request("https://aywa.test", { method: "POST", body: "bad", headers: { "Content-Type": "multipart/form-data; boundary=a" } }),
    ]) await expect(readUpload(req)).rejects.toThrow();
  });
  it("fails the whole report when one row conflicts", async () => {
    const f = sampleForm(); f.set("payments", new File([SAMPLE_CSV.payments + "P001,S001,2026-09-01,1,payment"], "payments.csv"));
    const result = await analyzeUpload(f, "tenant-a", now);
    expect(result).toMatchObject({ ok: false, issueCount: 1 }); expect(result).not.toHaveProperty("report");
  });
});
