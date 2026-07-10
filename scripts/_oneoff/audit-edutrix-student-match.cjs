// Read-only audit: Edutrix report student names vs eywa students (exact-name match used by import/cron).
// Usage: node --env-file=.env.local scripts/_oneoff/audit-edutrix-student-match.cjs
// Does NOT mutate DB.
const { createClient } = require("@supabase/supabase-js");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"; // import-lesson-reports / edutrix-sync 동일
const PAGE = 1000;

(async () => {
  const { EDUTRIX_SUPABASE_URL, EDUTRIX_SUPABASE_ANON_KEY, DATABASE_URL } = process.env;
  if (!EDUTRIX_SUPABASE_URL || !EDUTRIX_SUPABASE_ANON_KEY || !DATABASE_URL) {
    throw new Error("EDUTRIX_SUPABASE_URL / EDUTRIX_SUPABASE_ANON_KEY / DATABASE_URL required");
  }
  const edu = createClient(EDUTRIX_SUPABASE_URL, EDUTRIX_SUPABASE_ANON_KEY);
  const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });

  const tenants = await sql`select id, name, slug from tenants`;
  console.log("=== TENANTS ===");
  for (const t of tenants) console.log(t.id, t.slug || "", t.name);
  console.log("audit tenant:", TENANT);

  // Edutrix reports → name frequency + sample class names
  const eduNameCount = new Map();
  const eduNameClasses = new Map();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await edu
      .from("reports")
      .select("date, students(name), classes(name)")
      .order("date", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error("edutrix reports: " + error.message);
    if (!data?.length) break;
    for (const row of data) {
      const s = row.students;
      const name = Array.isArray(s) ? s[0]?.name : s?.name;
      if (!name) continue;
      eduNameCount.set(name, (eduNameCount.get(name) || 0) + 1);
      const c = row.classes;
      const cname = Array.isArray(c) ? c[0]?.name : c?.name;
      if (cname) {
        if (!eduNameClasses.has(name)) eduNameClasses.set(name, new Set());
        eduNameClasses.get(name).add(cname);
      }
    }
    if (data.length < PAGE) break;
  }

  // Edutrix students table (if readable)
  const eduStudentsAll = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await edu.from("students").select("id, name").range(from, from + PAGE - 1);
    if (error) {
      console.log("edutrix students table:", error.message);
      break;
    }
    if (!data?.length) break;
    eduStudentsAll.push(...data);
    if (data.length < PAGE) break;
  }

  const eywa = await sql`
    select id, name, school, grade, status, name_normalized
    from students
    where tenant_id = ${TENANT}
  `;

  const byName = new Map();
  const byNorm = new Map();
  for (const s of eywa) {
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s);
    const n = (s.name_normalized || s.name.replace(/\s+/g, "")).toLowerCase();
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(s);
  }

  const eduNames = [...eduNameCount.keys()];
  const exact1 = [];
  const exact0 = [];
  const exactMany = [];
  const normOnly = [];

  for (const name of eduNames) {
    const hits = byName.get(name) || [];
    if (hits.length === 1) exact1.push(name);
    else if (hits.length === 0) {
      const n = name.replace(/\s+/g, "").toLowerCase();
      const nh = byNorm.get(n) || [];
      if (nh.length === 1) normOnly.push({ name, eywaName: nh[0].name, school: nh[0].school, grade: nh[0].grade });
      else exact0.push({ name, reason: nh.length > 1 ? "norm-many" : "none", n: nh.length });
    } else {
      exactMany.push({
        name,
        count: hits.length,
        students: hits.map((h) => ({
          id: h.id.slice(0, 8),
          school: h.school,
          grade: h.grade,
          status: h.status,
        })),
      });
    }
  }

  const fanout = await sql`
    select lr.report_date, lr.teacher_name, s.name,
           count(distinct lr.student_id)::int as n_students,
           count(*)::int as n_rows
    from lesson_reports lr
    join students s on s.id = lr.student_id
    where lr.tenant_id = ${TENANT}
      and lr.source = 'edutrix_import'
    group by lr.report_date, lr.teacher_name, s.name
    having count(distinct lr.student_id) > 1
    order by n_students desc
    limit 40
  `;

  const lrStats = await sql`
    select
      count(*)::int as total,
      count(distinct student_id)::int as students,
      count(*) filter (where source = 'edutrix_import')::int as edutrix_rows,
      count(distinct student_id) filter (where source = 'edutrix_import')::int as edutrix_students
    from lesson_reports
    where tenant_id = ${TENANT}
  `;

  let mass1 = 0;
  let massMany = 0;
  let mass0 = 0;
  for (const name of eduNames) {
    const c = eduNameCount.get(name);
    const hits = byName.get(name) || [];
    if (hits.length === 1) mass1 += c;
    else if (hits.length === 0) mass0 += c;
    else massMany += c;
  }
  const massAll = mass1 + massMany + mass0 || 1;

  console.log("\n=== MATCH KEY (code) ===");
  console.log("import-lesson-reports.cjs + /api/cron/edutrix-sync");
  console.log("key = EXACT students.name string only (no school/grade/phone/edutrix_id)");
  console.log("if 2+ eywa share name → report is COPIED to EVERY matching student_id (fan-out)");

  console.log("\n=== COUNTS ===");
  console.log("edutrix distinct names with reports:", eduNames.length);
  console.log("edutrix report rows (name incidences):", [...eduNameCount.values()].reduce((a, b) => a + b, 0));
  console.log("edutrix students table rows:", eduStudentsAll.length);
  console.log("eywa students (tenant):", eywa.length);
  console.log("lesson_reports:", lrStats[0]);

  console.log("\n=== EXACT NAME MATCH (edutrix names that appear in reports) ===");
  console.log("1:1 exact:", exact1.length);
  console.log("0 match unmatched:", exact0.length);
  console.log("2+ match AMBIGUOUS:", exactMany.length);
  console.log("0 exact but 1 via name_normalized:", normOnly.length);

  const unmatchedNone = exact0.filter((x) => x.reason === "none");
  console.log("\n--- unmatched sample (top 30 by report count) ---");
  unmatchedNone
    .map((x) => ({ name: x.name, reports: eduNameCount.get(x.name) }))
    .sort((a, b) => b.reports - a.reports)
    .slice(0, 30)
    .forEach((x) => console.log(JSON.stringify(x)));

  if (normOnly.length) {
    console.log("\n--- norm-only matches (would miss under exact key) ---");
    normOnly.slice(0, 20).forEach((x) => console.log(JSON.stringify({ ...x, reports: eduNameCount.get(x.name) })));
  }

  console.log("\n--- AMBIGUOUS (edutrix name → 2+ eywa) ---");
  exactMany
    .sort((a, b) => b.count - a.count)
    .forEach((x) => {
      console.log(
        JSON.stringify({
          name: x.name,
          edutrixReports: eduNameCount.get(x.name),
          eywaCount: x.count,
          students: x.students,
          eduClasses: [...(eduNameClasses.get(x.name) || [])].slice(0, 6),
        }),
      );
    });

  console.log("\n--- DB evidence: same name+date+teacher on multiple students (fan-out already in DB) ---");
  console.log("groups:", fanout.length);
  fanout.slice(0, 20).forEach((r) => console.log(JSON.stringify(r)));

  console.log("\n=== REPORT MASS ===");
  console.log({
    massAll: mass1 + massMany + mass0,
    mass1_1: mass1,
    massAmbiguous: massMany,
    massUnmatched: mass0,
    pct1_1: ((mass1 / massAll) * 100).toFixed(1) + "%",
    pctAmbiguous: ((massMany / massAll) * 100).toFixed(1) + "%",
    pctUnmatched: ((mass0 / massAll) * 100).toFixed(1) + "%",
  });

  if (eduStudentsAll.length) {
    const em = new Map();
    for (const s of eduStudentsAll) em.set(s.name, (em.get(s.name) || 0) + 1);
    const eduDups = [...em.entries()].filter(([, n]) => n > 1);
    console.log("\nedutrix students table name dups:", eduDups.length);
    eduDups
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .forEach(([n, c]) => console.log(JSON.stringify({ name: n, count: c })));
  }

  // eywa enrolled name collisions overall
  const eywaDup = [...byName.entries()].filter(([, arr]) => arr.length > 1);
  const eywaDupEnrolled = eywaDup.filter(([, arr]) => arr.some((s) => s.status === "enrolled"));
  console.log("\neywa names with 2+ students:", eywaDup.length, "(with ≥1 enrolled:", eywaDupEnrolled.length + ")");

  await sql.end();
})().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
