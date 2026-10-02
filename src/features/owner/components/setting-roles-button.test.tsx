import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settingRoleSelection } from "../setting-roles";
const m = vi.hoisted(() => ({ save:vi.fn(), refresh:vi.fn(), error:vi.fn(), success:vi.fn() }));
vi.mock("../server/setting-role-actions",()=>({saveSettingRoles:m.save}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:m.refresh})}));
vi.mock("sonner",()=>({toast:{error:m.error,success:m.success}}));
import { SettingRolesButton } from "./setting-roles-button";
const initial = settingRoleSelection("lesson_reports",[]);
beforeEach(()=>{vi.clearAllMocks();m.save.mockResolvedValue({selection:initial});});
afterEach(cleanup);
it("원장은 고정하고 보고서와 AI 역할을 각각 저장한다",async()=>{
  const u=userEvent.setup();render(<SettingRolesButton group="lesson_reports" initial={initial}/>);
  await u.click(screen.getByRole("button",{name:"역할 설정"}));
  expect(screen.getByRole("checkbox",{name:"보고서 설정 · 원장"})).toBeDisabled();
  await u.click(screen.getByRole("checkbox",{name:"보고서 설정 · 관리자"}));
  await u.click(screen.getByRole("button",{name:"저장"}));
  await waitFor(()=>expect(m.save).toHaveBeenCalledWith("lesson_reports",{report_settings:["master","admin"],ai_ment:["master"]},JSON.stringify(initial)));
  expect(m.refresh).toHaveBeenCalledOnce();
});
it("실패하면 창과 선택을 유지하고 성공이라고 알리지 않는다",async()=>{
  const u=userEvent.setup();m.save.mockResolvedValue({error:"다른 창에서 변경했습니다"});
  render(<SettingRolesButton group="lesson_reports" initial={initial}/>);
  await u.click(screen.getByRole("button",{name:"역할 설정"}));
  await u.click(screen.getByRole("checkbox",{name:"AI 멘트 · 관리자"}));
  await u.click(screen.getByRole("button",{name:"저장"}));
  await waitFor(()=>expect(m.error).toHaveBeenCalled());
  expect(screen.getByRole("checkbox",{name:"AI 멘트 · 관리자"})).toBeChecked();
  expect(m.success).not.toHaveBeenCalled();expect(m.refresh).not.toHaveBeenCalled();
});
it("취소는 저장하지 않으며 꺼진 기능은 역할 목록에도 보이지 않는다",async()=>{
  const u=userEvent.setup();render(<SettingRolesButton group="lesson_reports" initial={initial} hidden={["ai_ment"]}/>);
  await u.click(screen.getByRole("button",{name:"역할 설정"}));
  expect(screen.queryByRole("checkbox",{name:"AI 멘트 · 관리자"})).not.toBeInTheDocument();
  await u.click(screen.getByRole("button",{name:"취소"}));
  expect(m.save).not.toHaveBeenCalled();
});
