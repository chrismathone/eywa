import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fake-db.test-util";
import { ENV, OTHER_T, ROOT, T } from "./test-fixture.test-util";
import { getVideoDriveSetting, videoDriveOwnsRoot } from "./drive-settings";

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
