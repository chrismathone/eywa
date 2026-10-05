import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { CommandForm } from "./command-form";
import { CaseDetailReloadContext } from "./case-detail-context";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";

// Real unsaved guard; only the server action and the cross-window signal are stubbed.
const calls = vi.hoisted(() => ({ execute: vi.fn(), publish: vi.fn(), reload: vi.fn() }));
vi.mock("../server/actions", () => ({ executeMakeupCommand: calls.execute }));
vi.mock("@/lib/realtime/mutation-signal", () => ({ publishMutation: calls.publish }));

const posted = vi.fn();
const dirtyMessages = () => posted.mock.calls.map(([message]) => (message as { dirty: boolean }).dirty);
function Forms({ showA = true }: { showA?: boolean }) {
  return <CaseDetailReloadContext value={{ reload: calls.reload }}>
    {showA ? <CommandForm action="assign" revision={1} label="A 저장" payload={data => ({ owner: data.get("a") })}>
      <label>A칸<input name="a" defaultValue="" /></label></CommandForm> : null}
    <CommandForm action="hold" revision={1} label="B 저장" payload={data => ({ reason: data.get("b") })}>
      <label>B칸<input name="b" defaultValue="" /></label></CommandForm>
  </CaseDetailReloadContext>;
}
async function type(name: string, value: string) {
  fireEvent.input(screen.getByRole("textbox", { name }), { target: { value } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); // guard compares on the next task
}

describe("한 창의 두 보강 폼 — 하나를 저장·닫아도 다른 폼의 미저장 경고가 남는다", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    posted.mockReset();
    // Inside a workspace window the guard reports to the parent frame.
    Object.defineProperty(window, "parent", { configurable: true, value: { postMessage: posted } });
    calls.execute.mockResolvedValue({ ok: true, result: {} });
    calls.reload.mockResolvedValue(true);
  });
  afterEach(() => { Object.defineProperty(window, "parent", { configurable: true, value: window }); });

  it("A를 저장해도 B가 작성 중이면 창은 계속 미저장이고 B의 입력값도 그대로다", async () => {
    render(<Forms />);
    await type("A칸", "담당자");
    await type("B칸", "보류 사유");
    expect(dirtyMessages()).toEqual([true]);
    fireEvent.click(screen.getByRole("button", { name: "A 저장" }));
    await screen.findByText("저장했습니다");
    await waitFor(() => expect(screen.getByRole("button", { name: "A 저장" })).toBeEnabled());
    expect(dirtyMessages()).toEqual([true]);
    expect(screen.getByRole("textbox", { name: "B칸" })).toHaveValue("보류 사유");
    fireEvent.click(screen.getByRole("button", { name: "B 저장" }));
    await waitFor(() => expect(dirtyMessages()).toEqual([true, false]));
  });

  it("작성 중인 A가 사라져도(저장 뒤 화면에서 빠짐) B가 작성 중이면 미저장을 풀지 않는다", async () => {
    const view = render(<Forms />);
    await type("A칸", "담당자");
    await type("B칸", "보류 사유");
    view.rerender(<Forms showA={false} />);
    expect(dirtyMessages()).toEqual([true]);
    await type("B칸", "");
    expect(dirtyMessages()).toEqual([true, false]);
  });

  it("group 없이 쓰는 기존 호출은 종전대로 폼마다 따로 알린다", async () => {
    function Plain({ label }: { label: string }) {
      const ref = useRef<HTMLFormElement>(null);
      const { markSaved } = useUnsavedGuard({ formRef: ref });
      return <form ref={ref}><label>{label}<input name={label} defaultValue="" /></label>
        <button type="button" onClick={markSaved}>{label} 저장</button></form>;
    }
    render(<><Plain label="P" /><Plain label="Q" /></>);
    await type("P", "x");
    await type("Q", "y");
    fireEvent.click(screen.getByRole("button", { name: "P 저장" }));
    expect(dirtyMessages()).toEqual([true, true, false]);
  });
});
