import { describe, expect, it } from "vitest";
import { recognizeReferrals, type Referral } from "./referrals";
import { DEFAULT_CONFIG } from "./config";
import { registrationStartedOn, startedRegistration, type StartEvidence, type ClassSpan } from "@/features/dashboard/overview/coverage-rules";

const noEvidence = () => ({ billMonths: new Map<string, string[]>(), attendedOn: new Map<string, string[]>(),
  classSpans: new Map<string, ClassSpan[]>() } satisfies StartEvidence);
const row = (id: string, day: string, overrides: Partial<Referral> = {}): Referral => ({ id, consultation_date: day, received_date: null,
  created_at: `${day}T00:00:00Z`, student_id: "prospect", referrer_student_id: "introducer", referrer_staff_id: null, subject: "math", ...overrides });
const recognize = (rows: Referral[]) => recognizeReferrals({ rows, today: "2027-12-31", options: DEFAULT_CONFIG.referrals, evidenceFor: noEvidence }).credits;
describe("친구 소개 인정", () => {
  it("소개자가 달라도 같은 피소개자·과목은 마지막 인정일부터 12개월 안 재인정하지 않는다", () => {
    const rows = [row("a", "2026-03-15"), row("b", "2026-08-01", { referrer_student_id: "other" }),
      row("c", "2027-03-14"), row("d", "2027-03-15")];
    expect(recognize(rows).map((c) => c.consultationId)).toEqual(["a", "d"]);
    expect(recognize([...rows].reverse())).toEqual(recognize(rows));
  });
  it("추가 과목·형제·재등록을 허용하고 본인/직원 소개는 뺀다", () => {
    expect(recognize([row("a", "2026-03-01"), row("b", "2026-04-01", { subject: "english" }),
      row("c", "2026-04-02", { student_id: "introducer" }), row("d", "2026-04-03", { referrer_staff_id: "teacher" }),
      row("e", "2026-04-04", { student_id: "sibling" })]).map((c) => c.consultationId)).toEqual(["a", "b", "e"]);
  });
  it("이름만 같은 서로 다른 학생을 묶지 않고 같은 이름+휴대폰 상담은 묶는다", () => {
    const same = { student_id: null, prospect_name: "김민서", parent_phone: "01012345678" };
    expect(recognize([row("a", "2026-01-01", same), row("b", "2026-02-01", { ...same, prospect_grade: "초6" }),
      row("c", "2026-03-01", { ...same, parent_phone: "01098765432" })])).toHaveLength(2);
    expect(recognize([row("a", "2026-01-01", { student_id: null, prospect_name: "김민서" }),
      row("b", "2026-02-01", { student_id: null, prospect_name: "김민서" })])).toHaveLength(2);
  });
  it("2/29의 12개월 경계와 과목 없는 확인 대상을 처리한다", () => {
    expect(recognize([row("a", "2024-02-29"), row("b", "2025-02-28")])).toHaveLength(2);
    const result = recognizeReferrals({ rows: [row("a", "2026-01-01", { subject: null })], today: "2026-10-22", options: DEFAULT_CONFIG.referrals, evidenceFor: noEvidence });
    expect(result.credits).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
  });
  it("상담 이후 실제 수업 시작 날짜에 별도 점수를 준다", () => {
    const ev = noEvidence(); ev.attendedOn.set("prospect", ["2026-04-02"]);
    const result = recognizeReferrals({ rows: [row("a", "2026-03-20")], today: "2026-04-10", options: DEFAULT_CONFIG.referrals, evidenceFor: () => ev });
    expect(result.credits[0]).toMatchObject({ consultedOn: "2026-03-20", startedOn: "2026-04-02" });
  });
  it("추가 과목은 원생 전체의 기존 청구 때문에 제외하지 않으며 신규생 통계는 보존한다", () => {
    const ev = noEvidence(); ev.billMonths.set("s", ["2026-02", "2026-03"]);
    expect(startedRegistration({ id: "s", enrolledAt: "2026-03-15" }, ev, "2026-03-31")).toBe(false);
    expect(registrationStartedOn({ id: "s", enrolledAt: "2026-03-15" }, ev, "2026-03-31", true)).toBe("2026-03-15");
    ev.billMonths.set("s", ["2027-01"]);
    expect(registrationStartedOn({ id: "s", enrolledAt: "2026-03-15" }, ev, "2026-03-31", true)).toBeNull();
  });
  it("병합 뒤 본인 소개·중복 소개를 다시 세지 않는다", () => {
    const result = recognizeReferrals({ rows: [row("a", "2026-03-01", { student_id: "old" }), row("b", "2026-04-01")],
      today: "2026-10-22", options: DEFAULT_CONFIG.referrals, evidenceFor: noEvidence, canonicalStudent: (id) => id === "old" ? "prospect" : id });
    expect(result.credits).toHaveLength(1);
  });
});
