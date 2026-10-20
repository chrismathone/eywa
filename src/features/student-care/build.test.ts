import { describe, expect, it } from "vitest";
import { buildCareCard } from "./build";
import { careFixture } from "./fixtures";

describe("학생 관리 카드", () => {
  it("학원 과목 설정의 이름을 사용하고 미확인 코드를 노출하지 않는다", () => {
    const raw = careFixture();
    raw.subjectLabels = { math: "수학 심화" };
    expect(buildCareCard(raw).assessment.reasons[0]).toBe("수학 심화 숙제 수행률 30%p 하락");
    raw.subjectLabels = {};
    const result = buildCareCard(raw);
    expect(result.assessment.missing).toContain("과목 설정 확인");
    expect(JSON.stringify(result)).not.toContain("math");
  });
  it("두 영역의 신호를 설명하고 금액을 등급에 반영하지 않는다", () => {
    const raw = careFixture(), result = buildCareCard(raw);
    expect(result.assessment.label).toBe("집중 관리");
    expect(result.assessment.reasons).toEqual(["수학 숙제 수행률 30%p 하락", "최근 4주 결석 기록 2회"]);
    raw.invoices.rows[0]!.amount_paid = 99999999;
    expect(buildCareCard(raw).assessment).toEqual(result.assessment);
    expect(result.sections.map((s) => s.key)).toEqual(["tenure", "payments", "homework", "attendance", "level", "growth", "parent"]);
  });
  it("자료가 부족해도 확인한 신호는 숨기지 않는다", () => {
    const raw = careFixture(); raw.consultations = { state: "failed", rows: [] };
    expect(buildCareCard(raw).assessment).toMatchObject({ label: "집중 관리", missing: ["최근 학부모 상담 확인"] });
  });
  it("조회 실패를 안정·0원·상담 없음으로 표시하지 않는다", () => {
    const raw = careFixture();
    raw.reports = { state: "failed", rows: [] };
    raw.attendance = { state: "failed", rows: [] };
    raw.consultations = { state: "failed", rows: [] };
    raw.invoices = { state: "failed", rows: [] };
    const result = buildCareCard(raw);
    expect(result.assessment.label).toBe("판단 보류");
    expect(result.followupsState).toBe("failed");
    expect(result.sections.find((s) => s.key === "payments")?.summary).toBe("자료를 불러오지 못했습니다");
  });
  it("권한 없는 금액과 상담 본문을 반환하지 않는다", () => {
    const raw = careFixture();
    raw.invoices = { state: "restricted", rows: [] }; raw.consultations = { state: "restricted", rows: [] };
    expect(buildCareCard(raw).sections.find((s) => s.key === "payments")).toMatchObject({ state: "restricted", details: [] });
    expect(JSON.stringify(buildCareCard(raw))).not.toContain("300,000");
  });
  it("부정어·과거 퇴원 문구만으로 등급을 올리지 않는다", () => {
    const raw = careFixture();
    raw.reports.rows.forEach((r) => r.homework_score = "90%");
    raw.attendance.rows.forEach((r) => r.status = "present");
    raw.consultations.rows[0]!.summary = "작년 환불 문의는 해결되었고 퇴원하지 않기로 했다.";
    expect(buildCareCard(raw).assessment.label).toBe("안정");
    raw.consultations.rows[0]!.consulted_at = "2026-01-01T00:00:00Z";
    expect(buildCareCard(raw).assessment.label).toBe("판단 보류");
  });
  it("후속 상담은 미완료만 기한순으로 제공한다", () => {
    const raw = careFixture(), original = raw.consultations.rows[0]!;
    raw.consultations.rows.push({ ...original, id: "overdue", follow_up_date: "2026-10-15" },
      { ...original, id: "done", follow_up_done: true }, { ...original, id: "invalid", follow_up_date: "2026-02-30" });
    expect(buildCareCard(raw).followups.map((r) => [r.id, r.overdue])).toEqual([["overdue", true], [original.id, false]]);
  });
});
