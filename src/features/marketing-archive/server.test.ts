import {beforeEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({user:vi.fn(),read:vi.fn(),write:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/auth/current-user",()=>({getCurrentUser:mocks.user}));
vi.mock("@/lib/auth/perm-matrix",()=>({canAccessTenant:mocks.read,canWriteTenant:mocks.write}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc})}));
import {archiveGate,saveArchive} from "./server";
import {blankEvent,ARCHIVE_TENANT} from "./model";
describe("marketing archive access",()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({id:"00000000-0000-4000-8000-000000000001",tenantId:ARCHIVE_TENANT,systemRole:"master"});mocks.read.mockResolvedValue(true);mocks.write.mockResolvedValue(true);mocks.rpc.mockResolvedValue({data:{id:"saved"},error:null});});
 it.each(["teacher","counselor","viewer","accountant","manager","parttime"])("does not expose the academy archive to %s by default",async role=>{mocks.user.mockResolvedValue({tenantId:ARCHIVE_TENANT,systemRole:role});await expect(archiveGate()).rejects.toThrow();expect(mocks.rpc).not.toHaveBeenCalled();});
 it("requires both dashboard and billing read permissions",async()=>{mocks.read.mockImplementation((_role,key)=>Promise.resolve(key!=="billing"));await expect(archiveGate()).rejects.toThrow();});
 it("blocks writes in a readonly view even for the owner",async()=>{mocks.write.mockResolvedValue(false);await expect(saveArchive({kind:"event",id:null,version:0,document:{...blankEvent(),title:"예정 행사"}})).rejects.toThrow();expect(mocks.rpc).not.toHaveBeenCalled();});
 it("binds actor and tenant from the authenticated session",async()=>{await saveArchive({kind:"event",id:null,version:0,document:{...blankEvent(),title:"예정 행사"}});expect(mocks.rpc).toHaveBeenCalledWith("save_marketing_archive",expect.objectContaining({p_tenant:ARCHIVE_TENANT,p_actor:"00000000-0000-4000-8000-000000000001"}));});
 it("rejects a caller-supplied tenant",async()=>{await expect(saveArchive({kind:"event",id:null,version:0,tenant:"other",document:{...blankEvent(),title:"행사"}})).rejects.toThrow();expect(mocks.rpc).not.toHaveBeenCalled();});
 it("blocks a linked classification without an event",async()=>{await expect(saveArchive({kind:"source",id:"00000000-0000-4000-8000-000000000001",version:1,document:{status:"linked",eventId:null,note:"행사 연결"}})).rejects.toThrow();});
});
