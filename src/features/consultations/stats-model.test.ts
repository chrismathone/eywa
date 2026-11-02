import { describe, expect, it } from "vitest";
import {
  bucketLabel,
  dateSpanText,
  metricSeries,
  parseConsultationStatsPrefs,
  pct,
  trendWindowText,
  type StatsBucket,
} from "./stats-model";
import { consultationsHref } from "./list-href";

const b = (d: string, over: Partial<StatsBucket> = {}): StatsBucket => ({
  b: d,
  n: 10,
  students: 5,
  done: 3,
  pending: 1,
  audio: 2,
  ai: 1,
  synced: 4,
  mapped: 6,
  ...over,
});

describe("상담 통계 모델", () => {
  it("보기 설정은 모르는 값을 기본값으로 접는다(월·건수·상담사)", () => {
    expect(parseConsultationStatsPrefs(null)).toEqual({ unit: "month", metric: "count", dim: "counselor", hrSort: { key: "name", dir: "asc" }, hrFilter: { subject: null, teachers: [], unmetOnly: false, unmetStudentsOnly: false }, hrView: "table" });
    expect(parseConsultationStatsPrefs({ stats_unit: "week", stats_metric: "follow", stats_dim: "class" })).toEqual({
      unit: "week",
      metric: "follow",
      dim: "class",
      hrSort: { key: "name", dir: "asc" }, hrFilter: { subject: null, teachers: [], unmetOnly: false, unmetStudentsOnly: false }, hrView: "table",
    });
    expect(parseConsultationStatsPrefs({ stats_unit: "day", stats_metric: "x", stats_dim: [] })).toEqual({
      unit: "month",
      metric: "count",
      dim: "counselor",
      hrSort: { key: "name", dir: "asc" }, hrFilter: { subject: null, teachers: [], unmetOnly: false, unmetStudentsOnly: false }, hrView: "table",
    });
    expect(parseConsultationStatsPrefs({ hr_view: "gauge" }).hrView).toBe("gauge");
    expect(parseConsultationStatsPrefs({ hr_sort: "avg" }).hrSort).toEqual({ key: "name", dir: "asc" }); // 평균 열 폐지 — 옛 저장값은 이름순
    expect(parseConsultationStatsPrefs({ hr_sort: "m0" }).hrSort).toEqual({ key: "m0", dir: "asc" });
    expect(parseConsultationStatsPrefs({ hr_sort: "unmet", hr_dir: "asc" }).hrSort).toEqual({ key: "unmet", dir: "asc" });
  });

  it("비율은 분모가 0이면 null(0%라고 적지 않는다)", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 0)).toBeNull();
  });

  it("버킷 라벨 — 월(1월이면 해), 주(월요일 날짜)", () => {
    expect(bucketLabel("2026-09-01", "month")).toBe("9월");
    expect(bucketLabel("2026-01-01", "month")).toBe("26년 1월");
    expect(bucketLabel("2026-09-28", "week")).toBe("9/28");
  });

  it("지표 → 추이 줄: 후속 완료율 = 완료 ÷ (완료 + 미완료), 반 없는 상담 = (상담 − 연결) ÷ 상담", () => {
    const rows = [b("2026-08-01"), b("2026-09-01", { n: 0, students: 0, done: 0, pending: 0, audio: 0, ai: 0, synced: 0, mapped: 0 })];
    expect(metricSeries(rows, "follow", "month").points.map((p) => p.v)).toEqual([75, null]);
    expect(metricSeries(rows, "class", "month").points.map((p) => p.v)).toEqual([40, null]);
    expect(metricSeries(rows, "perStudent", "month").points.map((p) => p.v)).toEqual([2, null]);
    expect(metricSeries(rows, "count", "month")).toMatchObject({ unit: "건", points: [{ v: 10, label: "8월" }, { v: 0 }] });
    const media = metricSeries(rows, "media", "month");
    expect(media.lines.map((l) => l.name)).toEqual(["녹음", "AI 분석"]);
    expect(media.points[0]).toMatchObject({ audio: 20, ai: 10 });
  });

  it("추이 창 문구는 연도를 밝힌다", () => {
    const months = ["2025-10-01", "2025-11-01", "2026-09-01"].map((d) => b(d));
    expect(trendWindowText(months, "month")).toBe("최근 3개월(25년 10월~26년 9월)");
    expect(trendWindowText([b("2026-07-01"), b("2026-09-01")], "month")).toBe("최근 2개월(26년 7월~9월)");
    expect(trendWindowText([b("2026-07-13"), b("2026-09-28")], "week")).toBe("최근 2주(7/13 주~9/28 주)");
  });

  it("기간 글자 — 같은 해면 월/일만", () => {
    expect(dateSpanText("2026-01-05", "2026-09-30")).toBe("1/5~9/30");
    expect(dateSpanText("2025-12-01", "2026-01-05")).toBe("25.12/1~26.1/5");
  });
});

describe("원생상담 목록 주소", () => {
  const base = { range: "30d", cat: "all", urg: "all", who: "", subject: "", q: "", size: 12, page: 3 };

  it("쪽 넘김은 필터를 지키고 쪽만 바꾼다(기본 쪽 크기는 주소에 안 싣는다)", () => {
    expect(consultationsHref(base, 12)).toBe("/consultations?range=30d&page=3");
    expect(consultationsHref({ ...base, size: 20, page: 1 }, 12)).toBe("/consultations?range=30d&size=20");
  });

  it("필터를 바꾸면 1쪽으로 간다(같은 번호가 다른 행을 가리키지 않게)", () => {
    expect(consultationsHref(base, 12, { cat: "academic" })).toBe("/consultations?range=30d&cat=academic");
    expect(consultationsHref(base, 12, { who: "u1" })).toBe("/consultations?range=30d&who=u1");
  });
});
