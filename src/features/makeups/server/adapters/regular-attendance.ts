import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "@/features/attendance/effective-records";
import { fetchAllPaged } from "@/lib/supabase/batch";
import type { createClient } from "@/lib/supabase/server";

const COUNTABLE = new Set(["present", "late", "early_leave", "makeup"]);
const COLUMNS = "id, student_id, class_id, session_date, slot_start, recorded_at, status, taught_by";

export type RegularAttendanceRow = EffectiveAttendanceRecord & {
  status: string;
  taught_by: string | null;
};

export type RegularTeacher =
  | { status: "none" }
  | { status: "regular"; teacherId: string | null }
  | { status: "unknown" }
  | { status: "conflict" };

type Db = Pick<Awaited<ReturnType<typeof createClient>>, "from">;

function taught(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function teacherIdOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("teacher_id" in data)) return null;
  return taught(data.teacher_id);
}

function agree(rows: readonly RegularAttendanceRow[], classTeacherId: string | null): RegularTeacher {
  const teachers = rows.map((row) => taught(row.taught_by) ?? classTeacherId);
  if (teachers.some((teacher) => teacher !== teachers[0])) return { status: "conflict" };
  return { status: "regular", teacherId: teachers[0] ?? null };
}

async function classTeacherId(db: Db, tenantId: string, classId: string): Promise<string | null> {
  const cls = await db.from("classes").select("teacher_id").eq("tenant_id", tenantId).eq("id", classId).maybeSingle();
  if (cls.error) throw new Error(cls.error.message);
  return teacherIdOf(cls.data);
}

/**
 * 학생·반·날짜의 정규 담당. 교시별 최신 정정만 보고, 그 교시들의 담당이 갈리면 하나를 고르지 않는다.
 * 조회 실패는 정규 수업이 없다는 뜻이 아니다.
 */
export async function loadRegularAttendanceTeacher(
  db: Db,
  tenantId: string,
  studentId: string,
  classId: string,
  date: string,
): Promise<RegularTeacher> {
  const tenant = tenantId.trim();
  const student = studentId.trim();
  const klass = classId.trim();
  const day = date.trim();
  if (!tenant || !student || !klass || !day) return { status: "unknown" };
  try {
    const rows = await fetchAllPaged<RegularAttendanceRow>((from, to) =>
      db.from("attendance_records")
        .select(COLUMNS)
        .eq("tenant_id", tenant)
        .eq("student_id", student)
        .eq("class_id", klass)
        .eq("session_date", day)
        .order("id")
        .range(from, to),
    );
    const countable = effectiveAttendanceRecords(rows).filter((row) => COUNTABLE.has(String(row.status)));
    if (countable.length === 0) return { status: "none" };
    const fallback = countable.some((row) => !taught(row.taught_by))
      ? await classTeacherId(db, tenant, klass)
      : null;
    return agree(countable, fallback);
  } catch {
    return { status: "unknown" };
  }
}
