import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isCleanupExit } from "@/features/withdrawals/system-bulk";
import { contributionRoster } from "../model/roster";
import { getContributionGate } from "./access";
import { getContributionStudents } from "./directory";

/** 점수 기간 변경에는 반·과목·설정을 다시 읽지 않는다. 장부 정리 학생만 수강 이력을 대조한다. */
export async function getContributionScoreRoster() {
  const gate = await getContributionGate();
  if (!gate) return null;
  const students = await getContributionStudents(), cleanup = students.filter((s) => isCleanupExit(s.withdrawal_metadata)).map((s) => s.id);
  const db = createAdminClient();
  const enrolled = await fetchAllPagedInChunks<{ student_id: string }>(cleanup, (chunk, a, b) => db.from("enrollments")
    .select("student_id").eq("tenant_id", gate.tenantId).in("student_id", chunk).order("id").range(a, b));
  return { gate, rows: contributionRoster(students, new Set(enrolled.map((r) => r.student_id))) };
}
