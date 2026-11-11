import {beforeEach,describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({gate:vi.fn(),user:vi.fn(),read:vi.fn(),write:vi.fn(),readonly:vi.fn(),db:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/features/teacher-portfolio/server/queries",()=>({getPortfolioGate:mock.gate}));
vi.mock("@/lib/auth/current-user",()=>({getCurrentUser:mock.user}));
vi.mock("@/lib/auth/perm-matrix",()=>({canAccessTenant:mock.read,canWriteTenant:mock.write}));
vi.mock("@/lib/auth/view-as",()=>({readonlyTeacherViewError:mock.readonly}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mock.db}));
import {teacherHubAccess,loadTeacherHub,saveTeacherCapacity} from "./server";
describe("teacher hub owner boundary",()=>{
 beforeEach(()=>{vi.clearAllMocks();mock.gate.mockResolvedValue({tenantId:"t",userId:"u"});mock.user.mockResolvedValue({id:"u",tenantId:"t",systemRole:"master"});mock.read.mockResolvedValue(true);mock.write.mockResolvedValue(true);mock.readonly.mockResolvedValue(null);});
 it("reuses portfolio authorization before any data read",async()=>{mock.gate.mockResolvedValue(null);await expect(loadTeacherHub()).rejects.toMatchObject({status:403});expect(mock.db).not.toHaveBeenCalled();});
 it("denies a teacher even if a mocked portfolio gate permits it",async()=>{mock.user.mockResolvedValue({id:"u",tenantId:"t",systemRole:"teacher"});await expect(teacherHubAccess()).rejects.toMatchObject({status:403});});
 it("blocks tenant-view, tenant mismatch and missing student permission",async()=>{mock.user.mockResolvedValue({id:"u",tenantId:"other",systemRole:"master"});await expect(teacherHubAccess()).rejects.toMatchObject({status:403});mock.user.mockResolvedValue({id:"u",tenantId:"t",systemRole:"master",tenantView:{}});await expect(teacherHubAccess()).rejects.toMatchObject({status:403});mock.user.mockResolvedValue({id:"u",tenantId:"t",systemRole:"master"});mock.read.mockResolvedValue(false);await expect(teacherHubAccess()).rejects.toMatchObject({status:403});});
 it("blocks read-only writes and never opens the DB",async()=>{mock.readonly.mockResolvedValue("보기 전용");await expect(teacherHubAccess(true)).rejects.toMatchObject({status:403});expect(mock.db).not.toHaveBeenCalled();});
 it("rejects invalid object IDs and months before querying",async()=>{await expect(loadTeacherHub({teacherId:"other-tenant"})).rejects.toMatchObject({status:404});await expect(loadTeacherHub({month:"2026-99"})).rejects.toMatchObject({status:400});expect(mock.db).not.toHaveBeenCalled();});
 it("does not let a caller choose the tenant or actor in a save",async()=>{await expect(saveTeacherCapacity({tenantId:"foreign",actor:"owner"})).rejects.toThrow();expect(mock.db).not.toHaveBeenCalled();});
});
