import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
const m = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
import { loadVideoAssignmentCandidates, unassignedVideoPairs } from "./assignment-availability";

async function availability(rows: { classId: string; studentId: string; assignedDates: string[] }[], assignedIds = new Set<string>()) {
  const videos = await loadVideoAssignmentCandidates("tenant", rows);
  return videos === null ? null : unassignedVideoPairs(rows, videos, assignedIds);
}

beforeEach(() => { m.db = createFakeDb({ homework_video_ledger_videos: [] }); });
it("학생·반별 숙제일 당일~14일 뒤의 완료 영상만 판단하고 반 미지정·다른 반 영상도 배정할 수 있다", async () => {
  const video = { tenant_id: "tenant", status: "uploaded", drive_file_id: "syntheticDriveFile123", posted_at: "2026-10-02T10:00:00+09:00" };
  m.db.tables.homework_video_ledger_videos = [
    { ...video, student_id: "unassigned", route: {} },
    { ...video, student_id: "anotherClass", route: { classId: "english" } },
    { ...video, student_id: "old", posted_at: "2026-03-15T12:00:00+09:00" },
    { ...video, student_id: "before", posted_at: "2026-09-30T23:59:59+09:00" },
    { ...video, student_id: "sameDay", posted_at: "2026-10-01T00:00:00+09:00" },
    { ...video, student_id: "after14", posted_at: "2026-10-15T23:59:59+09:00" },
    { ...video, student_id: "after15", posted_at: "2026-10-16T00:00:00+09:00" },
    { ...video, student_id: "pending", status: "queued" },
    { ...video, student_id: "foreign", tenant_id: "other" },
    { ...video, student_id: "noHomework" },
    { ...video, student_id: "noFile", drive_file_id: null },
  ];
  const rows = ["unassigned", "anotherClass", "old", "before", "sameDay", "after14", "after15", "pending", "foreign", "empty", "noFile"].map(studentId => ({ classId: "math", studentId, assignedDates: ["2026-10-01"] }));
  rows.push({ classId: "math", studentId: "noHomework", assignedDates: [] }, { classId: "oldClass", studentId: "unassigned", assignedDates: ["2026-08-01"] });
  expect(await availability(rows)).toEqual(new Set(["math:unassigned", "math:anotherClass", "math:sameDay", "math:after14"]));
});
it("수동·자동 배정 및 집계 제외 영상만 남은 학생은 숨기고, 미배정 영상이 하나라도 남으면 표시한다", async () => {
  const base = { tenant_id: "tenant", status: "uploaded", drive_file_id: "syntheticDriveFile123", posted_at: "2026-10-02T10:00:00+09:00" };
  m.db.tables.homework_video_ledger_videos = [
    { ...base, id: "manual", student_id: "manual", route: { classId: "math", homeworkDate: "2026-10-01", manualAssignment: true } },
    { ...base, id: "picked", student_id: "picked", route: { classId: "other", homeworkDate: "2026-09-30" } },
    { ...base, id: "excluded", student_id: "excluded", route: { excluded: true } },
    { ...base, id: "automatic", student_id: "automatic", route: { classId: "math" } },
    { ...base, id: "mixed-bound", student_id: "mixed", route: { classId: "math" } },
    { ...base, id: "mixed-free", student_id: "mixed", route: {} },
    { ...base, id: "classOnly", student_id: "classOnly", route: { classId: "other" } },
    { ...base, id: "dateOnly", student_id: "dateOnly", route: { homeworkDate: "2026-10-01" } },
  ];
  const rows = ["manual", "picked", "excluded", "automatic", "mixed", "classOnly", "dateOnly"].map(studentId => ({ classId: "math", studentId, assignedDates: ["2026-10-01"] }));
  expect(await availability(rows, new Set(["automatic", "mixed-bound"]))).toEqual(new Set(["math:mixed", "math:classOnly", "math:dateOnly"]));
});
it("조회 실패는 영상 없음과 구분한다", async () => {
  m.db.dropTable("homework_video_ledger_videos");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try { expect(await availability([{ classId: "math", studentId: "one", assignedDates: ["2026-10-01"] }])).toBeNull(); }
  finally { warn.mockRestore(); }
});
