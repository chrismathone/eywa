import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ teacher: vi.fn(), settings: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: m.teacher }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.access }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("@/features/classnote-reply/server/reply-queries", () => ({ PARENT_THREAD_DAYS: 14 }));
import { readLiveFollowUps } from "./live-follow-ups";
import { readLiveParentMessages } from "./live-parent-messages";
import { readLiveEnrollmentHistory } from "./live-enrollment-history";
import type { LiveContext } from "./live-context";
import { markFolded } from "@/lib/folded-read";

function fixture(result: unknown) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "or", "gte", "lte", "order"]) q[name] = vi.fn(() => q);
  q.limit = vi.fn(async () => result); q.range = vi.fn(async () => result);
  const from = vi.fn(() => q);
  return { q, from, c: { db: { from }, tenant: "t", studentId: "s", consultations: true, role: "director", today: "2026-10-23", checkedAt: "2026-10-23T00:00:00.000Z" } as unknown as LiveContext };
}
beforeEach(() => {
  vi.resetAllMocks(); m.teacher.mockResolvedValue(null); m.access.mockResolvedValue(true);
  m.settings.mockResolvedValue({ modules: {}, report: { classnoteParentReplyMode: "on" } });
});
it("keeps pending follow-ups scoped to the original counselor, due dates and exact count", async () => {
  const { c, q } = fixture({ count: 100, data: [
    { id: "a", follow_up_action: "다음 상담 일정 확인", follow_up_date: "2026-10-22" },
    { id: "b", follow_up_action: "준비 사항 확인", follow_up_date: null },
  ], error: null });
  m.teacher.mockResolvedValue("teacher");
  const r = await readLiveFollowUps(c);
  expect(q.eq.mock.calls).toEqual(expect.arrayContaining([["tenant_id", "t"], ["student_id", "s"], ["follow_up_done", false], ["counselor_id", "teacher"]]));
  expect(q.order).toHaveBeenCalledWith("follow_up_date", { ascending: true, nullsFirst: false });
  expect(r.total).toBe(100); expect(r.items.map((i) => i.title)).toEqual(["예정일 지남", "날짜 미정"]);
  expect(r.items[1].date).toBeUndefined(); expect(q.limit).toHaveBeenCalledWith(5);
});
it("does not read forbidden follow-ups or show a count", async () => {
  const { c, from } = fixture({ data: [], count: 0 });
  expect(await readLiveFollowUps({ ...c, consultations: false })).toMatchObject({ state: "forbidden", total: null, items: [] });
  expect(from).not.toHaveBeenCalled();
});
it("removes a disabled parent-message module completely", async () => {
  const { c, from } = fixture(null);
  m.settings.mockResolvedValue({ modules: { disabled: ["classnote"] }, report: { classnoteParentReplyMode: "on" } });
  expect(await readLiveParentMessages(c)).toBeNull(); expect(from).not.toHaveBeenCalled();
});
it("distinguishes failed settings from a disabled parent module", async () => {
  const { c, from } = fixture(null);
  m.settings.mockResolvedValue(markFolded({ modules: {}, report: {} }, "settings unavailable"));
  expect(await readLiveParentMessages(c)).toMatchObject({ label: "소통 기록", state: "failed", total: null });
  expect(from).not.toHaveBeenCalled();
});
it("keeps the original board permission before reading parent messages", async () => {
  const { c, from } = fixture(null); m.access.mockResolvedValue(false);
  expect(await readLiveParentMessages(c)).toMatchObject({ state: "forbidden", total: null });
  expect(from).not.toHaveBeenCalled(); expect(m.access).toHaveBeenCalledWith(c.role, "lesson_reports");
});
it("reads only explicitly linked parent messages in the same recent window as the board", async () => {
  const { c, q } = fixture({ data: [{ id: "p", source: "comment", content: "준비물 문의", posted_at: cDate() }], count: 17, error: null });
  const r = await readLiveParentMessages(c);
  expect(q.eq.mock.calls).toEqual(expect.arrayContaining([["tenant_id", "t"], ["student_id", "s"]]));
  expect(q.gte).toHaveBeenCalledWith("posted_at", "2026-10-09T00:00:00.000Z");
  expect(q.lte).toHaveBeenCalledWith("posted_at", c.checkedAt);
  expect(r).toMatchObject({ total: 17, items: [{ title: "학부모 댓글", evidence: [{ source: "classnote_parent_messages", id: "p" }] }] });
});
function cDate() { return "2026-10-22T00:00:00Z"; }
it.each([["42501", "forbidden"], ["42P01", "schema_missing"], ["500", "failed"]])("preserves parent source failure %s", async (code, state) => {
  const { c } = fixture({ data: null, count: null, error: { code } });
  expect(await readLiveParentMessages(c)).toMatchObject({ state, total: null, items: [] });
});
it("does not turn an unknown parent-message count into zero", async () => {
  const { c } = fixture({ data: [], count: null, error: null });
  expect(await readLiveParentMessages(c)).toMatchObject({ state: "failed", total: null });
});
it("shows a future transfer once, with both source IDs, and hides makeup pools", async () => {
  const base = { class_id: "a", start_date: "2026-01-01", end_date: null, is_transferred: false, withdrawal_reason: null,
    cls: { class_name: "A반", subject: "math", is_makeup_pool: false } };
  const { c } = fixture({ error: null, data: [
    { ...base, id: "a", end_date: "2027-01-01", is_transferred: true },
    { ...base, id: "b", class_id: "b", start_date: "2027-01-01", cls: { ...base.cls, class_name: "B반" } },
    { ...base, id: "pool", cls: { ...base.cls, class_name: "숨은 반", is_makeup_pool: true } },
  ] });
  const r = await readLiveEnrollmentHistory(c);
  expect(r.total).toBe(2); expect(r.items[0].title).toBe("예정 · A반 → B반");
  expect(r.items[0].evidence.map((e) => e.id)).toEqual(["a", "b"]);
  expect(JSON.stringify(r)).not.toContain("숨은 반");
});
it("marks missing classes as partial and does not invent a class name", async () => {
  const { c } = fixture({ data: [{ id: "a", cls: null }], error: null });
  expect(await readLiveEnrollmentHistory(c)).toMatchObject({ state: "partial", items: [] });
});
