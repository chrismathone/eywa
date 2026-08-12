import { describe, expect, it } from "vitest";
import { groupLandingByTeacher } from "./landing-groups";

const A = "aaaa1111";
const B = "bbbb2222";
/** 이름이 같은 다른 사람 — 이름으로 묶으면 한 덩어리가 되는 케이스. */
const A2 = "cccc3333";

const card = (
  className: string,
  teacherId: string | null,
  teacherName: string | null,
  totalSlots = 6,
  filledSlots = 0,
) => ({ className, teacherId, teacherName, totalSlots, filledSlots });

describe("groupLandingByTeacher", () => {
  it("담임별로 묶고 이름(ko)순으로 세운다", () => {
    const g = groupLandingByTeacher([
      card("LS3b", B, "김태건"),
      card("KW2", A, "육소희"),
      card("LS5", A, "육소희"),
    ]);
    expect(g.map((x) => x.label)).toEqual(["김태건", "육소희"]);
    expect(g[1].cards.map((c) => c.className)).toEqual(["KW2", "LS5"]);
  });

  it("🔴 묶음 키는 이름이 아니라 id — 동명이인은 갈라진다", () => {
    const g = groupLandingByTeacher([card("A반", A, "이현이"), card("B반", A2, "이현이")]);
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.key).sort()).toEqual([A, A2].sort());
    expect(g.every((x) => x.label === "이현이")).toBe(true);
  });

  it("'담임 미지정'은 항상 맨 뒤 — 사람이 아니라 상태다", () => {
    const g = groupLandingByTeacher([
      card("JP2", null, null),
      card("힣반", A, "힣담임"),
      card("KW2", B, "가담임"),
    ]);
    expect(g.map((x) => x.label)).toEqual(["가담임", "힣담임", "담임 미지정"]);
    expect(g.at(-1)!.unassigned).toBe(true);
  });

  it("반 순서는 서버가 준 그대로 — 묶음 안에서 다시 정렬하지 않는다", () => {
    const g = groupLandingByTeacher([
      card("나반", A, "육소희"),
      card("가반", A, "육소희"),
      card("다반", A, "육소희"),
    ]);
    expect(g[0].cards.map((c) => c.className)).toEqual(["나반", "가반", "다반"]);
  });

  it("묶음마다 그 담임 몫의 작성 상황을 낸다", () => {
    const g = groupLandingByTeacher([
      card("가", A, "육소희", 6, 6),
      card("나", A, "육소희", 6, 0),
      card("다", A, "육소희", 0, 0),
    ]);
    expect(g[0].summary.classes).toBe(3);
    expect(g[0].summary.scheduled).toBe(12);
    expect(g[0].summary.filled).toBe(6);
    expect(g[0].summary.pct).toBe(50);
    expect(g[0].summary.done).toBe(1);
    expect(g[0].summary.untouched).toBe(1);
    expect(g[0].summary.idle).toBe(1);
  });

  it("빈 목록은 빈 배열", () => {
    expect(groupLandingByTeacher([])).toEqual([]);
  });

  it("모든 카드는 정확히 한 묶음에만 들어간다(유실·중복 없음)", () => {
    const cards = [
      card("a", A, "육소희"),
      card("b", null, null),
      card("c", B, "김태건"),
      card("d", A, "육소희"),
    ];
    const g = groupLandingByTeacher(cards);
    const flat = g.flatMap((x) => x.cards.map((c) => c.className)).sort();
    expect(flat).toEqual(["a", "b", "c", "d"]);
  });
});
