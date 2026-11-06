import { describe, expect, it } from "vitest";
import { codeMapFor, labelCodeColumns } from "./code-labels";
import { settleReport, type QueryResult } from "./report";

describe("코드값 → 한국어 이름(원장 2026-11-06 '과목도 한글화')", () => {
  it("한 칸의 값이 모두 한 묶음 코드면 바꾼다 — 출결 상태 · 과목 · 원생 상태", () => {
    const rows = [
      { 상태: "present", 건수: 10, 과목: "math" },
      { 상태: "absent", 건수: 2, 과목: "english" },
      { 상태: "late", 건수: 1, 과목: null },
    ];
    expect(labelCodeColumns(["상태", "건수", "과목"], rows)).toEqual([
      { 상태: "출석", 건수: 10, 과목: "수학" },
      { 상태: "결석", 건수: 2, 과목: "영어" },
      { 상태: "지각", 건수: 1, 과목: null },
    ]);
    expect(codeMapFor(["enrolled", "on_hold", "withdrawn"])).toEqual({ enrolled: "재원", on_hold: "휴원", withdrawn: "퇴원" });
  });

  it("다른 글자가 섞인 칸 · 흔한 낱말 · 숫자 칸은 그대로 — 엉뚱한 이름보다 원문", () => {
    const rows = [{ 반: "math 심화", 과목: "math", 메모: "active" }, { 반: "초등M", 과목: "social", 메모: "manual" }];
    // 과목 칸에 묶음 밖 키(social)가 있으면 그 칸 전체를 두고, 반 이름·흔한 낱말 칸도 그대로
    expect(labelCodeColumns(["반", "과목", "메모"], rows)).toBe(rows);
    expect(codeMapFor([1, 2, true, null])).toBeNull();
    expect(codeMapFor([])).toBeNull();
  });

  it("다른 표에서 뜻이 갈리는 원생 상태 코드는 하나만 있으면 그대로 — 보강 건 보류·상담 결과 등록(적대 리뷰)", () => {
    expect(codeMapFor(["on_hold"])).toBeNull(); // makeup_cases.lifecycle의 '보류'를 '휴원'으로 바꾸지 않는다
    expect(codeMapFor(["enrolled", "enrolled"])).toBeNull(); // 상담 결과 '등록'을 '재원'으로 바꾸지 않는다
    expect(codeMapFor(["enrolled", "withdrawn"])).toEqual({ enrolled: "재원", withdrawn: "퇴원" });
    expect(codeMapFor(["excused"])).toEqual({ excused: "공결" }); // 앱 출석부 말
  });

  it("AI가 CASE로 일부만 바꾼 칸 — 한국어 값은 건너뛰고 남은 코드만 바꾼다", () => {
    const rows = [{ 상태: "출석" }, { 상태: "makeup" }, { 상태: "결석" }];
    expect(labelCodeColumns(["상태"], rows)).toEqual([{ 상태: "출석" }, { 상태: "보강" }, { 상태: "결석" }]);
    expect(codeMapFor(["출석", "결석"])).toBeNull(); // 이미 다 한국어면 할 일 없음
  });

  it("여러 묶음에 맞으면 이름이 같을 때만 — teacher는 역할·입력 주체 둘 다 '강사'", () => {
    expect(codeMapFor(["teacher"])).toEqual({ teacher: "강사" });
    expect(codeMapFor(["teacher", "desk"])).toEqual({ teacher: "강사", desk: "데스크" });
    expect(codeMapFor(["teacher", "admin"])).toEqual({ teacher: "강사", admin: "관리자" });
  });

  it("보고서 자료·KPI ref는 바꾼 이름 · AI가 본 원래 결과는 그대로", () => {
    const q1: QueryResult = {
      id: "q1",
      purpose: "출결 상태별 건수",
      sql: "select 1",
      columns: ["상태", "건수"],
      rows: [{ 상태: "present", 건수: 30 }, { 상태: "absent", 건수: 3 }],
      rowCount: 2,
      truncated: false,
      ms: 5,
    };
    const results = new Map([["q1", q1]]);
    const out = settleReport(
      {
        title: "출결",
        blocks: [
          { type: "kpi", items: [{ label: "가장 많은 상태", value: "?", ref: { query: "q1", row: 0, column: "상태" } }] },
          { type: "chart", kind: "pie", title: "구성", query: "q1", x: "상태", series: [{ column: "건수", label: "건수" }] },
          { type: "advice", items: [{ action: "결석 학생 연락", why: "결석 3건", when: "this_week" }] },
        ],
      },
      results,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.report.datasets.q1.rows).toEqual([{ 상태: "출석", 건수: 30 }, { 상태: "결석", 건수: 3 }]);
    expect(out.report.blocks[0]).toMatchObject({ items: [{ value: "출석" }] });
    expect(q1.rows[0].상태).toBe("present");
  });
});
