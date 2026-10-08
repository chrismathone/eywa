import {beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({authenticate:vi.fn(),work:vi.fn()}));
vi.mock("./security",()=>({authenticate:m.authenticate}));
vi.mock("./gateway",async()=>{const {z}=await import("zod");return{withAgentWork:m.work,WorkEnvelope:z.object({instanceId:z.string().uuid(),generation:z.string(),module:z.literal("classnote")})};});
import {authorizeInternalWorker} from "./internal-auth";
const id="bda0b430-bfdb-45f9-921a-b799c7cff4b6",instance="2b7b72ec-ddd5-46e2-a4d1-242a44e8f07a";
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("CLASSNOTE_INTERNAL_SECRET","legacy-secret");m.authenticate.mockResolvedValue({id,tenantId:"fixture-tenant"});m.work.mockImplementation(async(_d,_e,fn)=>fn());});
describe("worker internal route authorization",()=>{
  it("keeps the existing legacy worker path independent of new schema",async()=>{expect(await authorizeInternalWorker("legacy-secret")).toEqual({tenantId:null});expect(m.authenticate).not.toHaveBeenCalled();});
  it("binds new worker requests to the authenticated tenant and active module lease",async()=>{
    expect(await authorizeInternalWorker(`agent:${id}.${"x".repeat(43)}:${instance}:9`)).toEqual({tenantId:"fixture-tenant"});
    expect(m.work).toHaveBeenCalledWith({id,tenantId:"fixture-tenant"},{instanceId:instance,generation:"9",module:"classnote"},expect.any(Function));
  });
  it.each([null,"",`agent:${id}.short:${instance}:1`,`agent:${id}.${"x".repeat(43)}:bad:1`])("rejects malformed credentials %s",async value=>expect(await authorizeInternalWorker(value)).toBeNull());
  it("rejects a revoked device or retired lease without revealing details",async()=>{m.authenticate.mockRejectedValueOnce(new Error("private error"));expect(await authorizeInternalWorker(`agent:${id}.${"x".repeat(43)}:${instance}:9`)).toBeNull();m.work.mockRejectedValueOnce(new Error("expired"));expect(await authorizeInternalWorker(`agent:${id}.${"x".repeat(43)}:${instance}:9`)).toBeNull();});
});
