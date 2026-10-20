import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const check = vi.hoisted(()=>vi.fn());
vi.mock("./server/actions",()=>({checkEnrollmentHistory:check}));
import { EnrollmentHistoryCheck } from "./history-check";
beforeEach(()=>{ check.mockReset(); });
it("checks a saved consultation automatically and displays an unavailable source honestly",async()=>{
  check.mockResolvedValue({error:"연결을 확인해 주세요"});
  render(<EnrollmentHistoryCheck identity={{name:"테스트학생",phones:["01000000001"]}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("연결을 확인");
  expect(check).toHaveBeenCalledOnce();
});
it("reads the current form and discards a stale response after identity changes",async()=>{
  let resolve!: (value: unknown) => void;
  check.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const ref=createRef<HTMLFormElement>();
  render(<form ref={ref}><input aria-label="학생 이름" name="prospectName" defaultValue="테스트학생" />
    <input name="parentPhone" defaultValue="01000000001" /><EnrollmentHistoryCheck formRef={ref} /></form>);
  fireEvent.click(screen.getByRole("button",{name:"이전 상담 확인"}));
  await waitFor(()=>expect(check).toHaveBeenCalledWith({name:"테스트학생",phones:["01000000001",""]}));
  fireEvent.input(screen.getByLabelText("학생 이름"),{target:{value:"다른학생"}});
  resolve({error:"OLD RESULT MUST NOT APPEAR"});
  await waitFor(()=>expect(screen.getByRole("button",{name:"이전 상담 확인"})).not.toBeDisabled());
  expect(screen.queryByText("OLD RESULT MUST NOT APPEAR")).not.toBeInTheDocument();
});
