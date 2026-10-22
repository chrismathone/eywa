import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ viewer: { user: { id: "teacher", tenantId: "tenant" }, teacherId: "teacher" as string | null, manage: false, request: false, scope: null as string[] | null }, from: vi.fn() }));
vi.mock("./queries", () => ({ reportViewer: async () => state.viewer }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from }) }));
import { getArchive, listArchives, archiveStudents } from "./archives";
function query(row: unknown = null) {
  const q = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), maybeSingle: vi.fn(), or: vi.fn() };
  for (const fn of Object.values(q)) fn.mockReturnValue(q);
  q.range.mockResolvedValue({ data: [], error: null }); q.maybeSingle.mockResolvedValue({ data: row, error: null });
  state.from.mockReturnValue(q); return q;
}
beforeEach(() => { state.viewer.teacherId = "teacher"; state.viewer.manage = false; state.from.mockReset(); });
describe("archive authorship boundaries", () => {
  it("filters teacher lists by both tenant and mapped author", async () => {
    const q = query(); await listArchives();
    expect(q.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(q.eq).toHaveBeenCalledWith("mapped_teacher_id", "teacher");
    expect(await archiveStudents()).toEqual([]);
  });
  it.each([null, "retired", "someone-else"])("rejects direct access to author %s", async author => {
    query({ mapped_teacher_id: author }); expect(await getArchive("archive")).toBeNull();
  });
  it("allows an assigned author to read a historical report", async () => {
    query({ mapped_teacher_id: "teacher" }); expect(await getArchive("archive")).toEqual({ mapped_teacher_id: "teacher" });
  });
  it("management can view unmapped history without write permission", async () => {
    state.viewer.teacherId = null; state.viewer.manage = true;
    const q = query({ mapped_teacher_id: null });
    expect(await getArchive("archive")).not.toBeNull(); await listArchives();
    expect(q.eq).not.toHaveBeenCalledWith("mapped_teacher_id", expect.anything());
  });
});
