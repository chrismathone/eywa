// 수학 개별 공지의 반 보드 경로 — 조회 결과를 삼자 일치 판정에 맞게 엮는가(조회는 가짜로 갈아 끼운다).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ paged: [] as unknown[][], chunks: [] as unknown[][], workers: [] as unknown[], workerError: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-10-02" }));
// 조회 헬퍼는 부른 순서대로 준비해 둔 결과를 돌려준다(콜백은 부르지 않는다 — 쿼리 모양은 타입체크가 본다).
vi.mock("@/lib/supabase/batch", () => ({
  fetchAllPagedInChunks: async () => m.paged.shift() ?? [],
  fetchInChunks: async () => m.chunks.shift() ?? [],
}));

const { noticeClassRouteWorkerReady, resolveNoticeClasses, routeNoticeCandidates } = await import("./notice-class-route");

const supabase = {
  from: () => ({ select: async () => (m.workerError ? { data: null, error: { message: "x" } } : { data: m.workers, error: null }) }),
} as never;
const liveWorker = (caps: Record<string, unknown>, postMode = true) => ({ last_seen: new Date().toISOString(), last_results: { caps, postMode } });

const enr = (student: string, cls: string, over: Record<string, unknown> = {}) => ({
  id: `${student}-${cls}`, class_id: cls, student_id: student, start_date: "2026-03-01", end_date: null, is_transferred: false, on_hold: false, ...over,
});
const klass = (id: string, over: Record<string, unknown> = {}) => ({
  id, class_name: id, subject: "math", is_active: true, report_optout: false, closed_at: null, teacher_id: null, ...over,
});
const board = (cls: string, name = `${cls} 보드`) => ({ class_id: cls, board_name: name });
const member = (student: string, cls: string, status = "ok") => ({ id: 1, class_id: cls, student_id: student, status });

/** 조회 순서: 수강(paged) → [반(chunks) · 연결(chunks) · 멤버(paged) · 교시(paged, 선생님 있을 때) · 위임(chunks, 선생님 있을 때)] */
function seed(a: { enrollments: unknown[]; classes: unknown[]; boards: unknown[]; members: unknown[]; slots?: unknown[]; delegations?: unknown[]; teachers?: boolean }) {
  m.paged = [a.enrollments, a.members, ...(a.teachers ? [a.slots ?? []] : [])];
  m.chunks = [a.classes, a.boards, ...(a.teachers ? [a.delegations ?? []] : [])];
}

beforeEach(() => {
  m.paged = [];
  m.chunks = [];
  m.workers = [liveWorker({ noticeClassRoute: true })];
  m.workerError = false;
});

describe("삼자 일치 — 보내는 선생님 · 반 · 학생", () => {
  it("담임인 반 보드로 — 학생이 다니고 · 반 보드가 연결돼 있고 · 원아 매칭이 ok", async () => {
    seed({ teachers: true, enrollments: [enr("s1", "A")], classes: [klass("A", { teacher_id: "t1" })], boards: [board("A")], members: [member("s1", "A")] });
    const r = await resolveNoticeClasses("tn", [{ studentId: "s1", teacherIds: ["t1"], teacherStrict: true }]);
    expect(r.get("s1")).toMatchObject({ ok: true, classId: "A", boardName: "A 보드", via: "teacher" });
  });
  it("교시 담당·오늘 위임도 선생님 다리다 — 지난 위임은 아니다", async () => {
    seed({
      teachers: true,
      enrollments: [enr("s1", "A"), enr("s2", "B"), enr("s3", "C")],
      classes: [klass("A"), klass("B"), klass("C")],
      boards: [board("A"), board("B"), board("C")],
      members: [member("s1", "A"), member("s2", "B"), member("s3", "C")],
      slots: [{ id: "x", class_id: "A", teacher_id: "t1" }],
      delegations: [
        { class_id: "B", delegate_user_id: "t1", from_date: "2026-10-02", to_date: "2026-10-02", revoked_at: null },
        { class_id: "C", delegate_user_id: "t1", from_date: "2026-09-01", to_date: "2026-09-30", revoked_at: null },
      ],
    });
    const r = await resolveNoticeClasses("tn", ["s1", "s2", "s3"].map((studentId) => ({ studentId, teacherIds: ["t1"], teacherStrict: true })));
    expect(r.get("s1")).toMatchObject({ ok: true, classId: "A" });
    expect(r.get("s2")).toMatchObject({ ok: true, classId: "B" });
    expect(r.get("s3")).toEqual({ ok: false, reason: "not_my_class" });
  });
  it("🔴 학생 다리 — 끝난 수강·반이동 당일의 옛 반·휴원·아직 시작 전인 반은 후보가 아니다", async () => {
    seed({
      enrollments: [
        enr("s1", "끝남", { end_date: "2026-10-01" }),
        enr("s1", "반이동", { end_date: "2026-10-02", is_transferred: true }),
        enr("s1", "휴원", { on_hold: true }),
        enr("s1", "시작전", { start_date: "2026-10-05" }),
      ],
      classes: ["끝남", "반이동", "휴원", "시작전"].map((id) => klass(id)),
      boards: ["끝남", "반이동", "휴원", "시작전"].map((id) => board(id)),
      members: ["끝남", "반이동", "휴원", "시작전"].map((id) => member("s1", id)),
    });
    expect((await resolveNoticeClasses("tn", [{ studentId: "s1" }])).get("s1")).toEqual({ ok: false, reason: "no_class_board" });
  });
  it("🔴 반 보드 다리 — 연결이 없거나 · 원아 매칭이 보류이거나 · 수학이 아니거나 · 종강·미발송 반이면 후보가 아니다", async () => {
    seed({
      enrollments: ["연결없음", "보류", "영어", "종강", "미발송"].map((id) => enr("s1", id)),
      classes: [klass("연결없음"), klass("보류"), klass("영어", { subject: "english" }), klass("종강", { closed_at: "2026-09-30" }), klass("미발송", { report_optout: true })],
      boards: ["보류", "영어", "종강", "미발송"].map((id) => board(id)),
      members: [member("s1", "연결없음"), member("s1", "보류", "hold"), member("s1", "영어"), member("s1", "종강"), member("s1", "미발송")],
    });
    expect((await resolveNoticeClasses("tn", [{ studentId: "s1" }])).get("s1")).toEqual({ ok: false, reason: "no_class_board" });
  });
  it("사무실 발송 = 화면이 고른 반(그 반 명단에서 뽑은 학생)", async () => {
    seed({ enrollments: [enr("s1", "A"), enr("s1", "B")], classes: [klass("A"), klass("B")], boards: [board("A"), board("B")], members: [member("s1", "A"), member("s1", "B")] });
    expect((await resolveNoticeClasses("tn", [{ studentId: "s1", hints: ["B"] }])).get("s1")).toMatchObject({ ok: true, classId: "B", via: "selected" });
  });
});

describe("연동 PC가 처리할 수 있을 때만 반 보드 경로", () => {
  it("켜져 있는 워커가 있고 전부 지원해야 한다 — 하나라도 옛 워커면·켜진 워커가 없으면·조회 실패면 아니다", async () => {
    expect(await noticeClassRouteWorkerReady(supabase)).toBe(true);
    m.workers = [liveWorker({ noticeClassRoute: true }), liveWorker({ noticeAttachments: true })];
    expect(await noticeClassRouteWorkerReady(supabase)).toBe(false);
    m.workers = [];
    expect(await noticeClassRouteWorkerReady(supabase)).toBe(false);
    m.workerError = true;
    expect(await noticeClassRouteWorkerReady(supabase)).toBe(false);
  });
});

describe("연동 PC가 꺼져 있는 시각", () => {
  it("🔴 가장 최근에 돌던 워커로 판정한다 — 꺼진 시각에 보낸 수학 공지만 1인 보드로 갈리지 않게", async () => {
    const old = (at: string, caps: Record<string, unknown>) => ({ last_seen: at, last_results: { caps, postMode: true } });
    m.workers = [old("2026-01-01T00:00:00Z", {}), old("2026-09-30T00:00:00Z", { noticeClassRoute: true })];
    expect(await noticeClassRouteWorkerReady(supabase)).toBe(true);
    m.workers = [old("2026-09-30T00:00:00Z", {}), old("2026-01-01T00:00:00Z", { noticeClassRoute: true })];
    expect(await noticeClassRouteWorkerReady(supabase)).toBe(false);
    // 시각을 못 읽는 행뿐이면 아니다
    m.workers = [{ last_seen: null, last_results: { caps: { noticeClassRoute: true }, postMode: true } }];
    expect(await noticeClassRouteWorkerReady(supabase)).toBe(false);
  });
  it("🔴 실제로 게시하는 워커(postMode)만 본다 — 시험·dry-run PC가 새 판이어도 발송 PC가 옛 판이면 아니다", async () => {
    m.workers = [liveWorker({ noticeClassRoute: true }, false), liveWorker({}, true)];
    expect(await noticeClassRouteWorkerReady(supabase)).toBe(false);
    m.workers = [liveWorker({ noticeClassRoute: true }, false)];
    expect(await noticeClassRouteWorkerReady(supabase)).toBe(false);
    m.workers = [liveWorker({}, false), liveWorker({ noticeClassRoute: true }, true)];
    expect(await noticeClassRouteWorkerReady(supabase)).toBe(true);
  });
});

describe("후보를 반 보드 경로(수학)와 기존 경로로 가른다", () => {
  const settings = { modules: { disabled: [] }, report: { classnoteSubjects: ["math", "english"] } };
  const cand = (studentId: string, subject: string | null, over: Record<string, unknown> = {}) => ({ studentId, name: studentId, classnoteName: null, subject, ...over });
  const one = () => seed({ enrollments: [enr("수학생", "A")], classes: [klass("A")], boards: [board("A", "A반")], members: [member("수학생", "A")] });

  it("수학은 반 보드 대상(classId · 표시 키), 영어는 기존 경로로 넘긴다", async () => {
    one();
    const r = await routeNoticeCandidates({ supabase, tenantId: "tn", settings, candidates: [cand("수학생", "math", { hints: ["A"] }), cand("영어생", "english")] });
    expect(r.classTargets).toEqual([{ studentId: "수학생", studentName: "수학생", board: "A반 · 수학생", classId: "A", className: "A" }]);
    expect(r.rest).toEqual([{ studentId: "영어생", name: "영어생", classnoteName: null, subject: "english" }]);
    expect(r.skipped).toEqual([]);
  });
  it("🔴 받을 반 보드가 없는 수학 학생은 제외한다 — 기존 1인 보드 경로(rest)로 넘기지 않는다", async () => {
    seed({ enrollments: [], classes: [], boards: [], members: [] });
    const r = await routeNoticeCandidates({ supabase, tenantId: "tn", settings, candidates: [cand("수학생", "math")] });
    expect(r.classTargets).toEqual([]);
    expect(r.rest).toEqual([]);
    expect(r.skipped).toEqual([{ name: "수학생", reason: "no_class_board" }]);
  });
  it("표시 키가 겹치는 두 학생(같은 반 보드 · 같은 표시 이름)은 둘 다 뺀다 — 결과를 서로 구분할 수 없다", async () => {
    seed({
      enrollments: [enr("s1", "A"), enr("s2", "A")], classes: [klass("A")], boards: [board("A", "A반")],
      members: [member("s1", "A"), member("s2", "A")],
    });
    const twins = [{ ...cand("s1", "math"), name: "김민준" }, { ...cand("s2", "math"), name: "김민준" }];
    const r = await routeNoticeCandidates({ supabase, tenantId: "tn", settings, candidates: twins });
    expect(r.classTargets).toEqual([]);
    expect(r.skipped).toEqual([{ name: "김민준", reason: "name_collision" }, { name: "김민준", reason: "name_collision" }]);
  });
  it("강사 본인 발송 — 맡은 반의 보드가 보류면 '반 보드 없음', 맡은 반이 아니면 '담당 반 아님'", async () => {
    seed({
      teachers: true,
      enrollments: [enr("s1", "내반"), enr("s1", "남의반"), enr("s2", "남의반")],
      classes: [klass("내반", { teacher_id: "t1" }), klass("남의반")],
      boards: [board("내반"), board("남의반")],
      members: [member("s1", "내반", "hold"), member("s1", "남의반"), member("s2", "남의반")],
    });
    const r = await resolveNoticeClasses("tn", ["s1", "s2"].map((studentId) => ({ studentId, teacherIds: ["t1"], teacherStrict: true })));
    expect(r.get("s1")).toEqual({ ok: false, reason: "no_class_board" });
    expect(r.get("s2")).toEqual({ ok: false, reason: "not_my_class" });
  });
  it("같은 학생이 여러 반에서 뽑혀도 한 번만 보낸다", async () => {
    one();
    const r = await routeNoticeCandidates({ supabase, tenantId: "tn", settings, candidates: [cand("수학생", "math", { hints: ["A"] }), cand("수학생", "math", { hints: ["B"] })] });
    expect(r.classTargets).toHaveLength(1);
  });
  it("ClassNote 모듈이 꺼져 있거나 연동 PC가 아직 못 하면 전원 기존 경로 — 지금까지와 똑같이", async () => {
    const all = [cand("수학생", "math"), cand("영어생", "english")];
    const plain = all.map(({ studentId, name, classnoteName, subject }) => ({ studentId, name, classnoteName, subject }));
    const moduleOff = { ...settings, modules: { disabled: ["classnote"] } };
    expect(await routeNoticeCandidates({ supabase, tenantId: "tn", settings: moduleOff, candidates: all })).toEqual({ classTargets: [], rest: plain, skipped: [] });
    m.workers = [liveWorker({})];
    expect((await routeNoticeCandidates({ supabase, tenantId: "tn", settings, candidates: all })).rest).toEqual(plain);
  });
  it("학원설정에서 수학을 발송 과목에서 뺐으면 반 보드 경로도 타지 않는다(기존 경로가 '발송 과목 아님'으로 제외한다)", async () => {
    const noMath = { ...settings, report: { ...settings.report, classnoteSubjects: ["english"] } };
    const r = await routeNoticeCandidates({ supabase, tenantId: "tn", settings: noMath, candidates: [cand("수학생", "math")] });
    expect(r.classTargets).toEqual([]);
    expect(r.rest).toHaveLength(1);
  });
});
