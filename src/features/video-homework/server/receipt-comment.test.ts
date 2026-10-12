import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
const m = vi.hoisted(() => ({ db: null as unknown as FakeDb, load: vi.fn(), classes: ["c"], full: false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => m.db }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "teacher", tenantId: "tenant", systemRole: "teacher" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: async () => m.full ? "full" : "scoped" }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: async () => "teacher" }));
vi.mock("@/features/classes/server/delegation", () => ({ getTeachingClassIds: async () => ({ all: m.classes }) }));
vi.mock("./ledger-queries", () => ({ loadClassVideos: m.load }));
import { getVideoReceiptComment } from "./receipt-comment";
beforeEach(() => {
  m.classes = ["c"]; m.full = false; m.load.mockReset();
  m.db = createFakeDb({ students: [{ id: "s", tenant_id: "tenant" }], lesson_reports: [
    { id: "newer", tenant_id: "tenant", student_id: "s", class_id: "c", report_date: "2026-10-08", video_homework: false },
    { id: "homework", tenant_id: "tenant", student_id: "s", class_id: "c", report_date: "2026-10-01", video_homework: true },
  ] });
  m.load.mockResolvedValue([{ id: "v", studentId: "s", classId: "c", homeworkDate: "2026-10-01", postedAt: "2026-10-10T03:00:00Z",
    playback: { preview: "preview", thumbnail: "thumbnail", uploadedAt: null } }]);
});
const input = { studentId: "s", classId: "c", date: "2026-10-12" };
it("기한 뒤 실제 제출도 멘트로 읽고 영상이 없으면 제출 문장을 주지 않는다", async () => {
  expect(await getVideoReceiptComment("tenant", input)).toBe("지난 영상 숙제도 제출했습니다.");
  m.load.mockResolvedValue([]);
  expect(await getVideoReceiptComment("tenant", input)).toBeNull();
});
it("다른 지점·담당 밖 반·존재하지 않는 학생의 영상은 조회하지 않는다", async () => {
  expect(await getVideoReceiptComment("foreign", input)).toBeNull();
  m.classes = [];
  expect(await getVideoReceiptComment("tenant", input)).toBeNull();
  m.classes = ["c"];
  expect(await getVideoReceiptComment("tenant", { ...input, studentId: "absent" })).toBeNull();
  expect(m.load).not.toHaveBeenCalled();
});
