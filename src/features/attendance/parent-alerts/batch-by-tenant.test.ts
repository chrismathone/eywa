import { describe, expect, it } from "vitest";
import { batchesByTenant } from "./batch-by-tenant";

const row = (id: string, tenant_id: string | null) => ({ id, tenant_id });

describe("batchesByTenant — AI 프롬프트 한 장엔 한 지점의 글만", () => {
  it("지점이 섞여 들어와도 배치는 지점 경계에서 끊긴다", () => {
    const rows = [row("1", "A"), row("2", "B"), row("3", "A"), row("4", "B"), row("5", "A")];
    const batches = batchesByTenant(rows, 2);
    expect(batches.map((b) => b.map((r) => r.id))).toEqual([["1", "3"], ["5"], ["2", "4"]]);
    for (const b of batches) expect(new Set(b.map((r) => r.tenant_id)).size).toBe(1);
  });

  it("지점이 하나면 종전과 같은 자르기(순서 보존)", () => {
    const rows = [row("1", "A"), row("2", "A"), row("3", "A")];
    expect(batchesByTenant(rows, 2).map((b) => b.map((r) => r.id))).toEqual([["1", "2"], ["3"]]);
  });

  it("모든 행이 정확히 한 번씩 들어간다 · 빈 입력은 빈 배열 · 지점 없는 행은 따로", () => {
    const rows = [row("1", null), row("2", "A"), row("3", null)];
    const flat = batchesByTenant(rows, 10).flat().map((r) => r.id).sort();
    expect(flat).toEqual(["1", "2", "3"]);
    expect(batchesByTenant([], 12)).toEqual([]);
    expect(batchesByTenant(rows, 10).map((b) => b.map((r) => r.tenant_id))).toEqual([[null, null], ["A"]]);
  });
});
