import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GridRow } from "../grid";
import type { OneScreenStudent } from "../types";

vi.mock("../server/actions", () => ({ generateReportComment: vi.fn() }));
vi.mock("../write-timing-store", () => ({ markAutowrite: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

import { useAutoWrite } from "./use-auto-write";

const EN = { id: "s1", name: "학생", subjects: [{ name: "영어", subjectKey: "english", classId: "e1" }] } as unknown as OneScreenStudent;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(over: { refill?: () => Promise<void>; gen?: () => Promise<"ok">; rows?: GridRow[] } = {}) {
  const generateEnglishDraftFor = vi.fn(over.gen ?? (async () => "ok" as const));
  const refillEnglishInner = vi.fn(over.refill ?? (async () => undefined));
  const hook = renderHook(() =>
    useAutoWrite({
      ctx: { selected: EN, readonlyView: false, date: "", activeDate: "2026-11-10", showDailyTest: true, showCheckTest: true, classNarratives: {} },
      refs: { reportsRef: { current: {} }, studentsRef: { current: [EN] } },
      i18n: { t: ((k: string) => k) as never, tf: ((k: string) => k) as never },
      bulkBusy: null,
      rows: { selectRows: () => over.rows ?? [], latestRow: () => EN, latestStudent: (s) => s },
      actions: { readonlyBlocked: () => false, patchReport: vi.fn() },
      english: { generateEnglishDraftFor, refillEnglishInner },
    }),
  );
  return { ...hook, generateEnglishDraftFor, refillEnglishInner };
}

describe("useAutoWrite", () => {
  beforeEach(() => vi.clearAllMocks());

  it("카드 과목 버튼(genSubject)과 표 행(genKey) 로딩은 따로 선다", async () => {
    const d = deferred();
    const { result } = setup({ gen: async () => (await d.promise, "ok" as const) });
    let p!: Promise<void>;
    act(() => {
      p = result.current.autoWriteSubject("영어");
    });
    expect(result.current.genSubject).toBe("영어");
    expect(result.current.genKey).toBeNull();
    await act(async () => {
      d.resolve();
      await p;
    });
    expect(result.current.genSubject).toBeNull();
    act(() => {
      p = result.current.autoWriteRow(EN, "영어");
    });
    expect(result.current.genKey).toBe("s1::영어");
    expect(result.current.genSubject).toBeNull();
    await act(async () => p);
    expect(result.current.genKey).toBeNull();
  });

  it("일괄 자동작성은 bulkGen을 켜고 행마다 genKey를 옮긴 뒤 둘 다 끈다", async () => {
    const row = { student: EN, subject: EN.subjects[0]!, subjectIndex: 0, key: "s1::영어" } as unknown as GridRow;
    const { result, generateEnglishDraftFor } = setup({ rows: [row] });
    await act(async () => result.current.autoWriteAllVisible());
    expect(generateEnglishDraftFor).toHaveBeenCalledTimes(1);
    expect((generateEnglishDraftFor.mock.calls[0] as unknown[])[2]).toBe(true); // 일괄 = quiet
    expect(result.current.bulkGen).toBe(false);
    expect(result.current.genKey).toBeNull();
  });

  it("다시 채우기 — 받는 중 연타는 버리고, 다른 템플릿 고르기는 끝난 뒤 한 번 더 채운다", async () => {
    const d = deferred();
    let first = true;
    const { result, refillEnglishInner } = setup({
      refill: async () => {
        if (first) {
          first = false;
          await d.promise;
        }
      },
    });
    let p!: Promise<void>;
    act(() => {
      p = result.current.refillEnglishFor(EN, "영어");
    });
    await act(async () => {
      await result.current.refillEnglishFor(EN, "영어"); // 연타 — 버린다
      await result.current.refillEnglishFor(EN, "영어", "tpl-b"); // 다른 템플릿 — 기억
    });
    expect(refillEnglishInner).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.resolve();
      await p;
    });
    expect(refillEnglishInner).toHaveBeenCalledTimes(2);
    expect((refillEnglishInner.mock.calls[1] as unknown[])[2]).toBe("tpl-b");
  });
});
