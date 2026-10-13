import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import type { TenantSettings } from "@/features/owner/settings-types";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import { kstToday } from "@/lib/date-kst";
import { checkVideoFile } from "../rules";
import { linkVideoFilename, teacherFolderKey } from "../route";
import { UPLOAD_STARTS_PER_DAY, UPLOAD_STARTS_PER_HOUR, uploadOrigin } from "../upload-checks";
import { videoSubmitAvailability, videoSubmitSchemaReady } from "./availability";
import { driveRequest, generateDriveId, startResumableSession } from "./drive-api";
import { videoDriveHasRoom } from "./drive-quota";
import { linkFolderRegistry } from "./folder-registry";
import { ensureLinkTeacherFolder } from "./folders";
import { resolveSubmitToken } from "./links";
import { isAssignedHomeworkDate } from "./site-homework";
import { SITE_FREE_UPLOADS_PER_DAY, SITE_LINK_LOOKBACK_DAYS, siteNote } from "../site";
import { reconcileLinkUploads, type CompletedUpload } from "./upload-complete";
import { loadLinkRoute } from "./upload-context";

export type StartUploadResult =
  | { ok: true; uploadId: string; sessionUrl: string }
  | { ok: false; code: "invalid" | "expired" | "unavailable" | "file" | "limit" | "error"; error: string };

const UNAVAILABLE = "지금은 영상을 받을 수 없습니다. 선생님께 알려 주세요.";
const FAILED = "영상 올리기를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const LIMITED = "잠시 동안 너무 많이 올렸습니다. 한 시간 뒤에 다시 시도해 주세요.";
/** 올리기 사이트 링크인데 고른 숙제를 확인할 수 없다(주소의 숙제일이 빠졌거나, 그 숙제가 없어졌거나, 숙제일 + 7일이 지났다). */
const HOMEWORK_GONE = "올릴 숙제를 확인하지 못했습니다. 처음 화면에서 숙제를 다시 골라 주세요.";
const NOTE_NEEDED = "무슨 영상인지 메모를 2글자 이상 적어 주세요.";
const FREE_LIMITED = `숙제 없이 올리는 영상은 하루 ${SITE_FREE_UPLOADS_PER_DAY}개까지입니다. 내일 다시 올려 주세요.`;

/**
 * 오늘(KST) 이 학생이 **숙제 없이** 시작한 업로드 수 — 반을 합쳐 센다(그 학생의 최근 사이트 링크 전부). 거절된 시작(횟수 제한·Drive 실패로
 * `failed`)은 안 센다. 줄 수가 작아 받아서 센다(상한을 넘으면 조용히 자르지 않고 던진다, B2).
 */
async function freeUploadsToday(db: ReturnType<typeof createAdminClient>, link: { tenant_id: string; student_id: string }): Promise<number> {
  const links = await db.from("homework_video_links").select("id")
    .eq("tenant_id", link.tenant_id).eq("student_id", link.student_id).eq("origin", "site")
    .gte("created_at", new Date(Date.now() - SITE_LINK_LOOKBACK_DAYS * 86_400_000).toISOString()).limit(201);
  if (links.error) throw new Error("업로드 횟수 확인 실패");
  const ids = ((links.data ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length > 200) throw new Error("업로드 횟수 확인 범위 초과");
  if (!ids.length) return 0;
  const rows = await db.from("homework_video_link_uploads").select("id,status,route")
    .eq("tenant_id", link.tenant_id).in("link_id", ids).gte("created_at", `${kstToday()}T00:00:00+09:00`).limit(501);
  if (rows.error) throw new Error("업로드 횟수 확인 실패");
  const list = (rows.data ?? []) as Array<{ status: string; route: { homeworkDate?: unknown } | null }>;
  if (list.length > 500) throw new Error("업로드 횟수 확인 범위 초과");
  return list.filter((r) => r.status !== "failed" && !r.route?.homeworkDate).length;
}

/**
 * 숙제 없이 올리기 전에 반을 다시 본다 — 조회 화면(`findCandidates`)과 같은 조건: 지금 그 반 수강 중(휴원·종료 아님) · 반이 살아 있음 · 학원 설정의 영상 숙제 대상.
 */
async function freeUploadClassLive(db: ReturnType<typeof createAdminClient>, link: { tenant_id: string; student_id: string; class_id: string },
  settings: TenantSettings, day: string): Promise<boolean> {
  const [enrollments, klass, student] = await Promise.all([
    db.from("enrollments").select("start_date,end_date,on_hold,is_transferred").eq("tenant_id", link.tenant_id)
      .eq("student_id", link.student_id).eq("class_id", link.class_id).limit(50),
    db.from("classes").select("id,subject,is_active").eq("tenant_id", link.tenant_id).eq("id", link.class_id).maybeSingle(),
    db.from("students").select("grade,status").eq("tenant_id", link.tenant_id).eq("id", link.student_id).maybeSingle(),
  ]);
  if (enrollments.error || klass.error || student.error) throw new Error("반 확인 실패");
  if (!klass.data?.is_active || !klass.data.subject || student.data?.status !== "enrolled") return false;
  const live = ((enrollments.data ?? []) as Array<{ start_date: string | null; end_date: string | null; on_hold: boolean | null; is_transferred: boolean | null }>)
    .some((e) => !e.on_hold && (!e.start_date || e.start_date <= day) && !isEnrollmentEndedOn(e.end_date, day, e.is_transferred === true));
  return live && isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy,
    { classId: klass.data.id as string, subjectKey: klass.data.subject as string, grade: (student.data?.grade as string | null) ?? null });
}

/**
 * 횟수 제한을 셀 링크들 — 보고서·원생 탭 링크는 그 링크 하나, **사이트 링크는 같은 학생 × 반의 최근 사이트 링크 전부**
 * (사이트 링크는 숙제일 + 7일까지 살아 만든 날에서 길어야 8일 — `SITE_LINK_LOOKBACK_DAYS`면 살아 있는 것을 다 덮는다).
 */
async function uploadLimitLinkIds(db: ReturnType<typeof createAdminClient>, link: { id: string; tenant_id: string; student_id: string; class_id: string; origin: string }): Promise<string[]> {
  if (link.origin !== "site") return [link.id];
  const { data, error } = await db.from("homework_video_links").select("id")
    .eq("tenant_id", link.tenant_id).eq("student_id", link.student_id).eq("class_id", link.class_id).eq("origin", "site")
    .gte("created_at", new Date(Date.now() - SITE_LINK_LOOKBACK_DAYS * 86_400_000).toISOString()).limit(201);
  if (error) throw new Error("업로드 횟수 확인 실패");
  if ((data ?? []).length > 200) throw new Error("업로드 횟수 확인 범위 초과"); // 조용히 잘라 합산을 줄이지 않는다(하루 상한 × 9일 ≈ 60줄)
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  return ids.includes(link.id) ? ids : [...ids, link.id];
}

/**
 * 업로드 시작 — 토큰·파일 검사 → 담임 폴더 확보 → Drive 번호를 미리 받아 기록 → 재개 가능 세션 주소만 돌려준다.
 * 🔴 자격은 **그 지점의 지금 저장 폴더에 묶인 계정** 하나다(기존 env 연결 또는 지점이 연결한 Google 계정). 경로에 폴더와 연결을 함께 각인한다 —
 *    이후 계정을 바꾸거나 해제해도 이 업로드는 처음 계정으로 끝난다. 그 계정의 남은 공간이 모자라면 새 업로드를 열지 않는다.
 * 🔴 영상 바이트는 서버를 지나지 않는다(Vercel 함수 본문 4.5MB 한도). 브라우저가 세션 주소로 Google에 직접 보낸다.
 * 🔴 실패 원문(Drive 상태·DB 오류)은 서버 로그에만 — 학부모 화면엔 한글 한 줄(raw 노출 금지).
 * `followUp` = 횟수 제한을 통과한 시작이면, 지난번에 못 알린 업로드를 **응답 뒤에** 대신 마무리하는 일(라우트가 `after()`로 돌리고
 *   새로 생긴 줄마다 알림·감사로그). 응답을 기다리게 하지 않고, 제한에 걸린 요청은 Drive를 부르지 않는다(재리뷰 2026-10-01).
 * `homeworkDate` = 학생이 올리기 사이트에서 고른 숙제일(2026-10-03). 🔴 주소·요청의 값을 믿지 않는다 — 그 링크의 학생 × 반에 **실제로 나간
 *   영상 숙제**이고 올릴 수 있는 기간 안일 때만 경로에 싣는다(영상 제출 현황이 그 숙제 칸에 붙인다). 올리기 사이트가 만든 링크는 숙제 없이는
 *   올릴 수 없다(숙제가 있어야 올리는 문이다). 그 밖의 링크(학생 상세에서 복사한 링크)는 숙제일이 없어도 예전처럼 올린다.
 */
export async function startLinkUpload(input: {
  token: unknown; file: { name?: unknown; size?: unknown; type?: unknown }; origin: string | null; host: string | null; homeworkDate?: unknown;
  /** 숙제 없이 올리는 영상의 메모(올리기 사이트 링크 · 숙제를 고르지 않았을 때만 쓴다 — 2026-10-13). */
  note?: unknown;
}): Promise<{ result: StartUploadResult; followUp: (() => Promise<CompletedUpload[]>) | null }> {
  let followUp: (() => Promise<CompletedUpload[]>) | null = null;
  const fail = (code: Exclude<StartUploadResult, { ok: true }>["code"], error: string) =>
    ({ result: { ok: false as const, code, error }, followUp });
  const origin = uploadOrigin(input.origin, input.host);
  if (!origin) return fail("error", FAILED);
  const db = createAdminClient();
  try {
    const resolved = await resolveSubmitToken(db, input.token);
    if (resolved.state === "expired") return fail("expired", "만료된 링크입니다.");
    if (resolved.state !== "ok") return fail("invalid", "사용할 수 없는 링크입니다.");
    const link = resolved.link;
    const file = checkVideoFile(input.file);
    if (!file.ok) return fail("file", file.error);
    const settings = await getTenantSettingsByTenantId(link.tenant_id);
    const availability = await videoSubmitAvailability(link.tenant_id, settings, db);
    // 새 업로드를 꺼도 이전에 시작한 업로드의 완료 확인은 유지한다. 기능·스키마 검사는 그대로 적용한다.
    if (!availability.ok && (availability.reason === "module_off" || availability.reason === "no_schema" || !(await videoSubmitSchemaReady(db))))
      return fail("unavailable", UNAVAILABLE);

    // 횟수 제한 — 먼저 가볍게 세고(대부분 여기서 끝), 기록을 넣은 **뒤에 다시 센다**: 동시에 수십 개를 보내도
    // 각자 자기 기록까지 센 수를 보므로 한도를 넘는 시작은 세션을 열지 못한다(세기와 넣기 사이의 틈, 적대 리뷰 2026-10-01).
    const now = Date.now();
    // 사이트가 만든 링크는 **그 학생 × 반의 사이트 링크 전부**를 합쳐 센다 — 링크를 새로 열어 횟수 제한을 늘리지 못하게(적대 리뷰 2026-10-02).
    const limitLinkIds = await uploadLimitLinkIds(db, link);
    const count = (ms: number) => db.from("homework_video_link_uploads").select("id", { count: "exact", head: true })
      .eq("tenant_id", link.tenant_id).in("link_id", limitLinkIds).gte("created_at", new Date(now - ms).toISOString());
    const overLimit = async (extra: number) => {
      const [hour, day] = await Promise.all([count(3_600_000), count(86_400_000)]);
      if (hour.error || day.error) throw new Error("업로드 횟수 확인 실패");
      return (hour.count ?? 0) + extra > UPLOAD_STARTS_PER_HOUR || (day.count ?? 0) + extra > UPLOAD_STARTS_PER_DAY;
    };
    if (await overLimit(1)) return fail("limit", LIMITED);
    // 지난 업로드는 **각자 각인된 폴더·계정의 자격**으로 마무리한다(지금 계정으로 끝내지 않는다).
    followUp = () => reconcileLinkUploads(db, link).catch(() => []);
    if (!availability.ok) return fail("unavailable", UNAVAILABLE);
    const { drive, centerId } = availability;
    const request = driveRequest(drive.accessToken);
    const bytes = Number(input.file.size);
    if (!(await videoDriveHasRoom({ db, target: drive, request, bytes }))) return fail("unavailable", UNAVAILABLE);

    const baseRoute = await loadLinkRoute(db, link, drive.rootId, drive.connectionId);
    if (!baseRoute) return fail("invalid", "사용할 수 없는 링크입니다.");
    const homeworkOk = input.homeworkDate != null
      && (await isAssignedHomeworkDate(db, link.tenant_id, { studentId: link.student_id, classId: link.class_id }, input.homeworkDate, kstToday()));
    // 사이트 링크: 숙제를 골랐으면 그 숙제가 맞아야 하고(없어졌으면 다시 고른다), 숙제 없이 올리면 메모가 있어야 한다(하루 상한 — 아래).
    if (link.origin === "site" && input.homeworkDate != null && !homeworkOk) return fail("invalid", HOMEWORK_GONE);
    const note = link.origin === "site" && !homeworkOk ? siteNote(input.note) : null;
    const free = link.origin === "site" && !homeworkOk;
    if (free && !note) return fail("file", NOTE_NEEDED);
    if (free && (await freeUploadsToday(db, link)) >= SITE_FREE_UPLOADS_PER_DAY) return fail("limit", FREE_LIMITED);
    // 숙제 없이 올리는 영상은 지금 그 반을 다니고 영상 숙제 대상일 때만(숙제용 링크가 퇴원 뒤에도 며칠 살아 있다).
    if (free && !(await freeUploadClassLive(db, link, settings, kstToday()))) return fail("invalid", "지금 이 반에는 영상을 올릴 수 없습니다. 처음 화면에서 다시 골라 주세요.");
    const route = homeworkOk ? { ...baseRoute, homeworkDate: input.homeworkDate as string } : free && note ? { ...baseRoute, note, free: true as const } : baseRoute;
    const folder = await ensureLinkTeacherFolder({
      request, registry: linkFolderRegistry(db, link.tenant_id, drive.rootId), rootId: drive.rootId,
      key: teacherFolderKey(route, centerId), folderName: route.folderName,
    });
    const fileId = await generateDriveId(request);
    const uploadId = randomUUID();
    const startedAt = new Date();
    const fileName = linkVideoFilename(route, startedAt, file.ext);
    const markFailed = (error: string) => db.from("homework_video_link_uploads").update({ status: "failed", error })
      .eq("tenant_id", link.tenant_id).eq("id", uploadId);
    const inserted = await db.from("homework_video_link_uploads").insert({
      id: uploadId, tenant_id: link.tenant_id, link_id: link.id, drive_file_id: fileId, drive_folder_id: folder.id,
      file_name: fileName, bytes, mime_type: file.mimeType, route, created_at: startedAt.toISOString(),
    });
    if (inserted.error) throw new Error("업로드 기록 실패");
    if (await overLimit(0)) {
      await markFailed("횟수 제한");
      return fail("limit", LIMITED);
    }
    // 숙제 없는 업로드의 하루 상한도 넣은 뒤 다시 센다(동시에 여러 개를 보내 세기와 넣기 사이의 틈으로 넘지 못하게).
    if (free && (await freeUploadsToday(db, link)) > SITE_FREE_UPLOADS_PER_DAY) {
      await markFailed("하루 상한");
      return fail("limit", FREE_LIMITED);
    }
    let sessionUrl: string;
    try {
      sessionUrl = await startResumableSession(request, { fileId, name: fileName, mimeType: file.mimeType, bytes, folderId: folder.id, origin, uploadId });
    } catch (error) {
      await markFailed("Drive 업로드를 시작하지 못했습니다.");
      throw error;
    }
    await db.from("homework_video_links").update({ last_used_at: startedAt.toISOString() }).eq("tenant_id", link.tenant_id).eq("id", link.id);
    return { result: { ok: true, uploadId, sessionUrl }, followUp };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "videoSubmit.start", message: error instanceof Error ? error.message : "unknown" }));
    return fail("error", FAILED);
  }
}
