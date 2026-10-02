import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({user:{id:"u1",tenantId:"t1",email:"test@example.com",systemRole:"admin"} as object|null,enabled:true,read:vi.fn(),write:vi.fn()}));
vi.mock("@/lib/auth/current-user",()=>({getCurrentUser:async()=>m.user}));
vi.mock("@/lib/license/server",()=>({isFeatureOptedIn:async()=>m.enabled}));
vi.mock("@/lib/auth/perm-matrix",()=>({canAccessTenant:m.read,canWriteTenant:m.write}));
vi.mock("./store",()=>({loadConnection:vi.fn()}));
import { slackGate } from "./gate";
beforeEach(()=>{vi.clearAllMocks();m.user={id:"u1",tenantId:"t1",email:"test@example.com",systemRole:"admin"};m.enabled=true;m.read.mockResolvedValue(true);m.write.mockResolvedValue(false);});
it("연동 조회 전용 역할은 상태를 읽지만 연결 설정을 변경하지 못한다",async()=>{
  expect(await slackGate(false)).toMatchObject({tenantId:"t1",userId:"u1"});
  expect(await slackGate()).toHaveProperty("error");
  expect(m.read).toHaveBeenCalledWith("admin","integration_settings");
  expect(m.write).toHaveBeenCalledWith("admin","integration_settings");
});
it("위임받은 관리자는 설정하고 꺼진 지점에서는 여전히 차단한다",async()=>{
  m.write.mockResolvedValue(true);
  expect(await slackGate()).toMatchObject({tenantId:"t1"});
  m.enabled=false;
  expect(await slackGate()).toHaveProperty("error");
  expect(await slackGate(false)).toHaveProperty("error");
});
it("로그인하지 않으면 조회도 거부한다",async()=>{
  m.user=null;
  expect(await slackGate(false)).toHaveProperty("error");
  expect(m.read).not.toHaveBeenCalled();
});
