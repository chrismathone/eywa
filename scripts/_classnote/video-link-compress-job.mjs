// scripts/_classnote/video-link-compress-job.mjs — `/v` 영상 한 건의 사후 압축(잠근 뒤부터 판정 기록까지). 배경·규칙은 video-link-compress.mjs.
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { removeArchiveLeftovers } from "./video-compress.mjs";
import { driveClient } from "./video-drive-http.mjs";
import { deleteOldRevisions, downloadDriveVideo, driveFreeBytes, patchDriveProperties, readDriveVideo, replaceDriveVideoContent } from "./video-drive-replace.mjs";
import { resolveVideoJobRoot, workerVideoTargetMatches } from "./video-drive-settings.mjs";
import { rejectCachedTenantToken } from "./video-drive-token.mjs";
import { failureOutcome, judgeLinkVideo, LINK_COMPRESS_MAX_ATTEMPTS, mp4Name } from "./video-link-compress-rules.mjs";

// 판정 규칙(순수 함수)은 rules 모듈 — 부르는 쪽·시험은 이 파일에서 그대로 가져간다.
export { failureOutcome, judgeLinkVideo, LINK_COMPRESS_MAX_ATTEMPTS, mp4Name };

/** 하트비트가 이만큼 잇달아 실패해야 잠금을 잃은 것으로 본다(한 번의 일시 오류로 60분 인코딩을 버리지 않게). */
const HEARTBEAT_FAILS = 3;
/** 압축본은 원본의 85% 이하일 때만 나온다(15% 이상 줄 때만 — video-compress.mjs) — Drive에 그만큼 자리가 있어야 교체할 수 있다. */
const MAX_UPLOAD_RATIO = 0.85;
/** 내려받은 원본 + 압축본 + 여유 — 발송 PC 디스크를 가득 채우지 않게. */
const DISK_MARGIN = 2 * 1024 ** 3;
const SKIP_LABEL = {
  gone: "Drive에서 지워졌거나 휴지통에 있는 파일", changed: "올린 뒤 내용이 바뀐 파일",
  "not-video": "영상 형식이 아닌 파일", route: "저장 연결 기록이 올바르지 않은 줄",
};
const mb = (n) => `${(Number(n) / 1048576).toFixed(1)}MB`;
const later = (reason) => Object.assign(new Error(reason), { later: true });

/**
 * 하트비트로 잠금을 늘린다 — 줄이 없으면(남이 가져감) 잃은 것, 오류는 잇달아 `HEARTBEAT_FAILS`번이어야 잃은 것.
 * 늘리기에 성공하면 잃은 것으로 봤던 판정도 되돌린다 — 토큰이 맞았다는 것은 아무도 가져가지 않았다는 뜻이다
 * (0행으로 잃은 것은 토큰이 이미 바뀌어 다시 맞을 수 없다). 시험에서도 부른다.
 */
export async function extendLease(sql, tenant, row, token, track) {
  try {
    const rows = await sql`update student_homework_videos set locked_at = now()
      where id = ${row.id} and tenant_id = ${tenant} and lock_token = ${token} returning id`;
    track.heartbeatFails = 0;
    track.leaseLost = rows.length === 0;
    return rows.length > 0;
  } catch {
    if (++track.heartbeatFails >= HEARTBEAT_FAILS) track.leaseLost = true;
    return false;
  }
}

async function decide(tenant, row, token, deps, track) {
  const { sql, env, setting, signal, log } = deps;
  const bytes = Number(row.bytes);
  // 임시 파일 자리를 먼저 적어 둔다 — 어느 길로 끝나든 finally가 지난번에 남은 것까지 치운다.
  const filePath = path.join(deps.workDir, `link-${row.id}.mp4`);
  track.files.push(filePath);
  const decision = resolveVideoJobRoot(setting, row.route);
  if (decision.kind !== "pinned" || decision.invalid) return { state: "skipped", reason: "route" };
  const matched = await workerVideoTargetMatches(sql, tenant, decision, setting, { env }).catch(() => false);
  if (!matched) throw later("저장 폴더·계정 연결을 확인하지 못했습니다.");
  let credentials;
  try {
    credentials = await deps.credentialsFor({ tenantId: tenant, rootId: decision.rootId, connectionId: decision.connectionId, schema: setting.schema }, { env, sql });
    await credentials.accessToken();
  } catch { throw later("Drive 인증을 확인하지 못했습니다."); }
  track.credentials = credentials;
  const request = driveClient({ fetchImpl: deps.fetchImpl, accessToken: async () => {
    if (track.leaseLost) throw later("영상 작업 잠금을 잃었습니다.");
    // 긴 작업 중 토큰 갱신 실패도 PC·인증 사정이라 세지 않는다.
    try { return await credentials.accessToken(); } catch { throw later("Drive 인증을 다시 확인하지 못했습니다."); }
  } });
  signal?.throwIfAborted();
  const meta = await readDriveVideo(request, row.drive_file_id);
  const judged = judgeLinkVideo(meta, row);
  if (judged.skip) return { state: "skipped", reason: judged.skip };
  if (judged.wait) throw later("보관 계정이 고칠 수 없는 파일입니다(소유자·편집 권한 · 저장 계정 연결 확인).");
  if (judged.recovered) {
    if (judged.recovered.startsWith("kept-")) return { state: "kept", compression: judged.recovered, driveBytes: bytes };
    const oldRevision = await deleteOldRevisions(request, row.drive_file_id, { headRevisionId: meta.headRevisionId, md5: row.md5 }).catch(() => "left");
    return { state: "done", compression: judged.recovered, driveBytes: Number(meta.size), oldRevision };
  }
  await mkdir(deps.workDir, { recursive: true });
  if ((await deps.freeBytes(deps.workDir)) < bytes * 2 + DISK_MARGIN) throw later("발송 PC 디스크 공간이 부족합니다.");
  // 압축본(최대 원본의 85%)이 들어갈 자리가 Drive에 없으면 받지도 않는다 — 조회 실패는 막지 않는다(교체 403이 다시 거른다).
  // 공유 드라이브 파일은 계정 개인 용량을 쓰지 않으므로 보지 않는다(이 조회는 계정 개인 용량이다).
  const driveFree = meta.driveId ? null : await driveFreeBytes(request).catch(() => null);
  if (driveFree !== null && driveFree < Math.ceil(bytes * MAX_UPLOAD_RATIO)) throw later("Drive 남은 공간이 부족해 압축본을 올릴 자리가 없습니다.");
  const local = await downloadDriveVideo(request, row.drive_file_id, bytes, filePath, { signal, sleep: deps.sleep });
  if (local.md5 !== row.md5) throw new Error("내려받은 영상이 원본 해시와 다릅니다.");
  const prepared = await deps.prepare(local, { log, env, signal });
  signal?.throwIfAborted();
  if (!prepared) throw new Error("압축하지 못했습니다(원본 그대로).");
  const stamp = (upload) => ({ aywaCompressed: prepared.marker, aywaSourceMd5: row.md5, aywaSourceBytes: String(bytes),
    aywaUploadMd5: upload.md5, aywaUploadBytes: String(upload.bytes) });
  if (!prepared.filePath) {
    // 판단만 했다(이미 충분히 압축됨·절감 부족·HDR) — 표식만 남긴다(새 버전이 생기지 않는다). 판정 기록을 잃어도 다시 받지 않게.
    await patchDriveProperties(request, row.drive_file_id, stamp({ md5: row.md5, bytes }));
    return { state: "kept", compression: prepared.marker, driveBytes: bytes };
  }
  // 긴 인코딩 뒤 — 잠금이 아직 내 것인지 DB로 확인하고 늘린다(남이 가져갔으면 교체하지 않는다 · 시도로 세지 않는다).
  if (!(await extendLease(sql, tenant, row, token, track))) throw later("영상 작업 잠금을 확인하지 못했습니다.");
  // 받고 줄이는 사이 사람이 바꾸거나 반려(휴지통)했으면 덮어쓰지 않는다.
  const before = await readDriveVideo(request, row.drive_file_id);
  if (!before || before.trashed || before.md5Checksum !== meta.md5Checksum || before.headRevisionId !== meta.headRevisionId)
    return { state: "skipped", reason: !before || before.trashed ? "gone" : "changed" };
  const after = await replaceDriveVideoContent(request, row.drive_file_id, prepared,
    { name: mp4Name(meta.name), properties: stamp(prepared), signal, sleep: deps.sleep });
  if (after.trashed) return { state: "skipped", reason: "gone" };
  // Drive가 해시를 늦게 채우는 때가 있다 — 세지 않고 다음에 다시 본다(그때 표식으로 이어 간다: recovered).
  if (after.md5Checksum !== prepared.md5 || Number(after.size) !== prepared.bytes)
    throw later("교체한 Drive 영상의 해시·크기를 아직 확인하지 못했습니다.");
  const oldRevision = await deleteOldRevisions(request, row.drive_file_id, { headRevisionId: after.headRevisionId, md5: row.md5 }).catch(() => "left");
  return { state: "done", compression: prepared.marker, driveBytes: prepared.bytes, oldRevision };
}

/** 판정을 `route.archive`에 덧붙이고 잠금을 푼다 — route의 다른 칸(반·숙제일·저장 폴더)은 그대로(가드 0342a도 그대로 통과). */
async function record(sql, tenant, row, token, outcome, now) {
  const archive = { ...outcome, compression: outcome.compression ?? null, sourceBytes: Number(row.bytes), at: now.toISOString() };
  const rows = await sql`update student_homework_videos set lock_token = null, locked_at = null,
      route = coalesce(route, '{}'::jsonb) || jsonb_build_object('archive', ${sql.json(archive)}::jsonb)
    where id = ${row.id} and tenant_id = ${tenant} and lock_token = ${token} returning id`;
  return rows.length > 0;
}

/**
 * 기록은 일시 오류에 두 번 더 해 본다. 반환 "saved" · "lost"(잠금이 내 것이 아니다 — 다른 실행이 맡았다) · "error"(못 남김 — 잠금이 남아
 * 10분 뒤 다시 집히므로 부르는 쪽이 세어 세 번이면 이번 실행 동안 그 줄을 쉰다).
 */
async function recordWithRetry(sql, tenant, row, token, outcome, now, wait) {
  for (let i = 0; ; i++) {
    try { return (await record(sql, tenant, row, token, outcome, now)) ? "saved" : "lost"; }
    catch { if (i >= 2) return "error"; await wait(1000 * 3 ** i); }
  }
}

/** 잠근 한 건 — 끝까지(판정 기록 · 잠금 해제 · 임시 파일 정리). 던지지 않는다. 반환 { saved } = 판정을 DB에 남겼나. */
export async function compressClaimedLinkVideo(tenant, row, token, deps) {
  const { sql, log, signal } = deps;
  const track = { files: [], leaseLost: false, heartbeatFails: 0, credentials: null };
  const timer = setInterval(() => { void extendLease(sql, tenant, row, token, track); }, 30_000);
  timer.unref?.();
  try {
    let outcome;
    try { outcome = await decide(tenant, row, token, deps, track); }
    catch (error) {
      if (signal?.aborted) {
        // 끝내는 중 — 시도로 세지 않고 잠금만 푼다(다음 실행이 처음부터).
        await sql`update student_homework_videos set lock_token = null, locked_at = null
          where id = ${row.id} and tenant_id = ${tenant} and lock_token = ${token}`.catch(() => {});
        return { saved: true };
      }
      if (/HTTP 401\b/.test(String(error?.message ?? "")) && track.credentials)
        rejectCachedTenantToken(track.credentials.connectionId, track.credentials.tokenVersion);
      outcome = failureOutcome(row, error, deps.now());
    }
    const recorded = await recordWithRetry(sql, tenant, row, token, outcome, deps.now(), deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))));
    if (recorded === "lost") log("[영상 압축·/v] 작업 잠금이 다른 실행으로 넘어가 이번 판정은 남기지 않았습니다.");
    else if (recorded === "error")
      log("[영상 압축·/v] 판정을 기록하지 못했습니다 — 10분 뒤 다시 하고, 세 번 잇달아 못 남기면 연동 앱을 다시 켤 때까지 쉽니다.");
    // 센 실패(그만둠 · 횟수가 오른 다시 하기)만 실패로 보고하고 횟수를 적는다 — PC·설정 사정(`waits`)은 세지 않았다.
    const counted = outcome.state === "failed" || (outcome.state === "retry" && outcome.waits === undefined);
    if (outcome.state === "done") {
      log(`[영상 압축·/v] 학생이 올린 영상 ${mb(row.bytes)} → ${mb(outcome.driveBytes)} · Drive 교체 완료`
        + (outcome.oldRevision === "left" ? "(원본 버전은 Drive가 30일 뒤 정리)" : ""));
      deps.report?.({ processed: 1 });
    } else if (outcome.state === "skipped") log(`[영상 압축·/v] 건너뜀 — ${SKIP_LABEL[outcome.reason] ?? "확인 필요"}`);
    else if (outcome.state === "retry" || outcome.state === "failed") {
      log(`[영상 압축·/v] ${outcome.state === "failed" ? "그만둠(원본 그대로)" : "다음에 다시"} — ${outcome.reason}`
        + (counted ? ` (${outcome.attempts}/${LINK_COMPRESS_MAX_ATTEMPTS})` : ""));
      if (counted) deps.report?.({ ok: false });
    }
    return { saved: recorded !== "error" };
  } finally {
    clearInterval(timer);
    for (const file of track.files) {
      await deps.remove(file).catch(() => {});
      await removeArchiveLeftovers(file);
    }
  }
}
