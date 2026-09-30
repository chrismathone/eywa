import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

// The production sync scripts are CommonJS workers.
const require_ = createRequire(import.meta.url);
const { makeCounselorMatcher, registrantFromSummary, singleCounselorSubject, resolveConsultationSubject, subjectKeyOf } =
  require_("./consultation-counselor.cjs");

const users = [
  { id: "song", display_name: "송지혜", english_name: "Song", status: "active" },
  { id: "lee", display_name: "이지은", english_name: "Amy", status: "active" },
  { id: "another", display_name: "이유정", english_name: null, status: "active" },
];

describe("Makeedu consultation counselor matching", () => {
  const match = makeCounselorMatcher(users);

  it("matches a Korean name followed by a different English alias", () => {
    expect(match("송지혜 Jennifer")?.id).toBe("song");
    expect(match("송지혜 (Jennifer)")?.id).toBe("song");
  });

  it("matches existing parenthesized and plain names", () => {
    expect(match("이지은(Amy)")?.id).toBe("lee");
    expect(match("이유정")?.id).toBe("another");
    expect(match("Amy")?.id).toBe("lee");
  });

  it("refuses ambiguous Korean names", () => {
    const ambiguous = makeCounselorMatcher([...users, { id: "duplicate", display_name: "송지혜", english_name: null, status: "active" }]);
    expect(ambiguous("송지혜 Jennifer")).toBeNull();
    expect(ambiguous("송지혜")).toBeNull();
    expect(match("다른사람 Amy")).toBeNull();
  });

  it("matches English-first labels and is case-insensitive", () => {
    expect(match("Jennifer 송지혜")?.id).toBe("song");
    expect(match("Amy(이지은)")?.id).toBe("lee");
    expect(match("amy")?.id).toBe("lee");
    expect(match("  이지은   (Amy) ")?.id).toBe("lee");
  });

  it("strips an honorific only when the raw label does not match", () => {
    expect(match("이유정 선생님")?.id).toBe("another");
    expect(match("이유정쌤")?.id).toBe("another");
    expect(match("Amy T")?.id).toBe("lee");
    const matt = makeCounselorMatcher([{ id: "matt", display_name: "MATT", english_name: null, status: "active" }]);
    expect(matt("MATT")?.id).toBe("matt");
  });

  it("prefers the one active person among same-name staff (timetable nickname rule)", () => {
    const withLeaver = makeCounselorMatcher([
      ...users,
      { id: "old", display_name: "송지혜", english_name: "Jennifer", status: "inactive" },
      { id: "zoe1", display_name: "곽민정", english_name: "Zoe", status: "inactive" },
      { id: "zoe2", display_name: "박나연", english_name: "Zoe", status: "inactive" },
    ]);
    expect(withLeaver("송지혜")?.id).toBe("song");
    expect(withLeaver("Zoe")).toBeNull(); // 둘 다 퇴사 → 모호
  });

  it("uses the English alias to split two active same-name staff", () => {
    const twins = makeCounselorMatcher([
      { id: "a", display_name: "김민지", english_name: "Grace", status: "active" },
      { id: "b", display_name: "김민지", english_name: "Mia", status: "active" },
    ]);
    expect(twins("김민지 (Mia)")?.id).toBe("b");
    expect(twins("김민지")).toBeNull();
    expect(twins("김민지 Lily")).toBeNull();
  });

  it("reads the registrant line from imported consultation details", () => {
    expect(registrantFromSummary("제목\n\n상담 기록 항목:\n2026년 09월 22일\n송지혜 Jennifer\n상담 내용: ..."))
      .toBe("송지혜 Jennifer");
    expect(registrantFromSummary("상담 기록 항목:\n​2026년 07월 13일\n이다교\n상담 내용: ..."))
      .toBe("이다교");
    expect(registrantFromSummary("제목\n본문만 있음")).toBeNull();
  });

  it("fills a subject only for a single configured staff subject", () => {
    expect(singleCounselorSubject({ subjects: ["english"] }, { english: "영어" })).toBe("영어");
    expect(singleCounselorSubject({ subjects: ["english", "math"] }, { english: "영어" })).toBeNull();
  });
});

describe("resolveConsultationSubject", () => {
  const labels = { math: "수학", english: "영어", science: "과학" };
  const r = (args: Record<string, unknown>) => resolveConsultationSubject({ labels, ...args });

  it("normalizes source text to a configured subject (key, label, spacing)", () => {
    expect(subjectKeyOf("수학", labels)).toBe("math");
    expect(subjectKeyOf("Math", labels)).toBe("math");
    expect(subjectKeyOf(" 영 어 ", labels)).toBe("english");
    expect(subjectKeyOf("수학(심화)", labels)).toBeNull();
    expect(r({ sourceSubject: "영어", counselor: { subjects: ["math"] } })).toEqual({ key: "english", label: "영어", reason: "source" });
  });

  it("uses the counselor's single subject when the student's enrollment does not contradict it", () => {
    expect(r({ counselor: { subjects: ["math"] }, enrolledSubjects: ["math", "english"] })).toEqual({
      key: "math",
      label: "수학",
      reason: "counselor_single",
    });
    // 그날 수강 기록이 없으면(퇴원생·조회 실패) 상담사 과목 그대로.
    expect(r({ counselor: { subjects: ["math"] }, enrolledSubjects: [] })?.key).toBe("math");
  });

  it("leaves it blank when a single-subject counselor talks to a student who does not take that subject", () => {
    // 수학 강사가 영어만 듣는 학생을 상담 — 수학을 박지 않는다(추측 금지).
    expect(r({ counselor: { subjects: ["math"] }, enrolledSubjects: ["english"] })).toBeNull();
  });

  it("ignores counselor subjects that are not configured", () => {
    expect(r({ counselor: { subjects: ["arts", "math"] } })?.reason).toBe("counselor_single");
  });

  it("narrows a multi-subject counselor by the student's enrollment that day", () => {
    expect(r({ counselor: { subjects: ["math", "english"] }, enrolledSubjects: ["english", "science"] })).toEqual({
      key: "english",
      label: "영어",
      reason: "counselor_enrollment_overlap",
    });
    expect(r({ counselor: { subjects: ["math", "english"] }, enrolledSubjects: ["math", "english"] })).toBeNull();
    expect(r({ counselor: { subjects: ["math", "english"] }, enrolledSubjects: ["science"] })).toBeNull();
    expect(r({ counselor: { subjects: ["math", "english"] }, enrolledSubjects: [] })).toBeNull();
  });

  it("falls back to the student's single subject only when the counselor gives no subject", () => {
    expect(r({ counselor: null, enrolledSubjects: ["math", "math"] })?.reason).toBe("student_single_enrollment");
    expect(r({ counselor: { subjects: [] }, enrolledSubjects: ["english"] })?.key).toBe("english");
    expect(r({ counselor: null, enrolledSubjects: ["math", "english"] })).toBeNull();
    expect(r({ counselor: null, enrolledSubjects: [] })).toBeNull();
  });
});
