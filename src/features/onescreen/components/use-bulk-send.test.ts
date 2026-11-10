import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GridRow } from "../grid";
import type { OneScreenStudent } from "../types";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

import { useBulkSend } from "./use-bulk-send";

const stu = (id: string) =>
  ({ id, name: id, subjects: [{ name: "수학", subjectKey: "math", classId: "c1", today: "1-1" }] }) as unknown as OneScreenStudent;
const rowOf = (s: OneScreenStudent) => ({ student: s, subject: s.subjects[0]!, subjectIndex: 0, key: `${s.id}::수학` }) as GridRow;

describe("useBulkSend — 일괄 저장", () => {
  it("행마다 순서대로 저장하고, 도는 동안만 bulkBusy='save'", async () => {
    const order: string[] = [];
    const setBulkBusy = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const saveRecord = vi.fn(async (s: OneScreenStudent, _n: string, mode?: string) => {
      order.push(`${s.id}:${mode}`);
      if (s.id === "a") await gate;
      return { ok: true };
    });
    const rows = [rowOf(stu("a")), rowOf(stu("b"))];
    const { result } = renderHook(() =>
      useBulkSend({
        view: { visible: [], activeClassFilter: null, classTags: [], displaySettings: { options: { sort: "class" } } },
        ctx: { canEditAttendance: true, classnoteOn: true, showDailyTest: true, showCheckTest: true, sentRowCount: 0 },
        i18n: { t: ((k: string) => k) as never, tf: ((k: string) => k) as never },
        state: { reports: {}, reportsRef: { current: {} } },
        bulk: { bulkBusy: null, bulkGen: false, setBulkBusy },
        rows: { selectRows: () => rows, liveClassnoteStatus: () => undefined, latestRow: () => null },
        english: { englishTemplateNotReady: () => false, outdatedEnglishRows: () => [] },
        core: { saveRecord: saveRecord as never, queueOne: vi.fn() as never },
        readonlyBlocked: () => false,
      }),
    );
    let p!: Promise<void>;
    act(() => {
      p = result.current.saveAllVisible();
    });
    await act(async () => undefined);
    expect(order).toEqual(["a:bulk"]); // 앞 행이 끝나기 전엔 다음 행을 안 보낸다
    expect(setBulkBusy).toHaveBeenLastCalledWith("save");
    await act(async () => {
      release();
      await p;
    });
    expect(order).toEqual(["a:bulk", "b:bulk"]);
    expect(setBulkBusy).toHaveBeenLastCalledWith(null);
  });
});
