import { describe, expect, it } from "vitest";
import { BLANK_VALUE, checkedOf, encodeValueFilter, parseValueFilter, passesValueFilter } from "./value-filter";

describe("값 목록 필터(엑셀식, 원장 2026-10-14)", () => {
  const all = ["a", "b", "c", "d", BLANK_VALUE];

  it("전부 체크면 필터 해제 · 절반 이하면 '이것만' · 넘으면 '이것만 뺀다'로 짧게 적는다", () => {
    expect(encodeValueFilter(all, all)).toBeNull();
    expect(encodeValueFilter(["b", "a"], all)).toBe("b,a");
    expect(encodeValueFilter(["a", "b", "c", "d"], all)).toBe(`!${BLANK_VALUE}`);
  });

  it("주소 값을 풀고 다시 열면 같은 체크가 선다(왕복)", () => {
    for (const checked of [["a"], ["a", "b", "c"], ["b", "c", "d", BLANK_VALUE]]) {
      const raw = encodeValueFilter(checked, all);
      expect(checkedOf(parseValueFilter(raw), all).sort()).toEqual([...checked].sort());
    }
    expect(checkedOf(null, all)).toEqual(all);
  });

  it("값 안의 쉼표·역슬래시·맨 앞 느낌표·앞뒤 공백도 그대로 왕복한다(리뷰 2026-10-14)", () => {
    const odd = ["김, 철수", "!느낌표", "a\\b", " 공백 ", "보통"];
    for (const checked of [[odd[0]!], [odd[1]!], odd.slice(0, 4)]) {
      const raw = encodeValueFilter(checked, odd);
      const parsed = parseValueFilter(raw);
      expect(checkedOf(parsed, odd).sort()).toEqual([...checked].sort());
    }
    expect(parseValueFilter(encodeValueFilter(["!느낌표"], odd))).toEqual({ mode: "in", values: ["!느낌표"] });
  });

  it("옛 단일 값 링크·빈 값·배열(같은 키 두 번)은 화면을 죽이지 않는다", () => {
    expect(parseValueFilter("c2")).toEqual({ mode: "in", values: ["c2"] });
    expect(parseValueFilter("")).toBeNull();
    expect(parseValueFilter("!")).toBeNull();
    expect(parseValueFilter(["a", "b"])).toBeNull();
  });

  it("빈 줄은 '(공백)'으로 · 값이 여럿이면 하나라도 고른 값이면 보인다", () => {
    const only = parseValueFilter("a");
    expect(passesValueFilter(only, ["a", "z"])).toBe(true);
    expect(passesValueFilter(only, [])).toBe(false);
    expect(passesValueFilter(parseValueFilter(BLANK_VALUE), [])).toBe(true);
    const without = parseValueFilter("!a");
    expect(passesValueFilter(without, ["a"])).toBe(false);
    expect(passesValueFilter(without, ["a", "b"])).toBe(true);
    // 목록에 없던 새 값(기간을 넓혀 새로 섞인 반)은 '뺀다' 필터에서 보인다.
    expect(passesValueFilter(without, ["new"])).toBe(true);
    expect(passesValueFilter(undefined, [])).toBe(true);
  });
});
