import { describe, expect, it } from "vitest";
import { menuDiff, todaysMathMenusWriteReplySchema } from "./branch-menus";

const item = (menu: string, on: boolean, open = true) => ({ menu, label: menu.toUpperCase(), product: "math" as const, open, on });

describe("오늘 수학 사용 메뉴", () => {
  it("감사 기록의 켠 것 · 끈 것은 저장 전후 차이(이름)", () => {
    expect(menuDiff([item("a", true), item("b", false), item("c", true)], [item("a", false), item("b", true), item("c", true)]))
      .toEqual({ turnedOn: ["B"], turnedOff: ["A"] });
  });
  it("오늘 수학 답의 업무 실패는 ok:false + 까닭", () => {
    expect(todaysMathMenusWriteReplySchema.parse({ ok: false, code: "CONFLICT" })).toEqual({ ok: false, code: "CONFLICT" });
    expect(todaysMathMenusWriteReplySchema.safeParse({ ok: false, code: "OTHER" }).success).toBe(false);
    expect(todaysMathMenusWriteReplySchema.parse({ ok: true, changed: true, revision: 2, items: [item("a", true)] }).ok).toBe(true);
  });
});
