import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMETABLE_KIND,
  TIMETABLE_KINDS,
  TIMETABLE_KIND_LABEL,
  matchesTimetableKind,
  parseTimetableKind,
} from "./class-kind";

describe("parseTimetableKind", () => {
  it("기본값은 정규 — 파라미터 없는 URL이 지금까지의 화면이어야 한다", () => {
    expect(parseTimetableKind(undefined)).toBe("regular");
    expect(parseTimetableKind(null)).toBe("regular");
    expect(parseTimetableKind("")).toBe("regular");
    expect(DEFAULT_TIMETABLE_KIND).toBe("regular");
  });

  it("special/all/makeup만 인정하고 모르는 값은 정규로 떨어진다(URL 직입력 방어)", () => {
    expect(parseTimetableKind("special")).toBe("special");
    expect(parseTimetableKind("all")).toBe("all");
    expect(parseTimetableKind("makeup")).toBe("makeup");
    // 보강 탭은 슬롯을 거르지 않는다(과목 목록의 재료) — 전체와 같다.
    expect(matchesTimetableKind("makeup", true)).toBe(true);
    expect(matchesTimetableKind("makeup", false)).toBe(true);
    expect(parseTimetableKind("regular")).toBe("regular");
    expect(parseTimetableKind("특강")).toBe("regular");
    expect(parseTimetableKind("SPECIAL")).toBe("regular");
  });
});

describe("matchesTimetableKind", () => {
  it("정규 = 특강 제외", () => {
    expect(matchesTimetableKind("regular", false)).toBe(true);
    expect(matchesTimetableKind("regular", true)).toBe(false);
  });

  it("특강 = 특강만", () => {
    expect(matchesTimetableKind("special", true)).toBe(true);
    expect(matchesTimetableKind("special", false)).toBe(false);
  });

  it("전체 = 둘 다", () => {
    expect(matchesTimetableKind("all", true)).toBe(true);
    expect(matchesTimetableKind("all", false)).toBe(true);
  });

  it("정규와 특강은 서로 배타 — 어떤 반도 두 화면에서 사라지거나 중복되지 않는다", () => {
    for (const isSpecial of [true, false]) {
      const shown = [
        matchesTimetableKind("regular", isSpecial),
        matchesTimetableKind("special", isSpecial),
      ].filter(Boolean);
      expect(shown).toHaveLength(1);
    }
  });
});

describe("칩 메타", () => {
  it("칩 순서는 정규 → 특강 → 전체 → 보강, 라벨은 전부 한글(raw 영문 키 노출 금지)", () => {
    expect(TIMETABLE_KINDS).toEqual(["regular", "special", "all", "makeup"]);
    for (const k of TIMETABLE_KINDS) {
      expect(TIMETABLE_KIND_LABEL[k]).toMatch(/^[가-힣]+$/);
    }
  });
});
