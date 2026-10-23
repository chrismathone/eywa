import "server-only";
import { describeStudentStatus } from "@/features/students/ontology/student-status";
import { sectionResult } from "@/features/students/ontology/live-contract";
import { readSection, type LiveContext } from "./live-context";

export function readLiveStudentStatus(c: LiveContext) {
  const href = `/students/${c.studentId}`;
  return readSection("studentStatus", "재원 상태", href, async () => {
    const [profile, ended] = await Promise.all([
      c.db.from("students").select("status, enrolled_at, withdrawn_at, withdrawal_metadata").eq("tenant_id", c.tenant).eq("id", c.studentId).maybeSingle(),
      c.db.from("enrollments").select("id", { count: "exact" }).eq("tenant_id", c.tenant).eq("student_id", c.studentId).not("end_date", "is", null).limit(1),
    ]);
    if (profile.error) throw profile.error;
    if (ended.error) throw ended.error;
    if (!profile.data || ended.count === null) throw new Error("Student status source unavailable");
    return { ...sectionResult("studentStatus", "재원 상태", href, [{ id: c.studentId,
      ...describeStudentStatus(profile.data, ended.count > 0, c.today),
      evidence: [{ source: "students", id: c.studentId, studentId: c.studentId, href }],
    }], 1), note: "학생 프로필의 현재 상태와 날짜입니다. 모든 재원·휴원·퇴원 이력이 저장된 자료는 아닙니다." };
  });
}
