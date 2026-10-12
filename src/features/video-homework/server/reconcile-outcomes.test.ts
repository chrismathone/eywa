import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
import { DEFAULT_VIDEO_HOMEWORK_POLICY, type VideoHomeworkPolicy } from "../policy";
import type { VideoArrival } from "../types";
const m = vi.hoisted(() => ({ db: null as unknown as FakeDb, videos: [] as VideoArrival[] | null,
  assigned: [] as { studentId: string; classId: string; date: string }[] | null, policy: {} as VideoHomeworkPolicy, load: vi.fn(),
  settingsError: false, start: "", end: "", settings: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async (...args: unknown[]) => {
  m.settings(...args);
  if (m.settingsError) throw new Error("학원 설정 조회 실패");
  return { report: { videoHomeworkPolicy: m.policy, classnoteSendWindowStart: m.start, classnoteSendWindowEnd: m.end } };
} }));
vi.mock("./assignments", () => ({ getAssignedVideoHomework: async () => m.assigned }));
vi.mock("./ledger-queries", () => ({ loadClassVideos: (...args: unknown[]) => { m.load(...args); return Promise.resolve(m.videos); } }));
import { reconcileVideoHomework } from "./reconcile-outcomes";

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T03:00:00Z")); m.load.mockClear();
  m.settingsError = false; m.start = ""; m.end = ""; m.settings.mockClear();
  m.policy = { ...DEFAULT_VIDEO_HOMEWORK_POLICY };
  m.assigned = [{ studentId: "s", classId: "c", date: "2026-10-01" }]; m.videos = [];
  m.db = createFakeDb({ students: [{ id: "s", tenant_id: "tenant", grade: "중1", is_test: false },
    { id: "other", tenant_id: "foreign", grade: "중1", is_test: false }], classes: [{ id: "c", subject: "math", tenant_id: "tenant" }], homework_video_ledger_videos: [] });
  m.db.defineRpc("reconcile_video_homework_outcomes", () => ({ updated: 1, notifications: 1 }));
  m.db.defineRpc("notify_unassigned_homework_videos", () => 1);
});
afterEach(() => vi.useRealTimers());
it("실제 영상 조회 실패를 미제출로 기록하지 않는다", async () => {
  m.videos = null;
  await expect(reconcileVideoHomework("tenant")).rejects.toThrow("영상 조회 실패");
  expect(m.db.rpcCalls).toEqual([]);
  m.assigned = null;
  await expect(reconcileVideoHomework("tenant")).rejects.toThrow("숙제 조회 실패");
  expect(m.db.rpcCalls).toEqual([]);
});
it("설정 조회 실패를 기본값으로 바꿔 끈 반의 상태를 변경하지 않는다", async () => {
  m.settingsError = true;
  await expect(reconcileVideoHomework("tenant")).rejects.toThrow("설정 조회 실패");
  expect(m.settings).toHaveBeenCalledWith("tenant", { failOnReadError: true });
  expect(m.load).not.toHaveBeenCalled(); expect(m.db.rpcCalls).toEqual([]);
});
it("ClassNote 제한 시간에는 정기 확인을 쉬고 링크 업로드는 즉시 처리한다", async () => {
  m.start = "13:00"; m.end = "22:00"; // 지금은 KST 정오
  expect((await reconcileVideoHomework("tenant", { scheduled: true, notifyUnmatched: true })).checked).toBe(0);
  expect(m.load).not.toHaveBeenCalled(); expect(m.db.rpcCalls).toEqual([]);
  expect((await reconcileVideoHomework("tenant", { studentId: "s" })).checked).toBe(1);
  vi.setSystemTime(new Date("2026-10-12T04:00:00Z"));
  expect((await reconcileVideoHomework("tenant", { scheduled: true })).checked).toBe(1);
  vi.setSystemTime(new Date("2026-10-12T13:00:00Z"));
  expect((await reconcileVideoHomework("tenant", { scheduled: true })).checked).toBe(0);
});
it("기한이 지난 숙제는 미제출 결과로 넘기고 다른 지점 학생은 읽지 않는다", async () => {
  expect(await reconcileVideoHomework("tenant", { studentId: "s" })).toEqual({ checked: 1, updated: 1, notifications: 1 });
  expect(m.load.mock.calls[0][1]).toEqual(["s"]);
  expect(m.db.rpcCalls[0]).toMatchObject({ name: "reconcile_video_homework_outcomes", args: { p_tenant: "tenant",
    p_outcomes: [{ classId: "c", studentId: "s", homeworkDate: "2026-10-01", status: "missing", videoId: null }] } });
});
it("꺼 둔 반과 테스트 학생의 상태를 바꾸지 않는다", async () => {
  m.policy = { ...m.policy, disabledClassIds: ["c"] };
  expect((await reconcileVideoHomework("tenant")).checked).toBe(0);
  expect(m.db.rpcCalls).toEqual([]);
  m.policy = { ...DEFAULT_VIDEO_HOMEWORK_POLICY };
  m.db.tables.students![0].is_test = true;
  expect((await reconcileVideoHomework("tenant")).checked).toBe(0);
});
it("미배정 알림은 일일 작업에서만 보내고, 상태 반영 실패 때는 보내지 않는다", async () => {
  m.videos = [{ id: "v", studentId: "s", classId: null, postedAt: "2026-10-11T03:00:00Z", playback: { preview: "p", thumbnail: "t", uploadedAt: null } }];
  m.db.tables.homework_video_ledger_videos = [{ id: "v", tenant_id: "tenant", status: "uploaded" }];
  await reconcileVideoHomework("tenant");
  expect(m.db.rpcCalls.some(call => call.name === "notify_unassigned_homework_videos")).toBe(false);
  await reconcileVideoHomework("tenant", { notifyUnmatched: true });
  expect(m.db.rpcCalls.at(-1)).toMatchObject({ name: "notify_unassigned_homework_videos", args: { p_tenant: "tenant", p_videos: ["v"] } });
  m.db.rpcCalls.length = 0;
  m.db.defineRpc("reconcile_video_homework_outcomes", () => { throw new Error("temporary database failure"); });
  await expect(reconcileVideoHomework("tenant", { notifyUnmatched: true })).rejects.toThrow();
  expect(m.db.rpcCalls.some(call => call.name === "notify_unassigned_homework_videos")).toBe(false);
});
