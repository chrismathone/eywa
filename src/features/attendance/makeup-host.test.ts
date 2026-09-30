import { describe, expect, it } from "vitest";
import { defaultHostClassId, hostChoicesFor, isClassOpenOn, orderHostClasses } from "./makeup-host";

const a = { classId: "a", className: "나반", subject: "math", enrolled: false };
const b = { classId: "b", className: "가반", subject: "math", enrolled: false };
const own = { classId: "own", className: "다반", subject: "math", enrolled: true };

describe("보강 기록 수업 — 순서·기본값(원장 2026-09-21)", () => {
  it("학생이 다니는 반이 맨 앞, 나머지는 이름순", () => {
    expect(orderHostClasses([a, b, own]).map((o) => o.classId)).toEqual(["own", "b", "a"]);
  });
  it("반 필터(앵커)가 선택지에 있으면 그 반 — 종전 동작 그대로", () => {
    expect(defaultHostClassId([own, a], "a")).toBe("a");
  });
  it("앵커가 없거나 선택지 밖이면 다니는 반이 하나일 때만 그 반", () => {
    expect(defaultHostClassId([own, a], null)).toBe("own");
    expect(defaultHostClassId([own, a], "elsewhere")).toBe("own");
  });
  it("🔴 창에 세우는 반은 학생이 다니는 반만 — 오늘 정규 행이 있는 반도 뺀다(원장 2026-09-21 '해당 학생의 소속 수업만 띄워')", () => {
    const own2 = { classId: "own2", className: "라반", subject: "math", enrolled: true };
    expect(hostChoicesFor([own, a, b, own2], []).map((o) => o.classId)).toEqual(["own", "own2"]);
    expect(hostChoicesFor([own, a, own2], ["own"]).map((o) => o.classId)).toEqual(["own2"]);
    expect(hostChoicesFor([a, b], [])).toEqual([]);
  });
  it("추측하지 않는다 — 다니는 반이 없거나 둘 이상이면 null(강사가 고른다)", () => {
    expect(defaultHostClassId([a, b], null)).toBeNull();
    expect(defaultHostClassId([own, { ...a, enrolled: true }], null)).toBeNull();
    expect(defaultHostClassId([], null)).toBeNull();
  });
});

describe("isClassOpenOn — 보강 기록 수업에서 종강 반 제외(원장 2026-09-30)", () => {
  it("종강일이 없거나 그날 이후면 후보, 지났으면 아니다(종강일 당일은 아직 운영)", () => {
    expect(isClassOpenOn(null, "2026-09-30")).toBe(true);
    expect(isClassOpenOn("2026-09-30", "2026-09-30")).toBe(true);
    expect(isClassOpenOn("2026-09-29", "2026-09-30")).toBe(false);
  });
});
