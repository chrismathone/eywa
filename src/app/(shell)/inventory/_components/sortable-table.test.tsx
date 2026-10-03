import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SortableTable } from "./sortable-table";

const state = vi.hoisted(() => ({ mobile: true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => state.mobile }));
vi.mock("@/components/ui/drag-scroll-area", () => ({ DragScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const touch = (element: Element) => fireEvent(element, Object.assign(new MouseEvent("click", { bubbles: true, detail: 1 }), { pointerType: "touch" }));
const rows = Array.from({ length: 21 }, (_, id) => ({ id, name: `자산 ${id + 1}` }));

it("mobile paging preserves sorted rows and clamps the page after filtering", () => {
  const props = { rows, rowKey: (r: typeof rows[number]) => String(r.id), sort: { key: "id", dir: "asc" as const }, onSort: vi.fn(), emptyText: "없음", columns: [{ key: "name", label: "이름", render: (r: typeof rows[number]) => r.name }] };
  const view = render(<SortableTable {...props} />);
  expect(screen.getByText("자산 10")).toBeInTheDocument();
  expect(screen.queryByText("자산 11")).not.toBeInTheDocument();
  touch(screen.getByRole("button", { name: "다음" }));
  expect(screen.getByText("자산 11")).toBeInTheDocument();
  expect(screen.queryByText("자산 1")).not.toBeInTheDocument();
  view.rerender(<SortableTable {...props} rows={rows.slice(0, 2)} />);
  expect(screen.getByText("자산 1")).toBeInTheDocument();
});

it("touch edits only the intended cell or row; nested buttons never open the row editor", () => {
  const rowEdit=vi.fn(), cellEdit=vi.fn(), action=vi.fn();
  render(<SortableTable rows={rows.slice(0, 1)} rowKey={r=>String(r.id)} sort={{key:"id",dir:"asc"}} onSort={vi.fn()} emptyText="없음" onRowDoubleClick={rowEdit}
    columns={[{key:"name",label:"이름",render:r=>r.name},{key:"status",label:"상태",render:()=>"사용중",onDoubleClick:cellEdit}]}
    actions={()=><button onClick={action}>QR 보기</button>} />);
  touch(screen.getByText("사용중")); expect(cellEdit).toHaveBeenCalledTimes(1); expect(rowEdit).not.toHaveBeenCalled();
  touch(screen.getByText("자산 1")); expect(rowEdit).toHaveBeenCalledTimes(1);
  touch(screen.getByText("QR 보기")); expect(action).toHaveBeenCalledTimes(1); expect(rowEdit).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("자산 1"), {detail:1}); expect(rowEdit).toHaveBeenCalledTimes(1);
  fireEvent.doubleClick(screen.getByText("자산 1")); expect(rowEdit).toHaveBeenCalledTimes(2);
});

it("Enter opens the focused row and does not steal Enter from a button inside it", () => {
  const rowEdit = vi.fn();
  const action = vi.fn();
  render(<SortableTable rows={rows.slice(0, 1)} rowKey={(r) => String(r.id)} sort={{ key: "id", dir: "asc" }} onSort={vi.fn()} emptyText="없음" onRowDoubleClick={rowEdit}
    columns={[{ key: "name", label: "이름", render: (r) => r.name }]}
    actions={() => <button onClick={action}>QR 보기</button>} />);
  const row = screen.getByText("자산 1").closest("tr");
  expect(row).not.toBeNull();
  fireEvent.keyDown(row!, { key: "Enter" });
  expect(rowEdit).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole("button", { name: "QR 보기" }), { key: "Enter" });
  expect(rowEdit).toHaveBeenCalledTimes(1);
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("자산 1"), { detail: 1 });
  expect(rowEdit).toHaveBeenCalledTimes(1);
});
