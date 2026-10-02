// 학부모 연락 → 다른 과목 지금 담당 선생님(0331a, 2026-10-02 김근호: 영어 반 글에 단 "오늘 학원 쉽니다"를 수학 선생님이 몰랐다).
import { describe, expect, it, vi } from "vitest";

vi.mock("./classnote-admin-core.mjs", () => ({
  BOARD_GROUPS: {
    math: { label: "수학", prefix: "(수학)", subjectKeys: ["math", "subject_1"] },
    english: { label: "영어", prefix: "(영어)", subjectKeys: ["english"] },
  },
}));
const { attachCrossTeachers, boardSubjectKeys, crossStudentConfirmed, otherSubjectKeys } = await import("./cross-subject-teachers.mjs");

const MATH = ["math", "subject_1"];
const ENG = ["english"];

describe("boardSubjectKeys — 그 글이 올라온 보드의 과목", () => {
  const classBoards = new Set([1317092]);
  it("접두사가 있으면 그 과목", () => {
    expect(boardSubjectKeys("(수학)김근호", 1, classBoards)).toEqual(MATH);
    expect(boardSubjectKeys("(영어)김근호", 2, classBoards)).toEqual(ENG);
  });
  it("접두사 없는 보드 — 등록된 수학 반 보드면 수학, 아니면 영어 그룹반", () => {
    expect(boardSubjectKeys("고등M 개별 TP4E", 1317092, classBoards)).toEqual(MATH);
    expect(boardSubjectKeys("Jennifer 중1 MED (월목)", 1182447, classBoards)).toEqual(ENG);
    expect(boardSubjectKeys("Jennifer 중1 MED (월목)", null, classBoards)).toEqual(ENG);
  });
});

describe("otherSubjectKeys", () => {
  it("운영 중인 과목에서 보드 과목 묶음을 뺀다 · 빈 값·중복 제거", () => {
    expect(otherSubjectKeys(["math", "english", "subject_1", "math", null, ""], ENG)).toEqual(["math", "subject_1"]);
    expect(otherSubjectKeys(["math", "english"], MATH)).toEqual(["english"]);
    expect(otherSubjectKeys(["english"], ENG)).toEqual([]);
  });
});

/** postgres.js 흉내 — 반 보드 조회와 과목 조회를 구분해 답한다. */
function fakeSql({ boards = [], subjects = ["math", "english"], boardsError = null, conflicted = [], names = { "stu-근호": "김근호", "stu-other": "다른학생" } } = {}) {
  const sql = (first, ...rest) => {
    if (!(Array.isArray(first) && "raw" in first)) return first; // sql(목록) 헬퍼
    const text = first.join("?");
    if (text.includes("classnote_class_board_members")) return Promise.resolve(conflicted.map((c) => ({ child_id: c })));
    if (text.includes("classnote_class_boards")) return boardsError ? Promise.reject(boardsError) : Promise.resolve(boards.map((b) => ({ board_id: b })));
    if (text.includes("from students")) return Promise.resolve(Object.entries(names).map(([id, name]) => ({ id, name, classnote_name: null })));
    if (text.includes("select distinct subject")) return Promise.resolve(subjects.map((s) => ({ subject: s })));
    throw new Error("예상 못 한 조회: " + text + rest.length);
  };
  return sql;
}
const links = new Map([[5328574, "stu-근호"], [77, "stu-other"]]);

describe("crossStudentConfirmed — 원아 링크로 정한 학생을 믿어도 되나", () => {
  const none = new Set();
  it("그룹반·반 보드는 원아 id가 유일한 근거 — 반 보드 판정과 어긋난 원아만 막는다", () => {
    expect(crossStudentConfirmed({ className: "Jennifer 중1 MED (월목)", childId: 7 }, { conflicted: none, effectiveName: "김근호" })).toBe(true);
    expect(crossStudentConfirmed({ className: "초등M 개별 JJ1E", childId: 2235158 }, { conflicted: new Set([2235158]), effectiveName: "박세하" })).toBe(false);
  });
  it("🔴 1인 보드는 보드의 이름이 연결된 학생 이름과 같을 때만(형제의 원아가 서로 바뀌어 연결된 경우를 막는다)", () => {
    expect(crossStudentConfirmed({ className: "(수학)김근호", childId: 7 }, { conflicted: none, effectiveName: "김근호" })).toBe(true);
    expect(crossStudentConfirmed({ className: "(수학) 김근호", childId: 7 }, { conflicted: none, effectiveName: "김 근호" })).toBe(true);
    expect(crossStudentConfirmed({ className: "(수학)박세인", childId: 2235158 }, { conflicted: none, effectiveName: "박세하" })).toBe(false);
    expect(crossStudentConfirmed({ className: "(영어)박세인", childId: 1 }, { conflicted: none, effectiveName: "" })).toBe(false);
  });
});

describe("attachCrossTeachers", () => {
  it("🔴 영어 반 글 → 그 학생의 수학 지금 담당에게(영어 담당은 넣지 않는다)", async () => {
    const calls = [];
    const recipientsFor = async (_sql, _tenant, studentIds, keys) => {
      calls.push({ studentIds, keys });
      return { byStudent: new Map([["stu-근호", { ids: ["t-수진", "t-수진"] }]]), fallback: null };
    };
    const items = [{ childId: 5328574, cls: 1182447, className: "Jennifer 중1 MED (월목)" }];
    await attachCrossTeachers(fakeSql(), "t1", items, links, { recipientsFor, log: () => {} });
    expect(calls).toEqual([{ studentIds: ["stu-근호"], keys: ["math"] }]);
    expect(items[0].crossTeacherIds).toEqual(["t-수진"]);
  });
  it("수학 보드 글 → 수학이 아닌 과목 담당에게 · 보드 과목 묶음별로 한 번씩만 계산", async () => {
    const calls = [];
    const recipientsFor = async (_sql, _tenant, studentIds, keys) => {
      calls.push({ studentIds, keys });
      return { byStudent: new Map(studentIds.map((id) => [id, { ids: [`${keys[0]}-teacher-of-${id}`] }])), fallback: null };
    };
    const items = [
      { childId: 5328574, cls: 10, className: "(수학)김근호" },
      { childId: 77, cls: 1317092, className: "고등M 개별 TP4E" },
      { childId: 77, cls: 20, className: "(영어)다른학생" },
      { childId: 77, cls: 21, className: "(영어)남의이름" }, // 보드 이름이 연결된 학생과 다르다 — 붙이지 않는다
    ];
    await attachCrossTeachers(fakeSql({ boards: [1317092] }), "t1", items, links, { recipientsFor, log: () => {} });
    expect(calls).toEqual([
      { studentIds: ["stu-근호", "stu-other"], keys: ["english"] },
      { studentIds: ["stu-other"], keys: ["math"] },
    ]);
    expect(items.map((i) => i.crossTeacherIds)).toEqual([["english-teacher-of-stu-근호"], ["english-teacher-of-stu-other"], ["math-teacher-of-stu-other"], undefined]);
  });
  it("원아 연결이 없는 글·받는 사람이 없는 학생은 그대로 둔다 · 다른 과목이 없으면 계산하지 않는다", async () => {
    const recipientsFor = vi.fn(async () => ({ byStudent: new Map(), fallback: null }));
    const items = [{ childId: 999, cls: 1, className: "(수학)모름" }, { childId: null, className: "(수학)모름" }];
    await attachCrossTeachers(fakeSql(), "t1", items, links, { recipientsFor, log: () => {} });
    expect(recipientsFor).not.toHaveBeenCalled();
    const one = [{ childId: 5328574, cls: 1, className: "(영어)김근호" }];
    await attachCrossTeachers(fakeSql({ subjects: ["english"] }), "t1", one, links, { recipientsFor, log: () => {} });
    expect(recipientsFor).not.toHaveBeenCalled();
    await attachCrossTeachers(fakeSql(), "t1", one, links, { recipientsFor, log: () => {} });
    expect(recipientsFor).toHaveBeenCalledTimes(1);
    expect(one[0].crossTeacherIds).toBeUndefined();
  });
  it("🔴 반 보드 판정과 원아 링크가 어긋난 원아의 연락은 다른 과목 담당에게 보내지 않는다", async () => {
    const recipientsFor = vi.fn(async () => ({ byStudent: new Map([["stu-근호", { ids: ["t-수진"] }]]), fallback: null }));
    const items = [{ childId: 5328574, cls: 1182447, className: "Jennifer 중1 MED (월목)" }];
    const logs = [];
    await attachCrossTeachers(fakeSql({ conflicted: [5328574] }), "t1", items, links, { recipientsFor, log: (l) => logs.push(l) });
    expect(recipientsFor).not.toHaveBeenCalled();
    expect(items[0].crossTeacherIds).toBeUndefined();
    expect(logs[0]).toContain("원아 연결과 보드가 어긋남");
  });
  it("🔴 실패는 삼킨다 — 원문 저장을 막지 않는다(로그만) · 반 보드 표가 없는 DB는 접두사로만 가른다", async () => {
    const logs = [];
    const items = [{ childId: 5328574, cls: 1, className: "(영어)김근호" }];
    await attachCrossTeachers(fakeSql(), "t1", items, links, { recipientsFor: async () => { throw new Error("boom"); }, log: (l) => logs.push(l) });
    expect(items[0].crossTeacherIds).toBeUndefined();
    expect(logs[0]).toContain("다른 과목 담당 선생님 계산 실패");
    const missing = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    const recipientsFor = async () => ({ byStudent: new Map([["stu-근호", { ids: ["t-수진"] }]]), fallback: null });
    await attachCrossTeachers(fakeSql({ boardsError: missing }), "t1", items, links, { recipientsFor, log: () => {} });
    expect(items[0].crossTeacherIds).toEqual(["t-수진"]);
  });
});
