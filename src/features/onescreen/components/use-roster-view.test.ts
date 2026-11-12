import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent } from "../types";
import { useRosterView } from "./use-roster-view";

const stu = (id: string, tag: string) =>
  ({
    id,
    name: id,
    grade: "중1",
    tag,
    attendance: "출석",
    subjects: [{ name: "수학", subjectKey: "math", classId: tag, className: tag }],
    tests: { daily: { score: null, max: 20 }, check: { score: null, max: 10 } },
    attitude: null,
    homework: "",
  }) as unknown as OneScreenStudent;

const STUDENTS = [stu("a", "A반"), stu("b", "A반"), stu("c", "B반")];

function setup(reports: ReportsState, over: Partial<Parameters<typeof useRosterView>[0]> = {}) {
  return renderHook(
    (p: { reports: ReportsState }) =>
      useRosterView({
        initial: STUDENTS,
        initialStudentId: null,
        initialClassName: null,
        initialView: "card",
        readonlyView: false,
        classnoteOn: true,
        students: STUDENTS,
        reports: p.reports,
        todayClasses: [{ id: "A반", name: "A반" } as never],
        t: ((k: string) => k) as never,
        ...over,
      }),
    { initialProps: { reports } },
  );
}

describe("useRosterView — 명단 보기", () => {
  it("첫 학생을 고르고, 반 필터는 그 반 학생만 · 이름이 유일하면 순서 저장 반이 선다", () => {
    const { result } = setup({});
    expect(result.current.selected?.id).toBe("a");
    act(() => result.current.setClassFilter("B반"));
    expect(result.current.visible.map((s) => s.id)).toEqual(["c"]);
    expect(result.current.effectiveId).toBe("c"); // 고른 학생이 안 보이면 첫 학생으로
    expect(result.current.orderClass).toBeUndefined();
    act(() => result.current.setClassFilter("A반"));
    expect(result.current.orderClass?.id).toBe("A반");
  });

  it("작성 상태 필터는 누른 시점의 대상을 고정한다 — 입력으로 작성돼도 목록에서 안 사라진다", () => {
    const { result, rerender } = setup({});
    act(() => result.current.changeWriteFilter("unwritten"));
    expect(result.current.visible).toHaveLength(3);
    expect(result.current.emptyByWriteFilter).toBe("os.c.emptyUnwritten");
    rerender({ reports: { a: { 수학: { draft: "썼다", sent: false } } } });
    expect(result.current.visible.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(result.current.staleCount).toBe(1);
    expect(result.current.writeCounts).toEqual({ written: 1, unwritten: 2 });
    act(() => result.current.changeWriteFilter("unwritten")); // 다시 누르면 정리
    expect(result.current.visible.map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("열람 전용·ClassNote 꺼짐은 공지 뷰로 착지하지 않는다", () => {
    expect(setup({}, { initialView: "notice", readonlyView: true }).result.current.view).toBe("card");
    expect(setup({}, { initialView: "grid" }).result.current.view).toBe("grid");
  });
});
