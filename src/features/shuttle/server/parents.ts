import "server-only";

import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { parentAccountsActor } from "./parent-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { schoolGradeLabel } from "@/lib/format/school-grade";

export type ParentStudent = {
  id: string;
  name: string;
  schoolGrade: string;
  parentName: string | null;
  parentPhone: string | null;
  status: string;
  relationship: string;
};

export type ParentAccount = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  status: "active" | "inactive";
  students: ParentStudent[];
};

export type ParentStudentOption = {
  id: string;
  label: string;
  parentName: string | null;
  parentPhone: string | null;
};

type StudentRow = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  status: string;
};

export async function getParentAccounts(): Promise<ParentAccount[]> {
  // 원장·관리자만 — 화면 게이트와 같은 판정. DB 정책(0313a)도 같은 역할로 막는다.
  if (!(await parentAccountsActor())) return [];
  const supabase = await createClient();
  const { data: accounts, error } = await supabase
    .from("parent_accounts")
    .select("id, display_name, login_email, phone, status")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  if (!accounts?.length) return [];

  const accountIds = accounts.map((account) => account.id);
  const { data: links, error: linksError } = await supabase
    .from("parent_account_students")
    .select("parent_account_id, student_id, relationship")
    .in("parent_account_id", accountIds)
    .limit(2000);
  if (linksError) throw linksError;

  const studentIds = [...new Set((links ?? []).map((link) => link.student_id))];
  const students = await fetchInChunks<StudentRow>(studentIds, (chunk) =>
    supabase
      .from("students")
      .select("id, name, school, grade, parent_name, parent_phone, status")
      .in("id", chunk),
  );
  const studentById = new Map(students.map((student) => [student.id, student]));
  const linksByAccount = new Map<string, typeof links>();
  for (const link of links ?? []) {
    const list = linksByAccount.get(link.parent_account_id) ?? [];
    list.push(link);
    linksByAccount.set(link.parent_account_id, list);
  }

  return accounts.map((account) => ({
    id: account.id,
    displayName: account.display_name,
    email: account.login_email,
    phone: account.phone,
    status: account.status as ParentAccount["status"],
    students: (linksByAccount.get(account.id) ?? []).flatMap((link) => {
      const student = studentById.get(link.student_id);
      return student
        ? [{
            id: student.id,
            name: student.name,
            schoolGrade: schoolGradeLabel(student.school, student.grade),
            parentName: student.parent_name,
            parentPhone: student.parent_phone,
            status: student.status,
            relationship: link.relationship,
          }]
        : [];
    }),
  }));
}

export async function getParentStudentOptions(): Promise<ParentStudentOption[]> {
  if (!(await parentAccountsActor())) return [];
  const supabase = await createClient();
  const rows = await fetchAllPaged<StudentRow>((from, to) =>
    supabase
      .from("students")
      .select("id, name, school, grade, parent_name, parent_phone, status")
      .eq("status", "enrolled")
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows.map((student) => ({
    id: student.id,
    label: `${student.name} · ${schoolGradeLabel(student.school, student.grade)}`,
    parentName: student.parent_name,
    parentPhone: student.parent_phone,
  }));
}
/**
 * 학부모 계정이 연결된 원생 id — 학부모 등하원(관리자 뷰)의 "학부모 계정 연결됨" 표시용.
 *
 * 🔑 **있다/없다만** 돌려준다. 이 면은 셔틀을 보는 모든 직원이 여는 자리인데, 학부모 계정의 이메일·
 *    연락처는 원장·관리자 전용이다(parent-access.ts). 그래서 service_role로 읽되 id 집합만 내보낸다.
 *    admin은 RLS를 우회하므로 `tenant_id` 필터가 곧 지점 격리다.
 */
export async function getParentLinkedStudentIds(tenantId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const rows = await fetchAllPaged<{ student_id: string }>((from, to) =>
    admin
      .from("parent_account_students")
      .select("student_id")
      .eq("tenant_id", tenantId)
      .order("student_id")
      .range(from, to),
  );
  return new Set(rows.map((r) => r.student_id));
}
