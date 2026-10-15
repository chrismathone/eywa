import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { PermissionsSettings } from "@/features/owner/settings-types";
import { StudentStatusAccessEditor } from "./student-status-access-editor";
const A = "11111111-1111-4111-8111-111111111111";
const H = "99999999-9999-4999-8999-999999999999";
const names: Record<string, string> = { [A]: "Office", [H]: "Hidden" };
type Special = PermissionsSettings["specialAccess"];
function Fixture({ initial = {} }: { initial?: Partial<Special> }) {
  const [value, setValue] = useState<Special>({ payslipViewerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [], ...initial });
  return <><StudentStatusAccessEditor value={value} hiddenUserIds={[H]}
    staffOptions={[{ id: A, name: "Office", role: "admin" }, { id: H, name: "Hidden", role: "admin" }, { id: "teacher", name: "Teacher", role: "teacher" }]}
    nameOf={(id) => names[id] ?? id} onChange={setValue} /><output data-testid="saved">{JSON.stringify(value)}</output></>;
}
const saved = () => JSON.parse(screen.getByTestId("saved").textContent!);
afterEach(cleanup);
it("legacy remains absent until explicit owner transition, then add/remove persist as explicit empty", () => {
  render(<Fixture />);
  expect(saved()).not.toHaveProperty("studentStatusManagerIds");
  fireEvent.click(screen.getByRole("button", { name: "담당자 지정으로 전환" }));
  expect(saved().studentStatusManagerIds).toEqual([]);
  expect(screen.getByText(/수강 날짜 수정과 반 이동/)).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Teacher" })).toBeNull(); expect(screen.queryByRole("option", { name: "Hidden" })).toBeNull();
  fireEvent.change(screen.getByLabelText("원생 상태 변경 담당자 선택"), { target: { value: A } });
  fireEvent.click(screen.getByRole("button", { name: "원생 상태 변경 담당자 추가" }));
  expect(saved().studentStatusManagerIds).toEqual([A]);
  fireEvent.click(screen.getByRole("button", { name: "Office 원생 상태 변경 해제" }));
  expect(saved().studentStatusManagerIds).toEqual([]);
});
it("hidden existing assignments survive visible removal", () => {
  render(<Fixture initial={{ studentStatusManagerIds: [H, A] }} />);
  expect(screen.queryByRole("button", { name: "Hidden 원생 상태 변경 해제" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Office 원생 상태 변경 해제" }));
  expect(saved().studentStatusManagerIds).toEqual([H]);
});
