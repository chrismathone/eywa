import { describe, expect, it } from "vitest";
import { settingsToPeriodsConfig } from "./periods";
import { buildRichCardGroups, type GridSlot } from "./class-grid";

/**
 * 혼합 반(평일+주말)의 주말 블록은 **평일 시작 행부터 순번대로** 얹힌다 — 교시표에 교시가 더 생겨도
 * 흔들리지 않아야 한다(2026-08-14).
 *
 * 🔴 예전 결함: 시프트를 "평일시작 − 주말시작"의 **인덱스 간격**으로 밀었다. 그래서 주말 블록이 평일 표에서
 * 연속 인덱스가 아니게 되면(= 표 중간에 교시가 끼면) 간격이 그대로 벌어져 마지막 슬롯이 표 끝을 넘고,
 * `targetRows[k+shift] ?? row`가 원래 행을 남겨 **그 칸만 딴 줄에 앉았다**. 실측: 영어 교시표에 60분 교시
 * 2개(15:00~16:00·16:00~17:00)를 더하자 고등 주말 3반이 3행 → 4행이 됐다.
 */

const P = (startTime: string, endTime: string, label: string) => ({ label, startTime, endTime });

/** 영어 실제 교시표(EiE 6 + IJW 6). */
const BASE = [
  P("14:20", "15:00", "EiE 1교시"),
  P("15:00", "15:40", "EiE 2교시"),
  P("15:40", "16:20", "EiE 3교시"),
  P("16:20", "17:00", "EiE 4교시"),
  P("17:00", "17:40", "EiE 5교시"),
  P("17:40", "18:20", "EiE 6교시"),
  P("16:20", "17:20", "IJW 1교시"),
  P("17:20", "18:10", "IJW 2교시"),
  P("18:20", "19:20", "IJW 3교시"),
  P("19:20", "20:10", "IJW 4교시"),
  P("20:20", "21:10", "IJW 5교시"),
  P("21:10", "22:00", "IJW 6교시"),
];
/** 중간(15:00·16:00 자리)에 60분 교시가 끼어든 표 — 인덱스 간격이 벌어지는 조건. */
const DENSER = [...BASE, P("15:00", "16:00", ""), P("16:00", "17:00", "")];

const configOf = (weekdayPeriods: ReturnType<typeof P>[]) =>
  settingsToPeriodsConfig({
    weekdayPeriods: [],
    weekendPeriods: [
      P("09:00", "10:00", "1교시"),
      P("10:00", "11:00", "2교시"),
      P("11:00", "12:00", "3교시"),
      P("12:00", "13:00", "4교시"),
      P("13:00", "14:00", "5교시"),
      P("14:00", "15:00", "6교시"),
      P("15:00", "16:00", "7교시"),
      P("16:00", "17:00", "8교시"),
    ],
    subjects: [{ key: "english", weekdayPeriods }],
  });

const slot = (day: string, startTime: string, endTime: string): GridSlot =>
  ({
    classId: "c1",
    className: "고등E_고3 정규",
    subject: "english",
    dayOfWeek: day,
    startTime,
    endTime,
    teacherName: "Charlie",
    classroomName: "본원304",
    slotTeacherLabel: "Charlie",
    slotRoomLabel: "본원304",
    classBgColor: null,
    classTextColor: null,
    students: [],
  }) as unknown as GridSlot;

// 평일 야간 3교시(IJW 4·5·6) + 토요일 3교시(EiE 1·2·3 시각) = 실데이터 '고등E_고3 정규' 모양.
const SLOTS = [
  slot("thu", "19:20", "20:10"),
  slot("thu", "20:20", "21:10"),
  slot("thu", "21:10", "22:00"),
  slot("sat", "14:20", "15:00"),
  slot("sat", "15:00", "15:40"),
  slot("sat", "15:40", "16:20"),
];

describe("혼합 반 주말 블록 얹기(순번 기반)", () => {
  it("토요일 3교시가 평일 야간 3행에 그대로 겹친다(교시표 12행)", () => {
    const card = buildRichCardGroups(SLOTS, configOf(BASE)).flatMap((g) => g.cards)[0]!;
    const orders = [...new Set(Object.keys(card.cells).map((k) => Number(k.split(":")[0])))].sort(
      (a, b) => a - b,
    );
    expect(orders).toHaveLength(3);
    expect(Object.keys(card.cells).filter((k) => k.endsWith(":sat"))).toHaveLength(3);
  });

  it("교시표에 60분 교시 2개가 더 끼어도 행 수가 늘지 않는다(회귀 잠금)", () => {
    const card = buildRichCardGroups(SLOTS, configOf(DENSER)).flatMap((g) => g.cards)[0]!;
    const orders = [...new Set(Object.keys(card.cells).map((k) => Number(k.split(":")[0])))].sort(
      (a, b) => a - b,
    );
    // 3행 그대로 — 예전엔 마지막 토요일 칸이 시프트에 실패해 4행이 됐다.
    expect(orders).toHaveLength(3);
    // 토요일 칸이 전부 평일 야간 행(19:20~)에 얹혔는지 — 이른 시각 행에 남아 있으면 실패.
    const satOrders = Object.keys(card.cells)
      .filter((k) => k.endsWith(":sat"))
      .map((k) => Number(k.split(":")[0]));
    expect(satOrders).toHaveLength(3);
    for (const o of satOrders) expect(o).toBeGreaterThanOrEqual(19 * 60 + 20);
  });
});
