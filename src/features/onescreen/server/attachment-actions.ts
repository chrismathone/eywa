"use server";

import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import {
  createUploadTicket,
  MEDIA_KIND,
  removeObject,
  resolveTenantReadUrls,
  verifyUploadedObject,
} from "@/lib/storage/media-storage";
import { isTenantReportAttachmentPath } from "@/lib/storage/legacy-audio-path";
import type { UploadTicket } from "@/lib/storage/types";
import { teacherOwnsStudent } from "./scope";

// 수업 보고서 학생 사진 첨부(P2b) — documents 2단계 티켓 업로드 패턴(issue→클라 uploadToTicket→register).
// ⚠️ 첨부는 **저장된 보고서 행에만**(유령 row 금지). 변경 시 ClassNote 상태 리셋(옛 스샷 死링크 방지).

const MAX_ATTACHMENTS = 6;
const KIND = "report_attachment" as const;
const BUCKET = MEDIA_KIND[KIND].supabaseBucket; // removeObject Supabase 분기용(bucket 없으면 no-op)

// 첨부 변경 시 ClassNote 상태 리셋 — 이미 발송된 보고서에 사진을 더/빼면 옛 스샷과 불일치 → 미발송으로 되돌려 재발송 유도.
const CLASSNOTE_RESET = {
  classnote_status: null,
  classnote_error: null,
  classnote_queued_at: null,
  classnote_processing_at: null,
  classnote_sent_at: null,
  classnote_retry_count: 0,
} as const;

type Attachment = { path: string; name: string; size: number };
type ReportRow = { id: string; attachments: Attachment[] | null };

/** (tenant,student,today,subject) 저장된 보고서 행. 없으면 null — 첨부는 저장된 행에만 붙는다. */
async function findReportRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  subject: string | undefined,
): Promise<ReportRow | null> {
  const base = supabase
    .from("lesson_reports")
    .select("id, attachments")
    .eq("student_id", studentId)
    .eq("report_date", kstToday());
  const { data } = await (subject ? base.eq("subject", subject) : base.is("subject", null)).maybeSingle();
  return (data as ReportRow | null) ?? null;
}

/** 공용 게이트 — 로그인 + 담당 학생(teacherOwnsStudent). authed client(RLS tenant 격리) 재사용. */
async function gate(studentId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!studentId) return { error: "학생 정보가 없습니다" as const };
  const supabase = await createClient();
  if (!(await teacherOwnsStudent(supabase, user.id, studentId)))
    return { error: "담당 학생이 아닙니다" as const };
  return { user, supabase };
}

export type IssueAttachmentTicketInput = {
  studentId: string;
  subject?: string;
  contentType: string;
  size: number;
  ext: string;
};

/** ① 업로드 티켓 발급 — 사진 CT/size 검증 + **저장된 보고서 행 확인**(issue만 하고 register 안 하는 orphan 방지). */
export async function issueReportAttachmentUploadTicket(
  input: IssueAttachmentTicketInput,
): Promise<{ ticket?: UploadTicket; error?: string }> {
  const g = await gate(input.studentId);
  if ("error" in g) return { error: g.error };
  if (!MEDIA_KIND[KIND].allowCT(input.contentType))
    return { error: "사진(jpeg/png/webp)만 첨부할 수 있습니다" };
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MEDIA_KIND[KIND].maxBytes)
    return { error: "파일이 너무 큽니다 (최대 10MB)" };
  const row = await findReportRow(g.supabase, input.studentId, input.subject);
  if (!row) return { error: "먼저 보고서를 저장하세요" };
  if ((row.attachments ?? []).length >= MAX_ATTACHMENTS)
    return { error: `사진은 최대 ${MAX_ATTACHMENTS}장까지 첨부할 수 있습니다` };
  const ext = input.ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${g.user.tenantId}/report-attachments/${randomUUID()}.${ext}`;
  if (!isTenantReportAttachmentPath(path, g.user.tenantId)) return { error: "경로 생성 실패" };
  try {
    return { ticket: await createUploadTicket({ kind: KIND, path, contentType: input.contentType }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "업로드 티켓 발급 실패" };
  }
}

export type RegisterAttachmentInput = {
  studentId: string;
  subject?: string;
  path: string;
  name: string;
  size: number;
};

/** ② 업로드 완료 등록 — verify → 기존 행 attachments append(캡/실패 시 cleanup) → classnote 리셋. */
export async function registerReportAttachment(
  input: RegisterAttachmentInput,
): Promise<{ ok: boolean; attachments?: Attachment[]; error?: string }> {
  const g = await gate(input.studentId);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isTenantReportAttachmentPath(input.path, g.user.tenantId))
    return { ok: false, error: "잘못된 파일 경로입니다" };

  const row = await findReportRow(g.supabase, input.studentId, input.subject);
  if (!row) {
    await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
    return { ok: false, error: "먼저 보고서를 저장하세요" };
  }
  const current = row.attachments ?? [];
  if (current.length >= MAX_ATTACHMENTS) {
    await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
    return { ok: false, error: `사진은 최대 ${MAX_ATTACHMENTS}장까지 첨부할 수 있습니다` };
  }
  let verified: { size: number; contentType: string };
  try {
    verified = await verifyUploadedObject(KIND, input.path);
  } catch (e) {
    await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
    return { ok: false, error: e instanceof Error ? e.message : "업로드 검증 실패" };
  }
  const next: Attachment[] = [
    ...current,
    { path: input.path, name: input.name || "photo", size: verified.size || input.size || 0 },
  ];
  const { error } = await g.supabase
    .from("lesson_reports")
    .update({ attachments: next, ...CLASSNOTE_RESET })
    .eq("id", row.id);
  if (error) {
    await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
    return { ok: false, error: `등록 실패: ${error.message}` };
  }
  return { ok: true, attachments: next };
}

export type RemoveAttachmentInput = { studentId: string; subject?: string; path: string };

/** 첨부 삭제 — 행 attachments에서 path 제거 + storage 정리 + classnote 리셋. */
export async function removeReportAttachment(
  input: RemoveAttachmentInput,
): Promise<{ ok: boolean; attachments?: Attachment[]; error?: string }> {
  const g = await gate(input.studentId);
  if ("error" in g) return { ok: false, error: g.error };
  const row = await findReportRow(g.supabase, input.studentId, input.subject);
  if (!row) return { ok: false, error: "보고서를 찾을 수 없습니다" };
  const current = row.attachments ?? [];
  const next = current.filter((a) => a.path !== input.path);
  if (next.length === current.length) return { ok: true, attachments: current }; // 이미 없음(멱등)
  const { error } = await g.supabase
    .from("lesson_reports")
    .update({ attachments: next, ...CLASSNOTE_RESET })
    .eq("id", row.id);
  if (error) return { ok: false, error: `삭제 실패: ${error.message}` };
  await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
  return { ok: true, attachments: next };
}

/** 강사 카드 썸네일용 signed URL — **그 보고서에 실제 포함된 path만** 서명(학생 스코프 + 소속 path). */
export async function signReportAttachmentUrls(input: {
  studentId: string;
  subject?: string;
}): Promise<{ urls?: Record<string, string>; error?: string }> {
  const g = await gate(input.studentId);
  if ("error" in g) return { error: g.error };
  const row = await findReportRow(g.supabase, input.studentId, input.subject);
  const paths = (row?.attachments ?? []).map((a) => a.path);
  if (paths.length === 0) return { urls: {} };
  try {
    return { urls: await resolveTenantReadUrls(paths, KIND, g.user.tenantId) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "썸네일 URL 생성 실패" };
  }
}
