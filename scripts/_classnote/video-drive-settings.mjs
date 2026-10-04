// scripts/_classnote/video-drive-settings.mjs — 워커가 읽는 지점별 숙제 영상 저장 폴더·계정.
// 스키마는 셋이다. 표 없음(42P01)은 기존 env. connection_id 칸 없음(42703)은 폴더만.
// 그 칸이 있으면 계정 규칙. 그 밖 조회 오류는 폴백하지 않는다.
import { isDriveFolderId } from "./video-oauth-values.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONE = { enabled: false, rootId: null, source: "none" };
const SAVED_OFF = { enabled: false, rootId: null, source: "saved" };
const UNKNOWN = { enabled: false, rootId: null, source: "unknown", error: true };
/** 표가 없다 — 42P01 또는 relation does not exist 만. connection_id 의 42703 은 폴더 전용 스키마다. */
const isMissingTable = (error) => error?.code === "42P01" || /relation "[^"]+" does not exist/i.test(String(error?.message ?? ""));
const folderOnlyColumn = (error) => error?.code === "42703" && /connection_id/i.test(String(error?.message ?? ""));
const uuidOrNull = (value) => (typeof value === "string" && UUID.test(value) ? value : null);

function envBag(options) {
  return options?.env ?? process.env;
}

function sameTenant(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}

function distinctTenants(rows) {
  return [...new Set(rows.map((row) => String(row.tenant_id ?? "")).filter(Boolean))];
}

function finish(setting, schema) {
  if (setting?.error) return { enabled: false, rootId: null, connectionId: null, source: "unknown", schema: "unknown", error: true };
  return { enabled: setting?.enabled === true, rootId: setting?.rootId ?? null, connectionId: setting?.connectionId ?? null, source: setting?.source ?? "none", schema };
}

/** 하트비트에 실을 실제 저장 루트. 꺼져 있으면 env 폴더·다른 계정 연결을 적지 않는다. */
export function videoArchiveHeartbeat(setting) {
  const enabled = setting?.enabled === true && isDriveFolderId(setting.rootId);
  return { enabled, folderId: enabled ? setting.rootId : null, connectionId: enabled ? (setting.connectionId ?? null) : null };
}

function routeConnection(route) {
  if (route?.connectionId == null || route.connectionId === "") return { connectionId: null, invalid: false };
  if (typeof route.connectionId === "string" && UUID.test(route.connectionId)) return { connectionId: route.connectionId, invalid: false };
  return { connectionId: null, invalid: true };
}

/**
 * 이미 찍힌 route.rootId 는 그대로 끝낸다. 없는 작업만 지금 활성 루트·연결을 함께 쓴다.
 * 활성 루트가 없으면 새 각인을 만들지 않는다.
 */
export function resolveVideoJobRoot(setting, route) {
  const pinned = typeof route?.rootId === "string" && isDriveFolderId(route.rootId) ? route.rootId : null;
  if (pinned) {
    const connection = routeConnection(route);
    return { kind: "pinned", rootId: pinned, connectionId: connection.connectionId, invalid: connection.invalid };
  }
  if (setting?.enabled === true && isDriveFolderId(setting.rootId))
    return { kind: "active", rootId: setting.rootId, connectionId: setting.connectionId ?? null, invalid: false };
  return { kind: "skip", rootId: null, connectionId: null, invalid: false };
}

/** 루트 표의 소유 지점. 표가 없으면 missing. connection_id 칸만 없으면 지점만 다시 읽는다. 다른 오류는 던진다. */
async function rootsOwner(sql, folder) {
  const absent = { missing: true, found: false, tenantId: null, connectionId: null, connectionKnown: false };
  const pack = (row, connectionKnown) => (row
    ? { missing: false, found: true, tenantId: String(row.tenant_id ?? ""), connectionId: connectionKnown ? (row.connection_id ?? null) : null, connectionKnown }
    : { missing: false, found: false, tenantId: "", connectionId: null, connectionKnown: false });
  try {
    const [row] = await sql`select tenant_id, connection_id from homework_video_drive_roots where root_folder_id = ${folder} limit 1`;
    return pack(row, !!row && Object.prototype.hasOwnProperty.call(row, "connection_id"));
  } catch (error) {
    if (isMissingTable(error)) return absent;
    if (!folderOnlyColumn(error)) throw error;
  }
  try {
    const [row] = await sql`select tenant_id from homework_video_drive_roots where root_folder_id = ${folder} limit 1`;
    return pack(row, false);
  } catch (error) {
    if (isMissingTable(error)) return absent;
    throw error;
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
    if (registry.ids.length === 1 && sameTenant(registry.ids[0], tenant)) return { enabled: true, rootId: folder, source: "legacy" };
    return NONE;
  }
  if (!roots.found || !sameTenant(roots.tenantId, tenant)) return NONE;
  if (registry.missing) return NONE;
  if (named && !sameTenant(named, tenant)) return NONE;
  return { enabled: true, rootId: folder, source: "legacy" };
}

async function probeSettingRow(sql, tenant) {
  try {
    const [row] = await sql`select enabled, root_folder_id, connection_id from homework_video_drive_settings where tenant_id = ${tenant}`;
    if (row && !Object.prototype.hasOwnProperty.call(row, "connection_id")) return { schema: "folders", row };
    return { schema: "complete", row: row ?? null };
  } catch (error) {
    if (isMissingTable(error)) return { schema: "absent" };
    if (!folderOnlyColumn(error)) return { error: true };
    try {
      const [row] = await sql`select enabled, root_folder_id from homework_video_drive_settings where tenant_id = ${tenant}`;
      return { schema: "folders", row: row ?? null };
    } catch (again) {
      if (isMissingTable(again)) return { schema: "absent" };
      return { error: true };
    }
  }
}

/** @returns {{enabled:boolean, rootId:string|null, connectionId:string|null, source:string, schema:string, error?:true}} */
export async function loadWorkerVideoDriveSetting(sql, tenant, options = {}) {
  const env = envBag(options);
  const probed = await probeSettingRow(sql, tenant);
  if (probed.error) return finish(UNKNOWN, "unknown");
  if (probed.schema === "absent") return finish(await legacyVideoDriveSetting(sql, tenant, env), "absent");
  const schema = probed.schema;
  const row = probed.row;
  if (!row) return finish(await legacyVideoDriveSetting(sql, tenant, env), schema);
  if (row.enabled !== true) return finish(SAVED_OFF, schema);
  const rootId = typeof row.root_folder_id === "string" ? row.root_folder_id : "";
  if (!isDriveFolderId(rootId)) return finish(SAVED_OFF, schema);
  const connectionId = schema === "complete" ? uuidOrNull(row.connection_id) : null;
  if (schema === "complete" && row.connection_id != null && !connectionId) return finish(UNKNOWN, "unknown");
  try {
    const roots = await rootsOwner(sql, rootId);
    if (roots.missing || !roots.found || !sameTenant(roots.tenantId, tenant)) return finish(SAVED_OFF, schema);
    if (schema === "complete" && roots.connectionKnown && (roots.connectionId ?? null) !== connectionId) return finish(SAVED_OFF, schema);
    return finish({ enabled: true, rootId, source: "saved", connectionId }, schema);
  } catch {
    return finish(UNKNOWN, "unknown");
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

/** 찍힌 연결은 그 루트의 연결과 같아야 한다. 폴더 전용 스키마는 연결 각인이 있으면 거절한다. 조회 실패는 불일치가 아니다. */
export async function workerVideoTargetMatches(sql, tenant, decision, setting, options = {}) {
  if (setting?.error || setting?.schema === "unknown") throw new Error("영상 저장 폴더 설정을 확인하지 못했습니다.");
  if (!(await workerVideoRootOwned(sql, tenant, decision.rootId, options))) return false;
  if (setting?.schema !== "complete") return !decision.connectionId;
  const roots = await rootsOwner(sql, decision.rootId);
  if (roots.missing || !roots.found || !roots.connectionKnown) return false;
  return (decision.connectionId ?? null) === (roots.connectionId ?? null);
}
