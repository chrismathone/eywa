import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const require = createRequire(import.meta.url);
const script = fs.readFileSync(path.join(__dirname, "import-invoices.cjs"), "utf8");
async function runImporter(data: object, options: {dryRun?: boolean; students?: object[]} = {}) {
  const writes = vi.fn();
  const recordSync = vi.fn();
  const reports = vi.fn(() => ({jsonPath: "test-report.json"}));
  const logs = vi.fn();
  const query = Object.assign(async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (/\b(insert|update|delete)\b/i.test(text)) { writes(text); throw new Error("Unexpected DB write"); }
    if (/from students/.test(text)) return (options.students ?? [{ id: "student", name: "테스트", grade: "초6", makeedu_id: "123" }]).map(row => {
      const projected = {...row} as Record<string, unknown>;
      if (!/\bnotes\b/.test(text)) delete projected.notes;
      return projected;
    });
    return [];
  }, { end: async () => {} });
  const processMock = { argv: ["node", "import-invoices.cjs", ...(options.dryRun ? [] : ["--apply"])], env: {}, exitCode: 0 };
  const files = { readFileSync: () => JSON.stringify(data), existsSync: () => false };
  await vm.runInNewContext(script, {
    require: (name: string) => name === "postgres" ? () => query : name === "fs" ? files : name === "./lib.cjs"
      ? { ...require("./lib.cjs"), resolveTenantId: async () => "tenant", recordSync }
      : name === "./invoice-stale.cjs" ? {...require(name), writeReport: reports}
      : require(name),
    __dirname,
    process: processMock,
    console: { log: logs, warn: () => {}, error: () => {} },
  });
  return { writes, recordSync, reports, logs, code: processMock.exitCode };
}
it("외부 수납 합계가 다르면 invoice 쓰기를 한 건도 시작하지 않고 실패를 기록한다", async () => {
  const result = await runImporter({
    headers: ["원생고유번호", "이름", "학년", "청구월", "구분", "수납명", "청구액", "할인액", "적립금", "실제낸금액", "미납"],
    rows: [["123", "테스트", "초6", "2026.09", "수업", "수업 A", "1,000", "0", "0", "0", "0"]],
    totalReported: 1,
    reportedSummary: { lines: 1, total: 1000, discount: 0, points: 0, paid: 1000, unpaid: 0 },
  });
  expect(result.code).toBe(1);
  expect(result.writes).not.toHaveBeenCalled();
  expect(result.recordSync).toHaveBeenCalledWith(expect.anything(), "tenant", "invoices", null, "error", expect.stringContaining("수납 -1,000원"));
});
it("원래 수집 실패 원인을 보존하며 빈 스크랩을 저장하지 않는다", async () => {
  const result = await runImporter({ headers: [], rows: [], error: "환불 상세 확인 불가: 환불금액" });
  expect(result.code).toBe(1);
  expect(result.writes).not.toHaveBeenCalled();
  expect(result.recordSync).toHaveBeenCalledWith(expect.anything(), "tenant", "invoices", null, "error", expect.stringContaining("환불 상세 확인 불가: 환불금액"));
});

it("원생번호 없는 수납 두 줄도 병합 기록을 제외하여 학생×월 한 청구로 집계한다", async () => {
  const result = await runImporter({
    headers: ["이름", "학년", "청구월", "구분", "수납명", "청구액", "할인액", "적립금", "실제낸금액", "미납"],
    rows: [
      ["이재윤", "중1", "2026.09", "수업", "정규 A", "312,000", "0", "0", "312,000", "0"],
      ["이재윤", "중1", "2026.09", "교재", "Power Voca 5", "12,000", "0", "0", "12,000", "0"],
    ],
    totalReported: 2,
    reportedSummary: {lines: 2, total: 324000, discount: 0, points: 0, paid: 324000, unpaid: 0},
  }, {dryRun: true, students: [
    {id: "keeper", name: "이재윤", grade: "중1", makeedu_id: "13846", notes: null},
    {id: "merged", name: "이재윤", grade: "중1", makeedu_id: null, notes: "중복 병합: keeper와 통합됨 (2026-07-07)"},
  ]});
  expect(result.code).toBe(0);
  expect(result.logs).toHaveBeenCalledWith("lines→invoices(학생×월): 1 | unmatched lines: 0");
  expect(result.reports).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({unmatchedLines: [], external: expect.objectContaining({ok:true})}));
  expect(result.writes).not.toHaveBeenCalled();
});
