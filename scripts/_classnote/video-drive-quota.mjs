// scripts/_classnote/video-drive-quota.mjs — Drive 남은 공간 감시(원장 2026-10-01 *"최대 용량을 계속 올리다간 용량이 남아나지 않을 듯"*).
//
// 영상을 올리는 계정(원장 개인 Drive OAuth)의 남은 공간이 문턱 아래면 **새 작업을 집지 않는다** — 큐는 그대로 대기하고,
// 공간이 생기면 다음 확인에서 저절로 이어 올린다. 문턱 기본 20GB(근거: video-archive-guide.md '압축' 절),
// 바꾸려면 발송 PC `.env.local`의 CLASSNOTE_VIDEO_DRIVE_MIN_FREE_GB.
// 확인 주기: 평소 1시간, 남은 공간이 문턱의 2배 아래면 5분(넘치기 전에 멈추도록).
// 조회가 실패하면 **직전 판정을 유지**한다(막지도 풀지도 않음) — 공간이 정말 차면 업로드 자체가 실패해 재시도 대기로 간다.
import { DRIVE_API, driveClient, driveJson } from "./video-drive-http.mjs";
import { compressionStatus } from "./video-compress.mjs";

const GB = 1024 ** 3; // Drive 화면의 'GB'와 같은 단위(15GB = 16,106,127,360바이트)
export const DEFAULT_MIN_FREE_BYTES = 20 * GB;
const HOUR = 60 * 60_000;
const NEAR = 5 * 60_000;
const empty = () => ({ checkedAt: 0, limitBytes: null, usageBytes: null, freeBytes: null, paused: false, error: false, shared: false });
let quota = empty();

export function minFreeBytes(env = process.env) {
  const gb = Number(env.CLASSNOTE_VIDEO_DRIVE_MIN_FREE_GB);
  return Number.isFinite(gb) && gb > 0 ? gb * GB : DEFAULT_MIN_FREE_BYTES;
}

export const formatGB = (bytes) => `${(bytes / GB).toFixed(bytes >= 100 * GB ? 0 : 1)}GB`;

/** true = 지금은 영상 작업을 집지 않는다. 워커가 작업을 선점하기 **전에** 부른다. */
export async function driveQuotaPaused(credentials, { log = console.log, env = process.env, now = Date.now, fetchImpl } = {}) {
  // 서비스계정은 Workspace 공유 드라이브에 올린다 — 공유 드라이브 용량은 이 계정의 storageQuota가 아니다.
  if (credentials?.kind === "service-account") { quota = { ...empty(), shared: true }; return false; }
  const min = minFreeBytes(env);
  const near = quota.error || (quota.freeBytes !== null && quota.freeBytes < 2 * min);
  if (quota.checkedAt && now() - quota.checkedAt < (near ? NEAR : HOUR)) return quota.paused;
  const wasPaused = quota.paused;
  const wasError = quota.error;
  try {
    const request = driveClient({ accessToken: credentials.accessToken, fetchImpl });
    const about = await driveJson(await request(`${DRIVE_API}/about?fields=storageQuota(limit,usage)`), "Drive 용량 조회");
    const limit = about?.storageQuota?.limit === undefined ? null : Number(about.storageQuota.limit);
    const usage = Number(about?.storageQuota?.usage);
    if (limit !== null && !(Number.isFinite(limit) && Number.isFinite(usage))) throw new Error("Drive 용량 응답이 올바르지 않습니다.");
    const free = limit === null ? null : Math.max(0, limit - usage); // limit 없음 = 무제한 계정
    quota = { ...empty(), checkedAt: now(), limitBytes: limit, usageBytes: Number.isFinite(usage) ? usage : null, freeBytes: free, paused: free !== null && free < min };
  } catch {
    quota = { ...quota, checkedAt: now(), error: true };
    if (!wasError) log("[영상] Drive 남은 공간을 확인하지 못했습니다 — 직전 판정대로 계속하고 5분 뒤 다시 확인합니다.");
  }
  if (quota.paused && !wasPaused)
    log(`[영상] ⚠ Drive 남은 공간 ${formatGB(quota.freeBytes)} — ${formatGB(min)} 아래라 영상 업로드를 멈춥니다. 대기 영상은 그대로 두고, 공간이 생기면 자동으로 이어 올립니다.`);
  if (!quota.paused && wasPaused) log(`[영상] Drive 남은 공간 ${formatGB(quota.freeBytes ?? 0)} — 영상 업로드를 다시 시작합니다.`);
  return quota.paused;
}

/** 시험용 — 기억한 용량 판정을 비운다. */
export function resetDriveQuota() { quota = empty(); }

/**
 * 하트비트 `last_results.videoStorage`(앱 '발송 큐 현황'의 '영상 보관' 줄이 읽는다, worker-results.ts).
 * 숫자·짧은 상태값만 싣는다(파일명·학생 정보 없음). 용량을 한 번도 안 봤으면(대기 영상이 없었음) checkedAt이 null.
 */
export function videoStorageStatus(env = process.env) {
  return {
    v: 1,
    checkedAt: quota.checkedAt ? new Date(quota.checkedAt).toISOString() : null,
    freeBytes: quota.freeBytes, limitBytes: quota.limitBytes, minFreeBytes: minFreeBytes(env),
    paused: quota.paused, quotaError: quota.error, sharedDrive: quota.shared,
    ...compressionStatus(),
  };
}
