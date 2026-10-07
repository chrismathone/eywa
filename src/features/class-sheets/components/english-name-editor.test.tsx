import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SheetLangProvider } from "@/features/teacher-view/lang-context";
import { EnglishNameProvider } from "./english-name-context";
import { RosterNameCell, type StudentMeta } from "./roster-slot-cells";
import type { RosterEntry } from "../lib/grid";

const m = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn(), navigate: vi.fn() }));
vi.mock("@/features/students/server/english-name", () => ({ updateStudentEnglishName: m.save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children, ariaLabel }: { href: string; children: ReactNode; ariaLabel: string }) =>
  <a href={href} aria-label={ariaLabel} onClick={(event) => { event.preventDefault(); m.navigate(); }}>{children}</a> }));

const entry = { studentId: "student-1", historical: false, endedOn: null } as RosterEntry;
const meta: StudentMeta = { name: "김하나", englishName: "Lucy", school: "칠성초", grade: "초5" };
function setup({ enabled = true, englishName = "Lucy" as string | null, lang = "en" as "en" | "ko" } = {}) {
  return render(<SheetLangProvider lang={lang}><EnglishNameProvider enabled={enabled}>
    <table><tbody><tr><RosterNameCell entry={entry} meta={{ ...meta, englishName }} /></tr></tbody></table>
  </EnglishNameProvider></SheetLangProvider>);
}
beforeEach(() => { vi.clearAllMocks(); m.save.mockResolvedValue({ ok: true, englishName: "Elsa" }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("영어 시트 이름 두 줄과 영문 이름 편집", () => {
  it("영문 이름만 첫 줄, 학교·학년은 둘째 줄에 보인다", () => {
    const { container } = setup();
    const cell = container.querySelector("td")!;
    expect(cell.textContent).toBe("LucyChilseong ES5");
    expect(cell.children[0].textContent).toBe("Lucy");
    expect(cell.children[1].textContent).toBe("Chilseong ES5");
    expect(cell.textContent).not.toContain("김하나");
  });
  it("영문 이름이 없으면 한글 이름 더블클릭으로 빈 영문 이름 입력을 연다", () => {
    setup({ englishName: null });
    fireEvent.doubleClick(screen.getByText("김하나"));
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(m.navigate).not.toHaveBeenCalled();
  });
  it("더블클릭은 첫 클릭의 학생 상세 이동을 취소한다", async () => {
    vi.useFakeTimers();
    setup();
    const name = screen.getByText("Lucy");
    fireEvent.click(name, { detail: 1 });
    fireEvent.click(name, { detail: 2 });
    fireEvent.doubleClick(name);
    await vi.advanceTimersByTimeAsync(600);
    expect(m.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("Lucy");
  });
  it("한 번 클릭은 기존 학생 상세 링크를 연다", async () => {
    vi.useFakeTimers(); setup();
    fireEvent.click(screen.getByText("Lucy"), { detail: 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(m.navigate).toHaveBeenCalledOnce();
  });
  it("Enter로 영문 이름만 저장한 뒤 이름을 갱신한다", async () => {
    setup(); fireEvent.doubleClick(screen.getByText("Lucy"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Elsa" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(m.save).toHaveBeenCalledWith({ studentId: "student-1", englishName: "Elsa", previousEnglishName: "Lucy" });
    expect(screen.getByText("Elsa")).toBeTruthy();
    expect(m.refresh).toHaveBeenCalledOnce();
  });
  it("지우고 저장하면 한글 이름으로 돌아간다", async () => {
    m.save.mockResolvedValue({ ok: true, englishName: null });
    setup(); fireEvent.doubleClick(screen.getByText("Lucy"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save English name" }));
    await waitFor(() => expect(screen.getByText("김하나")).toBeTruthy());
  });
  it("권한이 없으면 더블클릭·F2로 편집이 열리지 않고 링크는 즉시 동작한다", () => {
    setup({ enabled: false });
    fireEvent.doubleClick(screen.getByText("Lucy"));
    fireEvent.keyDown(screen.getByRole("link"), { key: "F2" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByText("Lucy"), { detail: 1 });
    expect(m.navigate).toHaveBeenCalledOnce();
    expect(m.save).not.toHaveBeenCalled();
  });
  it("Escape 취소는 저장하지 않는다", () => {
    setup(); fireEvent.doubleClick(screen.getByText("Lucy"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Elsa" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Lucy")).toBeTruthy();
    expect(m.save).not.toHaveBeenCalled();
  });
  it("한글 조합 중 Enter는 저장하지 않는다", () => {
    setup(); fireEvent.doubleClick(screen.getByText("Lucy"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Ella" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", isComposing: true });
    expect(m.save).not.toHaveBeenCalled();
  });
  it("서버가 거절하면 편집값과 오류를 남기고 성공처럼 표시하지 않는다", async () => {
    m.save.mockResolvedValue({ ok: false, error: "conflict" });
    setup(); fireEvent.doubleClick(screen.getByText("Lucy"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Elsa" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
    expect(screen.getByRole("textbox")).toHaveValue("Elsa");
    expect(m.refresh).not.toHaveBeenCalled();
  });
  it("한국어 모드는 기존 두 이름·학교 표기를 유지하며 영문 이름을 편집한다", () => {
    const { container } = setup({ lang: "ko" });
    expect(container.querySelector("td")?.textContent).toBe("김하나/칠성초5Lucy");
    fireEvent.doubleClick(screen.getByText("Lucy"));
    expect(screen.getByRole("textbox")).toHaveValue("Lucy");
  });
  it.each(["ko", "en"] as const)("중복 이름은 저장하지 않고 %s 경고와 입력값을 유지한다", async (lang) => {
    m.save.mockResolvedValue({ ok: false, error: "duplicate" });
    setup({ lang }); fireEvent.doubleClick(screen.getByText("Lucy"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Elsa" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent(lang === "en" ? "already used by another student at this branch" : "같은 지점에서 이미 사용하는");
    expect(screen.getByRole("textbox")).toHaveValue("Elsa");
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
