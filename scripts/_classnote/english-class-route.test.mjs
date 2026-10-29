import { describe, expect, it, vi } from "vitest";

vi.mock("./classnote-admin-core.mjs", () => ({
  fetchBoardChildren: vi.fn(),
  fetchChildDetail: vi.fn(),
}));

const admin = await import("./classnote-admin-core.mjs");
const {
  englishAnchorClass,
  englishBlockedMessage,
  isMissingTable,
  pickEnglishTargets,
  resolveEnglishClassTargets,
} = await import("./english-class-route.mjs");

describe("englishAnchorClass", () => {
  it("영어 정규 = 보고서 반 · 보강 = 보강 반", () => {
    expect(englishAnchorClass({ subject: "english", class_id: "c1", makeup_class_id: "m1" })).toBe("c1");
    expect(englishAnchorClass({ subject: "english", class_id: null, makeup_class_id: "m1" })).toBe("m1");
    expect(englishAnchorClass({ subject: "english", class_id: null, makeup_class_id: null })).toBeNull();
  });
  it("영어가 아니면 null(수학은 수학 경로)", () => {
    expect(englishAnchorClass({ subject: "math", class_id: "c1" })).toBeNull();
    expect(englishAnchorClass({ subject: null, class_id: "c1" })).toBeNull();
  });
});

describe("pickEnglishTargets", () => {
  it("이 학생 원아 ∩ 지금 그 반 방 원아만(다계정 중 그 방에 있는 것만)", () => {
    // 이준혁: 5239556은 영어 반 방, 5233052는 수학 반 보드에만 있다
    expect(pickEnglishTargets({ studentChildIds: [5239556, 5233052], liveChildIds: [5239556, 5629794] })).toEqual({ ok: true, childIds: [5239556] });
  });
  it("문자열 id도 숫자로 맞춘다", () => {
    expect(pickEnglishTargets({ studentChildIds: ["7"], liveChildIds: [7] })).toEqual({ ok: true, childIds: [7] });
  });
  it("확정 원아가 없으면 no_link · 방에 없으면 not_in_board", () => {
    expect(pickEnglishTargets({ studentChildIds: [], liveChildIds: [1] })).toEqual({ ok: false, code: "no_link" });
    expect(pickEnglishTargets({ studentChildIds: [2], liveChildIds: [1] })).toEqual({ ok: false, code: "not_in_board" });
  });
  it("🔴 같은 이름의 다른 원아가 방에 있어도 이름으로 고르지 않는다(id만)", () => {
    expect(pickEnglishTargets({ studentChildIds: [10], liveChildIds: [11, 12] }).ok).toBe(false);
  });
});

describe("englishBlockedMessage", () => {
  it("사유는 한글 · 보드 이름을 적는다", () => {
    expect(englishBlockedMessage("no_link", "Jennifer 초6")).toContain("가입");
    expect(englishBlockedMessage("not_in_board", "Jennifer 초6")).toContain("Jennifer 초6");
  });
});

describe("isMissingTable", () => {
  it("표 없음·웹이 모르는 조회 = 종전 경로", () => {
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ code: "unknown_operation" })).toBe(true);
    expect(isMissingTable({ message: 'relation "classnote_english_class_boards" does not exist' })).toBe(true);
    expect(isMissingTable({ code: "57014" })).toBe(false);
    expect(isMissingTable(new Error("timeout"))).toBe(false);
  });
});

describe("resolveEnglishClassTargets", () => {
  const board = { boardId: 1312362, boardName: "Jennifer 초6 MED a (화수금)" };
  const sqlWith = (rows) => async () => rows;
  it("그 방의 이 학생 원아에게만 · 나머지는 교차 확인 대상", async () => {
    admin.fetchBoardChildren.mockResolvedValue([{ id: 5629794, name: "김준서" }, { id: 5239556, name: "이준혁" }, { id: 99, name: "공서연" }]);
    admin.fetchChildDetail.mockResolvedValue({ enrollment: [{ id: 555, belong_to_class: 1312362, removed_child: false }] });
    const r = await resolveEnglishClassTargets(sqlWith([{ child_id: "5239556" }, { child_id: "5233052" }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" });
    expect(r.ok).toBe(true);
    expect(r.targets.map((t) => t.child.id)).toEqual([5239556]);
    expect(r.targets[0].enrollment.id).toBe(555);
    expect(r.others.sort()).toEqual([5629794, 99].sort());
  });
  it("방에 없으면 막는다(1인 보드로 흘리지 않는다)", async () => {
    admin.fetchBoardChildren.mockResolvedValue([{ id: 1, name: "다른 아이" }]);
    const r = await resolveEnglishClassTargets(sqlWith([{ child_id: 2 }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" });
    expect(r).toEqual({ ok: false, error: englishBlockedMessage("not_in_board", board.boardName) });
  });
  it("반 배정 기록이 그 방이 아니면 막는다", async () => {
    admin.fetchBoardChildren.mockResolvedValue([{ id: 2, name: "아이" }]);
    admin.fetchChildDetail.mockResolvedValue({ enrollment: [{ id: 1, belong_to_class: 777, removed_child: false }] });
    const r = await resolveEnglishClassTargets(sqlWith([{ child_id: 2 }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" });
    expect(r.ok).toBe(false);
  });
});
