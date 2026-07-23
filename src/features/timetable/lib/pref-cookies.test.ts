import { describe, expect, it } from "vitest";
import {
  parseCompact1hCookie,
  readCompact1hFor,
  serializeCompact1hCookie,
  writeCompact1hFor,
} from "./pref-cookies";

describe("compact1h 쿠키 — 통합뷰 '1시간 단위' 과목별 기억", () => {
  it("왕복(직렬화→파싱)이 같은 값을 돌려준다", () => {
    const map = { english: [540, 600], math: [480] };
    expect(parseCompact1hCookie(serializeCompact1hCookie(map))).toEqual(map);
  });

  it("과목별로 분리된다 — 영어 설정이 수학을 접지 않는다", () => {
    const raw = serializeCompact1hCookie({ english: [540, 600] });
    expect(readCompact1hFor(raw, "english")).toEqual([540, 600]);
    expect(readCompact1hFor(raw, "math")).toEqual([]);
  });

  it("다른 과목 값을 보존하며 갱신한다(과목을 오가도 서로 안 지움)", () => {
    const raw = serializeCompact1hCookie({ english: [540], math: [480] });
    const next = writeCompact1hFor(raw, "english", [600, 660]);
    expect(readCompact1hFor(next, "english")).toEqual([600, 660]);
    expect(readCompact1hFor(next, "math")).toEqual([480]);
  });

  it("빈 목록으로 쓰면 그 과목만 지워진다 = '전부 펼침'(체크 해제가 살아남는다)", () => {
    const raw = serializeCompact1hCookie({ english: [540], math: [480] });
    const next = writeCompact1hFor(raw, "english", []);
    expect(readCompact1hFor(next, "english")).toEqual([]);
    expect(readCompact1hFor(next, "math")).toEqual([480]);
  });

  it("정렬·중복 제거로 정규화한다(같은 상태면 같은 문자열 = 쿠키 재기록 안 함)", () => {
    expect(serializeCompact1hCookie({ english: [600, 540, 600] })).toBe("english:540.600");
  });

  it("깨진 값·옛 형식·빈 값은 조용히 버린다(수기 편집 방어)", () => {
    expect(parseCompact1hCookie(undefined)).toEqual({});
    expect(parseCompact1hCookie("")).toEqual({});
    expect(parseCompact1hCookie("english")).toEqual({});
    expect(parseCompact1hCookie(":540")).toEqual({});
    expect(parseCompact1hCookie("english:abc")).toEqual({});
    expect(parseCompact1hCookie("english:-3.0")).toEqual({});
    expect(parseCompact1hCookie("english:540~broken~math:480")).toEqual({
      english: [540],
      math: [480],
    });
  });

  it("구분자로 쓸 수 없는 문자가 과목키에 들어오면 직렬화에서 제외한다", () => {
    expect(serializeCompact1hCookie({ "a:b": [540], math: [480] })).toBe("math:480");
    expect(serializeCompact1hCookie({ "a~b": [540], math: [480] })).toBe("math:480");
  });
});
