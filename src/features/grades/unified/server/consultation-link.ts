import { kstDateOf } from "@/lib/date-kst";
import { linkedRecordKeyOf } from "@/features/consultations/internal-link";

type Source = "grade" | "report" | "level";

export type ConsultationLink = {
  studentId: string;
  subject: string;
  recordKey: string;
  date: string;
};

export type LinkedConsultation = {
  student_id: string;
  subject: string | null;
  category: string | null;
  consulted_at: string;
  summary: string;
};

/** 상담 내용에 시험 행의 고유 키를 남긴다. 자유 서술 상담은 시험과 연결하지 않는다. */
export function linkedConsultationSummary(link: ConsultationLink): string {
  return `성적 상담 [EYWA-UNIFIED:${link.recordKey}]`;
}

export function recordKey(source: "report", id: string, kind: "daily" | "check" | "other"): string;
export function recordKey(source: "grade" | "level", id: string): string;
export function recordKey(source: Source, id: string, kind?: "daily" | "check" | "other"): string {
  return source === "report" ? `report:${id}:${kind === "other" ? "legacy" : kind}` : `${source}:${id}`;
}

export function linkedConsultationDates(rows: readonly LinkedConsultation[]): Map<string, string> {
  const dates = new Map<string, string>();
  for (const row of rows) {
    if (row.category !== "academic" || !row.subject) continue;
    const linkedKey = linkedRecordKeyOf(row.summary);
    const date = kstDateOf(row.consulted_at);
    if (!linkedKey || !date) continue;
    const key = `${row.student_id}|${row.subject}|${linkedKey}`;
    if (!dates.has(key) || dates.get(key)! < date) dates.set(key, date);
  }
  return dates;
}

export function consultationDateFor(
  dates: ReadonlyMap<string, string>, studentId: string, subject: string, key: string,
): string | null {
  return dates.get(`${studentId}|${subject}|${key.toLowerCase()}`) ?? null;
}
