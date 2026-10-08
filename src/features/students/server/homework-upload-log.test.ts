import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ student: vi.fn(), admin: vi.fn(), result: { data: [] as unknown[], error: null as null | { code: string } }, filters: [] as unknown[][] }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: async () => ({ tenantId: "tenant" }) }));
vi.mock("./queries", () => ({ getStudentById: m.student }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
import { getStudentUploadLog } from "./homework-upload-log";
beforeEach(() => {
  vi.clearAllMocks(); m.filters = []; m.result = { data: [], error: null }; m.student.mockResolvedValue({ id: "student" });
  const q = { select: () => q, eq: (...args: unknown[]) => { m.filters.push(args); return q; }, gte: () => q, order: () => q, limit: async () => m.result };
  m.admin.mockReturnValue({ from: () => q });
});
it("학생 열람 게이트를 통과하기 전에는 관리자 DB를 쓰지 않는다", async () => {
  m.student.mockResolvedValue(null); await expect(getStudentUploadLog("student")).rejects.toThrow("열람"); expect(m.admin).not.toHaveBeenCalled();
});
it("지점과 학생을 제한하고 토큰·원문 오류·경로는 응답에서 뺀다", async () => {
  m.result.data = [{ id: "u", created_at: "2026-10-08T13:00:00Z", status: "started", bytes: 100, homework_date: "2026-10-06", homework_video_links: { classes: { class_name: "수학" } }, token: "PRIVATE", error: "PRIVATE", route: "PRIVATE" }];
  const result = await getStudentUploadLog("student"); expect(result.ready).toBe(true);
  expect(m.filters).toContainEqual(["tenant_id", "tenant"]); expect(m.filters).toContainEqual(["homework_video_links.student_id", "student"]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
it("조회 실패를 기록 0건으로 안내하지 않는다", async () => {
  m.result.error = { code: "500" }; expect(await getStudentUploadLog("student")).toEqual({ ready: false, rows: [] });
});
