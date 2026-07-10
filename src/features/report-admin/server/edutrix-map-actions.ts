"use server";

// Edutrix 학생 UUID ↔ eywa students 수동 연결 + 해당 학생 보고서 즉시 이관.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { revalidatePath } from "next/cache";

function extractTeacher(className: string | null): string | null {
  if (!className) return null;
  const first = className.split(/[\s_]+/)[0] || "";
  const ex: Record<string, string> = { 김정은: "김은정" };
  return ex[first] || first || null;
}

type NameRef = { name: string } | { name: string }[] | null;
const one = (v: NameRef): { name: string } | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * eywa 학생에 Edutrix UUID 연결. 이미 쓰인 UUID/이미 매핑된 eywa는 거부.
 * 연결 후 해당 Edutrix 학생의 최근 보고서(최대 12건)를 edutrix_import로 이관(멱등: edutrix_report_id).
 */
export async function linkEdutrixStudent(
  eywaStudentId: string,
  edutrixStudentId: string,
): Promise<{ ok: boolean; error?: string; pulled?: number }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) {
    return { ok: false, error: "보고서 관리 권한이 없습니다" };
  }
  if (!eywaStudentId || !edutrixStudentId) return { ok: false, error: "대상이 없습니다" };

  const supabase = await createClient();

  const { data: eywa, error: eywaErr } = await supabase
    .from("students")
    .select("id, edutrix_student_id")
    .eq("id", eywaStudentId)
    .maybeSingle();
  if (eywaErr) return { ok: false, error: eywaErr.message };
  if (!eywa) return { ok: false, error: "eywa 학생을 찾을 수 없습니다" };
  if (eywa.edutrix_student_id && eywa.edutrix_student_id !== edutrixStudentId) {
    return { ok: false, error: "이미 다른 Edutrix 학생에 연결된 학생입니다" };
  }

  const { data: clash } = await supabase
    .from("students")
    .select("id")
    .eq("edutrix_student_id", edutrixStudentId)
    .neq("id", eywaStudentId)
    .maybeSingle();
  if (clash) return { ok: false, error: "이 Edutrix UUID는 이미 다른 학생에 연결되어 있습니다" };

  const { error: upErr } = await supabase
    .from("students")
    .update({ edutrix_student_id: edutrixStudentId })
    .eq("id", eywaStudentId);
  if (upErr) return { ok: false, error: upErr.message };

  // 보고서 즉시 이관
  const pulled = await pullReportsForEdutrixStudent(eywaStudentId, edutrixStudentId);
  revalidatePath("/lesson-reports");
  return { ok: true, pulled };
}

/** 연결 해제 — 이관 행은 유지(수동 정리). */
export async function unlinkEdutrixStudent(
  eywaStudentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) {
    return { ok: false, error: "보고서 관리 권한이 없습니다" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update({ edutrix_student_id: null })
    .eq("id", eywaStudentId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/lesson-reports");
  return { ok: true };
}

async function pullReportsForEdutrixStudent(
  eywaStudentId: string,
  edutrixStudentId: string,
): Promise<number> {
  const eduUrl = process.env.EDUTRIX_SUPABASE_URL;
  const eduKey = process.env.EDUTRIX_SUPABASE_ANON_KEY;
  if (!eduUrl || !eduKey) return 0;

  const edu = createSupabaseClient(eduUrl, eduKey);
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return 0;

  // 리치 필드 포함 — cron(edutrix-sync contentOf)·full-import와 동형(2026-07-10 리뷰: 이 경로만 얇게
  // 넣으면 cron 수정 전파 윈도(7일) 밖 행이 영구 얇은 상태로 남음).
  const { data: reps } = await edu
    .from("reports")
    .select(
      "id, date, progress, exam_info, assignment_score, textbook_name, study_attitude, notice, homework_today, makeup_class, classnote_sent_at, classes(name)",
    )
    .eq("student_id", edutrixStudentId)
    .order("date", { ascending: false })
    .limit(12);

  if (!reps?.length) return 0;

  const existing = await fetchAllPaged<{ edutrix_report_id: string }>((from, to) =>
    supabase
      .from("lesson_reports")
      .select("edutrix_report_id")
      .eq("student_id", eywaStudentId)
      .eq("source", "edutrix_import")
      .not("edutrix_report_id", "is", null)
      .range(from, to),
  );
  const seen = new Set(existing.map((r) => r.edutrix_report_id));

  const rows: Record<string, unknown>[] = [];
  for (const rep of reps) {
    if (!rep.id || seen.has(rep.id)) continue;
    const c = rep.classes as NameRef;
    rows.push({
      tenant_id: user.tenantId,
      student_id: eywaStudentId,
      report_date: rep.date,
      progress: rep.progress || null,
      exam_info: rep.exam_info || null,
      homework_score: rep.assignment_score || null,
      teacher_name: extractTeacher(one(c)?.name ?? null),
      textbook: rep.textbook_name || null,
      attitude: rep.study_attitude || null,
      notes: rep.notice || null,
      homework_today: rep.homework_today || null,
      makeup: !!rep.makeup_class,
      classnote_sent_at: rep.classnote_sent_at || null,
      classnote_status: rep.classnote_sent_at ? "success" : null,
      source: "edutrix_import",
      edutrix_report_id: rep.id,
    });
  }
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("lesson_reports").insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}
