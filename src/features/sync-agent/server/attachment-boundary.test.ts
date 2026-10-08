import {beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({authorize:vi.fn(),sign:vi.fn(),query:vi.fn()}));
vi.mock("./internal-auth",()=>({authorizeInternalWorker:m.authorize}));
vi.mock("@/lib/storage/media-storage",()=>({resolveTenantReadUrls:m.sign}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:m.query})})})})}));
import {GET as report} from "@/app/api/internal/report-attachments/[reportId]/route";
import {GET as notice} from "@/app/api/internal/notice-attachments/[noticeId]/route";
import {GET as classNotice} from "@/app/api/internal/class-notice-attachments/[noticeId]/route";
beforeEach(()=>{vi.resetAllMocks();m.authorize.mockResolvedValue({tenantId:"own"});m.query.mockResolvedValue({data:{tenant_id:"other",attachments:[{name:"a.pdf",path:"a"}],targets:[]}});});
describe("internal attachments cannot cross device tenants",()=>{
  it("denies report, individual notice and class notice before signing any URL",async()=>{
    const request=new Request("https://fixture.invalid");
    for(const response of [await report(request,{params:Promise.resolve({reportId:"fixture"})}),await notice(request,{params:Promise.resolve({noticeId:"fixture"})}),await classNotice(request,{params:Promise.resolve({noticeId:"fixture"})})])expect(response.status).toBe(403);
    expect(m.sign).not.toHaveBeenCalled();
  });
  it("denies an unauthenticated worker before querying records",async()=>{m.authorize.mockResolvedValue(null);expect((await report(new Request("https://fixture.invalid"),{params:Promise.resolve({reportId:"fixture"})})).status).toBe(401);expect(m.query).not.toHaveBeenCalled();});
});
