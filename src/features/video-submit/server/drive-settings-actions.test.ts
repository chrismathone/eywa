import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fake-db.test-util";
import { ENV, OTHER_T, ROOT, T, settings } from "./test-fixture.test-util";

const m = vi.hoisted(() => ({ db:null as unknown, actor:null as unknown, allowed:true, moduleOn:true, rpc:vi.fn(), audit:vi.fn(), asked:[] as string[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant:async()=>true, canWriteTenant:async (_role:string, menu:string) => { m.asked.push(menu); return m.allowed; } }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings:async()=>settings() }));
vi.mock("@/features/owner/classnote-gate", () => ({ classnoteModuleOn:()=>m.moduleOn }));
vi.mock("@/features/audit/server/log", () => ({ logAction:m.audit }));
vi.mock("next/cache", () => ({ revalidatePath:vi.fn() }));
import { saveVideoDriveSetting } from "./drive-settings-actions";

const NEW_ROOT = "NEW_TENANT_ROOT_123";
let db: ReturnType<typeof createFakeDb>;
let driveFetch: ReturnType<typeof vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>>;
function form(intent="save", root=NEW_ROOT) {
  const data=new FormData(); data.set("intent",intent); data.set("folder",root); data.set("version",""); data.set("tenant_id",OTHER_T); return data;
}
beforeEach(() => {
  m.actor={id:"staff",tenantId:T,systemRole:"manager"}; m.allowed=true; m.moduleOn=true; m.asked=[];
  m.rpc.mockReset().mockResolvedValue({data:"updated",error:null}); m.audit.mockReset();
  db=createFakeDb({classnote_video_folders:[{tenant_id:T,root_folder_id:ROOT}],homework_video_drive_roots:[{tenant_id:T,root_folder_id:ROOT}],classnote_workers:[]});
  m.db={...db,rpc:m.rpc};
  for (const [key,value] of Object.entries(ENV)) vi.stubEnv(key,value);
  driveFetch=vi.fn(async (input:string|URL|Request) => {
    const url=String(input);
    if(url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({access_token:"access",expires_in:3600}));
    if(url.includes("/files?")) return new Response(JSON.stringify({files:[]}));
    const id=url.includes(NEW_ROOT)?NEW_ROOT:url.includes(ROOT)?ROOT:"PARENT_FOLDER_123";
    return new Response(JSON.stringify({id,name:"지점 영상",mimeType:"application/vnd.google-apps.folder",capabilities:{canAddChildren:true},parents:id==="PARENT_FOLDER_123"?[]:["PARENT_FOLDER_123"]}));
  });
  vi.stubGlobal("fetch",driveFetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("연동 폴더 저장 서버 액션", () => {
  it("편집권한 없이 직접 호출하거나 기능이 꺼지면 외부조회/쓰기 없이 거절한다", async () => {
    m.allowed=false; expect(await saveVideoDriveSetting(undefined,form())).toHaveProperty("error");
    m.allowed=true; m.moduleOn=false; expect(await saveVideoDriveSetting(undefined,form())).toHaveProperty("error");
    expect(m.rpc).not.toHaveBeenCalled(); expect(driveFetch).not.toHaveBeenCalled();
    expect(m.asked).toEqual(["integration_settings","integration_settings"]);
  });
  it("브라우저의 지점값을 무시하고 실제 사용자 지점으로 원자 저장한다", async () => {
    expect(await saveVideoDriveSetting(undefined,form())).toMatchObject({ok:true});
    expect(m.rpc).toHaveBeenCalledWith("save_homework_video_drive_setting",expect.objectContaining({p_tenant:T,p_root:NEW_ROOT,p_enabled:true,p_expected_version:null}));
    expect(m.audit).toHaveBeenCalled();
    expect(driveFetch.mock.calls.every((call)=>!call[1] || call[1].method!=="PATCH")).toBe(true);
  });
  it("오래된 화면은 Drive 조회 이전에 거절한다", async () => {
    db.tables.homework_video_drive_settings=[{tenant_id:T,enabled:false,version:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}];
    expect(await saveVideoDriveSetting(undefined,form())).toMatchObject({error:expect.stringContaining("변경")});
    expect(m.rpc).not.toHaveBeenCalled(); expect(driveFetch).not.toHaveBeenCalled();
  });
  it("해제는 false 행을 남기며 Google 인증과 조회를 요구하지 않는다", async () => {
    expect(await saveVideoDriveSetting(undefined,form("disconnect"))).toMatchObject({ok:true});
    expect(m.rpc).toHaveBeenCalledWith("save_homework_video_drive_setting",expect.objectContaining({p_root:null,p_enabled:false,p_verified_roots:[]}));
    expect(driveFetch).not.toHaveBeenCalled();
  });
  it("타 지점 소유 폴더는 Google 조회 전에 차단한다", async () => {
    db.tables.homework_video_drive_roots!.push({tenant_id:OTHER_T,root_folder_id:NEW_ROOT});
    expect(await saveVideoDriveSetting(undefined,form())).toHaveProperty("error");
    expect(m.rpc).not.toHaveBeenCalled(); expect(driveFetch).not.toHaveBeenCalled();
  });
  it("온라인 구 발송 PC가 설정 변경을 무시할 때에는 변경을 막는다", async () => {
    db.tables.classnote_workers=[{tenant_id:T,last_seen:new Date().toISOString(),last_results:{postMode:true,caps:{}}}];
    expect(await saveVideoDriveSetting(undefined,form())).toMatchObject({error:expect.stringContaining("업데이트")});
    expect(m.rpc).not.toHaveBeenCalled(); expect(driveFetch).not.toHaveBeenCalled();
  });
  it("이미 경로를 확인한 과거 폴더의 접근 실패는 새 폴더 저장을 막지 않는다", async () => {
    const retired = "RETIRED_FOREIGN_ROOT_123";
    db.tables.homework_video_drive_roots!.push({ tenant_id:OTHER_T,root_folder_id:retired,ancestry_verified:true });
    const normal = driveFetch.getMockImplementation()!;
    driveFetch.mockImplementation(async (input) => String(input).includes(retired)
      ? new Response(JSON.stringify({error:{message:"not found"}}),{status:404}) : normal(input));
    expect(await saveVideoDriveSetting(undefined,form())).toMatchObject({ok:true});
    const args = m.rpc.mock.calls[0][1];
    expect(args.p_verified_roots.some((claim:{rootId:string}) => claim.rootId === retired)).toBe(false);
    expect(args.p_verified_roots.some((claim:{rootId:string}) => claim.rootId === NEW_ROOT)).toBe(true);
  });
  it("확인한 적 없는 기존 폴더의 경로는 접근 실패 시 추정하지 않는다", async () => {
    const unknown = "UNVERIFIED_FOREIGN_ROOT";
    db.tables.homework_video_drive_roots!.push({ tenant_id:OTHER_T,root_folder_id:unknown,ancestry_verified:false });
    const normal = driveFetch.getMockImplementation()!;
    driveFetch.mockImplementation(async (input) => String(input).includes(unknown)
      ? new Response("",{status:404}) : normal(input));
    expect(await saveVideoDriveSetting(undefined,form())).toHaveProperty("error");
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("저장 대상은 과거에 확인한 폴더라도 접근 실패 시 거절한다", async () => {
    db.tables.homework_video_drive_roots!.push({tenant_id:T,root_folder_id:NEW_ROOT,ancestry_verified:true});
    const normal = driveFetch.getMockImplementation()!;
    driveFetch.mockImplementation(async (input) => String(input).includes(NEW_ROOT)
      ? new Response("",{status:404}) : normal(input));
    expect(await saveVideoDriveSetting(undefined,form())).toHaveProperty("error");
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
