import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
const m = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
import { loadVideoAssignmentAvailability } from "./assignment-availability";

beforeEach(() => { m.db = createFakeDb({ homework_video_ledger_videos: [] }); });
it("학생·반별 실제 숙제일 근처의 완료 영상만 판단하고 반 미지정·다른 반 영상도 배정할 수 있다", async () => {
  const video = { tenant_id: "tenant", status: "uploaded", drive_file_id: "syntheticDriveFile123", posted_at: "2026-10-02T10:00:00+09:00" };
  m.db.tables.homework_video_ledger_videos = [
    { ...video, student_id: "unassigned", route: {} },
    { ...video, student_id: "anotherClass", route: { classId: "english" } },
    { ...video, student_id: "old", posted_at: "2026-03-15T12:00:00+09:00" },
    { ...video, student_id: "pending", status: "queued" },
    { ...video, student_id: "foreign", tenant_id: "other" },
    { ...video, student_id: "noHomework" },
    { ...video, student_id: "noFile", drive_file_id: null },
  ];
  const rows = ["unassigned", "anotherClass", "old", "pending", "foreign", "empty", "noFile"].map(studentId => ({ classId: "math", studentId, assignedDates: ["2026-10-01"] }));
  rows.push({ classId: "math", studentId: "noHomework", assignedDates: [] }, { classId: "oldClass", studentId: "unassigned", assignedDates: ["2026-08-01"] });
  expect(await loadVideoAssignmentAvailability("tenant", rows)).toEqual(new Set(["math:unassigned", "math:anotherClass"]));
});
it("조회 실패는 영상 없음과 구분한다", async () => {
  m.db.dropTable("homework_video_ledger_videos");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try { expect(await loadVideoAssignmentAvailability("tenant", [{ classId: "math", studentId: "one", assignedDates: ["2026-10-01"] }])).toBeNull(); }
  finally { warn.mockRestore(); }
});
