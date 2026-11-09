import { describe, expect, it } from "vitest";
import { buildCounselDuties, buildNewcomerDuties } from "./monthly";
import { indexChecks } from "@/features/newcomers/subject-rows";
import { kstDueAt } from "./daily";

describe("buildCounselDuties", () => {
  const pairs = [{ teacherId: "t1", studentId: "s1", classId: "c1", subject: "math" }, { teacherId: "t1", studentId: "s2", classId: "c1", subject: "math" }, { teacherId: "t2", studentId: "s1", classId: "c9", subject: "english" }];
  it("담임×학생×과목마다 그 달 한 건 · 본인 상담이 그 달에 있으면 done(가장 이른 시각) · 남의 상담·지난달 상담은 안 센다 · 기한 = 말일", () => {
    const rows = buildCounselDuties({ month: "2026-11", pairs, consults: [
      { studentId: "s1", counselorId: "t1", consultedAt: "2026-11-05T02:00:00Z" }, { studentId: "s1", counselorId: "t1", consultedAt: "2026-11-03T02:00:00Z" },
      { studentId: "s2", counselorId: "t9", consultedAt: "2026-11-04T02:00:00Z" }, { studentId: "s1", counselorId: "t2", consultedAt: "2026-10-30T02:00:00Z" },
    ] });
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.subjectKey === "s1|t1:math")).toMatchObject({ status: "done", doneAt: "2026-11-03T02:00:00Z", dueAt: kstDueAt("2026-11-30", 1, 0), cycle: "2026-11", period: "monthly" });
    expect(rows.find((r) => r.subjectKey === "s2|t1:math")).toMatchObject({ status: "open" });
    expect(rows.find((r) => r.subjectKey === "s1|t2:english")).toMatchObject({ status: "open", ownerId: "t2" });
  });
  it("퇴사한 담임은 비운다", () => {
    const rows = buildCounselDuties({ month: "2026-11", pairs, consults: [], inactiveTeacherIds: new Set(["t2"]) });
    expect(rows.find((r) => r.subjectKey === "s1|t2:english")).toMatchObject({ ownerId: null, ownerSource: "retired" });
  });
});

describe("buildNewcomerDuties", () => {
  const checks = indexChecks([{ studentId: "n1", itemKey: "pre_call", doneOn: "2026-10-30", subject: "math" }]);
  it("필수 항목마다 학생×과목 한 건 · 체크면 done · 첫 수업일 모르면 그 항목은 안 만든다 · 2개월 콜(필요시) 제외", () => {
    const rows = buildNewcomerDuties({ today: "2026-11-09", checks, ownerOf: (sid, sub) => (sub === "math" ? "t1" : null),
      students: [{ id: "n1", enrolledOn: "2026-10-28", subjects: new Map([["math", "2026-11-01"]]), earliest: "2026-11-01" },
        { id: "n2", enrolledOn: "2026-11-05", subjects: new Map(), earliest: null }] });
    const n1 = rows.filter((r) => r.studentId === "n1");
    expect(n1.map((r) => r.cycle)).toEqual(["pre_call", "first_class_guide", "ojt", "after_first_call", "month1_call", "month3_call"]);
    expect(n1[0]).toMatchObject({ status: "done", subjectKey: "n1|math", ownerId: "t1", source: "onboarding_check" });
    expect(n1.find((r) => r.cycle === "month1_call")).toMatchObject({ status: "open", dueAt: kstDueAt("2026-11-27", 1, 0) });
    // n2: 첫 수업일 없음 → firstClass 기준 항목(사전 콜·첫 수업 안내·첫 수업 후 콜)은 없고 등록일 기준(OJT·1·3개월)만.
    expect(rows.filter((r) => r.studentId === "n2").map((r) => r.cycle)).toEqual(["ojt", "month1_call", "month3_call"]);
    expect(rows.find((r) => r.studentId === "n2")).toMatchObject({ ownerId: null, subject: null, subjectKey: "n2|" });
  });
});
