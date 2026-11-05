// 영어 개별 공지·교재요청서의 반 방 경로(원장 2026-11-04) — 조회부터 대상 갈래까지. 조회 헬퍼는 진짜, DB만 가짜 표로 갈아 끼운다.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  const state = { tables: {} as Record<string, Row[]>, errors: {} as Record<string, { code: string; message: string }>, reads: [] as string[] };
  // PostgREST 조건을 흉내 낸다 — eq·in·lte·gte·is(null)·or(`칸.is.null,칸.gte.값`). 순서는 표에 넣은 순서 그대로, range는 페이지로 자른다.
  // (조건을 빠뜨리면 지난 교시·취소된 위임이 섞여 시험이 실패하도록 — 리뷰 2026-11-04: 예전 가짜는 기간 조건을 무시했다)
  type Pred = (r: Row) => boolean;
  const orPred = (expr: string): Pred => {
    const parts = expr.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      const v = rest.join(".");
      if (op === "is" && v === "null") return (r: Row) => r[col!] == null;
      if (op === "gte") return (r: Row) => r[col!] != null && String(r[col!]) >= v;
      throw new Error(`가짜 DB가 모르는 or 조건: ${p}`);
    });
    return (r) => parts.some((p) => p(r));
  };
  const from = (table: string) => {
    const preds: Pred[] = [];
    let range: [number, number] | null = null;
    const q = {
      select: () => q, order: () => q,
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      in: (c: string, v: readonly unknown[]) => (preds.push((r) => v.includes(r[c])), q),
      lte: (c: string, v: string) => (preds.push((r) => r[c] != null && String(r[c]) <= v), q),
      gte: (c: string, v: string) => (preds.push((r) => r[c] != null && String(r[c]) >= v), q),
      is: (c: string, v: null) => (preds.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
      or: (expr: string) => (preds.push(orPred(expr)), q),
      range: (f: number, t: number) => ((range = [f, t]), q),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        state.reads.push(table);
        const error = state.errors[table];
        if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
        let rows = (state.tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        // PostgREST max-rows ≈ 1000 — 페이지(range) 없이 읽으면 그 뒤는 말없이 잘린다([[#54]]). 조건으로 좁히지 않은 조회를 잡는다.
        rows = range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return { state, client: { from } };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-11-04" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client }));

const { resolveEnglishNoticeClasses } = await import("./notice-english-route");
const { routeNoticeCandidates } = await import("./notice-class-route");

const T = "tn";
const supabase = db.client as never;
const settings = { modules: { disabled: [] as string[] }, report: { classnoteMathRoute: "class", classnoteSubjects: ["math", "english"] } };
const worker = (caps: Record<string, unknown>) => ({ last_seen: new Date().toISOString(), last_results: { caps, postMode: true } });
const enr = (student: string, cls: string, over: Row = {}): Row => ({
  id: `${student}-${cls}`, tenant_id: T, class_id: cls, student_id: student, start_date: "2026-03-01", end_date: null, is_transferred: false, on_hold: false, ...over,
});
const klass = (id: string, over: Row = {}): Row => ({
  id, tenant_id: T, class_name: `반 ${id}`, subject: "english", is_active: true, report_optout: false, closed_at: null, teacher_id: null, ...over,
});
const room = (cls: string, name: string): Row => ({ tenant_id: T, class_id: cls, board_name: name });
const slot = (cls: string, teacher: string, over: Row = {}): Row => ({
  id: `${cls}-${teacher}`, tenant_id: T, class_id: cls, teacher_id: teacher, valid_from: "2026-03-01", valid_to: null, ...over,
});
const delegation = (cls: string, teacher: string, fromDate: string, toDate: string, over: Row = {}): Row => ({
  tenant_id: T, class_id: cls, delegate_user_id: teacher, from_date: fromDate, to_date: toDate, revoked_at: null, ...over,
});
const cand = (studentId: string, subject: string, over: Row = {}) => ({ studentId, name: `학생${studentId}`, classnoteName: null, subject, ...over });
const strict = (teacher: string, hints: string[] = []) => ({ teacherIds: [teacher], teacherStrict: true, hints });

beforeEach(() => {
  db.state.tables = { classnote_workers: [worker({ noticeClassRoute: true, noticeEnglishRoom: true })] };
  db.state.errors = {};
  db.state.reads = [];
});

describe("routeNoticeCandidates — 영어", () => {
  it("담당 영어 반에 반 방이 있으면 반 방 대상(반 · 표시 키 = 반 방 이름 · 워커 분기 표식 subject)", async () => {
    Object.assign(db.state.tables, {
      enrollments: [enr("s1", "E1")],
      classes: [klass("E1", { teacher_id: "t1" })],
      classnote_english_class_boards: [room("E1", "Jennifer E1 (월수)")],
    });
    const r = await routeNoticeCandidates({ supabase, tenantId: T, settings, senderName: null, candidates: [cand("s1", "english", strict("t1", ["E1"]))] });
    expect(r).toEqual({
      classTargets: [{ studentId: "s1", studentName: "학생s1", board: "Jennifer E1 (월수) · 학생s1", classId: "E1", className: "반 E1", subject: "english" }],
      rest: [],
      skipped: [],
    });
  });
  it("반 방이 없는 영어 반이면 지금처럼 1인 보드(rest — 동명이인 가드를 탄다)", async () => {
    Object.assign(db.state.tables, { enrollments: [enr("s1", "E1")], classes: [klass("E1", { teacher_id: "t1" })] });
    const r = await routeNoticeCandidates({ supabase, tenantId: T, settings, senderName: null, candidates: [cand("s1", "english", strict("t1"))] });
    expect(r).toEqual({ classTargets: [], rest: [{ studentId: "s1", name: "학생s1", classnoteName: null, subject: "english" }], skipped: [] });
  });
  it("🔴 연동 PC가 영어 반 방을 모르면(옛 워커 · 하나라도) 반을 싣지 않는다 — 전부 지금처럼 1인 보드", async () => {
    Object.assign(db.state.tables, {
      enrollments: [enr("s1", "E1")], classes: [klass("E1", { teacher_id: "t1" })], classnote_english_class_boards: [room("E1", "E1 방")],
    });
    for (const workers of [[worker({ noticeClassRoute: true })], [worker({ noticeEnglishRoom: true }), worker({})], []]) {
      db.state.tables.classnote_workers = workers;
      const r = await routeNoticeCandidates({ supabase, tenantId: T, settings, senderName: null, candidates: [cand("s1", "english", strict("t1"))] });
      expect(r.classTargets).toEqual([]);
      expect(r.rest).toHaveLength(1);
    }
  });
  it("ClassNote 모듈이 꺼져 있거나 학원 설정에서 영어를 발송 과목에서 뺐으면 경로 판정을 하지 않는다", async () => {
    Object.assign(db.state.tables, { enrollments: [enr("s1", "E1")], classes: [klass("E1", { teacher_id: "t1" })], classnote_english_class_boards: [room("E1", "E1 방")] });
    const off = { ...settings, modules: { disabled: ["classnote"] } };
    expect((await routeNoticeCandidates({ supabase, tenantId: T, settings: off, senderName: null, candidates: [cand("s1", "english", strict("t1"))] })).classTargets).toEqual([]);
    const noEnglish = { ...settings, report: { ...settings.report, classnoteSubjects: ["math"] } };
    const r = await routeNoticeCandidates({ supabase, tenantId: T, settings: noEnglish, senderName: null, candidates: [cand("s1", "english", strict("t1"))] });
    expect(r.classTargets).toEqual([]);
    expect(r.rest).toHaveLength(1); // 기존 경로가 '발송 과목 아님'으로 제외한다
    expect(db.state.reads).not.toContain("enrollments");
  });
  it("🔴 강사 본인 발송 — 그 영어 반을 맡지 않았으면 반 방으로 보내지 않는다 · 교시 담당·오늘 위임은 맡은 것이다", async () => {
    Object.assign(db.state.tables, {
      enrollments: [enr("s1", "E1"), enr("s2", "E2"), enr("s3", "E3")],
      classes: [klass("E1", { teacher_id: "한국인" }), klass("E2"), klass("E3")],
      classnote_english_class_boards: [room("E1", "E1 방"), room("E2", "E2 방"), room("E3", "E3 방")],
      class_schedules: [slot("E2", "원어민")],
      class_delegations: [delegation("E3", "원어민", "2026-11-04", "2026-11-04")],
    });
    const r = await routeNoticeCandidates({
      supabase, tenantId: T, settings, senderName: null,
      candidates: ["s1", "s2", "s3"].map((s) => cand(s, "english", strict("원어민"))),
    });
    expect(r.classTargets.map((t) => t.classId)).toEqual(["E2", "E3"]);
    expect(r.rest.map((c) => c.studentId)).toEqual(["s1"]);
  });
  it("🔴 선생님 다리 — 끝난·아직 시작 전 교시 · 취소된·오늘 밖의 위임은 맡은 것이 아니다(반 방으로 보내지 않는다)", async () => {
    Object.assign(db.state.tables, {
      enrollments: ["E1", "E2", "E3", "E4"].map((c, i) => enr(`s${i + 1}`, c)),
      classes: ["E1", "E2", "E3", "E4"].map((c) => klass(c)),
      classnote_english_class_boards: ["E1", "E2", "E3", "E4"].map((c) => room(c, `${c} 방`)),
      class_schedules: [slot("E1", "원어민", { valid_to: "2026-11-03" }), slot("E2", "원어민", { valid_from: "2026-11-05" })],
      class_delegations: [
        delegation("E3", "원어민", "2026-11-04", "2026-11-04", { revoked_at: "2026-11-04T01:00:00Z" }),
        delegation("E4", "원어민", "2026-10-01", "2026-11-03"),
      ],
    });
    const r = await routeNoticeCandidates({
      supabase, tenantId: T, settings, senderName: null,
      candidates: ["s1", "s2", "s3", "s4"].map((s) => cand(s, "english", strict("원어민"))),
    });
    expect(r.classTargets).toEqual([]);
    expect(r.rest).toHaveLength(4);
  });
  it("🔴 보고서 미발송 반은 반 방으로 보내지 않는다 — 그 반으로 정해지면 1인 보드(고른 반·맡은 반이면 다른 반 반 방으로 옮기지 않는다)", async () => {
    Object.assign(db.state.tables, {
      enrollments: [enr("s1", "미발송"), enr("s2", "미발송"), enr("s2", "정규")],
      classes: [klass("미발송", { report_optout: true, teacher_id: "미발송담임" }), klass("정규", { teacher_id: "정규담임" })],
      classnote_english_class_boards: [room("미발송", "미발송 방"), room("정규", "정규 방")],
    });
    const picks = await resolveEnglishNoticeClasses(T, [{ studentId: "s1" }, { studentId: "s2" }]);
    expect(picks.get("s1")).toEqual({ route: "personal" });
    // 고른 반이 없으면 반 방을 쓸 수 있는 반(정규)
    expect(picks.get("s2")).toMatchObject({ route: "room", classId: "정규" });
    // 사무실이 미발송 반을 골라 보냈거나(반 공지 탭은 미발송 반도 보인다) 그 반 담임이 보냈으면 그 반의 일 — 1인 보드
    expect((await resolveEnglishNoticeClasses(T, [{ studentId: "s2", hints: ["미발송"] }])).get("s2")).toEqual({ route: "personal" });
    const homeroom = await resolveEnglishNoticeClasses(T, [{ studentId: "s2", teacherIds: ["미발송담임"], teacherStrict: true }]);
    expect(homeroom.get("s2")).toEqual({ route: "personal" });
    const owner = await resolveEnglishNoticeClasses(T, [{ studentId: "s2", teacherIds: ["미발송담임"], teacherStrict: false }]);
    expect(owner.get("s2")).toEqual({ route: "personal" });
  });
  it("🔴 [[#54]] 위임은 오늘 걸친 행만 읽는다 — 지난 위임이 1,000건 쌓여도 오늘 위임이 잘리지 않는다", async () => {
    const past = Array.from({ length: 1000 }, (_, i) => delegation("E1", "원어민", "2026-01-01", "2026-01-02", { id: `p${i}` }));
    Object.assign(db.state.tables, {
      enrollments: [enr("s1", "E1")],
      classes: [klass("E1")],
      classnote_english_class_boards: [room("E1", "E1 방")],
      class_delegations: [...past, delegation("E1", "원어민", "2026-11-04", "2026-11-04")],
    });
    const r = await resolveEnglishNoticeClasses(T, [{ studentId: "s1", teacherIds: ["원어민"], teacherStrict: true }]);
    expect(r.get("s1")).toMatchObject({ route: "room", classId: "E1", via: "teacher" });
  });
  it("🔴 화면이 고른 반이 여럿이면 고른 순서와 무관하게 반 방 있는 반 — 수강 행 순서에 따라 반 방·1인 보드가 갈리지 않는다", async () => {
    Object.assign(db.state.tables, {
      enrollments: [enr("s1", "A"), enr("s1", "B")],
      classes: [klass("A", { teacher_id: "t1" }), klass("B", { teacher_id: "t1" })],
      classnote_english_class_boards: [room("B", "B 방")],
    });
    for (const hints of [["A", "B"], ["B", "A"]]) {
      const office = await resolveEnglishNoticeClasses(T, [{ studentId: "s1", hints }]);
      expect(office.get("s1")).toMatchObject({ route: "room", classId: "B", via: "selected" });
      const teacher = await resolveEnglishNoticeClasses(T, [{ studentId: "s1", hints, teacherIds: ["t1"], teacherStrict: true }]);
      expect(teacher.get("s1")).toMatchObject({ route: "room", classId: "B", via: "teacher" });
    }
    // 고른 반이 반 방 없는 반 하나뿐이면 그 반의 일 — 1인 보드
    expect((await resolveEnglishNoticeClasses(T, [{ studentId: "s1", hints: ["A"] }])).get("s1")).toEqual({ route: "personal" });
  });
  it("학생 다리 — 휴원·끝난 수강·시작 전 수강·종강 반·폐지 반·영어가 아닌 반은 후보가 아니다(1인 보드)", async () => {
    Object.assign(db.state.tables, {
      enrollments: [
        enr("s1", "휴원", { on_hold: true }), enr("s1", "끝남", { end_date: "2026-11-03" }), enr("s1", "시작전", { start_date: "2026-11-10" }),
        enr("s1", "종강"), enr("s1", "폐지"), enr("s1", "수학"),
      ],
      classes: [klass("휴원"), klass("끝남"), klass("시작전"), klass("종강", { closed_at: "2026-11-01" }), klass("폐지", { is_active: false }), klass("수학", { subject: "math" })],
      classnote_english_class_boards: ["휴원", "끝남", "시작전", "종강", "폐지", "수학"].map((c) => room(c, `${c} 방`)),
    });
    const picks = await resolveEnglishNoticeClasses(T, [{ studentId: "s1" }]);
    expect(picks.get("s1")).toEqual({ route: "personal" });
  });
  it("오늘 종강하는 반은 아직 후보다(종강일 당일까지)", async () => {
    Object.assign(db.state.tables, { enrollments: [enr("s1", "E1")], classes: [klass("E1", { closed_at: "2026-11-04" })], classnote_english_class_boards: [room("E1", "E1 방")] });
    expect((await resolveEnglishNoticeClasses(T, [{ studentId: "s1" }])).get("s1")).toMatchObject({ route: "room", classId: "E1" });
  });
  it("[[#95]] 연결표가 아직 없으면(SQL 전) 반 방 0 = 지금처럼 1인 보드 · 그 밖의 조회 실패는 throw(호출부가 발송을 막는다)", async () => {
    Object.assign(db.state.tables, { enrollments: [enr("s1", "E1")], classes: [klass("E1")] });
    db.state.errors.classnote_english_class_boards = { code: "PGRST205", message: "Could not find the table" };
    expect((await resolveEnglishNoticeClasses(T, [{ studentId: "s1" }])).get("s1")).toEqual({ route: "personal" });
    db.state.errors.classnote_english_class_boards = { code: "42P01", message: "relation does not exist" };
    expect((await resolveEnglishNoticeClasses(T, [{ studentId: "s1" }])).get("s1")).toEqual({ route: "personal" });
    db.state.errors.classnote_english_class_boards = { code: "57014", message: "canceling statement due to statement timeout" };
    await expect(resolveEnglishNoticeClasses(T, [{ studentId: "s1" }])).rejects.toThrow();
    await expect(
      routeNoticeCandidates({ supabase, tenantId: T, settings, senderName: null, candidates: [cand("s1", "english", strict("t1"))] }),
    ).rejects.toThrow();
  });
  it("사무실 발송 = 고른 반 · 고른 반에 반 방이 없으면 그 반의 일이라 1인 보드(다른 반 방으로 옮기지 않는다)", async () => {
    Object.assign(db.state.tables, {
      enrollments: [enr("s1", "가"), enr("s1", "나")],
      classes: [klass("가"), klass("나")],
      classnote_english_class_boards: [room("나", "나 방")],
    });
    const office = (hints: string[]) => cand("s1", "english", { hints, teacherIds: null });
    expect((await routeNoticeCandidates({ supabase, tenantId: T, settings, senderName: null, candidates: [office(["가"])] })).rest).toHaveLength(1);
    expect((await routeNoticeCandidates({ supabase, tenantId: T, settings, senderName: null, candidates: [office(["나"])] })).classTargets).toMatchObject([{ classId: "나" }]);
  });
  it("같은 반 방 · 같은 표시 이름의 두 학생은 둘 다 뺀다(결과를 서로 구분할 수 없다) · 같은 학생이 두 번 뽑혀도 한 번", async () => {
    Object.assign(db.state.tables, {
      enrollments: [enr("s1", "E1"), enr("s2", "E1")],
      classes: [klass("E1", { teacher_id: "t1" })],
      classnote_english_class_boards: [room("E1", "E1 방")],
    });
    const twins = [{ ...cand("s1", "english", strict("t1")), name: "김민준" }, { ...cand("s2", "english", strict("t1")), name: "김민준" }];
    const r = await routeNoticeCandidates({ supabase, tenantId: T, settings, senderName: null, candidates: twins });
    expect(r.classTargets).toEqual([]);
    expect(r.skipped).toEqual([{ name: "김민준", reason: "name_collision" }, { name: "김민준", reason: "name_collision" }]);
    expect(r.rest).toEqual([]);
    const once = await routeNoticeCandidates({ supabase, tenantId: T, settings, senderName: null, candidates: [cand("s1", "english", strict("t1")), cand("s1", "english", strict("t1"))] });
    expect(once.classTargets).toHaveLength(1);
  });
});

describe("routeNoticeCandidates — 수학·영어가 섞인 발송", () => {
  it("각자 경로로 가고(수학 = 반 보드 · 영어 = 반 방 · 반 방 없는 영어 = 1인 보드), 발송 PC 하트비트는 한 번만 읽는다", async () => {
    Object.assign(db.state.tables, {
      enrollments: [enr("수", "M1"), enr("영", "E1"), enr("영2", "E2")],
      classes: [klass("M1", { subject: "math", teacher_id: "t1" }), klass("E1", { teacher_id: "t1" }), klass("E2", { teacher_id: "t1" })],
      classnote_class_boards: [{ tenant_id: T, class_id: "M1", board_name: "M1 보드" }],
      classnote_class_board_members: [{ id: 1, tenant_id: T, class_id: "M1", student_id: "수", status: "ok" }],
      classnote_english_class_boards: [room("E1", "E1 방")],
    });
    const r = await routeNoticeCandidates({
      supabase, tenantId: T, settings, senderName: null,
      candidates: [cand("수", "math", strict("t1")), cand("영", "english", strict("t1")), cand("영2", "english", strict("t1"))],
    });
    expect(r.classTargets).toEqual([
      { studentId: "영", studentName: "학생영", board: "E1 방 · 학생영", classId: "E1", className: "반 E1", subject: "english" },
      { studentId: "수", studentName: "학생수", board: "M1 보드 · 학생수", classId: "M1", className: "반 M1" },
    ]);
    expect(r.rest.map((c) => c.studentId)).toEqual(["영2"]);
    expect(db.state.reads.filter((t) => t === "classnote_workers")).toHaveLength(1);
  });
  it("🔴 수학 경로는 그대로 — 영어 반 방을 아는 워커여도 수학 반 보드가 없는 수학 학생은 제외(1인 보드로 되돌리지 않는다)", async () => {
    Object.assign(db.state.tables, { enrollments: [enr("수", "M1")], classes: [klass("M1", { subject: "math", teacher_id: "t1" })] });
    const r = await routeNoticeCandidates({ supabase, tenantId: T, settings, senderName: null, candidates: [cand("수", "math", strict("t1"))] });
    expect(r).toEqual({ classTargets: [], rest: [], skipped: [{ name: "학생수", reason: "no_class_board" }] });
  });
});
