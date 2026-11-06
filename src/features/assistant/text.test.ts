import { describe, expect, it } from "vitest";
import { clipText } from "./text";

const loneHigh = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

describe("clipText", () => {
  it("짧으면 그대로(꼬리표 없음)", () => {
    expect(clipText("가나다", 3, "…")).toBe("가나다");
  });

  it("길면 자르고 꼬리표를 붙인다", () => {
    expect(clipText("가나다라", 2, "…")).toBe("가나…");
    expect(clipText("가나다라", 2)).toBe("가나");
  });

  it("이모지(서러게이트 쌍)를 반으로 가르지 않는다 — 반쪽 글자는 jsonb가 거절한다", () => {
    const text = `ab😀cd`; // 😀 = 인덱스 2·3
    const out = clipText(text, 3, "…");
    expect(out).toBe("ab…");
    expect(loneHigh.test(out)).toBe(false);
    expect(clipText(text, 4)).toBe("ab😀");
  });
});
