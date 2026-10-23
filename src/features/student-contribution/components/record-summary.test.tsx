import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, useTransition } from "react";
const m = vi.hoisted(() => ({ generate: vi.fn(), refresh: vi.fn() }));
vi.mock("../server/summary-actions", () => ({ generateStudentRecordSummary: m.generate }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/components/embed-link", () => ({ EmbedLink: "a" }));
import { RecordSummary } from "./record-summary";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const data = { state: "empty" as const, canWrite: true, items: [], generatedAt: null, model: null, partial: false };
it("allows another view transition while AI is pending and blocks duplicate calls", async () => {
  let finish!: (result: { ok: true }) => void;
  m.generate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  function Shell() {
    const [view, setView] = useState("처음"), [, start] = useTransition();
    return <><button onClick={() => start(() => setView("다른 화면"))}>이동</button><p>{view}</p><RecordSummary studentId="s" data={data} /></>;
  }
  render(<Shell />);
  fireEvent.click(screen.getByRole("button", { name: "최근 기록 요약하기" }));
  fireEvent.click(screen.getByRole("button", { name: "요약하는 중…" }));
  fireEvent.click(screen.getByRole("button", { name: "이동" }));
  await waitFor(() => expect(screen.queryByText("다른 화면")).not.toBeNull());
  expect(m.generate).toHaveBeenCalledTimes(1); expect(m.refresh).not.toHaveBeenCalled();
  await act(async () => { finish({ ok: true }); });
  expect(screen.getByRole("status").textContent).toBe("요약을 저장했습니다.");
  expect(m.refresh).toHaveBeenCalledOnce();
});
