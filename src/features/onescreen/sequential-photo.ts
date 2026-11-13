import { REPORT_ATTACHMENT_MAX } from "./attachment-utils";
import { effectiveClassnoteStatus, isAlreadySent, isRowActionable, rowClassName, type GridRow } from "./grid";
import { isProgressOptionalReport } from "./jj-books";
import type { SubjectReport } from "./components/report-card";
import type { OneScreenStudent } from "./types";

export type PhotoBlock = "locked" | "absent" | "optout" | "split" | "full" | "progress" | "changed";
export type PhotoTarget = {
  key: string;
  studentId: string;
  subjectName: string;
  classId: string | null;
  name: string;
  className: string;
  date: string;
  capacity: number;
  block?: PhotoBlock;
};
export type PhotoEntry = { target: PhotoTarget; files: File[]; error?: boolean; added: number };
export type SequentialAttach = {
  date: string;
  busy: boolean;
  onAttach: (target: PhotoTarget, files: File[]) => Promise<number>;
  onUploadingChange: (busy: boolean) => void;
};

export function photoBlock(row: GridRow, rep: SubjectReport | undefined): PhotoBlock | undefined {
  const status = effectiveClassnoteStatus(rep?.classnoteStatus, row.subject.classnoteStatus);
  if (isAlreadySent(status) || status === "queued" || status === "processing") return "locked";
  if (row.subject.attendanceRaw === "absent") return "absent";
  if (row.subject.reportOptout) return "optout";
  if (row.subject.splitIn) return "split";
  if ((rep?.attachments?.length ?? 0) >= REPORT_ATTACHMENT_MAX) return "full";
  if (!rep?.sent && !isRowActionable(row.subject, "save", status ?? "", { progressOptional: isProgressOptionalReport(row.subject, rep) })) return "progress";
}

/** Include blocked rows as named slots; skipping one must never shift the next student's photo. */
export function photoTargets(rows: GridRow[], reports: Record<string, Record<string, SubjectReport>>, date: string): PhotoTarget[] {
  return rows.filter(r => r.subject.subjectKey === "english").map(r => {
    const rep = reports[r.student.id]?.[r.subject.name];
    return {
      key: r.key, studentId: r.student.id, subjectName: r.subject.name,
      classId: r.subject.classId ?? null, name: r.student.name,
      className: rowClassName(r.subject) ?? r.subject.name, date,
      capacity: Math.max(0, REPORT_ATTACHMENT_MAX - (rep?.attachments?.length ?? 0)),
      block: photoBlock(r, rep),
    };
  });
}

export function resolvePhotoTarget(target: PhotoTarget, students: OneScreenStudent[], date: string): GridRow | null {
  if (date !== target.date) return null;
  const student = students.find(s => s.id === target.studentId);
  const subjectIndex = student?.subjects.findIndex(s => s.name === target.subjectName) ?? -1;
  const subject = student?.subjects[subjectIndex];
  if (!student || !subject || (subject.classId ?? null) !== target.classId || subject.subjectKey !== "english") return null;
  return { student, subject, subjectIndex, key: target.key };
}

/** Upload one file at a time so every acknowledged success can be removed before retrying. */
export async function attachPhotoEntries(
  entries: PhotoEntry[],
  attach: SequentialAttach["onAttach"],
  update: (index: number, entry: PhotoEntry) => void,
): Promise<void> {
  for (let i = 0; i < entries.length; i++) {
    let entry = entries[i];
    while (entry.files.length) {
      let added = 0;
      try { added = await attach(entry.target, [entry.files[0]]); } catch { /* Keep this exact slot for retry. */ }
      if (added !== 1) {
        update(i, { ...entry, error: true });
        break;
      }
      entry = { ...entry, files: entry.files.slice(1), added: entry.added + 1, error: false };
      update(i, entry);
    }
  }
}
