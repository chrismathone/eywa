// @vitest-environment node
import {beforeEach,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({user:vi.fn(),read:vi.fn(),write:vi.fn(),readonly:vi.fn(),target:vi.fn(),rpc:vi.fn(),eq:vi.fn()}));
vi.mock("@/lib/auth/current-user",()=>({getCurrentUser:m.user}));
vi.mock("@/lib/auth/perm-matrix",()=>({canAccessTenant:m.read,canWriteTenant:m.write}));
vi.mock("@/lib/auth/view-as",()=>({readonlyTeacherViewError:m.readonly}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:m.rpc})}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({from:()=>({select:()=>{const q={eq:m.eq,maybeSingle:m.target};m.eq.mockReturnValue(q);return q;}})})}));
vi.mock("@/features/students/server/enrollment-gate",()=>({canSeeStudentEnrollment:vi.fn()}));
vi.mock("@/lib/date-kst",()=>({kstToday:()=>"2026-11-03",kstDateOf:()=>null}));
import {saveJourney} from "./server";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const input=()=>({id:id(1),consultationId:id(2),expectedVersion:0,voided:false,reason:"",document:{kind:"visit",status:"completed",purpose:"new",happenedOn:"2026-11-02",scheduledOn:null,ownerId:id(9),evidence:"방문 면담 확인",sourceUrl:"",nextAction:"",nextDue:null,nextDoneOn:null}});
beforeEach(()=>{vi.clearAllMocks();m.user.mockResolvedValue({id:id(9),tenantId:id(8),systemRole:"manager"});m.read.mockResolvedValue(true);m.write.mockResolvedValue(true);m.readonly.mockResolvedValue(null);m.target.mockResolvedValue({data:{id:id(2)},error:null});m.rpc.mockResolvedValue({data:1,error:null});});
it("학원·작성자는 로그인 세션에서 정하고 상담 접근 범위를 확인한다",async()=>{await saveJourney(input());expect(m.eq).toHaveBeenCalledWith("tenant_id",id(8));expect(m.eq).toHaveBeenCalledWith("id",id(2));expect(m.rpc).toHaveBeenCalledWith("save_enrollment_journey",expect.objectContaining({p_tenant:id(8),p_actor:id(9)}));});
it.each(["login","read","write","teacherView","tenantView","target"])("권한 경계를 우회하지 않는다: %s",async kind=>{if(kind==="login")m.user.mockResolvedValue(null);if(kind==="read")m.read.mockResolvedValue(false);if(kind==="write")m.write.mockResolvedValue(false);if(kind==="teacherView")m.readonly.mockResolvedValue("읽기 전용");if(kind==="tenantView")m.user.mockResolvedValue({id:id(9),tenantId:id(8),systemRole:"master",tenantView:{tenantId:id(8)}});if(kind==="target")m.target.mockResolvedValue({data:null,error:null});await expect(saveJourney(input())).rejects.toThrow();expect(m.rpc).not.toHaveBeenCalled();});
it("미래 실적은 DB 호출 전에 차단한다",async()=>{const v=input();v.document.happenedOn="2026-11-04";await expect(saveJourney(v)).rejects.toThrow("미래");expect(m.rpc).not.toHaveBeenCalled();});
it("동시 수정 충돌은 성공으로 표시하지 않는다",async()=>{m.rpc.mockResolvedValue({data:null,error:{code:"40001",message:"conflict"}});await expect(saveJourney(input())).rejects.toThrow("다른 담당자");});
