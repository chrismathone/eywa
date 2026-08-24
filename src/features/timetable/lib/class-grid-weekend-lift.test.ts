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

/**
 * 🔴 **주말 슬롯의 순번은 그 카드 전체에서 한 번만 매긴다**(2026-08-24 원장 제보:
 * *"위쪽은 15:00~16:00, 2번째껀 14:00~15:00. 1시에서 4시인데 13:00~14:00도 없고 순서도 이상한데?"*).
 *
 * 예전엔 주말 슬롯을 **어느 교시표에서 행을 찾았는지**로 두 바구니(평일표에 있음 / 주말표에서 찾음)에
 * 나눠 **각각 0부터** 순번을 매겼다. 한 반의 주말 블록이 두 표에 걸치면 두 순번이 0에서 겹쳐 같은
 * `cells["<order>:sat"]` 키를 덮어써 **한 칸이 증발하고 순서가 뒤집혔다**.
 *
 * 실데이터: `고등E_고2 심화`(토 13:00·14:00·15:00) — 영어 평일 교시표에 15:00~16:00이 **실재**해서
 * 15:00만 평일표 바구니로 빠졌다. 같은 화면의 `고등E_고3 정규`(토 10·11·12시)는 평일표에 하나도 없어
 * 한 바구니라 멀쩡했다 — 그래서 **두 반이 갈렸다**.
 */
describe("주말 순번은 한 벌 — 교시표가 갈려도 칸이 안 겹친다", () => {
  /** 평일 야간 3교시(IJW 4·5·6)는 고정. 주말 시각만 바꿔 세 사례를 재현한다. */
  const evening = [
    slot("wed", "19:20", "20:10"),
    slot("wed", "20:20", "21:10"),
    slot("wed", "21:10", "22:00"),
  ];
  /** 토요일 셀을 **행 순서대로** 세운 실제 시각(GridCell.time = 툴팁의 진실원본). */
  const satTimesByRow = (slots: GridSlot[], config: ReturnType<typeof configOf>) => {
    const card = buildRichCardGroups(slots, config).flatMap((g) => g.cards)[0]!;
    return Object.entries(card.cells)
      .filter(([k]) => k.endsWith(":sat"))
      .sort((a, b) => Number(a[0].split(":")[0]) - Number(b[0].split(":")[0]))
      .map(([, c]) => c.time);
  };

  it("🔴 두 표에 걸친 주말 블록도 세 칸이 다 살아 있고 시각 순서대로 앉는다(13→14→15)", () => {
    // 토 13:00·14:00은 주말표에만, 15:00~16:00은 **평일표에도** 있다(DENSER) = 실사고 조건.
    const sat = [slot("sat", "13:00", "14:00"), slot("sat", "14:00", "15:00"), slot("sat", "15:00", "16:00")];
    expect(satTimesByRow([...evening, ...sat], configOf(DENSER))).toEqual([
      "13:00~14:00",
      "14:00~15:00",
      "15:00~16:00",
    ]);
  });

  it("슬롯이 어떤 순서로 와도 같은 결과 — 덮어쓰기가 입력 순서에 좌우되지 않는다", () => {
    const shuffled = [
      slot("sat", "15:00", "16:00"),
      slot("wed", "20:20", "21:10"),
      slot("sat", "13:00", "14:00"),
      slot("wed", "21:10", "22:00"),
      slot("sat", "14:00", "15:00"),
      slot("wed", "19:20", "20:10"),
    ];
    expect(satTimesByRow(shuffled, configOf(DENSER))).toEqual([
      "13:00~14:00",
      "14:00~15:00",
      "15:00~16:00",
    ]);
  });

  it("정상이던 '고3 정규형'(토 10·11·12시, 평일표에 없음)은 종전 그대로", () => {
    const sat = [slot("sat", "10:00", "11:00"), slot("sat", "11:00", "12:00"), slot("sat", "12:00", "13:00")];
    expect(satTimesByRow([...evening, ...sat], configOf(DENSER))).toEqual([
      "10:00~11:00",
      "11:00~12:00",
      "12:00~13:00",
    ]);
  });

  it("전부 평일표에 있던 '영어 고등 3반'(토 14:20·15:00·15:40)도 종전 그대로 — 한 반 3행", () => {
    const card = buildRichCardGroups(SLOTS, configOf(BASE)).flatMap((g) => g.cards)[0]!;
    const rows = [...new Set(Object.keys(card.cells).map((k) => Number(k.split(":")[0])))];
    expect(rows).toHaveLength(3);
    expect(satTimesByRow(SLOTS, configOf(BASE))).toEqual(["14:20~15:00", "15:00~15:40", "15:40~16:20"]);
  });

  it("두 표에 걸쳐도 행 수는 그 반의 교시 수 그대로(3행) — 주말 때문에 행이 안 늘어난다", () => {
    const sat = [slot("sat", "13:00", "14:00"), slot("sat", "14:00", "15:00"), slot("sat", "15:00", "16:00")];
    const card = buildRichCardGroups([...evening, ...sat], configOf(DENSER)).flatMap((g) => g.cards)[0]!;
    const rows = [...new Set(Object.keys(card.cells).map((k) => Number(k.split(":")[0])))];
    expect(rows).toHaveLength(3);
    // 전부 평일 야간 행(19:20~) 위에 얹혔다 — 이른 시각 행에 남으면 카드가 두 덩어리로 갈린다.
    for (const o of rows) expect(o).toBeGreaterThanOrEqual(19 * 60 + 20);
  });

  it("주말 전용 반은 이 변경과 무관 — 자기 1교시부터 그대로 당겨진다(weekendSelfShift 불변)", () => {
    const weekendOnly = [
      slot("sat", "13:00", "14:00"),
      slot("sat", "14:00", "15:00"),
      slot("sat", "15:00", "16:00"),
    ];
    const g = buildRichCardGroups(weekendOnly, configOf(DENSER)).find((x) => x.label === "주말")!;
    // 주말 교시표 1·2·3교시(09·10·11시) 자리로 당겨지고, 실제 시각은 셀이 들고 간다.
    expect(g.periodRows).toHaveLength(3);
    expect(satTimesByRow(weekendOnly, configOf(DENSER))).toEqual([
      "13:00~14:00",
      "14:00~15:00",
      "15:00~16:00",
    ]);
  });

  it("같은 시각이 토·일에 다 있어도 서로 안 덮는다(셀 키는 요일까지 포함)", () => {
    const both = [
      ...evening,
      slot("sat", "13:00", "14:00"),
      slot("sat", "15:00", "16:00"),
      slot("sun", "13:00", "14:00"),
      slot("sun", "15:00", "16:00"),
    ];
    const card = buildRichCardGroups(both, configOf(DENSER)).flatMap((g) => g.cards)[0]!;
    expect(Object.keys(card.cells).filter((k) => k.endsWith(":sat"))).toHaveLength(2);
    expect(Object.keys(card.cells).filter((k) => k.endsWith(":sun"))).toHaveLength(2);
    expect(satTimesByRow(both, configOf(DENSER))).toEqual(["13:00~14:00", "15:00~16:00"]);
  });
});
