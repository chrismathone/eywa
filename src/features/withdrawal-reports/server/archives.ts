import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportViewer } from "./queries";
import type { ArchiveDetail, ArchiveRow, ArchiveStudent } from "../archive-model";

export async function listArchives() {
  const viewer = await reportViewer();
  if (!viewer?.request) return [] as ArchiveRow[];
  const rows: ArchiveRow[] = [];
  for (let offset = 0; ; offset += 400) {
    let q = createAdminClient().from("withdrawal_report_archives").select("id,spreadsheet_id,sheet_id,sheet_title,source_range,student_name,school_grade,class_name,subject,exit_date,raw_exit_date,teacher_name,mapped_student_id,mapping_kind,revision,reason_raw:fields->>퇴원사유,detail_raw:fields->>상세사유").eq("tenant_id", viewer.user.tenantId);
    if (viewer.scope) q = q.or(`subject.is.null,subject.in.(${viewer.scope.join(",")})`);
    const { data, error } = await q.order("exit_date", { ascending: false, nullsFirst: false }).order("id").range(offset, offset + 399);
    if (error) throw new Error("기존 퇴원보고서를 불러오지 못했습니다.");
    // supabase 타입 해석기가 한글 JSON 키(`fields->>퇴원사유`)를 못 읽어 unknown을 거친다(실제 조회는 된다).
    rows.push(...((data ?? []) as unknown as ArchiveRow[]));
    if (!data || data.length < 400) break;
  }
  return rows;
}
export async function getArchive(id: string) {
  const viewer = await reportViewer();
  if (!viewer?.request) return null;
  const { data, error } = await createAdminClient().from("withdrawal_report_archives").select("*").eq("tenant_id", viewer.user.tenantId).eq("id", id).maybeSingle();
  if (error || !data || (viewer.scope && data.subject && !viewer.scope.includes(data.subject))) return null;
  return data as ArchiveDetail;
}
export async function archiveStudents() {
  const viewer = await reportViewer();
  if (!viewer?.request) return [] as ArchiveStudent[];
  const rows: ArchiveStudent[] = [];
  for (let offset = 0; ; offset += 400) {
    const { data, error } = await createAdminClient().from("students").select("id,name,school,grade,status").eq("tenant_id", viewer.user.tenantId).order("name").order("id").range(offset, offset + 399);
    if (error) throw new Error("기록을 연결할 학생을 불러오지 못했습니다.");
    rows.push(...(data ?? []) as ArchiveStudent[]);
    if (!data || data.length < 400) break;
  }
  return rows;
}
