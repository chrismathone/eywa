import { eventName } from "../../../src/features/student-contribution/model/parent-events/family";
import { cell, childDetail, childFromGuardian, childName, column, contact, explicitDate, grade, hash, schoolGrade } from "./source-values";
import type { ParsedRegistration, SourceProfile, SourceSheet } from "./source-types";
import { normalizeSchoolName } from "../../../src/features/schools/school-name";

/** Pure parsing with reviewed column semantics. Sheet row numbers are locations, never identity keys. */
export function parseSource(source: SourceSheet, profile: SourceProfile): ParsedRegistration[] {
  if (source.fileId !== profile.fileId || source.gid !== profile.gid || source.sheet !== profile.sheet) throw new Error("Source profile mismatch");
  if (profile.excluded) return [];
  return profile.blocks.flatMap(block => {
    if (hash((source.values[block.headerRow] ?? []).slice(block.start, block.end)) !== block.headerHash) throw new Error(`Source header changed: ${source.fileId}:${source.gid}`);
    const result: ParsedRegistration[] = [];
    for (let i = block.firstRow; i < Math.min(block.lastRow ?? Infinity, source.values.length); i++) {
      const row = source.values[i]!, raw = row.slice(block.start, block.end);
      const invalidRowKey = block.rowKey !== undefined && !/^(?:\d+|20\d{2}[.\-/]|\d{4}[.\-/])/.test(cell(row, block.rowKey));
      const nameText = cell(row, block.name), guardianText = cell(row, block.guardian), detailText = cell(row, block.childDetail);
      const phoneText = cell(row, block.phone), contactText = cell(row, block.contact);
      if (![nameText, guardianText, detailText, phoneText, contactText].some(s => s && !/^(?:FALSE|TRUE|-|없음)$/.test(s))) continue;
      const c = contact(contactText), p = contact(phoneText), detail = childDetail(detailText), sg = schoolGrade(cell(row, block.schoolGrade));
      const gradeText = cell(row, block.grade), gradeDetail = schoolGrade(gradeText);
      const school = cell(row, block.school) || sg.school || gradeDetail.school || detail.school;
      const parsedGrade = grade(gradeText, school) || gradeDetail.grade || sg.grade || detail.grade;
      const studentName = childName(nameText) || detail.name || childFromGuardian(guardianText);
      const guardianName = childFromGuardian(guardianText) ? "" : guardianText || c.guardian;
      const phones = [...new Set([...p.phones, ...c.phones])].sort();
      const date = block.dateColumn === undefined ? block.date : explicitDate(cell(row, block.dateColumn), block.dateYear ?? (Number(block.date.slice(0, 4)) || undefined));
      const sessionText = cell(row, block.sessionColumn);
      const session = block.sessionColumn === undefined ? block.session ?? "" : block.sessionMap?.[sessionText] ?? sessionText;
      const issues = [...block.issues];
      if (invalidRowKey) issues.push("row_identity_unconfirmed");
      if (nameText && !childName(nameText) || detail.invalid) issues.push("student_name_unstructured");
      if (gradeText && !parsedGrade) issues.push("grade_unstructured");
      if (gradeDetail.school && school && normalizeSchoolName(gradeDetail.school) !== normalizeSchoolName(school)) issues.push("school_conflict");
      if (cell(row, block.schoolGrade) && !sg.school) issues.push("school_grade_unstructured");
      if (phoneText && p.invalid || contactText && c.invalid) issues.push("phone_unstructured");
      if (block.sessionColumn !== undefined && !sessionText) issues.push("session_missing");
      if (block.sessionColumn !== undefined && !Object.hasOwn(block.sessionMap ?? {}, sessionText)) issues.push("session_unmapped");
      const eventId = block.eventKey && date ? `${block.eventKey}:${date}:${session}` : "";
      const identityHash = hash({ eventId, name: eventName(studentName), guardian: eventName(guardianName), phones,
        timestamp: cell(row, block.timestampColumn) });
      result.push({ sourceId: hash([source.fileId, source.gid, identityHash]), identityHash, contentHash: hash(raw),
        fileId: source.fileId, sheetId: source.gid, row: i + 1, raw, eventTitle: block.title.trim(), session, eventId, eventDate: date,
        tenantId: block.tenantId, seriesKey: block.seriesKey, sourceRef: `${source.url.replace(/#.*$/, "")}#gid=${source.gid}&range=${column(block.start + 1)}${i + 1}`,
        studentName, guardianName, phones, school, grade: parsedGrade, gradeAsOf: block.gradeAsOf, sameDayReviewed: block.sameDayReviewed,
        eligibleList: block.eligibleList, issues, markers: block.markers.map(m => ({ kind: m.kind, value: cell(row, m.column), targetEventIds: m.targetEventIds })) });
    }
    return result;
  });
}
