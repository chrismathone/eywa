"use server";

import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
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
import { logAction } from "@/features/audit/server/log";
import { teacherOwnsStudent } from "./scope";
import { hasVideoAttachment, isReportVideoCT, isVideoAttachment, REPORT_FILE_MAX_BYTES, REPORT_VIDEO_MAX_BYTES, videoExtOf, withVideoExt } from "../report-video";
import { reportVideoWorkerGate } from "./report-video-gate";
import { explainDbError } from "@/lib/supabase/db-error";

// 수업 보고서 학생 사진 첨부(P2b) — documents 2단계 티켓 업로드 패턴(issue→클라 uploadToTicket→register).
// ⚠️ 첨부는 **저장된 보고서 행에만**(유령 row 금지). 변경 시 ClassNote 상태 리셋(옛 스샷 死링크 방지).

const MAX_ATTACHMENTS = 6;
const KIND = "report_attachment" as const;
const VIDEO_ONE_ERROR = "영상은 보고서 한 장에 하나만 넣을 수 있습니다 — 넣은 영상을 지운 뒤 다시 넣어 주세요";
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
type ReportRow = { id: string; attachments: Attachment[] | null; classnote_status?: string | null };

/**
 * 발송 완료된 보고서는 첨부도 못 바꾼다(2026-07-22 원장 지시 "발송된 보고서 수정 금지").
 * 🔴 여기가 특히 중요한 이유: 첨부 변경은 CLASSNOTE_RESET으로 발송 상태를 지워 **재발송을 여는 뒷문**이다.
 *    이걸 안 막으면 "사진 한 장 추가"가 수정 금지와 재발송 차단을 동시에 우회한다.
 */
const SENT_LOCK_ERROR =
  "이미 학부모에게 발송된 보고서라 첨부를 바꿀 수 없습니다 — 고쳐야 하면 공유 링크를 재발급하세요";
const isSentLocked = (row: ReportRow | null) => row?.classnote_status === "success";
/**
 * 리셋을 쓰는 순간의 조건 — **이미 보낸 글(success)** 과 **회수가 진행 중이거나 실패한 글**의 상태는 지우지 않는다.
 *  · 위 `isSentLocked`는 읽은 시점의 판정이다. 읽고 쓰는 사이에 워커가 글을 올리면(success) 리셋이 그 사실을 지워
 *    "발송된 보고서 수정 금지"가 경합에서 뚫린다 — 쓰는 순간에 다시 본다.
 *  · 회수 요청·회수 중인 행을 리셋하면 회수 워커가 그 행을 못 집어(`recall_requested`만 집는다) 옛 글이 알림장에 남는다 —
 *    그 뒤 다시 보내면 옛 글 옆에 새 글이 붙는다. 보강 앵커 쪽 조건(makeup-anchor-sync.ts)과 같은 취지.
 * ⚠️ `processing`은 막지 않는다(종전 그대로): 처리 중에 첨부를 바꾸면 상태가 지워지고, 워커는 게시 직전에 상태를 다시 보고
 *    그 발송을 접는다 — 강사가 "사진을 빠뜨렸다"를 알아챘을 때 발송을 취소하고 사진을 넣어 다시 보내는 길이다.
 */
const RESET_OK = "classnote_status.is.null,classnote_status.not.in.(success,recall_requested,recalling,recall_failed)";
const RECALL_LOCK_ERROR = "회수하는 중인 보고서라 첨부를 바꿀 수 없습니다 — 회수가 끝난 뒤 다시 해 주세요";
// 회수 실패 = 옛 글이 알림장에 그대로 있다. 여기서 상태를 지우면 회수를 다시 시도할 길이 사라진다.
const RECALL_FAILED_LOCK_ERROR = "회수하지 못한 보고서라 첨부를 바꿀 수 없습니다 — 먼저 회수를 다시 시도해 주세요";
const RESET_RETRY_ERROR = "보고서 상태가 바뀌어 첨부를 반영하지 못했습니다 — 잠시 뒤 다시 시도해 주세요";
/** 리셋이 0행이었을 때의 안내 — 지금 상태를 다시 읽어 사유를 가른다. 모르는 상태를 '발송 완료'라고 지어내지 않는다. */
async function resetBlockedError(supabase: Awaited<ReturnType<typeof createClient>>, reportId: string): Promise<string> {
  const { data } = await supabase.from("lesson_reports").select("classnote_status").eq("id", reportId).maybeSingle();
  const status = (data?.classnote_status as string | null) ?? null;
  if (status === "success") return SENT_LOCK_ERROR;
  if (status === "recall_requested" || status === "recalling") return RECALL_LOCK_ERROR;
  if (status === "recall_failed") return RECALL_FAILED_LOCK_ERROR;
  return RESET_RETRY_ERROR;
}

/**
 * 저장된 보고서 행 — 첨부는 저장된 행에만 붙는다. date 기본=오늘(admin 직접작성은 작성일 전달).
 *
 * 🔴 단위 = **반**(0134a). 같은 (학생,날짜,과목)에 반이 다른 2행이 정상적으로 존재할 수 있으므로
 *    `maybeSingle()`을 쓰면 정규+특강을 듣는 학생의 첨부가 통째로 에러가 된다.
 *    반이 없으면(보강·관리자 작성) 예전대로 과목으로 찾되 **반 없는 행**만 본다 —
 *    반 없는 요청이 특강 행에 사진을 붙이면 엉뚱한 보고서에 사진이 들어간다.
 */
async function findReportRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  subject: string | undefined,
  reportDate?: string,
  classId?: string | null,
): Promise<ReportRow | null> {
  const base = supabase
    .from("lesson_reports")
    .select("id, attachments, class_id, classnote_status")
    .eq("student_id", studentId)
    .eq("report_date", reportDate || kstToday());
  if (classId) {
    const { data } = await base.eq("class_id", classId).limit(1);
    return ((data as ReportRow[] | null)?.[0]) ?? null;
  }
  if (!subject) {
    const { data } = await base.is("class_id", null).is("subject", null).limit(1);
    return ((data as ReportRow[] | null)?.[0]) ?? null;
  }
  // 반을 모르는 호출(관리자 직접작성 화면 — 반 선택 UI가 없다). 그 과목 행을 보되:
  //  · 반 없는 행이 있으면 그것(관리자가 방금 저장한 행 = 예전과 동일 동작)
  //  · 없고 반 있는 행이 **하나뿐**이면 그것(관리자 저장 시 서버가 반을 확정한 경우)
  //  · 반 있는 행이 둘 이상이면 **null** — 어느 수업의 사진인지 사람만 안다. 추측해서 엉뚱한 보고서에
  //    붙이느니 "먼저 보고서를 저장하세요"로 멈추는 편이 낫다(잘못 붙으면 학부모에게 그대로 나간다).
  const { data } = await base.eq("subject", subject).limit(5);
  const rows = (data as (ReportRow & { class_id?: string | null })[] | null) ?? [];
  const classless = rows.find((r) => !r.class_id);
  if (classless) return classless;
  return rows.length === 1 ? rows[0]! : null;
}

/**
 * 공용 게이트 — 로그인 + (담당 강사 OR 보고서 관리 권한). 한 레코드의 두 첨부 표면(강사 원스크린·admin 직접작성)이
 * 같은 게이트를 통과한다(#77): teacherOwnsStudent(활성 수강)나 canWriteTenant('lesson_reports') 중 하나면 허용.
 * ⚠️ admin 경로는 비수강 학생(예: 테스트 '학원이')에도 첨부 가능 — RLS가 tenant 격리, 행 존재 확인이 유효성 보강.
 */
async function gate(studentId: string, reportDate?: string) {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" as const };
  // '다른 강사 뷰'(열람 전용) 차단 — canWriteTenant는 캡으로 거절되지만, 겸직이 같은 반을 직접
  // 담당하는 경우 teacherOwnsStudent(본인 축)가 열려 열람 중 첨부가 뚫린다. 여기서 일괄 차단.
  const roError = await readonlyTeacherViewError();
  if (roError) return { error: roError };
  if (!studentId) return { error: "학생 정보가 없습니다" as const };
  const supabase = await createClient();
  // 🔴 담당 판정 기준일 = **그 보고서의 날짜**(오늘이 아니다). 임시 위임(0173a)은 기간이 있어서,
  //    오늘로 판정하면 어제 위임받아 쓴 보고서에 오늘 사진을 못 단다 — 본문 저장(saveLessonReport)은
  //    reportDate로 판정해 통과하는데 첨부만 거절되면 "저장은 되는데 사진만 안 붙는" 상태가 된다.
  const authorized =
    (await teacherOwnsStudent(supabase, user.id, studentId, reportDate)) ||
    (await canWriteTenant(user.systemRole, "lesson_reports"));
  if (!authorized) return { error: "권한이 없습니다" as const };
  return { user, supabase };
}

export type IssueAttachmentTicketInput = {
  studentId: string;
  subject?: string;
  /** 이 보고서의 반(0134a) — 같은 과목 두 행(정규+특강)을 가르는 키. 없으면 반 없는 행. */
  classId?: string | null;
  reportDate?: string; // 대상 보고서 날짜(생략=오늘) — admin 직접작성이 과거 날짜 첨부 시 전달
  contentType: string;
  size: number;
  ext: string;
};

/** ① 업로드 티켓 발급 — 사진 CT/size 검증 + **저장된 보고서 행 확인**(issue만 하고 register 안 하는 orphan 방지). */
export async function issueReportAttachmentUploadTicket(
  input: IssueAttachmentTicketInput,
): Promise<{ ticket?: UploadTicket; error?: string }> {
  const g = await gate(input.studentId, input.reportDate);
  if ("error" in g) return { error: g.error };
  if (!MEDIA_KIND[KIND].allowCT(input.contentType))
    return { error: "사진·문서(pdf·hwp·office·mp3 등)·영상(mp4·mov)만 첨부할 수 있습니다" };
  // 영상(2026-11-06) = 100MB · 한 장에 하나 · 영상을 올릴 수 있는 연동 PC일 때만. 그 밖의 첨부는 종전 20MB.
  const video = isReportVideoCT(input.contentType);
  const maxBytes = video ? REPORT_VIDEO_MAX_BYTES : REPORT_FILE_MAX_BYTES;
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > maxBytes)
    return { error: video ? "영상이 너무 큽니다 (최대 100MB)" : "파일이 너무 큽니다 (최대 20MB)" };
  const row = await findReportRow(g.supabase, input.studentId, input.subject, input.reportDate, input.classId);
  if (!row) return { error: "먼저 보고서를 저장하세요" };
  if (isSentLocked(row)) return { error: SENT_LOCK_ERROR };
  if ((row.attachments ?? []).length >= MAX_ATTACHMENTS)
    return { error: `사진은 최대 ${MAX_ATTACHMENTS}장까지 첨부할 수 있습니다` };
  if (video) {
    // 영상은 영어 보고서만(EiE 일일·월간 — 2026-11-06). 표 끌어 놓기 등 다른 길로 수학 보고서에 들어오지 않게 서버가 막는다.
    if (input.subject !== "english") return { error: "영상은 영어 보고서에만 넣을 수 있습니다" };
    if (hasVideoAttachment(row.attachments)) return { error: VIDEO_ONE_ERROR };
    const blocked = await reportVideoWorkerGate(g.supabase);
    if (blocked) return { error: blocked };
  }
  // 영상의 확장자는 형식에서(이름에 확장자가 없어도 경로가 영상으로 읽히게 — 발송 PC는 이름·경로로 영상을 가른다).
  const ext = (video ? videoExtOf(input.contentType) : null) ?? (input.ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg");
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
  /** 이 보고서의 반(0134a) — 같은 과목 두 행(정규+특강)을 가르는 키. 없으면 반 없는 행. */
  classId?: string | null;
  reportDate?: string; // 대상 보고서 날짜(생략=오늘)
  path: string;
  name: string;
  size: number;
};

/** ② 업로드 완료 등록 — verify → 기존 행 attachments append(캡/실패 시 cleanup) → classnote 리셋. */
export async function registerReportAttachment(
  input: RegisterAttachmentInput,
): Promise<{ ok: boolean; attachments?: Attachment[]; error?: string }> {
  const g = await gate(input.studentId, input.reportDate);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isTenantReportAttachmentPath(input.path, g.user.tenantId))
    return { ok: false, error: "잘못된 파일 경로입니다" };

  const row = await findReportRow(g.supabase, input.studentId, input.subject, input.reportDate, input.classId);
  if (!row) {
    await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
    return { ok: false, error: "먼저 보고서를 저장하세요" };
  }
  if (isSentLocked(row)) {
    await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
    return { ok: false, error: SENT_LOCK_ERROR };
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
  // 영상 판정은 **실제 올라온 객체 형식** 또는 이름으로(티켓의 주장만 믿지 않는다) — 영상은 한 장에 하나, 영상 아닌 첨부는 20MB.
  // 발송 PC는 **이름**으로 영상을 가른다 — 그래서 형식이 영상이거나 이름·경로가 영상 확장자면 모두 영상으로 보고,
  // 티켓 단계의 검사(영어만 · 연동 PC 지원)를 여기서 다시 한다(audio/mp4 티켓으로 'rec.mp4'를 올리는 길 — 재리뷰 2026-11-06).
  const isVideo =
    isReportVideoCT(verified.contentType) || isVideoAttachment(input.name || "") || isVideoAttachment(input.path);
  if (isVideo) {
    const blocked = input.subject !== "english" ? "영상은 영어 보고서에만 넣을 수 있습니다" : await reportVideoWorkerGate(g.supabase);
    if (blocked) {
      await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
      return { ok: false, error: blocked };
    }
  }
  // 영상인데 경로가 영상 확장자가 아니면(티켓을 거치지 않은 올리기) 받지 않는다 — 이름·경로가 영상 판정의 기준이다.
  if (isVideo ? hasVideoAttachment(current) || !isVideoAttachment(input.path) : verified.size > REPORT_FILE_MAX_BYTES) {
    await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
    return { ok: false, error: isVideo ? (hasVideoAttachment(current) ? VIDEO_ONE_ERROR : "영상 형식을 알 수 없습니다 — mp4·mov 파일을 넣어 주세요") : "파일이 너무 큽니다 (최대 20MB)" };
  }
  // 영상 이름은 영상 확장자로 끝나게(발송 PC가 이름으로 영상을 가른다 — 확장자 없는 'video'면 문서로 갈 뻔했다).
  const storedName = isVideo ? withVideoExt(input.name || "", verified.contentType || "video/mp4") : input.name || "photo";
  const next: Attachment[] = [
    ...current,
    { path: input.path, name: storedName, size: verified.size || input.size || 0 },
  ];
  const { data: resetRows, error } = await g.supabase
    .from("lesson_reports")
    .update({ attachments: next, ...CLASSNOTE_RESET })
    .eq("id", row.id)
    .or(RESET_OK)
    .select("id");
  if (error) {
    await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
    return { ok: false, error: explainDbError(error, { scope: "onescreen.attachment-actions.registerReportAttachment", fallback: "등록 실패 — 잠시 후 다시 시도해 주세요" }).message };
  }
  if (!resetRows?.length) {
    await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
    return { ok: false, error: await resetBlockedError(g.supabase, row.id) };
  }
  // 감사로그 — 첨부 변경은 CLASSNOTE_RESET으로 **발송 상태를 지운다**(위 주석). 그래서 "왜 발송됨이
  // 미발송으로 돌아갔나"의 답이 이 줄뿐인 경우가 있다. 파일 이름·경로는 스토리지 대조용.
  await logAction({
    action: "report_attachment_add",
    targetType: "lesson_report",
    metadata: {
      reportId: row.id,
      studentId: input.studentId,
      date: input.reportDate ?? kstToday(),
      subject: input.subject ?? null,
      classId: input.classId ?? null,
      fileName: input.name || null,
      path: input.path,
      // 발송 상태를 실제로 되돌렸는가(없던 상태를 지운 건 표시하지 않는다).
      ...(row.classnote_status ? { classnoteReset: row.classnote_status } : {}),
    },
  });
  return { ok: true, attachments: next };
}

export type RemoveAttachmentInput = { studentId: string; subject?: string; classId?: string | null; reportDate?: string; path: string };

/** 첨부 삭제 — 행 attachments에서 path 제거 + storage 정리 + classnote 리셋. */
export async function removeReportAttachment(
  input: RemoveAttachmentInput,
): Promise<{ ok: boolean; attachments?: Attachment[]; error?: string }> {
  const g = await gate(input.studentId, input.reportDate);
  if ("error" in g) return { ok: false, error: g.error };
  const row = await findReportRow(g.supabase, input.studentId, input.subject, input.reportDate, input.classId);
  if (!row) return { ok: false, error: "보고서를 찾을 수 없습니다" };
  if (isSentLocked(row)) return { ok: false, error: SENT_LOCK_ERROR };
  const current = row.attachments ?? [];
  const next = current.filter((a) => a.path !== input.path);
  if (next.length === current.length) return { ok: true, attachments: current }; // 이미 없음(멱등)
  const { data: resetRows, error } = await g.supabase
    .from("lesson_reports")
    .update({ attachments: next, ...CLASSNOTE_RESET })
    .eq("id", row.id)
    .or(RESET_OK)
    .select("id");
  if (error) return { ok: false, error: explainDbError(error, { scope: "onescreen.attachment-actions.removeReportAttachment", fallback: "삭제 실패 — 잠시 후 다시 시도해 주세요" }).message };
  if (!resetRows?.length) return { ok: false, error: await resetBlockedError(g.supabase, row.id) };
  await removeObject(input.path, { bucket: BUCKET }).catch(() => {});
  // 🔴 파일은 스토리지에서 **실제로 지워진다** — 되돌릴 수 없으니 누가 지웠는지가 유일한 근거다.
  //    (위 멱등 분기 = 이미 없던 첨부는 여기 안 온다.)
  await logAction({
    action: "report_attachment_remove",
    targetType: "lesson_report",
    metadata: {
      reportId: row.id,
      studentId: input.studentId,
      date: input.reportDate ?? kstToday(),
      subject: input.subject ?? null,
      classId: input.classId ?? null,
      fileName: current.find((a) => a.path === input.path)?.name ?? null,
      path: input.path,
      ...(row.classnote_status ? { classnoteReset: row.classnote_status } : {}),
    },
  });
  return { ok: true, attachments: next };
}

/**
 * 카드 썸네일용 signed URL — **그 보고서에 실제 포함된 path만** 서명(학생 스코프 + 소속 path).
 * attachments 배열도 함께 반환(소비처가 초기 로드 시 path·name·개수를 얻도록 — 별도 조회 불필요).
 */
export async function signReportAttachmentUrls(input: {
  studentId: string;
  subject?: string;
  /** 이 보고서의 반(0134a) — 같은 과목 두 행(정규+특강)을 가르는 키. 없으면 반 없는 행. */
  classId?: string | null;
  reportDate?: string;
}): Promise<{ urls?: Record<string, string>; attachments?: Attachment[]; error?: string }> {
  const g = await gate(input.studentId, input.reportDate);
  if ("error" in g) return { error: g.error };
  const row = await findReportRow(g.supabase, input.studentId, input.subject, input.reportDate, input.classId);
  const attachments = row?.attachments ?? [];
  const paths = attachments.map((a) => a.path);
  if (paths.length === 0) return { urls: {}, attachments: [] };
  try {
    return { urls: await resolveTenantReadUrls(paths, KIND, g.user.tenantId), attachments };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "썸네일 URL 생성 실패" };
  }
}
