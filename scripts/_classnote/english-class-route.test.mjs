import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./classnote-admin-core.mjs", () => ({
  fetchBoardChildren: vi.fn(),
  fetchChildDetail: vi.fn(),
}));
// 원아 신분 가드 재료(학생·명부·확인 기록) — DB·ClassNote 대신 시험이 정한다.
vi.mock("./english-guard-load.mjs", () => ({ loadEnglishGuardInputs: vi.fn(), ENGLISH_GUARD_FRESH_MIN_MS: 60_000 }));

const admin = await import("./classnote-admin-core.mjs");
const guardLoad = await import("./english-guard-load.mjs");
const { familyFinder } = await import("./child-identity.mjs");
const {
  englishAnchorClass,
  englishBlockedMessage,
  englishGuardMessage,
  isMissingTable,
  pickEnglishTargets,
  resolveEnglishClassTargets,
} = await import("./english-class-route.mjs");

const PHONE = "010-1234-5678";
/** 가드 재료 — 학생 s = 이준혁(초6 · 2014생), 명부는 원아 번호 → 이름·생년·보호자 전화. */
function guardInputs({ students = [{ id: "s", name: "이준혁", grade: "초6", phones: [PHONE] }], admissions = {}, verifiedOwners = new Map() } = {}) {
  const map = new Map(students.map((s) => [s.id, s]));
  return {
    students: map,
    admissions: new Map(Object.entries(admissions).map(([id, a]) => [Number(id), { birth: "2014-03-01", phones: [PHONE], phone: PHONE, boardNames: [], ...a }])),
    verifiedOwners,
    familyFor: familyFinder(map.values()),
    schoolYear: 2026,
  };
}

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
  beforeEach(() => {
    guardLoad.loadEnglishGuardInputs.mockReset();
    guardLoad.loadEnglishGuardInputs.mockResolvedValue(guardInputs({ admissions: { 5239556: { name: "이준혁" }, 2: { name: "이준혁" } } }));
  });
  it("그 방의 이 학생 원아에게만 · 나머지는 교차 확인 대상", async () => {
    admin.fetchBoardChildren.mockResolvedValue([{ id: 5629794, name: "김준서" }, { id: 5239556, name: "이준혁" }, { id: 99, name: "공서연" }]);
    admin.fetchChildDetail.mockResolvedValue({ enrollment: [{ id: 555, belong_to_class: 1312362, removed_child: false }] });
    const r = await resolveEnglishClassTargets(sqlWith([{ child_id: "5239556" }, { child_id: "5233052" }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" });
    expect(r.ok).toBe(true);
    expect(r.targets.map((t) => t.child.id)).toEqual([5239556]);
    expect(r.targets[0].enrollment.id).toBe(555);
    expect(r.others.sort()).toEqual([5629794, 99].sort());
  });
  it("🔴 형제 뒤바뀜(명부 '박세하' · 반 방 프로필 '박세인') — 원아 연결이 이 학생을 가리켜도 보내지 않는다", async () => {
    guardLoad.loadEnglishGuardInputs.mockResolvedValue(
      guardInputs({
        students: [
          { id: "s", name: "박세인", grade: "초3", phones: [PHONE] },
          { id: "sib", name: "박세하", grade: "초4", phones: [PHONE] },
        ],
        admissions: { 2235158: { name: "박세하", birth: "2017-02-01" } },
      }),
    );
    admin.fetchBoardChildren.mockResolvedValue([{ id: 2235158, name: "박세인", date_birth: "2017-02-01" }, { id: 8, name: "다른 아이" }]);
    admin.fetchChildDetail.mockClear();
    const r = await resolveEnglishClassTargets(sqlWith([{ child_id: 2235158 }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("발송 보류");
    expect(r.error).toContain("같은 집 다른 아이(박세하)");
    expect(admin.fetchChildDetail).not.toHaveBeenCalled(); // 가드에서 멈추면 배정 기록도 읽지 않는다
  });
  it("보호자 전화가 다르면 보내지 않는다(이름으로만 이어진 연결 — 실측 2명) · 사유에 번호 값은 없다", async () => {
    guardLoad.loadEnglishGuardInputs.mockResolvedValue(guardInputs({ admissions: { 2: { name: "이준혁", phones: ["010-9999-0000"], phone: "010-9999-0000" } } }));
    admin.fetchBoardChildren.mockResolvedValue([{ id: 2, name: "이준혁" }]);
    const r = await resolveEnglishClassTargets(sqlWith([{ child_id: 2 }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("보호자 전화 불일치");
    expect(r.error).not.toMatch(/9999|1234/);
  });
  it("명부에 없는 원아 · 프로필 이름을 못 읽은 원아는 보내지 않는다", async () => {
    guardLoad.loadEnglishGuardInputs.mockResolvedValue(guardInputs({ admissions: {} }));
    admin.fetchBoardChildren.mockResolvedValue([{ id: 2, name: "이준혁" }]);
    expect((await resolveEnglishClassTargets(sqlWith([{ child_id: 2 }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" })).error).toContain("운영관리 명부에 없음");
    guardLoad.loadEnglishGuardInputs.mockResolvedValue(guardInputs({ admissions: { 2: { name: "이준혁" } } }));
    admin.fetchBoardChildren.mockResolvedValue([{ id: 2, name: "" }]);
    expect((await resolveEnglishClassTargets(sqlWith([{ child_id: 2 }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" })).error).toContain("학부모 프로필(이름)을 확인하지 못함");
  });
  it("가드 재료를 못 읽으면 throw(호출부가 재시도 — 모르는 채 보내지 않는다)", async () => {
    guardLoad.loadEnglishGuardInputs.mockRejectedValue(new Error("반 보드 확인 기록을 읽지 못했습니다"));
    admin.fetchBoardChildren.mockResolvedValue([{ id: 2, name: "이준혁" }]);
    await expect(resolveEnglishClassTargets(sqlWith([{ child_id: 2 }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" })).rejects.toThrow("확인 기록");
  });
  it("막히면 학생·명부를 캐시 없이 한 번 더 읽어 다시 판정한다(바로잡은 직후 재발송 — 리뷰 2026-11-05)", async () => {
    guardLoad.loadEnglishGuardInputs.mockReset();
    guardLoad.loadEnglishGuardInputs
      .mockResolvedValueOnce(guardInputs({ admissions: { 2: { name: "이준혁", phones: ["010-9999-0000"], phone: "010-9999-0000" } } }))
      .mockResolvedValueOnce(guardInputs({ admissions: { 2: { name: "이준혁" } } }));
    admin.fetchBoardChildren.mockResolvedValue([{ id: 2, name: "이준혁" }]);
    admin.fetchChildDetail.mockResolvedValue({ enrollment: [{ id: 55, belong_to_class: board.boardId }] });
    const r = await resolveEnglishClassTargets(sqlWith([{ child_id: 2 }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" });
    expect(r.ok).toBe(true);
    expect(guardLoad.loadEnglishGuardInputs).toHaveBeenCalledTimes(2);
    expect(guardLoad.loadEnglishGuardInputs.mock.calls[1][2]).toMatchObject({ fresh: true });
  });
  it("🔴 1분 안에 읽은 재료로 막혔는데 다시 읽기가 실패하면 첫 판정대로 막는다(throw·재시도로 바꾸지 않는다 · 사유가 오류 문구로 덮이지 않는다 — 재리뷰 2026-11-05)", async () => {
    guardLoad.loadEnglishGuardInputs.mockReset();
    guardLoad.loadEnglishGuardInputs
      .mockResolvedValueOnce({ ...guardInputs({ admissions: { 2: { name: "이준혁", phones: ["010-9999-0000"], phone: "010-9999-0000" } } }), loadedAt: Date.now() })
      .mockRejectedValueOnce(new Error("명부 GET 504"));
    admin.fetchBoardChildren.mockResolvedValue([{ id: 2, name: "이준혁" }]);
    const r = await resolveEnglishClassTargets(sqlWith([{ child_id: 2 }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("보호자 전화 불일치");
    expect(r.error).not.toContain("504");
    expect(guardLoad.loadEnglishGuardInputs).toHaveBeenCalledTimes(2);
  });
  it("🔴 1분 넘은 캐시로 막혔는데 다시 읽기가 실패하면 throw(호출부 재시도 — 옛 값으로 실패를 굳히지 않는다 · 재확인 2026-11-05)", async () => {
    guardLoad.loadEnglishGuardInputs.mockReset();
    guardLoad.loadEnglishGuardInputs
      .mockResolvedValueOnce({ ...guardInputs({ students: [] }), loadedAt: Date.now() - 9 * 60_000 }) // 10분 캐시 안에 만든 학생 — 옛 학생 목록엔 없다
      .mockRejectedValueOnce(new Error("학생 조회 실패"));
    admin.fetchBoardChildren.mockResolvedValue([{ id: 2, name: "이준혁" }]);
    await expect(resolveEnglishClassTargets(sqlWith([{ child_id: 2 }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" })).rejects.toThrow("학생 조회 실패");
  });
  it("통과하면 다시 읽지 않는다", async () => {
    guardLoad.loadEnglishGuardInputs.mockReset();
    guardLoad.loadEnglishGuardInputs.mockResolvedValue(guardInputs({ admissions: { 2: { name: "이준혁" } } }));
    admin.fetchBoardChildren.mockResolvedValue([{ id: 2, name: "이준혁" }]);
    admin.fetchChildDetail.mockResolvedValue({ enrollment: [{ id: 55, belong_to_class: board.boardId }] });
    await resolveEnglishClassTargets(sqlWith([{ child_id: 2 }]), {}, { tenant: "t", centerId: 1, board, studentId: "s" });
    expect(guardLoad.loadEnglishGuardInputs).toHaveBeenCalledTimes(1);
  });
  it("가드 사유 문구는 길면 자르고 보드 이름을 적는다", () => {
    const m = englishGuardMessage("LE3", ["가".repeat(300)]);
    expect(m).toContain("영어 반 방(LE3) 발송 보류");
    expect(m).toContain("…");
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
