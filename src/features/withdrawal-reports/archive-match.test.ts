import { describe, expect, it } from "vitest";
import { matchArchive, type MatchStudent } from "./archive-match";
import { parseSourceDate, parseSourceReports, type ImportedReport } from "./source-parser";
const r = { studentName: "김학생", schoolGrade: "침산중1", sheetTitle: "25.05", exitDate: "2025-05-20", className: "수학반", subject: "math" } as ImportedReport;
const student = { id: "s", name: "김학생", school: "침산중", grade: "중2", status: "withdrawn", withdrawn_at: "2025-05-20", courses: [] } as MatchStudent;
describe("historical identity and source preservation", () => {
  it("accepts both frozen and automatically promoted historical grades", () => {
    expect(matchArchive(r, [student], "2026-10-14").studentId).toBe("s");
    expect(matchArchive(r, [{ ...student, grade: "중1" }], "2026-10-14").studentId).toBe("s");
  });
  it("does not treat a grade-only field as a school name", () => {
    expect(matchArchive({ ...r, schoolGrade: "중1" }, [student], "2026-10-14").studentId).toBe("s");
    for (const schoolGrade of ["1", "1학년", "중학교1학년"]) {
      expect(matchArchive({ ...r, schoolGrade }, [student], "2026-10-14").studentId).toBe("s");
    }
  });
  it("matches enrolled students and recognizes course display decorations", () => {
    const enrolled = { ...student, school: "옥산초", grade: "초6", status: "enrolled", withdrawn_at: null, courses: [{ className: "중등E_초등 브릿지 C (~26.09.30)", subject: "english" }] };
    expect(matchArchive({ ...r, schoolGrade: "옥사초6", className: "초등 브릿지C반", subject: "english" }, [enrolled], "2026-10-22").studentId).toBe("s");
    expect(matchArchive({ ...r, schoolGrade: "옥사초6", className: "초등 브릿지D반", subject: "english" }, [enrolled], "2026-10-22").studentId).toBeNull();
    expect(matchArchive({ ...r, schoolGrade: "옥사초6", className: "초등 브릿지C반", subject: "math" }, [enrolled], "2026-10-22").studentId).toBeNull();
    expect(matchArchive({ ...r, schoolGrade: "옥사초6", className: "중등M_초등 브릿지 C", subject: null }, [enrolled], "2026-10-22").studentId).toBeNull();
  });
  it("removes only grade/school annotations in a name cell and leaves multiple names unresolved", () => {
    expect(matchArchive({ ...r, studentName: "김학생\n중1\n침중" }, [student], "2026-10-14").studentId).toBe("s");
    expect(matchArchive({ ...r, studentName: "김학생,\n이학생" }, [student], "2026-10-14").studentId).toBeNull();
    expect(matchArchive({ ...r, studentName: "김학생\n이중" }, [student], "2026-10-14").studentId).toBeNull();
  });
  it("uses an explicit suffix to select that identity without falling back to another suffix", () => {
    const a = { ...student, id: "a", name: "김학생A" }, b = { ...student, id: "b", name: "김학생B" };
    expect(matchArchive({ ...r, studentName: "김학생 A" }, [a, b], "2026-10-14").studentId).toBe("a");
    expect(matchArchive({ ...r, studentName: "김학생A" }, [b], "2026-10-14").studentId).toBeNull();
    expect(matchArchive(r, [a, b], "2026-10-14").studentId).toBeNull();
  });
  it("still checks numeric and name-cell grades instead of discarding them", () => {
    expect(matchArchive({ ...r, schoolGrade: "5" }, [student], "2026-10-14").studentId).toBeNull();
    expect(matchArchive({ ...r, schoolGrade: "", studentName: "김학생\n초1" }, [student], "2026-10-14").studentId).toBeNull();
  });
  it("requires review when an original date belongs to a different era", () => {
    expect(matchArchive({ ...r, schoolGrade: "1", exitDate: "2012-02-20" }, [student], "2026-10-14").studentId).toBeNull();
  });
  it("leaves conflicting identities and unresolved homonyms unmapped", () => {
    expect(matchArchive(r, [{ ...student, school: "성광중" }], "2026-10-14").studentId).toBeNull();
    expect(matchArchive(r, [student, { ...student, id: "s2" }], "2026-10-14").studentId).toBeNull();
    expect(matchArchive({ ...r, schoolGrade: "", exitDate: null }, [student, { ...student, id: "s2", name: "김학생A" }], "2026-10-14").studentId).toBeNull();
  });
  it("uses school evidence to distinguish suffix names without guessing", () => {
    expect(matchArchive(r, [student, { ...student, id: "s2", name: "김학생A", school: "다른중" }], "2026-10-14").studentId).toBe("s");
  });
  it("preserves unknown names and invalid source dates", () => {
    expect(matchArchive({ ...r, studentName: "" }, [student], "2026-10-14").studentId).toBeNull();
    expect(parseSourceDate("2/30", "26.02")).toBeNull();
    expect(parseSourceDate("25.12.31", "26.01")).toBe("2025-12-31");
    expect(parseSourceDate("9/28", "26.10")).toBe("2026-09-28");
  });
  it("keeps unnamed substantive forms and blank signatures without inventing approval", () => {
    const sheet = { sheetId: 7, title: "원본", hidden: true, values: [["퇴원처리서", "", "담임", "", "원장"], ["", "", "", "", ""], ["", "", "김강사", "", ""], ["성명", ""], ["학년", "중1"], ["퇴원일", "불명"], ["퇴원 상세사유", "상담 기록\n원문 그대로"]] };
    const [report] = parseSourceReports(sheet);
    expect(report.studentName).toBe(""); expect(report.exitDate).toBeNull(); expect(report.rawExitDate).toBe("불명");
    expect(report.fields["상세사유"]).toBe("상담 기록\n원문 그대로");
    expect(report.signatures.find(s => s.role === "원장")?.name).toBe("");
    expect(report.rawGrid[6][1]).toBe("상담 기록\n원문 그대로");
    expect(parseSourceReports({ ...sheet, sheetId: 8 })[0].sourceKey).not.toBe(report.sourceKey);
  });
});
