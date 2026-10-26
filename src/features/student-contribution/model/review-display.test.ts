import { expect, it } from "vitest";
import { reviewDisplay, type ConsultationIdentity, type ReviewDisplayReport } from "./review-display";

it("같은 소개자 후보의 상담을 대상과 날짜로 구분하고 원본 누락을 드러낸다", () => {
  const report: ReviewDisplayReport = { checkedAt: "2026-10-23", cutoff: "2026-10-22", counts: { automatic: 0, review: 3, linked: 0, unavailable: 0, total: 3 },
    rows: ["c1", "c2", "missing"].map((consultationId) => ({ consultationId, state: "review", candidates: ["same"], candidateId: null, guards: [], reasons: [], evidence: null })) };
  const source: ConsultationIdentity = { id: "c1", prospect_name: "학생하나", consultation_date: "2026-10-01", received_date: null, created_at: "2026-09-30T20:00:00Z", referrer_student_id: null, referrer_staff_id: null };
  const result = reviewDisplay(report, [source, { ...source, id: "c2", prospect_name: "학생둘", consultation_date: null, referrer_student_id: "same" }]);
  expect(result.rows.map((r) => [r.prospectName, r.consultationDay])).toEqual([["학생하나", "2026-10-01"], ["학생둘", "2026-10-01"], [null, null]]);
  expect(result.counts).toMatchObject({ review: 2, linked: 1, total: 3 });
  expect(report.rows[1]!.state).toBe("review");
  const unavailable: ReviewDisplayReport = { ...report, rows: report.rows.map((r) => ({ ...r, state: "unavailable" })),
    counts: { total: 3, automatic: 0, review: 0, unavailable: 3, linked: 0 } };
  expect(reviewDisplay(unavailable, [{ ...source, referrer_staff_id: "teacher" }]).counts)
    .toEqual({ total: 3, automatic: 0, review: 0, unavailable: 2, linked: 1 });
});
