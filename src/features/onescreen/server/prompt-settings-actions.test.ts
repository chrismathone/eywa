import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(()=>({gate:vi.fn(),rpc:vi.fn(),client:vi.fn(),audit:vi.fn(),generate:vi.fn(),rebuild:vi.fn()}));
vi.mock("@/features/report-admin/server/ai-ment-access",()=>({requireAiMentAccess:m.gate}));
vi.mock("@/lib/supabase/server",()=>({createClient:m.client}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:m.client}));
vi.mock("@/features/audit/server/log",()=>({logAction:m.audit}));
vi.mock("@/lib/ai/generate",()=>({generateJSON:m.generate}));
vi.mock("./ment-style-build",()=>({rebuildTenantMentStyles:m.rebuild,summarizeRebuild:vi.fn()}));
import { getActivePrompts, getPromptHistory, getRecentReportsForTest, resetPrompt, savePrompt, testPrompt } from "./prompt-actions";
import { getMentStyleRows, rebuildMentStylesNow } from "./ment-style-actions";
beforeEach(()=>{
  vi.clearAllMocks();
  m.gate.mockResolvedValue({user:{id:"u1",tenantId:"t1"}});
  m.client.mockResolvedValue({rpc:m.rpc});m.rpc.mockResolvedValue({error:null});
});
it("권한 없는 계정의 직접 요청은 조회·저장·복원·시험생성·말투 갱신 모두 거절한다",async()=>{
  m.gate.mockResolvedValue({error:"권한 없음"});
  for(const action of [()=>getActivePrompts(),()=>getPromptHistory("comment"),()=>getRecentReportsForTest(),()=>savePrompt("comment","{{facts}}"),()=>resetPrompt("comment"),()=>testPrompt("comment","{{facts}}","r1"),()=>getMentStyleRows(),()=>rebuildMentStylesNow()]) {
    expect((await action()).error).toBe("권한 없음");
  }
  expect(m.client).not.toHaveBeenCalled();expect(m.generate).not.toHaveBeenCalled();expect(m.rebuild).not.toHaveBeenCalled();
});
it("저장·복원은 쓰기 권한 검사 후 원자적 RPC를 사용한다",async()=>{
  expect(await savePrompt("comment","  새 멘트 {{facts}}  ")).toEqual({ok:true});
  expect(await resetPrompt("comment")).toEqual({ok:true});
  expect(m.gate.mock.calls).toEqual([[true],[true]]);
  expect(m.rpc.mock.calls).toEqual([
    ["save_ai_prompt_setting",{p_type:"comment",p_text:"새 멘트 {{facts}}"}],
    ["save_ai_prompt_setting",{p_type:"comment",p_text:null}],
  ]);
});
it("DB 저장 실패를 성공으로 알리거나 변경 감사로그를 남기지 않는다",async()=>{
  m.rpc.mockResolvedValue({error:{message:"권한이 회수되었습니다"}});
  expect(await savePrompt("comment","{{facts}}")).toEqual({ok:false,error:"권한이 회수되었습니다"});
  expect(m.audit).not.toHaveBeenCalled();
});
it("잘못된 유형·입력 자리표시자는 RPC 호출 전에 막는다",async()=>{
  expect((await savePrompt("unknown","{{facts}}")).ok).toBe(false);
  expect((await savePrompt("comment","입력 없음")).ok).toBe(false);
  expect(m.rpc).not.toHaveBeenCalled();
});
