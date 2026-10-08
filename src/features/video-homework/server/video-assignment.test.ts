import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
const m = vi.hoisted(() => ({ db: null as unknown as FakeDb, user: { id: "teacher", tenantId: "tenant", systemRole: "teacher" }, full: false, writable: true, readonly: null as string | null, refresh: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: async () => m.readonly }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: async () => m.full ? "full" : "scoped", canWriteTenant: async () => m.writable }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
import { assignHomeworkVideo, getVideoAssignmentOptions } from "./video-assignment";
const C = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", V = "33333333-3333-4333-8333-333333333333";
const input = { classId: C, studentId: S, videoId: V, homeworkDate: "2026-10-01", excluded: false, revision: 0, reason: "잘못 올린 반 수정" };
beforeEach(() => { m.full = false; m.writable = true; m.readonly = null; vi.clearAllMocks(); m.db = createFakeDb({ classes: [{ id: C, tenant_id: "tenant", teacher_id: "teacher" }], lesson_reports: [{ tenant_id: "tenant", student_id: S, class_id: C, report_date: "2026-10-01", video_homework: true }], homework_video_ledger_videos: [] }); m.db.defineRpc("set_homework_video_assignment", () => "saved"); });
describe("담임의 영상 배정", () => {
  it("담임이 본인 반 숙제로 배정할 수 있고 처리자는 로그인 계정으로 고정된다", async () => {
    expect(await assignHomeworkVideo(input)).toEqual({ ok: true });
    expect(m.db.rpcCalls[0]?.args).toMatchObject({ p_actor: "teacher", p_tenant: "tenant", p_full: false, p_context_class: C, p_student: S });
  });
  it.each(["otherTeacher", "otherTenant", "otherStudent", "readonly", "noWrite"])("권한 밖 요청은 RPC에 도달하지 않는다: %s", async kind => {
    if (kind === "otherTeacher") m.db.tables.classes![0]!.teacher_id = "other";
    if (kind === "otherTenant") m.db.tables.classes![0]!.tenant_id = "other";
    if (kind === "otherStudent") m.db.tables.lesson_reports![0]!.student_id = "other";
    if (kind === "readonly") m.readonly = "읽기 전용입니다.";
    if (kind === "noWrite") m.writable = false;
    expect((await assignHomeworkVideo(input)).ok).toBe(false); expect(m.db.rpcCalls).toHaveLength(0);
  });
  it("없는 숙제일과 빈 사유를 거절한다", async () => {
    expect((await assignHomeworkVideo({ ...input, homeworkDate: "2026-10-02" })).ok).toBe(false);
    expect((await assignHomeworkVideo({ ...input, reason: " " })).ok).toBe(false); expect(m.db.rpcCalls).toHaveLength(0);
  });
  it("동시 수정 충돌을 조용히 덮어쓰지 않는다", async () => {
    m.db.defineRpc("set_homework_video_assignment", () => "conflict");
    expect(await assignHomeworkVideo(input)).toMatchObject({ ok: false, error: expect.stringContaining("다른 곳") });
    expect(m.refresh).not.toHaveBeenCalled();
  });
  it("조회 권한도 같은 담당 반으로 제한한다", async () => {
    m.db.tables.classes![0]!.teacher_id = "other";
    expect(await getVideoAssignmentOptions({ classId: C, studentId: S })).toMatchObject({ ok: false });
  });
});
