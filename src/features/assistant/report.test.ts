// 학원 비서 보고서 검증 — 차트·표·KPI가 실제 조회 결과를 가리키는지.
import { describe, expect, it } from "vitest";
import { REPORT_TOOL_SCHEMA, settleReport, type QueryResult } from "./report";
import { legendOf, monthsIn, periodIn, unitFix } from "./report-checks";

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

describe("멘트 시험 2026-11-11 — KPI 단위 · KPI 이름의 달 · 글자 칸 ref · 코드 값 · 마무리 중 느슨하게", () => {
  const advice = { type: "advice", items: [{ action: "다음 달도 같은 기준으로 보기", why: "추이를 이어 보려면" }] };
  const kpi = (item: Record<string, unknown>, lenient = false) => settleReport({ title: "t", blocks: [{ type: "kpi", items: [item] }, advice] }, results, { lenient });

  it("단위는 돌려보내지 않고 고친다 — won·percent·people은 한국어로, 모르는 영어(count·number)는 뺀다 · %p 조합은 그대로", () => {
    const r = settleReport(
      { title: "t", blocks: [{ type: "kpi", items: [{ label: "남은 금액", value: 467500, unit: "won" }, { label: "출석률", value: 92.4, unit: "Percent" }, { label: "차이", value: 3, unit: "%p/월" }, { label: "원생", value: 39, unit: "count" }, { label: "인원", value: 3, unit: "people" }] }, advice] },
      results,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const b = r.report.blocks[0];
      expect(b.type === "kpi" && b.items.map((i) => i.unit ?? null)).toEqual(["원", "%", "%p/월", null, "명"]);
    }
    expect(unitFix("  ")).toBeUndefined();
    expect(unitFix("__proto__")).toBeUndefined();
    const chart = settleReport({ title: "t", blocks: [{ type: "chart", kind: "bar", title: "월별", query: "q1", x: "월", series: [{ column: "신규", label: "신규" }], unit: "people" }, advice] }, results);
    expect(chart.ok && chart.report.blocks[0]!.type === "chart" && chart.report.blocks[0]!.unit).toBe("명");
  });

  it("KPI 이름의 달 ≠ 가리킨 줄의 달이면 돌려보낸다 · 마무리 중(lenient)이면 그 KPI만 뺀다", () => {
    const wrong = kpi({ label: "9월 신규", value: 12, ref: { query: "q1", row: 1, column: "신규" } });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.errors[0]).toMatch(/9월인데 가리킨 줄 q1\[1\]은\(는\) 10월.*ref를 빼 주세요/);
    const range = kpi({ label: "9~10월 신규", value: 20, ref: { query: "q1", row: 1, column: "신규" } });
    expect(range.ok).toBe(false);
    if (!range.ok) expect(range.errors[0]).toMatch(/여러 달인데/);
    const loose = settleReport({ title: "t", blocks: [{ type: "kpi", items: [{ label: "9월 신규", value: 12, ref: { query: "q1", row: 1, column: "신규" } }, { label: "10월 신규", value: 1, ref: { query: "q1", row: 1, column: "신규" } }] }, advice] }, results, { lenient: true });
    expect(loose.ok).toBe(true);
    if (loose.ok) expect(loose.report.blocks[0]!.type === "kpi" && loose.report.blocks[0]!.items.map((i) => i.label)).toEqual(["10월 신규"]);
    expect(kpi({ label: "10월 신규", value: 12, ref: { query: "q1", row: 1, column: "신규" } }).ok).toBe(true);
    expect(kpi({ label: "최근 신규", value: 12, ref: { query: "q1", row: 1, column: "신규" } }).ok).toBe(true);
    expect(kpi({ label: "9월 이후 신규", value: 12, ref: { query: "q1", row: 1, column: "신규" } }).ok).toBe(true);
    expect(kpi({ label: "3월~ 신규", value: 12, ref: { query: "q1", row: 1, column: "신규" } }).ok).toBe(true);
  });

  it("오탐 막기(Codex 리뷰 2026-11-11) — 따로 적은 두 달 · 집계 기간이 아닌 칸(등록월·종료월·전달사항)", () => {
    const q: QueryResult = {
      id: "q9", purpose: "p", sql: "s", columns: ["월", "등록월", "종료월", "전달사항", "증감", "상담수", "신규", "출석률"],
      rows: [{ 월: "2026-10", 등록월: "2026-09", 종료월: "2026-10", 전달사항: "10월 등록생 후속 연락", 증감: 4, 상담수: 3, 신규: 20, 출석률: 91.2 }],
      rowCount: 1, truncated: false, ms: 1,
    };
    const one = (label: string, column: string) =>
      settleReport({ title: "t", blocks: [{ type: "kpi", items: [{ label, value: 1, ref: { query: "q9", row: 0, column } }] }, advice] }, new Map([["q9", q]]));
    expect(one("10월 신규 − 9월 신규", "증감").ok).toBe(true);
    expect(one("9월-10월 증감", "증감").ok).toBe(true);
    expect(one("9월 등록생의 10월 출석률", "출석률").ok).toBe(true);
    expect(one("10월 상담 수", "상담수").ok).toBe(true);
    expect(one("9·10월 신규", "신규").ok).toBe(false); // 나열도 여러 달 묶음 — 한 달 줄을 가리키면 돌려보낸다
    const noAxis: QueryResult = { ...q, id: "q8", columns: ["등록월", "종료월", "전달사항", "상담수", "신규"], rows: [{ 등록월: "2026-09", 종료월: "2026-10", 전달사항: "10월 등록생", 상담수: 3, 신규: 20 }] };
    const viaQ8 = (label: string, column: string) =>
      settleReport({ title: "t", blocks: [{ type: "kpi", items: [{ label, value: 1, ref: { query: "q8", row: 0, column } }] }, advice] }, new Map([["q8", noAxis]]));
    expect(viaQ8("11월 상담 수", "상담수").ok).toBe(true);
    expect(viaQ8("9~10월 신규 합계", "신규").ok).toBe(true);
    // 줄의 기간 칸이 연월 범위(2026-05~10)면 여러 달 이름과 맞는다(D9-normal 오탐)
    const span: QueryResult = { ...q, id: "q7", columns: ["기간", "신규"], rows: [{ 기간: "2026-05~10", 신규: 60 }] };
    expect(settleReport({ title: "t", blocks: [{ type: "kpi", items: [{ label: "5~10월 신규 등록", value: 60, ref: { query: "q7", row: 0, column: "신규" } }] }, advice] }, new Map([["q7", span]])).ok).toBe(true);
  });

  it("periodIn — 범위·나열은 묶음, 따로 적은 두 달은 묶음이 아니다 · '개월'·'월별'은 달이 아니다", () => {
    expect([...monthsIn("9~10월 퇴원")]).toEqual([9, 10]);
    expect(periodIn("9월~10월 퇴원")).toEqual({ months: new Set([9, 10]), ranged: true });
    expect(periodIn("9-10월")).toEqual({ months: new Set([9, 10]), ranged: true });
    expect(periodIn("8·9·10월")).toEqual({ months: new Set([8, 9, 10]), ranged: true });
    expect(periodIn("9, 10월")).toEqual({ months: new Set([9, 10]), ranged: true });
    expect(periodIn("9월-10월 증감")).toEqual({ months: new Set([9, 10]), ranged: false });
    expect([...monthsIn("11~2월")].sort((a, b) => a - b)).toEqual([1, 2, 11, 12]);
    expect([...monthsIn("2026-08-01")]).toEqual([8]);
    expect(periodIn("2026-05~10")).toEqual({ months: new Set([5, 6, 7, 8, 9, 10]), ranged: true });
    expect([...periodIn("2025-11~2026-04").months].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 11, 12]);
    expect(monthsIn("최근 3개월 · 월별 · 13월").size).toBe(0);
  });

  it("KPI가 숫자를 쓰고 글자 칸(이름)을 가리키면 돌려보낸다(M3 '원생T 건')", () => {
    const q: QueryResult = { id: "q2", purpose: "p", sql: "s", columns: ["학생", "건수"], rows: [{ 학생: "강민준", 건수: 12 }], rowCount: 1, truncated: false, ms: 1 };
    const r = settleReport({ title: "t", blocks: [{ type: "kpi", items: [{ label: "미발송 건수", value: 12, unit: "건", ref: { query: "q2", row: 0, column: "학생" } }] }, advice] }, new Map([["q2", q]]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/글자 칸\('강민준'\)/);
    const ok = settleReport({ title: "t", blocks: [{ type: "kpi", items: [{ label: "가장 많은 학생", value: "강민준", ref: { query: "q2", row: 0, column: "학생" } }] }, advice] }, new Map([["q2", q]]));
    expect(ok.ok).toBe(true);
  });

  it("표 칸의 영어 코드 값은 돌려보내고(마무리 중이면 그대로) · 칸 이름에 붙인 코드표는 값으로 바꾼다(원장 화면 2026-11-11 'active')", () => {
    const q: QueryResult = {
      id: "q3", purpose: "p", sql: "s", columns: ["강사", "재직", "상태", "구분"],
      rows: [{ 강사: "Florence Park", 재직: "active", 상태: "inactive", 구분: "pending_review" }, { 강사: "김은정", 재직: "inactive", 상태: "active", 구분: "pending_review" }],
      rowCount: 2, truncated: false, ms: 1,
    };
    const table = (columns: Array<{ column: string; label: string }>, lenient = false) =>
      settleReport({ title: "t", blocks: [{ type: "table", title: "강사", query: "q3", columns }, advice] }, new Map([["q3", q]]), { lenient });
    // 칸 이름이 '재직'이면 안전망이 바꾼다
    const a = table([{ column: "강사", label: "강사" }, { column: "재직", label: "재직" }]);
    expect(a.ok && a.report.datasets.q3!.rows.map((r) => r["재직"])).toEqual(["재직", "퇴사"]);
    // 칸 이름에 코드표를 붙였으면 값을 바꾸고 이름을 다듬는다
    const b = table([{ column: "상태", label: "재직 상태(active=재직, inactive=퇴사)" }]);
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.report.datasets.q3!.rows.map((r) => r["상태"])).toEqual(["퇴사", "재직"]);
      const t = b.report.blocks[0]!;
      expect(t.type === "table" && t.columns[0]!.label).toBe("재직 상태");
    }
    // 뜻을 모르는 코드 값은 돌려보낸다 — 마무리 중이면 그대로 둔다
    const c = table([{ column: "구분", label: "구분" }]);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.errors[0]).toMatch(/영어 코드 값\(pending_review\)/);
    expect(table([{ column: "구분", label: "구분" }], true).ok).toBe(true);
    // 사람 이름(대문자)·한국어는 코드가 아니다
    expect(table([{ column: "강사", label: "강사" }]).ok).toBe(true);
  });

  it("legendOf — 코드표 모양만", () => {
    expect(legendOf("재직 상태(active=재직, inactive=퇴사)")).toEqual({ label: "재직 상태", map: new Map([["active", "재직"], ["inactive", "퇴사"]]) });
    expect(legendOf("담당 학생(분모)")).toBeNull();
    expect(legendOf("퇴원율(%)")).toBeNull();
  });
  it("최종 리뷰 2026-11-11 — 코드표는 열쇠가 값에 있을 때만 · 블록 순서와 무관 · 섞인 칸의 남은 코드 · 마무리 중 칸 어긋난 블록은 뺀다", () => {
    const q = (rows: Array<Record<string, unknown>>) => new Map([["q1", { id: "q1", columns: Object.keys(rows[0]!), rows, truncated: false, purpose: "" } as never]]);
    const adv = { type: "advice", items: [{ action: "확인합니다", why: "근거", when: "this_week", who: "원장", noCheck: "확인만" }] };
    // 차트가 표보다 앞이어도 코드표가 먼저 적용된다
    const r1 = q([{ 상태: "active", 인원: 3 }, { 상태: "inactive", 인원: 1 }]);
    const ok = settleReport({ title: "t", blocks: [
      { type: "chart", kind: "bar", title: "c", query: "q1", x: "상태", series: [{ column: "인원", label: "인원" }] },
      { type: "table", title: "t", query: "q1", columns: [{ column: "상태", label: "재직 상태(active=재직, inactive=퇴사)" }, { column: "인원", label: "인원" }] }, adv] }, r1);
    expect(ok.ok ? [] : ok.errors).toEqual([]);
    if (ok.ok) expect(ok.report.datasets.q1!.rows.map((r) => r.상태)).toEqual(["재직", "퇴사"]);
    // 코드표가 아닌 괄호는 남는다
    const r2 = q([{ 출석률: 90 }]);
    const kept = settleReport({ title: "t", blocks: [{ type: "table", title: "t", query: "q1", columns: [{ column: "출석률", label: "출석률(n=25)" }] }, adv] }, r2);
    expect(kept.ok && kept.report.blocks[0]!.type === "table" && kept.report.blocks[0]!.columns[0]!.label).toBe("출석률(n=25)");
    // 코드표를 붙였는데 남은 코드가 있으면 돌려보낸다
    const r3 = q([{ 상태: "active" }, { 상태: "on_hold" }]);
    const left = settleReport({ title: "t", blocks: [{ type: "table", title: "t", query: "q1", columns: [{ column: "상태", label: "상태(active=재직)" }] }, adv] }, r3);
    expect(left.ok).toBe(false);
    // 소문자 영어 이름은 코드가 아니다
    const r4 = q([{ 이름: "amy" }, { 이름: "ben" }]);
    expect(settleReport({ title: "t", blocks: [{ type: "table", title: "t", query: "q1", columns: [{ column: "이름", label: "이름" }] }, adv] }, r4).ok).toBe(true);
    // 마무리 중이면 없는 칸을 가리킨 표는 빼고 답한다
    const lenient = settleReport({ title: "t", blocks: [{ type: "table", title: "t", query: "q1", columns: [{ column: "없는칸", label: "x" }] }, adv] }, r4, { lenient: true });
    expect(lenient.ok && lenient.report.blocks.map((b) => b.type)).toEqual(["advice"]);
  });
  it("차트 가로축 값이 겹치면 돌려보낸다 · 마무리 중이면 그대로(Codex 합의 v3.2 — E26)", () => {
    const rows = [{ 날짜: "2026-11-02", 건수: 3 }, { 날짜: "2026-11-02", 건수: 1 }, { 날짜: "2026-11-03", 건수: 2 }];
    const r = new Map([["q1", { id: "q1", columns: ["날짜", "건수"], rows, truncated: false, purpose: "" } as never]]);
    const adv = { type: "advice", items: [{ action: "확인합니다", why: "근거", when: "this_week", who: "원장", noCheck: "확인만" }] };
    const input = { title: "t", blocks: [{ type: "chart", kind: "bar", title: "c", query: "q1", x: "날짜", series: [{ column: "건수", label: "건수" }] }, adv] };
    const bad = settleReport(input, r);
    expect(bad.ok ? [] : bad.errors.join()).toMatch(/가로축/);
    expect(settleReport(input, r, { lenient: true }).ok).toBe(true);
  });
  it("재리뷰 2026-11-11 — 코드 안전망이 먼저 바꾼 칸도 머리 코드표를 다듬는다 · 띄어 쓴 빗금 · 대문자 열쇠는 코드표가 아니다 · 마무리 중 합계 칸만 빼기", () => {
    expect(legendOf("상태(active=재직 / inactive=퇴사)")?.map.get("inactive")).toBe("퇴사");
    expect(legendOf("등급(A=90점 이상, B=80점 이상)")).toBeNull();
    expect(legendOf("상태(active=재직 inactive=퇴사)")).toBeNull();
    const adv = { type: "advice", items: [{ action: "확인합니다", why: "근거", when: "this_week", who: "원장", noCheck: "확인만" }] };
    const r = new Map([["q1", { id: "q1", columns: ["status", "n"], rows: [{ status: "present", n: 3 }, { status: "absent", n: 1 }], truncated: false, purpose: "" } as never]]);
    const out = settleReport({ title: "t", blocks: [{ type: "table", title: "t", query: "q1", columns: [{ column: "status", label: "출결(present=출석, absent=결석)" }, { column: "n", label: "건수" }], totals: ["n", "없는칸"] }, adv] }, r, { lenient: true });
    expect(out.ok).toBe(true);
    if (out.ok && out.report.blocks[0]!.type === "table") {
      expect(out.report.blocks[0]!.columns[0]!.label).toBe("출결");
      expect(out.report.blocks[0]!.totals).toEqual(["n"]);
    }
  });
  it("재리뷰 2026-11-11 — 아이디 칸(teacher_login)은 코드 검사를 건너뛰고, '계정 상태'의 active는 돌려보낸다", () => {
    const adv = { type: "advice", items: [{ action: "확인합니다", why: "근거", when: "this_week", who: "원장", noCheck: "확인만" }] };
    const r = new Map([["q1", { id: "q1", columns: ["teacher_login", "acct"], rows: [{ teacher_login: "kim_minsu", acct: "active" }, { teacher_login: "lee_ha", acct: "inactive" }], truncated: false, purpose: "" } as never]]);
    expect(settleReport({ title: "t", blocks: [{ type: "table", title: "t", query: "q1", columns: [{ column: "teacher_login", label: "강사" }] }, adv] }, r).ok).toBe(true);
    expect(settleReport({ title: "t", blocks: [{ type: "table", title: "t", query: "q1", columns: [{ column: "acct", label: "계정 상태" }] }, adv] }, r).ok).toBe(false);
  });
});
