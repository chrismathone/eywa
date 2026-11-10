import { describe, expect, it } from "vitest";
import { EMPTY_ABSENCES, candidateAnchorClassId, hostChoicesOfAsk, pendingMakeupRows, type MakeupAsk } from "./makeup-ask-plan";
import type { MergeCandidate } from "./makeup-merge-plan";
import type { TodayClass } from "./server/roster";
import type { OneScreenStudent, Subject } from "./types";

const cand = (classId: string, subjectKey: string) => ({ name: classId, classId, subjectKey, attendanceRaw: null, attendanceUnits: null }) as MergeCandidate;
const row = (over: Partial<Subject>) => ({ name: "수학", subjectKey: "math", classId: "c1", ...over }) as Subject;
const stu = (subjects: Subject[]) => ({ id: "s1", name: "학생", subjects }) as unknown as OneScreenStudent;

describe("candidateAnchorClassId — 보조 앵커는 후보가 한 과목일 때만", () => {
  it("한 과목이면 첫 후보 반 · 두 과목이면 null · 없으면 null", () => {
    expect(candidateAnchorClassId([cand("c1", "math"), cand("c2", "math")])).toBe("c1");
    expect(candidateAnchorClassId([cand("c1", "math"), cand("e1", "english")])).toBeNull();
    expect(candidateAnchorClassId([])).toBeNull();
  });
});

describe("pendingMakeupRows — 더할 보강 행", () => {
  const mk = stu([row({ classId: null }), row({ name: "영어", subjectKey: "english", classId: null })]);
  it("학생이 듣는 과목으로 좁히고, 같은 과목 보강 행이 이미 있으면 뺀다", () => {
    expect(pendingMakeupRows(stu([row({})]), mk).map((s) => s.subjectKey)).toEqual(["math"]);
    expect(pendingMakeupRows(stu([row({}), row({ name: "수학 (보강)", classId: null, makeup: true })]), mk)).toEqual([]);
  });
  it("겹치는 과목이 없으면(순수 추가 보강) 전체 · 과목을 지정하면 그 과목만", () => {
    expect(pendingMakeupRows(stu([row({ subjectKey: "korean" })]), mk)).toHaveLength(2);
    expect(pendingMakeupRows(stu([row({})]), mk, "english").map((s) => s.subjectKey)).toEqual(["english"]);
  });
});

describe("hostChoicesOfAsk — 창에 보일 수업 후보", () => {
  const ask = (hostClasses?: MakeupAsk["hostClasses"]): MakeupAsk => ({
    studentId: "s1",
    studentName: "학생",
    mk: stu([]),
    candidates: [],
    sentSubjects: [],
    isNew: false,
    absences: EMPTY_ABSENCES,
    absencesLoading: false,
    hostClasses,
  });
  const options = [
    { classId: "c1", className: "A", subject: "math", enrolled: true },
    { classId: "c2", className: "B", subject: "math", enrolled: true },
    { classId: "c3", className: "C", subject: "math", enrolled: false },
  ];
  it("다니는 반만 · 오늘 정규 행이 있는 반은 뺀다 · 위임받은 반만 있으면 담임 반 아님", () => {
    const students = [stu([row({ classId: "c1" })])];
    const out = hostChoicesOfAsk(ask({ options, loading: false }), students, [{ id: "c1", delegated: false } as TodayClass])!;
    expect(out.options.map((o) => o.classId)).toEqual(["c2"]);
    expect(out.regularToday).toBe(true);
    expect(hostChoicesOfAsk(ask({ options, loading: false }), students, [{ id: "c1", delegated: true } as TodayClass])!.regularToday).toBe(false);
  });
  it("수업 후보를 안 싣는 창이면 undefined", () => {
    expect(hostChoicesOfAsk(ask(undefined), [], [])).toBeUndefined();
  });
});
