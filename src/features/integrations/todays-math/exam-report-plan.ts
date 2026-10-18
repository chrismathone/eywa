import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * 오늘 수학 월말평가 성적표 PDF 첨부 — 순수 규칙(받는 모양 · 건너뛰기 · PDF 검사 · 알림 문구). DB·HTTP는 exam-report-attach.ts.
 * 받는 모양 = 오늘 수학 `src/contracts/eywaExamReport.contract.ts`의 날짜별 목록(v1). 확정된 성적표만 온다(결시·미채점·초안 없음).
 */
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const examReportItemSchema = z.object({
  publicationId: z.string().uuid(),
  // 오늘 수학 쪽 칸은 문자열 — aywa에 붙이려면 aywa id(uuid)여야 한다. 아니면 그 줄만 건너뛴다(parseExamReportDay).
  sourceStudentId: z.string().min(1).max(200),
  sourceTestId: z.string().uuid(),
  sourceClassId: z.string().min(1).max(200),
  testDate: z.iso.date(),
  sha256: sha,
  pdfSha256: sha,
  confirmedAt: z.string().min(1).max(64),
});
const daySchema = z.object({
  version: z.literal("v1"),
  bindingId: z.string().uuid(),
  date: z.iso.date(),
  availability: z.enum(["ready", "not-installed"]),
  reports: z.array(z.unknown()).max(2000),
});
export type ExamReportItem = z.infer<typeof examReportItemSchema>;

const uuid = z.string().uuid();
/** 날짜 목록을 읽는다 — 날짜·연결이 다르면 오류, aywa id가 아닌 줄(연결 안 된 학생·반)은 빼고 센다. */
export function parseExamReportDay(raw: unknown, bindingId: string, date: string) {
  const day = daySchema.parse(raw);
  if (day.bindingId !== bindingId || day.date !== date) throw new Error("exam_report_day_mismatch");
  const items: ExamReportItem[] = [];
  let skipped = 0;
  for (const entry of day.reports) {
    const parsed = examReportItemSchema.safeParse(entry);
    if (!parsed.success || parsed.data.testDate !== date
      || !uuid.safeParse(parsed.data.sourceStudentId).success || !uuid.safeParse(parsed.data.sourceClassId).success) { skipped++; continue; }
    items.push(parsed.data);
  }
  return { ready: day.availability === "ready", items, skipped };
}

export type LinkState = "attached" | "waiting_report" | "report_sent" | "report_busy" | "attach_full";
export type StoredLink = { publication_id: string; student_id: string; item_sha256: string; state: LinkState; notified_state: string | null };

/** 이미 끝난 성적표 — 지문이 그대로이고 붙었거나 보낸 보고서라 붙일 수 없는 것. 나머지(대기·처리 중·가득)는 매번 다시 본다. */
export function isSettled(item: ExamReportItem, link: StoredLink | undefined): boolean {
  return !!link && link.item_sha256 === item.sha256 && (link.state === "attached" || link.state === "report_sent");
}

export const EXAM_REPORT_PDF_MAX = 4_000_000; // 오늘 수학 보관 상한(4MB)과 같다 — 보고서 첨부 상한(20MB) 안.

/** 받은 바이트가 목록이 약속한 그 PDF인가(서두 · 지문 · 크기). */
export function isExpectedPdf(bytes: Uint8Array, pdfSha256: string): boolean {
  if (bytes.byteLength < 5 || bytes.byteLength > EXAM_REPORT_PDF_MAX) return false;
  if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") return false;
  return createHash("sha256").update(bytes).digest("hex") === pdfSha256;
}

/** 첨부 이름 — 학부모에게 파일 이름이 보인다. 시험 id는 이름이 아니라 0373a 표가 경로로 기억한다(교체용). */
export function examReportAttachmentName(testDate: string): string {
  return `월말평가 성적표(${Number(testDate.slice(5, 7))}월).pdf`;
}

/**
 * 알릴 상태 — 같은 상태로는 한 번만. 붙음·처리 중은 알리지 않는다.
 * '보고서 없음'은 시험일이 지난 뒤에만 — 채점은 보통 그날 저녁이고 선생님이 아직 보고서를 쓰는 중일 수 있다(그날 붙으면 알릴 일이 없다).
 */
export function shouldNotify(state: string, notifiedState: string | null, testDate: string, today: string): state is "waiting_report" | "report_sent" | "attach_full" {
  if (state === "waiting_report" && today <= testDate) return false;
  return (state === "waiting_report" || state === "report_sent" || state === "attach_full") && state !== notifiedState;
}

export function examReportNotice(state: "waiting_report" | "report_sent" | "attach_full", studentName: string, testDate: string) {
  const day = `${Number(testDate.slice(5, 7))}/${Number(testDate.slice(8, 10))}`;
  const who = `${studentName} 학생의 ${day} 월말평가 성적표`;
  const body = state === "waiting_report"
    ? `${who}를 붙일 그날 수학 보고서가 없습니다. 보고서를 저장하면 한 시간 안에 붙습니다 — 붙은 뒤 보내 주세요.`
    : state === "report_sent"
      ? `${who}가 확정됐지만 그날 보고서가 이미 발송돼 붙이지 않았습니다. 필요하면 학부모께 따로 전해 주세요.`
      : `${who}를 붙이지 못했습니다 — 보고서 첨부가 6개로 가득 찼습니다. 첨부를 하나 지우면 다음 확인 때 붙습니다.`;
  return { title: "월말평가 성적표", body };
}
