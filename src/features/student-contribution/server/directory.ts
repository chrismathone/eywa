import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { contributionRoster, type ContributionRosterStudent } from "../model/roster";
import { getContributionGate } from "./access";
import { contributionReady, loadContributionSettings } from "./store";

// 요청 안에서만 공유한다. 학생 병합·재원 상태와 권한은 이전 요청의 값으로 재사용하지 않는다.
export const getContributionStudents = cache(async () => {
  const gate = await getContributionGate();
  if (!gate) throw new Error("기여도 기록을 열람할 수 없습니다");
  const db = createAdminClient();
  return fetchAllPaged<ContributionRosterStudent>((a, b) => db.from("students")
    .select("id, name, school, grade, status, is_test, notes, withdrawal_metadata")
    .eq("tenant_id", gate.tenantId).order("id").range(a, b));
});

export const getContributionSnapshot = cache(async () => {
  const gate = await getContributionGate();
  if (!gate) return null;
  const db = createAdminClient();
  const [ready, settings] = await Promise.all([contributionReady(db, gate.tenantId), loadContributionSettings(db, gate.tenantId)]);
  return { ready, ...settings };
});

/** 점수 조회 없이 선택 목록·과목·반 정보만 제공한다. notes는 클라이언트로 보내지 않는다. */
export const getContributionDirectory = cache(async () => {
  const gate = await getContributionGate();
  if (!gate) return null;
  const db = createAdminClient(), tenant = gate.tenantId;
  const [students, enrollments, classes, settings] = await Promise.all([
    getContributionStudents(),
    fetchAllPaged<{ student_id: string; class_id: string }>((a, b) => db.from("enrollments").select("student_id, class_id")
      .eq("tenant_id", tenant).order("id").range(a, b)),
    fetchAllPaged<{ id: string; subject: string; class_name: string }>((a, b) => db.from("classes").select("id, subject, class_name")
      .eq("tenant_id", tenant).order("id").range(a, b)),
    getTenantSettingsByTenantId(tenant, { failOnReadError: true }),
  ]);
  const byClass = new Map(classes.map((c) => [c.id, c.subject]));
  const subjectsByStudent = new Map<string, Set<string>>();
  for (const enrollment of enrollments) {
    const subjects = subjectsByStudent.get(enrollment.student_id) ?? new Set<string>();
    const subject = byClass.get(enrollment.class_id);
    if (subject !== undefined) subjects.add(subject);
    subjectsByStudent.set(enrollment.student_id, subjects);
  }
  const rows = contributionRoster(students, new Set(subjectsByStudent.keys())).map((s) => ({
    id: s.id, name: s.name, school: s.school, grade: s.grade, status: s.status,
    subjects: [...subjectsByStudent.get(s.id) ?? []],
  }));
  return { gate, rows, classes, subjects: settings.operations.subjects.map((s) => ({ key: s.key, label: s.label })), grades: settings.operations.gradeLevels };
});
