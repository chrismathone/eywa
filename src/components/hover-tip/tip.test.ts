import { describe, expect, it } from "vitest";
import { decodeTip, encodeTip, tipProps, tipText, TIP_ATTR } from "./tip";

describe("메모 툴팁 재료 — 빈 값은 카드를 안 만든다", () => {
  it("메모 문자열 한 줄은 그대로 카드가 된다", () => {
    const raw = encodeTip("병결");
    expect(raw).toBeDefined();
    expect(decodeTip(raw)?.lines).toEqual(["병결"]);
  });

  it("공백뿐인 메모는 카드가 아니다(빈 상자 금지)", () => {
    expect(encodeTip("   ")).toBeUndefined();
    expect(encodeTip("")).toBeUndefined();
    expect(encodeTip(null)).toBeUndefined();
  });

  it("🔴 이름·날짜만 있으면 안 띄운다 — 화면에 이미 보이는 것을 되풀이할 뿐이다", () => {
    expect(encodeTip({ title: "안은지", meta: "경명여중1" })).toBeUndefined();
  });

  it("값이 빈 줄은 스스로 빠진다(라벨만 남지 않는다)", () => {
    const card = decodeTip(encodeTip({ rows: [["메모", "  "], ["보강", "9/17(목)"]] }));
    expect(card?.rows).toEqual([["보강", "9/17(목)"]]);
  });

  it("속성은 값이 있을 때만 붙는다", () => {
    expect(tipProps(null)).toEqual({});
    expect(Object.keys(tipProps("병결"))).toEqual([TIP_ATTR]);
  });
});

describe("decodeTip — DOM에서 온 값은 무엇이든 올 수 있다", () => {
  it("JSON이 아니면 null(지어내지 않는다)", () => {
    expect(decodeTip("병결")).toBeNull();
    expect(decodeTip("")).toBeNull();
    expect(decodeTip(null)).toBeNull();
    expect(decodeTip("[1,2]")).toBeNull();
  });

  it("줄 모양이 아닌 조각은 버린다", () => {
    expect(decodeTip('{"r":[["메모","병결"],["잘못됨"],3],"l":["안내",5]}')).toEqual({
      title: null,
      meta: null,
      rows: [["메모", "병결"]],
      lines: ["안내"],
    });
  });
});

describe("tipText — 카드를 한 줄로(접근성·테스트)", () => {
  it("카드가 그리는 순서 그대로 잇는다", () => {
    const raw = encodeTip({
      title: "안은지",
      meta: "경명여중1",
      rows: [["보강", "9/17(목) 14:20~16:20"]],
      lines: ["학부모 요청"],
    });
    expect(tipText(raw)).toBe("안은지 · 경명여중1 · 보강 9/17(목) 14:20~16:20 · 학부모 요청");
  });

  it("카드가 없으면 빈 문자열", () => {
    expect(tipText(null)).toBe("");
  });
});

describe("넓은 카드(wide) — 근거 줄이 많은 카드만", () => {
  it("켜면 왕복해도 남고, 안 켠 카드엔 키가 없다(기존 카드 모양 그대로)", () => {
    expect(decodeTip(encodeTip({ rows: [["따뜻함 4", "다정함"]], wide: true }))?.wide).toBe(true);
    const plain = decodeTip(encodeTip({ rows: [["보강", "9/17(목)"]] }));
    expect(plain && "wide" in plain).toBe(false);
  });

  it("넓다는 표시만으로는 카드가 뜨지 않는다", () => {
    expect(encodeTip({ title: "평점 3.3", wide: true })).toBeUndefined();
  });
});
