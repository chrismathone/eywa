"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

const STATUSES = ["present", "absent", "late", "excused", "makeup"] as const;
type Status = (typeof STATUSES)[number];

export type SaveAttendanceState = { error?: string; saved?: number } | undefined;

/**
 * Save attendance for a single class on a single date. Format:
 *   classId, date, then rows `status:{studentId}=<status>` for each student.
 *   Also accepts `note:{studentId}`, `homeworkRequired:{studentId}`, `homeworkDone:{studentId}`.
 * Empty status = leave alone (no record created).
 */
export async function saveAttendance(
  _prev: SaveAttendanceState,
  formData: FormData,
): Promise<SaveAttendanceState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const classId = String(formData.get("classId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  if (!classId || !date) return { error: "반과 날짜가 필요합니다" };

  type Row = {
    studentId: string;
    status: Status;
    existingId: string | null;
    note: string | null;
    homeworkRequired: boolean;
    homeworkDone: boolean;
  };
  const rows: Row[] = [];

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("status:")) continue;
    const studentId = key.slice("status:".length);
    const status = String(value);
    if (!status) continue;
    if (!STATUSES.includes(status as Status)) continue;
    const existingId =
      String(formData.get(`existing:${studentId}`) ?? "").trim() || null;
    const note =
      String(formData.get(`note:${studentId}`) ?? "").trim() || null;
    const homeworkRequired =
      String(formData.get(`homeworkRequired:${studentId}`) ?? "") === "true";
    const homeworkDone =
      String(formData.get(`homeworkDone:${studentId}`) ?? "") === "true";
    rows.push({
      studentId,
      status: status as Status,
      existingId,
      note,
      homeworkRequired,
      homeworkDone,
    });
  }

  if (rows.length === 0) return { error: "저장할 출결 데이터가 없습니다" };

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  // Split into updates (existing row) and inserts (new)
  const updates = rows.filter((r) => r.existingId);
  const inserts = rows.filter((r) => !r.existingId);

  let saved = 0;

  for (const r of updates) {
    const { error } = await supabase
      .from("attendance_records")
      .update({
        status: r.status,
        note: r.note,
        homework_required: r.homeworkRequired,
        homework_done: r.homeworkDone,
        recorded_by: user.id,
        recorded_at: nowIso,
      })
      .eq("id", r.existingId!);
    if (error) return { error: error.message };
    saved++;
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from("attendance_records").insert(
      inserts.map((r) => ({
        tenant_id: user.tenantId,
        class_id: classId,
        student_id: r.studentId,
        session_date: date,
        status: r.status,
        note: r.note,
        homework_required: r.homeworkRequired,
        homework_done: r.homeworkDone,
        recorded_by: user.id,
      })),
    );
    if (error) return { error: error.message };
    saved += inserts.length;
  }

  revalidatePath(`/attendance/${date}`);
  revalidatePath(`/attendance/${date}/${classId}`);
  redirect(`/attendance/${date}?saved=${saved}`);
}
