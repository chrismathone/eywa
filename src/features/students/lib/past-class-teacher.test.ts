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
  it("같은 날 여러 강사 기록이 있거나 수강 기간 밖이면 추측하지 않는다", () => {
    expect(resolvePastClassTeacher(target, null, [row("2026-09-29", "A"), row("2026-09-29", "B")], [row("2026-09-29", "A")])).toBeNull();
    expect(resolvePastClassTeacher(target, null, [row("2026-08-03", "이전 수강")], [])).toBeNull();
  });
});
