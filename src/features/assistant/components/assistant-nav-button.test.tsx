import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setAssistantBusy } from "./assistant-hotkey";
import { AssistantNavButton } from "./assistant-nav-button";

afterEach(() => {
  act(() => setAssistantBusy(0));
  cleanup();
});

describe("학원 비서 버튼 — 답을 만드는 중이면 도는 테두리(원장 2026-11-09)", () => {
  it("평소엔 테두리 없음 · 런처가 수를 알리면 테두리 + 낭독 문구 · 0이면 다시 없음", () => {
    render(<AssistantNavButton />);
    const button = screen.getByRole("button", { name: "학원 비서 열기" });
    expect(button.querySelector("[data-assistant-busy-ring]")).toBeNull();

    act(() => setAssistantBusy(2));
    expect(screen.getByRole("button", { name: "학원 비서 열기 — 답을 2개 만드는 중" }).querySelector("[data-assistant-busy-ring]")).not.toBeNull();

    act(() => setAssistantBusy(0));
    expect(screen.getByRole("button", { name: "학원 비서 열기" }).querySelector("[data-assistant-busy-ring]")).toBeNull();
  });
});
