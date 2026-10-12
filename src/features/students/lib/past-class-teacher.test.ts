import { describe, expect, it } from "vitest";
import { resolvePastClassTeacher } from "./past-class-teacher";

const target = { enrollmentId: "e", classId: "c", startDate: "2026-08-04", lastDate: "2026-10-01" };
const row = (date: string, name: string, classId = "c") => ({ date, name, classId });
describe("지난 수업 담당 복원", () => {
  it("종료일 배정 이력이 있으면 보고서보다 우선한다", () => {
    expect(resolvePastClassTeacher(target, "담임", [row("2026-09-29", "대신 작성")], [])).toMatchObject({ name: "담임", inferred: false });
  });
  it("월 경계를 넘어 종료일 이전 마지막 보고서로 찾는다", () => {
    expect(resolvePastClassTeacher(target, null, [row("2026-09-29", "유형숙"), row("2026-10-02", "새 담당")], [])).toMatchObject({ name: "유형숙", source: "report", inferred: true });
  });
  it("반이동 전날이 8/3이면 8/4 이후 새 담당을 과거에 붙이지 않는다", () => {
    expect(resolvePastClassTeacher({ ...target, startDate: "2026-02-24", lastDate: "2026-08-03" }, null,
      [row("2026-07-31", "이유정"), row("2026-08-04", "허은진")], [])?.name).toBe("이유정");
  });
  it("보고서가 없으면 같은 반의 수강 기간 내 출결로 찾는다", () => {
    expect(resolvePastClassTeacher(target, null, [row("2026-09-29", "다른 반", "other")], [row("2026-09-25", "출결 담당")])).toMatchObject({ name: "출결 담당", source: "attendance" });
  });
  it("수강 시작보다 앞서도 종료일 이전 가장 최근의 같은 반 보고서를 사용한다", () => {
    expect(resolvePastClassTeacher(
      { ...target, startDate: "2026-10-01", lastDate: "2026-10-07" }, null,
      [row("2026-09-22", "이전 담당"), row("2026-09-29", "유형숙"), row("2026-10-08", "다음 담당")],
      [row("2026-10-03", "출결 담당")],
    )).toMatchObject({ name: "유형숙", date: "2026-09-29", source: "report", inferred: true });
  });
  it("다른 기록이 없으면 반 배정 강사를 추정으로 쓰고, 보고서와 충돌하는 기록은 우선하지 않는다", () => {
    expect(resolvePastClassTeacher(target, null, [], [], "이성우"))
      .toMatchObject({ name: "이성우", source: "current", inferred: true });
    expect(resolvePastClassTeacher(target, null, [row("2026-09-29", "유형숙")], [], "다른 배정 강사"))
      .toMatchObject({ name: "유형숙", source: "report" });
    expect(resolvePastClassTeacher(target, null, [row("2026-09-29", "A"), row("2026-09-29", "B")], [], "다른 배정 강사"))
      .toBeNull();
  });
  it("같은 날 여러 강사 기록이 있거나 종료일 이전 근거가 없으면 추측하지 않는다", () => {
    expect(resolvePastClassTeacher(target, null, [row("2026-09-29", "A"), row("2026-09-29", "B")], [row("2026-09-29", "A")])).toBeNull();
    expect(resolvePastClassTeacher(target, null, [row("2026-10-02", "다음 담당")], [row("2026-08-03", "수강 전 출결")])).toBeNull();
  });
});
