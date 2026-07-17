import { describe, expect, it } from "vitest";
import {
  absenceDigestBody,
  absenceTier,
  buildAbsenceEvents,
  buildFollowupEvents,
  buildGradeDropEvents,
  followupBody,
  gradeDropDigestBody,
  groupEventsByTeacher,
  summarizeNames,
  type AbsenceEvent,
  type GradeRow,
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

describe("buildGradeDropEvents (성적 급락)", () => {
  const g = (
    studentId: string,
    name: string,
    subject: string,
    gradeId: string,
    takenOn: string,
    pct: number | null,
  ): GradeRow => ({ studentId, studentName: name, subject, subjectLabel: subject === "math" ? "수학" : "영어", gradeId, takenOn, pct });

  it("같은 과목 최신 vs 직전 ≥15점 하락만 이벤트, bucket=과목:최신gradeId", () => {
    const events = buildGradeDropEvents([
      g("s1", "김", "math", "gA", "2026-06-01", 90),
      g("s1", "김", "math", "gB", "2026-07-01", 70), // 20점 하락 → 이벤트
      g("s2", "이", "math", "gC", "2026-06-01", 80),
      g("s2", "이", "math", "gD", "2026-07-01", 72), // 8점 하락 → 임계 미달 제외
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subjectKey: "s1", bucket: "math:gB", studentName: "김", drop: 20, latestPct: 70 });
  });

  it("과목이 다르면 섞어 비교하지 않는다(수학↓·영어는 별개)", () => {
    const events = buildGradeDropEvents([
      g("s1", "김", "math", "gA", "2026-06-01", 90),
      g("s1", "김", "english", "gB", "2026-07-01", 60), // 다른 과목 — math 90과 비교 안 함
    ]);
    expect(events).toEqual([]); // 각 과목 1건씩뿐이라 비교 불가
  });

  it("직전 점수 없으면(과목 1건) 제외, 상승은 제외, pct null 제외", () => {
    expect(buildGradeDropEvents([g("s1", "김", "math", "gA", "2026-07-01", 50)])).toEqual([]);
    expect(
      buildGradeDropEvents([
        g("s1", "김", "math", "gA", "2026-06-01", 60),
        g("s1", "김", "math", "gB", "2026-07-01", 85), // 상승
      ]),
    ).toEqual([]);
    expect(
      buildGradeDropEvents([
        g("s1", "김", "math", "gA", "2026-06-01", 90),
        g("s1", "김", "math", "gB", "2026-07-01", null), // 계산 불가
      ]),
    ).toEqual([]);
  });

  it("본문 — 1명 과목·하락폭, 여러명 집계", () => {
    expect(gradeDropDigestBody([])).toBe(null);
    const one = gradeDropDigestBody([{ subjectKey: "s1", bucket: "b", studentName: "김보민", subjectLabel: "수학", drop: 18, latestPct: 62 }]);
    expect(one).toContain("김보민 학생 수학 성적이 18점 하락");
    expect(one).toContain("현재 62점");
  });
});

describe("groupEventsByTeacher (v2 제네릭)", () => {
  const ev = (studentId: string, name: string, tier: number): AbsenceEvent => ({
    subjectKey: studentId,
    bucket: String(tier),
    studentName: name,
    absences: tier,
    tier,
  });

  it("강사는 자기 학생 이벤트만, 다중 반 학생은 여러 강사에게", () => {
    const events = [ev("s1", "김보민", 3), ev("s2", "박지율", 5), ev("s3", "정호", 3)];
    const map = new Map<string, string[]>([
      ["s1", ["t1"]], // 김보민 → 강사 t1
      ["s2", ["t1", "t2"]], // 박지율 → t1·t2 두 반
      ["s3", ["t2"]], // 정호 → t2
    ]);
    const byTeacher = groupEventsByTeacher(events, map);
    expect(byTeacher.get("t1")?.map((e) => e.studentName)).toEqual(["김보민", "박지율"]);
    expect(byTeacher.get("t2")?.map((e) => e.studentName)).toEqual(["박지율", "정호"]);
  });

  it("담당 강사 없는 학생은 아무에게도 안 감(맵에 없으면 스킵)", () => {
    const byTeacher = groupEventsByTeacher([ev("s9", "무담당", 3)], new Map());
    expect(byTeacher.size).toBe(0);
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
