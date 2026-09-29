import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { MenuMentionEditorImpl } from "@/components/editor/menu-mention-editor-impl";
import { NavigationProvider } from "./navigation-context";
import { menuMentionToken } from "./menu-mentions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/realtime/record-channel", () => ({ subscribeRecordSaved: () => () => {} }));
afterEach(cleanup);

async function editable() {
  const element = await screen.findByRole("textbox", { name: "내용" });
  // Tiptap가 자신의 view DOM에 공개하는 인스턴스로 편집 명령을 실행한다.
  return { element, editor: (element as HTMLElement & { editor: Editor }).editor };
}

describe("실제 @메뉴 작성 편집기", () => {
  it("@ 기본 이름 검색 → 현재 이름 후보 → Enter 선택 → 기본 목적지로 저장한다", async () => {
    const onChange = vi.fn();
    render(<NavigationProvider menus={[{ href: "/timetable", label: "우리 일정" }]}><MenuMentionEditorImpl onChange={onChange} /></NavigationProvider>);
    const { element, editor } = await editable();
    act(() => { editor.commands.insertContent("@시간"); });
    await screen.findByRole("option", { name: /우리 일정.*시간표/ });
    fireEvent.keyDown(element, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(`${menuMentionToken("/timetable")} `));
    expect(element.querySelectorAll('[data-menu-href="/timetable"]')).toHaveLength(1);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByText(/메뉴를 설명할 때는/)).toBeInTheDocument();
  });
  it("기존 참조를 원자 칩으로 읽고 같은 글에서 지점 이름 갱신을 반영한다", async () => {
    const token = menuMentionToken("/timetable");
    const { rerender } = render(<NavigationProvider menus={[]}><MenuMentionEditorImpl defaultValue={`${token} 공지`} /></NavigationProvider>);
    const { element, editor } = await editable();
    expect(element).toHaveTextContent("@시간표 공지");
    rerender(<NavigationProvider menus={[{ href: "/timetable", label: "주간 계획" }]}><MenuMentionEditorImpl defaultValue={`${token} 공지`} /></NavigationProvider>);
    await waitFor(() => expect(element).toHaveTextContent("@주간 계획 공지"));
    expect(editor.getText({ blockSeparator: "\n" })).toBe(`${token} 공지`);
    const first = editor.state.doc.firstChild?.firstChild;
    expect(first?.isAtom).toBe(true);
  });
  it("문장 중간에 참조를 붙여넣어도 문단이나 주변 글을 바꾸지 않는다", async () => {
    const onChange = vi.fn();
    render(<MenuMentionEditorImpl defaultValue="앞 뒤" onChange={onChange} />);
    const { element, editor } = await editable();
    act(() => { editor.commands.setTextSelection(3); });
    fireEvent.paste(element, { clipboardData: { getData: () => menuMentionToken("/timetable") } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(`앞 ${menuMentionToken("/timetable")}뒤`));
  });
  it("이메일은 자동완성하지 않고 IME Enter와 Esc는 참조로 바꾸지 않는다", async () => {
    render(<MenuMentionEditorImpl />);
    const { element, editor } = await editable();
    act(() => { editor.commands.insertContent("staff@example.com"); });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    act(() => { editor.commands.insertContent(" @시간"); });
    await screen.findByRole("listbox");
    fireEvent.keyDown(element, { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });
    expect(element.querySelector("[data-menu-href]")).toBeNull();
    fireEvent.keyDown(element, { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
