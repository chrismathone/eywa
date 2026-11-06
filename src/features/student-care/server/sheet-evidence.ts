import "server-only";
import { cache } from "react";
import { z } from "zod";
import type { CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEcsClassAccess } from "@/features/class-sheets/server/access";
import { requireMcsClassAccess } from "@/features/math-sheets/server/access";
import { SENT_REPORT_OR } from "@/features/math-sheets/lib/sent-reports";
import { kstToday } from "@/lib/date-kst";
import { evidenceHref } from "../model";

type Kind = "english_sheet" | "math_sheet";
type SheetRow = { id: string; class_id: string | null; student_id: string; mark_date?: string; report_date?: string; progress_note?: string | null; score?: string | null; progress?: string | null };
const gate = cache(async (kind: Kind, classId: string) => kind === "english_sheet" ? requireEcsClassAccess(classId) : requireMcsClassAccess(classId));
function rows(user: CurrentUser, kind: Kind) {
  const admin = createAdminClient();
  return kind === "english_sheet"
    ? admin.from("class_sheet_student_marks").select("id,class_id,student_id,mark_date,progress_note,score").eq("tenant_id", user.tenantId).lte("mark_date", kstToday())
    : admin.from("lesson_reports").select("id,class_id,student_id,report_date,progress").eq("tenant_id", user.tenantId).or(SENT_REPORT_OR).is("revoked_at", null).lte("report_date", kstToday());
}
export function hasSheetProgress(row: SheetRow, kind: Kind) {
  return kind === "english_sheet" ? !!(row.progress_note?.trim() || row.score?.trim()) : !!row.progress?.trim();
}
async function visible(user: CurrentUser, row: SheetRow, kind: Kind) {
  if (!hasSheetProgress(row, kind) || !row.class_id) return false;
  const access = await gate(kind, row.class_id);
  return access.ok && access.access.tenantId === user.tenantId;
}
const dateOf = (row: SheetRow) => row.mark_date ?? row.report_date!;

/** 실제 수강 기간의 개별 기록만 사용한다. 반 전체 계획은 학생의 이행 증거가 아니다. */
async function enrolled(user: CurrentUser, row: SheetRow) {
  const date = dateOf(row);
  const result = await createAdminClient().from("enrollments").select("id").eq("tenant_id", user.tenantId)
    .eq("student_id", row.student_id).eq("class_id", row.class_id).lte("start_date", date)
    .or(`end_date.is.null,end_date.gte.${date}`).limit(1).maybeSingle();
  return !result.error && !!result.data;
}

export async function resolveSheetEvidence(user: CurrentUser, kind: Kind, id: string, studentId?: string) {
  z.string().uuid().parse(id);
  if (!(await canAccessTenant(user.systemRole, kind === "english_sheet" ? "ecs" : "mcs"))) return null;
  let query = rows(user, kind).eq("id", id);
  if (studentId) query = query.eq("student_id", studentId);
  const result = await query.maybeSingle();
  const row = result.data as SheetRow | null;
  if (result.error || !row || !(await visible(user, row, kind)) || !(await enrolled(user, row))) return null;
  return { row, href: kind === "english_sheet" ? `/ecs/${row.class_id}/month?month=${dateOf(row).slice(0, 7)}` : `/mcs/${row.class_id}/month?month=${dateOf(row).slice(0, 7)}&student=${row.student_id}` };
}

export async function sheetReferences(user: CurrentUser, studentId: string) {
  const permissions = await Promise.all([canAccessTenant(user.systemRole, "ecs"), canAccessTenant(user.systemRole, "mcs")]);
  const kinds = (["english_sheet", "math_sheet"] as const).filter((_, i) => permissions[i]);
  const results = await Promise.all(kinds.map(async (kind) => {
    const result = await rows(user, kind).eq("student_id", studentId).order(kind === "english_sheet" ? "mark_date" : "report_date", { ascending: false }).order("id").limit(50);
    return { kind, result };
  }));
  const all = results.flatMap(({ kind, result }) => (result.data ?? []).map((row) => ({ kind, row: row as SheetRow })));
  // 이관된 보고서는 반 연결이 없을 수 있다. null을 UUID IN 필터에 보내면 정상 기록까지 조회가 실패한다.
  const classIds = [...new Set(all.map(({ row }) => row.class_id).filter((id): id is string => !!id))];
  // 최대 100개 기록의 수강 기간을 한 번에 가져온다. 권한 게이트는 반별 요청 내 캐시.
  const spans = classIds.length ? await createAdminClient().from("enrollments").select("class_id,start_date,end_date")
    .eq("tenant_id", user.tenantId).eq("student_id", studentId).in("class_id", classIds).limit(1001) : null;
  const warning = results.some(({ result }) => result.error) || !!spans?.error || (spans?.data?.length ?? 0) > 1000;
  const evidence = warning ? [] : (await Promise.all(all.map(async ({ kind, row }) => {
    const date = dateOf(row);
    if (!spans?.data?.some((s) => s.class_id === row.class_id && s.start_date && s.start_date <= date && (!s.end_date || s.end_date >= date)) || !(await visible(user, row, kind))) return null;
    const detail = kind === "english_sheet" ? [row.progress_note, row.score].filter(Boolean).join(" · ") : row.progress;
    return { kind, id: row.id, label: `${date} ${kind === "english_sheet" ? "영어 개별 진도" : "수학 시트 진도"} · ${String(detail).slice(0, 70)}`, href: evidenceHref(kind, row.id) };
  }))).filter((item) => item !== null);
  return { evidence, warning };
}
