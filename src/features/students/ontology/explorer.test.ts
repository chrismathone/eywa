import { expect, it } from "vitest";
import { summarizeOntologyView } from "./explorer";
import type { StudentFact } from "./types";
const f: StudentFact = { id: "attendance:1", studentId: "s", tenantId: "t", kind: "attendance", value: { status: "present" },
  occurred: { precision: "day", value: "2026-10-01" }, recordedAt: "2026-10-02T00:00:00Z", related: [{ kind: "class", id: "c1" }, { kind: "teacher", id: "u1" }],
  evidence: [{ source: "attendance_records", id: "1", studentId: "s" }], basis: "recorded", access: "student", state: "active" };
it("같은 학생이어도 별도 기록의 강사를 현재 반 관계로 추론하지 않는다", () => {
  const other = { ...f, id: "attendance:2", related: [{ kind: "class", id: "c2" }, { kind: "teacher", id: "u2" }] } as StudentFact;
  const view = summarizeOntologyView("t", [f, f, other], { kind: "class", id: "c1" });
  expect(view.factCount).toBe(1);
  expect(view.studentCounts).toEqual({ s: { attendance: 1 } });
  expect(view.related).toContainEqual({ kind: "teacher", id: "u1", factCount: 1 });
  expect(view.related.some((link) => link.id === "u2" || link.id === "c2" || link.id === "c1")).toBe(false);
});
it("중복 관계와 사실은 한 번만 세고 원본·규칙·AI 근거를 구분한다", () => {
  const duplicated = { ...f, related: [...f.related, ...f.related] };
  const ai = { ...f, id: "signal:1", kind: "observation" as const, basis: "ai" as const, recordedAt: "2026-10-03T00:00:00Z" };
  const view = summarizeOntologyView("t", [duplicated, duplicated, ai], { kind: "academy", id: "t" });
  expect(view.factCount).toBe(2);
  expect(view.related.find((link) => link.id === "u1")?.factCount).toBe(2);
  expect(view.basis).toEqual({ recorded: 1, rule: 0, ai: 1 });
  expect(view.recordedAt).toBe(ai.recordedAt);
  expect(() => summarizeOntologyView("elsewhere", [f], { kind: "academy", id: "elsewhere" })).toThrow();
});
