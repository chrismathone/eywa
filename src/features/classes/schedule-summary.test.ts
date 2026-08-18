import { describe, expect, it } from "vitest";
import {
  formatDays,
  formatMinutes,
  formatRow,
  mergeTimeRanges,
  slotMinutes,
  slotPhase,
  summarizeSchedule,
  type SummarySlot,
} from "./schedule-summary";

const TODAY = "2026-07-30";

const slot = (
  dayOfWeek: string,
  startTime: string,
  endTime: string,
  validFrom: string | null = "2026-03-01",
  validTo: string | null = null,
): SummarySlot => ({ dayOfWeek, startTime, endTime, validFrom, validTo });

describe("slotPhase", () => {
  it("종료일이 지나면 past", () => {
    expect(slotPhase(slot("mon", "16:20", "17:00", "2026-03-01", "2026-07-02"), TODAY)).toBe("past");
  });

  it("종료일 경계는 포함 — 오늘이 종료일이면 아직 current", () => {
    expect(slotPhase(slot("mon", "16:20", "17:00", "2026-03-01", TODAY), TODAY)).toBe("current");
  });

  it("시작일이 미래면 upcoming", () => {
    expect(slotPhase(slot("mon", "11:00", "12:00", "2026-08-18"), TODAY)).toBe("upcoming");
  });

  it("시작일이 오늘이면 current", () => {
    expect(slotPhase(slot("mon", "11:00", "12:00", TODAY), TODAY)).toBe("current");
  });

  it("valid_to가 valid_from보다 이른 깨진 행은 past로 떨어져 화면에 안 샌다", () => {
    // 실측(중등E_중2 정규 C fri 19:20): valid_from=07-10인데 valid_to=07-08.
    expect(slotPhase(slot("fri", "19:20", "20:10", "2026-07-10", "2026-07-08"), TODAY)).toBe("past");
  });

  it("타임스탬프 문자열도 날짜까지만 보고 판정", () => {
    expect(
      slotPhase(slot("mon", "14:20", "15:00", "2026-07-03T00:00:00+09:00", null), TODAY),
    ).toBe("current");
  });
});

describe("slotMinutes", () => {
  it("정상 시각", () => {
    expect(slotMinutes("14:20", "15:00")).toBe(40);
    expect(slotMinutes("16:20", "17:20")).toBe(60);
  });

  it("HH:MM:SS도 받는다", () => {
    expect(slotMinutes("14:20:00", "15:00:00")).toBe(40);
  });

  it("끝이 앞서거나 깨졌으면 0 — 음수 시수 금지", () => {
    expect(slotMinutes("15:00", "14:20")).toBe(0);
    expect(slotMinutes("", "15:00")).toBe(0);
  });
});

describe("summarizeSchedule — DP5 실데이터 모양", () => {
  // 실측: 25행 중 현재 유효 10행(월~금 × 14:20·15:00), 나머지 15행은 3~7월 배치의 이력.
  const dp5: SummarySlot[] = [
    ...["mon", "tue", "wed", "thu", "fri"].flatMap((d) => [
      slot(d, "14:20", "15:00", "2026-07-03"),
      slot(d, "15:00", "15:40", "2026-07-09"),
      slot(d, "15:00", "15:40", "2026-07-03", "2026-07-08"),
      slot(d, "16:20", "17:00", "2026-03-01", "2026-07-02"),
      slot(d, "17:00", "17:40", "2026-03-01", "2026-07-02"),
    ]),
  ];

  it("25슬롯이 1줄로 접힌다 — 붙은 두 교시는 이어진 한 자리", () => {
    const s = summarizeSchedule(dp5, TODAY);
    expect(s.current).toHaveLength(1);
    expect(s.current.map(formatRow)).toEqual(["월~금 14:20~15:40"]);
    expect(s.current[0].minutes).toBe(80); // 한 번 앉는 길이
  });

  it("만료 15행은 빼되 개수는 남겨 밝힌다", () => {
    expect(summarizeSchedule(dp5, TODAY).pastCount).toBe(15);
  });

  it("이미 끝난 16:20·17:00 교시는 어떤 줄에도 안 나온다", () => {
    const s = summarizeSchedule(dp5, TODAY);
    expect(s.current.map((r) => r.startTime)).not.toContain("16:20");
    expect(s.current.map((r) => r.startTime)).not.toContain("17:00");
  });

  it("주당 회차는 '앉는 횟수' — 교시 수(10)가 아니라 5회", () => {
    const s = summarizeSchedule(dp5, TODAY);
    expect(s.sessions).toBe(5);
    expect(s.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
  });

  it("🔴 주당 총 시수는 이어붙여도 불변 — 40분×10 == 80분×5", () => {
    expect(summarizeSchedule(dp5, TODAY).minutes).toBe(400);
  });
});

describe("summarizeSchedule — 운영 요일", () => {
  it("만료 요일은 운영 요일에서 빠진다", () => {
    // 실측 고등E_고2 심화: 만료 행까지 세면 3일, 실제 운영은 2일.
    const s = summarizeSchedule(
      [
        slot("mon", "19:00", "20:00"),
        slot("thu", "19:00", "20:00"),
        slot("sat", "10:00", "11:00", "2026-03-01", "2026-06-30"),
      ],
      TODAY,
    );
    expect(s.days).toEqual(["mon", "thu"]);
  });

  it("현재 유효 슬롯이 하나도 없으면 빈 요약", () => {
    const s = summarizeSchedule([slot("mon", "10:00", "11:00", "2026-01-01", "2026-02-01")], TODAY);
    expect(s.current).toEqual([]);
    expect(s.days).toEqual([]);
    expect(s.sessions).toBe(0);
    expect(s.pastCount).toBe(1);
  });

  it("빈 입력", () => {
    const s = summarizeSchedule([], TODAY);
    expect(s).toMatchObject({ current: [], upcoming: [], upcomingFrom: null, pastCount: 0, minutes: 0 });
  });
});

describe("summarizeSchedule — 예정(upcoming)", () => {
  it("시작 전 슬롯은 따로 묶고 가장 이른 시작일을 준다", () => {
    // 실측 [특강]중3-2 개념 완성반: 8/18 시작 4슬롯.
    const s = summarizeSchedule(
      [
        slot("mon", "11:00", "12:30", "2026-08-18"),
        slot("tue", "11:00", "12:30", "2026-08-18"),
        slot("thu", "11:00", "12:30", "2026-08-20"),
        slot("fri", "11:00", "12:30", "2026-08-18"),
      ],
      TODAY,
    );
    expect(s.current).toEqual([]);
    expect(s.upcoming.map(formatRow)).toEqual(["월·화·목·금 11:00~12:30"]);
    expect(s.upcomingFrom).toBe("2026-08-18");
    // 아직 시작 안 한 반은 주당 회차가 0 — "지금 주 4회"라고 말하지 않는다.
    expect(s.sessions).toBe(0);
  });
});

describe("summarizeSchedule — 묶기 규칙", () => {
  it("종료시각이 다르면 다른 줄", () => {
    const s = summarizeSchedule(
      [slot("tue", "16:20", "17:20"), slot("fri", "16:20", "17:00")],
      TODAY,
    );
    // 시작이 같으면 종료가 이른 줄이 먼저 — 화(~17:20)가 아니라 금(~17:00)이 위.
    expect(s.current.map(formatRow)).toEqual(["금 16:20~17:00", "화 16:20~17:20"]);
  });

  it("같은 요일이 같은 시각에 두 번 있으면 요일 칩은 1개·회차는 2", () => {
    const s = summarizeSchedule(
      [slot("wed", "15:00", "15:40"), slot("wed", "15:00", "15:40")],
      TODAY,
    );
    expect(s.current).toHaveLength(1);
    expect(s.current[0].days).toEqual(["wed"]);
    expect(s.current[0].count).toBe(2);
    expect(s.sessions).toBe(2);
  });

  it("줄은 시작시각 순, 요일은 월→일 순", () => {
    const s = summarizeSchedule(
      [
        slot("fri", "18:20", "19:20"),
        slot("tue", "16:20", "17:20"),
        slot("fri", "16:20", "17:20"),
        slot("tue", "18:20", "19:20"),
      ],
      TODAY,
    );
    expect(s.current.map(formatRow)).toEqual(["화·금 16:20~17:20", "화·금 18:20~19:20"]);
  });

  it("알 수 없는 요일 값은 버린다 — 화면에 raw 코드가 안 샌다", () => {
    const s = summarizeSchedule([slot("mon", "10:00", "11:00"), slot("weekday", "10:00", "11:00")], TODAY);
    expect(s.current).toHaveLength(1);
    expect(s.current[0].days).toEqual(["mon"]);
  });
});

describe("summarizeSchedule — 붙은 교시 잇기(mergeAdjacent)", () => {
  it("🔴 10분이라도 비면 안 잇는다 — 없는 수업 시간이 생긴다", () => {
    // 실측 고등E_고2 심화 수요일: 19:20~20:10 / 20:20~21:10 / 21:10~22:00.
    const s = summarizeSchedule(
      [
        slot("wed", "19:20", "20:10"),
        slot("wed", "20:20", "21:10"),
        slot("wed", "21:10", "22:00"),
      ],
      TODAY,
    );
    // 20:10~20:20은 쉬는 시간 → 앞 하나는 홀로, 뒤 둘만 이어진다.
    expect(s.current.map(formatRow)).toEqual(["수 19:20~20:10", "수 20:20~22:00"]);
    expect(s.sessions).toBe(2);
    expect(s.minutes).toBe(50 + 100);
  });

  it("3개가 줄줄이 붙으면 한 줄로", () => {
    const s = summarizeSchedule(
      [
        slot("sun", "14:20", "15:00"),
        slot("sun", "15:00", "15:40"),
        slot("sun", "15:40", "16:20"),
      ],
      TODAY,
    );
    expect(s.current.map(formatRow)).toEqual(["일 14:20~16:20"]);
    expect(s.minutes).toBe(120);
  });

  it("🔴 요일 집합이 다르면 안 잇는다 — 월만 2교시인데 월~금을 이으면 화~금이 거짓", () => {
    const s = summarizeSchedule(
      [
        ...["mon", "tue", "wed", "thu", "fri"].map((d) => slot(d, "14:20", "15:00")),
        slot("mon", "15:00", "15:40"),
      ],
      TODAY,
    );
    expect(s.current.map(formatRow)).toEqual(["월~금 14:20~15:00", "월 15:00~15:40"]);
    expect(s.minutes).toBe(5 * 40 + 40);
  });

  it("같은 요일 중복 행은 잇지 않는다 — 어느 쪽을 이을지 근거가 없다", () => {
    const s = summarizeSchedule(
      [slot("wed", "15:00", "15:40"), slot("wed", "15:00", "15:40"), slot("wed", "15:40", "16:20")],
      TODAY,
    );
    expect(s.current.map(formatRow)).toEqual(["수 15:00~15:40", "수 15:40~16:20"]);
    expect(s.current[0].count).toBe(2);
  });

  it("예정(upcoming) 줄에도 같은 잇기가 적용된다", () => {
    const s = summarizeSchedule(
      [
        slot("mon", "11:00", "12:30", "2026-08-18"),
        slot("mon", "12:30", "14:00", "2026-08-18"),
      ],
      TODAY,
    );
    expect(s.upcoming.map(formatRow)).toEqual(["월 11:00~14:00"]);
  });

  it("이어붙인 뒤에도 시작시각 순", () => {
    const s = summarizeSchedule(
      [
        slot("tue", "18:20", "19:20"),
        slot("tue", "16:20", "17:20"),
        slot("tue", "17:20", "18:10"),
      ],
      TODAY,
    );
    expect(s.current.map(formatRow)).toEqual(["화 16:20~18:10", "화 18:20~19:20"]);
  });
});

describe("formatDays", () => {
  it("2일은 가운뎃점", () => {
    expect(formatDays(["mon", "thu"])).toBe("월·목");
    expect(formatDays(["tue", "fri"])).toBe("화·금");
  });

  it("3일 이상 이어지면 접는다", () => {
    expect(formatDays(["mon", "tue", "wed", "thu", "fri"])).toBe("월~금");
    expect(formatDays(["tue", "wed", "thu"])).toBe("화~목");
  });

  it("떨어져 있으면 안 접는다", () => {
    expect(formatDays(["mon", "wed", "fri"])).toBe("월·수·금");
  });

  it("이어진 구간과 낱개가 섞이면 구간만 접는다", () => {
    expect(formatDays(["mon", "tue", "wed", "fri"])).toBe("월~수·금");
  });

  it("순서가 뒤섞여 들어와도 월→일 순으로 낸다", () => {
    expect(formatDays(["fri", "mon", "wed"])).toBe("월·수·금");
  });

  it("중복 요일은 한 번만", () => {
    expect(formatDays(["mon", "mon"])).toBe("월");
  });
});

describe("formatMinutes", () => {
  it("시간·분 표기", () => {
    expect(formatMinutes(40)).toBe("40분");
    expect(formatMinutes(60)).toBe("1시간");
    expect(formatMinutes(100)).toBe("1시간 40분");
    expect(formatMinutes(400)).toBe("6시간 40분");
  });

  it("0·비정상은 빈 문자열", () => {
    expect(formatMinutes(0)).toBe("");
    expect(formatMinutes(-10)).toBe("");
    expect(formatMinutes(Number.NaN)).toBe("");
  });
});

describe("mergeTimeRanges — 학생 수업탭 스케줄 셀의 연속 구간 병합", () => {
  it("실측 중고E_중1 의치대: 붙은 두 교시만 잇고 틈 있는 교시는 별개", () => {
    // 16:20~17:20 + 17:20~18:10 은 딱 붙음 → 병합. 18:10~18:20 틈이 있는 18:20~19:20 은 별개.
    expect(
      mergeTimeRanges([
        { start: "17:20", end: "18:10" },
        { start: "16:20", end: "17:20" },
        { start: "18:20", end: "19:20" },
      ]),
    ).toEqual([
      { start: "16:20", end: "18:10" },
      { start: "18:20", end: "19:20" },
    ]);
  });

  it("정렬 안 된 입력도 시작시각순으로 이어 하나가 된다", () => {
    expect(
      mergeTimeRanges([
        { start: "17:00", end: "17:40" },
        { start: "16:20", end: "17:00" },
        { start: "18:20", end: "19:20" },
        { start: "17:40", end: "18:20" },
      ]),
    ).toEqual([{ start: "16:20", end: "19:20" }]);
  });

  it("틈이 있으면(고등E_고2 심화 10분 쉼) 잇지 않는다", () => {
    expect(
      mergeTimeRanges([
        { start: "19:20", end: "20:10" },
        { start: "20:20", end: "21:10" },
      ]),
    ).toEqual([
      { start: "19:20", end: "20:10" },
      { start: "20:20", end: "21:10" },
    ]);
  });

  it("겹치는 구간은 잇지 않고, 완전 중복은 한 번만", () => {
    expect(
      mergeTimeRanges([
        { start: "17:00", end: "17:40" },
        { start: "17:20", end: "18:10" },
        { start: "17:20", end: "18:10" },
      ]),
    ).toEqual([
      { start: "17:00", end: "17:40" },
      { start: "17:20", end: "18:10" },
    ]);
  });

  it("초 붙은 DB time도 HH:MM으로 깎아 비교한다", () => {
    expect(
      mergeTimeRanges([
        { start: "16:20:00", end: "17:20:00" },
        { start: "17:20:00", end: "18:10:00" },
      ]),
    ).toEqual([{ start: "16:20", end: "18:10" }]);
  });
});
