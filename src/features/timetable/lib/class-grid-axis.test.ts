import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "./periods";
import { ROSTER_ACTIVE_MIN_ROWS, ROSTER_ROW_CAP, buildRichCardGroups, padCardDays, type GridSlot } from "./class-grid";

/**
 * 통합뷰 카드 요일축 = **그 반이 실제 수업하는 요일만**(원장 지시 2026-08-11 "수업없는 요일 열도 숨겨버리고").
 *
 * 🔴 이건 2026-07-27의 "항상 월~금 5칸"(`buildAxisDays`/`AXIS_COLS`) 규약을 **뒤집은 것**이다. 그때의 근거는
 *    "한 칸 너비가 카드마다 같아야 시트처럼 읽힌다"였는데, 실측(영어 활성 42반)이 **2일 12반·3일 29반·5일 1반** —
 *    거의 모든 카드의 격자 40~60%가 빈 칸이었다. 카드 폭(CARD_W)은 그대로라 남은 칸이 넓어질 뿐이고,
 *    카드 간 **세로** 정렬(시트로 읽히는 성질)은 그대로다.
 * ⚠️ 되살리면 안 되는 회귀는 그대로다(2026-07-23): 평일+토 **혼합 반의 토요일이 증발**하면 안 된다.
 *    이제는 "실제 요일만 그린다"라서 구조적으로 사라질 수가 없다 — 그래도 가드는 남긴다.
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

/** 영어 반 슬롯 — 영어는 평일 교시가 40분 단위 11교시라 "저녁 반 + 토요일" 실데이터를 재현할 수 있다. */
const engSlot = (classId: string, day: string, start: string): GridSlot =>
  ({ ...slot(classId, day, start), subject: "english" }) as GridSlot;

const cardOf = (slots: GridSlot[], classId: string) =>
  buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG)
    .flatMap((g) => g.cards)
    .find((c) => c.classId === classId)!;

describe("카드 요일축 — 빈 요일 열은 그리지 않는다", () => {
  it("2요일 반은 2열, 5요일 반은 5열 — 축이 실제 요일을 그대로 따른다", () => {
    const slots = [
      slot("two", "mon"),
      slot("two", "thu"),
      ...(["mon", "tue", "wed", "thu", "fri"] as const).map((d) => slot("five", d)),
    ];
    expect(cardOf(slots, "two").days).toEqual(["mon", "thu"]);
    expect(cardOf(slots, "five").days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
  });

  it("한 요일뿐인 반도 한 열 — 빈 칸 패딩 없음", () => {
    expect(cardOf([slot("one", "wed")], "one").days).toEqual(["wed"]);
  });

  it("🔴 혼합 반(평일+토)의 토요일이 남아 있다 — 2026-07-23 회귀 방지", () => {
    const mixed = [slot("m1", "wed"), slot("m1", "sat", "12:00")];
    expect(cardOf(mixed, "m1").days).toEqual(["wed", "sat"]);
  });

  it("주말 전용 반은 주말 요일만(평일 라벨 노이즈 없음)", () => {
    const weekendOnly = [slot("w1", "sat", "09:00"), slot("w1", "sun", "09:00")];
    const c = cardOf(weekendOnly, "w1");
    expect(c.weekendOnly).toBe(true);
    expect(c.days).toEqual(["sat", "sun"]);
  });

  it("요일 순서는 항상 월→일(입력 순서와 무관)", () => {
    const shuffled = [slot("s1", "fri"), slot("s1", "tue"), slot("s1", "wed")];
    expect(cardOf(shuffled, "s1").days).toEqual(["tue", "wed", "fri"]);
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

  // 🔴 2026-09-08 뒤집힘(원장 *"재원생이 10명은 기본으로 공간 배정. 통합뷰에서"*): 재원 섹션은 인원이 적어도
  //    **10줄 자리를 잡는다**. 그 위로는 종전대로 그룹 내 최대 인원을 따라가고 상한 12는 그대로다.
  //    ⚠️ 대가: 인원이 적은 반만 모인 줄은 카드가 그만큼 길어진다(2026-07-27 "세로 여백이 너무 많다"의 반대 방향).
  it("재원은 인원이 적어도 10줄을 잡는다(원장 2026-09-08)", () => {
    const rows = rowsOf([
      slotWithStudents("a", "mon", [stu("가", "active"), stu("나", "active")]),
      slotWithStudents("b", "mon", [stu("다", "active")]),
    ]);
    expect(rows.active).toBe(ROSTER_ACTIVE_MIN_ROWS);
  });

  it("10명을 넘으면 그룹 내 최대 인원을 따라간다(고정 10이 아니다)", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => stu(`학생${i}`, "active"));
    const rows = rowsOf([
      slotWithStudents("a", "mon", eleven),
      slotWithStudents("b", "mon", [stu("다", "active")]),
    ]);
    expect(rows.active).toBe(11);
  });

  it("12명을 넘으면 12에서 자른다(넘는 만큼은 카드 안 스크롤 + 페이드)", () => {
    const many = Array.from({ length: 20 }, (_, i) => stu(`학생${i}`, "active"));
    expect(rowsOf([slotWithStudents("a", "mon", many)]).active).toBe(ROSTER_ROW_CAP);
  });

  it("재원이 0명인 반도 '-' 자리를 잡는다(이제 기본 10줄)", () => {
    expect(rowsOf([slotWithStudents("a", "mon", [])]).active).toBe(ROSTER_ACTIVE_MIN_ROWS);
  });

  // 🔴 2026-09-07 뒤집힘(원장 *"대기/퇴원을 항상 보여줄것"*): 예전엔 0명이면 섹션을 통째로 안 그렸는데,
  //    그러면 **누가 퇴원하는 순간 카드가 아래로 밀리고**(줄마다 높이가 달라진다) 학생을 끌어다 놓을
  //    자리도 화면에 없다(통합뷰 명단 드래그). 이제 세 섹션 모두 최소 한 줄("-")을 잡는다.
  it("대기·퇴원은 한 명도 없어도 한 줄은 남긴다 — 자리가 늘 있어야 드롭 대상이 된다", () => {
    const rows = rowsOf([slotWithStudents("a", "mon", [stu("가", "active")])]);
    expect(rows.hold).toBe(1);
    expect(rows.withdrawn).toBe(1);
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
 * 🔴 **혼합 반이 6행을 먹던 실사고**(원장 2026-08-11 "행을 6개가 아닌 3개만 하고 싶다니까?").
 *
 * 실데이터(영어 고등 3반): 평일 수업 19:20·20:20·21:10(= 9·10·11교시) + 토요일 14:20·15:00·15:40.
 * 토요일 시각이 **영어 평일 1·2·3교시와 정확히 같아서** `weekdayPeriodRowOrNull`이 그 슬롯을 평일
 * 1교시 행에 앉히고 시프트 대상에서 뺐고, 게다가 그 슬롯이 평일 앵커 계산에도 섞여 앵커를 1교시로
 * 끌어내렸다 → 한 반이 1·2·3교시 + 9·10·11교시 = **6행**.
 * 이제 주말 블록을 통째로 그 반의 평일 시작(9교시)으로 옮겨 **3행**이 된다.
 */
describe("혼합 반의 주말 수업은 그 반의 평일 교시 행에 겹친다 — 6행 → 3행", () => {
  // 영어 평일 교시표: 1교시 14:20 … 9교시 19:20 · 10교시 20:20 · 11교시 21:10.
  const evening = (id: string) => [
    engSlot(id, "mon", "19:20"), engSlot(id, "tue", "20:20"), engSlot(id, "thu", "21:10"),
    engSlot(id, "sat", "14:20"), engSlot(id, "sat", "15:00"), engSlot(id, "sat", "15:40"),
  ];
  const groupsOf = (slots: GridSlot[]) => buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG);

  it("🔴 3행만 쓴다(9·10·11교시) — 토요일이 1·2·3교시로 따로 앉지 않는다", () => {
    const g = groupsOf(evening("e1"))[0];
    expect(g.periodRows.map((r) => r.label)).toEqual(["9교시", "10교시", "11교시"]);
  });

  it("토요일 열은 그대로 살아 있다 — 겹치는 것이지 버리는 게 아니다(2026-07-23 회귀 방지)", () => {
    const card = groupsOf(evening("e1"))[0].cards[0];
    expect(card.days).toContain("sat");
    const satOrders = Object.keys(card.cells)
      .filter((k) => k.endsWith(":sat"))
      .map((k) => Number(k.split(":")[0]))
      .sort((a, b) => a - b);
    // 토요일 3개 슬롯이 평일 9·10·11교시 행 위에 얹혔다 = 평일 셀과 같은 order 집합.
    const monOrder = Number(
      Object.keys(card.cells).find((k) => k.endsWith(":mon"))!.split(":")[0],
    );
    expect(satOrders).toHaveLength(3);
    expect(satOrders[0]).toBe(monOrder);
  });

  it("이른 평일 반은 그대로 — 옮길 이유가 없으면 안 옮긴다", () => {
    const early = [engSlot("e2", "mon", "14:20"), engSlot("e2", "sat", "14:20")];
    expect(groupsOf(early)[0].periodRows.map((r) => r.label)).toEqual(["1교시"]);
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
    expect(card().days).toContain("sat");
    expect(card().days).toEqual(["wed", "sat"]);
  });

  it("주말 전용 반은 평일 기준이 없어 평일 표로 옮겨가지 않는다(자기 주말 표 안에서만 당겨진다)", () => {
    const weekendOnly = [slot("w1", "sat", "09:00"), slot("w1", "sat", "10:00")];
    const c = cardOf(weekendOnly, "w1");
    expect(c.weekendOnly).toBe(true);
    expect(c.periodRows).toHaveLength(2); // 주말 교시표 그대로(이미 1교시부터라 당길 것도 없다)
    expect(c.periodRows.map((r) => r.label)).toEqual(["1교시", "2교시"]);
  });
});

/**
 * 주말 섹션 = 반마다 시작 시각이 제각각이라 합집합 축이 금세 불어난다(실측 수학 주말전용 3반 =
 * 09~11시 / 14~16시 / 15~16시 → **6행**인데 어느 반도 3교시를 안 넘었다).
 * 원장 2026-08-11: *"주말 수업은 6행이나 차지하게 두지말고, 그냥 3행으로 처리해 보기 편하게 강제로
 * … 평일수업에 맞춰서"* → 카드마다 **자기 1교시부터** 시작하게 당긴다.
 */
describe("주말 전용 반은 1교시부터 시작하게 당긴다 — 섹션 행수 = 가장 긴 반의 교시 수", () => {
  // 09~11시(3교시) / 14~16시(3교시) / 15~16시(2교시) — 주말 표에서 idx 0·1·2 / 5·6·7 / 6·7.
  const weekendOnly = [
    slot("early", "sat", "09:00"), slot("early", "sat", "10:00"), slot("early", "sat", "11:00"),
    slot("late", "sat", "14:00"), slot("late", "sat", "15:00"), slot("late", "sat", "16:00"),
    slot("short", "sun", "15:00"), slot("short", "sun", "16:00"),
  ];
  const section = () =>
    buildRichCardGroups(weekendOnly, DEFAULT_PERIODS_CONFIG).find((g) => g.label === "주말")!;

  it("🔴 합집합이면 6행이던 것이 3행", () => {
    expect(section().periodRows).toHaveLength(3);
  });

  it("행 라벨은 '그 반의 몇 번째 교시' — 시계(9시·10시)로 적으면 14시 반에 거짓말이 된다", () => {
    expect(section().periodRows.map((r) => r.label)).toEqual(["1교시", "2교시", "3교시"]);
  });

  it("늦게 시작하는 반도 1교시 행부터 채운다(2교시짜리는 두 칸)", () => {
    const cells = (id: string) =>
      Object.keys(section().cards.find((c) => c.classId === id)!.cells)
        .map((k) => Number(k.split(":")[0]))
        .sort((a, b) => a - b);
    // 주말 1·2·3교시 order = 자정 기준 분(09:00=540, 10:00=600, 11:00=660).
    expect(cells("early")).toEqual([540, 600, 660]);
    expect(cells("late")).toEqual([540, 600, 660]);
    expect(cells("short")).toEqual([540, 600]);
  });

  it("시각 범위 부제는 안 붙인다 — 같은 행에 09시 반과 14시 반이 함께 앉으므로 범위까지 적으면 거짓이 된다", () => {
    expect(section().periodRows.every((r) => r.time === "")).toBe(true);
  });

  it("🔴 실제 시각은 셀이 들고 간다(정보 손실 0)", () => {
    const late = section().cards.find((c) => c.classId === "late")!;
    const times = Object.values(late.cells).map((c) => c.time);
    expect(times.some((t) => t?.startsWith("14:00~"))).toBe(true);
    expect(times.some((t) => t?.startsWith("16:00~"))).toBe(true);
  });

  it("평일 셀엔 시각을 안 싣는다 — 행 라벨이 곧 사실이라 중복이다", () => {
    const c = cardOf([slot("wd", "mon", "16:20")], "wd");
    expect(Object.values(c.cells)[0].time).toBeUndefined();
  });

  it("평일이 주말보다 이르면 시프트하지 않는다(ijw 조건 동일)", () => {
    // 평일 첫 교시(14:20)가 주말 표에서 이미 늦은 자리 → wdStartIdx <= wkStartIdx → shift 0
    const c = cardOf([slot("x1", "wed", "14:20"), slot("x1", "sat", "20:00")], "x1");
    const satKeys = Object.keys(c.cells).filter((k) => k.endsWith(":sat"));
    expect(satKeys).toHaveLength(1);
  });
});

/**
 * 최소 3열(더미 요일) — **렌더 전용** 규칙(원장 2026-08-13 *"요일이 2개라 열이 2개밖에 없는 수업은
 * 강제로 수요일을 추가해서 열을 3개로 … 수업이 없지만 3개열로 만들기 위해 더미열을 넣는 것"*).
 *
 * ⚠️ 위 describe의 "실제 요일만"과 모순이 아니다 — 카드 데이터(`card.days`)는 그대로 실제 요일이고,
 *    통합뷰 카드 컴포넌트만 이 함수를 거쳐 **빈 칸**을 늘린다(엑셀·시트 내보내기는 안 거친다).
 */
describe("padCardDays — 통합뷰 카드 최소 3열", () => {
  it("2요일 반엔 수요일을 넣어 3열로", () => {
    expect(padCardDays(["mon", "thu"])).toEqual(["mon", "wed", "thu"]);
    expect(padCardDays(["tue", "fri"])).toEqual(["tue", "wed", "fri"]);
  });

  it("이미 수요일이 있으면 다른 요일로 채운다(금→월→화→목)", () => {
    expect(padCardDays(["mon", "wed"])).toEqual(["mon", "wed", "fri"]);
    expect(padCardDays(["wed", "fri"])).toEqual(["mon", "wed", "fri"]);
    expect(padCardDays(["wed", "thu"])).toEqual(["wed", "thu", "fri"]);
  });

  it("3열 이상은 손대지 않는다", () => {
    expect(padCardDays(["mon", "wed", "fri"])).toEqual(["mon", "wed", "fri"]);
    expect(padCardDays(["mon", "tue", "wed", "thu", "fri"])).toHaveLength(5);
  });

  it("한 요일 반도 3열까지 채운다", () => {
    expect(padCardDays(["mon"])).toEqual(["mon", "wed", "fri"]);
  });

  it("🔴 주말 전용 반은 그대로 — 평일 더미를 붙이면 토·일반이 평일 반처럼 읽힌다", () => {
    expect(padCardDays(["sat", "sun"])).toEqual(["sat", "sun"]);
    expect(padCardDays(["sat"])).toEqual(["sat"]);
  });

  it("평일+주말 혼합 반은 평일 쪽으로 채운다(요일 순서는 월~일 유지)", () => {
    expect(padCardDays(["wed", "sat"])).toEqual(["wed", "fri", "sat"]);
  });

  it("빈 배열은 빈 배열(카드가 깨진 상태를 더미로 감추지 않는다)", () => {
    expect(padCardDays([])).toEqual([]);
  });
});
