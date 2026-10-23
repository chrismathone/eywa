import { expect, it } from "vitest";
import { LIVE_SCOPE_VERSION, liveScopeHref, liveScopeRequest, validateLiveScope } from "./live-scope";
it("bounds requests and pins the academy scope to the authorized tenant", () => {
  expect(liveScopeRequest({ kind: "academy", entity: "other", page: "-1", q: " a " }, "tenant"))
    .toEqual({ kind: "academy", id: "tenant", page: 1, search: "a" });
  expect(liveScopeRequest({ kind: "payroll", page: "Infinity" }, "tenant").kind).toBe("academy");
});
it("ignores a stale student search in a direct individual-student link", () => {
  expect(liveScopeRequest({ kind: "student", entity: "s", q: "다른 학생" }, "tenant"))
    .toEqual({ kind: "student", id: "s", page: 1, search: "" });
});
it("preserves the selected scope, search, page and embed mode in navigation", () => {
  const href = liveScopeHref({ kind: "subject", id: "math", search: "김 A&B", page: 3 }, true);
  const params = new URL(href, "https://local.test").searchParams;
  expect(Object.fromEntries(params)).toEqual({ view: "current", kind: "subject", entity: "math", q: "김 A&B", page: "3", embed: "1" });
});
const data = { version: LIVE_SCOPE_VERSION, asOf: "2026-10-23", checkedAt: "2026-10-23T00:00:00Z", total: 1, filteredTotal: 1,
  classCount: 1, teacherCount: 1, subjectCount: 1, unassignedClasses: 0, unresolvedAssignments: 0, page: 1, pageSize: 20, options: [], connections: [],
  students: [{ id: "s", name: "학생", school: null, grade: null, classes: [{ id: "c", name: "수업", subject: "math", onHold: false,
    enrollmentIds: ["e"], teachers: [{ role: "homeroom", teacherId: "t", name: "강사", sourceId: "c" }] }] }] };
it("keeps the source IDs and distinguishes no assignment from an unknown schema", () => {
  expect(validateLiveScope(data, new Set(["s"])).students[0].classes[0].enrollmentIds).toEqual(["e"]);
  expect(() => validateLiveScope({}, new Set(["s"]))).toThrow();
});
it("rejects student leakage, duplicate page rows and inconsistent totals", () => {
  expect(() => validateLiveScope(data, new Set())).toThrow();
  expect(() => validateLiveScope({ ...data, students: [data.students[0], data.students[0]] }, new Set(["s"]))).toThrow();
  expect(() => validateLiveScope({ ...data, filteredTotal: 2 }, new Set(["s"]))).toThrow();
  expect(() => validateLiveScope({ ...data, options: [{ kind: "student", id: "private", label: "비공개", students: 1 }] }, new Set(["s"]))).toThrow();
});
