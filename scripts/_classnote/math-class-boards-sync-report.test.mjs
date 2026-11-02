// 반 보드 동기화가 **보고서 재료를 남기는 방식**(0329a) — 끝까지 가도, 도중에 멈춰도(throw) 그때까지 한 일이 호출자 배열에 남는다.
// 계획·실행·담임 연결은 가짜로 갈아 끼우고 `syncMathClassBoards` 자체의 흐름만 본다(반환값·예외 전파는 예전 그대로여야 한다).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  applyThrows: null, teacherThrows: null, snapshot: vi.fn(() => { m.order.push("기록"); }), release: vi.fn(),
  // 자동 해제 — 판정·실행은 가짜로 갈아 끼우고 동기화 본체의 흐름(순서·보고서·멈춤)만 본다.
  childPlan: { releases: [], held: [] }, teacherPlan: { releases: [], held: [] }, childReleaseThrows: null, childReleaseHalts: false,
  childPlanThrows: null, teacherPlanInput: null, order: [],
}));
const plans = () => [
  { classId: "c1", className: "가반", board: { ["action"]: "exists", id: 1 }, assign: [{ studentId: "s1", name: "김민준", children: [{ id: 11, already: false }] }], hold: [{ studentId: "s9", name: "박도윤", reasons: ["학부모 미가입"] }], extras: ["이서연"], extraChildren: [{ id: 77, name: "이서연" }] },
  { classId: "c2", className: "나반", board: { ["action"]: "exists", id: 2 }, assign: [{ studentId: "s2", name: "최하린", children: [{ id: 22, already: false }] }], hold: [], extras: [] },
];
vi.mock("./classnote-admin-core.mjs", () => ({ fetchCenterId: async () => 1, loginClassnote: async () => {} }));
vi.mock("./classnote-paths.mjs", () => ({ stateFile: () => null }));
vi.mock("./math-class-boards-load.mjs", () => ({
  loadAywa: async () => ({ classes: [{ classId: "c1", className: "가반", studentIds: [] }, { classId: "c2", className: "나반", studentIds: [] }], students: new Map() }),
  loadLinkedBoards: async () => new Map(),
  loadClosedLinked: async () => [],
  loadVerifiedChildren: async () => new Map(),
  loadPlan: async () => ({ plans: plans(), boards: [], membersByBoard: new Map(), admissions: new Map(), failed: 0 }),
}));
vi.mock("./class-board-release.mjs", () => ({
  planChildReleases: () => {
    if (m.childPlanThrows) throw new Error(m.childPlanThrows);
    return m.childPlan;
  },
  planTeacherReleases: (input) => {
    m.teacherPlanInput = input;
    return m.teacherPlan;
  },
  dropReleasedExtras: (list, released) => {
    for (const p of list) {
      const gone = new Set(released.filter((r) => r.boardId === p.board.id).map((r) => r.childId));
      p.extraChildren = (p.extraChildren ?? []).filter((c) => !gone.has(c.id));
      p.extras = p.extraChildren.map((c) => c.name);
    }
  },
}));
vi.mock("./class-board-release-load.mjs", () => ({
  loadClassEnrollments: async () => new Map(),
  loadChildLinks: async () => new Map(),
  loadClassTeachers: async () => new Map(),
}));
vi.mock("./class-board-release-apply.mjs", () => ({
  releaseChildren: async ({ releases, done }) => {
    m.order.push("원아 해제");
    for (const r of releases) {
      if (m.childReleaseThrows && r.childId === 78) throw Object.assign(new Error(m.childReleaseThrows), m.childReleaseHalts ? { haltRelease: true } : {});
      done.push(r);
    }
  },
  releaseTeachers: async ({ releases, done }) => {
    m.order.push("담임 해제");
    done.push(...releases);
  },
}));
vi.mock("./class-board-plan.mjs", () => ({ closedClassesToKeep: () => [] }));
vi.mock("./math-class-boards-apply.mjs", () => ({
  // 실제 구현처럼 반마다 결과 줄을 **먼저** out에 넣고 일한다 — 첫 반을 끝낸 뒤 둘째 반에서 멈출 수 있다.
  applyClassBoardPlans: async ({ targets, out }) => {
    for (const p of targets) {
      const entry = { classId: p.classId, className: p.className, boardId: p.board.id, created: false, renamed: null, enrolled: [], skipped: null };
      out.push(entry);
      if (m.applyThrows && p.classId === "c2") throw new Error(m.applyThrows);
      entry.enrolled.push({ name: p.assign[0].name, childId: p.assign[0].children[0].id, studentId: p.assign[0].studentId });
    }
    return out;
  },
}));
vi.mock("./math-class-boards-db.mjs", () => ({ writeClassBoardSnapshot: m.snapshot, writeReleaseNames: m.release }));
vi.mock("./math-class-teachers.mjs", () => ({
  TEACHER_MAP: {},
  fetchEmployments: async () => [],
  planTeacherLinks: () => ({ todo: [{ className: "가반", teacher: "이수진" }, { className: "나반", teacher: "김은정" }], skipped: ["다반: 담임 없음"] }),
  connectTeachers: async (_page, _center, todo, _log, linked) => {
    m.order.push("담임 연결");
    linked.push(todo[0]);
    if (m.teacherThrows) throw new Error(m.teacherThrows);
    linked.push(todo[1]);
    return todo.length;
  },
}));

const { resetReleaseHaltForTest, syncMathClassBoards } = await import("./math-class-boards-sync.mjs");

// postgres.js 흉내 — 태그드 템플릿은 빈 결과, `sql(목록)`은 그대로.
const sql = (first) => (Array.isArray(first) && "raw" in first ? Promise.resolve([]) : first);
sql.json = (v) => v;
const texts = (events, group) => events.filter((e) => e.group === group).map((e) => `${e.className}|${e.text}`);

beforeEach(() => {
  vi.clearAllMocks();
  m.applyThrows = null;
  m.teacherThrows = null;
  m.childPlan = { releases: [], held: [] };
  m.teacherPlan = { releases: [], held: [] };
  m.childReleaseThrows = null;
  m.childReleaseHalts = false;
  m.childPlanThrows = null;
  m.teacherPlanInput = null;
  m.order = [];
  resetReleaseHaltForTest();
  delete process.env.CLASSNOTE_BOARD_AUTO_RELEASE;
});

describe("끝까지 간 동기화", () => {
  it("반환값은 예전 그대로이고, 줄·실행 결과가 호출자 배열에 담긴다", async () => {
    const events = [];
    const applied = [];
    const r = await syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {}, events, applied });
    expect(r).toMatchObject({ classes: 2, created: 0, renamed: 0, enrolled: 2, teachers: 2, held: 1, release: ["가반: 이서연"], skippedTeachers: ["다반: 담임 없음"] });
    expect(applied.map((d) => d.classId)).toEqual(["c1", "c2"]);
    expect(texts(events, "changed")).toEqual(["가반|원아 배정: 김민준", "나반|원아 배정: 최하린", "가반|담임 연결: 이수진", "나반|담임 연결: 김은정"]);
    expect(texts(events, "failed")).toEqual([]);
    expect(texts(events, "held")).toEqual(["다반|담임 연결 안 함 — 담임 없음", "가반|박도윤: 학부모 미가입"]);
    expect(texts(events, "release")).toEqual(["가반|해제 필요: 이서연"]);
    expect(m.snapshot).toHaveBeenCalledTimes(1);
    expect(m.release).toHaveBeenCalledTimes(1);
  });
  it("배열을 안 넘겨도(옛 호출부) 그대로 돈다 · 계획만 볼 때(apply=false)는 줄을 만들지 않는다", async () => {
    expect((await syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {} })).enrolled).toBe(2);
    const events = [];
    const r = await syncMathClassBoards(sql, {}, { tenant: "t1", apply: false, log: () => {}, events });
    expect(r).toMatchObject({ classes: 2, enrolled: 0, held: 1 });
    expect(events).toEqual([]);
  });
});

describe("🔴 도중에 멈춘 동기화 — 예외는 그대로 던지고, 그때까지의 사실은 남긴다", () => {
  it("배정하다 멈춤: 이미 배정한 원아 · 멈춘 이유(한글 원문) · 기록 갱신은 하지 않음", async () => {
    m.applyThrows = "최하린: 배정 실패 HTTP 400";
    const events = [];
    const applied = [];
    await expect(syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {}, events, applied })).rejects.toThrow("최하린: 배정 실패 HTTP 400");
    expect(applied.map((d) => d.classId)).toEqual(["c1", "c2"]);
    expect(applied[0].enrolled).toHaveLength(1);
    expect(texts(events, "changed")).toEqual(["가반|원아 배정: 김민준"]);
    expect(texts(events, "failed")).toEqual(["|여기서 멈췄습니다 — 최하린: 배정 실패 HTTP 400"]);
    // 멈춘 뒤에는 0302a 기록도 해제 목록도 갱신하지 않는다(초록불이 거짓으로 켜지지 않게 — 예전 동작)
    expect(m.snapshot).not.toHaveBeenCalled();
    expect(m.release).not.toHaveBeenCalled();
  });
  it("담임 연결하다 멈춤: 그 전에 연결한 담임까지는 남는다", async () => {
    m.teacherThrows = "나반 ← 김은정: 담임 연결 실패 HTTP 500";
    const events = [];
    await expect(syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {}, events })).rejects.toThrow("담임 연결 실패");
    expect(texts(events, "changed")).toContain("가반|담임 연결: 이수진");
    expect(texts(events, "changed")).not.toContain("나반|담임 연결: 김은정");
    expect(texts(events, "failed")).toEqual(["|여기서 멈췄습니다 — 나반 ← 김은정: 담임 연결 실패 HTTP 500"]);
  });
});

describe("자동 해제(원장 2026-10-02) — 수강이 끝난 원아·지금 담당이 아닌 선생님", () => {
  const kid = { classId: "c1", className: "가반", boardId: 1, childId: 77, childName: "이서연", studentId: "s7", studentName: "이서연", reason: "이서연 학생의 이 반 수강이 끝났습니다(반 이동·수강 종료)" };
  const teacher = { className: "나반", boardId: 2, employmentId: 5, teacherId: 22, teacher: "허주연" };
  it("해제한 원아·담임이 '변동된 것'에 사유와 함께 남고, 해제한 원아는 '해제 필요'에서 빠진다 · 순서 = 담임 연결 → 기록 → 원아 해제 → 담임 해제", async () => {
    m.childPlan = { releases: [kid], held: [] };
    m.teacherPlan = { releases: [teacher], held: [{ className: "가반", text: "담임 해제 보류(김은정) — 에이와에 이 반 담임이 없습니다" }] };
    const events = [];
    const released = { children: [], teachers: [] };
    const r = await syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {}, events, released });
    expect(r).toMatchObject({ releasedChildren: 1, releasedTeachers: 1, release: [] });
    expect(released.children).toEqual([kid]);
    expect(released.teachers).toEqual([teacher]);
    expect(m.order).toEqual(["담임 연결", "기록", "원아 해제", "담임 해제"]);
    expect(texts(events, "changed")).toContain("가반|원아 해제: 이서연 — 이서연 학생의 이 반 수강이 끝났습니다(반 이동·수강 종료)");
    expect(texts(events, "changed")).toContain("나반|담임 해제: 허주연 — 지금 이 반 담당이 아닙니다");
    expect(texts(events, "held")).toContain("가반|담임 해제 보류(김은정) — 에이와에 이 반 담임이 없습니다");
    expect(texts(events, "release")).toEqual([]);
    // 해제 리스트(0329a)에는 해제한 원아가 빠진 계획이 간다
    expect(m.release.mock.calls[0][2][0].extras).toEqual([]);
  });
  it("보류한 원아는 '해제 필요'에 그대로 남고, 왜 보류했는지가 '보류'에 원아마다 적힌다 · 해제 리스트에도 사유가 간다", async () => {
    const heldKid = { className: "가반", childName: "이서연", why: "누구의 원아인지 확인하지 못했습니다(원아 연결·1인 보드 없음)", text: "원아 해제 보류: 이서연 — 누구의 원아인지 확인하지 못했습니다(원아 연결·1인 보드 없음)" };
    m.childPlan = { releases: [], held: [heldKid] };
    const events = [];
    const r = await syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {}, events });
    expect(r).toMatchObject({ releasedChildren: 0, release: ["가반: 이서연"] });
    expect(texts(events, "held")).toContain("가반|원아 해제 보류: 이서연 — 누구의 원아인지 확인하지 못했습니다(원아 연결·1인 보드 없음)");
    expect(texts(events, "release")).toEqual(["가반|해제 필요: 이서연"]);
    expect(m.release.mock.calls[0][4]).toEqual([heldKid]);
  });
  it("🔴 해제하다 멈춰도 그때까지 해제한 원아는 호출자 손과 보고서에 남는다 · 배정 기록(0302a)은 해제 앞에서 이미 적혔다", async () => {
    m.childPlan = { releases: [kid, { ...kid, childId: 78, childName: "최하린" }], held: [] };
    m.childReleaseThrows = "가반: 원아 해제 뒤 반 원아가 예상과 다르다 — 중단";
    const events = [];
    const released = { children: [], teachers: [] };
    await expect(syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {}, events, released })).rejects.toThrow("원아 해제 뒤 반 원아가 예상과 다르다");
    expect(released.children.map((c) => c.childId)).toEqual([77]);
    expect(texts(events, "changed")).toContain("가반|원아 해제: 이서연 — 이서연 학생의 이 반 수강이 끝났습니다(반 이동·수강 종료)");
    expect(texts(events, "failed")[0]).toContain("여기서 멈췄습니다");
    // 해제 쪽이 멈춰도 방금 배정한 원아의 기록은 남는다(발송이 읽는 표) · 해제 리스트는 해제한 원아를 뺀 채로 적는다
    expect(m.snapshot).toHaveBeenCalledTimes(1);
    expect(m.release).toHaveBeenCalledTimes(1);
    expect(m.release.mock.calls[0][2][0].extras).toEqual([]);
  });
  it("끄기(CLASSNOTE_BOARD_AUTO_RELEASE=off) — 해제는 건너뛰고 나머지 동기화는 그대로", async () => {
    process.env.CLASSNOTE_BOARD_AUTO_RELEASE = "off";
    m.childPlan = { releases: [kid], held: [] };
    const events = [];
    const r = await syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {}, events });
    expect(r).toMatchObject({ enrolled: 2, teachers: 2, releasedChildren: 0, releasedTeachers: 0, release: ["가반: 이서연"] });
    expect(m.order).toEqual(["담임 연결", "기록"]);
    expect(texts(events, "release")).toEqual(["가반|해제 필요: 이서연"]);
    for (const off of ["false", "0", "NO", " Off "]) {
      process.env.CLASSNOTE_BOARD_AUTO_RELEASE = off;
      m.order = [];
      await syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {} });
      expect(m.order).toEqual(["담임 연결", "기록"]);
    }
  });
  it("계획만 볼 때(apply=false)는 해제 명단을 돌려주고 아무것도 하지 않는다", async () => {
    m.childPlan = { releases: [kid], held: [] };
    m.teacherPlan = { releases: [teacher], held: [] };
    const r = await syncMathClassBoards(sql, {}, { tenant: "t1", apply: false, log: () => {} });
    expect(r.releasePlan.children.releases).toEqual([kid]);
    expect(r.releasePlan.teachers.releases).toEqual([teacher]);
    expect(m.order).toEqual([]);
    // 🔴 계획 모드의 담임 판정은 "실제 실행이라면 먼저 붙을 담임 연결"을 붙은 것으로 얹는다 — 안 얹으면 담임이 바뀐 반이 보류로 나와
    //    사람이 확인한 명단과 실제 실행이 달라진다(여기선 담임 연결 계획 2건이 살아 있는 연결로 들어간다).
    expect(m.teacherPlanInput.emps.filter((e) => e.is_approved === true && e.id < 0)).toHaveLength(2);
  });
  it("해제 계획을 세우다 멈춰도(조회 실패) 예외는 그대로 올라가고, 배정 기록·해제 리스트는 적는다", async () => {
    m.childPlanThrows = "수강 기록 조회 실패";
    await expect(syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {} })).rejects.toThrow("수강 기록 조회 실패");
    expect(m.snapshot).toHaveBeenCalledTimes(1);
    expect(m.release.mock.calls[0][4]).toEqual([]);
  });
  it("🔴 멈춰서 손대지 못한 원아·그 건만 실패한 원아도 해제 리스트에 사유가 붙는다(이름만 남기지 않는다)", async () => {
    m.childPlan = { releases: [kid, { ...kid, childId: 78, childName: "최하린" }], held: [] };
    m.childReleaseThrows = "가반: 원아 해제 뒤 반 원아가 예상과 다르다 — 중단";
    await expect(syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {} })).rejects.toThrow();
    expect(m.release.mock.calls[0][4]).toEqual([{ className: "가반", childName: "최하린", why: "이번 동기화가 멈춰 해제하지 못했습니다 — 다음 동기화에서 합니다" }]);
  });
  it("🔴 '다른 배정이 함께 사라졌다'로 멈추면 자동 해제를 세운다 — 다음 회차는 해제하지 않고 그 사실을 보고서에 적는다", async () => {
    m.childPlan = { releases: [kid, { ...kid, childId: 78, childName: "최하린" }], held: [] };
    m.childReleaseThrows = "가반: 최하린 원아를 내보냈는데 다른 배정 1개가 함께 사라졌다 — 중단(사람 확인)";
    m.childReleaseHalts = true;
    await expect(syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {} })).rejects.toThrow("함께 사라졌다");
    // 다음 회차 — 해제는 건너뛰고 나머지는 그대로
    m.childReleaseThrows = null;
    m.order = [];
    const events = [];
    const r = await syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {}, events });
    expect(m.order).toEqual(["담임 연결", "기록"]);
    expect(r).toMatchObject({ enrolled: 2, releasedChildren: 0 });
    expect(r.releaseHalted).toContain("함께 사라졌다");
    expect(texts(events, "held").some((t) => t.includes("자동 해제가 멈춰 있어 이번에는 해제하지 않았습니다"))).toBe(true);
    // 예상과 다르다(그 사이 사람의 변경일 수 있는 것)는 세우지 않는다
    resetReleaseHaltForTest();
    m.childReleaseThrows = "가반: 원아 해제 뒤 반 원아가 예상과 다르다 — 중단";
    m.childReleaseHalts = false;
    await expect(syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {} })).rejects.toThrow();
    m.childReleaseThrows = null;
    m.order = [];
    await syncMathClassBoards(sql, {}, { tenant: "t1", apply: true, log: () => {} });
    expect(m.order).toContain("원아 해제");
  });
});
