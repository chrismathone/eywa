import { describe, expect, it } from "vitest";
import { appliedAuditMeta } from "./audit-meta";
import type { WithdrawalReport } from "./model";

const course = (id: string, className: string) => ({
  id, classId: `c-${id}`, className, subject: "math", teacherId: null, teacherName: null, startDate: "2026-03-01", endDate: null, onHold: false,
});
const report = (status: WithdrawalReport["status"], exit_kind: WithdrawalReport["exit_kind"] = "withdrawal") => ({
  status, exit_kind, student_id: "s1",
  snapshot: { name: "김학생", school: null, grade: null, enrolledAt: null, status: "active", withdrawnAt: null, courses: [course("e1", "M1A"), course("e2", "E2B")] },
});

describe("appliedAuditMeta — 퇴원보고서 감사로그의 처리 결과(2026-10-23)", () => {
  it("완료 = 학생 퇴원 · 학생 id · 끝낸 수강과 그 반 이름(요청 때 스냅샷)", () => {
    expect(appliedAuditMeta(report("completed"), ["e1"])).toEqual({ result: "학생 퇴원", studentId: "s1", enrollmentIds: ["e1"], endedClasses: ["M1A"] });
  });
  it("과목 수강 종료는 '수강 종료' — 학생 상태는 그대로다", () => {
    expect(appliedAuditMeta(report("completed", "subject_end"), ["e1", "e2"]).result).toBe("수강 종료");
  });
  it("끝낸 수강을 못 읽었으면 결과만 남긴다(빈 목록으로 꾸미지 않는다)", () => {
    expect(appliedAuditMeta(report("completed"), null)).toEqual({ result: "학생 퇴원", studentId: "s1" });
  });
  it("처리일이 남은 전원 승인 = 처리 예약 · 나머지 단계는 결과 칸 없음", () => {
    expect(appliedAuditMeta(report("scheduled"), null)).toEqual({ result: "처리 예약" });
    for (const s of ["requested", "revision", "manager_pending", "director_pending", "approved", "blocked", "canceled"] as const)
      expect(appliedAuditMeta(report(s), null), s).toEqual({});
  });
});
