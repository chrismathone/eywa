import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { startedWhileLinkOpen, UPLOAD_NOT_READY, verifyUploadedFile, type StartedUpload } from "../upload-checks";
import type { LinkVideoRoute } from "../route";
import { videoSubmitAvailability } from "./availability";
import { driveRequest, getDriveFile, trashDriveFile, type DriveFile, type DriveRequest } from "./drive-api";
import { resolveSubmitToken, type LinkRow } from "./links";

type Db = ReturnType<typeof createAdminClient>;
export type CompletedUpload = { videoId: string; created: boolean; route: LinkVideoRoute; studentId: string; tenantId: string; bytes: number };
export type CompleteUploadResult =
  | ({ ok: true } & CompletedUpload)
  | { ok: false; code: "invalid" | "pending" | "mismatch" | "unavailable" | "error"; error: string };
type UploadRow = StartedUpload & { status: string; route: LinkVideoRoute; video_id: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILED = "올린 영상을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const UPLOAD_COLUMNS = "id,drive_file_id,drive_folder_id,bytes,created_at,status,route,video_id";
/** 하루가 지나도 Drive에 파일이 없으면 버려진 업로드다(화면은 새로고침하면 처음부터 다시 연다). */
const ABANDON_MS = 86_400_000;

/** 우리가 연 그 업로드의 파일인가 — 우리 폴더 + 그 업로드 표식. 사람이 옮기거나 바꾼 파일은 손대지 않는다. */
const ours = (file: DriveFile | null, upload: UploadRow): file is DriveFile =>
  !!file && !file.trashed && !!file.parents?.includes(upload.drive_folder_id) &&
  file.appProperties?.aywaSource === "link" && file.appProperties?.aywaUpload === upload.id;

async function recordedVideoId(db: Db, tenantId: string, uploadId: string): Promise<string | null> {
  const { data, error } = await db.from("student_homework_videos").select("id")
    .eq("tenant_id", tenantId).eq("source", "link").eq("source_ref", uploadId).maybeSingle();
  if (error) throw new Error("영상 기록 조회 실패");
  return (data?.id as string | undefined) ?? null;
}

/**
 * '시작됨'을 '실패'로 **선점**한 쪽만 파일을 휴지통에 보낸다 — 같은 업로드를 동시에 마무리하는 쪽(완료로 선점)과 겹치지 않게.
 * 이미 영상 줄이 있으면 건드리지 않는다. 휴지통 이동이 실패하면 '시작됨'으로 되돌려 다음에 다시 본다(고아 파일로 확정하지 않는다).
 */
async function reject(db: Db, request: DriveRequest, link: LinkRow, upload: UploadRow, file: DriveFile | null, problem: string): Promise<void> {
  if (await recordedVideoId(db, link.tenant_id, upload.id)) return;
  const claim = await db.from("homework_video_link_uploads").update({ status: "failed", error: problem })
    .eq("tenant_id", link.tenant_id).eq("id", upload.id).eq("status", "started").select("id");
  if (claim.error || !claim.data?.length) return;
  console.warn(JSON.stringify({ level: "warn", scope: "videoSubmit.complete.reject", uploadId: upload.id, problem }));
  if (!ours(file, upload)) return;
  try {
    await trashDriveFile(request, file.id);
  } catch (error) {
    await db.from("homework_video_link_uploads").update({ status: "started", error: null }).eq("tenant_id", link.tenant_id).eq("id", upload.id);
    throw error;
  }
}

/**
 * 한 업로드 마무리 — 서버가 **미리 받아 둔 Drive 번호로 Drive를 다시 읽어** 폴더·크기·표식·해시가 맞을 때만
 * `student_homework_videos`(출처 'link')에 한 줄. 여러 번 불러도 한 줄('완료' 선점 + 출처·업로드 번호 유니크, 0324a).
 * 끊긴 링크(보고서 회수·재발급 포함)는 언제 시작했든 받지 않고 파일을 휴지통으로. 만료는 만료 전에 시작한 것만 받는다.
 */
export async function finalizeUpload(db: Db, request: DriveRequest, link: LinkRow, open: boolean, upload: UploadRow): Promise<CompleteUploadResult> {
  const done = (videoId: string, created: boolean): CompleteUploadResult =>
    ({ ok: true, videoId, created, route: upload.route, studentId: link.student_id, tenantId: link.tenant_id, bytes: Number(upload.bytes) });
  if (upload.status === "completed") {
    const videoId = upload.video_id ?? (await recordedVideoId(db, link.tenant_id, upload.id));
    return videoId ? done(videoId, false) : { ok: false, code: "pending", error: "아직 영상을 확인하는 중입니다." };
  }
  const file = await getDriveFile(request, upload.drive_file_id);
  if (upload.status === "failed") {
    // 실패로 끝난 업로드인데 나중에 끝까지 올라온 우리 파일(끊긴 링크로 올리던 탭) — 남기지 않는다.
    if (ours(file, upload) && !(await recordedVideoId(db, link.tenant_id, upload.id))) await trashDriveFile(request, file.id);
    return { ok: false, code: "mismatch", error: FAILED };
  }
  if (!open || !startedWhileLinkOpen(upload, link)) {
    await reject(db, request, link, upload, file, "끊기거나 만료된 링크의 업로드");
    return { ok: false, code: "invalid", error: "사용할 수 없는 링크입니다." };
  }
  if (!file) {
    if (Date.now() - Date.parse(upload.created_at) > ABANDON_MS) await reject(db, request, link, upload, null, "끝까지 올라오지 않은 업로드");
    return { ok: false, code: "pending", error: "아직 영상이 다 올라가지 않았습니다." };
  }
  const problem = verifyUploadedFile(file, upload);
  if (problem === UPLOAD_NOT_READY) return { ok: false, code: "pending", error: "아직 영상을 확인하는 중입니다." };
  if (problem) {
    await reject(db, request, link, upload, file, problem);
    return { ok: false, code: "mismatch", error: FAILED };
  }
  const now = new Date().toISOString();
  const claim = await db.from("homework_video_link_uploads").update({ status: "completed", completed_at: now, error: null })
    .eq("tenant_id", link.tenant_id).eq("id", upload.id).eq("status", "started").select("id");
  if (claim.error) throw new Error("업로드 상태 갱신 실패");
  if (!claim.data?.length) {
    // 다른 요청이 먼저 마무리(또는 거절)했다 — 그 결과를 따른다.
    const videoId = await recordedVideoId(db, link.tenant_id, upload.id);
    return videoId ? done(videoId, false) : { ok: false, code: "pending", error: "아직 영상을 확인하는 중입니다." };
  }
  const inserted = await db.from("student_homework_videos").insert({
    tenant_id: link.tenant_id, student_id: link.student_id, subject: upload.route.subject ?? null, teacher_id: upload.route.teacherId ?? null,
    source: "link", source_ref: upload.id, posted_at: upload.created_at, status: "uploaded",
    drive_file_id: file.id, drive_folder_id: upload.drive_folder_id, bytes: Number(file.size), md5: file.md5Checksum,
    payload: {}, route: upload.route, uploaded_at: now, updated_at: now,
  }).select("id").single();
  let videoId: string | null = null;
  let created = true;
  if (!inserted.error) videoId = inserted.data.id as string;
  else if (inserted.error.code === "23505") {
    // 같은 업로드의 줄이 이미 있다(드문 재시도) — 그 줄을 쓴다.
    videoId = await recordedVideoId(db, link.tenant_id, upload.id);
    created = false;
  }
  if (!videoId) {
    // 줄을 못 만들었다 — '완료' 선점을 되돌려 다음 알림·대신 마무리가 다시 보게 한다.
    await db.from("homework_video_link_uploads").update({ status: "started", completed_at: null }).eq("tenant_id", link.tenant_id).eq("id", upload.id);
    throw new Error("영상 기록 실패");
  }
  const linked = await db.from("homework_video_link_uploads").update({ video_id: videoId }).eq("tenant_id", link.tenant_id).eq("id", upload.id);
  if (linked.error) console.warn(JSON.stringify({ level: "warn", scope: "videoSubmit.complete.link", uploadId: upload.id }));
  return done(videoId, created);
}

/** 브라우저의 "끝났다" 알림 — 업로드 번호만 받는다(그 링크의 업로드여야 한다). */
export async function completeLinkUpload(input: { token: unknown; uploadId: unknown }): Promise<CompleteUploadResult> {
  if (typeof input.uploadId !== "string" || !UUID_RE.test(input.uploadId)) return { ok: false, code: "invalid", error: FAILED };
  const db = createAdminClient();
  try {
    const resolved = await resolveSubmitToken(db, input.token);
    if (resolved.state === "invalid") return { ok: false, code: "invalid", error: "사용할 수 없는 링크입니다." };
    const link = resolved.link;
    const { data: upload, error } = await db.from("homework_video_link_uploads").select(UPLOAD_COLUMNS)
      .eq("tenant_id", link.tenant_id).eq("link_id", link.id).eq("id", input.uploadId).maybeSingle();
    if (error) throw new Error("업로드 기록 조회 실패");
    if (!upload) return { ok: false, code: "invalid", error: FAILED };
    const availability = await videoSubmitAvailability(link.tenant_id, await getTenantSettingsByTenantId(link.tenant_id), db);
    if (!availability.ok) return { ok: false, code: "unavailable", error: "지금은 영상을 받을 수 없습니다. 선생님께 알려 주세요." };
    return await finalizeUpload(db, driveRequest(availability.drive.accessToken), link, resolved.state !== "revoked", upload as UploadRow);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "videoSubmit.complete", message: error instanceof Error ? error.message : "unknown" }));
    return { ok: false, code: "error", error: FAILED };
  }
}

/**
 * 끝까지 올라갔는데 "끝났다"를 못 알린 업로드(폰을 닫음) — 같은 링크로 다시 시작할 때(횟수 제한을 통과한 뒤, 응답 뒤에)
 * 서버가 대신 마무리한다. 2분~7일 전 '시작됨' 업로드 중 **오래된 것부터** 3개(하루 넘게 파일이 없으면 버려진 것으로 정리돼
 * 빠진다 — 버려진 행이 진짜 못 알린 업로드를 밀어내지 않게). 실패는 삼킨다.
 */
export async function reconcileLinkUploads(db: Db, request: DriveRequest, link: LinkRow): Promise<CompletedUpload[]> {
  const now = Date.now();
  const { data, error } = await db.from("homework_video_link_uploads").select(UPLOAD_COLUMNS)
    .eq("tenant_id", link.tenant_id).eq("link_id", link.id).eq("status", "started")
    .gte("created_at", new Date(now - 7 * 86_400_000).toISOString()).lt("created_at", new Date(now - 120_000).toISOString())
    .order("created_at", { ascending: true }).limit(3);
  if (error || !data?.length) return [];
  const results = await Promise.all((data as UploadRow[]).map((upload) =>
    finalizeUpload(db, request, link, true, upload).catch(() => null)));
  return results.flatMap((r) => (r?.ok && r.created ? [r] : []));
}
