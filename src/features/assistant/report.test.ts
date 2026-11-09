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
    // 글 칸에 강조 문법 안내가 붙는다(원장 2026-11-06 서식 요청).
    expect(JSON.stringify(REPORT_TOOL_SCHEMA)).toContain("[[bad:…]]");
  });
});

describe("강조 표시(원장 2026-11-06 *\"중요한 문구에는 색상이나 볼드 등 서식을 자유롭게\"*)", () => {
  const advice = { type: "advice", items: [{ action: "**중2 BS3B** 담임과 이번 주 면담", why: "6개월 퇴원 [[bad:**7명**]]" }] };

  it("글 칸은 표시를 그대로 두고, 글자 수는 표시를 뺀 글로 잰다", () => {
    const body = `${"가".repeat(800)}`;
    const marked = `**${"가".repeat(400)}**${"가".repeat(400)}`;
    const ok = settleReport({ title: "t", blocks: [{ type: "summary", text: marked }, advice] }, results);
    expect(ok.ok && ok.report.blocks[0]).toEqual({ type: "summary", text: marked });
    expect(settleReport({ title: "t", blocks: [{ type: "summary", text: body }, advice] }, results).ok).toBe(true);
    const over = settleReport({ title: "t", blocks: [{ type: "summary", text: `**${"가".repeat(801)}**` }, advice] }, results);
    expect(!over.ok && over.errors.join()).toMatch(/강조 표시를 뺀 글이 1~800자/);
    // 빈 색 표시는 표시가 아니라 글자로 남는다(글이 있다) · 빈 글은 안 된다.
    expect(settleReport({ title: "t", blocks: [{ type: "callout", tone: "warn", title: "주의", text: "[[bad: ]]" }, advice] }, results).ok).toBe(true);
    expect(settleReport({ title: "t", blocks: [{ type: "list", items: ["  "] }, advice] }, results).ok).toBe(false);
  });

  it("제목·이름 칸은 표시를 벗긴다 — 보고서·차트·표 제목 · 칸 이름 · KPI · 목록 제목 · 담당", () => {
    const r = settleReport(
      {
        title: "**신규** 추이",
        blocks: [
          { type: "kpi", items: [{ label: "[[good:신규]]", value: "**12명**", deltaLabel: "**지난달** 대비" }] },
          { type: "chart", kind: "bar", title: "[[bad:월별]]", query: "q1", x: "월", series: [{ column: "신규", label: "**신규**" }] },
          { type: "table", title: "**표**", query: "q1", columns: [{ column: "월", label: "[[warn:월]]" }] },
          { type: "list", title: "**할 일**", items: ["**3반** 연락"] },
          { type: "advice", items: [{ action: "**3반** 연락", why: "[[bad:결석 3번]]", who: "**담임**" }] },
        ],
      },
      results,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.title).toBe("신규 추이");
    const [kpi, chart, table, list, adv] = r.report.blocks as Array<Record<string, unknown>>;
    expect(kpi).toMatchObject({ items: [{ label: "신규", value: "12명", deltaLabel: "지난달 대비" }] });
    expect(chart).toMatchObject({ title: "월별", series: [{ label: "신규" }] });
    expect(table).toMatchObject({ title: "표", columns: [{ label: "월" }] });
    // 목록 제목은 벗기고 항목(글 칸)은 그대로.
    expect(list).toMatchObject({ title: "할 일", items: ["**3반** 연락"] });
    expect(adv).toMatchObject({ items: [{ action: "**3반** 연락", why: "[[bad:결석 3번]]", who: "담임" }] });
  });
});
