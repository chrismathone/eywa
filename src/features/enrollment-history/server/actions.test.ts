import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(()=>({user:vi.fn(),level:vi.fn(),settings:vi.fn(),calendar:vi.fn(),paged:vi.fn(),db:vi.fn(),module:vi.fn()}));
vi.mock("@/lib/auth/current-user",()=>({getCurrentUser:m.user}));
vi.mock("@/lib/auth/perm-matrix",()=>({accessLevelTenant:m.level}));
vi.mock("@/features/owner/server/queries",()=>({getTenantSettings:m.settings}));
vi.mock("@/lib/supabase/server",()=>({createClient:m.db}));
vi.mock("@/lib/supabase/batch",()=>({fetchAllPaged:m.paged}));
vi.mock("@/lib/modules",()=>({isModuleEnabled:m.module}));
vi.mock("./google",()=>({cachedGoogleHistory:m.calendar,HISTORY_START:"2000-01-01"}));
import { checkEnrollmentHistory } from "./actions";
const input={name:"테스트학생",phones:["01000000001"]};
beforeEach(()=>{
  vi.clearAllMocks();m.user.mockResolvedValue({id:"user",tenantId:"academy",systemRole:"master"});m.level.mockResolvedValue("full");
  m.settings.mockResolvedValue({modules:{disabled:[]}});m.module.mockReturnValue(true);
  m.db.mockResolvedValue({});m.paged.mockResolvedValue([]);m.calendar.mockResolvedValue({events:[],complete:true,message:null});
});
it("rejects anonymous requests before reaching shared calendars",async()=>{
  m.user.mockResolvedValue(null);expect(await checkEnrollmentHistory(input)).toHaveProperty("error");expect(m.calendar).not.toHaveBeenCalled();
});
it("does not widen scoped staff access to historical admission records",async()=>{
  m.level.mockResolvedValue("scoped");expect(await checkEnrollmentHistory(input)).toHaveProperty("error");expect(m.db).not.toHaveBeenCalled();
});
it("honors disabled calendar module",async()=>{
  m.module.mockReturnValue(false);expect(await checkEnrollmentHistory(input)).toHaveProperty("error");expect(m.calendar).not.toHaveBeenCalled();
});
it("uses session tenant and distinguishes registration failure from no evidence",async()=>{
  m.paged.mockRejectedValue(new Error("private DB error"));
  const r=await checkEnrollmentHistory({...input,tenantId:"attacker"});
  expect(r).toHaveProperty("registration","unavailable");expect(m.calendar.mock.calls[0][0]).toBe("academy");
  expect(JSON.stringify(r)).not.toContain("private DB");
});
