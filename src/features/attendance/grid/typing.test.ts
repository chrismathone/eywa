import { describe, expect, it } from "vitest";
import { appendChar, backspace, canonicalUnitsRaw, commitBuffer, copyValueOf } from "./typing";

describe("appendChar", () => {
  it("숫자를 누적한다", () => {
    expect(appendChar(null, "1")).toBe("1");
    expect(appendChar("1", "2")).toBe("12");
  });

  it("소수점은 한 번만 — 1.5.5 같은 입력 차단", () => {
    expect(appendChar("1", ".")).toBe("1.");
    expect(appendChar("1.5", ".")).toBe("1.5");
  });

  it("빈 칸에서 소수점을 누르면 0.으로 연다", () => {
    expect(appendChar(null, ".")).toBe("0.");
    expect(appendChar("0.", "5")).toBe("0.5");
  });

  it("쉼표도 소수점으로(한국 키보드 배열 대비)", () => {
    expect(appendChar("1", ",")).toBe("1.");
  });

  it("숫자·소수점이 아니면 버퍼를 그대로 둔다", () => {
    expect(appendChar("1", "a")).toBe("1");
    expect(appendChar(null, "Shift")).toBeNull();
  });

  it("길이 상한을 넘으면 무시(값이 조용히 잘리지 않게)", () => {
    expect(appendChar("12.5", "5")).toBe("12.5");
  });
});

describe("backspace", () => {
  it("한 글자씩 지우고 비면 null", () => {
    expect(backspace("1.5")).toBe("1.");
    expect(backspace("1")).toBeNull();
  });
});

describe("commitBuffer — 🔴 숫자 → (상태, 시수) 변환은 여기 한 곳뿐", () => {
  it("0은 결석이고 시수를 비운다", () => {
    expect(commitBuffer("0")).toEqual({ status: "absent", units: "" });
  });

  it("🔴 1은 출석 + **명시** 1(\"1\" — 저장은 null이지만 수학 자동 시수가 덮지 않는다, 2026-09-11)", () => {
    expect(commitBuffer("1")).toEqual({ status: "present", units: "1" });
    expect(commitBuffer("1.0")).toEqual({ status: "present", units: "1" });
  });

  it("1.5·2는 출석 + 그 시수", () => {
    expect(commitBuffer("1.5")).toEqual({ status: "present", units: "1.5" });
    expect(commitBuffer("2")).toEqual({ status: "present", units: "2" });
  });

  it("확정할 수 없는 입력은 null — 아무 일도 일어나지 않는다", () => {
    for (const b of [null, "", " ", ".", "0.", "abc", "1.55", "--1"]) {
      expect(commitBuffer(b), JSON.stringify(b)).toBeNull();
    }
  });

  it("🔴 시수 상한을 넘으면 거절 — 팝오버 입력과 같은 규칙(parseSessionUnits 재사용)", () => {
    expect(commitBuffer("20")).toEqual({ status: "present", units: "20" });
    expect(commitBuffer("21")).toBeNull();
    expect(commitBuffer("99")).toBeNull();
  });

  it("쉼표 소수점도 받는다", () => {
    expect(commitBuffer("1,5")).toEqual({ status: "present", units: "1.5" });
  });
});

describe("canonicalUnitsRaw — 🔴 격자 타이핑과 팝오버가 같은 원문을 넘긴다(재리뷰 2026-09-11)", () => {
  it('비움(공백 포함)은 기본("")', () => {
    for (const raw of ["", " ", "   "]) expect(canonicalUnitsRaw(raw), JSON.stringify(raw)).toBe("");
  });

  it('쉼표 소수점 → 점 · 1은 명시 "1" · 그 밖은 표준 표기', () => {
    expect(canonicalUnitsRaw("1,5")).toBe("1.5");
    expect(canonicalUnitsRaw(" 1,5 ")).toBe("1.5");
    expect(canonicalUnitsRaw("1")).toBe("1");
    expect(canonicalUnitsRaw("1.0")).toBe("1");
    expect(canonicalUnitsRaw("2")).toBe("2");
  });

  it("서버가 받지 않을 원문은 null", () => {
    for (const raw of ["abc", "0", "21", "1.55"]) expect(canonicalUnitsRaw(raw), raw).toBeNull();
  });

  it("🔴 commitBuffer와 같은 답 — 격자에 친 숫자(0 = 결석은 따로)", () => {
    for (const b of ["1", "1.0", "1.5", "1,5", "2", "12.5", "20"]) {
      expect(commitBuffer(b)?.units, b).toBe(canonicalUnitsRaw(b));
    }
  });
});

describe("copyValueOf", () => {
  it("빈 칸은 null", () => {
    expect(copyValueOf(null)).toBeNull();
  });

  it("출석·결석은 그대로 복사", () => {
    expect(copyValueOf({ s: "present", u: null })).toEqual({ status: "present", units: "" });
    expect(copyValueOf({ s: "present", u: 1.5 })).toEqual({ status: "present", units: "1.5" });
    expect(copyValueOf({ s: "absent", u: null })).toEqual({ status: "absent", units: "" });
  });

  it("🔴 지각·조퇴·보강은 숫자로 복사하지 않는다 — 붙여넣으면 상태가 조용히 '출석'으로 바뀐다", () => {
    for (const st of ["late", "early_leave", "makeup"]) {
      expect(copyValueOf({ s: st, u: null }), st).toBeNull();
    }
  });
});
