import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canAccessTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStudentById } from "./queries";
import { teacherViewableClassIds } from "./read-scope";
import { homeworkVideoSource } from "@/features/video-homework/server/video-source";
import { getThreadVideoStates } from "@/features/classnote-reply/server/video-poll";
import { readPinnedVideoDriveCredential } from "@/features/video-submit/server/drive-credentials";
import { DRIVE_API } from "@/features/video-submit/server/drive-api";
import { reportError } from "@/lib/observability/report-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
const CHUNK_BYTES = 2 * 1024 * 1024;
const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const unavailable = (status: number) => Response.json({ error: "영상을 불러오지 못했습니다. 다시 시도해 주세요." }, { status, headers: PRIVATE });

/** Single bounded range: avoids downloading/buffering a whole homework video in a serverless request. */
export function videoByteRange(value: string | null): string | null {
  if (!value) return `bytes=0-${CHUNK_BYTES - 1}`;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  if ((start !== null && !Number.isSafeInteger(start)) || (end !== null && !Number.isSafeInteger(end))) return null;
  if (start === null) return end && end <= CHUNK_BYTES ? `bytes=-${end}` : null;
  if (start > Number.MAX_SAFE_INTEGER - CHUNK_BYTES || (end !== null && end < start)) return null;
  return `bytes=${start}-${Math.min(end ?? Number.MAX_SAFE_INTEGER, start + CHUNK_BYTES - 1)}`;
}

type ViewerUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
type VideoRow = { student_id: string | null; status: string; drive_file_id: string | null; route: unknown };

/**
 * 학생에 연결된 숙제 영상을 이 사람이 볼 수 있는가 — 재생(아래 stream)과 영상 설명 AI 참고 메모(video-review)가 **같은 판정**을 쓴다
 * (#77: 화면 조건이 아니라 한 게이트). 학생 미연결 영상은 여기서 판정하지 않는다(대화 스레드 경로 전용 — 호출부가 따로 다룬다).
 */
export async function canViewLinkedHomeworkVideo(
  user: ViewerUser, db: ReturnType<typeof createAdminClient>, video: { id: string; student_id: string; route: unknown },
): Promise<boolean> {
  const videoId = video.id;
  const studentId = video.student_id;
  if (!(await getStudentById(studentId))) return false;
  // A teacher who teaches this student in one subject must not gain every other subject's Drive folder access.
  if (user.systemRole === "teacher" || (await accessLevelTenant(user.systemRole, "students")) === "scoped") {
    const source = await homeworkVideoSource(db);
    const [scope, linked] = await Promise.all([
      teacherViewableClassIds(user.id),
      db.from(source).select("route").eq("tenant_id", user.tenantId).eq("id", videoId).maybeSingle(),
    ]);
    if (linked.error) throw linked.error;
    const linkedRoute = linked.data?.route as { classId?: unknown; excluded?: unknown } | null;
    const originalRoute = video.route as { classId?: unknown } | null;
    const classId = linkedRoute?.excluded === true ? originalRoute?.classId : linkedRoute?.classId;
    if (typeof classId !== "string" || !scope.includes(classId)) return false;
  }
  return true;
}

/**
 * 로그인·학생 아님·학생 메뉴 접근·이 지점의 업로드된 영상까지 — 재생과 AI 참고 메모의 공통 앞단.
 * 🔑 판정하는 사람은 **화면 주인** — 강사뷰(다른 강사 뷰)면 검증된 대상 강사다. 학생 상세 열람(`canViewStudentDetail`)과
 *    같은 신원이어야 한다: 실제 계정(관리자) id로 담당 반을 물으면 대상 강사의 학생 영상이 403이었다(2026-11-05 점검).
 */
export async function loadViewableVideo(videoId: string): Promise<
  { ok: true; user: ViewerUser; db: ReturnType<typeof createAdminClient>; video: VideoRow } | { ok: false; status: number }
> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || user.systemRole === "student") return { ok: false, status: 401 };
  if (!UUID.test(videoId)) return { ok: false, status: 404 };
  if (!(await canAccessTenant(user.systemRole, "students"))) return { ok: false, status: 403 };
  const db = createAdminClient();
  const { data: video, error } = await db.from("student_homework_videos").select("student_id,status,drive_file_id,route")
    .eq("tenant_id", user.tenantId).eq("id", videoId).maybeSingle();
  if (error) throw error;
  if (!video || video.status !== "uploaded" || !DRIVE_ID.test(video.drive_file_id ?? "")) return { ok: false, status: 404 };
  return { ok: true, user, db, video: video as VideoRow };
}

/** Each range rechecks the signed-in viewer and exact tenant/video before reading that file's pinned Drive account. */
export async function streamHomeworkVideo(request: Request, videoId: string): Promise<Response> {
  try {
    const loaded = await loadViewableVideo(videoId);
    if (!loaded.ok) return unavailable(loaded.status);
    const { user, db, video } = loaded;
    if (video.student_id) {
      if (!(await canViewLinkedHomeworkVideo(user, db, { id: videoId, student_id: video.student_id, route: video.route }))) return unavailable(403);
    } else {
      // An unmatched worker row is viewable only inside a thread that already permits this exact video.
      const messageId = new URL(request.url).searchParams.get("messageId") ?? "";
      if (!UUID.test(messageId)) return unavailable(403);
      const states = await getThreadVideoStates(messageId);
      if (!Object.values(states).some(videos => videos.some(v => v.id === videoId && v.playable && v.links))) return unavailable(403);
    }
    const range = videoByteRange(request.headers.get("range"));
    if (!range) return unavailable(416);
    const route = video.route && typeof video.route === "object" ? video.route as Record<string, unknown> : {};
    const root = typeof route.rootId === "string" ? route.rootId : "";
    if (!DRIVE_ID.test(root)) return unavailable(503);
    const credential = await readPinnedVideoDriveCredential(db, user.tenantId, root, typeof route.connectionId === "string" ? route.connectionId : null);
    if (!credential || credential.status !== "ready") return unavailable(503);
    const upstream = await fetch(`${DRIVE_API}/files/${video.drive_file_id}?alt=media&supportsAllDrives=true`, {
      cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      headers: { Authorization: `Bearer ${await credential.accessToken()}`, Range: range },
    });
    if (upstream.status === 416) {
      await upstream.body?.cancel();
      const headers = new Headers(PRIVATE); const size = upstream.headers.get("content-range");
      if (size && /^bytes \*\/\d+$/.test(size)) headers.set("Content-Range", size);
      return new Response(null, { status: 416, headers });
    }
    const mime = upstream.headers.get("content-type")?.split(";")[0].trim();
    const length = Number(upstream.headers.get("content-length"));
    const contentRange = upstream.headers.get("content-range");
    const parts = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange ?? "")?.slice(1).map(Number);
    const requestedStart = /^bytes=(\d+)-/.exec(range)?.[1];
    const validRange = parts?.every(Number.isSafeInteger) && parts[0] <= parts[1] && parts[1] < parts[2]
      && parts[1] - parts[0] + 1 === length && (requestedStart === undefined || parts[0] === Number(requestedStart));
    if (upstream.status !== 206 || !upstream.body || !validRange || !contentRange
      || !Number.isSafeInteger(length) || length <= 0 || length > CHUNK_BYTES || !mime || !/^video\/(mp4|quicktime|webm|ogg)$/.test(mime)) {
      const status = upstream.status; await upstream.body?.cancel();
      reportError(new Error(`Video media response HTTP ${status}`), { scope: "homework-video.stream", tenantId: user.tenantId });
      return unavailable(status === 404 ? 404 : 502);
    }
    return new Response(upstream.body, { status: 206, headers: { ...PRIVATE, "Content-Type": mime, "Content-Length": String(length),
      "Content-Range": contentRange, "Accept-Ranges": "bytes" } });
  } catch (error) {
    if (!request.signal.aborted) reportError(error, { scope: "homework-video.stream" });
    return unavailable(502);
  }
}
