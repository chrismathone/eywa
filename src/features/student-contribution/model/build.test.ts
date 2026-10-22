import { expect, it } from "vitest";
import { buildStudentMonths, contributionFacts } from "./build";
import { emptyRaws } from "./config";
it("첫 집계는 과거 달을 복원하고 다음 집계는 과거 사실 변화만 현재 달에 정정", () => {
  const args = { month: "2026-10", capturedAt: "2026-10-22T00:00:00Z", complete: true };
  const facts = [{ studentId: "s", month: "2026-09", raws: { ...emptyRaws(), tuitionWon: 300_000 }, evidenceIds: ["i"] }];
  const stored = buildStudentMonths({ ...args, facts, stored: [] });
  expect(stored[0]).toMatchObject({ month: "2026-09", reconstructed: true, correction: emptyRaws() });
  expect(stored[1]!.correction.tuitionWon).toBe(0);
  facts[0]!.raws.tuitionWon = 200_000;
  const next = buildStudentMonths({ ...args, facts, stored });
  expect(next[0]).toEqual(stored[0]);
  expect(next[1]!.correction.tuitionWon).toBe(-100_000);
  expect(() => buildStudentMonths({ ...args, complete: false, facts: [], stored })).toThrow();
});
it("상담과 수업 시작은 각 달에 쌓이고 배점은 저장하지 않는다", () => {
  const result = contributionFacts([], [{ consultationId: "c", referrerId: "s", prospectId: "p", personKey: "p", subject: "math",
    consultedOn: "2026-09-20", startedOn: "2026-10-02" }], []);
  expect(result.map((r) => [r.month, r.raws.referralConsult, r.raws.referralStarted])).toEqual([["2026-09", 1, 0], ["2026-10", 0, 1]]);
});
it("달이 끝나야 정해지는 개근은 지난 열린 달에 반영하고 마감한다", () => {
  const old = { month: "2026-09", raws: emptyRaws(), correction: emptyRaws(), closedAt: null, evidenceIds: [], reconstructed: false };
  const result = buildStudentMonths({ month: "2026-10", capturedAt: "2026-10-01T00:00:00Z", complete: true, stored: [old],
    facts: [{ studentId: "s", month: "2026-09", raws: { ...emptyRaws(), perfectMonths: 1 }, evidenceIds: ["attendance:a"] }] });
  expect(result[0]).toMatchObject({ raws: { perfectMonths: 1 }, correction: { perfectMonths: 0 }, closedAt: "2026-10-01T00:00:00Z" });
  expect(result[1]!.correction.perfectMonths).toBe(0);
  expect(old.closedAt).toBeNull();
});
