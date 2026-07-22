import { describe, it, expect } from "vitest";
import { computeWritingRates } from "./writing-rate";

const DATES = ["2026-07-07", "2026-07-08", "2026-07-09"]; // 화·수·목
const TODAY = "2026-07-09"; // 마지막 날짜를 오늘로

describe("computeWritingRates — 요일별·주간 작성률(%+n/n)", () => {
  it("과거일=주간대상 min(count,target), 오늘=정밀, 주간=합계 작성률", () => {
    const rows = computeWritingRates(
      DATES,
      [
        { teacher: "김선생", date: "2026-07-07" },
        { teacher: "김선생", date: "2026-07-09" },
        { teacher: "김선생", date: "2026-07-09" },
        { teacher: "이선생", date: "2026-07-08" },
      ],
      [{ teacher: "김선생", target: 4, written: 2, missing: ["A", "B"] }, { teacher: "이선생", target: 2, written: 2, missing: [] }],
      [
        { teacher: "김선생", date: "2026-07-07", target: 2 }, // 과거: written=min(1,2)=1 → 50%
        { teacher: "김선생", date: "2026-07-08", target: 3 }, // 과거: written=min(0,3)=0 → 0%
        { teacher: "이선생", date: "2026-07-08", target: 2 }, // 과거: written=min(1,2)=1 → 50%
      ],
      TODAY,
    );
    const kim = rows.find((r) => r.teacher === "김선생")!;
    expect(kim.daily).toEqual([
      { date: "2026-07-07", count: 1, target: 2, written: 1, rate: 50 },
      { date: "2026-07-08", count: 0, target: 3, written: 0, rate: 0 },
      { date: "2026-07-09", count: 2, target: 4, written: 2, rate: 50 }, // 오늘=정밀(todayWritten)
    ]);
    expect(kim.weekTarget).toBe(9); // 2+3+4
    expect(kim.weekWritten).toBe(3); // 1+0+2
    expect(kim.weekRate).toBe(33); // round(3/9*100)
    expect(kim.todayRate).toBe(50);
    expect(kim.todayMissing).toEqual(["A", "B"]);
  });

  it("미래일은 대상 null(수업 전 → '·'), 주간 합계에서 제외", () => {
    const rows = computeWritingRates(
      DATES,
      [{ teacher: "박선생", date: "2026-07-07" }],
      [{ teacher: "박선생", target: 2, written: 1, missing: ["y"] }],
      [{ teacher: "박선생", date: "2026-07-07", target: 2 }],
      "2026-07-08", // 오늘=수요일 → 07-09(목)은 미래
    );
    const p = rows.find((r) => r.teacher === "박선생")!;
    expect(p.daily[2]!.target).toBeNull(); // 07-09 미래
    expect(p.daily[2]!.rate).toBeNull();
    // 07-07 past target 2 written min(1,2)=1, 07-08 today target 2 written 1 → weekTarget 4, weekWritten 2
    expect(p.weekTarget).toBe(4);
    expect(p.weekWritten).toBe(2);
    expect(p.weekRate).toBe(50);
  });

  it("과거일 대상(dailyTarget) 없으면 그 날 대상 null('·', 무수업일)", () => {
    const rows = computeWritingRates(
      DATES,
      [{ teacher: "무수업", date: "2026-07-07" }], // 작성은 있으나 대상 미제공
      [{ teacher: "무수업", target: 1, written: 1, missing: [] }],
      [], // dailyTargets 없음
      TODAY,
    );
    const t = rows[0]!;
    expect(t.daily[0]!.target).toBeNull(); // 07-07 대상 없음
    expect(t.daily[0]!.rate).toBeNull();
    expect(t.daily[0]!.count).toBe(1); // 건수는 유지(참고)
  });

  it("worst(오늘 작성률 낮은 순) 먼저, 오늘 대상 없는 강사는 뒤로", () => {
    const rows = computeWritingRates(
      DATES,
      [{ teacher: "무대상", date: "2026-07-08" }],
      [{ teacher: "높음", target: 2, written: 2, missing: [] }, { teacher: "낮음", target: 4, written: 1, missing: ["x"] }],
      [],
      TODAY,
    );
    expect(rows.map((r) => r.teacher)).toEqual(["낮음", "높음", "무대상"]);
  });

  it("오늘 대상 0이면 todayRate null", () => {
    const rows = computeWritingRates(DATES, [], [{ teacher: "휴무", target: 0, written: 0, missing: [] }], [], TODAY);
    expect(rows[0]!.todayRate).toBeNull();
  });
});

// 2026-07-21 원장 제보: "오늘 수업이 이렇게 많은데 화요일 수업이 없다고 나온다".
// 대상(분모)은 **시작된 수업**까지만이라(시작 전을 미작성으로 몰면 안 됨) 저녁 수업만 있는 강사는
// 낮에 대상 0이 된다 — 그때 "수업 없음"이라고 쓰면 거짓말이라 '시작 전'을 따로 구분한다.
describe("computeWritingRates — 오늘 아직 시작 전 수업(todayPending)", () => {
  it("오늘 대상이 없어도 시작 전 수업이 있으면 pending으로 구분(수업 없음 아님)", () => {
    const rows = computeWritingRates(DATES, [], [], [], TODAY, [
      { teacher: "저녁쌤", classes: 3, firstStart: "18:20" },
    ]);
    const t = rows.find((r) => r.teacher === "저녁쌤")!;
    expect(t.todayRate).toBeNull();
    expect(t.todayPending).toEqual({ teacher: "저녁쌤", classes: 3, firstStart: "18:20" });
    expect(t.daily[2]!.pending).toBe(true); // 오늘 칸 = '수업 전'
  });

  it("작성 기록도 대상도 없는 강사라도 시작 전 수업이 있으면 행이 남는다", () => {
    const rows = computeWritingRates(DATES, [], [], [], TODAY, [
      { teacher: "신규쌤", classes: 1, firstStart: "20:10" },
    ]);
    expect(rows.map((r) => r.teacher)).toContain("신규쌤");
  });

  it("시작 전 수업이 없으면 todayPending null(진짜 '수업 없음')·오늘 칸도 pending 아님", () => {
    const rows = computeWritingRates(DATES, [{ teacher: "휴무쌤", date: "2026-07-07" }], [], [], TODAY, []);
    const t = rows.find((r) => r.teacher === "휴무쌤")!;
    expect(t.todayPending).toBeNull();
    expect(t.daily[2]!.pending).toBeUndefined();
  });

  it("이미 시작된 수업이 있으면 비율은 그대로 두고 남은 수업만 덧붙인다(분모는 불변)", () => {
    const rows = computeWritingRates(
      DATES,
      [],
      [{ teacher: "종일쌤", target: 8, written: 4, missing: ["A"] }],
      [],
      TODAY,
      [{ teacher: "종일쌤", classes: 2, firstStart: "19:00" }],
    );
    const t = rows.find((r) => r.teacher === "종일쌤")!;
    expect(t.todayRate).toBe(50);
    expect(t.todayTarget).toBe(8); // 시작 전 수업이 분모에 섞이지 않는다
    expect(t.todayPending?.classes).toBe(2);
    expect(t.daily[2]!.pending).toBeUndefined(); // 대상이 있으니 '수업 전' 표기는 아님
  });

  it("과거일 셀은 pending이 붙지 않는다(오늘 칸 전용)", () => {
    const rows = computeWritingRates(DATES, [], [], [{ teacher: "쌤", date: "2026-07-07", target: 0 }], TODAY, [
      { teacher: "쌤", classes: 1, firstStart: "18:20" },
    ]);
    const t = rows[0]!;
    expect(t.daily[0]!.pending).toBeUndefined();
    expect(t.daily[2]!.pending).toBe(true);
  });
});

describe("학원 지정 휴일 — 분모에서 제외(원장 2026-07-22)", () => {
  const D = ["2026-07-07", "2026-07-08", "2026-07-09"];
  const T = "2026-07-09";

  it("휴일인 과거일은 대상 null·합계 제외 + 휴일명 표시", () => {
    const rows = computeWritingRates(
      D,
      // ⚠️ 휴일에 **보고서가 없을 때** 순수 제외를 본다(작성분이 있으면 '한 일로 인정'이 새 규칙).
      [{ teacher: "김선생", date: "2026-07-08" }],
      [{ teacher: "김선생", target: 2, written: 2, missing: [] }],
      [
        { teacher: "김선생", date: "2026-07-07", target: 5 }, // ← 휴일이라 무시돼야 함
        { teacher: "김선생", date: "2026-07-08", target: 3 },
      ],
      T,
      [],
      [{ date: "2026-07-07", name: "제헌절" }],
    );
    const k = rows.find((r) => r.teacher === "김선생")!;
    expect(k.daily[0]).toEqual({
      date: "2026-07-07",
      count: 0,
      target: null,
      written: 0,
      rate: null,
      holiday: true,
      holidayName: "제헌절",
    });
    // 주간 합계에서 휴일 대상(5)이 빠졌는지 — 08(3) + 오늘(2) = 5
    expect(k.weekTarget).toBe(5);
  });

  it("⚠️ 서버가 실수로 대상을 넣어도 휴일이 이긴다(순수에서 최종 판정)", () => {
    const rows = computeWritingRates(
      D,
      [],
      [],
      [{ teacher: "박선생", date: "2026-07-08", target: 9 }],
      T,
      [],
      [{ date: "2026-07-08" }],
    );
    const p = rows.find((r) => r.teacher === "박선생")!;
    expect(p.daily[1].target).toBeNull();
    expect(p.daily[1].holiday).toBe(true);
    expect(p.daily[1].holidayName).toBeUndefined(); // 이름 없는 휴일
    expect(p.weekTarget).toBe(0);
  });

  it("오늘이 휴일이면 오늘 지표·'수업 전'도 통째로 빠진다(미작성 독촉 금지)", () => {
    const rows = computeWritingRates(
      D,
      [],
      [{ teacher: "최선생", target: 4, written: 0, missing: ["A", "B"] }],
      [],
      T,
      [{ teacher: "최선생", classes: 2, firstStart: "20:10" }],
      [{ date: T, name: "개원기념일" }],
    );
    const c = rows.find((r) => r.teacher === "최선생")!;
    expect(c.daily[2].holiday).toBe(true);
    expect(c.daily[2].pending).toBeUndefined();
    expect(c.todayTarget).toBe(0);
    expect(c.todayMissing).toEqual([]);
    expect(c.todayRate).toBeNull();
    expect(c.todayPending).toBeNull();
  });

  it("휴일에 부득이 수업하고 보고서를 쓰면 **한 일로 인정**(대상=작성=100%)", () => {
    const rows = computeWritingRates(
      D,
      [
        { teacher: "김선생", date: "2026-07-07" },
        { teacher: "김선생", date: "2026-07-07" },
        { teacher: "김선생", date: "2026-07-07" },
      ],
      [],
      [{ teacher: "김선생", date: "2026-07-08", target: 2 }],
      T,
      [],
      [{ date: "2026-07-07", name: "제헌절" }],
    );
    const k = rows.find((r) => r.teacher === "김선생")!;
    expect(k.daily[0]).toEqual({
      date: "2026-07-07",
      count: 3,
      target: 3,
      written: 3,
      rate: 100,
      holiday: true,
      holidayName: "제헌절",
    });
    // 합계에도 3/3이 들어간다 — 휴일 근무가 집계에서 증발하지 않게.
    expect(k.weekWritten).toBe(3);
    expect(k.weekTarget).toBe(5); // 휴일 3 + 08일 대상 2
  });

  it("휴일에 아무도 안 썼으면 종전대로 대상 null('휴') — 분모를 늘리지 않는다", () => {
    // 08일 대상만 두고(강사 행이 생기게) 07일은 휴일 + 보고서 0건.
    const rows = computeWritingRates(
      D,
      [],
      [],
      [{ teacher: "박선생", date: "2026-07-08", target: 4 }],
      T,
      [],
      [{ date: "2026-07-07" }],
    );
    const p = rows.find((r) => r.teacher === "박선생")!;
    expect(p.daily[0].target).toBeNull();
    expect(p.daily[0].holiday).toBe(true);
    expect(p.weekTarget).toBe(4); // 휴일이 분모를 늘리지 않았다
  });

  it("휴일 목록이 비면 기존 동작 그대로(하위호환)", () => {
    const rows = computeWritingRates(D, [], [], [{ teacher: "김선생", date: "2026-07-08", target: 3 }], T);
    expect(rows[0].daily[1]).toEqual({ date: "2026-07-08", count: 0, target: 3, written: 0, rate: 0 });
  });
});
