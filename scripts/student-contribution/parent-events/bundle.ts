import { studentIdentity } from "../../../src/features/students/ontology/identity";
import { isMergedStudent } from "../../../src/features/students/status/merged";
import { EVENT_POLICY, validEventDate } from "../../../src/features/student-contribution/model/parent-events/attendance";
import type { EventStudent } from "../../../src/features/student-contribution/model/parent-events/types";
import { evaluateRegistrations } from "./evaluate";
import { parseSource } from "./parse-source";
import { hash } from "./source-values";
import type { SourceProfile, SourceSheet } from "./source-types";
import type { EventDatabaseSnapshot } from "./snapshot";
import { createHmac } from "node:crypto";
import { contributionRoster } from "../../../src/features/student-contribution/model/roster";
import { eventCreditCounts } from "../../../src/features/student-contribution/model/parent-events/credits";
import { DEFAULT_PARENT_SEMINAR_POINTS } from "../../../src/features/student-contribution/model/config";
import { studentEventPhones } from "../../../src/features/student-contribution/model/parent-events/family";
export type EventSourcePack = { capturedAt: string; sources: SourceSheet[]; profiles: SourceProfile[] };
/** Ignore representation differences (MCP boolean vs Sheets formatted TRUE) and trailing empty grid cells. */
export function normalizedGrid(values: unknown[][]) {
  const rows = values.map(row => { const cells = row.map(v => v == null ? "" : typeof v === "boolean" ? String(v).toUpperCase() : String(v));
    while (cells.at(-1) === "") cells.pop(); return cells; });
  while (rows.at(-1)?.length === 0) rows.pop(); return rows;
}
export function sourcePackHash(pack: EventSourcePack) {
  return hash({ profiles: pack.profiles, sources: pack.sources.map(s => ({ fileId: s.fileId, gid: s.gid, sheet: s.sheet, title: s.title, values: normalizedGrid(s.values) })) });
}
export function buildEventBundle(database: EventDatabaseSnapshot, pack: EventSourcePack, today: string, privacyKey: string) {
  if (privacyKey.length < 32) throw new Error("Private import identity key is required");
  const opaque = (kind: string, value: string) => createHmac("sha256", privacyKey).update(`${database.tenantId}:${kind}:${value}`).digest("hex");
  if (!validEventDate(today) || !Number.isFinite(Date.parse(pack.capturedAt))) throw new Error("Invalid source date");
  if (database.students.some(s => s.tenant_id !== database.tenantId)) throw new Error("Cross-tenant source profile");
  const keys = pack.sources.map(s => `${s.fileId}:${s.gid}`);
  if (new Set(keys).size !== keys.length || pack.profiles.length !== pack.sources.length) throw new Error("Incomplete source profiles");
  const canonical = studentIdentity(database.students);
  const students: EventStudent[] = database.students.map(s => ({ id: s.id, tenantId: s.tenant_id, name: s.name,
    guardianName: s.parent_name, guardianPhone: s.parent_phone, studentPhone: s.student_phone, school: s.school, grade: s.grade,
    schoolAsOf: ["enrolled", "on_hold"].includes(s.status) ? today : null, eligible: !s.is_test && !isMergedStudent(s.notes) }));
  const rows = pack.profiles.flatMap(p => {
    const source = pack.sources.find(s => s.fileId === p.fileId && s.gid === p.gid);
    if (!source) throw new Error("Source sheet missing");
    return parseSource(source, p);
  });
  const result = evaluateRegistrations({ tenantId: database.tenantId, today, rows, students, links: database.siblings, canonical });
  const roster = new Set(contributionRoster(database.students, new Set(database.enrollments.map(e => canonical(e.student_id)))).map(s => s.id));
  const outsideRoster = result.credits.filter(c => !roster.has(c.studentId)).length;
  result.credits = result.credits.filter(c => roster.has(c.studentId));
  if (result.credits.some(c => c.familyKeys.length !== 1)) throw new Error("Overlapping household attribution needs review");
  const sourceIds = new Set(result.credits.flatMap(c => c.sourceIds));
  const registrations = [...new Map(result.outcomes.filter(d => sourceIds.has(d.row.sourceId)).map(d => [d.row.sourceId, {
    ...d.row, eventId: opaque("event", d.row.eventId), sourceId: opaque("source", d.row.sourceId),
    attendanceBasis: d.attendance.basis as "explicit_attendance" | "registration_policy",
  }])).values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  if (registrations.some(r => r.tenantId !== database.tenantId)) throw new Error("Cross-tenant event registration");
  const events = [...new Map(registrations.map(r => [r.eventId, { id: r.eventId, title: r.eventTitle, date: r.eventDate, session: r.session ?? "" }])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const credits = result.credits.map(c => ({ ...c, eventId: opaque("event", c.eventId),
    id: `parent_event:${opaque("event", c.eventId)}:${c.studentId}`, sourceIds: c.sourceIds.map(id => opaque("source", id)).sort(),
    familyKey: opaque("family", c.familyKey), familyKeys: c.familyKeys.map(key => opaque("family", key)).sort() }));
  const counts = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map(k => [k, xs.filter(x => x === k).length]));
  const knownPhones = new Set(students.filter(s => s.eligible).flatMap(s => [...studentEventPhones(s)]));
  const withPhone = result.outcomes.filter(d => d.row.phones.length > 0);
  const phoneMatched = withPhone.filter(d => d.row.phones.some(p => knownPhones.has(p)));
  const summary = { ...eventCreditCounts(result.credits), parsedRows: rows.length, sources: pack.sources.length, files: new Set(pack.sources.map(s => s.fileId)).size,
    states: counts(result.outcomes.map(d => d.state)), attendanceStates: counts(result.outcomes.map(d => d.attendance.state)),
    reasons: counts(result.outcomes.filter(d => d.state === "review").flatMap(d => d.reasons)), duplicateAttributions: result.duplicateAttributions,
    pointsPerEvent: DEFAULT_PARENT_SEMINAR_POINTS, proposedPoints: result.credits.length * DEFAULT_PARENT_SEMINAR_POINTS,
    enabled: false, outsideRoster, identityKeyFingerprint: hash(privacyKey).slice(0, 16),
    phoneAudit: { rowsWithPhone: withPhone.length, rowsWithoutPhone: rows.length - withPhone.length,
      matchingRows: phoneMatched.length, matchedStates: counts(phoneMatched.map(d => d.state)),
      phoneStates: counts(withPhone.map(d => d.state)), matchedReviewReasons: counts(phoneMatched.filter(d => d.state === "review").flatMap(d => d.reasons)) },
    pendingRows: result.outcomes.filter(d => d.state === "review" && d.row.tenantId === database.tenantId
      && !d.reasons.some(r => r === "tenant_unknown" || r.startsWith("event_kind_"))).length,
    enrollmentTiming: { beforeProfileEnrollment: result.credits.filter(c => { const s = database.students.find(s => s.id === c.studentId)!; return s.enrolled_at && c.eventDate < s.enrolled_at; }).length,
      afterProfileWithdrawal: result.credits.filter(c => { const s = database.students.find(s => s.id === c.studentId)!; return s.withdrawn_at && c.eventDate > s.withdrawn_at; }).length,
      insideEnrollmentHistory: result.credits.filter(c => database.enrollments.some(e => canonical(e.student_id) === c.studentId && e.start_date <= c.eventDate && (!e.end_date || e.end_date >= c.eventDate))).length } };
  const sourceHash = sourcePackHash(pack), databaseHash = hash(database);
  const reviewRows = result.outcomes.filter(d => d.state === "review").map(d => ({ sourceRef: d.row.sourceRef, row: d.row.row,
    eventTitle: d.row.eventTitle, eventDate: d.row.eventDate, studentName: d.row.studentName, reasons: d.reasons,
    inScope: d.row.tenantId === database.tenantId && !d.reasons.some(r => r === "tenant_unknown" || r.startsWith("event_kind_")) }));
  const fingerprint = hash({ schema: 1, policy: EVENT_POLICY, tenantId: database.tenantId, today, sourceHash, databaseHash, events, registrations, credits, summary, reviewRows });
  return { schema: 1 as const, policy: EVENT_POLICY, tenantId: database.tenantId, today, readOnly: true as const,
    sourceHash, databaseHash, fingerprint, driveVerifiedAt: null as string | null, summary, events, registrations, credits, reviewRows };
}
export type EventBundle = ReturnType<typeof buildEventBundle>;
