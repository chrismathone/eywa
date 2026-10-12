import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]>, reads: [] as { table: string; name: string; args: unknown[] }[],
  assigned: [] as { classId: string; studentId: string; date: string }[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from(table: string) {
  const q: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in", "not", "gte", "lt", "or", "order", "returns"]) q[name] = (...args: unknown[]) => { m.reads.push({ table, name, args }); return q; };
  q.range = () => Promise.resolve({ data: m.rows[table] ?? [], error: null });
  return q;
} }) }));
vi.mock("@/lib/supabase/batch", () => ({
  fetchAllPaged: async (load: (from: number, to: number) => Promise<{ data: unknown[] }>) => (await load(0, 999)).data,
  fetchAllPagedInChunks: async (ids: string[], load: (ids: string[], from: number, to: number) => Promise<{ data: unknown[] }>) => ids.length ? (await load(ids, 0, 999)).data : [],
}));
vi.mock("./assignments", () => ({ getAssignedVideoHomework: async () => m.assigned }));
vi.mock("./blank-facts", () => ({ loadBlankFacts: async () => ({}) }));
vi.mock("./video-source", () => ({ homeworkVideoSource: async () => "student_homework_videos" }));

import { getVideoHomeworkLedger } from "./ledger-queries";

beforeEach(() => {
  m.reads = [];
  m.assigned = [{ classId: "a", studentId: "one", date: "2026-10-06" }, { classId: "b", studentId: "one", date: "2026-10-06" }];
  m.rows = {
    classes: [{ id: "a", class_name: "내 반", subject: "math", is_active: true, closed_at: null }, { id: "b", class_name: "다른 반", subject: "math", is_active: true, closed_at: null }],
    students: [{ id: "one", name: "합성 학생", school: null, grade: "중1" }],
    student_homework_videos: [
      { id: "uploaded", student_id: "one", class_id: "a", posted_at: "2026-10-07T00:00:00Z", created_at: "2026-10-07T00:00:00Z", uploaded_at: "2026-10-07T00:00:00Z", drive_file_id: "syntheticDriveFile123", status: "uploaded" },
      { id: "queued", student_id: "one", class_id: "a", posted_at: "2026-10-07T00:00:00Z", status: "queued", drive_file_id: "syntheticDriveFile123" },
      { id: "unsafe", student_id: "one", class_id: "a", posted_at: "2026-10-07T00:00:00Z", status: "uploaded", drive_file_id: "//evil.example/video" },
      { id: "foreign-class", student_id: "one", class_id: "b", posted_at: "2026-10-07T00:00:00Z", status: "uploaded", drive_file_id: "differentDriveFile456" },
    ],
  };
});

it("장부의 지점·반·학생 범위 안에서 업로드 완료 영상만 검증된 iframe 주소를 갖는다", async () => {
  const result = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]) });
  expect(result.videosKnown).toBe(true);
  expect(result.videos.map(v => v.id)).toEqual(["uploaded", "queued", "unsafe"]);
  expect(result.videos[0].playback).toEqual({ preview: "https://drive.google.com/file/d/syntheticDriveFile123/preview", thumbnail: "https://drive.google.com/thumbnail?id=syntheticDriveFile123&sz=w64", uploadedAt: "2026-10-07T00:00:00Z" });
  expect(result.videos[1].playback).toBeNull();
  expect(result.videos[2].playback).toBeNull();
  expect(m.reads.filter(r => r.table === "student_homework_videos" && r.name === "eq")).toContainEqual({ table: "student_homework_videos", name: "eq", args: ["tenant_id", "tenant-a"] });
  expect(JSON.stringify(result)).not.toContain("drive_file_id");
  expect(JSON.stringify(result)).not.toContain("/view");
});

it("모든 후보 영상이 자동 배정됐으면 다른 반의 영상까지 확인해 배정 버튼을 숨긴다", async () => {
  m.rows.student_homework_videos = (m.rows.student_homework_videos as { id: string }[]).filter(video => ["uploaded", "foreign-class"].includes(video.id));
  m.rows.homework_video_ledger_videos = [
    { id: "uploaded", student_id: "one", posted_at: "2026-10-07T00:00:00Z", route: { classId: "a" } },
    { id: "foreign-class", student_id: "one", posted_at: "2026-10-07T00:00:00Z", route: { classId: "b" } },
  ];
  const result = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]) });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].hasAssignableVideos).toBe(false);
  expect(result.assignmentVideosKnown).toBe(true);
  // 다른 반의 판정은 서버에서만 사용하며 그 영상은 강사에게 내려보내지 않는다.
  expect(result.videos.map(video => video.id)).toEqual(["uploaded"]);
});

it("숙제가 완료됐어도 미배정 후보가 남아 있으면 배정 버튼을 유지한다", async () => {
  m.rows.homework_video_ledger_videos = [
    { id: "uploaded", student_id: "one", posted_at: "2026-10-07T00:00:00Z", route: { classId: "a" } },
    { id: "spare", student_id: "one", posted_at: "2026-10-08T00:00:00Z", route: {} },
  ];
  const result = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]) });
  expect(result.rows[0].hasAssignableVideos).toBe(true);
});

it("조회 기간 밖의 숙제에 자동 배정된 영상도 미배정으로 되돌리지 않는다", async () => {
  m.assigned.push({ classId: "a", studentId: "one", date: "2026-09-30" });
  m.rows.student_homework_videos = (m.rows.student_homework_videos as { id: string }[]).filter(video => video.id === "uploaded");
  m.rows.homework_video_ledger_videos = [
    { id: "uploaded", student_id: "one", posted_at: "2026-10-07T00:00:00Z", route: { classId: "a" } },
  ];
  const result = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]) });
  expect(result.rows[0].hasAssignableVideos).toBe(false);
});
