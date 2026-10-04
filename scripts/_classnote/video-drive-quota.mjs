// scripts/_classnote/video-drive-quota.mjs — Drive 남은 공간 감시(원장 2026-10-01).
// 계정마다 따로 본다. 연결 없는 기존 계정은 20GB(또는 CLASSNOTE_VIDEO_DRIVE_MIN_FREE_GB).
// 새 계정은 한도가 있으면 min(1GB, 한도의 10%). CLASSNOTE_VIDEO_DRIVE_ACCOUNT_MIN_FREE_GB 가 있으면 그 값을 그대로 쓴다.
// 한도가 없으면 멈추지 않는다. 멈춘 계정은 새 작업만 미루고, 이미 찍힌 작업은 워커가 이어서 올린다.
import { DRIVE_API, driveClient, driveJson } from "./video-drive-http.mjs";
import { compressionStatus } from "./video-compress.mjs";

const GB = 1024 ** 3;
export const DEFAULT_MIN_FREE_BYTES = 20 * GB;
const NEW_ACCOUNT_FLOOR = 1 * GB;
const HOUR = 60 * 60_000;
const NEAR = 5 * 60_000;
const empty = () => ({ checkedAt: 0, limitBytes: null, usageBytes: null, freeBytes: null, paused: false, error: false, shared: false, minFreeBytes: null });
const records = new Map();
let lastKey = "legacy";

export function minFreeBytes(env = process.env) {
  const gb = Number(env.CLASSNOTE_VIDEO_DRIVE_MIN_FREE_GB);
  return Number.isFinite(gb) && gb > 0 ? gb * GB : DEFAULT_MIN_FREE_BYTES;
}

/** 새 계정의 명시 문턱. 비어 있으면 null(기본식). 0 이상이면 줄이지 않고 그대로 쓴다. */
export function explicitAccountMinBytes(env = process.env) {
  const raw = env.CLASSNOTE_VIDEO_DRIVE_ACCOUNT_MIN_FREE_GB;
  if (raw == null || String(raw).trim() === "") return null;
  const gb = Number(raw);
  return Number.isFinite(gb) && gb >= 0 ? gb * GB : null;
}

export function accountMinFreeBytes({ legacy, limitBytes, explicitBytes }) {
  if (legacy) return explicitBytes != null && explicitBytes > 0 ? explicitBytes : DEFAULT_MIN_FREE_BYTES;
  if (explicitBytes != null && explicitBytes >= 0) return explicitBytes;
  if (limitBytes == null) return null;
  return Math.min(NEW_ACCOUNT_FLOOR, limitBytes * 0.1);
}

export const formatGB = (bytes) => `${(bytes / GB).toFixed(bytes >= 100 * GB ? 0 : 1)}GB`;

export function quotaRecordKey(credentials) {
  if (credentials?.kind === "service-account") return "service-account";
  if (credentials?.kind === "tenant-oauth" && credentials.connectionId)
    return `${credentials.connectionId}:${credentials.tokenVersion ?? 0}`;
  return "legacy";
}

/** 하트비트가 읽을 열쇠. 그 연결을 한 번도 안 봤으면 버전 0 열쇠(빈 판정)다. */
export function videoStorageKeyFor(setting) {
  if (!setting?.connectionId) return "legacy";
  const prefix = `${setting.connectionId}:`;
  let found = null;
  for (const [key, row] of records) {
    if (key.startsWith(prefix) && (!found || row.checkedAt >= found.row.checkedAt)) found = { key, row };
  }
  return found?.key ?? `${setting.connectionId}:0`;
}

/** true = 이 계정의 새 작업을 집지 않는다. 열쇠는 연결 ID + tokenVersion 이다. */
export async function driveQuotaPaused(credentials, { log = console.log, env = process.env, now = Date.now, fetchImpl, key } = {}) {
  const recordKey = key ?? quotaRecordKey(credentials);
  lastKey = recordKey;
  const legacy = recordKey === "legacy";
  let quota = records.get(recordKey) ?? empty();
  if (credentials?.kind === "service-account") {
    records.set(recordKey, { ...empty(), shared: true, minFreeBytes: minFreeBytes(env) });
    return false;
  }
  const provisional = quota.minFreeBytes ?? (legacy ? minFreeBytes(env) : explicitAccountMinBytes(env) ?? NEW_ACCOUNT_FLOOR);
  const near = quota.error || (quota.freeBytes !== null && provisional != null && quota.freeBytes < 2 * provisional);
  if (quota.checkedAt && now() - quota.checkedAt < (near ? NEAR : HOUR)) return quota.paused;
  const wasPaused = quota.paused;
  const wasError = quota.error;
  let min = legacy ? minFreeBytes(env) : explicitAccountMinBytes(env);
  try {
    const request = driveClient({ accessToken: credentials.accessToken, fetchImpl });
    const about = await driveJson(await request(`${DRIVE_API}/about?fields=storageQuota(limit,usage)`), "Drive 용량 조회");
    const limit = about?.storageQuota?.limit === undefined ? null : Number(about.storageQuota.limit);
    const usage = Number(about?.storageQuota?.usage);
    if (limit !== null && !(Number.isFinite(limit) && Number.isFinite(usage))) throw new Error("Drive 용량 응답이 올바르지 않습니다.");
    const free = limit === null ? null : Math.max(0, limit - usage);
    min = accountMinFreeBytes({ legacy, limitBytes: limit, explicitBytes: legacy ? minFreeBytes(env) : explicitAccountMinBytes(env) });
    quota = { ...empty(), checkedAt: now(), limitBytes: limit, usageBytes: Number.isFinite(usage) ? usage : null, freeBytes: free,
      minFreeBytes: min, paused: min != null && free !== null && free < min };
  } catch {
    quota = { ...quota, checkedAt: now(), error: true, minFreeBytes: quota.minFreeBytes ?? min };
    if (!wasError) log("[영상] Drive 남은 공간을 확인하지 못했습니다 — 직전 판정대로 계속하고 5분 뒤 다시 확인합니다.");
  }
  records.set(recordKey, quota);
  if (quota.paused && !wasPaused && quota.freeBytes != null && min != null)
    log(`[영상] ⚠ Drive 남은 공간 ${formatGB(quota.freeBytes)} — ${formatGB(min)} 아래라 영상 업로드를 멈춥니다. 대기 영상은 그대로 두고, 공간이 생기면 자동으로 이어 올립니다.`);
  if (!quota.paused && wasPaused) log(`[영상] Drive 남은 공간 ${formatGB(quota.freeBytes ?? 0)} — 영상 업로드를 다시 시작합니다.`);
  return quota.paused;
}

export function resetDriveQuota() { records.clear(); lastKey = "legacy"; }

/** 하트비트 `last_results.videoStorage`. 숫자는 그 열쇠에 실제로 쓴 문턱이다. */
export function videoStorageStatus(env = process.env, key = lastKey) {
  const quota = records.get(key) ?? empty();
  const legacy = key === "legacy" || key === "service-account";
  return {
    v: 1,
    checkedAt: quota.checkedAt ? new Date(quota.checkedAt).toISOString() : null,
    freeBytes: quota.freeBytes, limitBytes: quota.limitBytes,
    minFreeBytes: quota.minFreeBytes != null ? quota.minFreeBytes : (legacy ? minFreeBytes(env) : null),
    paused: quota.paused, quotaError: quota.error, sharedDrive: quota.shared,
    ...compressionStatus(),
  };
}
