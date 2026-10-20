import { describe, expect, it } from "vitest";
import { metricBar } from "./metric-bar";
import { satisfactionTag } from "./satisfaction-tag";

describe("항목 막대", () => {
  it("만점 있는 항목 = 왼쪽부터 채운다(전월 눈금도 같은 축)", () => {
    expect(metricBar(15, 10, 20)).toEqual({ signed: false, left: 0, width: 75, before: 50 });
    expect(metricBar(null, undefined, 20)).toEqual({ signed: false, left: 0, width: 0, before: null });
  });
  it("가감(만점 0) = 0을 가운데 두고 ±5점이 양 끝 — +2점은 오른쪽으로 20%(원장 2026-10-16)", () => {
    expect(metricBar(2, null, 0)).toEqual({ signed: true, left: 50, width: 20, before: null });
    expect(metricBar(-1, 2, 0)).toEqual({ signed: true, left: 40, width: 10, before: 70 });
    expect(metricBar(0, undefined, 0)).toEqual({ signed: true, left: 50, width: 0, before: null });
    expect(metricBar(null, undefined, 0)).toMatchObject({ signed: true, left: 50, width: 0 });
  });
  it("±5점을 넘으면 끝이 그 값까지 늘어난다", () => {
    expect(metricBar(10, -5, 0)).toEqual({ signed: true, left: 50, width: 50, before: 25 });
  });
  it("축은 넘겨받으면 그대로 — 보이는 달 중 하나라도 음수인 항목은 양수 달도 가운데 축", () => {
    expect(metricBar(6, 4, 10, true)).toEqual({ signed: true, left: 50, width: 30, before: 70 });
    expect(metricBar(6, 4, 10)).toMatchObject({ signed: false, width: 60 });
  });
  it("만점 있는 항목도 음수면 가운데 축(한쪽 끝 = 만점)", () => {
    expect(metricBar(-2, null, 10)).toEqual({ signed: true, left: 40, width: 10, before: null });
    expect(metricBar(5, -10, 10)).toEqual({ signed: true, left: 50, width: 25, before: 0 });
  });
});

describe("만족도 확인 대기 꼬리표", () => {
  it("문구가 애매한 글 = '애매' · 긴 사유는 카드로", () => {
    expect(satisfactionTag({ ai: false, verdict: null, reason: "감점에 완곡어" })).toEqual({ label: "애매", title: "문구 판정 애매 — 가점·감점이 확실하지 않습니다", lines: ["감점에 완곡어"] });
  });
  it("문구는 확실한데 과목을 못 가린 글은 '애매'가 아니다", () => {
    expect(satisfactionTag({ ai: false, verdict: "plus", reason: "과목을 모르는 보드" }).label).toBe("가점 확인");
  });
  it("AI 제안", () => {
    expect(satisfactionTag({ ai: true, verdict: "minus", reason: null })).toEqual({ label: "AI 감점", title: "AI 판정 — 감점 제안", lines: [] });
    expect(satisfactionTag({ ai: true, verdict: null, reason: null }).label).toBe("AI 보류");
  });
});
