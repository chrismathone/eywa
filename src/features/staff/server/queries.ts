import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SystemRole } from "@/lib/permissions";

export type StaffRow = {
  id: string;
  displayName: string;
  email: string;
  systemRole: SystemRole;
  status: string;
  classesCount: number;
  primaryStudentsCount: number;
};

export async function getStaffList(): Promise<StaffRow[]> {
  const supabase = await createClient();

  const { data: users } = await supabase
    .from("users")
    .select("id, display_name, email, system_role, status")
    .neq("status", "inactive")
    .order("system_role", { ascending: true })
    .order("display_name", { ascending: true });

  if (!users) return [];

  const { data: teaching } = await supabase
    .from("classes")
    .select("id, teacher_id")
    .eq("is_active", true);

  const { data: primaryS } = await supabase
    .from("students")
    .select("id, primary_teacher_id")
    .eq("status", "enrolled");

  const classCount = new Map<string, number>();
  for (const c of teaching ?? []) {
    if (!c.teacher_id) continue;
    classCount.set(c.teacher_id, (classCount.get(c.teacher_id) ?? 0) + 1);
  }
  const studentCount = new Map<string, number>();
  for (const s of primaryS ?? []) {
    if (!s.primary_teacher_id) continue;
    studentCount.set(s.primary_teacher_id, (studentCount.get(s.primary_teacher_id) ?? 0) + 1);
  }

  return users.map((u) => ({
    id: u.id,
    displayName: u.display_name,
    email: u.email,
    systemRole: u.system_role as SystemRole,
    status: u.status,
    classesCount: classCount.get(u.id) ?? 0,
    primaryStudentsCount: studentCount.get(u.id) ?? 0,
  }));
}

export type StaffDetail = {
  id: string;
  displayName: string;
  email: string;
  systemRole: SystemRole;
  status: "active" | "inactive" | "pending";
  hireDate: string | null;
  jobTitle: string | null;
  subjects: string[];
  defaultClassroom: string | null;
  memo: string | null;
  hourlyRate: number;
  monthlyBase: number;
};

export async function getStaffById(id: string): Promise<StaffDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select(
      "id, display_name, email, system_role, status, hire_date, job_title, subjects, default_classroom, memo, hourly_rate, monthly_base",
    )
    .eq("id", id)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    displayName: data.display_name,
    email: data.email,
    systemRole: data.system_role as SystemRole,
    status: data.status as "active" | "inactive" | "pending",
    hireDate: data.hire_date,
    jobTitle: data.job_title,
    subjects: Array.isArray(data.subjects) ? (data.subjects as string[]) : [],
    defaultClassroom: data.default_classroom,
    memo: data.memo,
    hourlyRate: Number(data.hourly_rate ?? 0),
    monthlyBase: Number(data.monthly_base ?? 0),
  };
}

// Alias for backward-compat (별칭 — payroll/leaves 페이지에서 사용)
export const getStaffDetail = getStaffById;
