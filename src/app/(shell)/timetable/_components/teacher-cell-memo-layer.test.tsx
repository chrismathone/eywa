import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CellMemo } from "@/features/timetable-cell-memo/rules";

/**
 * 칸 메모 레이어 — 서버가 그린 표는 그대로 두고 **옆에서** 표식·우클릭·2열 메모를 붙인다.
 * 표식이 지난 주 것과 섞이지 않는지 · 보기만 되는 사람에게 우클릭 메뉴가 안 뜨는지 · 수업 칩 카드에 2열이 붙는지.
 */

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch, send: async () => "ok" };
      return ch;
    },
    removeChannel: async () => "ok",
  }),
}));
vi.mock("@/features/timetable-cell-memo/server/actions", () => ({
  saveCellMemo: vi.fn(),
  deleteCellMemo: vi.fn(),
  resizeCellMemo: vi.fn(),
}));

import { cellMemoAside } from "@/features/timetable-cell-memo/ui/aside-registry";
import { TeacherCellMemoLayer } from "./teacher-cell-memo-layer";

const memo = (over: Partial<CellMemo>): CellMemo => ({
  id: "m1", date: "2026-10-22", col: "김태건", startMin: 980, body: "교재 챙기기", width: null, height: null,
  version: 1, updatedAt: "2026-10-22T09:40:00.000Z", updatedByName: "박소선", ...over,
});
let memos: CellMemo[] = [];

beforeEach(() => {
  memos = [memo({}), memo({ id: "m2", col: "이현이", startMin: 990, body: "보강" })];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: "ok", memos }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const lanes = [
  { col: "김태건", day: "thu" as const },
  { col: "이현이", day: "thu" as const },
];

/** 강사뷰 표 축소판 — 16:00부터 10분 행 넷 · 김태건 16:20 수업 블록(2행 병합). */
function Grid({ canEdit = true, week = "2026-10-19" }: { canEdit?: boolean; week?: string }) {
  return (
    <div data-testid="scroll">
      <table>
        <thead>
          <tr>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr><td>16:00</td><td data-testid="kim-1600" /><td data-testid="lee-1600" /></tr>
          <tr><td>16:10</td><td /><td /></tr>
          <tr>
            <td>16:20</td>
            <td data-testid="kim-block" data-mb="980" rowSpan={2}>
              <button type="button" data-memo-chip="" data-testid="chip">반</button>
            </td>
            <td data-testid="lee-1620" />
          </tr>
          <tr><td>16:30</td><td data-testid="lee-1630" /></tr>
        </tbody>
      </table>
      <TeacherCellMemoLayer tenantId="t1" subject="english" weekMonday={week} canEdit={canEdit} lanes={lanes} firstMin={960} stepMin={10} />
    </div>
  );
}

const marked = (id: string) => screen.getByTestId(id).hasAttribute("data-cell-memo");

describe("표식 — 메모가 있는 칸에만, 그 주 그 날짜만", () => {
  it("블록 칸(시작 시각 열쇠)과 16:30 빈 칸에만 표식", async () => {
    render(<Grid />);
    await waitFor(() => expect(marked("kim-block")).toBe(true));
    expect(marked("lee-1630")).toBe(true);
    expect(marked("kim-1600")).toBe(false);
    expect(marked("lee-1620")).toBe(false);
  });
  it("🔴 주를 넘기면 지난 주 메모의 표식이 사라진다(날짜가 다르면 섞이지 않는다)", async () => {
    const view = render(<Grid />);
    await waitFor(() => expect(marked("kim-block")).toBe(true));
    view.rerender(<Grid week="2026-10-26" />);
    await waitFor(() => expect(marked("kim-block")).toBe(false));
    expect(marked("lee-1630")).toBe(false);
  });
});

describe("우클릭 메뉴 — 고칠 수 있는 사람에게만", () => {
  it("빈 칸 = '메모 추가' · 메모 칸 = '메모 편집'·'메모 삭제'", async () => {
    render(<Grid />);
    await waitFor(() => expect(marked("kim-block")).toBe(true));
    expect(fireEvent.contextMenu(screen.getByTestId("kim-1600"))).toBe(false);
    expect(screen.getByRole("menuitem", { name: "메모 추가" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    fireEvent.contextMenu(screen.getByTestId("chip"));
    expect(screen.getByRole("menuitem", { name: "메모 편집" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "메모 삭제" })).toBeTruthy();
  });
  it("🔴 보기만 되는 사람은 메뉴 없음(브라우저 기본 메뉴를 막지 않는다)", async () => {
    render(<Grid canEdit={false} />);
    await waitFor(() => expect(marked("kim-block")).toBe(true));
    expect(fireEvent.contextMenu(screen.getByTestId("kim-1600"))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("표가 없으면(0394a 전 — unavailable) 메뉴도 안 뜬다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: "unavailable" }) })));
    render(<Grid />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fireEvent.contextMenu(screen.getByTestId("kim-1600"))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("수업 칩 정보 카드의 2열", () => {
  it("메모가 있는 블록의 칩 → 메모 상자 · 레이어가 없으면 null(카드만)", async () => {
    const view = render(<Grid />);
    await waitFor(() => expect(marked("kim-block")).toBe(true));
    const aside = cellMemoAside(screen.getByTestId("chip"));
    expect(aside?.width).toBe(240);
    render(<>{aside?.node}</>);
    expect(screen.getByRole("note", { name: "칸 메모" }).textContent).toContain("교재 챙기기");
    expect(screen.getByRole("note", { name: "칸 메모" }).textContent).toContain("26.10.22 18:40 박소선");
    view.unmount();
    expect(cellMemoAside(document.body)).toBeNull();
  });
});
