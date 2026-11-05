import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CaseDetailView } from "./case-detail-view";
import { CommandForm } from "./command-form";
import { ReasonField, formText } from "./form-fields";
import { caseRow, detail, periods, uuid } from "./ui-test-fixtures";

const calls = vi.hoisted(() => ({ events: vi.fn(), reload: vi.fn(), command: vi.fn() }));
vi.mock("../server/actions", () => ({ loadMakeupEvents: calls.events, reloadMakeupCaseDetail: calls.reload, executeMakeupCommand: calls.command }));
vi.mock("@/lib/realtime/mutation-signal", () => ({ publishMutation: vi.fn() }));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({ useUnsavedGuard: () => ({ markSaved: vi.fn() }) }));
vi.mock("./reconciliation-panel", () => ({ ReconciliationPanel: () => null }));
vi.mock("./session-operations", () => ({ SessionOperations: () => null }));
vi.mock("./session-fields", () => ({ SessionFields: () => <input name="session_date" defaultValue="2026-10-05" /> }));
vi.mock("./option-picker", () => ({ OptionPicker: () => null }));
vi.mock("./case-decisions", () => ({ CaseDecisions: () => <>
  <CommandForm action="assign" label="담당 저장" payload={data => ({ reason: formText(data, "reason") })}><ReasonField label="저장할 메모" /></CommandForm>
  <CommandForm action="adjust" label="초안 저장" payload={() => ({})}><ReasonField label="다른 폼 초안" /></CommandForm>
</> }));

const page = (reason: string, number: number) => ({ data: { rows: [{ id: uuid(20), event_type: "assigned", actor_name: "담당",
  reason, occurred_at: "2026-10-05T00:00:00Z" }], total: 60, page_size: 30, page: number } });
beforeEach(() => vi.resetAllMocks());

it("실제 폼 저장 → 상세 재조회 → 열린 이력 2페이지 갱신, 최신 배정 한도와 형제 초안 유지", async () => {
  calls.command.mockResolvedValue({ ok: true, result: {} });
  calls.events.mockResolvedValueOnce(page("이력 첫 페이지", 1)).mockResolvedValueOnce(page("이력 둘째 페이지", 2))
    .mockResolvedValueOnce(page("저장 후 최신 이력", 2));
  const initial = detail();
  calls.reload.mockResolvedValue({ data: { ...initial, case: { ...initial.case, ...caseRow({ reservable_minutes: 120, revision: 2 }) } } });
  render(<CaseDetailView initial={initial} periods={periods} actorId={uuid(4)} reserveOn canWrite recordView="teacher" />);
  const history = screen.getByText("변경 이력").closest("details")!;
  act(() => { history.open = true; fireEvent(history, new Event("toggle")); });
  await screen.findByText("이력 첫 페이지");
  fireEvent.click(screen.getByRole("button", { name: "변경 이력 다음 페이지" })); await screen.findByText("이력 둘째 페이지");
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "150" } });
  fireEvent.change(screen.getByRole("textbox", { name: "다른 폼 초안" }), { target: { value: "작성 중 초안" } });
  fireEvent.change(screen.getByRole("textbox", { name: "저장할 메모" }), { target: { value: "저장한 메모" } });
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "담당 저장" }).closest("form")!); });
  await screen.findByText("저장 후 최신 이력");
  expect(calls.reload).toHaveBeenCalledWith({ case_id: uuid(1) });
  expect(calls.events).toHaveBeenLastCalledWith({ case_id: uuid(1), page: 2 });
  expect(screen.getByRole("spinbutton")).toHaveValue(150);
  expect(screen.getByRole("spinbutton")).toHaveAttribute("max", "120");
  expect(screen.getByText(/입력한 분량이 현재 예약 가능량을/)).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "다른 폼 초안" })).toHaveValue("작성 중 초안");
});
