import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(), readonly: vi.fn(), teacherId: vi.fn(), canWrite: vi.fn(), log: vi.fn(),
  chunks: [] as unknown[][],
  inserts: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[],
  current: null as Record<string, unknown> | null,
  sendOn: true,
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: m.teacherId, readonlyTeacherViewError: m.readonly }));
vi.mock("@/features/classes/server/delegation", () => ({ getTeachingClassIds: async () => ({ all: ["c1"] }) }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ report: { classnoteSubjects: ["math", "english"] } }) }));
vi.mock("@/features/owner/classnote-gate", () => ({ classnoteSendOn: () => m.sendOn, classnoteModuleOn: () => true }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("./scope", () => ({ hasClassnoteNameCollision: async () => false }));
vi.mock("@/lib/supabase/batch", () => ({
  fetchInChunks: async () => m.chunks.shift() ?? [],
  fetchAllPagedInChunks: async () => [],
}));
vi.mock("@/features/report-admin/server/notice-class-route", () => ({
  routeNoticeCandidates: async ({ candidates }: { candidates: { studentId: string; name: string }[] }) => ({
    rest: candidates.filter(c => c.studentId !== "s2"),
    classTargets: candidates.filter(c => c.studentId === "s2").map(c => ({
      studentId: c.studentId, studentName: c.name, board: "class:c1:s2", classId: "c1", className: "수학반",
    })),
    skipped: [],
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const q = {
        select: () => q, eq: () => q, in: () => q,
        insert: (value: Record<string, unknown>) => { m.inserts.push(value); return q; },
        update: (value: Record<string, unknown>) => { m.updates.push(value); return q; },
        single: async () => ({ data: { id: "n1" }, error: null }),
        maybeSingle: async () => ({ data: m.current, error: null }),
        then: (resolve: (value: { data: { id: string }[]; error: null }) => void) => resolve({ data: [{ id: "n1" }], error: null }),
      };
      return q;
    },
  }),
}));

import { editPostedNotice, editQueuedNotice, sendOnescreenNotice } from "./notice-actions";

const students = [
  { id: "s1", name: "김민서G", classnote_name: "별도보드이름", status: "enrolled" },
  { id: "s2", name: "박민준A", classnote_name: null, status: "enrolled" },
];
const recipients = [{ studentId: "s1", subject: "english" }, { studentId: "s2", subject: "math", classId: "c1" }];

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "u1", tenantId: "t1", displayName: "이수진", systemRole: "teacher" });
  m.readonly.mockResolvedValue(null);
  m.teacherId.mockResolvedValue("u1");
  m.canWrite.mockResolvedValue(false);
  m.chunks = [[{ student_id: "s1" }, { student_id: "s2" }], students];
  m.inserts = [];
  m.updates = [];
  m.current = null;
  m.sendOn = true;
});

describe("개별 공지 태그 발송", () => {
  it("대상 순서·보드 이름과 무관하게 서버의 학생 ID별 이름으로 치환하고 배달 경로는 보존한다", async () => {
    const body = "{학생} 학부모님, {작성자}입니다.";
    const result = await sendOnescreenNotice({ body, students: [
      { ...recipients[0], individualBody: "{학생이름}이는 잘 참여했어요." }, recipients[1],
    ] });
    expect(result).toMatchObject({ ok: true, queued: 2 });
    expect(m.inserts[0]).toMatchObject({ body, targets: [
      { studentId: "s2", studentName: "박민준A", board: "class:c1:s2", classId: "c1", body: "박민준 학부모님, 이수진 선생님입니다." },
      { studentId: "s1", studentName: "별도보드이름", board: "(영어)별도보드이름", body: "김민서 학부모님, 이수진 선생님입니다.\n\n민서는 잘 참여했어요." },
    ] });
  });
  it("테스트 발송은 선택 학생 대신 학원이 이름으로 치환한다", async () => {
    expect(await sendOnescreenNotice({ body: "{학생} / {작성자}", students: recipients, test: true })).toMatchObject({ ok: true, queued: 1 });
    expect(m.inserts[0].targets).toEqual([{ studentId: "", studentName: "학원이", board: "(수학)학원이", body: "학원이 / 이수진 선생님" }]);
  });
  it("공통·개별 내용의 모르는 태그는 큐에 올리지 않는다", async () => {
    expect((await sendOnescreenNotice({ body: "{진도} 안내", students: recipients })).ok).toBe(false);
    expect((await sendOnescreenNotice({ body: "안내", students: [{ ...recipients[0], individualBody: "{숙제}" }] })).ok).toBe(false);
    expect(m.inserts).toEqual([]);
  });
  it("개별 내용까지 합친 길이 상한과 발송 OFF를 지킨다", async () => {
    expect((await sendOnescreenNotice({ body: "가".repeat(3990), students: [{ ...recipients[0], individualBody: "나".repeat(20) }] })).ok).toBe(false);
    m.chunks = [[{ student_id: "s1" }], students];
    m.sendOn = false;
    expect(await sendOnescreenNotice({ body: "{학생} 안내", students: recipients })).toMatchObject({ ok: true, dryRun: true });
    expect(m.inserts).toEqual([]);
  });
  it("열람 전용·발송 권한 없는 계정은 태그를 써도 발송할 수 없다", async () => {
    m.readonly.mockResolvedValue("열람 전용입니다");
    expect((await sendOnescreenNotice({ body: "{학생}", students: recipients })).ok).toBe(false);
    m.readonly.mockResolvedValue(null);
    m.teacherId.mockResolvedValue(null);
    expect((await sendOnescreenNotice({ body: "{학생}", students: [], test: true })).ok).toBe(false);
    expect(m.inserts).toEqual([]);
  });
});

describe("태그 공지 수정", () => {
  it("대기 공지는 새 공통 내용으로 학생별 본문을 다시 만들고 대상 매핑을 유지한다", async () => {
    m.current = { targets: [
      { studentId: "s2", board: "class:c1:s2", classId: "c1", body: "옛 공통 + 개별" },
      { studentId: "s1", board: "(영어)별도보드이름", body: "옛 공통" },
    ] };
    m.chunks = [students];
    expect(await editQueuedNotice("n1", "{학생이름}이는 다음 주에 만나요.")).toEqual({ ok: true });
    expect(m.updates[0]).toMatchObject({ targets: [
      { studentId: "s2", board: "class:c1:s2", classId: "c1", body: "민준이는 다음 주에 만나요." },
      { studentId: "s1", board: "(영어)별도보드이름", body: "민서는 다음 주에 만나요." },
    ] });
  });
  it("태그 없는 새 공통으로 수정하면 이전 학생별 본문을 제거한다", async () => {
    m.current = { targets: [{ studentId: "s1", board: "b1", body: "김민서 안내" }] };
    expect(await editQueuedNotice("n1", "휴강 안내")).toEqual({ ok: true });
    expect(m.updates[0]).toEqual({ body: "휴강 안내", targets: [{ studentId: "s1", board: "b1" }] });
  });
  it("이름을 확인할 수 없으면 대기 공지를 변경하지 않는다", async () => {
    m.current = { targets: [{ studentId: "s1", board: "b1" }] };
    m.chunks = [[]];
    expect((await editQueuedNotice("n1", "{학생} 안내")).ok).toBe(false);
    expect(m.updates).toEqual([]);
  });
  it("게시본의 공통 PATCH에는 치환 전 태그를 보내지 않는다", async () => {
    expect(await editPostedNotice("n1", "{학생} 안내")).toMatchObject({ ok: false, error: expect.stringContaining("게시취소") });
    expect(m.updates).toEqual([]);
  });
});
