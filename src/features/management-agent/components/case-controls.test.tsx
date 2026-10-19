import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("../server/actions",()=>({changeManagementCase:vi.fn()}));
vi.mock("../server/advice-action",()=>({generateManagementAdvice:vi.fn()}));
import { CaseControls } from "./case-controls";
import type { AgentCase } from "../model";
it("keeps a missing-source case actionable for a manager without offering normal completion",()=>{
  render(<CaseControls row={{id:"sample",status:"blocked",source_done:false} as AgentCase} manager />);
  expect(screen.getByRole("button",{name:"조치 불필요로 종료"})).toBeEnabled();
  expect(screen.queryByRole("button",{name:"업무 접수"})).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"근거 확인 후 종료"})).toBeDisabled();
});
it("does not offer verification to an assigned counselor",()=>{
  render(<CaseControls row={{id:"sample",status:"waiting_review",result_kind:"contacted",source_done:true} as AgentCase} manager={false} />);
  expect(screen.queryByRole("button",{name:"근거 확인 후 종료"})).not.toBeInTheDocument();
});
