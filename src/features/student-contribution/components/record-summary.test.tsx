import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, useTransition } from "react";
const m = vi.hoisted(() => ({ generate: vi.fn(), refresh: vi.fn() }));
vi.mock("../server/summary-actions", () => ({ generateStudentRecordSummary: m.generate }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/components/embed-link", () => ({ EmbedLink: "a" }));
import { RecordSummary } from "./record-summary";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const data = { state: "empty" as const, canWrite: true, items: [], generatedAt: null, model: null, partial: false, legacy: false };
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
const saved = { ...data, state: "ready" as const, generatedAt: "2026-10-23T06:07:33Z", model: "Claude Haiku",
  items: [{ itemId: "consultations:1", title: "최근 상담", date: "2026-02-26", summary: "상담 당시 영어 수업을 계속할 의향을 밝혔습니다.", excerpt: "학생이 영어 수업을 계속하고 싶다고 말했습니다.", href: "/consultations/1" }] };
it("shows the summary as the primary text with its source behind a disclosure", () => {
  render(<RecordSummary studentId="s" data={saved} />);
  expect(screen.getByText(saved.items[0].summary)).toBeTruthy();
  const quote = screen.getByText(saved.items[0].excerpt);
  expect(quote.closest("details")?.open).toBe(false);
});
it("labels legacy extracts instead of presenting them as newly generated summaries", () => {
  render(<RecordSummary studentId="s" data={{ ...saved, legacy: true, items: [{ ...saved.items[0], summary: null }] }} />);
  expect(screen.getByText(/이전 방식으로 저장된 원문 발췌/)).toBeTruthy();
});
it("keeps the saved summary visible and explains that a retry failed", async () => {
  m.generate.mockResolvedValue({ error: "생성된 요약의 확인을 통과하지 못했습니다." });
  render(<RecordSummary studentId="s" data={saved} />);
  fireEvent.click(screen.getByRole("button", { name: "다시 요약" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("이전에 저장한 내용"));
  expect(screen.getByText(saved.items[0].summary)).toBeTruthy();
  expect(m.refresh).not.toHaveBeenCalled();
});
