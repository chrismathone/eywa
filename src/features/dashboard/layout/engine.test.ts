import { describe, expect, it } from "vitest";
import { dropEmptyHeadings, insertAt, moveTo, newItem, patchItem, removeItem, resizeItem, sameItems, sanitizeItems } from "./engine";
import { cardDef } from "./registry";

describe("sanitizeItems — 읽을 때·저장할 때 거른다", () => {
  it("모르는 카드 id·중복은 버리고, 제목 없는 머리줄은 '이름 없는 구역'으로 남긴다(2026-11-09 — 버리면 그 아래 카드가 앞 구역으로 붙는다)", () => {
    const out = sanitizeItems([
      { id: "panel:notices", w: 6, h: 1 },
      { id: "panel:없는카드", w: 6, h: 1 },
      { id: "panel:notices", w: 12, h: 1 },
      { id: "heading:x", w: 24, h: 1 },
      { id: "heading:y", w: 24, h: 1, title: "오늘" },
      null,
      "문자열",
    ]);
    expect(out.map((i) => i.id)).toEqual(["panel:notices", "heading:x", "heading:y"]);
    expect(out.find((i) => i.id === "heading:x")?.title).toBe("이름 없는 구역");
  });

  it("크기는 그 카드의 허용 프리셋으로 맞춘다(깨진 값 = 가장 가까운 것)", () => {
    const [kpi, panel, bad] = sanitizeItems([
      { id: "kpi:students", w: 24, h: 2 },
      { id: "panel:attendance", w: 7, h: 1 },
      { id: "panel:notices", w: Number.NaN, h: "x" },
    ]);
    expect(kpi).toMatchObject({ w: 6, h: 1 });
    expect(panel).toMatchObject({ w: 6, h: 1 });
    expect(bad).toMatchObject({ w: 6, h: 1 });
  });

  it("요약을 지원하지 않는 카드의 요약 모드는 일반으로, 카드에 없는 옵션은 지운다", () => {
    const [grades, notices] = sanitizeItems([
      { id: "panel:grades", w: 3, h: 1, mode: "summary", amounts: true },
      { id: "panel:billingMonth", w: 3, h: 1, mode: "summary", amounts: false, phones: true },
    ]);
    expect(grades).not.toHaveProperty("mode");
    expect(grades).not.toHaveProperty("amounts");
    expect(notices).toMatchObject({ mode: "summary", amounts: false });
    expect(notices).not.toHaveProperty("phones");
  });

  it("머리줄은 항상 한 줄 전체, 옵션 없음", () => {
    expect(sanitizeItems([{ id: "heading:a", w: 3, h: 2, title: " 공지 ", amounts: true }])).toEqual([{ id: "heading:a", w: 24, h: 1, title: "공지" }]);
  });
});

describe("목록 다루기", () => {
  const items = ["kpi:students", "panel:attendance", "panel:notices"].map((id) => newItem(id));

  it("insertAt — 자리에 끼우고, 이미 있으면 옮긴다", () => {
    expect(insertAt(items, newItem("panel:staff"), 1).map((i) => i.id)).toEqual(["kpi:students", "panel:staff", "panel:attendance", "panel:notices"]);
    expect(insertAt(items, items[2]!, 0).map((i) => i.id)).toEqual(["panel:notices", "kpi:students", "panel:attendance"]);
  });

  it("moveTo·removeItem", () => {
    expect(moveTo(items, "kpi:students", 2).map((i) => i.id)).toEqual(["panel:attendance", "panel:notices", "kpi:students"]);
    expect(removeItem(items, "panel:attendance").map((i) => i.id)).toEqual(["kpi:students", "panel:notices"]);
  });

  it("resizeItem — 요약 ↔ 일반이 모드까지 바뀐다", () => {
    const def = cardDef("panel:notices")!;
    const small = def.sizes.find((z) => z.mode === "summary")!;
    const r = resizeItem(items, "panel:notices", small);
    expect(r[2]).toMatchObject({ w: 3, h: 1, mode: "summary" });
    expect(resizeItem(r, "panel:notices", { w: 12, h: 2 })[2]).not.toHaveProperty("mode");
  });

  it("patchItem — 빈 제목은 기본 이름으로(값을 지운다), 머리줄 제목은 남긴다", () => {
    const named = patchItem(items, "panel:notices", { title: "  공지  " });
    expect(named[2]?.title).toBe("공지");
    expect(patchItem(named, "panel:notices", { title: "   " })[2]).not.toHaveProperty("title");
  });

  it("dropEmptyHeadings — 아래에 카드가 없는 머리줄을 뺀다", () => {
    const list = [newItem("heading:a", undefined, "가"), newItem("heading:b", undefined, "나"), newItem("panel:notices"), newItem("heading:c", undefined, "다")];
    expect(dropEmptyHeadings(list).map((i) => i.id)).toEqual(["heading:b", "panel:notices"]);
  });

  it("sameItems — 순서·크기·옵션까지 본다", () => {
    expect(sameItems(items, items.map((i) => ({ ...i })))).toBe(true);
    expect(sameItems(items, [...items].reverse())).toBe(false);
    expect(sameItems(items, patchItem(items, "panel:notices", { title: "x" }))).toBe(false);
  });
});
