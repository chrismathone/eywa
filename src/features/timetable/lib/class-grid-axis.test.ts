import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "./periods";
import { AXIS_COLS, buildAxisDays, buildRichCardGroups, type GridSlot } from "./class-grid";

/**
 * 통합뷰 카드 요일축 = **월~금 5칸 고정**(원장 지시 2026-07-27).
 * 예전엔 실제 수업 요일만 열로 그려서 2요일 반은 한 칸 88px·5요일 반은 35px로 카드마다 열 너비가 달랐다.
 * ⚠️ 동시에 2026-07-23 회귀(평일+토 혼합 반의 토요일 증발)를 되살리면 안 된다 —
 *    ijw 영어 규약대로 주말 요일이 "그 반이 안 쓰는 평일" 칸을 대체하므로 열 수는 5, 토 열은 생긴다.
 */
function slot(classId: string, day: string, start = "16:20"): GridSlot {
  return {
    id: `${classId}-${day}-${start}`,
    classId,
    className: classId,
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

const cardOf = (slots: GridSlot[], classId: string) =>
  buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG)
    .flatMap((g) => g.cards)
    .find((c) => c.classId === classId)!;

describe("buildAxisDays — 5칸 고정 요일축", () => {
  it("평일 반은 실제 요일 수와 무관하게 항상 월~금 5칸", () => {
    expect(buildAxisDays(["mon", "thu"], false)).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(buildAxisDays(["wed"], false)).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(buildAxisDays(["mon", "tue", "wed", "thu", "fri"], false)).toEqual([
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
    ]);
  });

  it("요일 수가 1개든 5개든 열 수는 늘 같다(= 한 칸 너비 불변)", () => {
    for (const days of [["mon"], ["mon", "thu"], ["tue", "wed", "fri"], ["mon", "tue", "wed", "thu", "fri"]]) {
      expect(buildAxisDays(days as never, false)).toHaveLength(AXIS_COLS);
    }
  });

  it("토요일은 '그 반이 안 쓰는 평일' 칸을 대체한다 — 열 수 5 유지, 토 열은 생김", () => {
    // 수·토 반: 월이 비어 있으므로 월 칸을 토가 가져간다 → 정렬 후 화수목금토
    const axis = buildAxisDays(["wed", "sat"], false);
    expect(axis).toHaveLength(AXIS_COLS);
    expect(axis).toContain("sat");
    expect(axis).toEqual(["tue", "wed", "thu", "fri", "sat"]);
  });

  it("평일을 꽉 채운 반의 토요일은 금요일 칸을 대체한다(ijw 폴백)", () => {
    const axis = buildAxisDays(["mon", "tue", "wed", "thu", "fri", "sat"], false);
    expect(axis).toHaveLength(AXIS_COLS);
    expect(axis).toEqual(["mon", "tue", "wed", "thu", "sat"]);
  });

  it("주말 전용 반은 평일 라벨 없이 주말 요일 + 빈 칸 패딩(열 수는 그대로 5)", () => {
    expect(buildAxisDays(["sat"], true)).toEqual(["sat", null, null, null, null]);
    expect(buildAxisDays(["sat", "sun"], true)).toEqual(["sat", "sun", null, null, null]);
  });
});

describe("buildRichCardGroups — 카드에 axisDays가 실린다", () => {
  it("2요일 반과 5요일 반의 축 길이가 같다", () => {
    const slots = [
      slot("two", "mon"),
      slot("two", "thu"),
      ...(["mon", "tue", "wed", "thu", "fri"] as const).map((d) => slot("five", d)),
    ];
    expect(cardOf(slots, "two").axisDays).toHaveLength(AXIS_COLS);
    expect(cardOf(slots, "five").axisDays).toHaveLength(AXIS_COLS);
  });

  it("혼합 반(평일+토)의 축에 토요일이 남아 있다 — 2026-07-23 회귀 방지", () => {
    const mixed = [slot("m1", "wed"), slot("m1", "sat", "12:00")];
    expect(cardOf(mixed, "m1").axisDays).toContain("sat");
  });

  it("`days`(실제 수업 요일)는 그대로 — 축과 사실을 분리해 둔다", () => {
    const mixed = [slot("m1", "wed"), slot("m1", "sat", "12:00")];
    expect(cardOf(mixed, "m1").days).toEqual(["wed", "sat"]);
  });
});
