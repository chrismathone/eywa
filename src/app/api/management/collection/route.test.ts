// @vitest-environment node
import {beforeEach,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({access:vi.fn(),preview:vi.fn(),save:vi.fn()}));
vi.mock("@/features/management/server/access",()=>({managementAccess:mocks.access,ManagementAccessError:class extends Error{}}));
vi.mock("@/features/management/server/collection",()=>({previewCollection:mocks.preview}));
vi.mock("@/features/management/server/reviews",()=>({saveSourceEvidenceBatch:mocks.save}));
import {POST} from "./route";
const hash="a".repeat(64);
function req(mode="preview",token?:string,origin="https://www.aywa.co.kr"){const f=new FormData();f.set("file",new File(["xlsx"],"source.xlsx"));f.set("source","makeedu");f.set("month","2026-10");f.set("scope","true");f.set("fullScope","true");f.set("mode",mode);if(token)f.set("planHash",token);return new Request("https://www.aywa.co.kr/api/management/collection",{method:"POST",headers:{origin},body:f});}
beforeEach(()=>{vi.resetAllMocks();mocks.access.mockResolvedValue({id:"owner",tenantId:"tenant"});mocks.preview.mockResolvedValue({planHash:hash,evidence:[{month:"2026-10"}]});mocks.save.mockResolvedValue({inserted:1,duplicates:0});});
it("denies unauthorized users before parsing or DB reads",async()=>{mocks.access.mockRejectedValue(Error("denied"));expect((await POST(req())).status).toBe(403);expect(mocks.preview).not.toHaveBeenCalled();});
it("rejects foreign origins",async()=>{expect((await POST(req("preview",undefined,"https://elsewhere.test"))).status).toBe(403);expect(mocks.preview).not.toHaveBeenCalled();});
it("preview performs no persistent writes",async()=>{expect((await POST(req())).status).toBe(200);expect(mocks.save).not.toHaveBeenCalled();});
it("recomputes and rejects stale commit previews",async()=>{expect((await POST(req("commit","b".repeat(64)))).status).toBe(409);expect(mocks.save).not.toHaveBeenCalled();});
it("commits only the recomputed evidence and reports idempotent counts",async()=>{mocks.save.mockResolvedValue({inserted:0,duplicates:1});const r=await POST(req("commit",hash));expect(r.status).toBe(200);expect(await r.json()).toMatchObject({inserted:0,duplicates:1});expect(mocks.save).toHaveBeenCalledWith([{month:"2026-10"}]);});
