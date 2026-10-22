import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultItems } from "@/features/dashboard/layout/defaults";
import { uniformKpiItems } from "@/features/dashboard/layout/fixed-grid";
import { EMPTY_DASHBOARD } from "@/features/dashboard/layout/types";
import { useDashboardEditor } from "./use-editor";

describe("역할별 대시보드 편집", () => {
  it("KPI 일괄 정렬을 한 번에 되돌리고 저장할 배치에도 반영한다", () => {
    const { result } = renderHook(() => useDashboardEditor(EMPTY_DASHBOARD));
    const before = result.current.items;
    const next = uniformKpiItems(before, 6);
    act(() => result.current.commit(next));
    expect(result.current.payload.layouts.find((l) => l.role === "owner")?.items).toEqual(next);
    expect(result.current.touched).toEqual(["owner"]);
    act(() => result.current.undo());
    expect(result.current.items).toEqual(before);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.items).toEqual(next);
  });
  it("과목 전환·이력·지연된 삭제 복구가 다른 과목에 섞이지 않는다", () => {
    const { result } = renderHook(() => useDashboardEditor(EMPTY_DASHBOARD, ["math", "english"]));
    act(() => result.current.setRole("subject"));
    const mathBefore = result.current.items;
    const removed = mathBefore[0];
    const commitMath = result.current.commit;
    act(() => result.current.setSubject("english"));
    act(() => commitMath(mathBefore.slice(1)));
    expect(result.current.items).toEqual(mathBefore);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.restore("subject", removed, 0, "math"));
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.setSubject("math"));
    expect(result.current.items).toEqual(mathBefore);
    act(() => result.current.undo());
    expect(result.current.items).toEqual(mathBefore.slice(1));
    const payload = result.current.payload;
    expect(payload.layouts.find((l) => l.subject === "math")?.items).toHaveLength(mathBefore.length - 1);
    expect(payload.layouts.find((l) => l.subject === "english")?.items).toEqual(mathBefore);
  });
  it("역할 전환 직전 시작한 편집은 원래 역할에 적용되고 새 역할을 덮지 않는다", () => {
    const { result } = renderHook(() => useDashboardEditor(EMPTY_DASHBOARD));
    const commitOwner = result.current.commit;
    const owner = result.current.items.slice(0, 2);
    act(() => result.current.setRole("subject"));
    act(() => commitOwner(owner));
    expect(result.current.items).toEqual(defaultItems("subject"));
    expect(result.current.draftOf("owner")).toEqual(owner);
  });

  it("다른 역할에서 삭제를 되돌려도 현재 역할의 선택·이력은 그대로다", () => {
    const { result } = renderHook(() => useDashboardEditor(EMPTY_DASHBOARD));
    const removed = result.current.items[0];
    act(() => result.current.commit(result.current.items.slice(1)));
    act(() => result.current.setRole("subject"));
    act(() => result.current.select("panel:nowClasses"));
    act(() => result.current.restore("owner", removed, 0));
    expect(result.current.selected).toBe("panel:nowClasses");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.draftOf("owner")).toEqual(defaultItems("owner"));
    act(() => result.current.setRole("owner"));
    act(() => result.current.undo());
    expect(result.current.items.some((i) => i.id === removed.id)).toBe(false);
    act(() => result.current.redo());
    expect(result.current.items).toEqual(defaultItems("owner"));
  });
});
