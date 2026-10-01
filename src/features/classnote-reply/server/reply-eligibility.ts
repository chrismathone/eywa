import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import {
  candidatePeople,
  classReplyTeachers,
  studentReplyTeachers,
  type ClassRow,
  type DelegationRow,
  type EnrollmentRow,
  type SlotRow,
  type UserRow,
} from "../reply-eligibility-rule";

/**
 * 답글 권한(0317a) 조회 어댑터 — 판정은 [`reply-eligibility-rule.ts`](../reply-eligibility-rule.ts) → 워커 알림 수신자 순수 함수(한 벌).
 * 🔴 admin(service_role)이라 RLS를 우회한다 — **모든 조회에 tenant_id 필터**([[#104]]).
 * 규모: 학생 한 명의 수강·그 반들의 시간표·위임·그 사람들 계정뿐(창을 열 때·보낼 때 한 번).
 */
type Admin = ReturnType<typeof createAdminClient>;

async function loadFacts(admin: Admin, tenantId: string, classIds: string[], today: string) {
  const [classes, slots, dl] = await Promise.all([
    fetchInChunks<ClassRow>(classIds, (chunk) => admin.from("classes").select("id, subject, is_active, teacher_id").eq("tenant_id", tenantId).in("id", chunk)),
    // 🔴 이력 표라 청크 안에서도 1000행을 넘을 수 있다 — 청크 × 페이징(B2).
    fetchAllPagedInChunks<SlotRow>(classIds, (chunk, from, to) =>
      admin
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, teacher_id, slot_teacher_label, valid_from, valid_to")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .order("id")
        .range(from, to),
    ),
    classIds.length
      ? admin
          .from("class_delegations")
          .select("class_id, delegate_user_id, from_date, to_date, revoked_at")
          .eq("tenant_id", tenantId)
          .in("class_id", classIds)
          .is("revoked_at", null)
          .lte("from_date", today)
          .gte("to_date", today)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (dl.error) throw dl.error;
  const delegations = (dl.data ?? []) as DelegationRow[];
  const people = candidatePeople(classes, slots, delegations);
  const users = await fetchInChunks<UserRow>(people, (chunk) =>
    admin.from("users").select("id, tenant_id, status, system_role").eq("tenant_id", tenantId).in("id", chunk),
  );
  return { classes, slots, delegations, users };
}

/** 그 학생의 학부모 글 벨을 받는 사람(= 답글 자격, 관리자급 제외). */
export async function currentTeachersOfStudent(admin: Admin, a: { tenantId: string; studentId: string; subjectKeys: string[]; today: string }): Promise<string[]> {
  const { data, error } = await admin
    .from("enrollments")
    .select("class_id, start_date, end_date, is_transferred")
    .eq("tenant_id", a.tenantId)
    .eq("student_id", a.studentId);
  if (error) throw error;
  const enrollments = (data ?? []) as EnrollmentRow[];
  const classIds = [...new Set(enrollments.map((e) => e.class_id))];
  if (!classIds.length) return [];
  const f = await loadFacts(admin, a.tenantId, classIds, a.today);
  return studentReplyTeachers({ studentId: a.studentId, enrollments, ...f, keys: a.subjectKeys, tenant: a.tenantId, today: a.today });
}

/** 학생을 정하지 못한 반 보드 글 — 그 반을 지금 맡은 사람. */
export async function currentTeachersOfClass(admin: Admin, a: { tenantId: string; classId: string; subjectKeys: string[]; today: string }): Promise<string[]> {
  const f = await loadFacts(admin, a.tenantId, [a.classId], a.today);
  return classReplyTeachers({ classId: a.classId, ...f, keys: a.subjectKeys, tenant: a.tenantId, today: a.today });
}
