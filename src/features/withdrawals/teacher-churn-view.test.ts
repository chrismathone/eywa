import { describe, expect, it } from "vitest";
import type { ChurnCell, ChurnMonth, ChurnTeacherRow } from "./teacher-churn";
import {
  autoEmphasis, chartCeil, chartMonths, dupName, monthBrief, nearestAt, parseChurnView, pointsOf, segmentsOf, spreadLabels, tenureBand,
} from "./teacher-churn-view";

const ok = (rate: number, base = 40, counted = 2, closed = true): ChurnCell => ({ state: "ok", rate, base, counted, closed, end: "" });
const row = (cells: Record<string, ChurnCell>, hireDate: string | null = null, resignDate: string | null = null): ChurnTeacherRow =>
  ({ id: "t", name: "강사", subjects: [], subjectsByMonth: {}, hireDate, resignDate, resigned: !!resignDate, cells });
const months = (list: [string, boolean][]): ChurnMonth[] => list.map(([month, partial]) => ({ month, partial, ends: [] }));

describe("parseChurnView — 계정에 저장된 보기", () => {
  it("차트만 알아보고 나머지는 표(기본)", () => {
    expect(parseChurnView("chart")).toBe("chart");
    expect(parseChurnView("table")).toBe("table");
    expect(parseChurnView(undefined)).toBe("table");
    expect(parseChurnView("graph")).toBe("table");
  });
});

describe("tenureBand — 표 칸 색과 차트 띠가 같은 판정", () => {
  it("입사 다음 달 전 = before · 퇴사한 달 뒤 = after · 그 사이는 null", () => {
    const r = row({}, "2026-07-07", "2026-10-15");
    expect(tenureBand(r, "2026-07")).toBe("before");
    expect(tenureBand(r, "2026-08")).toBeNull();
    expect(tenureBand(r, "2026-10")).toBeNull();
    expect(tenureBand(r, "2026-11")).toBe("after");
  });
  it("재입사 — 입사일보다 앞선 옛 퇴사일로 지금 재직을 '퇴사 뒤'로 칠하지 않는다", () => {
    const r = row({}, "2026-01-16", "2023-02-28");
    expect(tenureBand(r, "2026-05")).toBeNull();
    expect(tenureBand(r, "2026-01")).toBe("before");
  });
  it("날짜를 모르면 띠 없음", () => {
    expect(tenureBand(row({}), "2026-05")).toBeNull();
  });
});

describe("pointsOf · chartMonths — 차트 값 = 표 칸 값(마감한 퇴원율만)", () => {
  const ms = months([["2026-08", false], ["2026-09", false], ["2026-10", false], ["2026-11", true]]);
  it("진행 중인 달은 가로 축에서 뺀다", () => {
    expect(chartMonths(ms).map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
  it("마감 전·담당 없음·확인 불가·칸 없음은 점이 없다(0으로 그리지 않는다)", () => {
    const r = row({
      "2026-08": { state: "noBase", rate: null, base: 0, counted: 0, closed: true, end: "" },
      "2026-09": ok(5.1, 39, 2, false),
      "2026-10": { state: "unreadable", rate: null, base: 0, counted: 0, closed: true, end: "" },
    });
    expect(pointsOf(r, chartMonths(ms))).toEqual([null, null, null]);
  });
  it("담당 10명 미만은 작은 분모 표시", () => {
    const r = row({ "2026-08": ok(12.5, 8, 1), "2026-10": ok(2.4, 41, 1) });
    expect(pointsOf(r, chartMonths(ms))).toEqual([
      { rate: 12.5, counted: 1, base: 8, small: true }, null, { rate: 2.4, counted: 1, base: 41, small: false },
    ]);
  });
});

describe("chartCeil — 모든 강사 같은 세로 눈금", () => {
  const ms = months([["2026-09", false], ["2026-10", false]]);
  it("보이는 점의 최댓값을 5 단위로 올림", () => {
    expect(chartCeil([row({ "2026-09": ok(13.2) }), row({ "2026-10": ok(33.3) })], ms)).toBe(35);
    expect(chartCeil([row({ "2026-09": ok(15) })], ms)).toBe(15);
  });
  it("가장 낮아도 10 · 마감 전 값은 눈금에 넣지 않는다", () => {
    expect(chartCeil([row({ "2026-09": ok(2.1), "2026-10": ok(40, 40, 16, false) })], ms)).toBe(10);
    expect(chartCeil([], ms)).toBe(10);
  });
});

describe("segmentsOf — 빈 달을 건너 잇지 않는다", () => {
  const p = { rate: 1, counted: 1, base: 40, small: false };
  it("이웃한 달끼리만 한 구간", () => {
    expect(segmentsOf([p, p, null, p, null, null, p, p])).toEqual([[0, 1], [3], [6, 7]]);
    expect(segmentsOf([null, null])).toEqual([]);
  });
});

describe("monthBrief — 고른 달 한 줄(표 칸과 같은 상태 이름)", () => {
  const r = row({}, "2026-07-07", "2026-10-15");
  it("칸이 없으면 재직 밖·평가 대상 아님", () => {
    expect(monthBrief(r, "2026-07", undefined)).toBe("입사 전");
    expect(monthBrief(r, "2026-11", undefined)).toBe("퇴사 뒤");
    expect(monthBrief(r, "2026-09", undefined)).toBe("평가 대상 아님");
  });
  it("퇴원율 · 그만둠/담당 · 마감 전", () => {
    expect(monthBrief(r, "2026-09", ok(3.9, 51, 2))).toBe("3.9% · 2/51명");
    expect(monthBrief(r, "2026-10", ok(7.4, 54, 4, false))).toBe("7.4% · 4/54명 · 마감 전");
    expect(monthBrief(r, "2026-09", { state: "noBase", rate: null, base: 0, counted: 0, closed: true, end: "" })).toBe("담당 없음");
    expect(monthBrief(r, "2026-09", { state: "unreadable", rate: null, base: 0, counted: 0, closed: true, end: "" })).toBe("확인 불가");
    expect(monthBrief(r, "2026-10", { state: "unreadable", rate: null, base: 0, counted: 0, closed: false, end: "" })).toBe("확인 불가 · 마감 전");
  });
});

describe("autoEmphasis — 고른 강사가 없을 때 강조할 셋", () => {
  const t = (id: string, name: string, cell?: ChurnCell): ChurnTeacherRow =>
    ({ ...row(cell ? { "2026-10": cell } : {}), id, name });
  it("마지막 달 마감한 퇴원율 높은 순 셋 · 같은 값이면 이름순", () => {
    const rows = [t("a", "다", ok(5)), t("b", "가", ok(9)), t("c", "나", ok(5)), t("d", "라", ok(2)), t("e", "마", ok(5))];
    expect(autoEmphasis(rows, "2026-10")).toEqual(["b", "c", "a"]);
  });
  it("0% · 마감 전 · 담당 없음 · 칸 없음은 강조하지 않는다", () => {
    const rows = [
      t("a", "가", ok(0)), t("b", "나", ok(8, 40, 3, false)), t("c", "다", { state: "noBase", rate: null, base: 0, counted: 0, closed: true, end: "" }),
      t("d", "라"), t("e", "마", ok(4)),
    ];
    expect(autoEmphasis(rows, "2026-10")).toEqual(["e"]);
  });
});

describe("nearestAt — 마우스에서 가장 가까운 선", () => {
  const vals = [{ id: "a", rate: 2 }, { id: "b", rate: null }, { id: "c", rate: 6 }, { id: "d", rate: 6 }];
  it("거리 안에서 가장 가까운 것 · 같은 거리면 앞 줄", () => {
    expect(nearestAt(vals, 5, 2)).toBe("c");
    expect(nearestAt(vals, 2.4, 1)).toBe("a");
  });
  it("모두 멀면 null · 값 없는 선은 보지 않는다", () => {
    expect(nearestAt(vals, 4, 1)).toBeNull();
    expect(nearestAt([{ id: "b", rate: null }], 0, 100)).toBeNull();
  });
});

describe("spreadLabels — 선 끝 이름표가 겹치지 않게", () => {
  it("가까운 이름표를 차례 그대로 벌린다", () => {
    const m = spreadLabels([{ id: "a", y: 50 }, { id: "b", y: 52 }, { id: "c", y: 10 }], 6);
    expect(m.get("c")).toBe(10);
    expect(m.get("a")).toBe(50);
    expect(m.get("b")).toBe(56);
  });
  it("아래 끝을 넘으면 위로 되민다", () => {
    const m = spreadLabels([{ id: "a", y: 98 }, { id: "b", y: 100 }], 6);
    expect(m.get("b")).toBe(100);
    expect(m.get("a")).toBe(94);
  });
});

describe("dupName — 같은 이름은 뒤 사람에 번호", () => {
  it("둘째부터 (2)", () => {
    const rows = [{ name: "김" }, { name: "이" }, { name: "김" }];
    expect([0, 1, 2].map((i) => dupName(rows, i))).toEqual(["김", "이", "김 (2)"]);
  });
});
