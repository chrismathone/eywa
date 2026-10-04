/**
 * 테스트 전용 — **계정 연결 스키마**(연결 표 + 자격 함수)가 있는 DB를 메모리에서 흉내 낸다. 🔴 운영 코드에서 import하지 말 것.
 * 함수들은 SQL 계약 그대로 답한다: `(지점, 저장 폴더, 연결)`이 정확히 맞을 때만 자격을 주고, 연결이 없는 폴더는 `{legacy:true}`,
 * 안 맞으면 null. 가짜 연결 행의 `refresh_token` 칸은 금고에 든 갱신 토큰을 대신한다(가짜 토큰 서버가 `access:<갱신 토큰>`을 준다).
 */
import type { FakeDb } from "./fake-db.test-util";

export const CONN = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const CONN_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
export const WEB_ORIGIN = "https://www.aywa.co.kr";
export const WEB_ENV = {
  HOMEWORK_VIDEO_GOOGLE_CLIENT_ID: "web-client",
  HOMEWORK_VIDEO_GOOGLE_CLIENT_SECRET: "web-secret",
  HOMEWORK_VIDEO_GOOGLE_REDIRECT_URI: `${WEB_ORIGIN}/api/integrations/homework-video-drive/callback`,
};

type Row = Record<string, unknown>;
const connectionJson = (row: Row | undefined) => row && {
  connectionId: row.id, oauthClientId: row.oauth_client_id, refreshToken: row.refresh_token, tokenVersion: row.token_version, status: row.status,
};

/** 계정 연결 표와 자격 함수 셋을 단다. 저장·연결 함수는 테스트가 필요할 때 따로 등록한다. */
export function withAccountSchema(db: FakeDb): FakeDb {
  db.tables.homework_video_drive_connections ??= [];
  db.tables.homework_video_drive_roots ??= [];
  const connection = (tenant: unknown, id: unknown) =>
    db.tables.homework_video_drive_connections!.find((row) => row.tenant_id === tenant && row.id === id);
  db.defineRpc("read_homework_video_drive_credential", ({ p_tenant, p_root, p_connection }) => {
    const root = db.tables.homework_video_drive_roots!.find((row) => row.tenant_id === p_tenant && row.root_folder_id === p_root);
    if (!root || (root.connection_id ?? null) !== (p_connection ?? null)) return null;
    return p_connection ? connectionJson(connection(p_tenant, p_connection)) ?? null : { legacy: true };
  });
  db.defineRpc("read_homework_video_drive_connection", ({ p_tenant, p_connection }) => connectionJson(connection(p_tenant, p_connection)) ?? null);
  db.defineRpc("mark_homework_video_drive_needs_reauth", ({ p_tenant, p_connection, p_token_version }) => {
    const row = connection(p_tenant, p_connection);
    if (!row || row.token_version !== p_token_version) return false;
    row.status = "needs_reauth";
    return true;
  });
  return db;
}

/** 지점의 Google 계정 연결 한 줄 — 갱신 토큰 기본값은 `rt-<연결 앞 4자>`. */
export function addConnection(db: FakeDb, tenantId: string, id = CONN, over: Row = {}): Row {
  const row: Row = {
    id, tenant_id: tenantId, google_subject: `sub-${id.slice(0, 4)}`, permission_id: `perm-${id.slice(0, 4)}`, email: `${id.slice(0, 4)}@example.com`,
    oauth_client_id: WEB_ENV.HOMEWORK_VIDEO_GOOGLE_CLIENT_ID, refresh_token: `rt-${id.slice(0, 4)}`, token_version: 1, status: "ready", ...over,
  };
  (db.tables.homework_video_drive_connections ??= []).push(row);
  return row;
}

/** 그 지점이 그 연결로 저장 폴더를 정해 받고 있는 상태(설정 행 + 폴더 등록 행). */
export function enableAccountRoot(db: FakeDb, tenantId: string, rootId: string, connectionId = CONN, over: Row = {}): void {
  db.tables.homework_video_drive_roots = [
    ...(db.tables.homework_video_drive_roots ?? []).filter((row) => row.root_folder_id !== rootId),
    { root_folder_id: rootId, tenant_id: tenantId, connection_id: connectionId, folder_name: "지점 숙제영상", ancestry_verified: true, chain_complete: true },
  ];
  db.tables.homework_video_drive_settings = [
    ...(db.tables.homework_video_drive_settings ?? []).filter((row) => row.tenant_id !== tenantId),
    { tenant_id: tenantId, enabled: true, root_folder_id: rootId, connection_id: connectionId, version: "12121212-1212-4121-8121-121212121212", ...over },
  ];
}

/** 그 요청에 실린 접근 토큰(`Authorization: Bearer …`) — 어느 계정의 자격으로 불렀는지 확인한다. */
export const bearerOf = (call: { init?: RequestInit }): string =>
  String((call.init?.headers as Record<string, string> | undefined)?.Authorization ?? "").replace(/^Bearer /, "");
