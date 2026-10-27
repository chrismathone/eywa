import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadParentEvents, loadParentEventsForDisplay } from "./parent-events";
const tenant = "11111111-1111-4111-8111-111111111111";
const client = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })) }) as unknown as SupabaseClient;
it("distinguishes pre-migration/unreviewed from reviewed zero, and does not swallow outages", async () => {
  expect((await loadParentEvents(client(null, { code: "PGRST202" }), tenant)).ready).toBe(false);
  expect((await loadParentEvents(client({ ready: true, checkedAt: "2026-10-26", valid: true, records: [] }), tenant)).ready).toBe(true);
  await expect(loadParentEvents(client(null, { code: "57014" }), tenant)).rejects.toThrow("읽지 못했습니다");
  await expect(loadParentEvents(client({ ready: true, checkedAt: null, valid: false, records: [] }), tenant)).rejects.toThrow("연결");
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await loadParentEventsForDisplay(client(null, { code: "57014" }), tenant)).toMatchObject({ ready: false, readError: true, records: [] });
  warning.mockRestore();
});
it("rejects malformed/cross-tenant records and returns a complete JSON snapshot beyond the row cap", async () => {
  const record = { tenantId: tenant, eventId: "e", eventDate: "2025-01-01", title: "설명회", studentId: tenant,
    familyKey: "a".repeat(64), basis: "direct", sourceIds: ["b".repeat(64)], attendanceBasis: "registration_policy" };
  const data = { ready: true, checkedAt: "2026-10-26", valid: true, records: Array.from({ length: 1200 }, (_, i) => ({ ...record, eventId: `e${i}` })) };
  expect((await loadParentEvents(client(data), tenant)).records).toHaveLength(1200);
  await expect(loadParentEvents(client({ ...data, records: [{ ...record, tenantId: "22222222-2222-4222-8222-222222222222" }] }), tenant)).rejects.toThrow("연결");
  await expect(loadParentEvents(client({ ...data, records: [{ ...record, sourceIds: [] }] }), tenant)).rejects.toThrow();
});
