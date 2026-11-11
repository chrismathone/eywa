// @vitest-environment node
import {beforeEach,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
const m=vi.hoisted(()=>({access:vi.fn(),record:vi.fn(),preview:vi.fn(),save:vi.fn()}));
vi.mock("@/features/management/server/collector-auth",async(importOriginal)=>({...await importOriginal<typeof import("@/features/management/server/collector-auth")>(),collectorAccess:m.access,recordCollectorResult:m.record}));
vi.mock("@/features/management/server/collection",()=>({previewCollectionFor:m.preview}));
vi.mock("@/features/management/server/reviews",()=>({saveSourceEvidenceBatchFor:m.save}));
import {CollectorError} from "@/features/management/server/collector-auth";
import {GET,POST} from "./route";
const user={id:"owner",tenantId:"verified-tenant",deviceId:"verified-device"},bytes=Buffer.from("test XLSX parser is mocked"),hash=createHash("sha256").update(bytes).digest("hex");
function request(overrides:Record<string,string>={}){const f=new FormData();for(const [k,v]of Object.entries({source:"makeedu",month:"2026-10",sourceHash:hash,scope:"true",fullScope:"true",...overrides}))f.set(k,v);f.set("file",new File([bytes],"export.xlsx"));return new Request("https://www.aywa.co.kr/api/management/collector",{method:"POST",body:f,headers:{authorization:"Bearer test"}});}
beforeEach(()=>{vi.clearAllMocks();m.access.mockResolvedValue(user);m.record.mockResolvedValue(undefined);m.preview.mockResolvedValue({evidence:[{month:"2026-10",issues:[]} ]});m.save.mockResolvedValue({inserted:1,duplicates:0});});
it("rejects unauthenticated uploads before parsing or saving",async()=>{m.access.mockRejectedValue(new CollectorError(401,"connection_required"));expect((await POST(request())).status).toBe(401);expect(m.preview).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();});
it("returns only verified connection identity on heartbeat",async()=>{const r=await GET(new Request("https://www.aywa.co.kr/api"));expect(await r.json()).toEqual({connected:true,tenantId:user.tenantId,deviceId:user.deviceId,scope:"source-evidence-only-v1"});expect(m.save).not.toHaveBeenCalled();});
it.each<Record<string,string>>([{sourceHash:"0".repeat(64)},{scope:"false"},{fullScope:"false"},{month:"wrong"}])("rejects changed files and unconfirmed metadata %j",async(v)=>{expect((await POST(request(v))).status).toBeGreaterThanOrEqual(400);expect(m.preview).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();});
it("recomputes evidence and ignores untrusted tenant/evidence before scoped save",async()=>{
  const r=await POST(request({tenantId:"foreign",evidence:"forged"}));expect(r.status).toBe(200);expect(m.preview).toHaveBeenCalledWith(user,"makeedu","2026-10",bytes,"export.xlsx");expect(m.save).toHaveBeenCalledWith(user,[{month:"2026-10",issues:[]}]);expect(m.access).toHaveBeenCalledTimes(2);expect(await r.json()).toMatchObject({sourceHash:hash,inserted:1,months:["2026-10"]});
});
it("rejects revocation during parse before saving",async()=>{m.access.mockResolvedValueOnce(user).mockRejectedValueOnce(new CollectorError(401,"connection_expired_or_revoked"));expect((await POST(request())).status).toBe(401);expect(m.save).not.toHaveBeenCalled();});
it("returns duplicate acknowledgment and does not expose raw exceptions",async()=>{m.save.mockResolvedValue({inserted:0,duplicates:1});expect(await (await POST(request())).json()).toMatchObject({inserted:0,duplicates:1});m.preview.mockRejectedValue(Error("private details"));const r=await POST(request());expect(await r.text()).not.toContain("private details");});
