// 반 보드 배정 **실행** — 배정 직전 재확인이 원아 출처마다 맞게 도는지(원장 2026-11-02 A안). ClassNote 호출은 가짜로 갈아 끼운다.
//  · 1인 보드 출처(personal) = 1인 보드를 다시 읽는다(종전 그대로)
//  · 반 보드 확인 기록 출처(verified) = 다시 읽을 출처가 없다(이미 그 반 보드에 있는 원아)
//  · 원아 연결 출처(link) = 원아 연결표(0185a)를 다시 읽어 계획과 다르면 멈춘다(사람이 형제 연결을 그 사이 고쳤을 수 있다)
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ boards: new Map(), enrolled: [], reads: [] }));
vi.mock("./classnote-admin-core.mjs", () => ({
  CLASSNOTE_BASE: "https://example.invalid",
  createBoard: async () => ({ ok: false, reason: "시험에서 만들지 않는다" }),
  dismissHonorificDialog: async () => false,
  fetchBoards: async () => [...m.boards.keys()].map((id) => ({ id, name: id === 11 ? "(수학)김근우A" : `반${id}` })),
  fetchBoardChildren: async (_page, _center, id) => {
    m.reads.push(id);
    return (m.boards.get(id) ?? []).map((cid) => ({ id: cid }));
  },
  enrollChild: async (_page, childId, boardId) => {
    m.enrolled.push([childId, boardId]);
    m.boards.set(boardId, [...(m.boards.get(boardId) ?? []), childId]);
    return { status: 201 };
  },
}));

const { applyClassBoardPlans, ClassBoardStop } = await import("./math-class-boards-apply.mjs");

const page = { waitForTimeout: async () => {}, goto: async () => {} };
const students = new Map([["s1", { id: "s1", name: "김근우A" }]]);
const boards = [{ id: 11, name: "(수학)김근우A" }, { id: 21, name: "반21" }];
const plan = (source, children = [{ id: 101, name: "김근우", already: false }]) => [
  { classId: "c1", className: "반21", board: { action: "exists", id: 21, name: "반21" }, hold: [], assign: [{ studentId: "s1", name: "김근우A", source, children }] },
];
const run = (targets, extra = {}) =>
  applyClassBoardPlans({ page, centerId: 1, targets, boards, membersByBoard: new Map([[11, []], [21, []]]), students, log: () => {}, ...extra });

beforeEach(() => {
  m.boards = new Map([[11, []], [21, []]]);
  m.enrolled = [];
  m.reads = [];
});

describe("원아 연결 출처(link) — 배정 직전 원아 연결표를 다시 읽는다", () => {
  it("연결이 계획과 같으면 배정한다(반마다 한 번 읽는다)", async () => {
    const reload = vi.fn(async () => new Map([[101, "s1"], [555, "s9"]]));
    const out = await run(plan("link"), { reloadChildLinks: reload });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(m.enrolled).toEqual([[101, 21]]);
    expect(out[0].enrolled).toEqual([{ name: "김근우A", childId: 101, studentId: "s1" }]);
    expect(m.reads).not.toContain(11); // 1인 보드는 출처가 아니라 읽지 않는다
  });
  it("🔴 그 사이 계획한 원아의 연결이 바뀌었으면(형제 연결을 사람이 고침 · 지움) 배정하지 않고 멈춘다", async () => {
    for (const now of [new Map([[101, "s2"]]), new Map(), new Map([["101", "s2"], [102, "s1"]])]) {
      m.enrolled = [];
      await expect(run(plan("link"), { reloadChildLinks: async () => now })).rejects.toThrow(/원아 연결이 계획과 다르다/);
      expect(m.enrolled).toEqual([]);
    }
  });
  it("계획한 원아가 아직 이 학생 것이면 새 연결이 하나 더 생겼어도 멈추지 않는다(새 연결은 다음 동기화가 가드와 함께 본다)", async () => {
    await run(plan("link"), { reloadChildLinks: async () => new Map([[101, "s1"], [102, "s1"]]) });
    expect(m.enrolled).toEqual([[101, 21]]);
  });
  it("🔴 다시 읽을 수단이 없으면 멈춘다(모르는 채로 넣지 않는다) · 읽기 실패도 멈춘다", async () => {
    await expect(run(plan("link"))).rejects.toBeInstanceOf(ClassBoardStop);
    await expect(run(plan("link"), { reloadChildLinks: async () => { throw new Error("db down"); } })).rejects.toThrow("db down");
    expect(m.enrolled).toEqual([]);
  });
});

describe("다른 출처는 종전 그대로", () => {
  it("확인 기록 출처(verified)는 원아 연결도 1인 보드도 다시 읽지 않는다", async () => {
    m.boards.set(21, [101]);
    const reload = vi.fn(async () => new Map());
    await run(plan("verified", [{ id: 101, name: "김근우", already: true }]), { reloadChildLinks: reload });
    expect(reload).not.toHaveBeenCalled();
    expect(m.reads).not.toContain(11);
  });
  it("1인 보드 출처(personal)는 1인 보드를 다시 읽어 다르면 멈춘다", async () => {
    const membersByBoard = new Map([[11, [{ id: 101 }]], [21, []]]);
    m.boards.set(11, [101]);
    await run(plan("personal"), { membersByBoard });
    expect(m.reads).toContain(11);
    m.boards = new Map([[11, [999]], [21, []]]);
    await expect(run(plan("personal"), { membersByBoard })).rejects.toThrow(/1인 보드 원아가 계획과 다르다/);
  });
});
