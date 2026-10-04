import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { legacyVideoDriveAuthFor, videoDriveConfigFor } from "./drive-config";
import { videoOAuthClientSecret } from "./oauth/config";

type Db = ReturnType<typeof createAdminClient>;
type DbError = { code?: string } | null;
export type VideoAccountStatus = "ready" | "needs_reauth";

/**
 * 이 지점의 숙제영상 저장 설정(화면·제출·내부 API가 같이 읽는 한 벌).
 *  · `ready` = 저장 폴더 표가 있다 · `accountReady` = **계정 연결 표까지 있다** — 이때만 계정 연결·폴더 저장을 받는다(그 전은 '준비 중').
 *  · `connectionId` = 이 지점이 고른 Google 계정 연결(없으면 null). 기존 env 연결의 저장 폴더는 연결이 없다(null 그대로).
 *  · `authReady` = 지금 저장 폴더의 자격이 쓸 수 있는 상태 — 기존 연결은 env 지점일 때만, 계정 연결은 정상 + 그 연결의 앱 설정이 있을 때만.
 */
export type VideoDriveSetting = {
  ready: boolean; accountReady: boolean; enabled: boolean; rootId: string | null; folderName: string | null;
  version: string | null; source: "saved" | "legacy" | "none"; authReady: boolean;
  connectionId: string | null; accountEmail: string | null; accountStatus: VideoAccountStatus | null; tokenVersion: number | null;
};

/** 표가 없다(0338a·계정 SQL 전). */
export function missingDriveSettingSchema(error: DbError): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}
/** 칸이 없다 — 저장 폴더 표만 있고 계정 연결 칸은 아직 없는 상태. */
const missingColumn = (error: DbError): boolean => error?.code === "42703" || error?.code === "PGRST204";
const FAILED = "영상 폴더 설정을 확인하지 못했습니다.";
const OWNER_FAILED = "영상 폴더 소유 정보를 확인하지 못했습니다.";

type SettingRow = { enabled: boolean; root_folder_id: string | null; version: string | null; connection_id?: string | null };
type Schema = { ready: boolean; accountReady: boolean };

/** 설정 행과 스키마 상태를 함께 읽는다 — 계정 칸이 없으면 칸 없이 다시 읽는다(없는 칸을 고르면 요청 전체가 실패한다). */
async function readSettingRow(db: Db, tenantId: string): Promise<{ row: SettingRow | null; schema: Schema }> {
  const full = await db.from("homework_video_drive_settings").select("enabled,root_folder_id,version,connection_id").eq("tenant_id", tenantId).maybeSingle();
  if (!full.error) return { row: (full.data as SettingRow | null) ?? null, schema: { ready: true, accountReady: true } };
  if (missingDriveSettingSchema(full.error)) return { row: null, schema: { ready: false, accountReady: false } };
  if (!missingColumn(full.error)) throw new Error(FAILED);
  const basic = await db.from("homework_video_drive_settings").select("enabled,root_folder_id,version").eq("tenant_id", tenantId).maybeSingle();
  if (basic.error) throw new Error(FAILED);
  return { row: (basic.data as SettingRow | null) ?? null, schema: { ready: true, accountReady: false } };
}

type RootRow = { tenant_id: string; folder_name: string | null; connection_id?: string | null };
/** 루트 등록 행 — 계정 스키마 전이면 연결 칸 없이 읽는다. `missing` = 표가 없다. */
async function readRoot(db: Db, rootId: string, accountReady: boolean): Promise<{ row: RootRow | null; missing: boolean }> {
  const result = await db.from("homework_video_drive_roots").select(accountReady ? "tenant_id,folder_name,connection_id" : "tenant_id,folder_name")
    .eq("root_folder_id", rootId).maybeSingle();
  if (result.error && !missingDriveSettingSchema(result.error)) throw new Error(OWNER_FAILED);
  return { row: (result.data as RootRow | null) ?? null, missing: !!result.error };
}

type Account = { email: string | null; status: VideoAccountStatus; tokenVersion: number; clientId: string };
async function readAccount(db: Db, tenantId: string, connectionId: string): Promise<Account | null> {
  const { data, error } = await db.from("homework_video_drive_connections").select("email,status,token_version,oauth_client_id")
    .eq("tenant_id", tenantId).eq("id", connectionId).maybeSingle();
  if (error) throw new Error(FAILED);
  if (!data) return null;
  return {
    email: (data.email as string | null) ?? null, status: data.status === "ready" ? "ready" : "needs_reauth",
    tokenVersion: Number(data.token_version), clientId: String(data.oauth_client_id ?? ""),
  };
}

/** 명시적으로 해제한 설정은 이전 연결로 되돌리지 않는다. 조회 장애도 미설정으로 취급하지 않는다(던진다). */
export async function getVideoDriveSetting(tenantId: string, db: Db = createAdminClient()): Promise<VideoDriveSetting> {
  const { row, schema } = await readSettingRow(db, tenantId);
  const base: VideoDriveSetting = {
    ...schema, enabled: false, rootId: null, folderName: null, version: null, source: "none", authReady: false,
    connectionId: null, accountEmail: null, accountStatus: null, tokenVersion: null,
  };
  if (row) {
    const connectionId = schema.accountReady ? row.connection_id ?? null : null;
    const account = connectionId ? await readAccount(db, tenantId, connectionId) : null;
    // 고른 계정을 지금 쓸 수 있나 — 폴더를 아직 안 정했어도(폴더 확인에 이 자격을 쓴다) 정상 + 그 연결을 발급한 앱의 설정이 서버에 있을 때만.
    const accountAuth = !!account && account.status === "ready" && !!videoOAuthClientSecret(account.clientId);
    const saved: VideoDriveSetting = {
      ...base, source: "saved", version: row.version ?? null, connectionId: account ? connectionId : null, authReady: accountAuth,
      accountEmail: account?.email ?? null, accountStatus: account?.status ?? null, tokenVersion: account?.tokenVersion ?? null,
    };
    // 고른 연결이 사라졌으면(있을 수 없는 상태) 받지 않는다 — 다른 자격으로 넘어가지 않는다.
    if (!row.enabled || !row.root_folder_id || (connectionId && !account)) return saved;
    const root = await readRoot(db, row.root_folder_id, schema.accountReady);
    // 저장 폴더는 이 지점 것이고, 그 폴더에 묶인 연결이 지금 고른 연결과 같아야 한다(기존 연결의 폴더는 둘 다 없음).
    if (root.row?.tenant_id !== tenantId || (root.row.connection_id ?? null) !== connectionId) return saved;
    const authReady = account ? accountAuth : !!legacyVideoDriveAuthFor(tenantId);
    return { ...saved, enabled: true, rootId: row.root_folder_id, folderName: root.row.folder_name || null, authReady };
  }
  const legacy = videoDriveConfigFor(tenantId);
  if (!legacy) return base;
  const owner = await readRoot(db, legacy.rootId, schema.accountReady);
  if (!owner.missing && !owner.row) return base;
  // 계정을 연결한 폴더는 기존 연결로 쓰지 않는다.
  if (owner.row && (owner.row.tenant_id !== tenantId || (owner.row.connection_id ?? null) !== null)) return base;
  // 구 스키마에도 등록부의 다른 지점 소유를 무시하지 않는다.
  const other = await db.from("classnote_video_folders").select("tenant_id").eq("root_folder_id", legacy.rootId).neq("tenant_id", tenantId).limit(1);
  if (other.error) throw new Error(OWNER_FAILED);
  if (other.data?.length) return base;
  return { ...base, enabled: true, rootId: legacy.rootId, folderName: owner.row?.folder_name || null, source: "legacy", authReady: true };
}

/**
 * 계정 스키마 **전**의 소유 판정 — 시작한 업로드는 해제·폴더 변경 이후에도 지점이 소유한 원래 폴더에서 완료한다.
 * 계정 스키마가 있으면 이 함수가 아니라 자격 조회([`drive-credentials.ts`](./drive-credentials.ts))가 지점·폴더·연결을 함께 본다.
 */
export async function videoDriveOwnsRoot(tenantId: string, rootId: string, db: Db): Promise<boolean> {
  const result = await db.from("homework_video_drive_roots").select("tenant_id").eq("root_folder_id", rootId).maybeSingle();
  if (result.error && !missingDriveSettingSchema(result.error)) throw new Error(OWNER_FAILED);
  if (result.data) return result.data.tenant_id === tenantId;
  if (!result.error) return false;
  const legacy = videoDriveConfigFor(tenantId);
  if (legacy?.rootId !== rootId) return false;
  const registry = await db.from("classnote_video_folders").select("tenant_id").eq("root_folder_id", rootId).neq("tenant_id", tenantId).limit(1);
  if (registry.error) throw new Error(OWNER_FAILED);
  return !registry.data?.length;
}
