import { describe, expect, it } from "vitest";
import { buildFlowPrompt, latestAt, parseFlowInsight, splitNewRecords, type FlowInsight } from "./flow-insight";

const prior: FlowInsight = {
  headline: "학습 습관 상담이 이어지고 있습니다.",
  direction: "stable",
  themes: ["숙제 이행", "어휘"],
  recentChange: "",
  watch: ["시험 뒤 상담 요청"],
  nextSteps: ["다음 상담에서 숙제 이행 확인"],
  basis: "2026-03~2026-09 상담 5건",
};

describe("합산 — 이전 분석 뒤의 기록만 새 기록", () => {
  const records = [
    { at: "2026-05-13T10:00:00+09:00", text: "중간고사 상담" },
    { at: "2026-07-28T10:00:00+09:00", text: "기말 상담" },
    { at: "2026-09-29T10:00:00+09:00", text: "9월 상담" },
  ];
  it("coveredThrough 뒤의 것만, 같은 시각은 이미 반영", () => {
    expect(splitNewRecords(records, "2026-07-28T10:00:00+09:00").map((r) => r.at.slice(0, 10))).toEqual(["2026-09-29"]);
    expect(splitNewRecords(records, null)).toHaveLength(3);
    expect(latestAt(records)).toBe("2026-09-29T10:00:00+09:00");
    expect(latestAt([])).toBeNull();
  });

  it("첫 분석은 전체, 그 뒤는 이전 분석 + 새 기록 + 합산 지시", () => {
    const first = buildFlowPrompt("consultations", { studentLabel: "김민준(중2)", prior: null, priorThrough: null, records, totalCount: 3 });
    expect(first.prompt).toContain("처음 분석");
    expect(first.prompt).not.toContain("이전 분석");
    expect(first.system).toContain("JSON");
    const next = buildFlowPrompt("timeline", { studentLabel: "김민준(중2)", prior, priorThrough: "2026-07-28T10:00:00+09:00", records: records.slice(2), totalCount: 3 });
    expect(next.prompt).toContain("이전 분석(2026-07-28까지 반영)");
    expect(next.prompt).toContain(JSON.stringify(prior));
    expect(next.prompt).toContain("합산");
    expect(next.prompt).toContain("[2026-09-29] 9월 상담");
    expect(next.system).toContain("타임라인");
  });
});

describe("응답 검증 — 모양이 틀리면 저장하지 않는다", () => {
  it("정상 응답은 그대로, 방향 값이 어긋나거나 항목이 넘치면 거절", () => {
    expect(parseFlowInsight(prior)).toEqual(prior);
    expect(() => parseFlowInsight({ ...prior, direction: "great" })).toThrow();
    expect(() => parseFlowInsight({ ...prior, themes: Array(7).fill("x") })).toThrow();
    expect(() => parseFlowInsight({ ...prior, headline: "" })).toThrow();
  });
});
