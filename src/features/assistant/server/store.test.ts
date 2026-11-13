// 학원 비서 저장 — 보고서 크기 줄이기(적대 리뷰 2026-11-06: 긴 글 칸 2천 행이 쌓이면 대화가 다시 열리지 않는다).
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import type { SettledReport } from "../report";
import { compactReport, keepHistoryTurns, kpiFromData } from "./store";

const report = (rows: Array<Record<string, string | number | null>>, extra: SettledReport["datasets"] = {}): SettledReport => ({
  title: "t",
  blocks: [{ type: "summary", text: "s" }],
  datasets: { q1: { columns: Object.keys(rows[0] ?? {}), rows, truncated: false, purpose: "p" }, ...extra },
});

describe("compactReport", () => {
  it("작은 보고서는 그대로", () => {
    const r = report([{ 이름: "가", 수: 1 }]);
    expect(compactReport(r)).toEqual(r);
  });

  it("긴 글 칸은 2천 자로 자르고 서러게이트 쌍을 가르지 않는다", () => {
    const long = `${"가".repeat(1999)}😀끝`;
    const out = compactReport(report([{ 메모: long }]));
    const cell = out.datasets.q1!.rows[0]!.메모 as string;
    expect(cell).toBe(`${"가".repeat(1999)}…`);
  });

  it("전체가 크면 가장 큰 자료부터 행을 줄이고 '일부만'으로 표시한다", () => {
    const big = Array.from({ length: 2000 }, (_, i) => ({ 번호: i, 메모: "나".repeat(1500) }));
    const small = { q2: { columns: ["a"], rows: [{ a: 1 }], truncated: false, purpose: "작은 것" } };
    const out = compactReport(report(big, small));
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(400_000);
    expect(out.datasets.q1!.truncated).toBe(true);
    expect(out.datasets.q1!.rows.length).toBeLessThan(2000);
    expect(out.datasets.q1!.rows[0]).toEqual(big[0]);
    // 작은 자료는 건드리지 않는다.
    expect(out.datasets.q2).toEqual(small.q2);
  });
});

describe("다시 연 답의 KPI — 한국어 이름으로 바꾼 자료와 맞춘다(재리뷰 2026-11-06)", () => {
  it("ref 글자 값만 자료 값으로 · 숫자·ref 없음·없는 줄은 그대로", () => {
    const blocks: SettledReport["blocks"] = [
      {
        type: "kpi",
        items: [
          { label: "과목", value: "math", ref: { query: "q1", row: 0, column: "과목" } },
          { label: "인원", value: 12, ref: { query: "q1", row: 0, column: "인원" } },
          { label: "메모", value: "그대로" },
          { label: "없는 줄", value: "english", ref: { query: "q1", row: 9, column: "과목" } },
        ],
      },
      { type: "summary", text: "요약" },
    ];
    const data: SettledReport["datasets"] = { q1: { columns: ["과목", "인원"], rows: [{ 과목: "수학", 인원: 12 }], truncated: false, purpose: "과목별 인원" } };
    const out = kpiFromData(blocks, data);
    expect(out[0]).toMatchObject({ items: [{ value: "수학" }, { value: 12 }, { value: "그대로" }, { value: "english" }] });
    expect(out[1]).toBe(blocks[1]);
  });
});

describe("이력에서 빼는 차례(단일 모델 재질문 · 2026-11-13)", () => {
  const row = (id: string, question: string, level: string) => ({ id, question, level });
  it("다시 묻는 원래 답(exclude)을 뺀다", () => {
    expect(keepHistoryTurns([row("M2", "Q", "high"), row("M1", "Q", "low")], "M1").map((r) => r.id)).toEqual(["M2"]);
  });
  it("같은 질문의 최신 완료 답만 남기며 옛 강도는 우선순위가 아니다", () => {
    const rows = [row("M4", "다른 질문", "normal"), row("M3", "Q", "high"), row("M2", "Q", "low"), row("M1", "Q", "high")];
    expect(keepHistoryTurns(rows, null).map((r) => r.id)).toEqual(["M4", "M3"]);
    expect(keepHistoryTurns([row("M2", "Q", "low"), row("M1", "Q", "low")], null).map((r) => r.id)).toEqual(["M2"]);
    expect(keepHistoryTurns([row("new-terra", "Q", "low"), row("old-opus", "Q", "high")], null).map((r) => r.id)).toEqual(["new-terra"]);
  });
  it("멈춘·실패한 다시 묻기는 앞의 실제 답을 밀어내지 않는다", () => {
    const rows = [{ ...row("M2", "Q", "high"), status: "failed" }, { ...row("M1", "Q", "low"), status: "done" }];
    expect(keepHistoryTurns(rows, null).map((r) => r.id)).toEqual(["M2", "M1"]);
  });
});
