// 반 보드 동기화가 **보고서 재료를 남기는 방식**(0329a) — 끝까지 가도, 도중에 멈춰도(throw) 그때까지 한 일이 호출자 배열에 남는다.
// 계획·실행·담임 연결은 가짜로 갈아 끼우고 `syncMathClassBoards` 자체의 흐름만 본다(반환값·예외 전파는 예전 그대로여야 한다).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ applyThrows: null, teacherThrows: null, snapshot: vi.fn(), release: vi.fn() }));
const plans = () => [
  { classId: "c1", className: "가반", board: { ["action"]: "exists", id: 1 }, assign: [{ studentId: "s1", name: "김민준", children: [{ id: 11, already: false }] }], hold: [{ studentId: "s9", name: "박도윤", reasons: ["학부모 미가입"] }], extras: ["이서연"] },
  { classId: "c2", className: "나반", board: { ["action"]: "exists", id: 2 }, assign: [{ studentId: "s2", name: "최하린", children: [{ id: 22, already: false }] }], hold: [], extras: [] },
];
vi.mock("./classnote-admin-core.mjs", () => ({ fetchCenterId: async () => 1, loginClassnote: async () => {} }));
vi.mock("./classnote-paths.mjs", () => ({ stateFile: () => null }));
vi.mock("./math-class-boards-load.mjs", () => ({
  loadAywa: async () => ({ classes: [{ classId: "c1", className: "가반", studentIds: [] }, { classId: "c2", className: "나반", studentIds: [] }], students: new Map() }),
  loadLinkedBoards: async () => new Map(),
  loadClosedLinked: async () => [],
  loadPlan: async () => ({ plans: plans(), boards: [], membersByBoard: new Map(), failed: 0 }),
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
  fetchEmployments: async () => [],
  planTeacherLinks: () => ({ todo: [{ className: "가반", teacher: "이수진" }, { className: "나반", teacher: "김은정" }], skipped: ["다반: 담임 없음"] }),
  connectTeachers: async (_page, _center, todo, _log, linked) => {
    linked.push(todo[0]);
    if (m.teacherThrows) throw new Error(m.teacherThrows);
    linked.push(todo[1]);
    return todo.length;
  },
}));

const { syncMathClassBoards } = await import("./math-class-boards-sync.mjs");

// postgres.js 흉내 — 태그드 템플릿은 빈 결과, `sql(목록)`은 그대로.
const sql = (first) => (Array.isArray(first) && "raw" in first ? Promise.resolve([]) : first);
sql.json = (v) => v;
const texts = (events, group) => events.filter((e) => e.group === group).map((e) => `${e.className}|${e.text}`);

beforeEach(() => {
  vi.clearAllMocks();
  m.applyThrows = null;
  m.teacherThrows = null;
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
