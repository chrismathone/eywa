import { describe, expect, it } from "vitest";
import {
  absenceMemo,
  appendMemo,
  hasMemoLine,
  makeupMemo,
  shortDate,
  unitsAfterMakeup,
} from "./makeup-absence-link";

describe("shortDate", () => {
  it("앞 0을 떼고 M/D — 원장 예시 표기", () => {
    expect(shortDate("2026-07-16")).toBe("7/16");
    expect(shortDate("2026-07-01")).toBe("7/1");
    expect(shortDate("2026-12-25")).toBe("12/25");
  });

  it("형식이 아니면 원문 그대로(빈칸·쓰레기 값을 만들지 않는다)", () => {
    expect(shortDate("")).toBe("");
    expect(shortDate("어제")).toBe("어제");
  });
});

describe("메모 문구 — 원장 2026-08-06 사양", () => {
  it("결석한 날엔 '보강 예정', 보강한 날엔 '결석분 보강'", () => {
    expect(absenceMemo("2026-07-31")).toBe("7/31 보강 예정");
    expect(makeupMemo("2026-07-16")).toBe("7/16 결석분 보강");
  });
});

describe("appendMemo", () => {
  it("빈 메모면 문장만", () => {
    expect(appendMemo(null, "7/31 보강 예정")).toBe("7/31 보강 예정");
    expect(appendMemo("  ", "7/31 보강 예정")).toBe("7/31 보강 예정");
  });

  it("기존 사유를 지우지 않고 줄을 더한다", () => {
    expect(appendMemo("병결", "7/31 보강 예정")).toBe("병결\n7/31 보강 예정");
  });

  it("같은 줄이 이미 있으면 그대로 — 두 번 눌러도 안 늘어난다(멱등)", () => {
    const once = appendMemo("병결", "7/31 보강 예정");
    expect(appendMemo(once, "7/31 보강 예정")).toBe(once);
  });

  it("다른 날짜는 별개 줄로 쌓인다(보강이 두 번일 수 있다)", () => {
    const first = appendMemo(null, "7/31 보강 예정");
    expect(appendMemo(first, "8/2 보강 예정")).toBe("7/31 보강 예정\n8/2 보강 예정");
  });
});

describe("hasMemoLine — 시수 이중 가산 방지", () => {
  it("줄 단위로 본다 — '7/1'이 '7/16'에 걸리면 안 된다", () => {
    expect(hasMemoLine("7/16 결석분 보강", "7/1 결석분 보강")).toBe(false);
    expect(hasMemoLine("7/16 결석분 보강", "7/16 결석분 보강")).toBe(true);
  });

  it("여러 줄 중 하나여도 찾는다 · 빈 메모는 false", () => {
    expect(hasMemoLine("병결\n7/16 결석분 보강", "7/16 결석분 보강")).toBe(true);
    expect(hasMemoLine(null, "7/16 결석분 보강")).toBe(false);
  });
});

describe("unitsAfterMakeup", () => {
  it("미입력은 1로 보고 +1 — 정규 1 + 보강 1 = 2", () => {
    expect(unitsAfterMakeup(null)).toBe(2);
    expect(unitsAfterMakeup(1)).toBe(2);
  });

  it("이미 고쳐 둔 값에도 +1(1.5짜리 반은 2.5 — 다르면 강사가 고친다)", () => {
    expect(unitsAfterMakeup(1.5)).toBe(2.5);
    expect(unitsAfterMakeup(2)).toBe(3);
  });
});
