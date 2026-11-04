import { describe, expect, it } from "vitest";
import { classFlagChanges } from "./class-flag-changes";

/** 반 수정 감사로그의 특강·수업보고서 미발송 변경 항목(2026-11-04 사고 — 미발송을 켠 기록이 남지 않았다). */
const input = (p: Partial<Parameters<typeof classFlagChanges>[1]> = {}) => ({
  isSpecialProvided: true,
  isSpecial: false,
  reportOptoutProvided: true,
  reportOptout: false,
  ...p,
});

describe("classFlagChanges — 켜고 끄는 칸의 변경 항목", () => {
  it("미발송을 켜면 '수업보고서 미발송 꺼짐 → 켜짐'", () => {
    expect(classFlagChanges({ is_special: false, report_optout: false }, input({ reportOptout: true }))).toEqual([
      { field: "수업보고서 미발송", from: "꺼짐", to: "켜짐" },
    ]);
  });

  it("미발송을 끄면 '켜짐 → 꺼짐' · 특강도 같은 꼴 · 순서는 특강 → 미발송", () => {
    expect(classFlagChanges({ is_special: false, report_optout: true }, input({ isSpecial: true }))).toEqual([
      { field: "특강", from: "꺼짐", to: "켜짐" },
      { field: "수업보고서 미발송", from: "켜짐", to: "꺼짐" },
    ]);
  });

  it("값이 그대로면 아무것도 적지 않는다", () => {
    expect(classFlagChanges({ is_special: true, report_optout: true }, input({ isSpecial: true, reportOptout: true }))).toEqual([]);
  });

  it("🔴 폼이 그 칸을 안 보냈으면 비교하지 않는다 — 저장도 안 하는 칸을 바뀐 것처럼 적지 않는다", () => {
    expect(
      classFlagChanges(
        { is_special: true, report_optout: true },
        input({ isSpecialProvided: false, reportOptoutProvided: false }),
      ),
    ).toEqual([]);
  });

  it("변경 전 값을 못 읽었으면(before null) 적지 않는다 — 없는 이전값을 지어내지 않는다", () => {
    expect(classFlagChanges(null, input({ reportOptout: true }))).toEqual([]);
  });

  it("이전 값이 비어 있으면(null·칸 없음) 꺼짐으로 본다 — DB 기본값", () => {
    expect(classFlagChanges({ is_special: null }, input({ reportOptout: true }))).toEqual([
      { field: "수업보고서 미발송", from: "꺼짐", to: "켜짐" },
    ]);
  });
});
