import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create:vi.fn(),query:vi.fn(),title:vi.fn(),update:vi.fn(),guard:vi.fn() }));
vi.mock("@/lib/notion/client",()=>({createPage:mocks.create,queryDatabaseAll:mocks.query,titlePropertyName:mocks.title,updatePageProps:mocks.update}));
vi.mock("@/lib/auth/tenant-view-outbound",()=>({assertTenantViewOutboundAllowed:mocks.guard}));
import { managementNotionConfig, publishCaseNotice } from "./notion";
import type { AgentCase } from "../model";
const row = { id:"10000000-0000-4000-8000-000000000001",tenant_id:"academy",consultation_id:"source",status:"open",
  result_note:"PRIVATE_COUNSELOR_NOTE" } as AgentCase;
beforeEach(()=>{
  vi.clearAllMocks(); vi.stubEnv("NOTION_MANAGEMENT_DATABASE_ID","notice-only"); vi.stubEnv("NOTION_TOKEN","synthetic-token");
  vi.stubEnv("NOTION_TENANT_ID","academy"); vi.stubEnv("NEXT_PUBLIC_APP_URL","https://example.invalid");
  mocks.title.mockResolvedValue("Name"); mocks.query.mockResolvedValue([]); mocks.create.mockResolvedValue("page");
});
afterEach(()=>vi.unstubAllEnvs());
it("refuses other academies and an insecure destination",()=>{
  expect(managementNotionConfig("other")).toBeNull();
  vi.stubEnv("NEXT_PUBLIC_APP_URL","http://example.invalid"); expect(managementNotionConfig("academy")).toBeNull();
});
it("records creation intent before sending, excludes private notes",async()=>{
  const before=vi.fn(); await publishCaseNotice(row,false,before);
  expect(before.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]!);
  expect(JSON.stringify(mocks.create.mock.calls)).not.toContain("PRIVATE");
  expect(JSON.stringify(mocks.create.mock.calls)).toContain(`/consultations/followups/${row.id}`);
});
it("never blindly replays an ambiguous create",async()=>{
  await expect(publishCaseNotice(row,true,vi.fn())).rejects.toThrow("creation_uncertain");
  expect(mocks.create).not.toHaveBeenCalled();
});
it("reconciles a lost POST response by updating the existing single page",async()=>{
  mocks.query.mockResolvedValue([{id:"existing"}]);
  expect(await publishCaseNotice(row,true,vi.fn())).toBe("existing");
  expect(mocks.update).toHaveBeenCalledOnce(); expect(mocks.create).not.toHaveBeenCalled();
});
it("refuses duplicate remote notices instead of silently picking one",async()=>{
  mocks.query.mockResolvedValue([{id:"one"},{id:"two"}]);
  await expect(publishCaseNotice(row,true,vi.fn())).rejects.toThrow("duplicate_notice");
  expect(mocks.update).not.toHaveBeenCalled();
});
