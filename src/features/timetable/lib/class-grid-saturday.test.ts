import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "./periods";
import { buildRichCardGroups, type GridSlot } from "./class-grid";

/**
 * 평일+토요일 **혼합 반**이 통합뷰에서 사라지던 결함(2026-07-23 원장 제보).
 * 예전 규약: 평일 섹션의 요일축이 월~금 **고정**이라 토요일 셀은 그려질 자리가 없었다.
 * 실측 4개 반·주말 슬롯 21개가 안 보였고, 그중엔 반 이름이 "고등M 고1 BS4F 토"인 반도 있었다.
 * ijw 통합뷰 규약 = **카드마다 자기 요일축**(finalDays) → 토요일이 있는 반에만 토 열이 붙는다.
 */
function slot(classId: string, className: string, day: string, start: string): GridSlot {
  return {
    id: `${classId}-${day}-${start}`,
    classId,
    className,
    subject: "math",
    dayOfWeek: day,
    startTime: `${start}:00`,
    endTime: "23:00:00",
    teacherName: "이성우",
    classroomName: "301",
    studentCount: 0,
    slotTeacherLabel: "이성우",
    slotRoomLabel: "301",
    classBgColor: null,
    classTextColor: null,
    students: [],
  } as unknown as GridSlot;
}

const build = (slots: GridSlot[]) => buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG);
const cardOf = (slots: GridSlot[], classId: string) =>
  build(slots)
    .flatMap((g) => g.cards)
    .find((c) => c.classId === classId)!;

describe("평일+토요일 혼합 반 (ijw finalDays 규약)", () => {
  const mixed = [slot("m1", "고등M 고1 BS4F 토", "wed", "16:20"), slot("m1", "고등M 고1 BS4F 토", "sat", "12:00")];

  it("혼합 반은 주말 전용이 아니다(평일 섹션에 남는다)", () => {
    const card = cardOf(mixed, "m1");
    expect(card.weekendOnly).toBe(false);
  });

  it("카드 요일축에 토요일이 포함된다", () => {
    expect(cardOf(mixed, "m1").days).toContain("sat");
  });

  it("토요일 셀이 실제로 존재하고, 그 교시 행이 그룹 축에 있다(그려질 자리 확보)", () => {
    const groups = build(mixed);
    const g = groups.find((x) => x.cards.some((c) => c.classId === "m1"))!;
    const satKeys = Object.keys(cardOf(mixed, "m1").cells).filter((k) => k.endsWith(":sat"));
    expect(satKeys.length).toBe(1);
    const satOrder = Number(satKeys[0].split(":")[0]);
    expect(g.periodRows.some((r) => r.order === satOrder)).toBe(true);
  });

  it("토요일이 없는 반의 카드 축엔 토요일이 안 붙는다(빈 열 방지)", () => {
    const withPlain = [...mixed, slot("m2", "평일반", "wed", "16:20")];
    expect(cardOf(withPlain, "m2").days).not.toContain("sat");
    expect(cardOf(withPlain, "m1").days).toContain("sat");
  });

  it("주말 전용 반은 예전처럼 별도 주말 섹션(회귀 없음)", () => {
    const weekendOnly = [slot("w1", "고등M 개별 토", "sat", "12:00")];
    const card = cardOf(weekendOnly, "w1");
    expect(card.weekendOnly).toBe(true);
    expect(card.days).toEqual(["sat"]);
  });

  it("평일 전용 반은 월~금 축 그대로(회귀 없음)", () => {
    const weekdayOnly = [slot("d1", "평일반", "mon", "16:20"), slot("d1", "평일반", "wed", "16:20")];
    const card = cardOf(weekdayOnly, "d1");
    expect(card.days).toEqual(["mon", "wed"]);
    expect(card.days).not.toContain("sat");
  });
});
