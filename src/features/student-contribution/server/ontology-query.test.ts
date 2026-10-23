import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ gate: vi.fn(), directory: vi.fn(), snapshot: vi.fn(), paged: vi.fn(), readable: vi.fn(), identity: vi.fn(), views: vi.fn() }));
vi.mock("./access", () => ({ getContributionGate: m.gate }));
vi.mock("./directory", () => ({ getContributionDirectory: m.directory, getContributionSnapshot: m.snapshot }));
vi.mock("./fact-access", () => ({ readableFactStudents: m.readable }));
vi.mock("./identity-query", () => ({ getContributionReadIdentity: m.identity }));
vi.mock("./ontology-cache", () => ({ cachedOntologyViews: m.views }));
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPaged: m.paged }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
import { getContributionOntology } from "./ontology-query";
const record = { students: ["s"], counts: { attendance: 1 }, factCount: 1, tuitionWon: 0, unallocatedTuitionFacts: 0, related: [], studentCounts: { s: { attendance: 1 } }, basis: { recorded: 1, rule: 0, ai: 0 }, recordedAt: "2026-10-01" };
beforeEach(() => {
  vi.resetAllMocks();
  m.gate.mockResolvedValue({ tenantId: "tenant", canConfigure: true });
  m.directory.mockResolvedValue({ rows: [{ id: "s", name: "학생", school: "침산초", grade: "초4", status: "enrolled", subjects: ["math"] }], classes: [], subjects: [], grades: ["초4"] });
  m.snapshot.mockResolvedValue({ ready: true, historyReady: true, refreshedAt: null });
  m.readable.mockResolvedValue(null);
  m.identity.mockResolvedValue({ ids: ["s"], canonical: (id: string) => id, issues: [] });
  m.paged.mockResolvedValue([{ id: "teacher", display_name: "강사" }, { id: "former", display_name: "지난 강사" },
    { id: "desk", display_name: "데스크" }, { id: "account", display_name: "운영 계정" }]);
  m.views.mockResolvedValue({ views: { "teacher:teacher": record, "teacher:former": record }, unresolved: 0 });
});
it("lists only teachers connected to that month, retaining former teachers without listing unrelated accounts", async () => {
  const data = await getContributionOntology("2026-10");
  expect(data?.labels.teacher).toEqual([{ id: "teacher", label: "강사" }, { id: "former", label: "지난 강사" }]);
  expect(data?.labels.student).toEqual([{ id: "s", label: "학생", detail: "침산초4" }]);
});
it("does not turn unrelated accounts into a teacher list when a month has no records", async () => {
  m.views.mockResolvedValue({ views: {}, unresolved: 0 });
  expect((await getContributionOntology("2026-10"))?.labels.teacher).toEqual([]);
});
it("keeps class and subject directories within the filtered monthly projection", async () => {
  m.directory.mockResolvedValue({ rows: [], grades: [], classes: [{ id: "visible", class_name: "수학 A" }, { id: "outside", class_name: "영어 B" }],
    subjects: [{ key: "math", label: "수학" }, { key: "english", label: "영어" }] });
  m.views.mockResolvedValue({ views: { "class:visible": record, "subject:math": record }, unresolved: 0 });
  const data = await getContributionOntology("2026-10");
  expect(data?.labels.class).toEqual([{ id: "visible", label: "수학 A" }]);
  expect(data?.labels.subject).toEqual([{ id: "math", label: "수학" }]);
  expect(data?.filterOptions.subjects).toHaveLength(2);
});
it("defaults the entire monthly projection and zero-record directory to enrolled students", async () => {
  const student = { name: "학생", school: "침산초", grade: "초4", subjects: ["math"] };
  m.directory.mockResolvedValue({ rows: [
    { ...student, id: "s", status: "enrolled" }, { ...student, id: "zero", status: "enrolled" },
    { ...student, id: "left", status: "withdrawn" }, { ...student, id: "hold", status: "on_hold" },
  ], classes: [], subjects: [], grades: [] });
  const data = await getContributionOntology("2026-10");
  expect(data?.labels.student.map((s) => s.id)).toEqual(["s", "zero"]);
  expect(m.views.mock.lastCall?.[2]).toEqual(["s", "zero"]);
  await getContributionOntology("2026-10", { status: "all" });
  expect(m.views.mock.lastCall?.[2]).toEqual(["s", "zero", "left", "hold"]);
});
it("combines filters before aggregation without widening source access or leaking directory names", async () => {
  const student = { name: "학생 A", school: "침산초", grade: "초4", status: "enrolled", subjects: ["math"] };
  m.directory.mockResolvedValue({ rows: [{ ...student, id: "s" }, { ...student, id: "private", name: "비공개" },
    { ...student, id: "different", grade: "초5" }], classes: [], subjects: [], grades: [] });
  m.readable.mockResolvedValue(new Set(["s", "different"]));
  const data = await getContributionOntology("2026-10", { q: " a ", grade: "초4", subject: "math", status: "all" });
  expect(m.views.mock.lastCall?.[2]).toEqual(["s"]);
  expect(m.views.mock.lastCall?.[4]).toEqual(["s", "different"]);
  expect(data?.labels.student.map((s) => s.id)).toEqual(["s"]);
  expect(JSON.stringify(data)).not.toContain("비공개");
  await getContributionOntology("2026-10", { subject: "english" });
  expect(m.views.mock.lastCall?.[2]).toEqual([]);
});
