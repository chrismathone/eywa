"use server";

// 원장 보고서 관리 — ClassNote 발송 큐 관리 액션(재발송·멈춤복구). 쓰기는 owner 메뉴 권한(위임 반영).
// edutrix retrySelectedClassNoteReports/resetStuckClassNoteReports 이식. 과거일 재발송 사고 방지(isClassnoteAllowed).
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isClassnoteAllowed } from "@/features/onescreen/classnote-guard";
import { STUCK_MINUTES } from "../classnote-queue";

/**
 * 실패/오래됨 보고서 재발송 — queued로 되돌려 워커가 다시 잡게 한다. retry_count·error 초기화.
 * **과거일(전 달 1일 이전)은 재차단**(isClassnoteAllowed) — 옛 보고서 대량 오발송 방지(edutrix 사고 교훈).
 */
export async function retryClassnote(ids: string[]): Promise<{ ok: boolean; requeued?: number; skipped?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "owner"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  if (!ids?.length) return { ok: false, error: "대상이 없습니다" };
  const supabase = await createClient();

  // 대상 보고서 날짜 조회(과거일 차단 재확인). RLS 테넌트 스코프.
  const { data: rows } = await supabase.from("lesson_reports").select("id, report_date").in("id", ids.slice(0, 200));
  const allowed = (rows ?? []).filter((r) => isClassnoteAllowed(r.report_date as string)).map((r) => r.id as string);
  const skipped = (rows?.length ?? 0) - allowed.length;
  if (allowed.length === 0) return { ok: true, requeued: 0, skipped };

  const { error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: "queued",
      classnote_queued_at: new Date().toISOString(),
      classnote_processing_at: null,
      classnote_retry_count: 0,
      classnote_error: null,
    })
    .in("id", allowed);
  if (error) return { ok: false, error: error.message };
  return { ok: true, requeued: allowed.length, skipped };
}

/**
 * 멈춤복구 — processing인데 STUCK_MINUTES 넘게 안 끝난 것(워커 크래시·PC 꺼짐)을 queued로 되돌려 재처리.
 */
export async function resetStuckClassnote(): Promise<{ ok: boolean; reset?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "owner"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: "queued",
      classnote_queued_at: new Date().toISOString(),
      classnote_processing_at: null,
    })
    .eq("classnote_status", "processing")
    .lt("classnote_processing_at", cutoff)
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, reset: (data ?? []).length };
}

export type ReportListRow = {
  id: string;
  studentName: string;
  subject: string | null;
  reportDate: string;
  classnoteStatus: string | null;
  teacherName: string | null;
  shareToken: string | null;
  source: string | null; // edutrix_import=이관분(발송 아님) · onescreen=eywa 네이티브
};

// 상태 필터 특수값: 발송 이력 없는 이관분(edutrix_import). classnote_status가 아니라 source로 거른다.
export const IMPORT_FILTER = "__import__";

export type ReportListFilters = {
  from?: string;
  to?: string;
  status?: string;
  teacher?: string;
  subject?: string;
  page?: number;
};

const REPORT_PAGE_SIZE = 30;

/**
 * 보고서 목록 조회(원장 보고서 관리 Part C) — 강사·기간·상태·과목 필터 + 페이지네이션. 클라 필터 UI에서 호출(데이터 반환).
 * 읽기라 로그인만 확인(RLS 테넌트 스코프). 반 필터는 lesson_reports에 class_id가 없어 후속.
 */
export async function listReports(
  filters: ReportListFilters,
): Promise<{ ok: boolean; rows?: ReportListRow[]; total?: number; page?: number; pageSize?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const supabase = await createClient();
  const page = Math.max(0, filters.page ?? 0);

  let q = supabase
    .from("lesson_reports")
    .select("id, student_id, subject, report_date, classnote_status, teacher_name, share_token, source", { count: "exact" })
    .order("report_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (filters.from) q = q.gte("report_date", filters.from);
  if (filters.to) q = q.lte("report_date", filters.to);
  // "이관" 필터는 source, 그 외는 classnote_status.
  if (filters.status === IMPORT_FILTER) q = q.eq("source", "edutrix_import");
  else if (filters.status) q = q.eq("classnote_status", filters.status);
  if (filters.teacher) q = q.eq("teacher_name", filters.teacher);
  if (filters.subject) q = q.eq("subject", filters.subject);
  q = q.range(page * REPORT_PAGE_SIZE, page * REPORT_PAGE_SIZE + REPORT_PAGE_SIZE - 1);

  const { data, count, error } = await q;
  if (error) return { ok: false, error: error.message };
  const list = data ?? [];
  const ids = [...new Set(list.map((r) => r.student_id as string))];
  const nameRows = await fetchInChunks<{ id: string; name: string }>(ids, (chunk) =>
    supabase.from("students").select("id, name").in("id", chunk),
  );
  const nameById = new Map(nameRows.map((s) => [s.id, s.name]));
  const rows: ReportListRow[] = list.map((r) => ({
    id: r.id as string,
    studentName: nameById.get(r.student_id as string) ?? "(학생)",
    subject: r.subject as string | null,
    reportDate: r.report_date as string,
    classnoteStatus: r.classnote_status as string | null,
    teacherName: r.teacher_name as string | null,
    shareToken: r.share_token as string | null,
    source: r.source as string | null,
  }));
  return { ok: true, rows, total: count ?? rows.length, page, pageSize: REPORT_PAGE_SIZE };
}
