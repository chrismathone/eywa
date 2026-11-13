import { beforeEach, expect, it, vi } from "vitest";
import { makeAddAttachmentsFor } from "./report-attachment-upload";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent } from "../types";
import type { SubjectReport } from "./report-card";

const api = vi.hoisted(() => ({ save: vi.fn(), issue: vi.fn(), upload: vi.fn(), register: vi.fn() }));
vi.mock("../server/actions", () => ({ saveLessonReport: api.save }));
vi.mock("../server/attachment-actions", () => ({ issueReportAttachmentUploadTicket: api.issue, registerReportAttachment: api.register }));
vi.mock("@/lib/storage/upload-to-ticket", () => ({ uploadToTicket: api.upload }));
vi.mock("../resize-image", () => ({ resizeImageForUpload: async (file: File) => file }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

const student = { id: "a", subjects: [{ name: "영어", subjectKey: "english", classId: "c1", today: "", prev: "" }] } as OneScreenStudent;
const photo = () => new File(["photo"], "notebook.jpg", { type: "image/jpeg" });
function setup(readonlyView = false, initial?: SubjectReport) {
  const reports: ReportsState = initial ? { a: { 영어: initial } } : {};
  const reportsRef = { current: reports };
  const englishRowFlags = vi.fn(() => ({ outdated: true }));
  const confirmEnglishOutput = vi.fn(() => false);
  const add = makeAddAttachmentsFor({ reports, reportsRef, date: "2026-10-29", readonlyView, classnoteOn: true,
    i18n: { t: ((key: string) => key) as never, tf: ((key: string) => key) as never },
    save: {
      englishRowFlags, confirmEnglishOutput, refreshJjBeforeOutput: async () => false,
      buildSaveInputFor: () => ({ input: { studentId: "a", subject: "english", classId: "c1", reportDate: "2026-10-29", progress: "", notes: "", examInfo: "", homeworkScore: "" } }),
      latestStudent: s => s, applyKeptVideoHomework: vi.fn(), applyVideoHomeworkDue: vi.fn(),
      patchReport: (id, subject, patch) => { reportsRef.current = { ...reportsRef.current, [id]: { ...reportsRef.current[id], [subject]: patch(reportsRef.current[id]?.[subject] ?? { draft: "", sent: false }) } }; },
    }, setUploadingAttKey: vi.fn(), ensureAttachmentUrls: vi.fn().mockResolvedValue(undefined),
  });
  return { add, reportsRef, englishRowFlags, confirmEnglishOutput };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.save.mockResolvedValue({ ok: true, id: "report", shareToken: "share" });
  api.issue.mockResolvedValue({ ticket: { path: "photo/path" } });
  api.upload.mockResolvedValue(undefined);
  api.register.mockResolvedValue({ ok: true, attachments: [{ path: "photo/path", name: "notebook.jpg" }] });
});
it("진도·평가·멘트가 없어도 영어 사진을 먼저 보관하고 발송/자동작성 준비 여부를 묻지 않는다", async () => {
  const { add, englishRowFlags, confirmEnglishOutput, reportsRef } = setup();
  expect(await add(student, "영어", [photo()], { silent: true })).toBe(1);
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ progress: "", notes: "" }));
  expect(api.issue).toHaveBeenCalledWith(expect.objectContaining({ studentId: "a", classId: "c1", reportDate: "2026-10-29" }));
  expect(englishRowFlags).not.toHaveBeenCalled();
  expect(confirmEnglishOutput).not.toHaveBeenCalled();
  expect(reportsRef.current.a.영어.attachments).toHaveLength(1);
});
it("다음 사진은 최신 저장 상태를 읽어 이미 만든 초안을 다시 저장하지 않는다", async () => {
  const { add } = setup();
  await add(student, "영어", [photo()]);
  await add(student, "영어", [photo()]);
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.register).toHaveBeenCalledTimes(2);
});
it.each(["readonly", "sent", "split"])("입력 조건을 풀어도 %s 잠금은 유지한다", async mode => {
  const { add } = setup(mode === "readonly", mode === "sent" ? { draft: "", sent: false, classnoteStatus: "success" } : undefined);
  const target = mode === "split" ? { ...student, subjects: [{ ...student.subjects[0], splitIn: "original" }] } : student;
  expect(await add(target, "영어", [photo()])).toBe(0);
  expect(api.save).not.toHaveBeenCalled();
  expect(api.issue).not.toHaveBeenCalled();
});
it("초안 보관이 실패하면 업로드를 진행하지 않는다", async () => {
  api.save.mockResolvedValue({ ok: false, error: "offline" });
  expect(await setup().add(student, "영어", [photo()])).toBe(0);
  expect(api.issue).not.toHaveBeenCalled();
});
