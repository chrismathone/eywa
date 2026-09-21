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

  it("DB에 남는 제외 상태(too_old)는 excluded", () => {
    expect(bucketOfStatus("too_old")).toBe("excluded");
    // ⚠️ absent·subject_off는 매핑돼 있지만 **DB에 저장되지 않는 반환 전용 상태**라 실데이터에선
    // 도달하지 않는다. 이 매핑을 근거로 "결석은 분모에서 빠진다"고 주장하면 안 된다(sendable이 담당).
    expect(bucketOfStatus("absent")).toBe("excluded");
    expect(bucketOfStatus("subject_off")).toBe("excluded");
  });

  it("상태 없음·모르는 상태는 unsent — 모른다고 빨강(problem)이나 발송완료로 몰지 않는다", () => {
    expect(bucketOfStatus("")).toBe("unsent");
    expect(bucketOfStatus(null)).toBe("unsent");
    expect(bucketOfStatus("some_future_status")).toBe("unsent");
  });
});

describe("summarizeSendDays", () => {
  // ⚠️ 픽스처는 **실제 DB에 존재하는 상태값만** 쓴다. 실측(injaewon 2026-07-21): 상태는 success/null 둘뿐,
  // 그리고 보고서 17,350건 중 17,335건이 Edutrix 이관분이다. 예전 테스트는 DB가 만들지 않는
  // statusKey:"absent"를 주입해 "결석은 분모에서 빠진다"를 통과시키며 거짓 안심을 줬다(적대 검증 확정).
  const rows: SendStatRow[] = [
    { reportDay: "2026-07-06", statusKey: "success", sendable: false, cnt: 4 }, // 이관분(edutrix가 발송)
    { reportDay: "2026-07-06", statusKey: "", sendable: false, cnt: 2 }, // 이관분·미발송(지금 못 보냄)
    { reportDay: "2026-07-06", statusKey: "", sendable: true, cnt: 1 }, // aywa 네이티브 미발송(보낼 수 있음)
    { reportDay: "2026-07-07", statusKey: "success", sendable: true, cnt: 3 },
  ];

  it("발송 숫자는 출처와 무관한 **사실** — 이관분 success도 학부모에겐 나갔으므로 발송으로 센다", () => {
    // ⚠️ 이관분을 빼면 실데이터(99.9%가 이관분)에서 달력이 전 강사 "0/0"이 되어 기능이 죽는다.
    const day = summarizeSendDays(rows).get("2026-07-06")!;
    expect(day.sent).toBe(4);
    expect(day.target).toBe(7); // 그날 작성분 전부(제외 상태 없음)
    expect(day.total).toBe(7);
  });

  it("'보낼 수 있음'은 **행동** — 미발송 중 발송 콘솔 게이트를 통과한 것만", () => {
    const day = summarizeSendDays(rows).get("2026-07-06")!;
    expect(day.unsent).toBe(3); // 안 나간 건 3
    expect(day.actionable).toBe(1); // 그중 지금 누를 수 있는 건 1 (나머지는 옛 이관분)
  });

  it("이미 나간 건은 '보낼 수 있음'에 들어가지 않는다", () => {
    expect(summarizeSendDays(rows).get("2026-07-07")!.actionable).toBe(0);
  });

  it("분자가 분모를 넘는 모순이 구조적으로 생기지 않는다", () => {
    for (const day of summarizeSendDays(rows).values()) {
      expect(day.sent).toBeLessThanOrEqual(day.target);
      expect(day.target).toBeLessThanOrEqual(day.total);
      expect(day.actionable).toBeLessThanOrEqual(day.unsent);
    }
  });

  it("자료 없는 날은 map에 없다(빈 칸)", () => {
    expect(summarizeSendDays(rows).has("2026-07-09")).toBe(false);
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
    { reportDay: "2026-07-06", statusKey: "success", sendable: true, cnt: 1 },
    { reportDay: "2026-07-20", statusKey: "success", sendable: true, cnt: 1 },
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
