import "server-only";
import { createClient } from "@/lib/supabase/server";

export type StaffRow = {
  id: string;
  displayName: string;
  email: string;
  systemRole: string;
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

  // Classes per teacher
  const { data: teaching } = await supabase
    .from("classes")
    .select("id, teacher_id")
    .eq("is_active", true);

  // Primary students per teacher
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
    systemRole: u.system_role,
    status: u.status,
    classesCount: classCount.get(u.id) ?? 0,
    primaryStudentsCount: studentCount.get(u.id) ?? 0,
  }));
}
