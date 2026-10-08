import { describe,it,expect } from "vitest";
import { AgentLogRequest,kstLogRange } from "./log-filter";
describe("KST log filtering",()=>{
 it("uses KST midnight bounds independently of the host timezone",()=>expect(kstLogRange(undefined,Date.parse("2026-10-08T15:00:00Z"))).toEqual({day:"2026-10-09",start:"2026-10-08T15:00:00.000Z",end:"2026-10-09T15:00:00.000Z"}));
 it("rejects impossible dates and injected cursor fields",()=>{
  expect(()=>kstLogRange("2026-02-30")).toThrow();expect(()=>kstLogRange("invalid")).toThrow();
  expect(AgentLogRequest.safeParse({date:"2026-10-09",tenantId:"another"}).success).toBe(false);
 });
});
