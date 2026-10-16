// scripts/_classnote/video-link-compress.mjs — `/v`(올리기 사이트)로 학생이 올린 숙제 영상의 사후 압축(원장 2026-10-16
// *"학생이 업로드하면 바로 압축하고 전송"*).
//
// 학생 폰은 원본을 Drive에 바로 올린다(최대 2GB · 브라우저는 압축하지 않는다). 발송 PC가 몇 분 안에 그 파일을 내려받아 ClassNote 영상과
// 같은 설정(video-compress.mjs — CRF 22 · 15% 이상 줄 때만)으로 줄이고, **같은 Drive 파일에 새 버전으로** 올린 뒤 원본 버전을 지운다
// (video-drive-replace.mjs). 파일 번호·폴더·링크·DB 연결이 그대로라 장부·재생·반려는 바꿀 것이 없다.
//
// 🔴 DB `md5`·`bytes`는 **원본 지문 그대로** 둔다 — 같은 영상 판정(videoFingerprint·dedupe·직접 올린 사본)이 이 값을 본다. 결과는 `route.archive`에만.
// 🔴 압축 실패·시간 초과·절감 부족·HDR은 원본 그대로 둔다(보관이 먼저). 올린 뒤 내용이 바뀐 파일·휴지통은 손대지 않는다.
//    저장 계정이 고칠 수 없는 파일(내 소유도, 편집할 수 있는 공유 드라이브 파일도 아님)은 건드리지 않고 하루 한 번까지 다시 본다.
// 🔴 잠금은 `lock_token`·`locked_at`(ClassNote 영상 작업과 같은 칸) — 그 작업은 `post_id`가 있는 줄만 집어 이 줄과 겹치지 않는다.
// 🔴 `attempts`·`status`는 건드리지 않는다(`uploaded` 그대로 — 장부·재생이 이 값을 본다). 시도 횟수는 `route.archive.attempts`.
import managedWorker from "../_sync-agent/managed-worker.cjs";
import postgres from "postgres";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readdir, statfs, unlink } from "node:fs/promises";
import { stateDir } from "./classnote-paths.mjs";
import { compressionDisabled, prepareCompressedUpload } from "./video-compress.mjs";
import { findFfmpeg } from "./video-ffmpeg.mjs";
import { loadWorkerVideoDriveSetting } from "./video-drive-settings.mjs";
import { credentialForVideoTarget } from "./video-drive-token.mjs";
import { compressClaimedLinkVideo } from "./video-link-compress-job.mjs";

/** 할 일이 없을 때 다시 보는 간격 — 학생이 올리고 몇 분 안에. 한 건을 끝내면 바로 다음 건을 본다(밀린 영상). */
export const LINK_COMPRESS_POLL_MS = 2 * 60_000;

let running = null;
let controller = null;
let nextPoll = 0;
let stopped = false;
let lastNotice = null;
/** 판정을 DB에 못 남긴 줄 → 횟수. 세 번이면 이번 실행 동안 쉰다(인코딩만 10분마다 되풀이하지 않게 · 앱을 다시 켜면 풀린다). */
const unsaved = new Map();
const UNSAVED_REST = 3;

/** 연동 앱이 끝내거나 업데이트할 때 — 돌던 인코딩·전송을 끊고(시도 횟수는 안 센다) 새 작업을 받지 않는다. */
export function stopLinkVideoCompress() {
  stopped = true;
  controller?.abort(new Error("작업 종료 요청"));
}
export async function waitForLinkCompressIdle() { if (running) await running; }

/**
 * 다음 한 건. 반환 { worked } — 한 건을 집었으면 true(성공·실패 무관).
 * 대상 = 이 지점의 `/v` 줄(`source='link'`) 중 업로드가 끝났고(`uploaded`) 저장 폴더가 찍혔고 아직 판정이 없거나 다시 할 때가 된 것 — 새것부터.
 */
export async function compressNextLinkVideo(tenant, deps) {
  const { sql } = deps;
  const nowIso = deps.now().toISOString();
  // 이번 실행 동안 쉬는 줄(판정을 세 번 못 남김)이 앞자리를 막지 않게 그만큼 더 읽는다.
  const resting = [...(deps.unsaved?.values() ?? [])].filter((n) => n >= UNSAVED_REST).length;
  const rows = await sql`select id, drive_file_id, md5, bytes, route from student_homework_videos
    where tenant_id = ${tenant} and source = 'link' and status = 'uploaded' and drive_file_id is not null and md5 is not null and bytes > 0
      and coalesce(route->>'rootId', '') <> ''
      and (route->'archive' is null or (route->'archive'->>'state' = 'retry' and route->'archive'->>'retryAt' <= ${nowIso}))
      and (lock_token is null or locked_at < now() - interval '10 minutes')
    order by uploaded_at desc nulls last, id limit ${4 + resting}`;
  for (const row of rows) {
    if (deps.signal?.aborted) break;
    if ((deps.unsaved?.get(row.id) ?? 0) >= UNSAVED_REST) continue;
    const token = deps.token();
    const [claimed] = await sql`update student_homework_videos set lock_token = ${token}, locked_at = now()
      where id = ${row.id} and tenant_id = ${tenant} and source = 'link' and status = 'uploaded'
        and (lock_token is null or locked_at < now() - interval '10 minutes')
        and (route->'archive' is null or route->'archive'->>'state' = 'retry')
      returning id, drive_file_id, md5, bytes, route`;
    if (!claimed) continue;
    const { saved } = await compressClaimedLinkVideo(tenant, claimed, token, deps);
    if (!saved) deps.unsaved?.set(row.id, (deps.unsaved.get(row.id) ?? 0) + 1);
    else deps.unsaved?.delete(row.id);
    return { worked: true };
  }
  return { worked: false };
}

async function freeBytes(dir) {
  try { const s = await statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return Infinity; }
}

/** 지난 실행이 남긴 임시 파일(`link-*` — 받던 원본·압축본·기록) — 이 폴더는 이 작업 전용이고 한 번에 한 건만 돈다. */
async function clearStaleFiles(dir) {
  let names = [];
  try { names = await readdir(dir); } catch { return; }
  for (const name of names) if (name.startsWith("link-")) await unlink(path.join(dir, name)).catch(() => {});
}

function notice(log, text) {
  if (text !== lastNotice && text) log(text);
  lastNotice = text;
}

/**
 * 발송 루프가 매 주기 부른다(기다리지 않는다). 한 번에 한 건 · ClassNote 영상 작업이 도는 동안(`busy`)은 시작하지 않는다.
 * ffmpeg가 없거나 압축이 꺼져 있으면 내려받지도 않는다(원본 그대로).
 */
export function kickLinkVideoCompress(tenant, log = console.log, options = {}) {
  if (running || stopped || Date.now() < nextPoll || options.busy?.()) return running;
  nextPoll = Date.now() + LINK_COMPRESS_POLL_MS;
  const env = options.env ?? process.env;
  const abort = new AbortController();
  controller = abort;
  running = (async () => {
    if (compressionDisabled(env)) return notice(log, "[영상 압축·/v] 꺼짐(CLASSNOTE_VIDEO_COMPRESS) — 학생이 올린 영상은 원본 그대로 둡니다.");
    if (!(await findFfmpeg({ env }))) return notice(log, "[영상 압축·/v] ffmpeg를 찾지 못해 학생이 올린 영상은 원본 그대로 둡니다.");
    const root = stateDir();
    if (!root) return notice(log, "[영상 압축·/v] 임시 저장 폴더를 열 수 없어 건너뜁니다.");
    notice(log, null);
    const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
    try {
      const setting = options.setting ?? await loadWorkerVideoDriveSetting(sql, tenant, { env });
      if (setting.error) return;
      const workDir = path.join(env.CLASSNOTE_VIDEO_OUT || path.join(root, "videos"), tenant, "link");
      await clearStaleFiles(workDir);
      const result = await compressNextLinkVideo(tenant, {
        sql, log, env, setting, signal: abort.signal, workDir, now: () => new Date(), token: randomUUID,
        fetchImpl: fetch, credentialsFor: credentialForVideoTarget, prepare: prepareCompressedUpload, freeBytes, remove: unlink, unsaved,
        // 연동 앱이 아는 작업 이름(TASK_LABELS)만 받는다 — 'video'(영상 보관)로 보고한다.
        report: (value) => managedWorker.result("video", value, "video"),
      });
      if (result.worked && !abort.signal.aborted) nextPoll = 0;
    } finally { await sql.end(); }
  })()
    .catch(() => log("[영상 압축·/v] 확인하지 못했습니다 — 다음 주기에 다시 봅니다."))
    .finally(() => { running = null; if (controller === abort) controller = null; });
  return running;
}

/** 시험 전용 — 주기·종료 상태를 되돌린다. */
export function resetLinkVideoCompress() { running = null; controller = null; nextPoll = 0; stopped = false; lastNotice = null; unsaved.clear(); }
