import { describe, expect, it } from "vitest";
import { cellText, looksLikeWordCount, memorizedCellPlan, memorizedFillMode } from "./memorized-cell";

/**
 * 🔴 이 판정이 느슨해지면 **사람이 그 칸에 적어 둔 다른 기록이 사라진다**(원장 2026-09-21 규약).
 *    그래서 실데이터 전건(2026-09-28, 1,507칸)에서 나온 **글자 섞인 값 9종 전부**를 여기 박아 둔다.
 */
const REAL_NOTES = [
  "180/200점 - STARTING 2 (레벨2_중1)",
  "175/200점 - STARTING 2 (레벨2_중1)",
  "165/200점 - STARTING 2 (레벨2_중1)",
  "185/200점 - STARTING 2 (레벨2_중1)",
  "150/200점 - STARTING 2 (레벨2_중1)",
  "135/200점 - STARTING 2 (레벨2_중1)",
  "/200점 - STARTING 2 (레벨2_중1)",
  "눈 아파서 조퇴",
  "봉사활동",
];

describe("누적 암기 단어수 — 갱신 가능 판정", () => {
  it("숫자만 든 칸은 단어수로 본다(자릿수 쉼표 허용)", () => {
    for (const v of ["0", "7", "1240", "1,240", "12,345"]) expect(looksLikeWordCount(v)).toBe(true);
  });

  it("🔴 실데이터의 사람 메모 9종은 하나도 단어수로 보지 않는다", () => {
    for (const v of REAL_NOTES) expect(looksLikeWordCount(v), v).toBe(false);
  });

  it("빈 칸·공백 칸은 단어수가 아니다(빈 칸은 채우기 쪽이 맡는다)", () => {
    for (const v of [null, undefined, "", "   "]) expect(looksLikeWordCount(v)).toBe(false);
    expect(cellText("  1240 ")).toBe("1240");
  });

  it("⚠️ 숫자에 글자가 붙으면 안 된다 — 관용을 넓히면 메모가 새어 들어온다", () => {
    for (const v of ["1240개", "1240 단어", "약 1240", "1240?", "1,24 0"]) {
      expect(looksLikeWordCount(v), v).toBe(false);
    }
  });
});

describe("모드 = 날짜가 정한다(호출부가 고르지 않는다)", () => {
  it("오늘·앞날은 갱신, 지난 날은 빈 칸만", () => {
    expect(memorizedFillMode("2026-09-28", "2026-09-28")).toBe("refresh");
    expect(memorizedFillMode("2026-09-30", "2026-09-28")).toBe("refresh");
    expect(memorizedFillMode("2026-09-27", "2026-09-28")).toBe("fill");
  });
});

describe("칸별 처리", () => {
  it("빈 칸은 어느 모드에서도 채운다", () => {
    expect(memorizedCellPlan("", "fill")).toBe("fill");
    expect(memorizedCellPlan(null, "refresh")).toBe("fill");
  });

  it("🔴 메모가 든 칸은 어느 모드에서도 손대지 않는다", () => {
    for (const v of REAL_NOTES) {
      expect(memorizedCellPlan(v, "fill"), v).toBe("keep");
      expect(memorizedCellPlan(v, "refresh"), v).toBe("keep");
    }
  });

  it("숫자 칸은 refresh에서만 갱신한다 — 지난 날(fill)은 그대로 둔다", () => {
    expect(memorizedCellPlan("1240", "refresh")).toBe("refresh");
    expect(memorizedCellPlan("1240", "fill")).toBe("keep");
  });
});
