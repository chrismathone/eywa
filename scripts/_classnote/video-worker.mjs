import postgres from "postgres";
import path from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { stateDir } from "./classnote-paths.mjs";
import { videoArchiveEnabled } from "./video-inbox.mjs";
import { loadVideoTeacher } from "./video-teacher-route.mjs";
import { downloadVideo } from "./video-download.mjs";
import { videoDriveAuth } from "./video-drive-auth.mjs";
import { ensureTeacherFolder } from "./video-drive-folders.mjs";
import { uploadVideoToDrive } from "./video-drive.mjs";
import { reloadArchivedVideo, videoFeedSession } from "./classnote-feed-core.mjs";
import { videoFolderRegistry, videoFileRegistry } from "./video-folder-registry.mjs";
import { videoFilename } from "./video-filename.mjs";
import { scanVideoHistory } from "./video-history.mjs";
import { runManualDriveScan } from "./video-manual-scan.mjs";

let running = null;
let nextPoll = 0;
/** 마지막으로 로그에 남긴 Drive 인증 실패 사유 — 풀리면 비운다. */
let authFailure = null;

/** 발송 루프는 전송을 기다리지 않는다. DB 선점은 여러 PC가 같은 영상을 동시에 처리하지 못하게 한다. */
export function kickVideoWorker(browser, tenant, log = console.log) {
  if (!videoArchiveEnabled() || running || Date.now() < nextPoll) return;
  nextPoll = Date.now() + 60_000;
  running = (async () => {
    const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
    try {
      const { page, centerId } = await videoFeedSession(browser);
      await scanVideoHistory(sql, page, tenant, centerId, { log });
    } catch { log("[영상 이력] 수집 재시도 대기 — 저장된 위치부터 이어갑니다."); }
    finally { await sql.end(); }
    // 담임 폴더에 사람이 직접 올린 영상(10분마다·Drive는 읽기만). 실패해도 던지지 않는다 — 아래 ClassNote 영상 작업을 막지 않게.
    await runManualDriveScan(tenant, { log });
    await processVideoJob(browser, tenant, log);
  })()
    .catch(() => log("[영상] 업로드 연결 확인 필요 — 다음 주기에 재시도합니다."))
    .finally(() => { running = null; });
}

export async function processVideoJob(browser, tenant, log = console.log) {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, connect_timeout: 15 });
  let job;
  let timer;
  let leaseLost = false;
  const token = randomUUID();
  try {
    const rootId = process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID;
    const credentials = await videoDriveAuth();
    // 인증이 죽은 채로 작업을 집으면 분마다 다운로드만 하고 실패한다 — 집기 전에 토큰부터 받아 보고, 사유를 로그에 남긴다.
    // 단, 집을 작업이 있을 때만(아래 선점과 같은 조건) — 영상이 없는 평소엔 분마다 토큰 서버·gcloud를 부르지 않는다.
    // ClassNote 수집분(post_id 있음)만 집는다 — 직접 업로드·제출 링크 행(0324a)은 ClassNote에서 다시 받을 원본이 없다.
    const [waiting] = await sql`select 1 as one from student_homework_videos where tenant_id = ${tenant} and post_id is not null
      and ((status in ('queued', 'failed') and available_at <= now())
        or (status = 'processing' and locked_at < now() - interval '10 minutes')) limit 1`;
    if (!waiting) return;
    try { await credentials.accessToken(); authFailure = null; }
    catch (error) {
      const reason = credentials.kind === "oauth" && error?.message ? error.message : "연결을 다시 확인하세요.";
      if (reason !== authFailure) log(`[영상] Drive 인증 실패 — ${reason}`); // 같은 사유는 한 번만(분마다 찍지 않는다)
      authFailure = reason;
      return;
    }
    const auth = { ...credentials, fileRegistry: videoFileRegistry(sql, tenant), folderRegistry: videoFolderRegistry(sql, tenant, rootId), accessToken: async () => {
      if (leaseLost) throw new Error("영상 작업 연결이 끊겼습니다.");
      return credentials.accessToken();
    } };
    [job] = await sql`update student_homework_videos set status = 'processing', lock_token = ${token},
        locked_at = now(), attempts = attempts + 1, updated_at = now()
      where id = (select id from student_homework_videos where tenant_id = ${tenant} and post_id is not null
        and ((status in ('queued', 'failed') and available_at <= now())
          or (status = 'processing' and locked_at < now() - interval '10 minutes'))
        order by available_at, id for update skip locked limit 1)
      returning *`;
    if (!job) return;
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
    const route = job.route ?? { ...await loadVideoTeacher(sql, tenant, candidate), rootId };
    if (route.rootId !== rootId) throw new Error("최초 저장 폴더와 현재 설정이 다릅니다.");
    const displayName = videoFilename(candidate, route);
    await sql`update student_homework_videos set route = ${sql.json(route)}, student_id = ${route.studentId},
      subject = ${route.subject}, teacher_id = ${route.teacherId} where id = ${job.id} and tenant_id = ${tenant} and lock_token = ${token}`;
    const local = await downloadVideo(candidate, out);
    const folder = await ensureTeacherFolder(rootId, route, candidate.centerId, out, auth);
    // 같은 폴더의 같은 내용은 그 Drive 파일을 다시 쓴다 — 단 ClassNote 수집분(post_id 있음)끼리만. 사람이 직접 올린 파일(0324a)을
    // 가져다 쓰면 그 파일을 지우는 순간 이 영상까지 사라진다(post_id 조건은 0324a 전후 둘 다에서 돈다).
    const [duplicate] = await sql`select drive_file_id from student_homework_videos where tenant_id=${tenant}
      and status='uploaded' and post_id is not null and drive_folder_id=${folder.id} and md5=${local.md5} and bytes=${local.bytes}
      order by uploaded_at limit 1`;
    const saved = await uploadVideoToDrive({ ...local, name: displayName }, folder.id, { ...auth, existingFileId: duplicate?.drive_file_id });
    const completed = await sql`update student_homework_videos set status = 'uploaded', drive_file_id = ${saved.id},
      drive_folder_id = ${folder.id}, bytes = ${local.bytes}, md5 = ${local.md5}, payload = '{}'::jsonb,
      uploaded_at = now(), updated_at = now(), error = null, lock_token = null, locked_at = null
      where id = ${job.id} and tenant_id = ${tenant} and lock_token = ${token} returning id`;
    if (!completed.length) throw new Error("영상 작업 소유권이 변경되었습니다.");
    log(`[영상] Drive 저장 완료 · ${route.folderName}`);
    // Drive 검증과 DB 완료 저장 뒤에만 워커가 만든 임시 원본을 정리한다.
    // 사용자 Downloads에 받은 독립 시험 파일은 이 경로에 들어오지 않는다.
    for (const file of [local.filePath, local.metadataPath]) {
      try { await unlink(file); }
      catch (error) { if (error.code !== "ENOENT") log("[영상] 임시 파일 정리 실패 — Drive 보관은 완료됐습니다."); }
    }
  } catch {
    if (job) await sql`update student_homework_videos set status = 'failed',
      error = '영상 전송을 완료하지 못했습니다. 워커 인증·원본·폴더 설정을 확인하세요.',
      available_at = now() + interval '15 minutes', updated_at = now(), locked_at = null, lock_token = null
      where id = ${job.id} and tenant_id = ${tenant} and lock_token = ${token}`;
    throw new Error("영상 업로드 재시도 대기");
  } finally { clearInterval(timer); await sql.end(); }
}
