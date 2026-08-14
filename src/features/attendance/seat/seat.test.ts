import { describe, it, expect } from "vitest";
import {
  ambiguousClassIds,
  groupByStart,
  hhmm,
  OPEN_SEAT_KEYS,
  parseSeatKey,
  periodTimeLabel,
  pickPeriodIndex,
  SEAT_DB_LABEL,
  seatKeyOf,
  type SeatSlot,
} from "./seat";

const slot = (classId: string, className: string, start: string, end: string): SeatSlot => ({
  classId,
  className,
  start,
  end,
});

describe("자리 키", () => {
  it("DB 라벨과 왕복한다", () => {
    expect(SEAT_DB_LABEL.lab).toBe("LAB");
    expect(SEAT_DB_LABEL.jj).toBe("JJ");
    expect(seatKeyOf("LAB")).toBe("lab");
    expect(seatKeyOf("JJ")).toBe("jj");
    expect(seatKeyOf("Hannah")).toBeNull();
    expect(seatKeyOf(null)).toBeNull();
  });

  it("아직 안 연 자리는 URL로도 못 들어온다(1차 = 랩실만)", () => {
    expect(parseSeatKey("lab")).toBe("lab");
    expect(parseSeatKey("LAB")).toBe("lab");
    expect(OPEN_SEAT_KEYS).toEqual(["lab"]);
    // JJ실은 기존 484행의 시수 귀속을 바꾸게 되므로 원장 확인 전까지 닫아 둔다.
    expect(parseSeatKey("jj")).toBeNull();
    expect(parseSeatKey(undefined)).toBeNull();
    expect(parseSeatKey("603")).toBeNull();
  });
});

describe("교시 묶기", () => {
  it("시작시각이 같으면 종료가 달라도 한 칸이다", () => {
    // 실측(JJ실 금 16:20): 초5 의치대·브릿지 A는 ~17:00, 브릿지 D는 ~17:20.
    const periods = groupByStart([
      slot("c1", "중등E_초5 의치대", "16:20:00", "17:00:00"),
      slot("c3", "중등E_초등 브릿지 D", "16:20:00", "17:20:00"),
      slot("c2", "중등E_초등 브릿지 A", "16:20:00", "17:00:00"),
    ]);
    expect(periods).toHaveLength(1);
    expect(periods[0]!.start).toBe("16:20");
    expect(periods[0]!.ends).toEqual(["17:00", "17:20"]);
    // 반은 이름순(한글 기준)
    expect(periods[0]!.slots.map((s) => s.classId)).toEqual(["c1", "c2", "c3"]);
    expect(periodTimeLabel(periods[0]!)).toBe("16:20 ~ 17:00·17:20");
  });

  it("교시는 시작시각 오름차순이고 초 단위는 잘라 낸다", () => {
    const periods = groupByStart([
      slot("a", "PJ6", "16:20:00", "17:00:00"),
      slot("b", "DP6", "14:20:00", "15:00:00"),
      slot("c", "LT3", "15:00:00", "15:40:00"),
    ]);
    expect(periods.map((p) => p.start)).toEqual(["14:20", "15:00", "16:20"]);
  });

  it("시작시각이 없는 행은 버린다", () => {
    expect(groupByStart([slot("a", "X", "", "15:00")])).toEqual([]);
  });

  it("같은 반에서 종료가 갈리면 저장키로 구분이 안 되므로 표시한다", () => {
    const [period] = groupByStart([
      slot("same", "LS3a", "16:20", "17:00"),
      slot("same", "LS3a", "16:20", "17:20"),
      slot("other", "KW2", "16:20", "17:00"),
    ]);
    expect(ambiguousClassIds(period!)).toEqual(["same"]);
  });

  it("반이 다르면 종료가 갈려도 모호하지 않다(실측 0건인 쪽만 막는다)", () => {
    const [period] = groupByStart([
      slot("c1", "A", "16:20", "17:00"),
      slot("c2", "B", "16:20", "17:20"),
    ]);
    expect(ambiguousClassIds(period!)).toEqual([]);
  });
});

describe("기본 교시 선택", () => {
  const periods = groupByStart([
    slot("a", "A", "14:20", "15:00"),
    slot("b", "B", "16:20", "17:00"),
    slot("c", "C", "16:20", "17:20"), // 늦게 끝나는 반이 섞인 칸
    slot("d", "D", "18:20", "19:00"),
  ]);

  it("진행 중인 교시를 고른다", () => {
    expect(pickPeriodIndex(periods, "16:30")).toBe(1);
  });

  it("늦게 끝나는 반이 있으면 그 시각까지 진행 중이다", () => {
    // 17:10 — 한 반은 끝났지만 다른 반은 17:20까지라 아직 그 칸이다.
    expect(pickPeriodIndex(periods, "17:10")).toBe(1);
  });

  it("쉬는 시간이면 다음 교시", () => {
    expect(pickPeriodIndex(periods, "15:30")).toBe(1);
    expect(pickPeriodIndex(periods, "09:00")).toBe(0);
  });

  it("하루가 끝났으면 마지막 교시", () => {
    // 16:20 두 반은 한 칸으로 묶이므로 교시는 14:20 · 16:20 · 18:20 셋뿐이다.
    expect(periods.map((p) => p.start)).toEqual(["14:20", "16:20", "18:20"]);
    expect(pickPeriodIndex(periods, "22:00")).toBe(2);
  });

  it("교시가 없으면 -1", () => {
    expect(pickPeriodIndex([], "16:30")).toBe(-1);
  });
});

describe("시간 표기", () => {
  it("초를 자른다", () => {
    expect(hhmm("16:20:00")).toBe("16:20");
    expect(hhmm("16:20")).toBe("16:20");
    expect(hhmm(null)).toBe("");
  });
});
