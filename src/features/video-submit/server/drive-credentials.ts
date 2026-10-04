import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { legacyVideoDriveAuthFor, type VideoDriveConfig } from "./drive-config";
import { getVideoDriveSetting, videoDriveOwnsRoot } from "./drive-settings";
import { forgetConnectionToken, mintConnectionAccessToken, VideoDriveReauthError, type MintedToken } from "./drive-token";
import { videoOAuthClientSecret } from "./oauth/config";

type Db = ReturnType<typeof createAdminClient>;

/**
 * 숙제영상 Drive **자격의 단일 진입점** — 어느 계정의 토큰으로 Drive를 부를지는 여기서만 정한다.
 *
 * 🔑 자격은 `(지점, 저장 폴더, 연결)` 세 값이 **정확히 맞을 때만** 나온다(DB가 확인한다). 연결이 없는(null) 기존 폴더는 env의 기존 연결만,
 *    계정을 연결한 폴더는 그 연결의 토큰만 쓴다.
 * 🔴 **다른 자격으로 넘어가지 않는다** — 연결 자격을 못 찾았다고 기존 env 연결을 쓰지 않고, 지금 고른 계정으로 옛 작업을 끝내지도 않는다.
 * 🔴 갱신 토큰·비밀·접근 토큰을 반환 객체의 직렬화 가능한 칸에 두지 않는다(함수로만 꺼낸다).
 */
export type VideoDriveCredential = {
  kind: "legacy" | "tenant-oauth";
  connectionId: string | null;
  tokenVersion: number | null;
  status: "ready" | "needs_reauth";
  accessToken: () => Promise<string>;
  /** 접근 토큰 + 만료 시각(계정 연결만) — 발송 PC에 실제 남은 수명을 알려 줄 때 쓴다. */
  mint: (minRemainingMs?: number) => Promise<MintedToken>;
};
/** `mismatch` = 세 값이 안 맞거나 그 지점 것이 아니다 · `client` = 그 연결을 발급한 앱의 설정이 서버에 없다(갱신할 수 없다). */
export type CredentialLookup = { ok: true; credential: VideoDriveCredential } | { ok: false; reason: "mismatch" | "client" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKUP_FAILED = "영상 저장 연결을 확인하지 못했습니다.";
/** 계정 연결 함수가 아직 없다(계정 SQL 전) — 이때만 옛 소유 판정으로 기존 연결을 확인한다. 그 밖의 오류는 던진다. */
const missingAccountRpc = (error: { code?: string } | null): boolean => error?.code === "PGRST202" || error?.code === "42883";
const MISMATCH: CredentialLookup = { ok: false, reason: "mismatch" };

function legacyCredential(tenantId: string): CredentialLookup {
  const auth = legacyVideoDriveAuthFor(tenantId);
  if (!auth) return MISMATCH;
  const mint = async (): Promise<MintedToken> => { throw new Error("기존 연결은 서버가 토큰을 나눠 주지 않습니다."); };
  return { ok: true, credential: { kind: "legacy", connectionId: null, tokenVersion: null, status: "ready", accessToken: auth.accessToken, mint } };
}

type ConnectionRow = { connectionId?: unknown; oauthClientId?: unknown; refreshToken?: unknown; tokenVersion?: unknown; status?: unknown; legacy?: unknown };

function oauthCredential(db: Db, tenantId: string, row: ConnectionRow, expected: string): CredentialLookup {
  const connectionId = typeof row.connectionId === "string" ? row.connectionId : "";
  const tokenVersion = Number(row.tokenVersion);
  const refreshToken = typeof row.refreshToken === "string" ? row.refreshToken : "";
  if (connectionId !== expected || !Number.isInteger(tokenVersion) || tokenVersion < 1 || !refreshToken) return MISMATCH;
  const clientId = typeof row.oauthClientId === "string" ? row.oauthClientId : "";
  const clientSecret = videoOAuthClientSecret(clientId);
  if (!clientSecret) return { ok: false, reason: "client" };
  const mint = async (minRemainingMs?: number): Promise<MintedToken> => {
    try {
      return await mintConnectionAccessToken({ connectionId, tokenVersion, clientId, clientSecret, refreshToken, minRemainingMs });
    } catch (error) {
      if (error instanceof VideoDriveReauthError) {
        forgetConnectionToken(connectionId);
        // 같은 토큰 번호일 때만 표시한다(그사이 다시 연결했으면 건드리지 않는다). 표시 실패는 삼킨다 — 다음 요청이 다시 표시한다.
        await Promise.resolve(db.rpc("mark_homework_video_drive_needs_reauth", { p_tenant: tenantId, p_connection: connectionId, p_token_version: tokenVersion }))
          .catch(() => null);
      }
      throw error;
    }
  };
  return {
    ok: true,
    credential: {
      kind: "tenant-oauth", connectionId, tokenVersion, status: row.status === "ready" ? "ready" : "needs_reauth",
      accessToken: async () => (await mint()).accessToken, mint,
    },
  };
}

/**
 * **각인된 `(저장 폴더, 연결)`의 자격** — 이미 시작한 업로드·옛 작업을 끝낼 때, 그리고 새 업로드를 열 때 모두 이 함수로 확인한다.
 * `connectionId`가 null이면 연결이 없는 기존 폴더만 맞는다. 해제하거나 계정을 바꾼 뒤에도 각인된 쌍의 자격은 그대로 나온다.
 */
export async function lookupPinnedVideoDriveCredential(db: Db, tenantId: string, rootId: string, connectionId: string | null): Promise<CredentialLookup> {
  if (connectionId !== null && !UUID_RE.test(connectionId)) return MISMATCH;
  const { data, error } = await db.rpc("read_homework_video_drive_credential", { p_tenant: tenantId, p_root: rootId, p_connection: connectionId });
  if (error) {
    if (!missingAccountRpc(error)) throw new Error(LOOKUP_FAILED);
    // 계정 스키마 전 — 연결 각인은 있을 수 없다. 기존 폴더만 옛 소유 판정으로 확인한다.
    if (connectionId !== null) return MISMATCH;
    return (await videoDriveOwnsRoot(tenantId, rootId, db)) ? legacyCredential(tenantId) : MISMATCH;
  }
  const row = data as ConnectionRow | null;
  if (!row || typeof row !== "object") return MISMATCH;
  // 🔴 연결 자격을 기존 연결로, 기존 연결을 연결 자격으로 읽지 않는다.
  if (row.legacy === true) return connectionId === null ? legacyCredential(tenantId) : MISMATCH;
  return connectionId === null ? MISMATCH : oauthCredential(db, tenantId, row, connectionId);
}

export async function readPinnedVideoDriveCredential(db: Db, tenantId: string, rootId: string, connectionId: string | null): Promise<VideoDriveCredential | null> {
  const found = await lookupPinnedVideoDriveCredential(db, tenantId, rootId, connectionId);
  return found.ok ? found.credential : null;
}

/** 이 지점이 **고른 연결**의 자격(저장 폴더를 아직 안 정했을 때 — 폴더 확인용). 그 지점의 연결이 아니면 null. */
export async function readSelectedVideoDriveCredential(db: Db, tenantId: string, connectionId: string): Promise<VideoDriveCredential | null> {
  if (!UUID_RE.test(connectionId)) return null;
  const { data, error } = await db.rpc("read_homework_video_drive_connection", { p_tenant: tenantId, p_connection: connectionId });
  if (error) throw new Error(LOOKUP_FAILED);
  const row = data as ConnectionRow | null;
  if (!row || typeof row !== "object" || row.legacy === true) return null;
  const found = oauthCredential(db, tenantId, row, connectionId);
  return found.ok ? found.credential : null;
}

export type ActiveVideoDrive = { ok: true; drive: VideoDriveConfig } | { ok: false; reason: "no_config" | "setup_pending" | "reauth" };

/**
 * 계정은 골랐는데 **저장 폴더를 아직 정하지 않았나** — 계정을 연결하거나 바꾼 직후의 상태다(곧 다시 받을 지점).
 * 폴더가 적힌 채 꺼 둔 설정·연결을 해제한 설정은 아니다(그 지점은 받지 않기로 한 것이다).
 */
async function awaitingFolder(db: Db, tenantId: string): Promise<boolean> {
  const { data, error } = await db.from("homework_video_drive_settings").select("root_folder_id").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(LOOKUP_FAILED);
  return !!data && !data.root_folder_id;
}

/**
 * **새 업로드**가 쓸 저장 폴더와 자격 — 지금 켜진 설정의 폴더·연결로 자격을 확인한다.
 * 다시 연결이 필요한 계정은 새 업로드를 받지 않는다(`reauth`). 이미 시작한 업로드는 `readPinned…`로 따로 끝낸다.
 * 🔴 `setup_pending`(계정은 골랐고 폴더는 아직) = **잠시 못 받음**이지 '없는 지점'이 아니다 — 없는 지점으로 치면 올리기 사이트가
 *    남은 한 지점으로 저절로 정해져, 이 지점 학생이 다른 지점의 같은 이름·같은 뒷자리 학생에게 올리게 된다.
 */
export async function videoDriveForTenant(tenantId: string, db: Db): Promise<ActiveVideoDrive> {
  const setting = await getVideoDriveSetting(tenantId, db);
  if (!setting.enabled || !setting.rootId)
    return { ok: false, reason: setting.connectionId && (await awaitingFolder(db, tenantId)) ? "setup_pending" : "no_config" };
  if (setting.connectionId && setting.accountStatus !== "ready") return { ok: false, reason: "reauth" };
  const found = await lookupPinnedVideoDriveCredential(db, tenantId, setting.rootId, setting.connectionId);
  if (!found.ok) return { ok: false, reason: "no_config" };
  const { credential } = found;
  if (credential.status !== "ready") return { ok: false, reason: "reauth" };
  return {
    ok: true,
    drive: { tenantId, rootId: setting.rootId, connectionId: credential.connectionId, tokenVersion: credential.tokenVersion, accessToken: credential.accessToken },
  };
}
