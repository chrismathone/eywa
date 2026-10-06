import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]>, reads: [] as { table: string; name: string; args: unknown[] }[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from(table: string) {
  const q: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in", "not", "gte", "lt", "or", "order"]) q[name] = (...args: unknown[]) => { m.reads.push({ table, name, args }); return q; };
  q.range = () => Promise.resolve({ data: m.rows[table] ?? [], error: null });
  return q;
} }) }));
vi.mock("@/lib/supabase/batch", () => ({
  fetchAllPaged: async (load: (from: number, to: number) => Promise<{ data: unknown[] }>) => (await load(0, 999)).data,
  fetchAllPagedInChunks: async (ids: string[], load: (ids: string[], from: number, to: number) => Promise<{ data: unknown[] }>) => ids.length ? (await load(ids, 0, 999)).data : [],
}));
vi.mock("./assignments", () => ({ getAssignedVideoHomework: async () => [
  { classId: "a", studentId: "one", date: "2026-10-06" }, { classId: "b", studentId: "one", date: "2026-10-06" },
] }));
vi.mock("./blank-facts", () => ({ loadBlankFacts: async () => ({}) }));

import { getVideoHomeworkLedger } from "./ledger-queries";

beforeEach(() => {
  m.reads = [];
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
