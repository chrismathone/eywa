import { describe, expect, it } from "vitest";
import { hasLiveEnglishClass, slotLiveOn, viewableClassIds } from "./scope";

const today = "2026-09-10";
const EN = { id: "e1", subject: "english", isActive: true };
const MA = { id: "m1", subject: "math", isActive: true };

describe("slotLiveOn", () => {
  it("오늘을 품는 행만(경계 포함)", () => {
    expect(slotLiveOn({ validFrom: null, validTo: null }, today)).toBe(true);
    expect(slotLiveOn({ validFrom: "2026-03-01", validTo: "2026-08-31" }, today)).toBe(false); // 마감
    expect(slotLiveOn({ validFrom: "2026-09-15", validTo: null }, today)).toBe(false); // 시작 전
    expect(slotLiveOn({ validFrom: "2026-09-10", validTo: "2026-09-10" }, today)).toBe(true);
  });
});

describe("hasLiveEnglishClass", () => {
  it("🔴 봄에 영어에서 수학으로 옮긴 강사 — 마감된 영어 교시만 남으면 아니다(학생 범위엔 남는다)", () => {
    const s = { own: ["m1"], slots: [{ classId: "e1", validFrom: null, validTo: "2026-03-31" }], delegated: [] };
    expect(hasLiveEnglishClass(s, [EN, MA], today)).toBe(false);
    expect(viewableClassIds(s)).toEqual(["m1", "e1"]);
  });

  it("🔴 폐강된 영어 반의 옛 담임은 아니다", () => {
    expect(hasLiveEnglishClass({ own: ["e1"], slots: [], delegated: [] }, [{ ...EN, isActive: false }], today)).toBe(false);
  });

  it("지금 도는 영어 교시·현재 담임·임시 위임은 맞다", () => {
    const live = { own: [], slots: [{ classId: "e1", validFrom: "2026-09-01", validTo: null }], delegated: [] };
    expect(hasLiveEnglishClass(live, [EN], today)).toBe(true);
    expect(hasLiveEnglishClass({ own: ["e1"], slots: [], delegated: [] }, [EN], today)).toBe(true);
    expect(hasLiveEnglishClass({ own: [], slots: [], delegated: ["e1"] }, [EN], today)).toBe(true);
  });

  it("수학만이면 아니다", () => {
    expect(hasLiveEnglishClass({ own: ["m1"], slots: [], delegated: [] }, [MA], today)).toBe(false);
  });
});
