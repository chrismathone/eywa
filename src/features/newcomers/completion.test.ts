import {describe,it,expect,vi,beforeEach} from "vitest";
import {completionMemo} from "./completion";
const mocks=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),db:vi.fn()}));
vi.mock("@/lib/auth/current-user",()=>({getCurrentUser:mocks.user}));
vi.mock("@/lib/auth/perm-matrix",()=>({canWriteTenant:mocks.access}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mocks.db}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/features/audit/server/log",()=>({logAction:vi.fn()}));
vi.mock("@/lib/date-kst",()=>({kstToday:()=>"2026-11-02"}));
import {setOnboardingCheck} from "./server/actions";
const completion={action:"적응 전화",result:"학부모 확인",next:""};
beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({id:"teacher",tenantId:"tenant",systemRole:"teacher"});mocks.access.mockResolvedValue(true);});
describe("신입생 완료 증거",()=>{
  it("결과 없는 완료를 거부하고 최대 길이가 기존 메모 한도에 맞는다",()=>{
    expect(()=>completionMemo({action:"전화",result:" ",next:""})).toThrow();
    expect(completionMemo({action:"가".repeat(80),result:"나".repeat(120),next:"다".repeat(60)}).length).toBeLessThanOrEqual(300);
  });
  it("빈 증거와 미래 수행일은 DB 변경 전에 거절한다",async()=>{
    expect((await setOnboardingCheck({studentId:"student",itemKey:"pre_call",done:true})).ok).toBe(false);
    expect((await setOnboardingCheck({studentId:"student",itemKey:"pre_call",done:true,completion,doneOn:"2026-11-03"})).ok).toBe(false);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("쓰기 권한 없는 계정과 다른 지점 보기에서는 완료를 바꿀 수 없다",async()=>{
    mocks.access.mockResolvedValue(false);
    expect((await setOnboardingCheck({studentId:"student",itemKey:"pre_call",done:true,completion})).ok).toBe(false);
    mocks.access.mockResolvedValue(true);mocks.user.mockResolvedValue({id:"admin",tenantId:"tenant",systemRole:"master",tenantView:{}});
    expect((await setOnboardingCheck({studentId:"student",itemKey:"pre_call",done:true,completion})).ok).toBe(false);
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
