import { describe, expect, it } from "vitest";
import { classifyReportDate, dayDiff, explainReportDate, lastEndDate, lastSubjects, reportDateNote, type LinkEnrollment } from "./report-date-link";

const math = (startDate: string, endDate: string | null): LinkEnrollment => ({ subject: "math", startDate, endDate });
const english = (startDate: string, endDate: string | null): LinkEnrollment => ({ subject: "english", startDate, endDate });
const base = { withdrawnAt: "2026-03-31", reportSubjects: ["math"], subjectEnd: false };

describe("퇴원보고서 날짜 ↔ 퇴원일 관계", () => {
  it("마지막 수강 과목의 보고서는 날짜가 달라도 같은 사건 후보", () => {
    expect(classifyReportDate({ ...base, reportDate: "2026-03-20", enrollments: [math("2025-03-01", "2026-03-31")] })).toBe("same_event");
    // 보고서가 퇴원일보다 늦어도(처리일이 먼저 찍힌 경우) 같은 사건 후보다.
    expect(classifyReportDate({ ...base, reportDate: "2026-04-05", enrollments: [math("2025-03-01", "2026-03-31")] })).toBe("same_event");
  });

  it("보고서 뒤에도 다른 과목을 다녔으면 부분(과목) 종료", () => {
    const enrollments = [math("2025-03-01", "2025-09-30"), english("2025-01-01", "2026-03-31")];
    expect(classifyReportDate({ ...base, reportDate: "2025-09-30", enrollments })).toBe("partial");
  });

  it("두 과목이 같은 날 끝난 퇴원은 과목별 보고서 날짜가 일러도 같은 사건 후보(부분 종료로 가르지 않는다)", () => {
    const enrollments = [math("2025-03-01", "2026-03-31"), english("2025-03-01", "2026-03-31")];
    expect(classifyReportDate({ ...base, reportDate: "2026-03-20", enrollments })).toBe("same_event");
    expect(classifyReportDate({ ...base, reportSubjects: ["english"], reportDate: "2026-03-25", enrollments })).toBe("same_event");
    // 다른 과목이 보고서 과목보다 실제로 더 이어졌으면 그대로 부분 종료.
    expect(classifyReportDate({ ...base, reportDate: "2026-03-20", enrollments: [math("2025-03-01", "2026-03-20"), english("2025-03-01", "2026-03-31")] })).toBe("partial");
  });

  it("새 보고서가 과목 수강종료라고 적었으면 그대로 부분 종료", () => {
    expect(classifyReportDate({ ...base, reportDate: "2026-03-31", subjectEnd: true, enrollments: [math("2025-03-01", "2026-03-31")] })).toBe("partial");
  });

  it("보고서 뒤에 시작한 수강이 있으면 재등록 — 지금 퇴원이면 다시 퇴원, 아니면 재원 중", () => {
    const enrollments = [math("2024-03-01", "2024-12-31"), math("2025-09-01", "2026-03-31")];
    expect(classifyReportDate({ ...base, reportDate: "2024-12-31", enrollments })).toBe("reenrolled");
    expect(classifyReportDate({ ...base, withdrawnAt: null, reportDate: "2024-12-31", enrollments: [math("2024-03-01", "2024-12-31"), math("2025-09-01", null)] })).toBe("returned");
  });

  it("판단할 재료가 없으면 관계 미확인 — 날짜·수강 기록·과목·지금 퇴원 중 하나라도 없을 때", () => {
    const enrollments = [math("2025-03-01", "2026-03-31")];
    expect(classifyReportDate({ ...base, reportDate: null, enrollments })).toBe("unknown");
    expect(classifyReportDate({ ...base, reportDate: "2026-03-20", enrollments: [] })).toBe("unknown");
    expect(classifyReportDate({ ...base, reportSubjects: [], reportDate: "2026-03-20", enrollments })).toBe("unknown");
    expect(classifyReportDate({ ...base, withdrawnAt: null, reportDate: "2026-03-20", enrollments })).toBe("unknown");
  });

  it("보고서 과목이 마지막 수강 과목이 아니면 관계 미확인(같은 사건이라 단정하지 않는다)", () => {
    const enrollments = [math("2025-03-01", "2025-06-30"), english("2025-03-01", "2026-03-31")];
    // 영어가 보고서 날짜(6/30)에 끝나지 않았다 = 부분 종료로 먼저 걸린다.
    expect(classifyReportDate({ ...base, reportDate: "2025-06-30", enrollments })).toBe("partial");
    // 수학 보고서인데 마지막까지 다닌 과목은 영어 — 수학 보고서를 이 퇴원의 기록이라 단정할 수 없다.
    expect(classifyReportDate({ ...base, reportDate: "2026-04-01", enrollments: [math("2025-03-01", "2025-06-30"), english("2025-03-01", "2026-03-31")] })).toBe("unknown");
  });

  it("근거 문구는 판정과 같은 갈래에서 나온다", () => {
    const enrollments = [math("2025-03-01", "2026-03-31")];
    expect(explainReportDate({ ...base, reportDate: "2026-03-20", enrollments })).toEqual({ kind: "same_event", reason: "마지막 수강 과목과 같음 · 보고서 뒤 새 수강 없음" });
    expect(explainReportDate({ ...base, reportDate: "2026-03-20", enrollments: [] }).reason).toBe("수강 기록 없음");
    expect(explainReportDate({ ...base, reportSubjects: [], reportDate: "2026-03-20", enrollments }).reason).toBe("보고서 과목 미기재");
  });

  it("마지막 수강 과목·종료일 — 같은 날 끝난 과목은 둘 다, 열린 수강이 가장 늦다", () => {
    expect(lastSubjects([math("2025-01-01", "2026-03-31"), english("2025-01-01", "2026-03-31")]).sort()).toEqual(["english", "math"]);
    expect(lastSubjects([math("2025-01-01", null), english("2025-01-01", "2026-03-31")])).toEqual(["math"]);
    expect(lastEndDate([math("2025-01-01", "2025-05-01"), english("2025-01-01", "2026-03-31")])).toBe("2026-03-31");
    expect(lastEndDate([math("2025-01-01", null)])).toBeNull();
  });

  it("날짜 차이(일)", () => {
    expect(dayDiff("2026-03-20", "2026-03-31")).toBe(11);
    expect(dayDiff("2026-03-31", "2026-03-20")).toBe(-11);
    expect(dayDiff("2026-02-28", "2026-03-01")).toBe(1);
    expect(dayDiff(null, "2026-03-01")).toBeNull();
  });
});

describe("퇴원 상세 머리의 보고서 날짜", () => {
  const enrollments = [math("2025-03-01", "2026-03-31")];
  const report = (reportDate: string | null, label = "기존 기록 · 수학") => ({ reportDate, reportSubjects: ["math"], subjectEnd: false, label });

  it("같은 사건 후보의 날짜가 퇴원일과 다르면 가장 늦은 날짜를 보이고 후보를 전부 싣는다", () => {
    const note = reportDateNote("2026-03-31", enrollments, [report("2026-03-20", "기존 기록 · 수학 · 갑"), report("2026-03-25", "새 보고서 · 수학")]);
    expect(note?.date).toBe("2026-03-25");
    expect(note?.rows.map((r) => r.date)).toEqual(["2026-03-25", "2026-03-20"]);
  });

  it("과목별 원본이 한 장씩인 두 과목 퇴원도 가장 늦은 보고서 날짜를 보인다", () => {
    const both = [math("2025-03-01", "2026-03-31"), english("2025-03-01", "2026-03-31")];
    const note = reportDateNote("2026-03-31", both, [report("2026-03-20"), { reportDate: "2026-03-25", reportSubjects: ["english"], subjectEnd: false, label: "기존 기록 · 영어" }]);
    expect(note?.date).toBe("2026-03-25");
    expect(note?.rows).toHaveLength(2);
  });

  it("하나라도 퇴원일과 같으면 보일 게 없다", () => {
    expect(reportDateNote("2026-03-31", enrollments, [report("2026-03-31"), report("2026-03-20")])).toBeNull();
  });

  it("같은 사건 후보가 아니면(부분 종료·재등록·관계 미확인) 보이지 않는다", () => {
    const partial = [math("2025-03-01", "2025-09-30"), english("2025-01-01", "2026-03-31")];
    expect(reportDateNote("2026-03-31", partial, [report("2025-09-30")])).toBeNull();
    expect(reportDateNote("2026-03-31", [], [report("2026-03-20")])).toBeNull();
    expect(reportDateNote(null, enrollments, [report("2026-03-20")])).toBeNull();
    expect(reportDateNote("2026-03-31", enrollments, [])).toBeNull();
  });
});
