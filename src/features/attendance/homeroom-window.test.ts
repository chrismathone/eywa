import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeroomStartsAfter } from "./homeroom-window";

describe("강사 전체 보기 — 그 달이 끝난 뒤에 담임이 된 반은 뺀다(원장 2026-10-06)", () => {
  it("담임 시작일이 그 달 말일보다 뒤면 뺀다 — 10/6부터 담임인 반은 9월 표에 서지 않는다", () => {
    expect(homeroomStartsAfter("2026-10-06", "2026-09-30")).toBe(true);
    expect(homeroomStartsAfter("2026-10-01", "2026-09-30")).toBe(true);
  });

  it("그 달 안(말일 포함)이나 그 전에 담임이 됐으면 그대로 선다", () => {
    expect(homeroomStartsAfter("2026-09-30", "2026-09-30")).toBe(false);
    expect(homeroomStartsAfter("2026-09-14", "2026-09-30")).toBe(false);
    expect(homeroomStartsAfter("2026-08-10", "2026-09-30")).toBe(false);
  });

  it("🔴 근거가 없으면(null) 빼지 않는다 — 모르는 것을 '아직 담임이 아니다'로 읽지 않는다", () => {
    expect(homeroomStartsAfter(null, "2026-09-30")).toBe(false);
    expect(homeroomStartsAfter(undefined, "2026-09-30")).toBe(false);
    expect(homeroomStartsAfter("", "2026-09-30")).toBe(false);
  });

  it("🔴 그 달에 담임이었던 적이 있으면 빼지 않는다 — 맡았다 넘겼다 다시 맡은 사람(A → B → A)", () => {
    expect(homeroomStartsAfter("2026-10-06", "2026-09-30", true)).toBe(false);
    expect(homeroomStartsAfter("2026-10-06", "2026-09-30", false)).toBe(true);
  });

  it("판정은 공용 반 목록 모듈이 부른다 — 화면·명세서가 손으로 다시 적지 않는다(배선)", () => {
    const shared = readFileSync("src/features/attendance/teacher-sheet-classes.ts", "utf8");
    expect(shared).toContain("homeroomStartsAfter(");
    expect(readFileSync("src/app/(shell)/attendance/page.tsx", "utf8")).not.toContain("homeroomStartsAfter(");
  });
});
