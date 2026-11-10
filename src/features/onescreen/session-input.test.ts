import { describe, expect, it } from "vitest";
import { buildSessionInput, initReports } from "./session-input";
import type { OneScreenStudent, Subject } from "./types";

function row(over: Partial<Subject> = {}): Subject {
  return { name: "수학", subjectKey: "math", classId: "c1", today: "1-1", ...over } as Subject;
}

function student(over: Partial<OneScreenStudent> = {}): OneScreenStudent {
  return {
    id: "s1",
    name: "학생",
    grade: "중1",
    tag: "A반",
    attendance: "출석",
    subjects: [row()],
    tests: { daily: { score: 18, max: 20 }, check: { score: 9, max: 10 } },
    attitude: "좋음",
    homework: "",
    note: "",
    progressConfirmed: false,
    ...over,
  } as OneScreenStudent;
}

const OPTS = { date: "2026-11-10", showDailyTest: true, showCheckTest: true };

describe("buildSessionInput", () => {
  it("대상 날짜·학생 값을 싣고, 빈 과제·메모는 null로 보낸다", () => {
    const out = buildSessionInput(student({ sessionUpdatedAt: "t0", studyGrade: "중2" }), undefined, OPTS);
    expect(out).toMatchObject({
      studentId: "s1",
      outOfClass: false,
      sessionDate: "2026-11-10",
      classId: null,
      baseUpdatedAt: "t0",
      studyGrade: "중2",
      dailyScore: 18,
      dailyMax: 20,
      checkScore: 9,
      checkMax: 10,
      attitude: "좋음",
      homework: null,
      note: null,
      progressConfirmed: false,
    });
  });

  it("빈 날짜는 서버 오늘(undefined) · 끈 테스트는 점수를 비운다(최대값은 그대로)", () => {
    const out = buildSessionInput(student(), undefined, { date: "", showDailyTest: false, showCheckTest: false });
    expect(out.sessionDate).toBeUndefined();
    expect(out.dailyScore).toBeNull();
    expect(out.checkScore).toBeNull();
    expect(out.dailyMax).toBe(20);
    expect(out.checkMax).toBe(10);
  });

  it("행 키 = 보강 전용 키 → 반 키 → 과목키 → 이름 순", () => {
    const s = student({
      subjects: [
        row({ name: "수학 (보강)", makeup: true, classId: undefined }),
        row({ name: "수학" }),
        row({ name: "국어", subjectKey: "korean", classId: undefined }),
        row({ name: "기타", subjectKey: undefined, classId: undefined }),
      ],
    });
    expect(Object.keys(buildSessionInput(s, undefined, OPTS).subjectProgress)).toEqual(["makeup::math", "c1", "korean", "기타"]);
  });

  it("손대지 않은 선택 칸은 싣지 않고, 모드 해제는 빈 문자열로 싣는다", () => {
    const entry = buildSessionInput(student(), undefined, OPTS).subjectProgress.c1!;
    expect(entry.mode).toBe("");
    for (const k of ["videoHomework", "videoSubmitLink", "videoHomeworkDue", "understanding", "dailyTestSkip", "attitude", "templateId", "trendAutoDraft", "autoDraftTemplate"])
      expect(entry).not.toHaveProperty(k);
  });

  it("행 평가값은 지정된 행만 · 일일 테스트 사유 null(되돌림)도 싣는다", () => {
    const s = student({ subjects: [row({ attitude: "보통", dailyTestSkip: null })] });
    const entry = buildSessionInput(s, undefined, OPTS).subjectProgress.c1!;
    expect(entry).toMatchObject({ attitude: "보통", dailyTestSkip: null });
  });

  it("영어 행만 템플릿 칸을 싣는다 — 글 없는 기본값 템플릿은 빈 값", () => {
    const s = student({ subjects: [row({ name: "영어", subjectKey: "english", classId: "e1" })] });
    const implicit = buildSessionInput(s, { 영어: { draft: "", sent: false, templateId: "tp", templateImplicit: true } }, OPTS);
    expect(implicit.subjectProgress.e1).toMatchObject({ templateId: "", nextTest: "", wordRetest: false });
    const written = buildSessionInput(s, { 영어: { draft: "글", sent: false, templateId: "tp", templateImplicit: true } }, OPTS);
    expect(written.subjectProgress.e1!.templateId).toBe("tp");
  });

  it("초안·자동작성 스냅샷은 보고서 state에서 · 템플릿 폴백 표시는 true일 때만", () => {
    const r = { 수학: { draft: "멘트", sent: false, autoDraft: "자동", trendAutoDraft: "추세", autoDraftTemplate: true } };
    const entry = buildSessionInput(student(), r, OPTS).subjectProgress.c1!;
    expect(entry).toMatchObject({ draft: "멘트", autoDraft: "자동", trendAutoDraft: "추세", autoDraftTemplate: true });
  });
});

describe("initReports", () => {
  it("과목별로 세션 복원값을 시딩한다 — 발송·철회·첨부 기본값", () => {
    const s = student({ subjects: [row({ draft: "초안", reportSent: true, revokedAt: "x" } as Partial<Subject>)] });
    const out = initReports([s]);
    expect(out.s1!["수학"]).toMatchObject({ draft: "초안", sent: true, revoked: true, attachments: [] });
  });

  it("글 없고 안 보낸 영어 행에만 기본 템플릿을 표시로 붙인다", () => {
    const prefs = { last: null, byClass: { e1: "my-template" } };
    const blank = student({ subjects: [row({ name: "영어", subjectKey: "english", classId: "e1" })] });
    expect(initReports([blank], prefs).s1!["영어"]).toMatchObject({ templateId: "my-template", templateImplicit: true });
    const drafted = student({ subjects: [row({ name: "영어", subjectKey: "english", classId: "e1", draft: "글" } as Partial<Subject>)] });
    const r = initReports([drafted], prefs).s1!["영어"]!;
    expect(r.templateImplicit).toBeUndefined();
    expect(r.templateId).toBeUndefined();
  });
});
