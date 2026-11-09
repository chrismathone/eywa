import { describe, expect, it } from "vitest";
import { buildStudentBasics, type BasicEnrollment } from "./student-basics";

const today = "2026-11-02";
const enrollment = (patch: Partial<BasicEnrollment> = {}): BasicEnrollment => ({ subject: "math", startDate: "2026-09-01", endDate: null,
  isTransferred: false, onHold: false, classActive: true, closedAt: null, teacherName: "수학 담임", teacherAssigned: true, ...patch });

describe("수학 시트 학생 수강 기본정보", () => {
  it("동시수강과 과목별 담임을 분리하며 중복 담임은 한 번만 표시한다", () => {
    const info = buildStudentBasics([enrollment(), enrollment({ subject: "english", teacherName: "영어 담임" }), enrollment({ subject: "english", teacherName: "영어 담임" }), enrollment({ subject: "english", teacherName: "다른 담임" })], today);
    expect(info.summary).toBe("영어·수학 동시수강");
    expect(info.subjects[0].teachers).toEqual(["다른 담임", "영어 담임"]);
    expect(info.subjects[1].teachers).toEqual(["수학 담임"]);
  });
  it("반 이동 경계 당일에는 새 담임을 표시하며 과목 시작일은 이어진다", () => {
    const info = buildStudentBasics([enrollment({ startDate: "2025-03-01", endDate: today, isTransferred: true, teacherName: "이전 담임" }), enrollment({ startDate: today })], today);
    expect(info.summary).toBe("수학만 수강");
    expect(info.subjects[1]).toMatchObject({ startedOn: "2025-03-01", teachers: ["수학 담임"] });
  });
  it("퇴원 후 다시 등록하면 최근 연속 수강 시작일과 최초 기록을 구분한다", () => {
    const info = buildStudentBasics([enrollment({ startDate: "2025-03-01", endDate: "2026-08-01" }), enrollment()], today);
    expect(info.subjects[1]).toMatchObject({ startedOn: "2026-09-01", firstRecordedOn: "2025-03-01" });
  });
  it("일반 종료일 당일까지 포함하며 미래 영어 배정은 동시수강에 포함하지 않는다", () => {
    const info = buildStudentBasics([enrollment({ endDate: today }), enrollment({ subject: "english", startDate: "2026-11-03" })], today);
    expect(info.summary).toBe("수학만 수강");
    expect(info.subjects[0]).toMatchObject({ state: "upcoming", startedOn: "2026-11-03" });
    expect(buildStudentBasics([enrollment({ endDate: "2026-11-01" })], today).summary).toBe("현재 수강 없음");
  });
  it("휴원과 미수강을 구분한다", () => {
    const info = buildStudentBasics([enrollment(), enrollment({ subject: "english", onHold: true })], today);
    expect(info.summary).toBe("수학 수강 · 영어 휴원");
    expect(info.subjects[0].state).toBe("paused");
  });
  it("폐지·종강 반 또는 퇴원 학생의 열린 수강 기록으로 현재 수강을 부풀리지 않는다", () => {
    expect(buildStudentBasics([enrollment({ classActive: false })], today).summary).toBe("현재 수강 없음");
    expect(buildStudentBasics([enrollment({ closedAt: "2026-10-31" })], today).summary).toBe("현재 수강 없음");
    expect(buildStudentBasics([enrollment()], today, "2026-10-31").summary).toBe("현재 수강 없음");
  });
  it("시작일·담임이 없는 기록을 임의로 채우지 않는다", () => {
    const info = buildStudentBasics([enrollment({ startDate: null, teacherAssigned: false, teacherName: null })], today);
    expect(info.subjects[1]).toMatchObject({ state: "active", startedOn: null, teachers: ["담임 미지정"] });
    expect(buildStudentBasics([enrollment({ teacherName: null })], today).subjects[1].teachers).toEqual(["담임 확인 필요"]);
  });
});
