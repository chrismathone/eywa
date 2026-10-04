// scripts/_classnote/video-drive-settings.mjs — 워커가 읽는 지점별 숙제 영상 저장 폴더.
// 웹과 같은 두 표(homework_video_drive_settings · homework_video_drive_roots).
// 설정 행이 없거나 표가 없으면 기존 env 지점 연결을 유지한다(마이그레이션은 roots만 채운다).
// 해제 행은 루트 표가 없어도 닫는다. roots 표가 있으면 레거시는 이 지점 소유 행이 있을 때만.
// 조회 오류는 꺼짐·미설정과 구분하고 unknown 으로 남긴다(error 는 그 경우에만 붙인다).
import { isDriveFolderId } from "./video-oauth-values.mjs";

const NONE = { enabled: false, rootId: null, source: "none" };
const SAVED_OFF = { enabled: false, rootId: null, source: "saved" };
const UNKNOWN = { enabled: false, rootId: null, source: "unknown", error: true };
/** 표가 없다 — 42P01 또는 relation does not exist 만. 칸(42703)·함수(42883) 부재는 폴백이 아니다. */
const isMissingTable = (error) => error?.code === "42P01" || /relation "[^"]+" does not exist/i.test(String(error?.message ?? ""));

function envBag(options) {
  return options?.env ?? process.env;
}

function sameTenant(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}

function distinctTenants(rows) {
  return [...new Set(rows.map((row) => String(row.tenant_id ?? "")).filter(Boolean))];
}

/** 하트비트에 실을 실제 저장 루트. 꺼져 있으면 env 폴더를 적지 않는다. */
export function videoArchiveHeartbeat(setting) {
  const enabled = setting?.enabled === true && isDriveFolderId(setting.rootId);
  return { enabled, folderId: enabled ? setting.rootId : null };
}

/**
 * 이미 찍힌 route.rootId 는 그대로 끝낸다. 없는 작업만 지금 활성 루트를 쓴다.
 * 활성 루트가 없으면 새 각인을 만들지 않는다(SQL 가드가 활성 설정과 다른 첫 각인을 거절한다).
 */
export function resolveVideoJobRoot(setting, route) {
  const pinned = typeof route?.rootId === "string" && isDriveFolderId(route.rootId) ? route.rootId : null;
  if (pinned) return { kind: "pinned", rootId: pinned };
  if (setting?.enabled === true && isDriveFolderId(setting.rootId)) return { kind: "active", rootId: setting.rootId };
  return { kind: "skip", rootId: null };
}

/** 루트 표의 소유 지점. 표가 없으면 missing. 다른 오류는 던진다. */
async function rootsOwner(sql, folder) {
  try {
    const [row] = await sql`select tenant_id from homework_video_drive_roots where root_folder_id = ${folder} limit 1`;
    if (!row) return { missing: false, found: false, tenantId: "" };
    return { missing: false, found: true, tenantId: String(row.tenant_id ?? "") };
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    return { missing: true, found: false, tenantId: null };
  }
}

/** 옛 폴더 등록부의 소유 지점. 다른 지점 행이 있으면 레거시로 승격하지 않는다. */
async function registryTenants(sql, folder) {
  try {
    const rows = await sql`select distinct tenant_id from classnote_video_folders where root_folder_id = ${folder}`;
    return { missing: false, ids: distinctTenants(rows) };
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    return { missing: true, ids: null };
  }
}

/**
 * 이름(env 지점)이 맞아도 roots·등록부에 다른 지점 소유가 있으면 거절한다.
 * roots 표가 있으면 이 지점 소유 행이 있어야 레거시다. 표가 없는 옛 스키마만 이전 규칙(이름 일치 또는 등록부 유일한 소유)을 쓴다.
 * 조회 오류는 미설정으로 삼키지 않는다.
 */
async function legacyVideoDriveSetting(sql, tenant, env) {
  const folder = String(env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID ?? "").trim();
  if (!isDriveFolderId(folder)) return NONE;
  const named = String(env.CLASSNOTE_VIDEO_TENANT_ID ?? "").trim() || String(env.CLASSNOTE_TENANT_ID ?? "").trim();
  let registry;
  let roots;
  try {
    registry = await registryTenants(sql, folder);
    roots = await rootsOwner(sql, folder);
  } catch {
    return UNKNOWN;
  }
  if (!registry.missing && registry.ids.some((id) => !sameTenant(id, tenant))) return NONE;
  if (roots.missing) {
    if (registry.missing) return NONE;
    if (named) {
      if (!sameTenant(named, tenant)) return NONE;
      return { enabled: true, rootId: folder, source: "legacy" };
    }
    if (registry.ids.length === 1 && sameTenant(registry.ids[0], tenant)) {
      return { enabled: true, rootId: folder, source: "legacy" };
    }
    return NONE;
  }
  if (!roots.found || !sameTenant(roots.tenantId, tenant)) return NONE;
  if (registry.missing) return NONE;
  if (named && !sameTenant(named, tenant)) return NONE;
  return { enabled: true, rootId: folder, source: "legacy" };
}

/** @returns {{enabled:boolean, rootId:string|null, source:'saved'|'legacy'|'none'|'unknown', error?:true}} */
export async function loadWorkerVideoDriveSetting(sql, tenant, options = {}) {
  const env = envBag(options);
  let row;
  try {
    // 설정만 먼저 읽는다. roots 를 같이 묶으면 루트 표 부재가 해제 행을 지운 것처럼 보인다.
    [row] = await sql`select enabled, root_folder_id from homework_video_drive_settings where tenant_id = ${tenant}`;
  } catch (error) {
    if (!isMissingTable(error)) return UNKNOWN;
    return legacyVideoDriveSetting(sql, tenant, env);
  }
  if (!row) return legacyVideoDriveSetting(sql, tenant, env);
  if (row.enabled !== true) return SAVED_OFF;
  const rootId = typeof row.root_folder_id === "string" ? row.root_folder_id : "";
  if (!isDriveFolderId(rootId)) return SAVED_OFF;
  try {
    const roots = await rootsOwner(sql, rootId);
    if (roots.missing || !roots.found || !sameTenant(roots.tenantId, tenant)) return SAVED_OFF;
    return { enabled: true, rootId, source: "saved" };
  } catch {
    return UNKNOWN;
  }
}

/**
 * 이 지점이 그 루트를 소유하는가. 루트 표에 행이 있으면 그 지점만 본다.
 * 행이 없거나 표가 없을 때는 레거시로 올리기 전에 등록부·루트 표의 다른 지점 소유를 거절한다.
 * 소유 조회 오류는 미소유로 삼키지 않고 던진다.
 */
export async function workerVideoRootOwned(sql, tenant, rootId, options = {}) {
  if (!isDriveFolderId(rootId)) return false;
  const env = envBag(options);
  const roots = await rootsOwner(sql, rootId);
  if (!roots.missing && roots.found) return sameTenant(roots.tenantId, tenant);
  const legacy = await legacyVideoDriveSetting(sql, tenant, env);
  if (legacy.error) throw new Error("영상 저장 폴더 설정을 확인하지 못했습니다.");
  return legacy.enabled === true && legacy.rootId === rootId;
}
