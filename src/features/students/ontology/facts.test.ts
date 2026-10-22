import { expect, it } from "vitest";
import { uniqueStudentFacts } from "./facts";
import type { StudentFact } from "./types";

const fact = (id: string, studentId: string, won: number): StudentFact<{ won: number }> => ({
  id, studentId, tenantId: "academy", value: { won }, kind: "tuition", occurred: { precision: "month", value: "2026-10" },
  recordedAt: "2026-10-22T00:00:00Z", related: [], evidence: [{ source: "invoices", id, studentId }],
  basis: "recorded", access: "billing", state: "active",
});
it("반·강사·과목 조회에 겹친 청구는 학원에서 한 번, 복수 과목 학생도 한 명", () => {
  const math = fact("math-invoice", "s1", 300_000);
  const english = fact("english-invoice", "s1", 200_000);
  const other = fact("other-invoice", "s2", 300_000);
  const rows = uniqueStudentFacts("academy", [[math, other], [math, english], [english, other]]);
  expect(rows).toHaveLength(3);
  expect(new Set(rows.map((r) => r.studentId)).size).toBe(2);
  expect(rows.reduce((sum, row) => sum + row.value.won, 0)).toBe(800_000);
});
it("지점이 다르거나 같은 ID의 내용·상태가 다르면 합산을 멈춘다", () => {
  const row = fact("i", "s", 300_000);
  expect(() => uniqueStudentFacts("other", [[row]])).toThrow();
  expect(() => uniqueStudentFacts("academy", [[row], [{ ...row, state: "cancelled" }]])).toThrow();
  expect(() => uniqueStudentFacts("academy", [[row], [{ ...row, value: { won: 200_000 } }]])).toThrow();
});
it("기록된 원래 학생과 병합 후 학생을 모두 보존하며 다른 사건을 이름으로 합치지 않는다", () => {
  const row = { ...fact("i", "old", 300_000), studentId: "kept" };
  expect(uniqueStudentFacts("academy", [[row]])[0]).toMatchObject({ studentId: "kept", evidence: [{ studentId: "old" }] });
});
