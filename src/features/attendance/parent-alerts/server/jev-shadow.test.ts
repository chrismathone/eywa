// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { from, generate } = vi.hoisted(() => ({ from: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
vi.mock("@/lib/ai/generate", () => ({ generateJSON: generate }));
import { compareParentMessageWithJev } from "./jev-shadow";
import { POST } from "@/app/api/internal/parent-messages/jev-shadow/route";
const tenantId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const request = { tenantId, messageId, course: "수학" };
const row = { id: messageId, tenant_id: tenantId, student_id: "student", child_id: 23, classnote_post_id: 42,
  content: "아까 결석 취소요. 지각합니다", posted_at: "2026-10-01T15:15:00Z", created_at: "2026-10-01T15:16:00Z",
  category: "late", starts_on: "2026-10-02", ends_on: "2026-10-02", model: "claude-test" };
// Read-only query double. Mutation methods deliberately don't exist.
function query(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }), limit: vi.fn().mockResolvedValue({ data, error }),
  };
  return builder;
}
function setup(thread: unknown[] = [row]) {
  const focus = query(row), student = query({ id: "student", name: "민준" }), history = query(thread);
  from.mockReturnValueOnce(focus).mockReturnValueOnce(student).mockReturnValueOnce(history);
  return { focus, student, history };
}
beforeEach(() => {
  vi.clearAllMocks(); from.mockReset();
  vi.stubEnv("CLASSNOTE_JEV_SHADOW_TENANT_IDS", tenantId); vi.stubEnv("CLASSNOTE_INTERNAL_SECRET", "test-secret");
  generate.mockResolvedValue({ data: { attendance: { type: "choice", choice: "late", confidence: 0.96, probabilities: { late: 1 } } }, model: "jev-1.13.0", elapsedMs: 200, usage: { inputTokens: 100, outputTokens: 10 } });
});
afterEach(() => vi.unstubAllEnvs());

it("is disabled without a tenant allowlist, before database access or AI", async () => {
  vi.stubEnv("CLASSNOTE_JEV_SHADOW_TENANT_IDS", "");
  await expect(compareParentMessageWithJev(request)).rejects.toMatchObject({ status: 403 });
  expect(from).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
});
it("isolates tenant, post, child and student; ignores future comments and returns no raw text", async () => {
  const queries = setup([
    { ...row, id: "future", posted_at: "2026-10-02T08:00:00Z", content: "내일은 쉼" }, row,
    { ...row, id: "earlier", posted_at: "2026-10-01T14:30:00Z", content: "내일 결석해요" },
  ]);
  const result = await compareParentMessageWithJev(request);
  for (const builder of Object.values(queries)) expect(builder.eq).toHaveBeenCalledWith("tenant_id", tenantId);
  expect(queries.history.eq.mock.calls).toContainEqual(["classnote_post_id", 42]);
  expect(queries.history.eq.mock.calls).toContainEqual(["child_id", 23]);
  expect(queries.history.eq.mock.calls).toContainEqual(["student_id", "student"]);
  expect(generate.mock.calls[0][0]).toMatchObject({ meta: { tenantId, feature: "parent_attendance_jev_shadow" }, state: {
    history: [{ content: "내일 결석해요", date: "2026-10-01" }], latest: { date: "2026-10-02" },
  } });
  expect(result).toMatchObject({ canNotify: false, mode: "shadow", prediction: "late", historyCount: 1, categoryAgreement: null });
  expect(JSON.stringify(result)).not.toContain(row.content);
  expect(from.mock.calls.map(([table]) => table)).toEqual(["classnote_parent_messages", "students", "classnote_parent_messages"]);
});
it.each(["too_long", "tied_times"])("holds ambiguous context: %s", async (scenario) => {
  setup(scenario === "too_long" ? Array.from({ length: 42 }, () => row) : [row, { ...row, id: "other" }]);
  await expect(compareParentMessageWithJev(request)).rejects.toMatchObject({ status: 422 });
  expect(generate).not.toHaveBeenCalled();
});
it("treats history lookup errors as errors, not an empty successful context", async () => {
  from.mockReturnValueOnce(query(row)).mockReturnValueOnce(query({ name: "민준" })).mockReturnValueOnce(query(null, { message: "private DB detail" }));
  await expect(compareParentMessageWithJev(request)).rejects.toMatchObject({ status: 503 });
  expect(generate).not.toHaveBeenCalled();
});
it("does not compare a stored result for a different date", async () => {
  setup();
  expect((await compareParentMessageWithJev({ ...request, targetDate: "2026-10-03" })).categoryAgreement).toBeNull();
});
it("authenticates the internal route before any work", async () => {
  const result = await POST(new Request("https://test.invalid", { method: "POST", body: JSON.stringify(request) }));
  expect(result.status).toBe(401); expect(from).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
});
it("rejects malformed requests and unsupported send options", async () => {
  const result = await POST(new Request("https://test.invalid", { method: "POST", headers: { "x-eywa-internal": "test-secret" }, body: JSON.stringify({ ...request, send: true }) }));
  expect(result.status).toBe(400); expect(from).not.toHaveBeenCalled();
});
it("returns a non-cacheable comparison without notification writes", async () => {
  setup();
  const result = await POST(new Request("https://test.invalid", { method: "POST", headers: { "x-eywa-internal": "test-secret" }, body: JSON.stringify(request) }));
  expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
  expect(await result.json()).toMatchObject({ ok: true, canNotify: false, categoryAgreement: true });
});
