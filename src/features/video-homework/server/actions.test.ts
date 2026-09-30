import { beforeEach, describe, expect, it, vi } from "vitest";
import { setVideoHomeworkMark } from "./actions";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), readonly: vi.fn(), access: vi.fn(), canWrite: vi.fn(), upsert: vi.fn(), from: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: mocks.readonly }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: mocks.access, canWriteTenant: mocks.canWrite }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/features/classes/server/delegation", () => ({ getTeachingClassIds: vi.fn() }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ report: { videoHomeworkPolicy: {} } }) }));
vi.mock("../policy", () => ({ isVideoHomeworkEnabled: () => true }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-09-30" }));

const input = { classId: "class-a", studentId: "student-a", checkDate: "2026-09-03", homeworkDate: "2026-09-01", status: "submitted" as const };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "staff-a", tenantId: "tenant-a", systemRole: "master" });
  mocks.readonly.mockResolvedValue(null);
  mocks.access.mockResolvedValue("full");
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => {
    const data = table === "classes" ? { subject: "math" } : table === "students" ? { grade: "중1" }
      : [{ start_date: "2026-01-01", end_date: null, on_hold: false, is_transferred: false }];
    const result = { data, error: null };
    const query = {
      select: vi.fn(), eq: vi.fn(), or: vi.fn(), maybeSingle: async () => result,
      upsert: mocks.upsert, then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.or.mockReturnValue(query);
    return query;
  });
});

describe("영상숙제 제출일 저장", () => {
  it("수업일 이후의 지연 제출도 실제 제출일에 저장하며 테넌트와 회차 키를 유지한다", async () => {
    expect(await setVideoHomeworkMark({ ...input, submittedDate: "2026-09-05" })).toEqual({ ok: true });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: "tenant-a", class_id: "class-a", student_id: "student-a",
      check_date: "2026-09-03", homework_date: "2026-09-01", submitted_date: "2026-09-05",
    }), { onConflict: "tenant_id,class_id,student_id,check_date" });
  });
  it.each(["2026-10-01", "2026-02-30", "", "2026-9-2"])("잘못된 제출일 %s는 DB에 쓰지 않는다", async (submittedDate) => {
    expect((await setVideoHomeworkMark({ ...input, submittedDate })).ok).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("날짜를 보내지 않는 기존 강사 체크는 저장된 제출일을 덮어쓰지 않는다", async () => {
    expect((await setVideoHomeworkMark(input)).ok).toBe(true);
    expect(mocks.upsert.mock.calls[0][0]).not.toHaveProperty("submitted_date");
  });
  it("미수행으로 바꾸면 제출일을 비운다", async () => {
    expect((await setVideoHomeworkMark({ ...input, status: "missing" })).ok).toBe(true);
    expect(mocks.upsert.mock.calls[0][0]).toHaveProperty("submitted_date", null);
  });
  it("읽기 전용과 수정 권한 없는 계정은 날짜도 수정하지 못한다", async () => {
    mocks.readonly.mockResolvedValueOnce("읽기 전용입니다.");
    expect((await setVideoHomeworkMark({ ...input, submittedDate: "2026-09-05" })).ok).toBe(false);
    mocks.access.mockResolvedValue("read"); mocks.canWrite.mockResolvedValue(false);
    expect((await setVideoHomeworkMark({ ...input, submittedDate: "2026-09-05" })).ok).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
