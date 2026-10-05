import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParticipationForm, SubmissionForm } from "./participation-form";
import { fulfillment, participant, session, uuid } from "./ui-test-fixtures";

const calls = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../server/actions", () => ({ executeMakeupCommand: calls.command }));
vi.mock("@/lib/realtime/mutation-signal", () => ({ publishMutation: vi.fn() }));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({ useUnsavedGuard: () => ({ markSaved: vi.fn() }) }));
vi.mock("./option-picker", () => ({ OptionPicker: ({ initial, name, label }: { initial?: { id: string; name: string }; name: string; label: string }) =>
  <label>{label}<select name={name} defaultValue={initial?.id ?? ""}><option value="">선택</option>
    {initial ? <option value={initial.id}>{initial.name}</option> : null}</select></label> }));

describe("실시 근거 입력", () => {
  beforeEach(() => vi.resetAllMocks());
  it("부분 참여와 최신 활성 실시 근거를 채우고 열기만 해서는 저장하지 않는다", () => {
    const records = [fulfillment({ version: 2, learning_summary: "최신 지도", homework: "최신 과제" }),
      fulfillment({ id: uuid(10), version: 1, state: "reversed", learning_summary: "정정된 이전 지도" })];
    render(<ParticipationForm participant={participant({ status: "partial", actual_minutes: 30 })} session={session()} {...{ fulfillments: records }} />);
    expect(screen.getByRole("combobox", { name: "참여 결과" })).toHaveValue("partial");
    expect(screen.getByRole("textbox", { name: "실제 지도 범위·분량 확인" })).toHaveValue("최신 지도");
    expect(screen.getByRole("combobox", { name: "실제 지도한 보강 보고서" })).toHaveValue(uuid(9));
    expect(screen.getByText("최신 과제", { exact: false })).toBeTruthy();
    expect(calls.command).not.toHaveBeenCalled();
  });
  it("불참으로 저장한 참여는 불참 상태로 연다", () => {
    render(<ParticipationForm participant={participant({ status: "no_show" })} session={session()} />);
    expect(screen.getByRole("combobox", { name: "참여 결과" })).toHaveValue("no_show");
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
  it("정정된 기록만 있으면 이전 근거는 읽기 전용이고 새 입력은 비워 둔다", () => {
    render(<ParticipationForm participant={participant({ status: "partial", actual_minutes: 30, attendance_record_id: uuid(12) })}
      session={session()} {...{ fulfillments: [fulfillment({ state: "reversed" })] }} />);
    expect(screen.getByRole("textbox", { name: "실제 지도 범위·분량 확인" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "실제 지도한 보강 보고서" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "실제 출결 기록" })).toHaveValue("");
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
    expect(screen.getByText(/이전 실시 기록/)).toBeTruthy();
    expect(screen.getByText("저장한 지도 내용")).toBeTruthy();
    expect(calls.command).not.toHaveBeenCalled();
  });
  it("검토 제출은 활성 기록의 보고서·지도·과제를 채운다", () => {
    render(<SubmissionForm participant={participant({ status: "partial" })} session={session()} revision={1}
      {...{ fulfillments: [fulfillment({ state: "returned" })] }} />);
    expect(screen.getByRole("textbox", { name: "지도 범위·실시 근거" })).toHaveValue("저장한 지도 내용");
    expect(screen.getByRole("textbox", { name: "과제·후속 지도" })).toHaveValue("저장한 과제");
    expect(screen.getByRole("combobox", { name: "기존 수업보고서" })).toHaveValue(uuid(9));
  });
  it("검토 제출에서 새 근거를 쓰지 않아도 서버에 제출 요청을 보낸다", async () => {
    calls.command.mockResolvedValue({ ok: true, result: {} });
    render(<SubmissionForm participant={participant({ status: "partial" })} session={session()} revision={1} />);
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "검토 제출" }).closest("form")!); });
    expect(calls.command).toHaveBeenCalledWith(expect.objectContaining({ action: "submit", payload: expect.objectContaining({
      participant_id: uuid(7), report_id: null, learning_summary: "", homework: "",
    }) }), expect.anything());
  });
  it("상세가 갱신되어도 작성 중인 참여 근거를 덮지 않는다", () => {
    const view = (summary: string) => <ParticipationForm participant={participant({ status: "partial" })} session={session()}
      {...{ fulfillments: [fulfillment({ learning_summary: summary })] }} />;
    const rendered = render(view("저장한 내용"));
    fireEvent.change(screen.getByRole("textbox", { name: "실제 지도 범위·분량 확인" }), { target: { value: "작성 중" } });
    rendered.rerender(view("다른 저장 내용"));
    expect(screen.getByRole("textbox", { name: "실제 지도 범위·분량 확인" })).toHaveValue("작성 중");
  });
});
