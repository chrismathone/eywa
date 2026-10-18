import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  examReportAttachmentName, examReportNotice, isExpectedPdf, isSettled, parseExamReportDay, shouldNotify, type StoredLink,
} from "./exam-report-plan";

const B = "11111111-1111-4111-8111-111111111111";
const item = (over: Record<string, unknown> = {}) => ({
  publicationId: "22222222-2222-4222-8222-222222222222", sourceStudentId: "33333333-3333-4333-8333-333333333333",
  sourceTestId: "44444444-4444-4444-8444-444444444444", sourceClassId: "55555555-5555-4555-8555-555555555555",
  testDate: "2026-10-20", sha256: "a".repeat(64), pdfSha256: "b".repeat(64), confirmedAt: "2026-10-20T09:00:00.000Z", ...over,
});
const day = (reports: unknown[], over: Record<string, unknown> = {}) => ({ version: "v1", bindingId: B, date: "2026-10-20", availability: "ready", reports, ...over });

describe("오늘 수학 성적표 목록 읽기", () => {
  it("aywa id가 아닌 줄 · 날짜가 다른 줄은 빼고 센다", () => {
    const out = parseExamReportDay(day([item(), item({ sourceStudentId: "local-7" }), item({ testDate: "2026-10-21" })]), B, "2026-10-20");
    expect(out).toMatchObject({ ready: true, skipped: 2 });
    expect(out.items).toHaveLength(1);
  });
  it("연결 · 날짜가 다른 목록은 오류(아무것도 붙이지 않는다)", () => {
    expect(() => parseExamReportDay(day([]), "66666666-6666-4666-8666-666666666666", "2026-10-20")).toThrow();
    expect(() => parseExamReportDay(day([]), B, "2026-10-19")).toThrow();
  });
  it("저장소가 없는 오늘 수학은 준비 전", () => {
    expect(parseExamReportDay(day([], { availability: "not-installed" }), B, "2026-10-20").ready).toBe(false);
  });
});

describe("다시 볼 성적표", () => {
  const link = (state: StoredLink["state"], sha = "a".repeat(64)): StoredLink =>
    ({ publication_id: item().publicationId, student_id: item().sourceStudentId, item_sha256: sha, state, notified_state: null });
  it("붙음 · 보낸 보고서는 지문이 같으면 끝", () => {
    expect(isSettled(item(), link("attached"))).toBe(true);
    expect(isSettled(item(), link("report_sent"))).toBe(true);
  });
  it("재채점(지문이 바뀜) · 보고서 대기 · 처리 중 · 가득은 다시 본다", () => {
    expect(isSettled(item(), link("attached", "c".repeat(64)))).toBe(false);
    for (const s of ["waiting_report", "report_busy", "attach_full"] as const) expect(isSettled(item(), link(s))).toBe(false);
    expect(isSettled(item(), undefined)).toBe(false);
  });
});

describe("PDF 검사", () => {
  const pdf = Buffer.from("%PDF-1.7 hello");
  const sha = createHash("sha256").update(pdf).digest("hex");
  it("서두 · 지문이 맞아야 한다", () => {
    expect(isExpectedPdf(pdf, sha)).toBe(true);
    expect(isExpectedPdf(pdf, "0".repeat(64))).toBe(false);
    const html = Buffer.from("<html>no</html>");
    expect(isExpectedPdf(html, createHash("sha256").update(html).digest("hex"))).toBe(false);
  });
});

describe("알림", () => {
  it("같은 상태로는 한 번만 · 붙음 · 처리 중은 알리지 않는다", () => {
    const d = "2026-10-20", next = "2026-10-21";
    expect(shouldNotify("waiting_report", null, d, next)).toBe(true);
    expect(shouldNotify("waiting_report", "waiting_report", d, next)).toBe(false);
    expect(shouldNotify("report_sent", "waiting_report", d, d)).toBe(true);
    expect(shouldNotify("attached", null, d, next)).toBe(false);
    expect(shouldNotify("report_busy", null, d, next)).toBe(false);
  });
  it("'보고서 없음'은 시험일 당일엔 알리지 않는다(아직 쓰는 중)", () => {
    expect(shouldNotify("waiting_report", null, "2026-10-20", "2026-10-20")).toBe(false);
    expect(shouldNotify("attach_full", null, "2026-10-20", "2026-10-20")).toBe(true);
  });
  it("문구는 학생 · 날짜를 말한다", () => {
    expect(examReportNotice("report_sent", "김하나", "2026-10-05").body).toContain("김하나 학생의 10/5 월말평가 성적표");
    expect(examReportAttachmentName("2026-09-30")).toBe("월말평가 성적표(9월).pdf");
  });
});
