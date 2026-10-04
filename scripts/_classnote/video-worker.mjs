import postgres from "postgres";
import path from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { stateDir } from "./classnote-paths.mjs";
import { loadVideoTeacher } from "./video-teacher-route.mjs";
import { downloadVideo } from "./video-download.mjs";
import { ensureTeacherFolder } from "./video-drive-folders.mjs";
import { uploadVideoToDrive } from "./video-drive.mjs";
import { reloadArchivedVideo, videoFeedSession } from "./classnote-feed-core.mjs";
import { videoFolderRegistry, videoFileRegistry } from "./video-folder-registry.mjs";
import { videoFilename } from "./video-filename.mjs";
import { scanVideoHistory } from "./video-history.mjs";
import { runManualDriveScan } from "./video-manual-scan.mjs";
import { archiveUploadPreparer, removeArchiveLeftovers } from "./video-compress.mjs";
import { driveQuotaPaused } from "./video-drive-quota.mjs";
import { loadWorkerVideoDriveSetting, resolveVideoJobRoot, workerVideoTargetMatches } from "./video-drive-settings.mjs";
import { credentialForVideoTarget, rejectCachedTenantToken } from "./video-drive-token.mjs";
import { pickVideoJob } from "./video-job-pick.mjs";

let running = null;
let nextPoll = 0;
/** 마지막으로 로그에 남긴 Drive 인증 실패 사유 — 풀리면 비운다. */
let authFailure = null;
/** 저장 폴더 조회 실패로 새 수집을 건너뛴 안내 — 설정이 다시 읽히면 비운다. */
let collectionSkipLogged = false;

function envBag(options) {
  return options?.env ?? process.env;
}

/** 발송 루프는 전송을 기다리지 않는다. DB 선점은 여러 PC가 같은 영상을 동시에 처리하지 못하게 한다. */
export function kickVideoWorker(browser, tenant, log = console.log, options = {}) {
  if (running || Date.now() < nextPoll) return running;
  nextPoll = Date.now() + 60_000;
  running = (async () => {
    const env = envBag(options);
    const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
    try {
      const setting = options.setting ?? await loadWorkerVideoDriveSetting(sql, tenant, { env });
      // 새 수집·직접 제출 훑기는 지금 활성 루트만. 해제 뒤에도 이미 찍힌 작업은 아래 processVideoJob 이 끝낸다.
      // 조회 실패는 꺼짐이 아니다. 이력·직접 제출은 돌리지 않고, 이미 찍힌 작업만 소유를 확인할 수 있을 때 끝낸다.
      if (setting.error) {
        if (!collectionSkipLogged) log("[영상] 저장 폴더 설정을 확인하지 못해 새 수집은 건너뜁니다. 이미 찍힌 작업만 이어서 확인합니다.");
        collectionSkipLogged = true;
      } else {
        collectionSkipLogged = false;
        if (setting.enabled && setting.rootId) {
          try {
            const { page, centerId } = await videoFeedSession(browser);
            await scanVideoHistory(sql, page, tenant, centerId, { log, archiveEnabled: true, env });
          } catch { log("[영상 이력] 수집 재시도 대기 — 저장된 위치부터 이어갑니다."); }
          await runManualDriveScan(tenant, { log, rootId: setting.rootId, connectionId: setting.connectionId, schema: setting.schema, env });
        }
      }
    } finally { await sql.end(); }
    await processVideoJob(browser, tenant, log, { env });
  })()
    .catch(() => log("[영상] 업로드 연결 확인 필요 — 다음 주기에 재시도합니다."))
    .finally(() => { running = null; });
  return running;
}

export async function processVideoJob(browser, tenant, log = console.log, options = {}) {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, connect_timeout: 15 });
  const env = envBag(options);
  let job;
  let timer;
  let credentials;
  let leaseLost = false;
  const token = randomUUID();
  try {
    const setting = await loadWorkerVideoDriveSetting(sql, tenant, { env });
    const acceptNew = setting.enabled === true && !!setting.rootId;
    // ClassNote 수집분(post_id 있음)만. 새 각인은 활성 설정이 있을 때만. 이미 rootId 가 있으면 설정이 꺼져도 집는다.
    // 앞쪽 8건만 보고 계정마다 고른다. 멈춘 계정의 새 작업은 실패로 두지 않는다.
    const candidates = await sql`select id, status, route, payload from student_homework_videos where tenant_id = ${tenant} and post_id is not null
      and ((status in ('queued', 'failed') and available_at <= now())
        or (status = 'processing' and locked_at < now() - interval '10 minutes'))
      and (coalesce(route->>'rootId', '') <> '' or ${acceptNew})
      order by available_at, id limit 8`;
    if (!candidates.length) return;
    // 선점 전 변경은 지금 집어도 되는 행만. 다른 PC가 방금 잠근 작업의 lock_token 은 풀지 않는다.
    const picked = await pickVideoJob(candidates, {
      resolve: (row) => resolveVideoJobRoot(setting, row.route),
      owned: (decision) => workerVideoTargetMatches(sql, tenant, decision, setting, { env }),
      auth: async (decision) => {
        const credentials = await credentialForVideoTarget({
          tenantId: tenant, rootId: decision.rootId, connectionId: decision.connectionId, schema: setting.schema,
        }, { env, sql });
        try { await credentials.accessToken(); authFailure = null; }
        catch (error) {
          const reason = error?.message || "연결을 다시 확인하세요.";
          if (reason !== authFailure) log(`[영상] Drive 인증 실패 — ${reason}`);
          authFailure = reason;
          throw error;
        }
        return credentials;
      },
      paused: (auth) => driveQuotaPaused(auth, { log, env }),
      claim: async (row) => {
        const [claimed] = await sql`update student_homework_videos set status = 'processing', lock_token = ${token},
          locked_at = now(), attempts = attempts + 1, updated_at = now()
          where id = ${row.id} and tenant_id = ${tenant}
          and ((status in ('queued', 'failed') and available_at <= now())
            or (status = 'processing' and locked_at < now() - interval '10 minutes'))
          returning *`;
        return claimed ?? null;
      },
      fail: (row) => sql`update student_homework_videos set status = 'failed',
        error = '영상 전송을 완료하지 못했습니다. 워커 인증·원본·폴더 설정을 확인하세요.',
        available_at = now() + interval '15 minutes', updated_at = now(), locked_at = null, lock_token = null
        where id = ${row.id} and tenant_id = ${tenant}
        and ((status in ('queued', 'failed') and available_at <= now())
          or (status = 'processing' and locked_at < now() - interval '10 minutes'))`,
      requeue: (row) => sql`update student_homework_videos set status = 'queued', lock_token = null, locked_at = null,
        available_at = now() + interval '5 minutes', updated_at = now()
        where id = ${row.id} and tenant_id = ${tenant}
        and ((status in ('queued', 'failed') and available_at <= now())
          or (status = 'processing' and locked_at < now() - interval '10 minutes'))`,
      defer: (row) => sql`update student_homework_videos set status = ${row.status === "failed" ? "failed" : "queued"},
        lock_token = null, locked_at = null, available_at = now() + interval '5 minutes', updated_at = now()
        where id = ${row.id} and tenant_id = ${tenant}
        and ((status in ('queued', 'failed') and available_at <= now())
          or (status = 'processing' and locked_at < now() - interval '10 minutes'))`,
    });
    if (!picked.job) {
      if (picked.mismatched) throw new Error("영상 업로드 재시도 대기");
      return;
    }
    job = picked.job;
    const decision = picked.decision;
    credentials = picked.auth;
    const workRoot = decision.rootId;
    timer = setInterval(() => {
      sql`update student_homework_videos set locked_at = now() where id = ${job.id}
        and tenant_id = ${tenant} and lock_token = ${token} returning id`
        .then((rows) => { if (!rows.length) leaseLost = true; }).catch(() => { leaseLost = true; });
    }, 30_000);
    timer.unref();
    const parentDir = stateDir();
    if (!parentDir) throw new Error("영상 임시 저장 폴더를 열 수 없습니다.");
    const out = path.join(process.env.CLASSNOTE_VIDEO_OUT || path.join(parentDir, "videos"), tenant);
    await mkdir(out, { recursive: true });
    const candidate = await reloadArchivedVideo(browser, job.payload);
    // 이미 찍힌 rootId 는 활성 설정으로 바꾸지 않는다. 없는 작업만 지금 루트를 찍는다.
    const connectionStamp = decision.connectionId ? { connectionId: decision.connectionId } : {};
    const route = decision.kind === "pinned"
      ? { ...job.route, rootId: workRoot, ...connectionStamp }
      : { ...await loadVideoTeacher(sql, tenant, candidate), rootId: workRoot, ...connectionStamp };
    const auth = { ...credentials, fileRegistry: videoFileRegistry(sql, tenant), folderRegistry: videoFolderRegistry(sql, tenant, workRoot), accessToken: async () => {
      if (leaseLost) throw new Error("영상 작업 연결이 끊겼습니다.");
      return credentials.accessToken();
    } };
    const displayName = videoFilename(candidate, route);
    await sql`update student_homework_videos set route = ${sql.json(route)}, student_id = ${route.studentId},
      subject = ${route.subject}, teacher_id = ${route.teacherId} where id = ${job.id} and tenant_id = ${tenant} and lock_token = ${token}`;
    const local = await downloadVideo(candidate, out);
    const folder = await ensureTeacherFolder(workRoot, route, candidate.centerId, out, auth);
    const [duplicate] = await sql`select drive_file_id from student_homework_videos where tenant_id=${tenant}
      and status='uploaded' and post_id is not null and drive_folder_id=${folder.id} and md5=${local.md5} and bytes=${local.bytes}
      order by uploaded_at limit 1`;
    const saved = await uploadVideoToDrive({ ...local, name: displayName }, folder.id, { ...auth, existingFileId: duplicate?.drive_file_id, prepareUpload: archiveUploadPreparer({ log }) });
    const completed = await sql`update student_homework_videos set status = 'uploaded', drive_file_id = ${saved.id},
      drive_folder_id = ${folder.id}, bytes = ${local.bytes}, md5 = ${local.md5}, payload = '{}'::jsonb, route = ${sql.json({ ...route, archive: { driveBytes: saved.bytes, compression: saved.compression ?? null } })},
      uploaded_at = now(), updated_at = now(), error = null, lock_token = null, locked_at = null
      where id = ${job.id} and tenant_id = ${tenant} and lock_token = ${token} returning id`;
    if (!completed.length) throw new Error("영상 작업 소유권이 변경되었습니다.");
    log(`[영상] Drive 저장 완료 · ${route.folderName}`);
    for (const file of [local.filePath, local.metadataPath]) {
      try { await unlink(file); }
      catch (error) { if (error.code !== "ENOENT") log("[영상] 임시 파일 정리 실패 — Drive 보관은 완료됐습니다."); }
    }
    await removeArchiveLeftovers(local.filePath);
  } catch (error) {
    if (/HTTP 401/.test(String(error?.message ?? "")) && credentials) rejectCachedTenantToken(credentials.connectionId, credentials.tokenVersion);
    if (job) await sql`update student_homework_videos set status = 'failed',
      error = '영상 전송을 완료하지 못했습니다. 워커 인증·원본·폴더 설정을 확인하세요.',
      available_at = now() + interval '15 minutes', updated_at = now(), locked_at = null, lock_token = null
      where id = ${job.id} and tenant_id = ${tenant} and lock_token = ${token}`;
    throw new Error("영상 업로드 재시도 대기");
  } finally { clearInterval(timer); await sql.end(); }
}
