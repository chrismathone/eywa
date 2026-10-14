// Source JSON must come from bounded, complete Sheets reads. No student/enrollment/workflow mutations.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { parseSourceReports, type SourceSheet } from "../src/features/withdrawal-reports/source-parser";
import { matchArchive, type MatchStudent } from "../src/features/withdrawal-reports/archive-match";
import { isMergedStudent } from "../src/features/students/merged";
const path = process.argv[2];
const tenant = process.argv[3];
const apply = process.argv.includes("--apply");
if (!path || !/^[0-9a-f-]{36}$/i.test(tenant ?? "")) throw new Error("Supply source JSON and tenant UUID.");
const source = JSON.parse(readFileSync(path, "utf8")) as { spreadsheetId: string; sheets: SourceSheet[] };
if (!source.spreadsheetId || !source.sheets.length) throw new Error("Complete workbook data is required.");
const reports = source.sheets.flatMap(parseSourceReports);
if (!reports.length || new Set(reports.map(r => r.sourceKey)).size !== reports.length) throw new Error("Empty or duplicate source keys.");
const connection = new URL(process.env.DATABASE_URL ?? "missing:");
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "missing:").hostname.split(".")[0];
if (!(connection.hostname === `db.${project}.supabase.co` || decodeURIComponent(connection.username).endsWith(`.${project}`))) throw new Error("Database project mismatch.");
const db = postgres(connection.toString(), { ssl: "require", max: 1, prepare: false });
const hash = (rows: unknown) => createHash("sha256").update(JSON.stringify(rows, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)).digest("hex");
try {
  await db.begin("isolation level repeatable read", async sql => {
    const [academy] = await sql`select name from public.tenants where id=${tenant}`;
    if (!academy) throw new Error("Unknown tenant.");
    const sourceStudents = await sql`select s.id,s.name,s.school,s.grade,s.status,s.notes,s.withdrawn_at::text,coalesce((select jsonb_agg(jsonb_build_object('className',c.class_name,'subject',c.subject)) from public.enrollments e join public.classes c on c.id=e.class_id and c.tenant_id=s.tenant_id where e.tenant_id=s.tenant_id and e.student_id=s.id),'[]') as courses from public.students s where s.tenant_id=${tenant} and not s.is_test order by s.id`;
    const students = sourceStudents.filter(s => !isMergedStudent(s.notes)) as unknown as MatchStudent[];
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const rows = reports.map(r => ({ report: r, match: matchArchive(r, students, today) }));
    console.log(JSON.stringify({ project, academy: academy.name, sourceSheets: source.sheets.length, reports: reports.length, mapped: rows.filter(r => r.match.studentId).length, unmapped: rows.filter(r => !r.match.studentId).length, apply }));
    if (!apply) {
      console.log(JSON.stringify({ unmatched: rows.filter(r => !r.match.studentId).map(r => ({ sourceKey: r.report.sourceKey, name: r.report.studentName, schoolGrade: r.report.schoolGrade, reason: r.match.reason, candidates: r.match.candidates.map(c => ({ name: c.name, school: c.school, grade: c.grade, conflict: c.conflict })) })) }));
      return;
    }
    const prior = await sql`select source_key,student_name,subject,raw_exit_date from public.withdrawal_report_archives where tenant_id=${tenant} and spreadsheet_id=${source.spreadsheetId}`;
    if (rows.some(({ report: r }) => { const old = prior.find(p => p.source_key === r.sourceKey); return old && (old.student_name !== r.studentName || old.subject !== r.subject || old.raw_exit_date !== r.rawExitDate); })) throw new Error("Source form identity changed at an existing position; review source movement before importing. Existing mappings preserved.");
    // Compare full live state, including notification rows, within this transaction before commit.
    const liveState = async () => Promise.all([sql`select * from public.students where tenant_id=${tenant} order by id`, sql`select * from public.enrollments where tenant_id=${tenant} order by id`, sql`select * from public.notifications where tenant_id=${tenant} order by id`, sql`select * from public.withdrawal_reports where tenant_id=${tenant} order by id`]);
    const before = hash(await liveState());
    for (const sheet of source.sheets) await sql`insert into public.withdrawal_report_sources(tenant_id,spreadsheet_id,sheet_id,sheet_title,hidden,grid) values(${tenant},${source.spreadsheetId},${sheet.sheetId},${sheet.title},${sheet.hidden},${sql.json(sheet.values as never)}) on conflict(tenant_id,spreadsheet_id,sheet_id) do update set sheet_title=excluded.sheet_title,hidden=excluded.hidden,grid=excluded.grid`;
    for (const { report: r, match: m } of rows) await sql`insert into public.withdrawal_report_archives(tenant_id,spreadsheet_id,source_key,sheet_id,sheet_title,source_range,student_name,school_grade,class_name,subject,exit_date,raw_exit_date,teacher_name,fields,signatures,raw_grid,mapped_student_id,mapping_kind,mapping_evidence) values(${tenant},${source.spreadsheetId},${r.sourceKey},${r.sheetId},${r.sheetTitle},${r.sourceRange},${r.studentName},${r.schoolGrade},${r.className},${r.subject},${r.exitDate},${r.rawExitDate},${r.teacherName},${sql.json(r.fields)},${sql.json(r.signatures)},${sql.json(r.rawGrid)},${m.studentId},${m.studentId ? "auto" : "unmapped"},${sql.json(m)}) on conflict(tenant_id,spreadsheet_id,source_key) do update set sheet_title=excluded.sheet_title,source_range=excluded.source_range,student_name=excluded.student_name,school_grade=excluded.school_grade,class_name=excluded.class_name,subject=excluded.subject,exit_date=excluded.exit_date,raw_exit_date=excluded.raw_exit_date,teacher_name=excluded.teacher_name,fields=excluded.fields,signatures=excluded.signatures,raw_grid=excluded.raw_grid,mapped_student_id=case when withdrawal_report_archives.mapping_kind='manual' then withdrawal_report_archives.mapped_student_id else excluded.mapped_student_id end,mapping_kind=case when withdrawal_report_archives.mapping_kind='manual' then 'manual' else excluded.mapping_kind end,mapping_evidence=excluded.mapping_evidence,revision=withdrawal_report_archives.revision+1`;
    const stored = await sql`select source_key,fields,signatures,raw_grid,mapped_student_id from public.withdrawal_report_archives where tenant_id=${tenant} and spreadsheet_id=${source.spreadsheetId}`;
    if (stored.length !== reports.length || rows.some(({ report: r }) => { const record = stored.find(s => s.source_key === r.sourceKey); return !record || hash([record.fields, record.signatures, record.raw_grid]) !== hash([r.fields, r.signatures, r.rawGrid]); })) throw new Error("Stored source verification failed.");
    if (hash(await liveState()) !== before) throw new Error("Live student/course/notification/workflow state changed during import. Rolled back.");
    console.log(JSON.stringify({ imported: stored.length, mapped: stored.filter(r => r.mapped_student_id).length, unmapped: stored.filter(r => !r.mapped_student_id).length, liveStateUnchanged: true }));
  });
} finally { await db.end(); }
