// 학원 비서 저장 — 보고서 크기 줄이기(적대 리뷰 2026-11-06: 긴 글 칸 2천 행이 쌓이면 대화가 다시 열리지 않는다).
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import type { SettledReport } from "../report";
import { compactReport } from "./store";

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
