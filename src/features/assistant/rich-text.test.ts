import { describe, expect, it } from "vitest";
import { parseRich, plainRich, type RichSpan } from "./rich-text";

const s = (text: string, bold = false, tone: RichSpan["tone"] = null): RichSpan => ({ text, bold, tone });

describe("parseRich", () => {
  it("표시가 없으면 한 조각 그대로", () => {
    expect(parseRich("재원생 31명입니다.")).toEqual([s("재원생 31명입니다.")]);
    expect(parseRich("")).toEqual([]);
  });

  it("굵게 · 뜻 색 세 가지(영어·한국어 이름)", () => {
    expect(parseRich("퇴원 **8명** 중")).toEqual([s("퇴원 "), s("8명", true), s(" 중")]);
    expect(parseRich("[[good:출석률 95%]] · [[bad:미납 12건]] · [[warn:지켜볼 반]]")).toEqual([
      s("출석률 95%", false, "good"),
      s(" · "),
      s("미납 12건", false, "bad"),
      s(" · "),
      s("지켜볼 반", false, "warn"),
    ]);
    expect(parseRich("[[위험:3명]][[좋음:2명]][[주의:1명]][[나쁨:0명]]").map((x) => x.tone)).toEqual(["bad", "good", "warn", "bad"]);
  });

  it("색 안에 굵게 · 굵게 안에 색", () => {
    expect(parseRich("[[bad:6개월 **7명** 퇴원]]")).toEqual([s("6개월 ", false, "bad"), s("7명", true, "bad"), s(" 퇴원", false, "bad")]);
    expect(parseRich("**반 [[good:3곳]] 개선**")).toEqual([s("반 ", true), s("3곳", true, "good"), s(" 개선", true)]);
  });

  it("🔴 짝이 없거나 비었거나 모르는 표시는 글자 그대로 — 글을 잃지 않는다", () => {
    for (const raw of ["별 ** 하나", "**", "****", "[[bad:닫지 않음", "]] 닫기만", "[[pink:모르는 색]]", "[[bad:   ]]", "** **", "a * b * c"]) {
      expect(plainRich(raw)).toBe(raw);
      expect(parseRich(raw).every((x) => !x.bold && x.tone === null)).toBe(true);
    }
  });

  it("엇갈린 표시 — 바깥이 먼저 닫히면 안쪽은 열지 않는다", () => {
    // 굵게가 색보다 먼저 닫힌다 → 색 표시는 글자로.
    expect(parseRich("**a [[bad:b** c]]")).toEqual([s("a [[bad:b", true), s(" c]]")]);
    // 색 안의 굵게가 색 밖에서 닫힌다 → 굵게는 글자로.
    expect(parseRich("[[bad:a **b]] c**")).toEqual([s("a **b", false, "bad"), s(" c**")]);
    // 색 안에 색 — 안쪽은 글자로 남고 첫 ]]에서 닫힌다.
    expect(plainRich("[[bad:a [[good:b]] c]]")).toBe("a [[good:b c]]");
  });

  it("\\로 막은 글자는 그대로", () => {
    expect(parseRich("\\*\\*별\\*\\*")).toEqual([s("**별**")]);
    expect(parseRich("\\[[bad:x]]")).toEqual([s("[[bad:x]]")]);
    expect(parseRich("**a\\*\\*b**")).toEqual([s("a**b", true)]);
    expect(plainRich("C:\\폴더")).toBe("C:\\폴더");
  });

  it("줄바꿈·HTML 같은 글은 글자로 남는다", () => {
    expect(plainRich('줄1\n**줄2**\n<img src=x onerror="alert(1)">')).toBe('줄1\n줄2\n<img src=x onerror="alert(1)">');
  });
});
