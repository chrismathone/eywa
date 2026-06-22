"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

const STATUSES = ["present", "absent", "late", "excused", "makeup", "early_leave"] as const;
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

export type CellResult = { ok: true } | { error: string };

/**
 * 매트릭스 인라인 셀 1건 출결 토글 — 페이지 이동 없이 빠르게 찍는다(반응속도 1순위).
 * status=null 이면 해당 셀 기록 삭제(지우기). 기존 record가 있으면 update, 없으면 insert.
 * 상세 입력폼(메모·숙제)은 별도 유지 — 여기선 상태만 다룬다.
 */
export async function setAttendanceCell(input: {
  studentId: string;
  classId: string;
  sessionDate: string;
  status: Status | null;
  note?: string | null; // 전달 시 메모도 갱신(undefined면 기존 메모 유지)
}): Promise<CellResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const { studentId, classId, sessionDate, status } = input;
  const noteProvided = input.note !== undefined;
  const noteVal = (input.note ?? "").trim() || null;
  if (!studentId || !classId || !sessionDate) return { error: "필수 값이 누락되었습니다" };
  if (status !== null && !STATUSES.includes(status)) return { error: "잘못된 상태입니다" };

  const supabase = await createClient();

  // 지우기 — 해당 (반·학생·날짜) 기록 전부 삭제.
  if (status === null) {
    const { error } = await supabase
      .from("attendance_records")
      .delete()
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .eq("session_date", sessionDate);
    if (error) return { error: error.message };
    revalidatePath("/attendance");
    return { ok: true };
  }

  // 최신 기록 1건 조회 → 있으면 update, 없으면 insert (매트릭스는 최신본을 보여줌).
  const { data: existing } = await supabase
    .from("attendance_records")
    .select("id")
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .eq("session_date", sessionDate)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  if (existing?.id) {
    const patch: Record<string, unknown> = { status, recorded_by: user.id, recorded_at: nowIso };
    if (noteProvided) patch.note = noteVal;
    const { error } = await supabase.from("attendance_records").update(patch).eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("attendance_records").insert({
      tenant_id: user.tenantId,
      class_id: classId,
      student_id: studentId,
      session_date: sessionDate,
      status,
      note: noteProvided ? noteVal : null,
      recorded_by: user.id,
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/attendance");
  return { ok: true };
}
