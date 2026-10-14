import { describe, expect, it } from "vitest";
import { CARDS } from "@/features/dashboard/layout/registry";
import { matchesWidget } from "./widget-search";

describe("위젯 검색", () => {
  const ids = (q: string) => CARDS.filter((c) => matchesWidget(c, q)).map((c) => c.id);
  it("빈 검색어는 전부", () => expect(ids("  ")).toHaveLength(CARDS.length));
  it("이름 일부 · 공백·가운뎃점 무시", () => {
    expect(ids("학교별")).toContain("panel:schools");
    expect(ids("6개월청구")).toContain("panel:billing6");
    expect(ids("콜상담")).toContain("panel:admissions");
  });
  it("묶음 이름으로도 찾는다", () => {
    expect(ids("수납")).toEqual(expect.arrayContaining(["panel:billingMonth", "panel:billing6", "panel:expenses"]));
  });
  it("없는 말은 0건", () => expect(ids("없는위젯이름")).toEqual([]));
});
