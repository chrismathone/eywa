import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { kstToday } from "@/lib/date-kst";
import { checkVideoFile } from "../rules";
import { linkVideoFilename, teacherFolderKey } from "../route";
import { UPLOAD_STARTS_PER_DAY, UPLOAD_STARTS_PER_HOUR, uploadOrigin } from "../upload-checks";
import { videoSubmitAvailability, videoSubmitSchemaReady } from "./availability";
import { readVideoDriveAuth } from "./drive-config";
import { driveRequest, generateDriveId, startResumableSession } from "./drive-api";
import { linkFolderRegistry } from "./folder-registry";
import { ensureLinkTeacherFolder } from "./folders";
import { resolveSubmitToken } from "./links";
import { isAssignedHomeworkDate } from "./site-homework";
import { SITE_LINK_LOOKBACK_DAYS } from "../site";
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
    const availability = await videoSubmitAvailability(link.tenant_id, await getTenantSettingsByTenantId(link.tenant_id), db);
    const auth = readVideoDriveAuth();
    // 새 업로드를 꺼도 이전에 시작한 업로드의 완료 확인은 유지한다. 기능·스키마·인증 검사는 그대로 적용한다.
    if (!availability.ok && (availability.reason === "module_off" || availability.reason === "no_schema" || !auth || !(await videoSubmitSchemaReady(db))))
      return fail("unavailable", UNAVAILABLE);
    const request = driveRequest(availability.ok ? availability.drive.accessToken : auth!.accessToken);

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
    followUp = () => reconcileLinkUploads(db, request, link).catch(() => []);
    if (!availability.ok) return fail("unavailable", UNAVAILABLE);
    const { drive, centerId } = availability;

    const baseRoute = await loadLinkRoute(db, link, drive.rootId);
    if (!baseRoute) return fail("invalid", "사용할 수 없는 링크입니다.");
    const homeworkOk = input.homeworkDate != null
      && (await isAssignedHomeworkDate(db, link.tenant_id, { studentId: link.student_id, classId: link.class_id }, input.homeworkDate, kstToday()));
    if (link.origin === "site" && !homeworkOk) return fail("invalid", HOMEWORK_GONE);
    const route = homeworkOk ? { ...baseRoute, homeworkDate: input.homeworkDate as string } : baseRoute;
    const folder = await ensureLinkTeacherFolder({
      request, registry: linkFolderRegistry(db, link.tenant_id, drive.rootId), rootId: drive.rootId,
      key: teacherFolderKey(route, centerId), folderName: route.folderName,
    });
    const fileId = await generateDriveId(request);
    const uploadId = randomUUID();
    const startedAt = new Date();
    const fileName = linkVideoFilename(route, startedAt, file.ext);
    const bytes = Number(input.file.size);
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
