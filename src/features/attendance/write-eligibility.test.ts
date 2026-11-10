import { describe, expect, it } from "vitest";
import { blockedByCorrectOnly, writeEligibility, type WriteEligibilityFacts } from "./write-eligibility";

const none: WriteEligibilityFacts = { enrolled: false, reserved: false, splitInto: false, native: false, hasRecord: false };

describe("출결 쓰기 학생 자격 — 단건·일괄·범위 한 벌(결정 #5)", () => {
  it.each([
    ["수강생", { enrolled: true }, "create"],
    ["보강 예약", { reserved: true }, "create"],
    ["수업 나누기로 들어옴", { splitInto: true }, "create"],
    ["native 보강 참여", { native: true }, "create"],
    ["기존 기록만", { hasRecord: true }, "correct"],
    ["수강생 + 기존 기록", { enrolled: true, hasRecord: true }, "create"],
    ["근거 없음", {}, "none"],
  ] as const)("%s → %s", (_name, facts, expected) => {
    expect(writeEligibility({ ...none, ...facts })).toBe(expected);
  });

  it("정정만 허가된 칸은 새 행을 넣으려 하면 막는다 — 있는 행을 고치는 것만", () => {
    expect(blockedByCorrectOnly("correct", true)).toBe(true);
    expect(blockedByCorrectOnly("correct", false)).toBe(false);
    expect(blockedByCorrectOnly("create", true)).toBe(false);
  });
});
