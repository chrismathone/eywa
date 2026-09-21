import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/date-kst";
import { hasClassOnDate, monthOfWeek, readFromWeek, weekForMonth, type FaceWeek } from "./face-nav";

/** 그 주 월~일 7일. 날짜 산술은 이미 검증된 `addDays`로 — 손으로 짜면 테스트가 거짓말을 한다. */
const weekOf = (monday: string): FaceWeek => ({
  monday,
  dates: Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
});

describe("monthOfWeek — 그 주가 속한 달", () => {
  it("🔴 달을 걸친 주는 **목요일**이 있는 달이다 (2026-08-31 주 = 9월)", () => {
    // 8/31(월)·9/1~9/6 — 7일 중 5일이 9월. 월요일만 보면 8월이 열려 '오늘'이 없는 화면이 된다.
    expect(monthOfWeek("2026-08-31")).toBe("2026-09");
  });

  it("달 안에 온전히 든 주는 그 달", () => {
    expect(monthOfWeek("2026-08-24")).toBe("2026-08");
    expect(monthOfWeek("2026-09-07")).toBe("2026-09");
  });

  it("반대 방향으로 걸친 주도 다수 쪽 (2026-11-30 주 = 12월)", () => {
    // 11/30(월) + 12/1~12/6 = 6일이 12월.
    expect(monthOfWeek("2026-11-30")).toBe("2026-12");
  });

  it("⚠️ 주 안의 아무 날짜를 줘도 답이 같다 — 주소로 오는 값은 월요일이라는 보장이 없다", () => {
    // 2026-08-01(토)은 7/27 주에 속한다. 월요일로 안 맞추고 +3하면 8월이라고 답한다.
    expect(monthOfWeek("2026-08-01")).toBe("2026-07");
    for (const d of ["2026-08-31", "2026-09-01", "2026-09-04", "2026-09-06"]) {
      expect(monthOfWeek(d)).toBe("2026-09");
    }
  });

  it("딱 절반씩 걸치면 뒤쪽 달 — 목~일 4일이 이긴다", () => {
    // 2026-06-29(월)~30(화) 6월 2일 · 7/1~7/5 5일.
    expect(monthOfWeek("2026-06-29")).toBe("2026-07");
  });
});

describe("weekForMonth — 월간에서 '주간'을 누르면 어느 주로", () => {
  const sept = [weekOf("2026-08-31"), weekOf("2026-09-07"), weekOf("2026-09-14")];
  const hasAll = () => true;

  it("🔴 ① 왔던 주가 있으면 그 주 — 왕복이 제자리로 돌아온다", () => {
    expect(
      weekForMonth({ month: "2026-09", today: "2026-09-01", fromWeek: "2026-08-31", weeks: sept, hasClassOn: hasAll }),
    ).toBe("2026-08-31");
  });

  it("🔴 ① 왔던 주가 **오늘 주보다 우선**한다 (9/20에 9/7 주를 보다 왔으면 9/7로 돌아간다)", () => {
    expect(
      weekForMonth({ month: "2026-09", today: "2026-09-20", fromWeek: "2026-09-07", weeks: sept, hasClassOn: hasAll }),
    ).toBe("2026-09-07");
  });

  it("① 남의 달 주소는 버린다 — 달을 옮긴 뒤엔 왔던 주가 이 달의 주가 아니다", () => {
    expect(
      weekForMonth({ month: "2026-09", today: "2026-09-01", fromWeek: "2026-07-06", weeks: sept, hasClassOn: hasAll }),
    ).toBe("2026-08-31"); // ② 오늘 주로
  });

  it("② 이번 달이면 오늘 주", () => {
    expect(
      weekForMonth({ month: "2026-09", today: "2026-09-20", fromWeek: null, weeks: sept, hasClassOn: hasAll }),
    ).toBe("2026-09-14");
  });

  it("③ 다른 달이면 **수업이 있는 첫 주** — 빈 첫 주로 보내지 않는다", () => {
    // 8월: 1일이 토요일이라 7/27 주엔 수업이 없다고 하자.
    const aug = [weekOf("2026-07-27"), weekOf("2026-08-03"), weekOf("2026-08-10")];
    const hasClassOn = (d: string) => d >= "2026-08-03";
    expect(weekForMonth({ month: "2026-08", today: "2026-09-01", fromWeek: null, weeks: aug, hasClassOn })).toBe(
      "2026-08-03",
    );
  });

  it("🔴 ④ 그 달에 수업이 0건이어도 **그 달 첫 주**로 — 이번 주로 튀지 않는다", () => {
    const aug = [weekOf("2026-07-27"), weekOf("2026-08-03")];
    expect(
      weekForMonth({ month: "2026-08", today: "2026-09-01", fromWeek: null, weeks: aug, hasClassOn: () => false }),
    ).toBe("2026-07-27");
  });

  it("주 자체가 없을 때만 null(호출부가 반 목록으로 떨어뜨린다)", () => {
    expect(
      weekForMonth({ month: "2026-08", today: "2026-09-01", fromWeek: null, weeks: [], hasClassOn: () => false }),
    ).toBeNull();
  });

  it("🔴 왕복이 닫힌다 — 주간(8/31) → 월간 → 주간이 8/31로 돌아온다", () => {
    const monday = "2026-08-31";
    const month = monthOfWeek(monday);
    expect(month).toBe("2026-09");
    expect(weekForMonth({ month, today: "2026-09-01", fromWeek: monday, weeks: sept, hasClassOn: hasAll })).toBe(monday);
  });
});

describe("hasClassOnDate — 달력이 그리는 주 == '주간'이 가는 주", () => {
  it("판정이 한 벌이라 두 화면이 갈리지 않는다", () => {
    const slotsByDate = { "2026-09-03": [{}, {}], "2026-09-04": [] };
    expect(hasClassOnDate(slotsByDate, "2026-09-03")).toBe(true);
    // 빈 배열도, 아예 없는 날도 "수업 없음" — 한쪽만 고치면 달력이 안 그리는 주로 '주간'이 보낸다.
    expect(hasClassOnDate(slotsByDate, "2026-09-04")).toBe(false);
    expect(hasClassOnDate(slotsByDate, "2026-09-05")).toBe(false);
  });
});

describe("readFromWeek — 주소가 들고 온 '왔던 주'", () => {
  it("모양이 맞으면 통과", () => {
    expect(readFromWeek("2026-08-31")).toBe("2026-08-31");
  });
  it("모양이 아니면 버린다(손으로 고친 주소가 화면을 깨지 않게)", () => {
    for (const bad of ["2026-8-31", "오늘", "", null, undefined, 20260831, ["2026-08-31"]]) {
      expect(readFromWeek(bad)).toBeNull();
    }
  });
});

describe("weekForMonth — 세션 창(range)은 달이 아니라 창으로 본다", () => {
  // 10월 세션 = 10/1~11/2(실데이터). 11/2는 달력으로 11월이지만 이 창 안이다.
  const weeks = [
    { monday: "2026-09-28", dates: ["2026-10-01", "2026-10-02"] },
    { monday: "2026-10-05", dates: ["2026-10-05"] },
    { monday: "2026-11-02", dates: ["2026-11-02"] },
  ];
  const range = { start: "2026-10-01", end: "2026-11-02" };
  const hasAll = () => true;

  it("오늘이 창 안이면 오늘 주 — 달이 달라도(11/2)", () => {
    expect(weekForMonth({ month: "2026-10", today: "2026-11-02", fromWeek: null, weeks, hasClassOn: hasAll, range })).toBe(
      "2026-11-02",
    );
  });

  it("왔던 주가 창의 주 목록에 있으면 그 주", () => {
    expect(
      weekForMonth({ month: "2026-10", today: "2026-12-01", fromWeek: "2026-09-28", weeks, hasClassOn: hasAll, range }),
    ).toBe("2026-09-28");
  });

  it("오늘이 창 밖이면 수업 있는 첫 주", () => {
    expect(weekForMonth({ month: "2026-10", today: "2026-11-03", fromWeek: null, weeks, hasClassOn: hasAll, range })).toBe(
      "2026-09-28",
    );
  });
});
