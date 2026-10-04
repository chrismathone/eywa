import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fake-db.test-util";
import { ENV, OTHER_T, ROOT, T } from "./test-fixture.test-util";
import { getVideoDriveSetting, videoDriveOwnsRoot } from "./drive-settings";
import { CONN, CONN_B, WEB_ENV, addConnection, enableAccountRoot, withAccountSchema } from "./account-fixture.test-util";

beforeEach(() => { for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value); });
afterEach(() => vi.unstubAllEnvs());
const database = () => createFakeDb({ classnote_video_folders: [{ tenant_id: T, root_folder_id: ROOT }], homework_video_drive_roots: [{ tenant_id:T, root_folder_id:ROOT }] });
const typed = (db: unknown) => db as Parameters<typeof getVideoDriveSetting>[1];

describe("지점별 저장 설정과 기존 연결 보호", () => {
  it("행이 없으면 지정된 기존 지점만 사용하고 다른 지점에는 연결하지 않는다", async () => {
    const db = database();
    expect(await getVideoDriveSetting(T, typed(db))).toMatchObject({ enabled:true, source:"legacy", rootId:ROOT });
    expect(await getVideoDriveSetting(OTHER_T, typed(db))).toMatchObject({ enabled:false, source:"none" });
  });
  it("명시적 해제 이후에는 기존 환경 설정이 되살아나지 않는다", async () => {
    const db = database();
    db.tables.homework_video_drive_settings = [{ tenant_id:T, enabled:false, root_folder_id:null, version:"v1" }];
    expect(await getVideoDriveSetting(T, typed(db))).toMatchObject({ enabled:false, source:"saved", version:"v1" });
  });
  it("새 설정은 해당 지점 소유 폴더일 때만 켜진다", async () => {
    const db = database();
    db.tables.homework_video_drive_settings = [{ tenant_id:OTHER_T, enabled:true, root_folder_id:"OTHER_ROOT_ID", version:"v2" }];
    db.tables.homework_video_drive_roots = [{ tenant_id:OTHER_T, root_folder_id:"OTHER_ROOT_ID", folder_name:"별도 지점" }];
    expect(await getVideoDriveSetting(OTHER_T, typed(db))).toMatchObject({ enabled:true, rootId:"OTHER_ROOT_ID", source:"saved" });
    db.tables.homework_video_drive_roots[0]!.tenant_id = T;
    expect(await getVideoDriveSetting(OTHER_T, typed(db))).toMatchObject({ enabled:false });
  });
  it("조회 권한/네트워크 오류를 미설정으로 취급하여 폴백하지 않는다", async () => {
    const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data:null,error:{code:"42501"} }) }) }) }) };
    await expect(getVideoDriveSetting(T, typed(db))).rejects.toThrow();
  });
  it("구 스키마에서는 이전 연결을 유지하지만 다른 지점 소유이면 거절한다", async () => {
    const db = database();
    db.dropTable("homework_video_drive_settings"); db.dropTable("homework_video_drive_roots");
    expect(await getVideoDriveSetting(T, typed(db))).toMatchObject({ ready:false,enabled:true,source:"legacy" });
    db.tables.classnote_video_folders![0]!.tenant_id = OTHER_T;
    expect(await getVideoDriveSetting(T, typed(db))).toMatchObject({ enabled:false });
  });
  it("과거 루트의 완료 허가는 활성 설정과 독립적이며 다른 지점 소유는 거절한다", async () => {
    const db = database();
    db.tables.homework_video_drive_roots = [{ tenant_id:T,root_folder_id:ROOT }];
    db.tables.homework_video_drive_settings = [{ tenant_id:T,enabled:false }];
    expect(await videoDriveOwnsRoot(T,ROOT,typed(db)!)).toBe(true);
    expect(await videoDriveOwnsRoot(OTHER_T,ROOT,typed(db)!)).toBe(false);
  });
  it("내 지점 폴더 행이 많아도 뒤에 있는 다른 지점 소유를 누락하지 않는다", async () => {
    const db=database();
    db.dropTable("homework_video_drive_roots");
    db.tables.classnote_video_folders=[...Array.from({length:250},()=>({tenant_id:T,root_folder_id:ROOT})),{tenant_id:OTHER_T,root_folder_id:ROOT}];
    expect(await getVideoDriveSetting(T,typed(db))).toMatchObject({enabled:false});
    expect(await videoDriveOwnsRoot(T,ROOT,typed(db)!)).toBe(false);
  });
  it("새 스키마에서는 등록되지 않은 env 루트를 새 연결로 인정하지 않는다", async () => {
    const db=database(); db.tables.homework_video_drive_roots=[];
    expect(await getVideoDriveSetting(T,typed(db))).toMatchObject({enabled:false});
    expect(await videoDriveOwnsRoot(T,ROOT,typed(db)!)).toBe(false);
  });
});

describe("계정 연결 — 스키마 상태와 화면용 값", () => {
  const NEW_ROOT = "ACCOUNT_ROOT_0001";
  const account = () => {
    const db = withAccountSchema(database());
    addConnection(db, OTHER_T);
    enableAccountRoot(db, OTHER_T, NEW_ROOT);
    for (const [key, value] of Object.entries(WEB_ENV)) vi.stubEnv(key, value);
    return db;
  };
  it("표가 없으면 둘 다 준비 전 · 폴더 표만 있으면 계정은 준비 전(기존 연결은 그대로 받는다) · 다 있으면 준비됨", async () => {
    const absent = database();
    absent.dropTable("homework_video_drive_settings"); absent.dropTable("homework_video_drive_roots");
    expect(await getVideoDriveSetting(T, typed(absent))).toMatchObject({ ready: false, accountReady: false, enabled: true, source: "legacy", connectionId: null });
    const folderOnly = database();
    folderOnly.dropColumn("homework_video_drive_settings", "connection_id");
    expect(await getVideoDriveSetting(T, typed(folderOnly))).toMatchObject({ ready: true, accountReady: false, enabled: true, source: "legacy", authReady: true });
    expect(await getVideoDriveSetting(T, typed(withAccountSchema(database())))).toMatchObject({ ready: true, accountReady: true, enabled: true, source: "legacy", connectionId: null });
  });
  it("연결한 지점은 계정 이메일·상태·토큰 번호를 주고, 정상 + 앱 설정이 있을 때만 쓸 수 있다고 한다", async () => {
    const db = account();
    expect(await getVideoDriveSetting(OTHER_T, typed(db))).toMatchObject({
      enabled: true, rootId: NEW_ROOT, source: "saved", connectionId: CONN, accountEmail: "aaaa@example.com", accountStatus: "ready", tokenVersion: 1, authReady: true,
    });
    db.tables.homework_video_drive_connections![0]!.status = "needs_reauth";
    expect(await getVideoDriveSetting(OTHER_T, typed(db))).toMatchObject({ enabled: true, accountStatus: "needs_reauth", authReady: false });
    db.tables.homework_video_drive_connections![0]!.status = "ready";
    vi.stubEnv("HOMEWORK_VIDEO_GOOGLE_CLIENT_ID", "another-client"); // 그 연결을 발급한 앱의 설정이 서버에 없다
    expect(await getVideoDriveSetting(OTHER_T, typed(db))).toMatchObject({ enabled: true, authReady: false });
  });
  it("계정만 연결하고 폴더를 아직 안 정했으면 받지 않되 계정은 보인다", async () => {
    const db = account();
    Object.assign(db.tables.homework_video_drive_settings![0]!, { enabled: false, root_folder_id: null });
    expect(await getVideoDriveSetting(OTHER_T, typed(db))).toMatchObject({ enabled: false, rootId: null, source: "saved", connectionId: CONN, accountStatus: "ready" });
  });
  it("🔴 저장 폴더에 묶인 연결이 지금 고른 연결과 다르면 받지 않는다(다른 계정의 폴더로 넘어가지 않는다) · 남의 지점 연결은 읽히지 않는다", async () => {
    const db = account();
    addConnection(db, OTHER_T, CONN_B);
    db.tables.homework_video_drive_settings![0]!.connection_id = CONN_B; // 폴더는 CONN에 묶여 있다
    expect(await getVideoDriveSetting(OTHER_T, typed(db))).toMatchObject({ enabled: false, connectionId: CONN_B });
    // 기존 연결의 폴더(연결 없음)를 계정 연결로 켤 수도 없다
    db.tables.homework_video_drive_roots = [{ tenant_id: OTHER_T, root_folder_id: NEW_ROOT, connection_id: null }];
    expect(await getVideoDriveSetting(OTHER_T, typed(db))).toMatchObject({ enabled: false });
    // 설정이 다른 지점의 연결을 가리켜도 그 연결의 이메일·상태가 나오지 않는다
    db.tables.homework_video_drive_connections = [{ id: CONN_B, tenant_id: T, email: "other@example.com", status: "ready", token_version: 1, oauth_client_id: "web-client" }];
    expect(await getVideoDriveSetting(OTHER_T, typed(db))).toMatchObject({ enabled: false, connectionId: null, accountEmail: null });
  });
  it("🔴 계정을 연결한 폴더는 env의 기존 연결로 켜지지 않는다(설정 행이 없어도)", async () => {
    const db = withAccountSchema(database());
    db.tables.homework_video_drive_roots = [{ tenant_id: T, root_folder_id: ROOT, connection_id: CONN }];
    expect(await getVideoDriveSetting(T, typed(db))).toMatchObject({ enabled: false, source: "none" });
  });
});
