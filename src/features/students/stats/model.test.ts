import { describe, expect, it } from "vitest";
import {
  axisLabel,
  clipToRecords,
  distinctSubjectTokens,
  firstFlowMonth,
  firstNonZeroMonth,
  flowRowsFor,
  flowTotals,
  laterMonth,
  longLabel,
  parseStudentStatsPrefs,
  pointsFor,
  summarize,
  toggleSeries,
  tokenColor,
  viewFromParam,
  withDeltas,
  type Point,
} from "./model";
import { breakdownTrendOf, weeklyPoints, type TrendStudent } from "@/features/dashboard/overview/enrolled-trend";

const p = (key: string, count: number): Point => ({ key, label: key, date: key, count });

describe("parseStudentStatsPrefs", () => {
  it("모르는 값은 기본값", () => {
    const base = { range: "all", view: "subject", off: [], flowRange: "all", trendKind: "line", flowKind: "bar", historyView: "yearly", courseRange: "all", courseKind: "line", courseOff: [], firstMode: "month" };
    expect(parseStudentStatsPrefs(undefined)).toEqual(base);
    expect(parseStudentStatsPrefs({ range: "m36", view: 3, off: "x", flowRange: 7, trendKind: "pie", historyView: "weekly" })).toEqual(base);
  });
  it("저장값을 읽는다 · 꺼 둔 선은 문자열만, 중복 없이", () => {
    expect(
      parseStudentStatsPrefs({
        range: "w26", view: "mix", off: ["total", "total", 3, "subject:math"], flowRange: "m12", trendKind: "bar", flowKind: "line", historyView: "monthly",
        courseRange: "y", courseKind: "bar", courseOff: ["program:eie", "program:eie"], firstMode: "range",
      }),
    ).toEqual({
      range: "w26",
      view: "mix",
      off: ["total", "subject:math"],
      flowRange: "m12",
      trendKind: "bar",
      flowKind: "line",
      historyView: "monthly",
      courseRange: "y",
      courseKind: "bar",
      courseOff: ["program:eie"],
      firstMode: "range",
    });
  });
});

describe("viewFromParam", () => {
  it("mix·subject만", () => {
    expect(viewFromParam("mix")).toBe("mix");
    expect(viewFromParam("subject")).toBe("subject");
    expect(viewFromParam("grade")).toBeNull();
    expect(viewFromParam(undefined)).toBeNull();
  });
});

describe("clipToRecords · pointsFor", () => {
  const mk = (key: string, date: string, count: number): Point => ({ key, label: key, date, count });
  const monthly = [mk("2024-11", "2024-11-30", 0), mk("2024-12", "2024-12-31", 1), mk("2025-01", "2025-01-31", 2), mk("2025-02", "2025-02-28", 3), mk("2025-03", "2025-03-31", 4)];
  const set = { monthly, weekly: [mk("2025-01-26", "2025-01-26", 1), mk("2025-02-02", "2025-02-02", 2)], yearly: [mk("2025", "2025-12-31", 9), mk("2026", "2026-10-20", 10)] };
  it("셀 수 있는 달 전의 달·주는 뺀다", () => {
    expect(clipToRecords(monthly, "2025-02").map((x) => x.key)).toEqual(["2025-02", "2025-03"]);
    expect(pointsFor(set, "w26", "2025-02").map((x) => x.key)).toEqual(["2025-02-02"]);
  });
  it("경계를 모르면 그대로", () => expect(pointsFor(set, "all", null)).toHaveLength(5));
  it("최근 12개월은 뒤에서 12개", () => {
    const long = Array.from({ length: 36 }, (_, i) => mk(`2030-${String(i).padStart(2, "0")}`, `2030-${String(i).padStart(2, "0")}-28`, i));
    expect(pointsFor({ ...set, monthly: long }, "m12", null)).toHaveLength(12);
  });
  it("🔴 연도별도 연말 날짜로 자른다(과목 관리자 2026-01부터면 2025년 점은 없다)", () => {
    expect(pointsFor(set, "y", "2025-02").map((x) => x.key)).toEqual(["2025", "2026"]);
    expect(pointsFor(set, "y", "2026-01").map((x) => x.key)).toEqual(["2026"]);
  });
  it("두 경계 중 늦은 달 · 첫 0 아닌 달", () => {
    expect(laterMonth("2025-02", "2026-01")).toBe("2026-01");
    expect(laterMonth(null, "2026-01")).toBe("2026-01");
    expect(laterMonth("2025-02", null)).toBe("2025-02");
    expect(firstNonZeroMonth(monthly)).toBe("2024-12");
    expect(firstNonZeroMonth([mk("2025-01", "2025-01-31", 0)])).toBeNull();
  });
});

describe("longLabel", () => {
  it("월·주·연 · 오늘 칸", () => {
    expect(longLabel({ key: "2026-03", label: "3월", date: "2026-03-31", count: 0 }, "all", "2026-10-20")).toBe("2026년 3월 말");
    expect(longLabel({ key: "2026-10", label: "10월", date: "2026-10-20", count: 0 }, "all", "2026-10-20")).toBe("2026년 10월 (오늘)");
    expect(longLabel({ key: "2026-09-28", label: "9/28", date: "2026-09-28", count: 0 }, "w26", "2026-10-20")).toBe("9/28 주");
    expect(longLabel({ key: "2025", label: "2025년", date: "2025-12-31", count: 0 }, "y", "2026-10-20")).toBe("2025년 말");
  });
});

describe("axisLabel", () => {
  it("월은 yy.mm", () => expect(axisLabel(p("2026-09", 0), "all")).toBe("26.09"));
  it("연은 키", () => expect(axisLabel(p("2026", 0), "y")).toBe("2026"));
});

describe("summarize · withDeltas", () => {
  it("빈 배열", () => expect(summarize([]).change).toBeNull());
  it("증감·최고·최저", () => {
    const s = summarize([p("a", 100), p("b", 120), p("c", 90), p("d", 110)]);
    expect(s.change).toBe(10);
    expect(s.changeRate).toBe(10);
    expect(s.peak?.key).toBe("b");
    expect(s.low?.key).toBe("c");
  });
  it("첫 점이 0이면 증감률 없음", () => expect(summarize([p("a", 0), p("b", 5)]).changeRate).toBeNull());
  it("직전 대비", () => expect(withDeltas([p("a", 3), p("b", 5), p("c", 4)]).map((x) => x.delta)).toEqual([null, 2, -1]));
});

describe("toggleSeries", () => {
  const keys = ["total", "subject:math", "subject:english"];
  it("끄고 켠다", () => {
    expect(toggleSeries([], "total", keys)).toEqual(["total"]);
    expect(toggleSeries(["total"], "total", keys)).toEqual([]);
  });
  it("마지막 남은 선은 끄지 않는다", () => {
    expect(toggleSeries(["total", "subject:math"], "subject:english", keys)).toEqual(["total", "subject:math"]);
  });
});

describe("distinctSubjectTokens", () => {
  it("학원설정 색을 먼저 쓴다", () => {
    const m = distinctSubjectTokens([{ key: "math", color: "blue" }, { key: "english", color: "rose" }]);
    expect([...m.values()]).toEqual(["blue", "rose"]);
  });
  it("겹치거나 학원 전체 색(primary)이면 안 쓴 색으로 비켜 준다", () => {
    const m = distinctSubjectTokens([
      { key: "a", color: "blue" },
      { key: "b", color: "blue" },
      { key: "c", color: "primary" },
      { key: "d", color: "neutral" },
    ]);
    expect(new Set(m.values()).size).toBe(4);
    expect(m.get("a")).toBe("blue");
    expect(m.get("b")).not.toBe("blue");
    expect(m.get("c")).not.toBe("primary");
  });
  it("토큰 → CSS 색", () => {
    expect(tokenColor("blue")).toBe("var(--color-blue)");
    expect(tokenColor("neutral")).toBe("var(--color-neutral-fill)");
  });
});

describe("flowTotals · flowRowsFor", () => {
  const rows = [
    { month: "2025-01", enrolled: 9, withdrawn: 0 },
    { month: "2025-02", enrolled: 5, withdrawn: 2 },
    { month: "2025-03", enrolled: 1, withdrawn: 4 },
  ];
  it("합계와 순증", () => expect(flowTotals(rows.slice(1))).toEqual({ enrolled: 6, withdrawn: 6, net: 0 }));
  it("기록 시작 전 달은 뺀다", () => expect(flowRowsFor(rows, "all", "2025-02").map((r) => r.month)).toEqual(["2025-02", "2025-03"]));
  it("최근 12개월", () => expect(flowRowsFor(rows, "m12", null)).toHaveLength(3));
  it("등록·퇴원이 처음 있는 달", () => {
    expect(firstFlowMonth(rows)).toBe("2025-01");
    expect(firstFlowMonth([{ month: "2025-01", enrolled: 0, withdrawn: 0 }])).toBeNull();
  });
});

describe("weeklyPoints", () => {
  it("마지막 점은 오늘, 주마다 일요일", () => {
    const pts = weeklyPoints("2026-10-20", 3); // 화요일
    expect(pts.map((x) => x.key)).toEqual(["2026-10-11", "2026-10-18", "2026-10-25"]);
    expect(pts.at(-1)?.date).toBe("2026-10-20");
    expect(pts[0]?.date).toBe("2026-10-11");
  });
  it("오늘이 일요일이면 오늘이 마지막 키", () => {
    expect(weeklyPoints("2026-10-25", 2).map((x) => x.key)).toEqual(["2026-10-18", "2026-10-25"]);
  });
});

describe("breakdownTrendOf", () => {
  const groupOf = (s: string | null) => (s === "english" ? "english" : s === "math" ? "math" : s);
  const st = (id: string, extra: Partial<TrendStudent> = {}): TrendStudent => ({ id, status: "enrolled", enrolledAt: "2025-01-01", withdrawnAt: null, ...extra });
  const en = { firstStart: new Map<string, string>(), ended: new Set<string>() };
  const point = [{ key: "2025-06", label: "6월", date: "2025-06-30" }];
  const keys = ["math", "english", "korean"];
  it("과목별 · 영어만·동시수강·수학만·기타 과목만", () => {
    const out = breakdownTrendOf(
      [st("e"), st("b"), st("m"), st("o")],
      en,
      [
        { studentId: "e", subject: "english", start: "2025-01-01", end: null, transferred: false },
        { studentId: "b", subject: "english", start: "2025-01-01", end: null, transferred: false },
        { studentId: "b", subject: "math", start: "2025-01-01", end: null, transferred: false },
        { studentId: "m", subject: "math", start: "2025-01-01", end: null, transferred: false },
        { studentId: "o", subject: "korean", start: "2025-01-01", end: null, transferred: false },
      ],
      point,
      keys,
      groupOf,
    );
    expect([out.mix.englishOnly[0]!.count, out.mix.both[0]!.count, out.mix.mathOnly[0]!.count, out.mix.otherOnly[0]!.count]).toEqual([1, 1, 1, 1]);
    expect([out.bySubject.math![0]!.count, out.bySubject.english![0]!.count, out.bySubject.korean![0]!.count]).toEqual([2, 2, 1]);
    expect(out.unknown[0]!.count).toBe(0);
  });
  it("🔴 수강 기록 없는 학생은 어느 과목에도 넣지 않고 unknown으로만 센다(운영실 과목 관리자 규칙과 다르다)", () => {
    const out = breakdownTrendOf([st("x"), st("y")], en, [{ studentId: "y", subject: "math", start: "2025-01-01", end: null, transferred: false }], point, keys, groupOf);
    expect(out.bySubject.math![0]!.count).toBe(1);
    expect(out.bySubject.english![0]!.count).toBe(0);
    expect(out.bySubject.korean![0]!.count).toBe(0);
    expect(out.unknown[0]!.count).toBe(1);
  });
  it("그날 끝난 수강·아직 시작 안 한 수강은 넣지 않는다", () => {
    const out = breakdownTrendOf(
      [st("x")],
      en,
      [
        { studentId: "x", subject: "english", start: "2025-01-01", end: "2025-05-31", transferred: false },
        { studentId: "x", subject: "math", start: "2025-01-01", end: null, transferred: false },
        { studentId: "x", subject: "korean", start: "2025-07-01", end: null, transferred: false },
      ],
      point,
      keys,
      groupOf,
    );
    expect(out.mix.mathOnly[0]!.count).toBe(1);
    expect(out.mix.both[0]!.count).toBe(0);
    expect(out.bySubject.korean![0]!.count).toBe(0);
  });
});
