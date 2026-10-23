import { expect, it } from "vitest";
import { aggregateStudentOntology } from "./aggregate";
import { visibleStudentFacts } from "./visible-facts";
import type { StudentFact } from "./types";
const f: StudentFact = { id: "bill:i", studentId: "s", tenantId: "t", kind: "tuition", value: { tuitionWon: 300000 }, occurred: { precision: "month", value: "2026-09" },
  recordedAt: "2026-10-01", related: [{ kind: "subject", id: "math" }, { kind: "subject", id: "english" }], evidence: [{ source: "invoices", id: "i", studentId: "s" }],
  basis: "rule", access: "billing", state: "active" };
it("복수 과목의 같은 금액은 학원에서 한 번, 명시 배분 없는 과목별 금액은 합치지 않는다", () => {
  expect(aggregateStudentOntology("t", [f, f], { kind: "academy", id: "t" })).toMatchObject({ students: ["s"], tuitionWon: 300000 });
  expect(aggregateStudentOntology("t", [f], { kind: "subject", id: "math" })).toMatchObject({ tuitionWon: 0, unallocatedTuitionFacts: 1 });
  expect(() => aggregateStudentOntology("other", [f], { kind: "academy", id: "other" })).toThrow();
});
it("병합 전 마감 기록도 현재 원생에 이어 보이며 근거의 원래 학생은 유지", () => {
  const rows = visibleStudentFacts("t", [{ computedAt: "2026-10-01", facts: [f] }, { computedAt: "2026-10-22", facts: [{ ...f, studentId: "kept" }] }], (id) => id === "s" ? "kept" : id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ studentId: "kept", evidence: [{ studentId: "s" }] });
  expect(f.studentId).toBe("s");
});
