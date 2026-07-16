import { describe, expect, it } from "vitest";
import {
  absenceDigestBody,
  absenceTier,
  buildAbsenceEvents,
  buildFollowupEvents,
  followupBody,
  summarizeNames,
} from "./events-core";

describe("absenceTier", () => {
  it("마일스톤 미달·경계·상위 tier", () => {
    expect(absenceTier(2)).toBe(null);
    expect(absenceTier(3)).toBe(3);
    expect(absenceTier(4)).toBe(3); // 3→4는 같은 tier(재알림 없음)
    expect(absenceTier(5)).toBe(5);
    expect(absenceTier(9)).toBe(5);
    expect(absenceTier(10)).toBe(10);
    expect(absenceTier(99)).toBe(10);
  });
});

describe("buildAbsenceEvents", () => {
  it("tier 도달자만 이벤트로, bucket=tier 문자열", () => {
    const events = buildAbsenceEvents([
      { studentId: "s1", studentName: "김보민", absences: 3 },
      { studentId: "s2", studentName: "박지율", absences: 4 }, // tier 3
      { studentId: "s3", studentName: "정호", absences: 5 }, // tier 5
      { studentId: "s4", studentName: "이유", absences: 2 }, // 미달 제외
    ]);
    expect(events).toEqual([
      { subjectKey: "s1", bucket: "3", studentName: "김보민", absences: 3, tier: 3 },
      { subjectKey: "s2", bucket: "3", studentName: "박지율", absences: 4, tier: 3 },
      { subjectKey: "s3", bucket: "5", studentName: "정호", absences: 5, tier: 5 },
    ]);
  });

  it("같은 학생이 tier를 넘으면 다른 bucket(승격 시에만 새 이벤트)", () => {
    expect(buildAbsenceEvents([{ studentId: "s1", studentName: "A", absences: 4 }])[0].bucket).toBe("3");
    expect(buildAbsenceEvents([{ studentId: "s1", studentName: "A", absences: 6 }])[0].bucket).toBe("5");
  });
});

describe("buildFollowupEvents", () => {
  it("today=due, overdue=overdue만 이벤트(soon/later/done 제외)", () => {
    const events = buildFollowupEvents([
      { consultationId: "c1", studentName: "김", followUpDate: "2026-07-17", counselorId: "u1", urgency: "today" },
      { consultationId: "c2", studentName: "이", followUpDate: "2026-07-10", counselorId: null, urgency: "overdue" },
      { consultationId: "c3", studentName: "박", followUpDate: "2026-07-19", counselorId: "u2", urgency: "soon" },
      { consultationId: "c4", studentName: "최", followUpDate: "2026-07-30", counselorId: "u3", urgency: "later" },
    ]);
    expect(events).toEqual([
      { subjectKey: "c1", bucket: "2026-07-17:due", studentName: "김", followUpDate: "2026-07-17", stage: "due", counselorId: "u1" },
      { subjectKey: "c2", bucket: "2026-07-10:overdue", studentName: "이", followUpDate: "2026-07-10", stage: "overdue", counselorId: null },
    ]);
  });

  it("같은 상담이 due→overdue로 넘어가면 다른 bucket(각 1회 알림)", () => {
    const due = buildFollowupEvents([{ consultationId: "c1", studentName: "김", followUpDate: "2026-07-17", counselorId: "u1", urgency: "today" }]);
    const overdue = buildFollowupEvents([{ consultationId: "c1", studentName: "김", followUpDate: "2026-07-17", counselorId: "u1", urgency: "overdue" }]);
    expect(due[0].bucket).toBe("2026-07-17:due");
    expect(overdue[0].bucket).toBe("2026-07-17:overdue");
  });
});

describe("본문 문구", () => {
  it("결석 집계 — 1명/여러명", () => {
    expect(absenceDigestBody([])).toBe(null);
    expect(absenceDigestBody([{ subjectKey: "s1", bucket: "3", studentName: "김보민", absences: 3, tier: 3 }])).toContain(
      "김보민 학생이 최근 14일 3회",
    );
    const many = absenceDigestBody([
      { subjectKey: "s1", bucket: "3", studentName: "김보민", absences: 3, tier: 3 },
      { subjectKey: "s2", bucket: "5", studentName: "박지율", absences: 5, tier: 5 },
    ]);
    expect(many).toContain("김보민·박지율");
    expect(many).toContain("5회 이상");
  });

  it("후속조치 — due는 '오늘 마감 예정', overdue는 '기한 지남'", () => {
    expect(followupBody({ subjectKey: "c1", bucket: "b", studentName: "김", followUpDate: "2026-07-17", stage: "due", counselorId: null })).toContain("오늘(2026-07-17) 마감 예정");
    expect(followupBody({ subjectKey: "c1", bucket: "b", studentName: "김", followUpDate: "2026-07-10", stage: "overdue", counselorId: null })).toContain("기한(2026-07-10)을 지났습니다");
  });
});

describe("summarizeNames", () => {
  it("max 초과분은 '외 N명'", () => {
    expect(summarizeNames(["a", "b", "c", "d", "e"])).toBe("a·b·c 외 2명");
    expect(summarizeNames(["a", "b"])).toBe("a·b");
  });
});
