import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExpandableConnections } from "./expandable-connections";
afterEach(cleanup);
const props = { studentId: "s", title: "소통 기록", description: "확인 가능한 기록" };
it("waits for explicit expansion, preserves its keyboard button and reuses fetched data on collapse", async () => {
  const loadAction = vi.fn().mockResolvedValue({ sections: [] });
  render(<ExpandableConnections {...props} loadAction={loadAction} />);
  const button = screen.getByRole("button", { name: "기록 펼치기" });
  expect(loadAction).not.toHaveBeenCalled(); expect(button.getAttribute("aria-expanded")).toBe("false");
  button.focus(); expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole("button", { name: "접기" }).getAttribute("aria-expanded")).toBe("true"));
  fireEvent.click(screen.getByRole("button", { name: "접기" }));
  fireEvent.click(screen.getByRole("button", { name: "기록 펼치기" }));
  expect(loadAction).toHaveBeenCalledTimes(1); expect(loadAction).toHaveBeenCalledWith("s");
});
it("reports network failure, allows retry and clears stale source data on access loss", async () => {
  const loadAction = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ sections: [
    { key: "k", label: "후속조치", state: "failed", total: null, items: [], href: "/consultations" },
  ] }).mockResolvedValueOnce({ error: "열람할 수 없습니다." });
  render(<ExpandableConnections {...props} loadAction={loadAction} />);
  fireEvent.click(screen.getByRole("button", { name: "기록 펼치기" }));
  expect((await screen.findByRole("alert")).textContent).toContain("다시 시도해 주세요");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  fireEvent.click(await screen.findByRole("button", { name: "다시 불러오기" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("열람할 수 없습니다"));
  expect(screen.queryByText("후속조치")).toBeNull();
});
