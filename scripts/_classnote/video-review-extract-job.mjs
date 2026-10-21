// scripts/_classnote/video-review-extract-job.mjs — 잠근 한 건의 추출(드라이브에서 받기 → 소리·화면 뽑기 → 비공개 버킷에 올리기 → 단계 넘기기).
// 배경·규칙은 video-review-extract.mjs · video-review-extract-rules.mjs.
import path from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { driveClient } from "./video-drive-http.mjs";
import { downloadDriveVideo, readDriveVideo } from "./video-drive-replace.mjs";
import { resolveVideoJobRoot, workerVideoTargetMatches } from "./video-drive-settings.mjs";
import { rejectCachedTenantToken } from "./video-drive-token.mjs";
import { probeVideo } from "./video-ffmpeg.mjs";
import { failureOutcome, plannedFiles, reviewError, scaleFilter } from "./video-review-extract-rules.mjs";

const HEARTBEAT_MS = 30_000;
const FFMPEG_TIMEOUT_MS = 5 * 60_000;

/** 잠금 늘리기 — 0행이면 남이 가져갔다. */
export async function extendLease(sql, tenant, reviewId, token, track) {
  try {
    const rows = await sql`update homework_video_reviews set locked_at = now()
      where id = ${reviewId} and tenant_id = ${tenant} and lock_token = ${token} returning id`;
    track.leaseLost = rows.length === 0;
  } catch { /* 일시 오류는 다음 박동에서 */ }
}

/** 잠금을 잃었으면(또는 끝내는 중이면) 더 하지 않는다 — 받기·뽑기·주소 받기·올리기 앞마다 본다(남의 결과를 덮어쓰지 않게). */
function assertLease(track, signal) {
  signal?.throwIfAborted();
  if (track.leaseLost) throw reviewError("작업 잠금을 잃었습니다.");
}

/** 드라이브 접근(링크 압축과 같은 자격 경로) → 받은 파일 경로·크기. */
async function download(tenant, video, deps, track, filePath) {
  const { sql, env, setting, signal } = deps;
  const decision = resolveVideoJobRoot(setting, video.route);
  if (decision.kind === "skip" || decision.invalid) throw reviewError("영상 저장 연결 기록이 올바르지 않습니다.", { permanent: true });
  const matched = await workerVideoTargetMatches(sql, tenant, decision, setting, { env }).catch(() => false);
  if (!matched) throw reviewError("저장 폴더·계정 연결을 확인하지 못했습니다.");
  let credentials;
  try {
    credentials = await deps.credentialsFor({ tenantId: tenant, rootId: decision.rootId, connectionId: decision.connectionId, schema: setting.schema }, { env, sql });
    await credentials.accessToken();
  } catch { throw reviewError("Drive 인증을 확인하지 못했습니다."); }
  track.credentials = credentials;
  const request = driveClient({ fetchImpl: deps.fetchImpl, accessToken: async () => {
    if (track.leaseLost) throw reviewError("작업 잠금을 잃었습니다.");
    return credentials.accessToken();
  } });
  const meta = await readDriveVideo(request, video.drive_file_id);
  if (!meta || meta.trashed) throw reviewError("드라이브에서 영상을 찾을 수 없습니다(지워졌거나 휴지통).", { permanent: true });
  const bytes = Number(meta.size ?? video.bytes);
  if (!(bytes > 0)) throw reviewError("드라이브 영상 크기를 알 수 없습니다.", { permanent: true });
  assertLease(track, signal);
  await downloadDriveVideo(request, video.drive_file_id, bytes, filePath, { signal, sleep: deps.sleep });
}

const BROKEN_REASON = "드라이브 원본 파일이 깨져 있어 열 수 없습니다(녹화가 중간에 끊긴 파일일 수 있습니다).";
const BROKEN_MEDIA = /Invalid data found|moov atom not found|could not find codec parameters|End of file/i;

/**
 * 저장할 원인 한 줄 — 실행 명령 줄(경로·잠금 토큰이 든다)은 버리고 ffprobe가 말한 마지막 줄만, 남은 경로는 가린다(적대 리뷰 2026-10-21).
 * 예: "Command failed: ffprobe … /x/review-<id>-<token>/source.mp4\n…: No such file or directory" → "…: No such file or directory"
 */
export function probeFailureText(message, knownPaths = []) {
  // 아는 경로(공백·한글이 든 폴더 포함)는 통째로 먼저 가린다 — 정규식은 공백에서 끊겨 일부가 남는다(재검 2026-10-21).
  let text = String(message);
  for (const p of [...knownPaths].filter(Boolean).sort((x, y) => y.length - x.length)) text = text.split(p).join("…");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^Command failed:/i.test(l));
  const last = lines.at(-1) ?? "알 수 없는 오류";
  return last.replace(/(?:[A-Za-z]:)?[\\/][^\s:]+/g, "…").slice(0, 160);
}

/** ffmpeg로 소리·화면을 뽑는다 → [{name, contentType, file}]. */
async function extract(tools, runner, src, dir) {
  // 🔴 실패를 삼키지 않는다 — ffprobe가 '잘못된 데이터·moov 없음'이라고 답한 것만 원본 깨짐(영구)이다. 그 밖(도구 실행 실패·시간 초과 등)은
  //    원인을 남기고 다시 시도한다(2026-10-21 개발 확인: 정상 영상 둘이 깨짐으로 영구 실패 처리됐다).
  let probe = null;
  try { probe = await probeVideo(tools, src, runner); }
  catch (error) {
    const message = String(error?.message ?? error);
    if (BROKEN_MEDIA.test(message)) throw reviewError(BROKEN_REASON, { permanent: true });
    throw reviewError(`영상 정보를 읽지 못했습니다: ${probeFailureText(message, [src, dir])}`);
  }
  if (!(probe?.duration > 0)) throw reviewError(BROKEN_REASON, { permanent: true });
  if (!probe.audio) throw reviewError("소리가 없는 영상이라 판정할 수 없습니다.", { permanent: true, skip: true });
  const files = plannedFiles(probe.duration);
  for (const f of files) {
    const out = path.join(dir, f.name);
    const args = f.kind === "audio"
      ? ["-v", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", out]
      : ["-v", "error", "-y", "-ss", String(f.at), "-i", src, "-frames:v", "1", "-vf", scaleFilter(f.size), "-q:v", f.size > 1280 ? "2" : "3", out];
    await runner.text(tools.ffmpeg, args, FFMPEG_TIMEOUT_MS);
  }
  return { durationSec: Number(probe.duration.toFixed(2)), files: files.map((f) => ({ ...f, file: path.join(dir, f.name) })) };
}

/** 서버에서 서명된 올리기 주소를 받아 하나씩 올린다. */
export async function uploadAssets(tenant, row, token, files, deps, track) {
  const base = String(deps.env.CLASSNOTE_SHARE_BASE || "").trim().replace(/\/$/, "");
  const secret = String(deps.env.CLASSNOTE_INTERNAL_SECRET ?? "").trim();
  if (!base || !secret) throw reviewError("올리기 주소 설정(CLASSNOTE_SHARE_BASE·CLASSNOTE_INTERNAL_SECRET)이 없습니다.");
  // 긴 추출 뒤 — 잠금이 아직 내 것인지 DB로 확인하고 늘린다(서버도 같은 잠금을 다시 본다).
  await extendLease(deps.sql, tenant, row.id, token, track);
  assertLease(track, deps.signal);
  const response = await deps.fetchImpl(`${base}/api/internal/video-review/upload`, {
    method: "POST", cache: "no-store", redirect: "error",
    headers: { "content-type": "application/json", "x-eywa-internal": secret },
    body: JSON.stringify({ tenantId: tenant, reviewId: row.id, videoId: row.video_id, lockToken: token, names: files.map((f) => f.name) }),
  });
  if (response.status === 404 || response.status === 409) throw reviewError("서버가 이 작업을 받지 않습니다(이미 처리됐거나 기능이 꺼짐).", { permanent: true });
  if (!response.ok) throw reviewError(`올리기 주소를 받지 못했습니다(HTTP ${response.status}).`);
  const { uploads } = await response.json();
  const byName = new Map((uploads ?? []).map((u) => [u.name, u]));
  for (const f of files) {
    const ticket = byName.get(f.name);
    if (!ticket?.signedUrl) throw reviewError("올리기 주소가 빠졌습니다.");
    assertLease(track, deps.signal);
    const put = await deps.fetchImpl(ticket.signedUrl, {
      method: "PUT", headers: { "content-type": f.contentType, "x-upsert": "true" }, body: await readFile(f.file),
    });
    if (!put.ok) throw reviewError(`소리·화면을 올리지 못했습니다(HTTP ${put.status}).`);
    f.path = ticket.path;
  }
}

/** 잠근 한 건 — 끝까지(단계 넘기기 또는 실패 기록 · 잠금 해제 · 임시 파일 정리). 던지지 않는다. */
export { assertLease };
export async function extractClaimedReview(tenant, row, token, deps) {
  const { sql, log } = deps;
  const track = { leaseLost: false, credentials: null };
  const timer = setInterval(() => { void extendLease(sql, tenant, row.id, token, track); }, HEARTBEAT_MS);
  timer.unref?.();
  // 잠금마다 다른 폴더 — 같은 PC의 다른 실행(잠금을 넘겨받은 쪽)의 파일을 지우지 않는다. 끝나면 이 폴더만 지운다.
  const dir = path.join(deps.workDir, `review-${row.id}-${token}`);
  try {
    const [video] = await sql`select id, drive_file_id, bytes, route from student_homework_videos
      where id = ${row.video_id} and tenant_id = ${tenant} and drive_file_id is not null`;
    if (!video) throw reviewError("영상 기록을 찾을 수 없습니다.", { permanent: true });
    await mkdir(dir, { recursive: true });
    const src = path.join(dir, "source.mp4");
    await download(tenant, video, deps, track, src);
    assertLease(track, deps.signal);
    const { durationSec, files } = await extract(deps.tools, deps.runner, src, dir);
    await uploadAssets(tenant, row, token, files, deps, track);
    const assets = {
      audioPath: files.find((f) => f.kind === "audio").path,
      frames: files.filter((f) => f.kind === "frame").map((f) => ({ path: f.path, label: f.name.replace(/\.jpg$/, "") })),
      durationSec, extractedAt: deps.now().toISOString(),
    };
    const done = await sql`update homework_video_reviews set stage = 'transcribe', assets = ${sql.json(assets)}, error = null,
        lock_token = null, locked_at = null, available_at = now()
      where id = ${row.id} and tenant_id = ${tenant} and lock_token = ${token} and stage = 'extract' returning id`;
    if (done.length) log(`[AI 메모·추출] 영상 ${durationSec.toFixed(0)}초 → 소리·화면 ${files.length - 1}장 올림`);
    else log("[AI 메모·추출] 작업 잠금이 넘어가 결과를 남기지 않았습니다.");
    return { ok: done.length > 0 };
  } catch (error) {
    if (/HTTP 401\b/.test(String(error?.message ?? "")) && track.credentials)
      rejectCachedTenantToken(track.credentials.connectionId, track.credentials.tokenVersion);
    if (deps.signal?.aborted) {
      // 끝내는 중 — 시도로 세지 않고 잠금만 푼다.
      await sql`update homework_video_reviews set lock_token = null, locked_at = null, attempts = greatest(attempts - 1, 0)
        where id = ${row.id} and tenant_id = ${tenant} and lock_token = ${token}`.catch(() => {});
      return { ok: false };
    }
    const outcome = failureOutcome(Number(row.attempts), error, deps.now());
    await sql`update homework_video_reviews set stage = ${outcome.stage}, error = ${outcome.reason},
        available_at = coalesce(${outcome.availableAt}::timestamptz, available_at), lock_token = null, locked_at = null
      where id = ${row.id} and tenant_id = ${tenant} and lock_token = ${token}`.catch(() => {});
    log(`[AI 메모·추출] ${outcome.stage === "extract" ? "다음에 다시" : "그만둠"} — ${outcome.reason}`);
    return { ok: false };
  } finally {
    clearInterval(timer);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
