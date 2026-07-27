import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "./periods";
import {
  AXIS_COLS,
  ROSTER_ROW_CAP,
  buildAxisDays,
  buildRichCardGroups,
  type GridSlot,
} from "./class-grid";

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

/**
 * 명단 섹션 높이 = 그룹 내 최대 인원(상한 `ROSTER_ROW_CAP`) — 원장 2026-07-27 "세로 여백이 너무 많다",
 * "최대 12명 학생이 보이도록, 그것보다 넘치면 스크롤이 안 보이는 스크롤처리(페이드아웃)".
 * 예전엔 12/3/5 고정이라 실측 재원 최대가 9명(수학)·11명(영어)인데도 카드마다 20행을 잡았다.
 */
function slotWithStudents(classId: string, day: string, students: GridSlot["students"]): GridSlot {
  return { ...slot(classId, day), students } as GridSlot;
}
const stu = (name: string, status: "active" | "hold" | "withdrawn") =>
  ({ name, grade: "초6", school: "칠성초", status }) as GridSlot["students"][number];

describe("rosterRows — 명단 섹션 행수", () => {
  const rowsOf = (slots: GridSlot[]) => buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG)[0].rosterRows;

  it("그룹 내 최대 인원으로 맞춘다(고정 12행 아님)", () => {
    const rows = rowsOf([
      slotWithStudents("a", "mon", [stu("가", "active"), stu("나", "active")]),
      slotWithStudents("b", "mon", [stu("다", "active")]),
    ]);
    expect(rows.active).toBe(2); // max(2,1) — 고정 12가 아니다
  });

  it("12명을 넘으면 12에서 자른다(넘는 만큼은 카드 안 스크롤 + 페이드)", () => {
    const many = Array.from({ length: 20 }, (_, i) => stu(`학생${i}`, "active"));
    expect(rowsOf([slotWithStudents("a", "mon", many)]).active).toBe(ROSTER_ROW_CAP);
  });

  it("재원이 0명인 반도 한 줄은 남긴다('-' 표시 자리)", () => {
    expect(rowsOf([slotWithStudents("a", "mon", [])]).active).toBe(1);
  });

  it("🔴 대기·퇴원은 그룹에 한 명도 없으면 0 — 섹션을 통째로 안 그린다(빈 여백 제거의 핵심)", () => {
    const rows = rowsOf([slotWithStudents("a", "mon", [stu("가", "active")])]);
    expect(rows.hold).toBe(0);
    expect(rows.withdrawn).toBe(0);
  });

  it("한 명이라도 있으면 그 최대치만큼만 잡는다", () => {
    const rows = rowsOf([
      slotWithStudents("a", "mon", [stu("가", "active"), stu("나", "hold"), stu("다", "withdrawn")]),
      slotWithStudents("b", "mon", [stu("라", "withdrawn"), stu("마", "withdrawn")]),
    ]);
    expect(rows.hold).toBe(1);
    expect(rows.withdrawn).toBe(2); // 카드 b가 2명 → 섹션 전체가 2행(카드 간 정렬 유지)
  });
});

/**
 * 평일+토 혼합 반의 토요일 표현 = ijw `weekendShift` — 주말 교시를 **평일 교시 행으로 끌어올려** 행을 공유한다.
 * 예전엔 주말 order를 축에 **행으로 추가**해서 같은 섹션의 모든 카드가 세로로 늘어났다(원장 2026-07-27 지적:
 * "토요일을 있는 그대로 표현하지 않고 ijw-calander에서 표현하는 방법이 있었을 것").
 */
describe("weekendShift — 혼합 반 토요일은 평일 교시 행에 얹는다", () => {
  // 영어: 평일 교시표 14:20부터, 주말 교시표 09:00부터 → 평일이 훨씬 늦게 시작 = 시프트 발생.
  const mixed = [slot("m1", "wed", "16:20"), slot("m1", "sat", "09:00")];
  const card = () => cardOf(mixed, "m1");

  it("주말 셀이 평일 교시 행 위에 놓인다(주말 전용 행이 안 생긴다)", () => {
    const c = card();
    const satOrders = Object.keys(c.cells).filter((k) => k.endsWith(":sat")).map((k) => Number(k.split(":")[0]));
    const wedOrders = Object.keys(c.cells).filter((k) => k.endsWith(":wed")).map((k) => Number(k.split(":")[0]));
    expect(satOrders).toHaveLength(1);
    // 토요일 셀의 order가 평일 교시표 안의 값이어야 한다(= 평일 행을 공유).
    expect(c.periodRows.some((r) => r.order === satOrders[0])).toBe(true);
    // 이 반은 평일·주말 각각 첫 교시뿐이라 같은 행을 공유한다.
    expect(satOrders[0]).toBe(wedOrders[0]);
  });

  it("교시 행이 늘어나지 않는다 — 주말 때문에 생기던 추가 행이 없다", () => {
    expect(card().periodRows).toHaveLength(1);
  });

  it("토요일 열은 그대로 유지된다(2026-07-23 회귀 방지 — 시프트는 '행'만 바꾼다)", () => {
    expect(card().axisDays).toContain("sat");
    expect(card().days).toEqual(["wed", "sat"]);
  });

  it("주말 전용 반은 시프트 대상이 아니다(평일이 없어 기준이 없다)", () => {
    const weekendOnly = [slot("w1", "sat", "09:00"), slot("w1", "sat", "10:00")];
    const c = cardOf(weekendOnly, "w1");
    expect(c.weekendOnly).toBe(true);
    expect(c.periodRows).toHaveLength(2); // 주말 교시표 그대로
  });

  it("평일이 주말보다 이르면 시프트하지 않는다(ijw 조건 동일)", () => {
    // 평일 첫 교시(14:20)가 주말 표에서 이미 늦은 자리 → wdStartIdx <= wkStartIdx → shift 0
    const c = cardOf([slot("x1", "wed", "14:20"), slot("x1", "sat", "20:00")], "x1");
    const satKeys = Object.keys(c.cells).filter((k) => k.endsWith(":sat"));
    expect(satKeys).toHaveLength(1);
  });
});
