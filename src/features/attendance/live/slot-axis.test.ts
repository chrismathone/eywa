import { describe, expect, it } from "vitest";
import { isPerSlotSubject, PER_SLOT_SUBJECTS, saveSlotFor } from "./slot-axis";

describe("slot-axis — 과목별 저장 축", () => {
  it("영어는 교시별로 남긴다(실측 per-slot 474 / day-level 20)", () => {
    expect(isPerSlotSubject("english")).toBe(true);
    expect(saveSlotFor("english", "16:20")).toBe("16:20");
  });

  it("🔴 수학은 하루 한 행이다 — 교시를 실으면 연강 반의 시수·회차가 2~3배가 된다", () => {
    expect(isPerSlotSubject("math")).toBe(false);
    expect(saveSlotFor("math", "18:20")).toBeNull();
  });

  it("모르는 과목은 안전한 쪽(하루 한 행)으로 — 새 과목이 조용히 시수를 부풀리지 않게", () => {
    expect(saveSlotFor("subject_1", "16:20")).toBeNull();
    expect(saveSlotFor(null, "16:20")).toBeNull();
    expect(saveSlotFor(undefined, "16:20")).toBeNull();
    expect(saveSlotFor("", "16:20")).toBeNull();
  });

  it("목록은 최소로 유지한다 — 늘릴 땐 그 과목의 기존 저장 축을 실측하고 늘릴 것", () => {
    expect([...PER_SLOT_SUBJECTS]).toEqual(["english"]);
  });
});
