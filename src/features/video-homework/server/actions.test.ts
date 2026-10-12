import { beforeEach, describe, expect, it, vi } from "vitest";
import { setVideoHomeworkMark, setVideoHomeworkMarksBulk, setVideoHomeworkRound } from "./actions";

type Call = { table: string; op: "select" | "update" | "delete" | "upsert"; filters: unknown[][]; payload?: unknown; opts?: unknown };
const mocks = vi.hoisted(() => ({
  user: vi.fn(), readonly: vi.fn(), teacher: vi.fn(), teaching: vi.fn(), access: vi.fn(), canWrite: vi.fn(), log: vi.fn(),
  calls: [] as Call[], respond: (() => ({ data: null, error: null })) as (call: Call) => { data: unknown; error: unknown },
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: mocks.readonly, effectiveTeacherId: mocks.teacher }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: mocks.access, canWriteTenant: mocks.canWrite }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/features/classes/server/delegation", () => ({ getTeachingClassIds: mocks.teaching }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ report: { videoHomeworkPolicy: {} } }) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: mocks.log }));
vi.mock("./assignments", () => ({ videoHomeworkColumnReady: async () => true }));
vi.mock("../policy", () => ({ isVideoHomeworkEnabled: () => true }));
vi.mock("@/lib/date-kst", async (load) => ({ ...(await load<typeof import("@/lib/date-kst")>()), kstToday: () => "2026-09-30" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      const finish = () => { mocks.calls.push(call); return Promise.resolve(mocks.respond(call)); };
      const query: Record<string, unknown> = {};
      for (const name of ["select", "eq", "or", "is", "in", "neq", "limit", "not"])
        query[name] = (...args: unknown[]) => { if (name !== "select") call.filters.push([name, ...args]); return query; };
      query.update = (payload: unknown) => { call.op = "update"; call.payload = payload; return query; };
      query.delete = () => { call.op = "delete"; return query; };
      query.upsert = (payload: unknown, opts: unknown) => { call.op = "upsert"; call.payload = payload; call.opts = opts; return finish(); };
      query.maybeSingle = finish;
      query.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => finish().then(resolve, reject);
      return query;
    },
  }),
}));

const has = (call: Call, ...filter: unknown[]) => call.filters.some((f) => JSON.stringify(f) === JSON.stringify(filter));
const writes = () => mocks.calls.filter((call) => call.op !== "select");
/** 기본 세계: 반·학생이 있고 정규 수강 중 · 같은 숙제 기록 없음 · 그날 보고서에 '영상 과제 있음'. */
function world(over: { sameHomework?: { id: string }[]; assigned?: boolean; own?: boolean } = {}) {
  mocks.respond = (call) => {
    if (call.op !== "select") return { data: null, error: null };
    if (call.table === "classes") return { data: { subject: "math", class_name: "수학 A" }, error: null };
    if (call.table === "students") return { data: { grade: "중1", name: "김민준" }, error: null };
    if (call.table === "enrollments") return { data: [{ start_date: "2026-01-01", end_date: null, on_hold: false, is_transferred: false }], error: null };
    // 낸 사람 확인(created_by)은 따로 답한다 — 기본은 내가 낸 숙제.
    if (call.table === "lesson_reports" && call.filters.some((f) => f[1] === "created_by")) return { data: over.own === false ? [] : [{ id: "r1" }], error: null };
    if (call.table === "lesson_reports") return { data: over.assigned === false ? [] : [{ id: "r1" }], error: null };
    if (call.table === "video_homework_marks") return { data: call.filters.some((f) => f[1] === "homework_date") ? over.sameHomework ?? [] : [], error: null };
    return { data: [], error: null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls = [];
  mocks.user.mockResolvedValue({ id: "staff-a", tenantId: "tenant-a", systemRole: "master" });
  mocks.readonly.mockResolvedValue(null);
  mocks.teacher.mockResolvedValue(null);
  mocks.teaching.mockImplementation(async (_db, teacherId) => ({ all: teacherId === "teacher-b" ? ["class-a"] : [] }));
  mocks.access.mockResolvedValue("full");
  world();
});

const onescreen = { classId: "class-a", studentId: "student-a", checkDate: "2026-09-03", homeworkDate: "2026-09-01", status: "submitted" as const };

describe("원스크린 검사(setVideoHomeworkMark) — 같은 숙제 = 한 줄", () => {
  it("다른 강사 편집은 대상 강사의 담당 반을 검사하고 실제 편집자를 기록한다", async () => {
    mocks.access.mockResolvedValue("scoped"); mocks.canWrite.mockResolvedValue(true);
    mocks.teacher.mockResolvedValue("teacher-b");
    expect(await setVideoHomeworkMark(onescreen)).toEqual({ ok: true });
    expect(writes()[0].payload).toMatchObject({ updated_by: "staff-a" });
    mocks.calls = [];
    expect(await setVideoHomeworkMark({ ...onescreen, classId: "unrelated" })).toMatchObject({ ok: false });
    expect(writes()).toEqual([]);
  });
  it("같은 숙제의 기록이 다른 자리에 이미 있으면(영상 제출 현황에서 찍음) 새 줄을 만들지 않고 그 줄을 고친다", async () => {
    world({ sameHomework: [{ id: "m1" }] });
    expect(await setVideoHomeworkMark(onescreen)).toEqual({ ok: true });
    expect(writes().map((c) => c.op)).toEqual(["update"]);
    expect(has(writes()[0], "in", "id", ["m1"])).toBe(true);
    expect(writes()[0].payload).not.toHaveProperty("submitted_date");
  });
  it("없으면 검사한 수업일 자리에 넣는다 — 지점·반·학생·검사일 키 그대로, 날짜를 안 보내면 제출일을 건드리지 않는다", async () => {
    expect((await setVideoHomeworkMark(onescreen)).ok).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ op: "upsert", opts: { onConflict: "tenant_id,class_id,student_id,check_date" },
      payload: { tenant_id: "tenant-a", class_id: "class-a", student_id: "student-a", check_date: "2026-09-03", homework_date: "2026-09-01", status: "submitted" } });
    expect(writes()[0].payload).not.toHaveProperty("submitted_date");
  });
  it("미수행은 제출일을 비우고 · 되돌리기는 같은 숙제 기록과 그날 칸의 기록을 지운다(그날 칸에 선 기록 = 지울 기록, 예전 동작)", async () => {
    await setVideoHomeworkMark({ ...onescreen, status: "missing" });
    expect(writes()[0].payload).toHaveProperty("submitted_date", null);
    mocks.calls = [];
    world({ sameHomework: [{ id: "m1" }] });
    expect((await setVideoHomeworkMark({ ...onescreen, status: null })).ok).toBe(true);
    const slot = mocks.calls.find((c) => c.table === "video_homework_marks" && has(c, "eq", "check_date", "2026-09-03"))!;
    expect(slot.filters.some((f) => f[0] === "or")).toBe(false);
    expect(writes().map((c) => c.op)).toEqual(["delete"]);
  });
  it.each(["2026-10-01", "2026-02-30", "", "2026-9-2"])("잘못된 제출일 %s는 DB에 쓰지 않는다", async (submittedDate) => {
    expect((await setVideoHomeworkMark({ ...onescreen, submittedDate })).ok).toBe(false);
    expect(mocks.calls).toEqual([]);
  });
  it("읽기 전용과 수정 권한 없는 계정은 아무것도 쓰지 않는다", async () => {
    mocks.readonly.mockResolvedValueOnce("읽기 전용입니다.");
    expect((await setVideoHomeworkMark(onescreen)).ok).toBe(false);
    mocks.access.mockResolvedValue("read"); mocks.canWrite.mockResolvedValue(false);
    expect((await setVideoHomeworkMark(onescreen)).ok).toBe(false);
    expect(mocks.calls).toEqual([]);
  });
  it("원스크린 검사는 감사로그를 따로 남기지 않는다(예전 동작 그대로)", async () => {
    await setVideoHomeworkMark(onescreen);
    expect(mocks.log).not.toHaveBeenCalled();
  });
});

const round = { classId: "class-a", studentId: "student-a", roundKey: "h:2026-09-29", status: "submitted" as const, submittedDate: "2026-09-30" };

describe("영상 제출 현황 회차(setVideoHomeworkRound)", () => {
  it("다른 강사 편집은 화면에 보이는 강사가 낸 숙제만 저장하며 편집자는 로그인 계정이다", async () => {
    mocks.access.mockResolvedValue("scoped"); mocks.canWrite.mockResolvedValue(true);
    mocks.teacher.mockResolvedValue("teacher-b");
    const base = mocks.respond;
    mocks.respond = call => call.table === "lesson_reports" && call.filters.some(f => f[1] === "created_by")
      ? { data: has(call, "eq", "created_by", "teacher-b") ? [{ id: "r1" }] : [], error: null } : base(call);
    expect(await setVideoHomeworkRound(round)).toEqual({ ok: true });
    expect(writes()[0].payload).toMatchObject({ updated_by: "staff-a" });
    mocks.calls = [];
    world({ own: false });
    expect(await setVideoHomeworkRound(round)).toMatchObject({ ok: false });
    expect(writes()).toEqual([]);
    mocks.readonly.mockResolvedValue("읽기 전용입니다.");
    world();
    expect(await setVideoHomeworkRound(round)).toEqual({ ok: false, error: "읽기 전용입니다." });
    expect(writes()).toEqual([]);
  });
  it("새 기록의 자리는 서버가 정한다(숙제일 다음 날) · 그날 보고서의 영상 과제를 확인하고 감사로그를 남긴다", async () => {
    expect(await setVideoHomeworkRound(round)).toEqual({ ok: true });
    expect(mocks.calls.some((c) => c.table === "lesson_reports" && has(c, "eq", "report_date", "2026-09-29") && has(c, "eq", "video_homework", true))).toBe(true);
    expect(writes()[0]).toMatchObject({ op: "upsert", payload: { check_date: "2026-09-30", homework_date: "2026-09-29", submitted_date: "2026-09-30", updated_by: "staff-a" } });
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ action: "lesson_report_video_homework_mark", targetType: "video_homework",
      targetLabel: "김민준 · 수학 A", metadata: expect.objectContaining({ homeworkDate: "2026-09-29", status: "submitted", submittedDate: "2026-09-30" }) }));
  });
  it("장부의 되돌리기는 숙제일 다음 날 자리에서 같은 숙제·숙제일 없는 줄만 지운다(그 자리의 다른 숙제 기록은 그대로)", async () => {
    world({ sameHomework: [{ id: "m9" }] });
    expect((await setVideoHomeworkRound({ ...round, status: null, submittedDate: null })).ok).toBe(true);
    const slot = mocks.calls.find((c) => c.table === "video_homework_marks" && has(c, "eq", "check_date", "2026-09-30"))!;
    expect(has(slot, "or", "homework_date.is.null,homework_date.eq.2026-09-29")).toBe(true);
    expect(writes().map((c) => c.op)).toEqual(["delete"]);
  });
  it("이미 찍힌 같은 숙제는 그 줄을 고친다(원스크린이 찍은 기록도)", async () => {
    world({ sameHomework: [{ id: "m9" }] });
    expect((await setVideoHomeworkRound({ ...round, status: "missing", submittedDate: null })).ok).toBe(true);
    expect(writes().map((c) => c.op)).toEqual(["update"]);
    expect(writes()[0].payload).toMatchObject({ status: "missing", submitted_date: null });
  });
  it("보고서에도 기록에도 없는 숙제는 거절하고 아무것도 쓰지 않는다", async () => {
    world({ assigned: false });
    expect(await setVideoHomeworkRound(round)).toEqual({ ok: false, error: "그날 이 학생에게 나간 영상 과제를 찾을 수 없습니다." });
    expect(writes()).toEqual([]);
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it.each([
    [{ submittedDate: "2026-09-28" }, "제출일은 숙제가 나간 날보다 빠를 수 없습니다."],
    [{ roundKey: "h:2026-10-01" }, "아직 나가지 않은 숙제는 기록할 수 없습니다."],
    [{ roundKey: "x:2026-09-01" }, "회차를 확인할 수 없습니다."],
    [{ submittedDate: "2026-10-02" }, "제출일은 오늘까지의 올바른 날짜로 입력해 주세요."],
  ])("%o → 거절", async (patch, error) => {
    expect(await setVideoHomeworkRound({ ...round, ...patch })).toEqual({ ok: false, error });
    expect(writes()).toEqual([]);
  });
  it("🔴 강사(수업보고서 전체 권한 아님)는 자기가 낸 숙제 칸만 찍는다 — 남이 낸 숙제·숙제일 없는 옛 기록은 거절(원장 2026-10-03 \"스스로 낸 숙제만 체크\")", async () => {
    // 담당 반 검사(지금 담임)는 장부에서 묻지 않는다 — 담임이 바뀐 반의 내 숙제도 내가 찍는다.
    mocks.user.mockResolvedValue({ id: "teacher-a", tenantId: "tenant-a", systemRole: "teacher" });
    mocks.access.mockResolvedValue("scoped");
    mocks.canWrite.mockResolvedValue(true);
    world();
    expect(await setVideoHomeworkRound(round)).toEqual({ ok: true });
    const ownCheck = mocks.calls.find((c) => c.table === "lesson_reports" && has(c, "eq", "created_by", "teacher-a"))!;
    expect(has(ownCheck, "eq", "report_date", "2026-09-29") && has(ownCheck, "eq", "video_homework", true) && has(ownCheck, "eq", "tenant_id", "tenant-a")).toBe(true);
    mocks.calls = [];
    world({ own: false });
    expect(await setVideoHomeworkRound(round)).toEqual({ ok: false, error: "내가 낸 숙제만 기록할 수 있습니다." });
    expect(writes()).toEqual([]);
    world();
    expect(await setVideoHomeworkRound({ ...round, roundKey: "c:2026-09-05" })).toEqual({ ok: false, error: "숙제일이 없는 옛 기록이라 여기서는 고칠 수 없습니다. 사무실에 알려 주세요." });
    expect(writes()).toEqual([]);
    // 강사 쓰기 권한이 없으면(상담사 등) 낸 사람을 묻기 전에 거절
    mocks.canWrite.mockResolvedValue(false);
    expect(await setVideoHomeworkRound(round)).toEqual({ ok: false, error: "수정 권한이 없습니다." });
    mocks.canWrite.mockResolvedValue(true);
    // 관리자(전체 권한)는 그대로 — 낸 사람을 묻지도 않는다
    mocks.user.mockResolvedValue({ id: "staff-a", tenantId: "tenant-a", systemRole: "master" });
    mocks.access.mockResolvedValue("full");
    mocks.calls = [];
    world({ own: false });
    expect(await setVideoHomeworkRound(round)).toEqual({ ok: true });
    expect(mocks.calls.some((c) => has(c, "eq", "created_by", "staff-a"))).toBe(false);
  });
  it("숙제일 없는 옛 기록(c:검사일)은 그 검사일 자리 그대로 · 미확인으로 되돌리면 지운다", async () => {
    mocks.respond = (call) => call.table === "video_homework_marks" && call.op === "select" ? { data: [{ id: "old" }], error: null }
      : call.table === "classes" ? { data: { subject: "math", class_name: "수학 A" }, error: null }
      : call.table === "students" ? { data: { grade: "중1", name: "김민준" }, error: null } : { data: null, error: null };
    expect((await setVideoHomeworkRound({ ...round, roundKey: "c:2026-09-05", status: null, submittedDate: null })).ok).toBe(true);
    expect(mocks.calls.some((c) => c.table === "video_homework_marks" && has(c, "is", "homework_date", null))).toBe(true);
    expect(writes().map((c) => c.op)).toEqual(["delete"]);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ checkDate: "2026-09-05", status: "cleared" }) }));
  });
});

const CLASS = "11111111-1111-4111-8111-111111111111";
const ST = (n: number) => `2222222${n}-2222-4222-8222-222222222222`;
const bulk = { checkDate: "2026-09-03", status: "submitted" as const,
  cells: [{ classId: CLASS, studentId: ST(1), homeworkDate: "2026-09-01" }, { classId: CLASS, studentId: ST(2), homeworkDate: null }] };

describe("원스크린 일괄 검사(setVideoHomeworkMarksBulk) — 한 왕복, 칸마다 같은 확인", () => {
  it("통과한 칸만 적고 그 목록을 돌려준다 · 감사로그는 한 번(건수)", async () => {
    const result = await setVideoHomeworkMarksBulk(bulk);
    expect(result).toEqual({ ok: true, applied: [{ classId: CLASS, studentId: ST(1) }, { classId: CLASS, studentId: ST(2) }], failed: 0 });
    expect(writes().map((c) => c.op)).toEqual(["upsert", "upsert"]);
    expect(writes().map((c) => (c.payload as { check_date: string }).check_date)).toEqual(["2026-09-03", "2026-09-03"]);
    expect(mocks.log).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ action: "lesson_report_video_homework_mark",
      metadata: expect.objectContaining({ bulk: true, count: 2, status: "submitted", checkDate: "2026-09-03" }) }));
  });
  it("같은 (반 × 학생)은 한 번만 · 모양이 틀린 칸·검사일보다 늦은 숙제일은 쓰지 않고 실패로 센다", async () => {
    const result = await setVideoHomeworkMarksBulk({ ...bulk, cells: [
      bulk.cells[0]!, bulk.cells[0]!,
      { classId: "class-a", studentId: ST(3), homeworkDate: null },
      { classId: CLASS, studentId: ST(4), homeworkDate: "2026-09-09" },
    ] });
    expect(result.applied).toEqual([{ classId: CLASS, studentId: ST(1) }]);
    expect(result.failed).toBe(2);
    expect(writes()).toHaveLength(1);
  });
  it("그날 명단에 없는 학생의 칸은 빠지고 나머지는 적힌다", async () => {
    const base = mocks.respond;
    mocks.respond = (call) => call.table === "enrollments" && has(call, "eq", "student_id", ST(2)) ? { data: [], error: null } : base(call);
    const result = await setVideoHomeworkMarksBulk(bulk);
    expect(result.applied).toEqual([{ classId: CLASS, studentId: ST(1) }]);
    expect(result.failed).toBe(1);
  });
  it("읽기 전용·권한 없음·미래 수업·이상한 상태·칸 수 초과는 아무것도 쓰지 않는다", async () => {
    mocks.readonly.mockResolvedValueOnce("읽기 전용입니다.");
    expect((await setVideoHomeworkMarksBulk(bulk)).ok).toBe(false);
    expect((await setVideoHomeworkMarksBulk({ ...bulk, checkDate: "2026-10-01" })).ok).toBe(false);
    expect((await setVideoHomeworkMarksBulk({ ...bulk, status: "cleared" as never })).ok).toBe(false);
    expect((await setVideoHomeworkMarksBulk({ ...bulk, cells: Array.from({ length: 301 }, () => bulk.cells[0]!) })).ok).toBe(false);
    mocks.access.mockResolvedValue("read"); mocks.canWrite.mockResolvedValue(false);
    const denied = await setVideoHomeworkMarksBulk(bulk);
    expect(denied).toEqual({ ok: true, applied: [], failed: 2 });
    expect(writes()).toEqual([]);
    expect(mocks.log).not.toHaveBeenCalled();
  });
});
