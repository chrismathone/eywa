import { expect, it } from "vitest";
import { emptyRaws } from "./config";
import { correctionDetails } from "./corrections";
import { buildStudentMonths } from "./build";
it("이전에 반영한 환불을 다시 감점하지 않으며 정정 상세의 합계가 이번 달 정정과 같다", () => {
  const base = { evidenceIds: ["invoice:i"], reconstructed: false, closedAt: "2026-11-01T00:00:00Z" };
  const stored = [{ ...base, month: "2026-09", raws: { ...emptyRaws(), tuitionWon: 300000 }, correction: emptyRaws() },
    { ...base, month: "2026-10", raws: emptyRaws(), correction: { ...emptyRaws(), tuitionWon: -100000 } }];
  const facts = [{ studentId: "s", month: "2026-09", raws: { ...emptyRaws(), tuitionWon: 100000 }, evidenceIds: ["invoice:i"] }];
  const current = buildStudentMonths({ month: "2026-11", capturedAt: "2026-11-02T00:00:00Z", complete: true, stored, facts }).at(-1)!;
  const details = correctionDetails(current, stored, facts);
  expect(current.correction.tuitionWon).toBe(-100000);
  expect(details.reduce((sum, d) => sum + d.delta, 0)).toBe(current.correction.tuitionWon);
  expect(details.find((d) => d.kind === "alreadyApplied")!.delta).toBe(100000);
});
