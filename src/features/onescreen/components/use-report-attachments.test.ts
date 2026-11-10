import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OneScreenStudent } from "../types";
import type { ReportsState } from "../session-input";

const calls: string[] = [];
const sign = vi.fn();
vi.mock("../server/attachment-actions", () => ({
  signReportAttachmentUrls: (a: { studentId: string }) => sign(a),
  issueReportAttachmentUploadTicket: async (a: { ext: string }) => {
    calls.push(`issue:${a.ext}`);
    return { ticket: { path: `p/${calls.length}` } };
  },
  registerReportAttachment: async (a: { name: string }) => {
    calls.push(`register:${a.name}`);
    return { ok: true, attachments: [] };
  },
  removeReportAttachment: vi.fn(),
}));
vi.mock("@/lib/storage/upload-to-ticket", () => ({
  uploadToTicket: async (_t: unknown, f: File) => {
    calls.push(`upload:${f.name}`);
  },
}));
vi.mock("../server/actions", () => ({ saveLessonReport: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

import { useReportAttachments } from "./use-report-attachments";

const stu = (id: string) =>
  ({
    id,
    name: id,
    subjects: [{ name: "수학", subjectKey: "math", classId: "c1", today: "1-1" }],
  }) as unknown as OneScreenStudent;

const A = stu("a");
const B = stu("b");
const REPORTS: ReportsState = {
  a: { 수학: { draft: "", sent: true, attachments: [{ path: "pa", name: "a.png" }] } },
  b: { 수학: { draft: "", sent: true, attachments: [{ path: "pb", name: "b.png" }] } },
};

function setup(selected: OneScreenStudent) {
  const patchReport = vi.fn();
  const hook = renderHook(
    (p: { selected: OneScreenStudent }) =>
      useReportAttachments({
        selected: p.selected,
        reports: REPORTS,
        reportsRef: { current: REPORTS },
        studentsRef: { current: [A, B] },
        date: "2026-11-10",
        readonlyView: false,
        classnoteOn: true,
        i18n: { t: ((k: string) => k) as never, tf: ((k: string) => k) as never },
        save: {
          readonlyBlocked: () => false,
          englishRowFlags: () => ({ outdated: false }),
          confirmEnglishOutput: () => true,
          refreshJjBeforeOutput: async () => false,
          buildSaveInputFor: () => null,
          latestStudent: (s) => s,
          applyKeptVideoHomework: vi.fn(),
          applyVideoHomeworkDue: vi.fn(),
          patchReport,
        },
        bulk: { bulkBusy: null, bulkGen: false, setBulkBusy: vi.fn() },
      }),
    { initialProps: { selected } },
  );
  return { ...hook, patchReport };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useReportAttachments", () => {
  beforeEach(() => {
    calls.length = 0;
    sign.mockReset();
  });

  it("🔴 선택 학생이 바뀌면 늦게 온 옛 서명은 버린다(취소 플래그)", async () => {
    const da = deferred<{ urls: Record<string, string> }>();
    const db = deferred<{ urls: Record<string, string> }>();
    sign.mockImplementation((a: { studentId: string }) => (a.studentId === "a" ? da.promise : db.promise));
    const { result, rerender } = setup(A);
    rerender({ selected: B });
    await act(async () => db.resolve({ urls: { pb: "url-b" } }));
    await act(async () => da.resolve({ urls: { pa: "url-a" } }));
    expect(result.current.attUrls).toEqual({ pb: "url-b" });
  });

  it("파일은 하나씩 순서대로 — 발급 → 올리기 → 등록", async () => {
    sign.mockResolvedValue({ urls: {} });
    const { result, patchReport } = setup(A);
    const files = [new File(["1"], "one.pdf", { type: "application/pdf" }), new File(["2"], "two.pdf", { type: "application/pdf" })];
    let added = 0;
    await act(async () => {
      added = await result.current.addAttachmentsFor(A, "수학", files);
    });
    expect(added).toBe(2);
    expect(calls).toEqual(["issue:pdf", "upload:one.pdf", "register:one.pdf", "issue:pdf", "upload:two.pdf", "register:two.pdf"]);
    expect(patchReport).toHaveBeenCalledTimes(2);
    expect(result.current.uploadingAttKey).toBeNull();
  });
});
