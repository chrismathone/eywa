import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const require = createRequire(import.meta.url);
const script = fs.readFileSync(path.join(__dirname, "import-invoices.cjs"), "utf8");
async function runImporter(data: object) {
  const writes = vi.fn();
  const recordSync = vi.fn();
  const query = Object.assign(async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (/\b(insert|update|delete)\b/i.test(text)) { writes(text); throw new Error("Unexpected DB write"); }
    if (/from students/.test(text)) return [{ id: "student", name: "테스트", grade: "초6", makeedu_id: "123" }];
    return [];
  }, { end: async () => {} });
  const processMock = { argv: ["node", "import-invoices.cjs", "--apply"], env: {}, exitCode: 0 };
  const files = { readFileSync: () => JSON.stringify(data), existsSync: () => false };
  await vm.runInNewContext(script, {
    require: (name: string) => name === "postgres" ? () => query : name === "fs" ? files : name === "./lib.cjs"
      ? { ...require("./lib.cjs"), resolveTenantId: async () => "tenant", recordSync }
      : require(name),
    __dirname,
    process: processMock,
    console: { log: () => {}, warn: () => {}, error: () => {} },
  });
  return { writes, recordSync, code: processMock.exitCode };
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
