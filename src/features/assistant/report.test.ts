// 학원 비서 보고서 검증 — 차트·표·KPI가 실제 조회 결과를 가리키는지.
import { describe, expect, it } from "vitest";
import { REPORT_TOOL_SCHEMA, settleReport, type QueryResult } from "./report";

const q1: QueryResult = {
  id: "q1",
  purpose: "월별 신규 원생",
  sql: "select …",
  columns: ["월", "신규", "퇴원"],
  rows: [
    { 월: "2026-09", 신규: 8, 퇴원: 3 },
    { 월: "2026-10", 신규: 12, 퇴원: 4 },
  ],
  rowCount: 2,
  truncated: false,
  ms: 12,
};
const results = new Map([["q1", q1]]);

describe("settleReport", () => {
  it("차트·표가 가리킨 조회만 datasets에 싣는다", () => {
    const r = settleReport(
      {
        title: "신규·퇴원 추이",
        blocks: [
          { type: "summary", text: "10월 신규가 늘었습니다." },
          { type: "chart", kind: "bar", title: "월별", query: "q1", x: "월", series: [{ column: "신규", label: "신규" }] },
          { type: "table", title: "표", query: "q1", columns: [{ column: "월", label: "월" }, { column: "퇴원", label: "퇴원", format: "number" }], totals: ["퇴원"] },
          { type: "advice", items: [{ action: "다음 달도 같은 기준으로 보기", why: "추이를 이어 보려면" }] },
        ],
      },
      results,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.report.datasets)).toEqual(["q1"]);
  });

  it("KPI ref는 AI가 쓴 값 대신 조회 값으로 맞춘다", () => {
    const r = settleReport(
      { title: "t", blocks: [{ type: "kpi", items: [{ label: "10월 신규", value: 13, ref: { query: "q1", row: 1, column: "신규" } }] }, { type: "advice", items: [{ action: "다음 달도 같은 기준으로 보기", why: "추이를 이어 보려면" }] }] },
      results,
    );
    expect(r.ok && r.report.blocks[0]).toMatchObject({ items: [{ value: 12 }] });
  });

  it("없는 조회·없는 칸·없는 행은 이유와 함께 돌려보낸다", () => {
    const r = settleReport(
      {
        title: "t",
        blocks: [
          { type: "chart", kind: "line", title: "a", query: "q9", x: "월", series: [{ column: "신규", label: "신규" }] },
          { type: "table", title: "b", query: "q1", columns: [{ column: "재원", label: "재원" }] },
          { type: "kpi", items: [{ label: "x", value: 1, ref: { query: "q1", row: 5, column: "신규" } }] },
        ],
      },
      results,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/q9가 없습니다/);
      expect(r.errors.join("\n")).toMatch(/칸 재원가 없습니다/);
      expect(r.errors.join("\n")).toMatch(/q1\[5\]/);
    }
  });

  it("비서 의견이 없거나 둘이면 돌려보낸다", () => {
    const none = settleReport({ title: "t", blocks: [{ type: "summary", text: "요약" }] }, results);
    expect(!none.ok && none.errors.join()).toMatch(/비서 의견\(advice\) 블록이 없습니다/);
    const two = settleReport({ title: "t", blocks: [{ type: "advice", items: [{ action: "다음 달도 같은 기준으로 보기", why: "추이를 이어 보려면" }] }, { type: "advice", items: [{ action: "다음 달도 같은 기준으로 보기", why: "추이를 이어 보려면" }] }] }, results);
    expect(!two.ok && two.errors.join()).toMatch(/하나만/);
  });

  it("모양이 틀리면 경로와 함께 돌려보낸다", () => {
    const r = settleReport({ title: "t", blocks: [{ type: "chart", kind: "radar" }] }, results);
    expect(r.ok).toBe(false);
  });

  it("도구 스키마는 JSON 스키마 객체", () => {
    expect(REPORT_TOOL_SCHEMA).toMatchObject({ type: "object" });
    expect(JSON.stringify(REPORT_TOOL_SCHEMA)).toContain("stacked_bar");
  });
});
