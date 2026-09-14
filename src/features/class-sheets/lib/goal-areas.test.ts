import { describe, expect, it } from "vitest";
import { DEFAULT_ENGLISH_SKILL_AREAS } from "@/features/owner/skill-areas";
import { goalAreasFor, isGoalAreaAllowed } from "./goal-areas";
import { MP_BASE_COLUMNS, MP_COLUMN_LABEL } from "./month-plan";

/**
 * 왼쪽 계획 표 행 — 원장 2026-09-14 *"EiE 왼쪽 월간 계획은 달력입력란에 맞게 메뉴 변경. 인재원영어와 구분."*
 */
describe("goalAreasFor — EiE만 달력 칸 이름, 나머지는 설정 영역 그대로", () => {
  const areas = [...DEFAULT_ENGLISH_SKILL_AREAS];

  it("EiE = In-class · Homework · Test (e-book 없음, 달력 열 순서)", () => {
    const rows = goalAreasFor("eie", areas);
    expect(rows.map((r) => r.key)).toEqual(["in_class", "homework", "test"]);
    expect(rows.map((r) => r.label)).toEqual(["In-class", "Homework", "Test"]);
    expect(rows.some((r) => r.key === "ebook")).toBe(false);
  });

  it("EiE 행은 MP 열 정의에서 파생된다(값을 다시 적지 않는다)", () => {
    const rows = goalAreasFor("eie", areas);
    expect(rows.map((r) => r.key)).toEqual([...MP_BASE_COLUMNS]);
    expect(rows.map((r) => r.label)).toEqual(MP_BASE_COLUMNS.map((k) => MP_COLUMN_LABEL[k]));
  });

  it("EiE 행은 영역 색을 빌리지 않는다(무채색)", () => {
    expect(goalAreasFor("eie", areas).every((r) => r.color === "neutral")).toBe(true);
  });

  it("인재원 영어·미분류는 받은 영역 그대로(6영역)", () => {
    expect(goalAreasFor("injaewon", areas)).toEqual(areas);
    expect(goalAreasFor(null, areas)).toEqual(areas);
  });

  it("학원이 영역을 바꿔도 인재원 쪽은 설정을 따르고, EiE는 영향받지 않는다", () => {
    const custom = [{ key: "phonics", label: "파닉스" }];
    expect(goalAreasFor("injaewon", custom)).toEqual(custom);
    expect(goalAreasFor("eie", custom).map((r) => r.key)).toEqual(["in_class", "homework", "test"]);
  });

  it("받은 배열을 그대로 돌려주지 않는다(호출부가 고쳐도 원본이 안 바뀐다)", () => {
    expect(goalAreasFor("injaewon", areas)).not.toBe(areas);
  });
});

describe("isGoalAreaAllowed — 저장 허용 목록 = 화면 행", () => {
  const areas = [...DEFAULT_ENGLISH_SKILL_AREAS];

  it("EiE 반엔 달력 칸 키만, 6영역 키는 거절", () => {
    expect(isGoalAreaAllowed("eie", areas, "in_class")).toBe(true);
    expect(isGoalAreaAllowed("eie", areas, "test")).toBe(true);
    expect(isGoalAreaAllowed("eie", areas, "vocab")).toBe(false);
    expect(isGoalAreaAllowed("eie", areas, "ebook")).toBe(false);
  });

  it("인재원 영어·미분류 반엔 6영역 키만, 달력 칸 키는 거절", () => {
    expect(isGoalAreaAllowed("injaewon", areas, "vocab")).toBe(true);
    expect(isGoalAreaAllowed(null, areas, "speaking")).toBe(true);
    expect(isGoalAreaAllowed("injaewon", areas, "in_class")).toBe(false);
    expect(isGoalAreaAllowed(null, areas, "homework")).toBe(false);
  });
});
