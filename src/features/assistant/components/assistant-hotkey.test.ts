import { describe, expect, it } from "vitest";
import { isPaletteHotkey } from "@/lib/palette-hotkey";
import { assistantHotkeyLabel, isAssistantHotkey } from "./assistant-hotkey";

const key = (over: Partial<KeyboardEvent>) =>
  ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: "", code: "", ...over }) as KeyboardEvent;

describe("학원 비서 단축키 — Ctrl/⌘+J", () => {
  it("Ctrl+J · ⌘J", () => {
    expect(isAssistantHotkey(key({ ctrlKey: true, key: "j", code: "KeyJ" }))).toBe(true);
    expect(isAssistantHotkey(key({ metaKey: true, key: "J", code: "KeyJ" }))).toBe(true);
  });
  it("한글 입력 상태(key = ㅓ)도 자판 위치로 잡는다", () => {
    expect(isAssistantHotkey(key({ ctrlKey: true, key: "ㅓ", code: "KeyJ" }))).toBe(true);
  });
  it("Shift·Alt가 섞이거나 수식키가 없으면 아니다(Ctrl+Shift+J = 개발자 도구)", () => {
    expect(isAssistantHotkey(key({ ctrlKey: true, shiftKey: true, key: "J", code: "KeyJ" }))).toBe(false);
    expect(isAssistantHotkey(key({ ctrlKey: true, altKey: true, key: "j", code: "KeyJ" }))).toBe(false);
    expect(isAssistantHotkey(key({ key: "j", code: "KeyJ" }))).toBe(false);
    expect(isAssistantHotkey(key({ ctrlKey: true, key: "k", code: "KeyK" }))).toBe(false);
  });
  it("🔴 검색 팰릿 단축키와 겹치지 않는다", () => {
    const ours = key({ ctrlKey: true, key: "j", code: "KeyJ" });
    expect(isPaletteHotkey(ours)).toBe(false);
    for (const theirs of [key({ ctrlKey: true, key: "k", code: "KeyK" }), key({ shiftKey: true, key: "F", code: "KeyF" })]) {
      expect(isAssistantHotkey(theirs)).toBe(false);
    }
  });
  it("표시 글자", () => {
    expect(assistantHotkeyLabel("MacIntel")).toBe("⌘J");
    expect(assistantHotkeyLabel("Win32")).toBe("Ctrl+J");
    expect(assistantHotkeyLabel(undefined)).toBe("Ctrl+J");
  });
});
