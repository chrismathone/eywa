// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { licensed, call, insert } = vi.hoisted(() => ({ licensed: vi.fn(), call: vi.fn(), insert: vi.fn() }));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: licensed }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  expect(table).toBe("ai_usage_logs"); return { insert };
} }) }));
vi.mock("./jev", async (original) => ({ ...await original<typeof import("./jev")>(), callJev: call }));
import { generateJSON } from "./generate";
import { FACT_GUARD } from "./fact-guard";
import { JevError } from "./jev";
const options = {
  mode: "decision" as const, state: { latest: "결석해요" },
  questions: { attendance: { type: "choice" as const, instructions: "Decide", criteria: { absence: "Absent", none: "None" } } },
  meta: { tenantId: "test-tenant", feature: "parent_attendance_jev_shadow" },
};
beforeEach(() => {
  vi.clearAllMocks(); licensed.mockResolvedValue(true); insert.mockResolvedValue({ error: null });
  call.mockResolvedValue({ model: "jev-1.13.0", data: {}, usage: { inputTokens: 12, outputTokens: 3 }, elapsedMs: 10 });
  vi.stubEnv("TYPESAFE_API_KEY", "base-test-key"); vi.stubEnv("TYPESAFE_API_KEY_ATTENDANCE", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fake"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.invalid");
});
afterEach(() => vi.unstubAllEnvs());
it("blocks missing tenants and disabled licenses before calling Jev", async () => {
  await expect(generateJSON({ ...options, meta: { ...options.meta, tenantId: " " } })).rejects.toThrow();
  expect(licensed).not.toHaveBeenCalled();
  licensed.mockResolvedValue(false);
  await expect(generateJSON(options)).rejects.toThrow();
  expect(call).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
});
it("adds the fact guard and records tenant, feature, model and actual key group", async () => {
  vi.stubEnv("TYPESAFE_API_KEY_ATTENDANCE", "group-test-key");
  await generateJSON(options);
  expect(call.mock.calls[0][0].apiKey).toBe("group-test-key");
  expect(call.mock.calls[0][0].questions.attendance.instructions).toContain(FACT_GUARD);
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: "test-tenant", feature: options.meta.feature, provider: "typesafe", key_name: "attendance", input_tokens: 12, ok: true }));
});
it("falls back only to the base TypeSafe key and logs safe failures", async () => {
  call.mockRejectedValue(new JevError("Jev HTTP 529"));
  await expect(generateJSON(options)).rejects.toThrow("Jev HTTP 529");
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0][0].apiKey).toBe("base-test-key");
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ key_name: "default", ok: false, error: "Jev HTTP 529" }));
});
