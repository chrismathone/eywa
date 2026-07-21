import { describe, expect, it } from "vitest";
import {
  bucketOfStatus,
  defaultSelectedDay,
  monthGrid,
  monthLabel,
  monthOf,
  monthRange,
  shiftMonth,
  summarizeSendDays,
  type SendStatRow,
} from "./send-calendar";

describe("bucketOfStatus", () => {
  it("발송 완료·처리 중·실패를 행동 단위로 가른다", () => {
    expect(bucketOfStatus("success")).toBe("sent");
    expect(bucketOfStatus("queued")).toBe("pending");
    expect(bucketOfStatus("processing")).toBe("pending");
    expect(bucketOfStatus("failed")).toBe("problem");
    expect(bucketOfStatus("name_conflict")).toBe("problem");
  });

  it("의도적 제외(결석·과목설정·오래됨)는 excluded — 미발송으로 세면 안 된다", () => {
    expect(bucketOfStatus("absent")).toBe("excluded");
    expect(bucketOfStatus("subject_off")).toBe("excluded");
    expect(bucketOfStatus("too_old")).toBe("excluded");
  });

  it("상태 없음·모르는 상태는 unsent — 모른다고 빨강(problem)이나 발송완료로 몰지 않는다", () => {
    expect(bucketOfStatus("")).toBe("unsent");
    expect(bucketOfStatus(null)).toBe("unsent");
    expect(bucketOfStatus("some_future_status")).toBe("unsent");
  });
});

describe("summarizeSendDays", () => {
  const rows: SendStatRow[] = [
    { reportDay: "2026-07-06", statusKey: "success", cnt: 4 },
    { reportDay: "2026-07-06", statusKey: "failed", cnt: 1 },
    { reportDay: "2026-07-06", statusKey: "absent", cnt: 2 },
    { reportDay: "2026-07-07", statusKey: "", cnt: 3 },
  ];

  it("날짜별로 버킷을 합산한다", () => {
    const days = summarizeSendDays(rows);
    expect(days.get("2026-07-06")).toMatchObject({ total: 7, sent: 4, problem: 1, excluded: 2, unsent: 0 });
    expect(days.get("2026-07-07")).toMatchObject({ total: 3, sent: 0, unsent: 3 });
  });

  it("target(발송 대상)은 제외분을 뺀 값 — 결석 2건이 '미발송'으로 잡히면 안 된다", () => {
    const days = summarizeSendDays(rows);
    expect(days.get("2026-07-06")!.target).toBe(5); // 7건 중 결석 2 제외
    expect(days.get("2026-07-07")!.target).toBe(3);
  });

  it("자료 없는 날은 map에 없다(빈 칸)", () => {
    expect(summarizeSendDays(rows).has("2026-07-08")).toBe(false);
  });
});

describe("월 이동·범위", () => {
  it("말일을 정확히 구한다(2월·31일 달)", () => {
    expect(monthRange("2026-07")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02").to).toBe("2028-02-29"); // 윤년
  });

  it("연 경계를 넘어 이동한다", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("표시 라벨·달 추출", () => {
    expect(monthLabel("2026-07")).toBe("2026년 7월");
    expect(monthOf("2026-07-21")).toBe("2026-07");
  });
});

describe("monthGrid", () => {
  it("일요일 시작 + 그 달 아닌 칸은 null(앞뒤 달 날짜가 새어 들지 않게)", () => {
    // 2026-07-01은 수요일 → 첫 주 앞 3칸이 빈칸.
    const weeks = monthGrid("2026-07");
    expect(weeks[0]!.slice(0, 3)).toEqual([null, null, null]);
    expect(weeks[0]![3]).toBe("2026-07-01");
  });

  it("항상 완전한 주 단위(마지막 줄이 잘리지 않음) + 날짜는 그 달 전부", () => {
    for (const month of ["2026-07", "2026-02", "2026-11"]) {
      const weeks = monthGrid(month);
      for (const w of weeks) expect(w).toHaveLength(7);
      const dates = weeks.flat().filter(Boolean);
      expect(dates).toHaveLength(Number(monthRange(month).to.slice(8)));
    }
  });
});

describe("defaultSelectedDay", () => {
  const days = summarizeSendDays([
    { reportDay: "2026-07-06", statusKey: "success", cnt: 1 },
    { reportDay: "2026-07-20", statusKey: "success", cnt: 1 },
  ]);

  it("자료 있는 날 중 가장 최근을 연다(빈 날을 열면 '쓴 게 없다'처럼 보임)", () => {
    expect(defaultSelectedDay(days)).toBe("2026-07-20");
  });

  it("오늘에 자료가 있으면 오늘 우선", () => {
    expect(defaultSelectedDay(days, "2026-07-06")).toBe("2026-07-06");
  });

  it("오늘에 자료가 없으면 최근 날로 폴백", () => {
    expect(defaultSelectedDay(days, "2026-07-21")).toBe("2026-07-20");
  });

  it("빈 달은 null", () => {
    expect(defaultSelectedDay(new Map())).toBeNull();
  });
});
