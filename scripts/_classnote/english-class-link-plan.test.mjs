import { describe, expect, it } from "vitest";
import { isGroupBoardName, planEnglishClassLinks } from "./english-class-link-plan.mjs";

const boards = [
  { boardId: 1, boardName: "Jennifer 초6 MED a (화수금)" },
  { boardId: 2, boardName: "Green 초등 브릿지C (월수목)" },
  { boardId: 3, boardName: "(영어)김준서" },
  { boardId: 4, boardName: "[ALL] 전체 공지" },
  { boardId: 5, boardName: "M 중1 정규" }, // 수학 반 보드(제외 목록)
];
const childrenOf = new Map([
  ["a", [11]],
  ["b", [12, 13]],
  ["c", [14]],
  ["d", []],
]);
const members = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), new Set(v)]));

describe("isGroupBoardName", () => {
  it("1인 보드·전체 공지는 반 방이 아니다", () => {
    expect(isGroupBoardName("(영어)김준서")).toBe(false);
    expect(isGroupBoardName("( 수학 )박서준")).toBe(false);
    expect(isGroupBoardName("[ALL] 공지")).toBe(false);
    expect(isGroupBoardName("Jennifer 초6 MED a")).toBe(true);
    expect(isGroupBoardName("(초등) 브릿지")).toBe(true);
  });
});

describe("planEnglishClassLinks", () => {
  const cls = [{ classId: "x", className: "중등E_초6 MED a", studentIds: ["a", "b", "c", "d"] }];
  it("연결된 원아 전원이 한 방에 = clean · 미가입은 따로", () => {
    const [p] = planEnglishClassLinks({ classes: cls, childrenOf, boards, membersOf: members({ 1: [11, 13, 14], 3: [11] }) });
    expect(p).toMatchObject({ status: "clean", boardId: 1, inBoard: 3, linked: 3, students: 4, noLink: ["d"], missing: [] });
  });
  it("일부 빠지면 partial + 빠진 학생", () => {
    const [p] = planEnglishClassLinks({ classes: cls, childrenOf, boards, membersOf: members({ 1: [11, 12], 2: [14] }) });
    expect(p).toMatchObject({ status: "partial", boardId: 1, inBoard: 2, missing: ["c"], runnerUp: { boardName: boards[1].boardName, inBoard: 1 } });
  });
  it("같은 수가 둘이면 고르지 않는다", () => {
    const [p] = planEnglishClassLinks({ classes: cls, childrenOf, boards, membersOf: members({ 1: [11], 2: [14] }) });
    expect(p).toMatchObject({ status: "tie", boardId: null });
  });
  it("1인 보드·수학 반 보드는 후보가 아니다", () => {
    const [p] = planEnglishClassLinks({
      classes: cls, childrenOf, boards, membersOf: members({ 3: [11, 12, 14], 5: [11, 12, 14] }), excludeBoardIds: new Set([5]),
    });
    expect(p).toMatchObject({ status: "none", boardId: null });
  });
});
