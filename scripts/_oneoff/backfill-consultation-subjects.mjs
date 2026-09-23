/** One-time Chimsan consultation repair. Dry-run by default; --apply writes only empty fields. */
import postgres from "postgres";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { makeCounselorMatcher, registrantFromSummary } = require("../_makeedu/consultation-counselor.cjs");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const apply = process.argv.includes("--apply");
const subjectLabels = { math: "수학", english: "영어", science: "과학" };
// Manually reviewed original summaries: these contain English-specific coursework
// (e.g. phonics, vocabulary, reading, grammar) despite a multi-subject or absent counselor.
const explicitEnglishIds = new Set([
  "09403951-1642-42d1-8344-1ccecc5cfca1", "0da5ebcc-1e25-4bf7-8c4e-dc0962e5f9ba",
  "30a4fb2b-987f-461c-a684-ffb0174c83f1", "374583e7-15a7-4d6a-953f-02e3b999d10a",
  "7c48b403-59cf-48db-b227-d851c6cca656", "7ef54b28-1ee6-49b3-b461-7d840e3a847c",
  "9f9217ce-c63a-419d-ab68-319f8b053bb2", "c783b7c0-eadb-453a-a3ce-ca648c4ce89e",
  "d0d7456e-49d0-4736-b06b-7ff51942776a", "e8280d40-5fc4-4a28-b839-4374a283ee40",
]);

try {
  const tenants = await sql`select id from tenants where slug = 'cs'`;
  if (tenants.length !== 1) throw new Error("Expected exactly one cs tenant");
  const tenantId = tenants[0].id;
  const users = await sql`select id, display_name, english_name, subjects from users where tenant_id = ${tenantId}`;
  const matchCounselor = makeCounselorMatcher(users);
  const byId = new Map(users.map((user) => [user.id, user]));
  const rows = await sql`
    select c.id, c.counselor_id, c.summary, c.student_id, c.consulted_at,
      array_agg(distinct cl.subject) filter (where cl.subject is not null) as enrollment_subjects
    from student_consultations c
    left join enrollments e on e.student_id = c.student_id and e.tenant_id = c.tenant_id
      and e.start_date <= (c.consulted_at at time zone 'Asia/Seoul')::date
      and (e.end_date is null or e.end_date >= (c.consulted_at at time zone 'Asia/Seoul')::date)
    left join classes cl on cl.id = e.class_id and cl.tenant_id = c.tenant_id
    where c.tenant_id = ${tenantId} and nullif(btrim(c.subject), '') is null
    group by c.id`;
  const updates = [];
  const unresolved = [];
  const reasons = {};
  for (const row of rows) {
    const matched = row.counselor_id ? null : matchCounselor(registrantFromSummary(row.summary));
    const counselor = byId.get(row.counselor_id) || matched;
    const staffSubjects = (counselor?.subjects || []).filter((key) => subjectLabels[key]);
    const enrolled = (row.enrollment_subjects || []).filter((key) => subjectLabels[key]);
    let key = null;
    let reason = null;
    if (staffSubjects.length === 1) {
      key = staffSubjects[0];
      reason = "staff_single_subject";
    } else if (enrolled.length === 1 && (staffSubjects.length === 0 || staffSubjects.includes(enrolled[0]))) {
      key = enrolled[0];
      reason = counselor ? "unique_enrollment" : "unmatched_unique_enrollment";
    } else if (explicitEnglishIds.has(row.id)) {
      if (!/영어|파닉스|리딩|독해|단어|문법|영유|스피킹|라이팅/.test(row.summary)) {
        throw new Error(`Summary evidence changed: ${row.id}`);
      }
      key = "english";
      reason = "explicit_english_content";
    }
    if (key) {
      updates.push({ id: row.id, counselorId: row.counselor_id || matched?.id || null, subject: subjectLabels[key], reason });
      reasons[reason] = (reasons[reason] || 0) + 1;
    } else {
      unresolved.push({ id: row.id, counselor: counselor?.display_name || registrantFromSummary(row.summary) || null, subjects: staffSubjects, enrollment: enrolled });
    }
  }
  console.log(JSON.stringify({ tenant: "cs", blankBefore: rows.length, planned: updates.length, reasons, unresolved }, null, 2));
  if (!apply) process.exitCode = 0;
  else {
    await sql.begin(async (tx) => {
      for (const row of updates) {
        const result = await tx`
          update student_consultations set
            subject = ${row.subject},
            counselor_id = coalesce(counselor_id, ${row.counselorId}),
            updated_at = now()
          where id = ${row.id} and tenant_id = ${tenantId}
            and nullif(btrim(subject), '') is null`;
        if (result.count !== 1) throw new Error(`Concurrent change: ${row.id}`);
      }
    });
    const remaining = await sql`
      select count(*)::int as count from student_consultations
      where tenant_id = ${tenantId} and nullif(btrim(subject), '') is null`;
    console.log(JSON.stringify({ applied: updates.length, remaining: remaining[0].count }));
  }
} finally {
  await sql.end();
}
