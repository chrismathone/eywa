import { beforeEach, describe, expect, it, vi } from "vitest";

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

// 원장 2026-10-13 *"오해를 불러일으키겠는데"* — 숙제가 다 영상으로 채워졌는데 지난 숙제의 옛 영상 하나 때문에 '영상 배정'이 떠서 "배정이 안 됐다"로 읽혔다.
it("🔴 숙제가 다 영상으로 채워졌으면 붙지 않은 영상이 남아 있어도 배정 버튼을 띄우지 않는다", async () => {
  m.rows.homework_video_ledger_videos = [
    { id: "uploaded", student_id: "one", posted_at: "2026-10-07T00:00:00Z", route: { classId: "a" } },
    { id: "spare", student_id: "one", posted_at: "2026-10-08T00:00:00Z", route: {} },
  ];
  const result = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]) });
  expect(result.rows[0].hasAssignableVideos).toBe(false);
});

it("영상이 없는 숙제 칸이 있고 그 칸에 들어갈 붙지 않은 영상이 있으면 배정 버튼을 띄운다 — 확실히 다른 과목 영상은 세지 않는다", async () => {
  m.assigned.push({ classId: "a", studentId: "one", date: "2026-10-08" });
  m.rows.homework_video_ledger_videos = [
    { id: "uploaded", student_id: "one", posted_at: "2026-10-07T00:00:00Z", route: { classId: "a" } },
    { id: "spare", student_id: "one", posted_at: "2026-10-08T00:00:00Z", route: {} },
  ];
  const open = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]) });
  expect(open.rows[0].hasAssignableVideos).toBe(true);
  // 같은 영상이 영어 반으로 분류돼 있으면(확실한 다른 과목) 세지 않는다
  (m.rows.classes as unknown[]).push({ id: "e", class_name: "영어 반", subject: "english", is_active: true, closed_at: null });
  m.rows.homework_video_ledger_videos = [
    { id: "uploaded", student_id: "one", posted_at: "2026-10-07T00:00:00Z", route: { classId: "a" } },
    { id: "spare", student_id: "one", posted_at: "2026-10-08T00:00:00Z", route: { classId: "e" }, subject: "english" },
  ];
  const other = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]) });
  expect(other.rows[0].hasAssignableVideos).toBe(false);
});

// 원장 2026-10-14 *"수동 영상들 다 학생들이 업로드해서 배정하고 싶은데 배정이 불가능함"* — 10/13에 손 완료 칸을 붙일 자리에서 뺐더니
// 학생이 올린 영상을 붙일 길이 없어졌다. 영상이 안 붙은 칸이면 손 완료 · 검사 기록만 있는 칸도 붙일 자리다.
it("영상 없이 손으로 찍은 완료 칸 · 검사 기록만 있는 칸도 붙일 자리다 — 들어갈 수 있는 붙지 않은 영상이 있으면 배정 버튼을 띄운다", async () => {
  const mark = { class_id: "a", student_id: "one", check_date: "2026-10-07", homework_date: "2026-10-06", submitted_date: "2026-10-07", status: "submitted", updated_at: "2026-10-07T00:00:00Z" };
  m.assigned = [{ classId: "a", studentId: "one", date: "2026-10-06" }];
  m.rows.student_homework_videos = [];
  m.rows.homework_video_ledger_videos = [{ id: "spare", student_id: "one", posted_at: "2026-10-08T00:00:00Z", route: {} }];
  m.rows.video_homework_marks = [mark];
  const manual = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10");
  expect(manual.rows[0].hasAssignableVideos).toBe(true);
  // 보고서에 '영상 과제' 표시가 없는 수업 — 검사 기록만으로 선 칸(홍채민 10/2 · 김동리 10/2 · 이준형 10/1)
  m.assigned = [];
  const markOnly = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10");
  expect(markOnly.rows.map((row) => row.studentId)).toEqual(["one"]);
  expect(markOnly.rows[0].hasAssignableVideos).toBe(true);
  // 숙제일 + 14일을 넘긴 영상은 그 칸에 못 간다
  m.rows.homework_video_ledger_videos = [{ id: "late", student_id: "one", posted_at: "2026-10-21T00:00:00Z", route: {} }];
  expect((await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10")).rows[0].hasAssignableVideos).toBe(false);
});

// 적대적 리뷰 2026-10-14 — 대표 영상만 '붙음'으로 세면 같은 날 둘째 영상이 '안 붙음'으로 남아, 손 완료 칸이 붙일 자리가 된 뒤로 버튼이 흔하게 떴다.
// 재리뷰 — 그렇다고 전부 '붙음'으로 세면 미확인 칸(10/13 규칙에서 버튼이 뜨던 자리)의 단서가 사라진다 → 기준을 칸 종류로 나눈다.
it("같은 날 둘째 영상 — 미확인 칸이 있으면 버튼을 띄우고(10/13 그대로), 손 완료 칸만 있으면 띄우지 않는다", async () => {
  m.assigned = [{ classId: "a", studentId: "one", date: "2026-10-06" }, { classId: "a", studentId: "one", date: "2026-10-08" }];
  const up = (id: string, at: string) => ({ id, student_id: "one", class_id: "a", posted_at: at, created_at: at, uploaded_at: at, drive_file_id: "syntheticDriveFile123", status: "uploaded" });
  m.rows.student_homework_videos = [up("v1", "2026-10-09T01:00:00Z"), up("v2", "2026-10-09T02:00:00Z")];
  m.rows.homework_video_ledger_videos = [
    { id: "v1", student_id: "one", posted_at: "2026-10-09T01:00:00Z", route: { classId: "a" } },
    { id: "v2", student_id: "one", posted_at: "2026-10-09T02:00:00Z", route: { classId: "a" } },
  ];
  expect((await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10")).rows[0].hasAssignableVideos).toBe(true);
  m.rows.video_homework_marks = [{ class_id: "a", student_id: "one", check_date: "2026-10-09", homework_date: "2026-10-08", submitted_date: "2026-10-09", status: "submitted", updated_at: "2026-10-09T00:00:00Z" }];
  expect((await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10")).rows[0].hasAssignableVideos).toBe(false);
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

// 원장 2026-10-22 — 이희재: 반 전체가 10월 영상 숙제 0건인 반에 숙제 없이 올린 영상. 장부가 반째 빼서 검색해도 안 나왔다.
describe("숙제 0건 반 — 붙지 않은 영상이 있는 학생의 줄(①) · 나머지는 검색 명단(②)", () => {
  beforeEach(() => {
    (m.rows.classes as unknown[]).push({ id: "z", class_name: "숙제 없는 반", subject: "math", is_active: true, closed_at: null });
    m.rows.students = [...(m.rows.students as unknown[]), { id: "lee", name: "합성 학생 둘", school: "성광중", grade: "중2" }, { id: "friend", name: "합성 친구", school: "성광중", grade: "중2" }];
    // z = 월·목 수업(10/1 목 · 10/5 월 · 10/8 목) · 두 학생 다 수강 중
    m.rows.class_schedules = [{ class_id: "z", day_of_week: "mon", valid_from: "2026-03-01", valid_to: null }, { class_id: "z", day_of_week: "thu", valid_from: "2026-03-01", valid_to: null }];
    m.rows.enrollments = ["lee", "friend"].map((student_id) => ({ class_id: "z", student_id, start_date: "2026-03-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null }));
    m.rows.attendance_records = [
      { id: "r1", student_id: "lee", class_id: "z", session_date: "2026-10-05", slot_start: null, status: "present", recorded_at: "2026-10-05T09:00:00Z" },
      { id: "r2", student_id: "lee", class_id: "z", session_date: "2026-10-08", slot_start: null, status: "absent", recorded_at: "2026-10-08T09:00:00Z" },
    ];
    (m.rows.student_homework_videos as unknown[]).push({ id: "free", student_id: "lee", class_id: "z", posted_at: "2026-10-08T08:00:00Z", created_at: "2026-10-08T08:00:00Z",
      uploaded_at: "2026-10-08T08:10:00Z", drive_file_id: "freeDriveFile789", status: "uploaded", free: "true" });
  });
  it("관리자 화면 — 그 학생만 줄로 서고(반 명단은 아니다) 숙제없음 칸은 그 학생이 들은 수업일 · 반 친구는 검색 명단", async () => {
    const result = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10");
    const free = result.rows.find((row) => row.classId === "z");
    expect(result.rows.filter((row) => row.classId === "z").map((row) => row.studentId)).toEqual(["lee"]);
    expect(free).toMatchObject({ hasAssignableVideos: true, lessonDates: ["2026-10-01", "2026-10-05"], assignedDates: [] });
    expect(result.blankFacts["z:lee"]).toEqual({ "2026-10-01": "none", "2026-10-05": "none" });
    expect(result.videos.map((video) => video.id)).toContain("free");
    expect(result.idleRoster).toEqual([{ classId: "z", className: "숙제 없는 반", subject: "math", studentId: "friend", studentName: "합성 친구", school: "성광중", grade: "중2" }]);
  });
  it("휴원일은 숙제없음 칸에서 빠진다(배정 창과 같은 판정)", async () => {
    const result = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", undefined, { isHoliday: (date) => date === "2026-10-01" });
    expect(result.rows.find((row) => row.classId === "z")?.lessonDates).toEqual(["2026-10-05"]);
  });
  it("🔴 강사뷰는 담임 반으로 고른 반만 — 반을 안 주면 숙제 0건 반의 줄도 명단도 없다", async () => {
    const none = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]) });
    expect(none.rows.map((row) => row.classId)).toEqual(["a"]);
    expect(none.idleRoster).toEqual([]);
    const mine = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]), classes: new Set(["z"]) });
    expect(mine.rows.map((row) => `${row.classId}:${row.studentId}`)).toEqual(["a:one", "z:lee"]);
    expect(mine.idleRoster.map((entry) => entry.studentId)).toEqual(["friend"]);
  });
  it("영상을 손으로 배정했으면(붙은 영상) 줄은 사라지고 검색 명단으로 돌아간다", async () => {
    const video = (m.rows.student_homework_videos as Record<string, unknown>[]).find((row) => row.id === "free")!;
    Object.assign(video, { homework_date: "2026-10-05", manual_assignment: "true" });
    const result = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10");
    expect(result.rows.some((row) => row.classId === "z")).toBe(false);
    expect(result.idleRoster.map((entry) => entry.studentId).sort()).toEqual(["friend", "lee"]);
  });
  it("숙제를 못 읽었으면 어느 반이 0건인지 모른다 — 세우지 않는다", async () => {
    m.assigned = null as unknown as typeof m.assigned;
    const result = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10");
    expect(result.rows.some((row) => row.classId === "z")).toBe(false);
    expect(result.idleRoster).toEqual([]);
  });
});

// 적대적 리뷰 2026-10-22 — 반에 숙제가 있고 본인은 0건인 학생(PS3A 최주원 모양)이 숙제 없이 올린 영상은 붙일 숙제 칸이 없어 버튼이 안 떴다.
describe("회차가 있는 반 — 숙제 없이 올린 영상이 안 붙어 있으면 배정할 길을 연다", () => {
  beforeEach(() => {
    m.rows.students = [...(m.rows.students as unknown[]), { id: "two", name: "합성 셋", school: null, grade: "중1" }];
    // 반 a에 학생 two가 수강 중(본인 숙제 0건) — 반 a는 학생 one의 숙제로 '회차 있는 반'
    m.rows.class_schedules = [{ class_id: "a", day_of_week: "tue", valid_from: "2026-03-01", valid_to: null }];
    m.rows.enrollments = [{ class_id: "a", student_id: "two", start_date: "2026-03-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null }];
    m.rows.student_homework_videos = [{ id: "free2", student_id: "two", class_id: "a", posted_at: "2026-10-08T08:00:00Z", created_at: "2026-10-08T08:00:00Z",
      uploaded_at: "2026-10-08T08:10:00Z", drive_file_id: "freeDriveFile790", status: "uploaded", free: "true" }];
  });
  // 재리뷰 2026-10-22 — '미배정 영상' 할 일은 담임에게 가고 링크가 강사뷰다. 담임이 반 친구들에게만 숙제를 냈어도 그 학생이 보여야 한다(⑤).
  it("🔴 강사뷰 — 담임 반 명단의 학생은 '내가 낸 숙제'가 없어도 숙제 없이 올린 영상이 안 붙어 있으면 줄로 선다", async () => {
    const mine = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]), classes: new Set(["a"]) });
    expect(mine.rows.map((row) => `${row.classId}:${row.studentId}`)).toEqual(["a:one", "a:two"]);
    expect(mine.rows.find((row) => row.studentId === "two")).toMatchObject({ hasAssignableVideos: true });
    expect(mine.videos.map((video) => video.id)).toContain("free2");
    // 담임 반이 아니면 그대로 안 선다 · ClassNote 영상이면 안 선다
    expect((await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]), classes: new Set(["b"]) })).rows.map((row) => row.studentId)).toEqual(["one"]);
    (m.rows.student_homework_videos as Record<string, unknown>[])[0].free = null;
    expect((await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", { pairs: new Set(["a:one"]), classes: new Set(["a"]) })).rows.map((row) => row.studentId)).toEqual(["one"]);
  });
  it("숙제 없이 올린 영상 → '영상 배정' · 같은 자리의 ClassNote 영상은 종전대로(버튼 없음)", async () => {
    expect((await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10")).rows.find((row) => row.studentId === "two")?.hasAssignableVideos).toBe(true);
    (m.rows.student_homework_videos as Record<string, unknown>[])[0].free = null;
    expect((await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10")).rows.find((row) => row.studentId === "two")?.hasAssignableVideos).toBe(false);
  });
});

describe("검사 대상 밖 반은 숙제 0건 반이어도 읽지 않는다", () => {
  it("반·과목 기준으로 미리 거른다 — 줄도 검색 명단도 없다", async () => {
    (m.rows.classes as unknown[]).push({ id: "e", class_name: "영어 반", subject: "english", is_active: true, closed_at: null });
    m.rows.students = [...(m.rows.students as unknown[]), { id: "eng", name: "합성 영어", school: null, grade: "중1" }];
    m.rows.class_schedules = [{ class_id: "e", day_of_week: "tue", valid_from: "2026-03-01", valid_to: null }];
    m.rows.enrollments = [{ class_id: "e", student_id: "eng", start_date: "2026-03-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null }];
    const all = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10");
    expect(all.idleRoster.map((entry) => entry.studentId)).toEqual(["eng"]);
    const tracked = await getVideoHomeworkLedger("tenant-a", "2026-10-01", "2026-10-10", undefined, { classTracked: (_, subject) => subject !== "english" });
    expect(tracked.idleRoster).toEqual([]);
  });
});
