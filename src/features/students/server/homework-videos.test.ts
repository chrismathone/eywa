import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  access: vi.fn(), student: vi.fn(), admin: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(),
}));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: m.access }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("./queries", () => ({ getStudentById: m.student }));
vi.mock("@/features/video-homework/server/video-source", () => ({ homeworkVideoSource: async () => "student_homework_videos" }));
import { getStudentHomeworkVideos } from "./homework-videos";

beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: m.select, eq: m.eq, order: m.order, range: m.range };
  m.access.mockResolvedValue({ tenantId: "tenant" }); m.student.mockResolvedValue({ id: "student" });
  m.admin.mockReturnValue({ from: m.from }); m.from.mockReturnValue(query);
  for (const fn of [m.select, m.eq, m.order]) fn.mockReturnValue(query);
  m.range.mockResolvedValue({ data: [], error: null });
});
describe("숙제 영상 학생 열람 권한", () => {
  it("학생 상세 권한이 없으면 관리자로 DB를 조회하지 않는다", async () => {
    m.student.mockResolvedValue(null);
    await expect(getStudentHomeworkVideos("student")).rejects.toThrow("열람");
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("지점과 학생을 모두 제한하고 원본 주소·작업 토큰은 반환하지 않는다", async () => {
    expect(await getStudentHomeworkVideos("student")).toEqual({ ready: true, rows: [] });
    expect(m.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(m.eq).toHaveBeenCalledWith("student_id", "student");
    expect(m.select.mock.calls[0][0]).not.toMatch(/payload|lock_token|route/);
  });
  it("스키마 미적용과 조회 장애를 영상 0개로 오인하지 않는다", async () => {
    m.range.mockResolvedValue({ data: null, error: { code: "42P01", message: "missing" } });
    expect((await getStudentHomeworkVideos("student")).ready).toBe(false);
    m.range.mockResolvedValue({ data: null, error: { code: "500", message: "offline" } });
    await expect(getStudentHomeworkVideos("student")).rejects.toMatchObject({ code: "500" });
  });
});
