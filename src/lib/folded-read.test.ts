import { describe, expect, it } from "vitest";
import { carryFolded, foldedReason, markFolded } from "./folded-read";

describe("접힌 조회 표식 — '없음'과 '못 읽음'을 가른다(금액 조립이 보고 멈춘다)", () => {
  it("표식은 그 객체에만 붙는다 — 같은 내용의 다른 객체·빈 값은 접힌 게 아니다", () => {
    const folded = markFolded(new Map<string, number>(), "담임 변경 기록을 읽지 못했습니다");
    expect(foldedReason(folded)).toBe("담임 변경 기록을 읽지 못했습니다");
    expect(foldedReason(new Map())).toBeNull();
    expect(foldedReason([])).toBeNull();
    expect(foldedReason(null)).toBeNull();
    expect(foldedReason(undefined)).toBeNull();
  });

  it("값의 모양·내용은 그대로다 — 화면은 표식을 모르고 종전처럼 쓴다", () => {
    const rows = markFolded([{ id: "a" }], "못 읽음");
    expect(rows).toEqual([{ id: "a" }]);
    expect(Object.keys(rows)).toEqual(["0"]);
  });

  it("🔴 가공해 만든 새 객체는 표식을 잃는다 — `carryFolded`로 옮겨 싣는다(빈 결과에도 붙는다)", () => {
    const rows = markFolded([{ id: "a", mine: false }], "못 읽음");
    const filtered = rows.filter((r) => r.mine);
    expect(foldedReason(filtered)).toBeNull();
    expect(foldedReason(carryFolded(rows, filtered))).toBe("못 읽음");
    expect(filtered).toEqual([]); // 걸러서 0줄이 돼도 '못 읽었다'는 사실은 남는다
    // 원본이 접힌 게 아니면 아무것도 붙이지 않는다.
    expect(foldedReason(carryFolded([{ id: "a" }], []))).toBeNull();
  });
});
