import { describe, it, expect } from "vitest";
import { parseView, ONESCREEN_VIEWS } from "./view";

describe("parseView", () => {
  it.each(ONESCREEN_VIEWS)("알려진 뷰는 그대로 — %s", (v) => {
    expect(parseView(v)).toBe(v);
  });

  it("부재·빈값·모르는 값은 기본 card(잘못된 쿼리로 화면이 비지 않도록)", () => {
    expect(parseView(undefined)).toBe("card");
    expect(parseView("")).toBe("card");
    expect(parseView("표")).toBe("card");
    expect(parseView("__proto__")).toBe("card");
  });
});
