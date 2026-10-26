import type { Sql } from "postgres";
import { buildStudentMonths, type BuiltMonth } from "../../../src/features/student-contribution/model/build";
import { emptyRaws } from "../../../src/features/student-contribution/model/config";
import { normalizeStoredRaws } from "../../../src/features/student-contribution/model/normalize-raws";
import { shiftMonth } from "../../../src/lib/date-kst";
import type { EventBundle } from "./bundle";
export async function previewEventImpact(sql: Pick<Sql, "unsafe">, report: EventBundle) {
  const ids = [...new Set(report.credits.map(c => c.studentId))];
  const rows = await sql.unsafe("select student_id,month,raws,correction,closed_at,reconstructed from public.student_contribution_months where tenant_id=$1 and student_id=any($2::uuid[]) order by student_id,month", [report.tenantId, ids]);
  const month = report.today.slice(0, 7), since = shiftMonth(month, -11);
  const total = (rows: BuiltMonth[], start = "") => rows.filter(r => r.month >= start).reduce((n, r) => n + r.raws.parentSeminarEvents + r.correction.parentSeminarEvents, 0);
  return ids.map(studentId => {
    const stored: BuiltMonth[] = rows.filter(r => r.student_id === studentId).map(r => ({ month: r.month,
      raws: { ...emptyRaws(), parentSeminarEvents: normalizeStoredRaws(r.raws).parentSeminarEvents },
      correction: { ...emptyRaws(), parentSeminarEvents: normalizeStoredRaws(r.correction).parentSeminarEvents },
      closedAt: r.closed_at, reconstructed: r.reconstructed, evidenceIds: [] }));
    const facts = report.credits.filter(c => c.studentId === studentId).map(c => ({ studentId, month: c.eventDate.slice(0, 7), raws: { ...emptyRaws(), parentSeminarEvents: 1 }, evidenceIds: [c.id] }));
    const next = buildStudentMonths({ month, capturedAt: `${report.today}T00:00:00+09:00`, facts, stored, complete: true });
    return { studentId, events: facts.length, cumulativeDelta: total(next) - total(stored), recent12Delta: total(next, since) - total(stored, since),
      currentMonthDelta: total(next, month) - total(stored, month), currentCorrection: next.find(r => r.month === month)?.correction.parentSeminarEvents ?? 0,
      frozenMonthsPreserved: stored.filter(r => r.closedAt).every(r => JSON.stringify(next.find(n => n.month === r.month)) === JSON.stringify(r)) };
  });
}
