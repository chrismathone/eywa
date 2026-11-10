import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OneScreenStudent } from "../types";

vi.mock("../server/actions", () => ({ reissueShareLink: vi.fn(), revokeShareLink: vi.fn() }));
vi.mock("./use-classnote-status-sync", () => ({ useClassnoteStatusSync: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

import { useReportSend } from "./use-report-send";

const S1 = { id: "s1", name: "학생", subjects: [{ name: "수학", subjectKey: "math", classId: "c1", today: "1-1" }] } as unknown as OneScreenStudent;

function setup(draft: string, bulkBusy: "save" | "send" | null = null) {
  const queueOne = vi.fn(async () => ({ ok: true, status: "queued" }));
  const hook = renderHook(() =>
    useReportSend({
      ctx: { date: "", activeDate: "2026-11-10", classnoteOn: true, lang: "ko" },
      state: { selected: S1, reports: { s1: { 수학: { draft, sent: false } } }, setReports: vi.fn(), studentsRef: { current: [S1] } },
      i18n: { t: ((k: string) => k) as never, tf: ((k: string) => k) as never },
      bulk: { bulkBusy, bulkGen: false },
      core: { saveRecord: vi.fn() as never, queueOne: queueOne as never },
      rows: { patchReport: vi.fn(), readonlyBlocked: () => false, confirmEnglishOutput: () => true },
      openPrint: vi.fn(),
    }),
  );
  return { ...hook, queueOne };
}

describe("useReportSend — 행 발송 진입 게이트", () => {
  it("🔴 빈 멘트는 발송 코어를 부르지 않는다", async () => {
    const { result, queueOne } = setup("   ");
    await act(async () => result.current.sendRow(S1, "수학"));
    expect(queueOne).not.toHaveBeenCalled();
  });
  it("일괄 작업 중이면 부르지 않는다", async () => {
    const { result, queueOne } = setup("멘트", "save");
    await act(async () => result.current.sendRow(S1, "수학"));
    expect(queueOne).not.toHaveBeenCalled();
  });
  it("통과하면 그 행을 한 번 보낸다", async () => {
    const { result, queueOne } = setup("멘트");
    await act(async () => result.current.sendRow(S1, "수학"));
    expect(queueOne).toHaveBeenCalledTimes(1);
  });
});
